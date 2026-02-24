declare const process: { env: Record<string, string | undefined> };

import type {
  ForensicsCalibratedAnomaly,
  ForensicsFusedSignal,
  ForensicsPhaseStatus,
  ForensicsPhaseTrace,
  ForensicsRunMetadata,
  ForensicsSignalContributor,
  ForensicsSignalInput,
  RunForensicsShadowRequest,
  RunForensicsShadowResponse,
  SeverityLevel,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import {
  appendCalibrationTimestamp,
  appendCalibrationValue,
  getTopologyBaselineEntry,
  getCalibrationTimestampHistory,
  getCalibrationHistory,
  listForensicsPolicyEntries,
  saveForensicsRun,
  upsertTopologyBaselineEntry,
  upsertForensicsPolicyEntry,
} from './forensics-blackboard';
import { deriveFinancialTopologySignals } from './financial-topology';
import { getCachedJson } from '../../../_shared/redis';
import type { Evidence, POLEGraph } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';

const WORKER_TIMEOUT_MS = 8_000;

const PHASE_STATUS_SUCCESS: ForensicsPhaseStatus = 'FORENSICS_PHASE_STATUS_SUCCESS';
const PHASE_STATUS_FAILED: ForensicsPhaseStatus = 'FORENSICS_PHASE_STATUS_FAILED';

function buildRunId(): string {
  const prefix = `frx_${Date.now().toString(36)}`;
  try {
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    return `${prefix}_${rand}`;
  } catch {
    const rand = Math.random().toString(36).slice(2, 14);
    return `${prefix}_${rand}`;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.floor(((p / 100) * (sorted.length - 1)))));
  return sorted[position] ?? sorted[sorted.length - 1] ?? Number.POSITIVE_INFINITY;
}

function sigmoid(x: number): number {
  if (x < -30) return 0;
  if (x > 30) return 1;
  return 1 / (1 + Math.exp(-x));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function normalizeSignals(reqDomain: string, signals: ForensicsSignalInput[]): ForensicsSignalInput[] {
  const normalized: ForensicsSignalInput[] = [];
  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;
    if (!signal.sourceId || !signal.signalType) continue;
    if (!Number.isFinite(signal.value)) continue;
    const domain = signal.domain?.trim() || reqDomain || 'infrastructure';
    normalized.push({
      ...signal,
      domain,
      region: signal.region || 'global',
      confidence: Number.isFinite(signal.confidence) ? clamp(signal.confidence, 0, 1) : 1,
      observedAt: Number.isFinite(signal.observedAt) && signal.observedAt > 0 ? signal.observedAt : Date.now(),
      evidenceIds: signal.evidenceIds || [],
    });
  }
  return normalized;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? sorted[mid] ?? 0;
    const right = sorted[mid] ?? left;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeIntervals(timestamps: number[]): number[] {
  if (timestamps.length < 2) return [];
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1] ?? 0;
    const next = timestamps[i] ?? 0;
    const delta = next - prev;
    if (delta > 0 && Number.isFinite(delta)) {
      intervals.push(delta);
    }
  }
  return intervals;
}

