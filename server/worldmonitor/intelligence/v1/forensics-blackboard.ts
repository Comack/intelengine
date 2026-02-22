import type {
  ForensicsCalibratedAnomaly,
  ForensicsFusedSignal,
  ForensicsPhaseTrace,
  ForensicsPolicyEntry,
  ForensicsRunMetadata,
  ForensicsRunSummary,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';

const RUN_TTL_SECONDS = 7 * 24 * 60 * 60;
const RUN_HISTORY_TTL_SECONDS = RUN_TTL_SECONDS;
const RUN_HISTORY_MAX_LENGTH = 1000;
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;
const HISTORY_MAX_LENGTH = 512;
const POLICY_TTL_SECONDS = 30 * 24 * 60 * 60;
const POLICY_MAX_ROWS_PER_DOMAIN = 4000;
const TOPOLOGY_BASELINE_TTL_SECONDS = 90 * 24 * 60 * 60;
const TOPOLOGY_BASELINE_KEY_PREFIX = 'forensics:topology_baseline';
const TOPOLOGY_BASELINE_MAX_ROWS_PER_DOMAIN = 2000;
const LATEST_KEY = 'forensics:latest';
const RUN_HISTORY_KEY = 'forensics:runs';
const POLICY_KEY_PREFIX = 'forensics:policy';

interface StoredForensicsRun {
  run: ForensicsRunMetadata;
  fusedSignals: ForensicsFusedSignal[];
  anomalies: ForensicsCalibratedAnomaly[];
  trace: ForensicsPhaseTrace[];
  createdAt: number;
}

const runMemory = new Map<string, StoredForensicsRun>();
const latestMemory = new Map<string, string>();
const runHistoryMemory = new Map<string, ForensicsRunSummary[]>();
const historyMemory = new Map<string, number[]>();
const timestampHistoryMemory = new Map<string, number[]>();
const policyMemory = new Map<string, ForensicsPolicyEntry[]>();
const topologyBaselineMemory = new Map<string, ForensicsTopologyBaselineEntry[]>();

export interface ForensicsTopologyBaselineEntry {
  domain: string;
  region: string;
  signalType: string;
  count: number;
  mean: number;
  m2: number;
  stdDev: number;
  minValue: number;
  maxValue: number;
  lastValue: number;
  lastUpdated: number;
}

function runKey(runId: string): string {
  return `forensics:run:${runId}`;
}

function latestDomainKey(domain: string): string {
  return `forensics:latest:${domain}`;
}

function historyKey(metricKey: string): string {
  return `forensics:hist:${metricKey}`;
}

function historyTimestampKey(metricKey: string): string {
  return `forensics:hist_ts:${metricKey}`;
}

function runHistoryDomainKey(domain: string): string {
  return `${RUN_HISTORY_KEY}:${domain}`;
}

function policyDomainKey(domain: string): string {
  return `${POLICY_KEY_PREFIX}:${domain}`;
}

function topologyBaselineDomainKey(domain: string): string {
  return `${TOPOLOGY_BASELINE_KEY_PREFIX}:${domain}`;
}

function normalizeFiniteNumbers(input: unknown[]): number[] {
  const values: number[] = [];
  for (const item of input) {
    if (typeof item !== 'number' || !Number.isFinite(item)) continue;
    values.push(item);
  }
  return values;
}

function parseStoredRun(value: unknown): StoredForensicsRun | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredForensicsRun>;
  const run = candidate.run as ForensicsRunMetadata | undefined;
  if (!run || typeof run !== 'object') return null;
  if (!run.runId || typeof run.runId !== 'string') return null;

  return {
    run,
    fusedSignals: Array.isArray(candidate.fusedSignals)
      ? candidate.fusedSignals as ForensicsFusedSignal[]
      : [],
    anomalies: Array.isArray(candidate.anomalies)
      ? candidate.anomalies as ForensicsCalibratedAnomaly[]
      : [],
    trace: Array.isArray(candidate.trace)
      ? candidate.trace as ForensicsPhaseTrace[]
      : [],
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
  };
}