function roundValue(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const TOPOLOGY_BASELINE_SIGNAL_TYPES = new Set([
  'topology_tsi',
  'topology_beta1',
  'topology_cycle_risk',
]);

function shouldTrackTopologyBaseline(signalType: string): boolean {
  return TOPOLOGY_BASELINE_SIGNAL_TYPES.has(signalType);
}

async function enrichTopologySignalsWithBaseline(
  signals: ForensicsSignalInput[],
  fallbackDomain: string,
): Promise<ForensicsSignalInput[]> {
  if (signals.length === 0) return signals;

  const enriched: ForensicsSignalInput[] = [...signals];
  for (const signal of signals) {
    if (!shouldTrackTopologyBaseline(signal.signalType)) continue;
    if (!Number.isFinite(signal.value)) continue;

    const domain = signal.domain || fallbackDomain || 'market';
    const region = signal.region || 'global';
    const baseline = await getTopologyBaselineEntry(domain, region, signal.signalType);
    const count = baseline?.count ?? 0;
    const mean = baseline?.mean ?? signal.value;
    const stdDev = baseline?.stdDev ?? 0;
    const delta = signal.value - mean;
    const absZ = stdDev > 1e-9 ? Math.abs(delta / stdDev) : 0;

    if (count >= 6 && absZ > 0.25) {
      const baselineStrength = clamp(absZ * 12, 0, 100);
      const confidence = clamp(0.52 + Math.min(0.4, count / 60), 0.52, 0.95);
      enriched.push({
        sourceId: `${signal.sourceId}:baseline`,
        region,
        domain,
        signalType: `${signal.signalType}_baseline_delta`,
        value: roundValue(baselineStrength, 4),
        confidence: roundValue(confidence, 6),
        observedAt: signal.observedAt,
      });
    }

    const nextCount = count + 1;
    let nextMean = signal.value;
    let nextM2 = 0;
    let nextMin = signal.value;
    let nextMax = signal.value;
    if (baseline && count > 0) {
      const deltaMean = signal.value - baseline.mean;
      nextMean = baseline.mean + (deltaMean / nextCount);
      const deltaMean2 = signal.value - nextMean;
      nextM2 = (baseline.m2 || 0) + (deltaMean * deltaMean2);
      nextMin = Math.min(baseline.minValue, signal.value);
      nextMax = Math.max(baseline.maxValue, signal.value);
    }
    const variance = nextCount > 1 ? Math.max(0, nextM2 / (nextCount - 1)) : 0;
    const nextStdDev = Math.sqrt(variance);

    await upsertTopologyBaselineEntry({
      domain,
      region,
      signalType: signal.signalType,
      count: nextCount,
      mean: roundValue(nextMean, 6),
      m2: roundValue(nextM2, 6),
      stdDev: roundValue(nextStdDev, 6),
      minValue: roundValue(nextMin, 6),
      maxValue: roundValue(nextMax, 6),
      lastValue: roundValue(signal.value, 6),
      lastUpdated: signal.observedAt,
    });
  }
  return enriched;
}

type WorkerFuseResponse = { fusedSignals?: ForensicsFusedSignal[] };
type WorkerAnomalyResponse = { anomalies?: ForensicsCalibratedAnomaly[] };

async function callWorker<T>(path: string, body: unknown): Promise<T | null> {
  const base = process.env.FORENSICS_WORKER_URL;
  if (!base) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const workerSecret = process.env.FORENSICS_WORKER_SHARED_SECRET?.trim();
  if (workerSecret) {
    headers['X-Forensics-Worker-Secret'] = workerSecret;
  }
  try {
    const url = `${base.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function runWeakSupervisionFusion(signals: ForensicsSignalInput[]): ForensicsFusedSignal[] {
  if (signals.length === 0) return [];

  const sourceIds = Array.from(new Set(signals.map((signal) => signal.sourceId)));
  const signalTypes = Array.from(new Set(signals.map((signal) => signal.signalType)));
  const sourceIndex = new Map(sourceIds.map((sourceId, i) => [sourceId, i]));
  const typeIndex = new Map(signalTypes.map((signalType, i) => [signalType, i]));

  const valueMatrix = Array.from({ length: sourceIds.length }, () => Array.from({ length: signalTypes.length }, () => 0));
  const domainBySource = new Map<string, string>();
  const regionBySource = new Map<string, string>();
  const evidenceIdsBySource = new Map<string, Set<string>>();

  for (const signal of signals) {
    const i = sourceIndex.get(signal.sourceId);
    const j = typeIndex.get(signal.signalType);
    if (i === undefined || j === undefined) continue;
    valueMatrix[i]![j] = (valueMatrix[i]![j] ?? 0) + signal.value;
    if (!domainBySource.has(signal.sourceId)) domainBySource.set(signal.sourceId, signal.domain || 'infrastructure');
    if (!regionBySource.has(signal.sourceId)) regionBySource.set(signal.sourceId, signal.region || 'global');
    
    if (signal.evidenceIds && signal.evidenceIds.length > 0) {
      if (!evidenceIdsBySource.has(signal.sourceId)) {
        evidenceIdsBySource.set(signal.sourceId, new Set());
      }
      const set = evidenceIdsBySource.get(signal.sourceId)!;
      for (const id of signal.evidenceIds) {
        set.add(id);
      }
    }
  }

  const thresholds = signalTypes.map((_signalType, j) => {
    const positives = valueMatrix.map((row) => row[j] ?? 0).filter((value) => value > 0);
    return percentile(positives, 70);
  });

  const labelMatrix = valueMatrix.map((row) => row.map((value, j) => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const threshold = thresholds[j] ?? Number.POSITIVE_INFINITY;
    return value >= threshold ? 1 : -1;
  }));

  const normalizedValues = signalTypes.map((_signalType, j) => {
    const positives = valueMatrix.map((row) => row[j] ?? 0).filter((value) => value > 0);
    const min = positives.length > 0 ? Math.min(...positives) : 0;
    const max = positives.length > 0 ? Math.max(...positives) : 0;
    return { min, max };
  });

  const propensities = signalTypes.map((_signalType, j) => {
    const active = labelMatrix.reduce((count, row) => count + ((row[j] ?? 0) === 0 ? 0 : 1), 0);
    return sourceIds.length > 0 ? active / sourceIds.length : 0;
  });

  // Estimate pairwise LF dependency to prevent correlated signals from being double-counted.
  const dependencyPenalty = signalTypes.map(() => 0);
  for (let j = 0; j < signalTypes.length; j++) {
    let weightedCorrelation = 0;
    let totalOverlap = 0;
    for (let k = 0; k < signalTypes.length; k++) {
      if (j === k) continue;
      let overlap = 0;
      let sumJ = 0;
      let sumK = 0;
      let sumJJ = 0;
      let sumKK = 0;
      let sumJK = 0;

      for (let i = 0; i < sourceIds.length; i++) {
        const lj = labelMatrix[i]?.[j] ?? 0;
        const lk = labelMatrix[i]?.[k] ?? 0;
        if (lj === 0 || lk === 0) continue;
        overlap += 1;
        sumJ += lj;
        sumK += lk;
        sumJJ += lj * lj;
        sumKK += lk * lk;
        sumJK += lj * lk;
      }

      if (overlap < 6) continue;
      const meanJ = sumJ / overlap;
      const meanK = sumK / overlap;
      const varJ = (sumJJ / overlap) - (meanJ * meanJ);
      const varK = (sumKK / overlap) - (meanK * meanK);
      if (varJ <= 1e-9 || varK <= 1e-9) continue;
      const cov = (sumJK / overlap) - (meanJ * meanK);
      const corr = cov / Math.sqrt(varJ * varK);
      const redundancy = clamp(corr, 0, 1);
      weightedCorrelation += redundancy * overlap;
      totalOverlap += overlap;
    }
    dependencyPenalty[j] = totalOverlap > 0
      ? clamp(weightedCorrelation / totalOverlap, 0, 0.95)
      : 0;
  }

  let accuracies = signalTypes.map(() => 0.7);
  let classPrior = 0.5;
  for (let iter = 0; iter < 80; iter++) {
    const previous = [...accuracies];
    const previousPrior = classPrior;
    const softLabels = labelMatrix.map((labels) => {
      let logit = Math.log(Math.max(1e-6, classPrior) / Math.max(1e-6, 1 - classPrior));
      labels.forEach((label, j) => {
        if (label === 0) return;
        const a = clamp(accuracies[j] ?? 0.7, 0.501, 0.999);
        const propensity = propensities[j] ?? 0;
        const independence = 1 - (0.7 * (dependencyPenalty[j] ?? 0));
        const voteScale = clamp(independence * (0.4 + (0.6 * propensity)), 0.15, 1);
        const odds = Math.log(a / (1 - a)) * voteScale;
        logit += label > 0 ? odds : -odds;
      });
      return sigmoid(logit);
    });

    classPrior = clamp(mean(softLabels), 0.05, 0.95);

    accuracies = accuracies.map((_current, j) => {
      let correct = 0;
      let total = 0;
      labelMatrix.forEach((labels, i) => {
        const label = labels[j] ?? 0;
        if (label === 0) return;
        const p = softLabels[i] ?? 0.5;
        correct += label > 0 ? p : 1 - p;
        total += 1;
      });
      if (total === 0) return 0.501;
      const priorAcc = 0.55;
      const priorWeight = 6;
      return clamp((correct + priorWeight * priorAcc) / (total + priorWeight), 0.501, 0.999);
    });

    const delta = accuracies.reduce((sum, value, j) => sum + Math.abs(value - (previous[j] ?? value)), 0);
    const priorDelta = Math.abs(classPrior - previousPrior);
    if (delta < 1e-5 && priorDelta < 1e-6) break;
  }

  const rawWeights = accuracies.map((accuracy, j) => {
    const skill = Math.max(0.001, (accuracy - 0.5) * 2);
    const propensity = Math.max(propensities[j] ?? 0, 0.02);
    const redundancyPenalty = Math.pow(1 - (dependencyPenalty[j] ?? 0), 0.8);
    return skill * propensity * Math.max(0.1, redundancyPenalty);
  });
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const weights = rawWeights.map((weight) => totalWeight > 0 ? weight / totalWeight : (signalTypes.length > 0 ? 1 / signalTypes.length : 0));

  const outputs: ForensicsFusedSignal[] = sourceIds.map((sourceId, i) => {
    const row = valueMatrix[i] ?? [];
    const labels = labelMatrix[i] ?? [];
    let logit = Math.log(Math.max(1e-6, classPrior) / Math.max(1e-6, 1 - classPrior));
    let weightedValue = 0;
    let activeWeight = 0;
    const contributors: ForensicsSignalContributor[] = [];

    signalTypes.forEach((signalType, j) => {
      const label = labels[j] ?? 0;
      const accuracy = clamp(accuracies[j] ?? 0.7, 0.501, 0.999);
      const weight = weights[j] ?? 0;
      const propensity = propensities[j] ?? 0;
      const independence = 1 - (0.7 * (dependencyPenalty[j] ?? 0));
      const voteScale = clamp(independence * (0.4 + (0.6 * propensity)), 0.15, 1);
      const value = row[j] ?? 0;
      if (label === 0) return;
      activeWeight += voteScale;
      const odds = Math.log(accuracy / (1 - accuracy)) * voteScale;
      logit += label > 0 ? odds : -odds;

      const { min, max } = normalizedValues[j] ?? { min: 0, max: 0 };
      const normalized = max > min ? (value - min) / (max - min) : 0.5;
      const contribution = normalized * weight * 100;
      weightedValue += contribution;
      contributors.push({
        signalType,
        contribution: Math.round(contribution * 100) / 100,
        learnedWeight: Math.round(weight * 1_000_000) / 1_000_000,
      });
    });

    const probability = sigmoid(logit);
    const score = clamp((probability * 70) + (weightedValue * 0.3), 0, 100);
    const effectiveN = Math.max(1, activeWeight * 2);
    const margin = 1.96 * Math.sqrt((probability * (1 - probability)) / effectiveN);

    contributors.sort((a, b) => b.contribution - a.contribution);

    return {
      sourceId,
      region: regionBySource.get(sourceId) || 'global',
      domain: domainBySource.get(sourceId) || 'infrastructure',
      probability: Math.round(probability * 1_000_000) / 1_000_000,
      score: Math.round(score * 100) / 100,
      confidenceLower: Math.round(clamp(probability - margin, 0, 1) * 1_000_000) / 1_000_000,
      confidenceUpper: Math.round(clamp(probability + margin, 0, 1) * 1_000_000) / 1_000_000,
      contributors: contributors.slice(0, 8),
      evidenceIds: Array.from(evidenceIdsBySource.get(sourceId) || []),
    };
  });

  outputs.sort((a, b) => b.score - a.score);
  return outputs;
}

function severityFromPValue(pValue: number, alpha: number, isAnomaly: boolean): SeverityLevel {
  if (!isAnomaly) return 'SEVERITY_LEVEL_UNSPECIFIED';
  if (pValue <= alpha / 5) return 'SEVERITY_LEVEL_HIGH';
  if (pValue <= alpha / 2) return 'SEVERITY_LEVEL_MEDIUM';
  return 'SEVERITY_LEVEL_LOW';
}

export async function runConformalAnomalies(
  signals: ForensicsSignalInput[],
  alpha: number,
): Promise<ForensicsCalibratedAnomaly[]> {
  const anomalies: ForensicsCalibratedAnomaly[] = [];
  for (const signal of signals) {
    const metricKey = `${signal.domain}:${signal.signalType}:${signal.region || 'global'}`;
    const historyValues = await getCalibrationHistory(metricKey);
    const historyTimestamps = await getCalibrationTimestampHistory(metricKey);

    const center = median(historyValues);
    const currentNcm = Math.abs(signal.value - center);
    const valueCalibrationScores = historyValues.map((value) => Math.abs(value - center));
    const valueGreaterOrEqual = valueCalibrationScores.reduce((count, score) => count + (score >= currentNcm ? 1 : 0), 0);
    const pValueValue = valueCalibrationScores.length > 0
      ? (valueGreaterOrEqual + 1) / (valueCalibrationScores.length + 1)
      : 1;

    const avg = mean(historyValues);
    const sd = stddev(historyValues, avg);
    const legacyZScore = sd > 1e-9 ? (signal.value - avg) / sd : 0;

    const previousTimestamp = historyTimestamps.length > 0
      ? historyTimestamps[historyTimestamps.length - 1] ?? 0
      : 0;
    const intervalMs = previousTimestamp > 0 && signal.observedAt > previousTimestamp
      ? signal.observedAt - previousTimestamp
      : 0;
    const intervalCalibration = computeIntervals(historyTimestamps).map((interval) => Math.log1p(interval));

    let pValueTiming = 1;
    let timingNcm = 0;
    if (intervalCalibration.length > 0 && intervalMs > 0) {
      const intervalCenter = median(intervalCalibration);
      const currentLogInterval = Math.log1p(intervalMs);
      timingNcm = Math.abs(currentLogInterval - intervalCenter);
      const timingCalibrationScores = intervalCalibration.map((value) => Math.abs(value - intervalCenter));
      const timingGreaterOrEqual = timingCalibrationScores.reduce((count, score) => count + (score >= timingNcm ? 1 : 0), 0);
      pValueTiming = (timingGreaterOrEqual + 1) / (timingCalibrationScores.length + 1);
    }

    // CADES-style dual score combination with Bonferroni correction.
    const pValueCombined = Math.min(1, 2 * Math.min(pValueValue, pValueTiming));
    const isAnomaly = historyValues.length >= 8 && pValueCombined <= alpha;

    anomalies.push({
      sourceId: signal.sourceId,
      region: signal.region || 'global',
      domain: signal.domain,
      signalType: signal.signalType,
      value: Math.round(signal.value * 1_000_000) / 1_000_000,
      pValue: Math.round(pValueCombined * 1_000_000) / 1_000_000,
      alpha: Math.round(alpha * 1_000_000) / 1_000_000,
      legacyZScore: Math.round(legacyZScore * 100) / 100,
      isAnomaly,
      severity: severityFromPValue(pValueCombined, alpha, isAnomaly),
      calibrationCount: historyValues.length,
      calibrationCenter: Math.round(center * 1_000_000) / 1_000_000,
      nonconformity: Math.round(currentNcm * 1_000_000) / 1_000_000,
      pValueValue: Math.round(pValueValue * 1_000_000) / 1_000_000,
      pValueTiming: Math.round(pValueTiming * 1_000_000) / 1_000_000,
      timingNonconformity: Math.round(timingNcm * 1_000_000) / 1_000_000,
      intervalMs: Math.max(0, Math.round(intervalMs)),
      observedAt: Math.max(0, Math.round(signal.observedAt || 0)),
      evidenceIds: signal.evidenceIds || [],
    });

    await appendCalibrationValue(metricKey, signal.value);
    await appendCalibrationTimestamp(metricKey, signal.observedAt);
  }

  anomalies.sort((a, b) => a.pValue - b.pValue);
  return anomalies;
}

async function executePhase<T>(
  trace: ForensicsPhaseTrace[],
  phase: string,
  parentPhases: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const completedAt = Date.now();
    trace.push({
      phase,
      status: PHASE_STATUS_SUCCESS,
      startedAt,
      completedAt,
      elapsedMs: completedAt - startedAt,
      error: '',
      parentPhases,
    });
    return result;
  } catch (error) {
    const completedAt = Date.now();
    trace.push({
      phase,
      status: PHASE_STATUS_FAILED,
      startedAt,
      completedAt,
      elapsedMs: completedAt - startedAt,
      error: error instanceof Error ? error.message : String(error),
      parentPhases,
    });
    throw error;
  }
}

function isWorkerFuseResponse(value: unknown): value is WorkerFuseResponse {
  return !!value && typeof value === 'object' && Array.isArray((value as WorkerFuseResponse).fusedSignals);
}

function isWorkerAnomalyResponse(value: unknown): value is WorkerAnomalyResponse {
  return !!value && typeof value === 'object' && Array.isArray((value as WorkerAnomalyResponse).anomalies);
}

type ForensicsPolicyAction = 'weak-supervision-fusion' | 'conformal-anomaly';

const POLICY_ACTIONS: ForensicsPolicyAction[] = [
  'weak-supervision-fusion',
  'conformal-anomaly',
];

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

const POLICY_DYNAMIC_ENABLED = process.env.FORENSICS_DYNAMIC_POLICY !== 'false';
const POLICY_LEARNING_ENABLED = process.env.FORENSICS_POLICY_LEARN !== 'false';
const POLICY_EPSILON = clamp(readEnvNumber('FORENSICS_POLICY_EPSILON', 0.15), 0, 1);
const POLICY_LEARNING_RATE = clamp(readEnvNumber('FORENSICS_POLICY_LEARNING_RATE', 0.2), 0.01, 1);

function hashState(input: string): string {
  // FNV-1a 32-bit; stable and fast for lightweight policy keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildPolicyStateHash(
  domain: string,
  alpha: number,
  signals: ForensicsSignalInput[],
): string {
  const signalTypes = Array.from(new Set(signals.map((signal) => signal.signalType))).sort();
  const regions = Array.from(new Set(signals.map((signal) => signal.region || 'global'))).sort();
  const sourceCountBucket = Math.min(8, Math.floor(signals.length / 10));
  const featureKey = [
    domain,
    `a:${alpha.toFixed(3)}`,
    `n:${signals.length}`,
    `nb:${sourceCountBucket}`,
    `t:${signalTypes.slice(0, 10).join(',')}`,
    `r:${regions.slice(0, 10).join(',')}`,
  ].join('|');
  return hashState(featureKey);
}

async function selectPolicyOrder(
  domain: string,
  stateHash: string,
): Promise<ForensicsPolicyAction[]> {
  if (!POLICY_DYNAMIC_ENABLED) return [...POLICY_ACTIONS];

  const entries = await listForensicsPolicyEntries({
    domain,
    stateHash,
    limit: POLICY_ACTIONS.length,
  });
  const qMap = new Map(entries.map((entry) => [entry.action, entry.qValue]));

  if (Math.random() < POLICY_EPSILON) {
    return Math.random() < 0.5
      ? [...POLICY_ACTIONS]
      : [POLICY_ACTIONS[1], POLICY_ACTIONS[0]];
  }

  const fusionQ = qMap.get('weak-supervision-fusion') ?? 0;
  const anomalyQ = qMap.get('conformal-anomaly') ?? 0;
  if (anomalyQ > fusionQ + 1e-6) {
    return ['conformal-anomaly', 'weak-supervision-fusion'];
  }
  return [...POLICY_ACTIONS];
}

function computePolicyReward(success: boolean, elapsedMs: number, outputRows: number): number {
  if (!success) return -1;
  const timeCost = Math.max(elapsedMs / 1000, 0.1);
  const infoGain = Math.log1p(Math.max(outputRows, 0)) / Math.log1p(timeCost + 1);
  return Math.round((1 + infoGain) * 10_000) / 10_000;
}

async function updatePolicyValue(
  domain: string,
  stateHash: string,
  action: ForensicsPolicyAction,
  reward: number,
): Promise<void> {
  if (!POLICY_LEARNING_ENABLED) return;

  const existing = await listForensicsPolicyEntries({
    domain,
    stateHash,
    limit: POLICY_ACTIONS.length,
  });
  const row = existing.find((entry) => entry.action === action);
  const oldQ = row?.qValue ?? 0;
  const visits = row?.visitCount ?? 0;
  const newQ = oldQ + (POLICY_LEARNING_RATE * (reward - oldQ));

  await upsertForensicsPolicyEntry({
    domain,
    stateHash,
    action,
    qValue: Math.round(newQ * 1_000_000) / 1_000_000,
    visitCount: visits + 1,
    lastReward: Math.round(reward * 1_000_000) / 1_000_000,
    lastUpdated: Date.now(),
  });
}

export async function runForensicsShadowPipeline(
  req: RunForensicsShadowRequest,
): Promise<RunForensicsShadowResponse> {
  const trace: ForensicsPhaseTrace[] = [];
  const runId = buildRunId();
  const startedAt = Date.now();
  const alpha = Number.isFinite(req.alpha) && req.alpha > 0 && req.alpha <= 1 ? req.alpha : 0.05;
  const domain = req.domain?.trim() || 'infrastructure';
  const persist = req.persist ?? true;

  let workerMode = process.env.FORENSICS_WORKER_URL ? 'remote' : 'local';
  let fusedSignals: ForensicsFusedSignal[] = [];
  let anomalies: ForensicsCalibratedAnomaly[] = [];

  try {
    let normalizedSignals = await executePhase(trace, 'ingest-signals', [], async () => {
      const validSignals = normalizeSignals(domain, req.signals || []);
      if (validSignals.length === 0 && (!req.evidenceIds || req.evidenceIds.length === 0)) {
        throw new Error('No valid forensics signals or evidence IDs were provided');
      }
      return validSignals;
    });

    const poleSignals = await executePhase(trace, 'extract-pole', [], async () => {
      const signals: ForensicsSignalInput[] = [];
      if (!req.evidenceIds || req.evidenceIds.length === 0) return signals;

      for (const id of req.evidenceIds) {
        try {
          const evidence = (await getCachedJson(`evidence:${id}`)) as Evidence | null;
          if (!evidence || !evidence.extractedPole) continue;

          // Convert POLE events to signals
          for (const ev of evidence.extractedPole.events) {
            signals.push({
              sourceId: `evidence:${id}`,
              region: 'global',
              domain,
              signalType: `pole_event:${ev.type}`.substring(0, 100).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              value: 1.0,
              confidence: 0.85,
              observedAt: ev.timestamp || Date.now(),
            });
          }
        } catch { /* ignore */ }
      }
      return signals;
    });
    
    normalizedSignals = [...normalizedSignals, ...poleSignals];

    const enrichedSignals = await executePhase(trace, 'topology-tda', ['ingest-signals', 'extract-pole'], async () => {
      const topology = deriveFinancialTopologySignals(normalizedSignals, domain);
      if (topology.derivedSignals.length === 0) {
        return normalizedSignals;
      }
      const topologySignals = await enrichTopologySignalsWithBaseline(topology.derivedSignals, domain);
      const deduped = new Map<string, ForensicsSignalInput>();
      for (const signal of normalizedSignals) {
        const key = `${signal.sourceId}::${signal.signalType}::${signal.region || 'global'}`;
        deduped.set(key, signal);
      }
      for (const signal of topologySignals) {
        const key = `${signal.sourceId}::${signal.signalType}::${signal.region || 'global'}`;
        if (!deduped.has(key)) {
          deduped.set(key, signal);
        }
      }
      return Array.from(deduped.values());
    });
    const policySelection = await executePhase(trace, 'policy-select', ['topology-tda'], async () => {
      const stateHash = buildPolicyStateHash(domain, alpha, enrichedSignals);
      const phaseOrder = await selectPolicyOrder(domain, stateHash);
      return { stateHash, phaseOrder };
    });

    for (const action of policySelection.phaseOrder) {
      try {
        if (action === 'weak-supervision-fusion') {
          fusedSignals = await executePhase(trace, action, ['policy-select'], async () => {
            const workerPayload = { domain, signals: enrichedSignals, alpha };
            const workerResponse = await callWorker<WorkerFuseResponse>('/internal/forensics/v1/fuse', workerPayload);
            if (isWorkerFuseResponse(workerResponse)) {
              return workerResponse.fusedSignals || [];
            }
            if (workerMode === 'remote') workerMode = 'mixed';
            return runWeakSupervisionFusion(enrichedSignals);
          });
        } else {
          anomalies = await executePhase(trace, action, ['policy-select'], async () => {
            const workerPayload = { domain, signals: enrichedSignals, alpha };
            const workerResponse = await callWorker<WorkerAnomalyResponse>('/internal/forensics/v1/anomaly', workerPayload);
            if (isWorkerAnomalyResponse(workerResponse)) {
              return workerResponse.anomalies || [];
            }
            if (workerMode === 'remote') workerMode = 'mixed';
            return runConformalAnomalies(enrichedSignals, alpha);
          });
        }

        const elapsedMs = trace[trace.length - 1]?.elapsedMs ?? 0;
        const outputRows = action === 'weak-supervision-fusion' ? fusedSignals.length : anomalies.length;
        const reward = computePolicyReward(true, elapsedMs, outputRows);
        await updatePolicyValue(domain, policySelection.stateHash, action, reward);
      } catch {
        const phaseError = trace[trace.length - 1]?.error || '';
        const elapsedMs = trace[trace.length - 1]?.elapsedMs ?? 0;
        const reward = computePolicyReward(false, elapsedMs, 0);
        await updatePolicyValue(domain, policySelection.stateHash, action, reward);
        throw new Error(`Forensics phase failed (${action}): ${phaseError}`);
      }
    }

    const completedAt = Date.now();
    const run: ForensicsRunMetadata = {
      runId,
      domain,
      startedAt,
      completedAt,
      status: 'completed',
      backend: 'redis',
      workerMode,
    };

    await executePhase(trace, 'persist-results', policySelection.phaseOrder, async () => {
      if (!persist) return;
      await saveForensicsRun({
        run,
        fusedSignals,
        anomalies,
        trace,
        createdAt: completedAt,
      });
    });

    return {
      run,
      fusedSignals,
      anomalies,
      trace,
      error: '',
    };
  } catch (error) {
    const completedAt = Date.now();
    const run: ForensicsRunMetadata = {
      runId,
      domain,
      startedAt,
      completedAt,
      status: 'failed',
      backend: 'redis',
      workerMode,
    };

    if (persist) {
      await saveForensicsRun({
        run,
        fusedSignals,
        anomalies,
        trace,
        createdAt: completedAt,
      });
    }

    return {
      run,
      fusedSignals,
      anomalies,
      trace,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