function parseRunSummaryList(value: unknown): ForensicsRunSummary[] {
  if (!Array.isArray(value)) return [];
  const summaries: ForensicsRunSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<ForensicsRunSummary>;
    const run = candidate.run as ForensicsRunMetadata | undefined;
    if (!run || typeof run !== 'object' || !run.runId) continue;
    summaries.push({
      run,
      fusedCount: typeof candidate.fusedCount === 'number' ? candidate.fusedCount : 0,
      anomalyCount: typeof candidate.anomalyCount === 'number' ? candidate.anomalyCount : 0,
      anomalyFlaggedCount: typeof candidate.anomalyFlaggedCount === 'number' ? candidate.anomalyFlaggedCount : 0,
      maxFusedScore: typeof candidate.maxFusedScore === 'number' ? candidate.maxFusedScore : 0,
      minPValue: typeof candidate.minPValue === 'number' ? candidate.minPValue : 1,
    });
  }
  return summaries;
}

function parsePolicyEntries(value: unknown): ForensicsPolicyEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ForensicsPolicyEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<ForensicsPolicyEntry>;
    if (!candidate.domain || !candidate.stateHash || !candidate.action) continue;
    entries.push({
      domain: candidate.domain,
      stateHash: candidate.stateHash,
      action: candidate.action,
      qValue: typeof candidate.qValue === 'number' ? candidate.qValue : 0,
      visitCount: typeof candidate.visitCount === 'number' ? candidate.visitCount : 0,
      lastReward: typeof candidate.lastReward === 'number' ? candidate.lastReward : 0,
      lastUpdated: typeof candidate.lastUpdated === 'number' ? candidate.lastUpdated : Date.now(),
    });
  }
  return entries;
}

function parseTopologyBaselineEntries(value: unknown): ForensicsTopologyBaselineEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ForensicsTopologyBaselineEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<ForensicsTopologyBaselineEntry>;
    if (!candidate.domain || !candidate.region || !candidate.signalType) continue;
    entries.push({
      domain: candidate.domain,
      region: candidate.region,
      signalType: candidate.signalType,
      count: typeof candidate.count === 'number' ? candidate.count : 0,
      mean: typeof candidate.mean === 'number' ? candidate.mean : 0,
      m2: typeof candidate.m2 === 'number' ? candidate.m2 : 0,
      stdDev: typeof candidate.stdDev === 'number' ? candidate.stdDev : 0,
      minValue: typeof candidate.minValue === 'number' ? candidate.minValue : 0,
      maxValue: typeof candidate.maxValue === 'number' ? candidate.maxValue : 0,
      lastValue: typeof candidate.lastValue === 'number' ? candidate.lastValue : 0,
      lastUpdated: typeof candidate.lastUpdated === 'number' ? candidate.lastUpdated : Date.now(),
    });
  }
  return entries;
}

function toRunSummary(record: StoredForensicsRun): ForensicsRunSummary {
  const fusedCount = record.fusedSignals.length;
  const anomalyCount = record.anomalies.length;
  const anomalyFlaggedCount = record.anomalies.reduce((count, anomaly) => count + (anomaly.isAnomaly ? 1 : 0), 0);
  const maxFusedScore = record.fusedSignals.reduce((max, fused) => Math.max(max, fused.score), 0);
  const minPValue = record.anomalies.reduce((min, anomaly) => Math.min(min, anomaly.pValue), 1);
  return {
    run: record.run,
    fusedCount,
    anomalyCount,
    anomalyFlaggedCount,
    maxFusedScore: Math.round(maxFusedScore * 100) / 100,
    minPValue: Math.round(minPValue * 1_000_000) / 1_000_000,
  };
}

function upsertRunSummary(
  existing: ForensicsRunSummary[],
  summary: ForensicsRunSummary,
): ForensicsRunSummary[] {
  const runId = summary.run?.runId;
  const next = existing.filter((item) => item.run?.runId !== runId);
  next.unshift(summary);
  if (next.length > RUN_HISTORY_MAX_LENGTH) {
    next.length = RUN_HISTORY_MAX_LENGTH;
  }
  return next;
}

async function getRunSummaryHistory(scope: string): Promise<ForensicsRunSummary[]> {
  const inMemory = runHistoryMemory.get(scope);
  if (inMemory) return [...inMemory];

  const key = scope === '*' ? RUN_HISTORY_KEY : runHistoryDomainKey(scope);
  const cached = parseRunSummaryList(await getCachedJson(key));
  if (cached.length === 0) return [];
  runHistoryMemory.set(scope, cached);
  return [...cached];
}

async function getPolicyHistory(scope: string): Promise<ForensicsPolicyEntry[]> {
  const inMemory = policyMemory.get(scope);
  if (inMemory) return [...inMemory];

  const cached = parsePolicyEntries(await getCachedJson(policyDomainKey(scope)));
  if (cached.length === 0) return [];
  policyMemory.set(scope, cached);
  return [...cached];
}

async function getTopologyBaselineHistory(scope: string): Promise<ForensicsTopologyBaselineEntry[]> {
  const inMemory = topologyBaselineMemory.get(scope);
  if (inMemory) return [...inMemory];

  const cached = parseTopologyBaselineEntries(await getCachedJson(topologyBaselineDomainKey(scope)));
  if (cached.length === 0) return [];
  topologyBaselineMemory.set(scope, cached);
  return [...cached];
}

export async function saveForensicsRun(record: StoredForensicsRun): Promise<void> {
  const runId = record.run.runId;
  const domain = record.run.domain || 'unknown';
  const summary = toRunSummary(record);

  const domainHistory = upsertRunSummary(await getRunSummaryHistory(domain), summary);
  const globalHistory = upsertRunSummary(await getRunSummaryHistory('*'), summary);
  runHistoryMemory.set(domain, domainHistory);
  runHistoryMemory.set('*', globalHistory);

  runMemory.set(runId, record);
  latestMemory.set(domain, runId);
  latestMemory.set('*', runId);

  await Promise.all([
    setCachedJson(runKey(runId), record, RUN_TTL_SECONDS),
    setCachedJson(latestDomainKey(domain), runId, RUN_TTL_SECONDS),
    setCachedJson(LATEST_KEY, runId, RUN_TTL_SECONDS),
    setCachedJson(runHistoryDomainKey(domain), domainHistory, RUN_HISTORY_TTL_SECONDS),
    setCachedJson(RUN_HISTORY_KEY, globalHistory, RUN_HISTORY_TTL_SECONDS),
  ]);
}

export async function getForensicsRunRecord(runId: string): Promise<StoredForensicsRun | null> {
  const inMemory = runMemory.get(runId);
  if (inMemory) return inMemory;

  const cached = parseStoredRun(await getCachedJson(runKey(runId)));
  if (cached) {
    runMemory.set(runId, cached);
    latestMemory.set(cached.run.domain || 'unknown', runId);
    latestMemory.set('*', runId);
  }
  return cached;
}

export async function getLatestForensicsRunRecord(domain?: string): Promise<StoredForensicsRun | null> {
  const key = domain && domain.trim() ? domain.trim() : '*';
  const inMemoryRunId = latestMemory.get(key);
  if (inMemoryRunId) return getForensicsRunRecord(inMemoryRunId);

  const redisKey = key === '*' ? LATEST_KEY : latestDomainKey(key);
  const cachedRunId = await getCachedJson(redisKey);
  if (typeof cachedRunId !== 'string' || !cachedRunId) return null;

  latestMemory.set(key, cachedRunId);
  return getForensicsRunRecord(cachedRunId);
}

export async function getCalibrationHistory(metricKeyValue: string): Promise<number[]> {
  const inMemory = historyMemory.get(metricKeyValue);
  if (inMemory) return [...inMemory];

  const cached = await getCachedJson(historyKey(metricKeyValue));
  if (!Array.isArray(cached)) return [];

  const normalized = normalizeFiniteNumbers(cached);
  if (normalized.length === 0) return [];
  historyMemory.set(metricKeyValue, normalized);
  return [...normalized];
}

export async function getCalibrationTimestampHistory(metricKeyValue: string): Promise<number[]> {
  const inMemory = timestampHistoryMemory.get(metricKeyValue);
  if (inMemory) return [...inMemory];

  const cached = await getCachedJson(historyTimestampKey(metricKeyValue));
  if (!Array.isArray(cached)) return [];

  const normalized = normalizeFiniteNumbers(cached);
  if (normalized.length === 0) return [];
  timestampHistoryMemory.set(metricKeyValue, normalized);
  return [...normalized];
}

export async function appendCalibrationValue(metricKeyValue: string, value: number): Promise<number[]> {
  if (!Number.isFinite(value)) {
    return getCalibrationHistory(metricKeyValue);
  }

  const history = await getCalibrationHistory(metricKeyValue);
  history.push(value);
  if (history.length > HISTORY_MAX_LENGTH) {
    history.splice(0, history.length - HISTORY_MAX_LENGTH);
  }
  historyMemory.set(metricKeyValue, history);
  await setCachedJson(historyKey(metricKeyValue), history, HISTORY_TTL_SECONDS);
  return [...history];
}

export async function appendCalibrationTimestamp(metricKeyValue: string, observedAt: number): Promise<number[]> {
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    return getCalibrationTimestampHistory(metricKeyValue);
  }

  const history = await getCalibrationTimestampHistory(metricKeyValue);
  history.push(observedAt);
  if (history.length > HISTORY_MAX_LENGTH) {
    history.splice(0, history.length - HISTORY_MAX_LENGTH);
  }
  timestampHistoryMemory.set(metricKeyValue, history);
  await setCachedJson(historyTimestampKey(metricKeyValue), history, HISTORY_TTL_SECONDS);
  return [...history];
}

export async function upsertForensicsPolicyEntry(entry: ForensicsPolicyEntry): Promise<void> {
  const domain = entry.domain?.trim() || 'infrastructure';
  const stateHash = entry.stateHash?.trim();
  const action = entry.action?.trim();
  if (!stateHash || !action) return;

  const nextEntry: ForensicsPolicyEntry = {
    domain,
    stateHash,
    action,
    qValue: Number.isFinite(entry.qValue) ? entry.qValue : 0,
    visitCount: entry.visitCount > 0 ? entry.visitCount : 0,
    lastReward: Number.isFinite(entry.lastReward) ? entry.lastReward : 0,
    lastUpdated: entry.lastUpdated > 0 ? entry.lastUpdated : Date.now(),
  };

  const existing = await getPolicyHistory(domain);
  const updated = existing.filter(
    (item) => !(item.stateHash === nextEntry.stateHash && item.action === nextEntry.action),
  );
  updated.unshift(nextEntry);
  updated.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
  if (updated.length > POLICY_MAX_ROWS_PER_DOMAIN) {
    updated.length = POLICY_MAX_ROWS_PER_DOMAIN;
  }

  policyMemory.set(domain, updated);
  await setCachedJson(policyDomainKey(domain), updated, POLICY_TTL_SECONDS);
}

export async function upsertTopologyBaselineEntry(entry: ForensicsTopologyBaselineEntry): Promise<void> {
  const domain = entry.domain?.trim() || 'market';
  const region = entry.region?.trim() || 'global';
  const signalType = entry.signalType?.trim();
  if (!signalType) return;

  const nextEntry: ForensicsTopologyBaselineEntry = {
    domain,
    region,
    signalType,
    count: entry.count > 0 ? entry.count : 0,
    mean: Number.isFinite(entry.mean) ? entry.mean : 0,
    m2: Number.isFinite(entry.m2) ? entry.m2 : 0,
    stdDev: Number.isFinite(entry.stdDev) ? entry.stdDev : 0,
    minValue: Number.isFinite(entry.minValue) ? entry.minValue : 0,
    maxValue: Number.isFinite(entry.maxValue) ? entry.maxValue : 0,
    lastValue: Number.isFinite(entry.lastValue) ? entry.lastValue : 0,
    lastUpdated: entry.lastUpdated > 0 ? entry.lastUpdated : Date.now(),
  };

  const existing = await getTopologyBaselineHistory(domain);
  const updated = existing.filter(
    (item) => !(item.region === nextEntry.region && item.signalType === nextEntry.signalType),
  );
  updated.unshift(nextEntry);
  updated.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
  if (updated.length > TOPOLOGY_BASELINE_MAX_ROWS_PER_DOMAIN) {
    updated.length = TOPOLOGY_BASELINE_MAX_ROWS_PER_DOMAIN;
  }

  topologyBaselineMemory.set(domain, updated);
  await setCachedJson(topologyBaselineDomainKey(domain), updated, TOPOLOGY_BASELINE_TTL_SECONDS);
}

export async function getTopologyBaselineEntry(
  domain: string,
  region: string,
  signalType: string,
): Promise<ForensicsTopologyBaselineEntry | null> {
  const scope = domain?.trim() || 'market';
  const normalizedRegion = region?.trim() || 'global';
  const normalizedType = signalType?.trim();
  if (!normalizedType) return null;

  const rows = await getTopologyBaselineHistory(scope);
  return rows.find((row) =>
    row.region === normalizedRegion && row.signalType === normalizedType,
  ) || null;
}

interface ListTopologyBaselineOptions {
  domain?: string;
  region?: string;
  signalType?: string;
  limit?: number;
}

export async function listTopologyBaselineEntries(
  options: ListTopologyBaselineOptions = {},
): Promise<ForensicsTopologyBaselineEntry[]> {
  const domain = options.domain?.trim() || 'market';
  let rows = await getTopologyBaselineHistory(domain);

  const region = options.region?.trim();
  if (region) {
    rows = rows.filter((row) => row.region === region);
  }
  const signalType = options.signalType?.trim();
  if (signalType) {
    rows = rows.filter((row) => row.signalType === signalType);
  }

  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100;
  return rows.slice(0, limit);
}

interface ListForensicsPolicyOptions {
  domain?: string;
  stateHash?: string;
  limit?: number;
}

export async function listForensicsPolicyEntries(
  options: ListForensicsPolicyOptions = {},
): Promise<ForensicsPolicyEntry[]> {
  const domain = options.domain?.trim() || 'infrastructure';
  let entries = await getPolicyHistory(domain);

  const stateHash = options.stateHash?.trim();
  if (stateHash) {
    entries = entries.filter((entry) => entry.stateHash === stateHash);
  }

  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100;
  return entries.slice(0, limit);
}

interface ListForensicsRunsOptions {
  domain?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listForensicsRunSummaries(
  options: ListForensicsRunsOptions = {},
): Promise<ForensicsRunSummary[]> {
  const scope = options.domain?.trim() || '*';
  let runs = await getRunSummaryHistory(scope);

  const status = options.status?.trim().toLowerCase();
  if (status) {
    runs = runs.filter((item) => (item.run?.status || '').toLowerCase() === status);
  }

  const offset = options.offset && options.offset > 0 ? options.offset : 0;
  const limit = options.limit && options.limit > 0
    ? Math.min(options.limit, 500)
    : 100;

  if (offset > 0) runs = runs.slice(offset);
  return runs.slice(0, limit);
}

export type { StoredForensicsRun };
