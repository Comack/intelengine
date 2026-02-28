/**
 * Pure-JS port of the forensics computation functions from
 * server/worldmonitor/intelligence/v1/forensics-orchestrator.ts
 *
 * Eliminates the external Python/NumPy microservice dependency.
 * The sidecar exposes /internal/forensics/v1/fuse and /anomaly endpoints
 * that callWorker() in the orchestrator will route to automatically via
 * FORENSICS_WORKER_URL=http://127.0.0.1:46123.
 *
 * Calibration history is stored in-memory (within sidecar session). This
 * provides conformal p-value accuracy that improves as the session runs.
 */

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function sigmoid(x) {
  if (x < -30) return 0;
  if (x > 30) return 1;
  return 1 / (1 + Math.exp(-x));
}

function percentile(values, p) {
  if (values.length === 0) return 0;  // threshold 0 → all positive values qualify as "active"
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.floor(((p / 100) * (sorted.length - 1)))));
  return sorted[position] ?? sorted[sorted.length - 1] ?? Number.POSITIVE_INFINITY;
}

function median(values) {
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

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values, avg) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + ((v - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeIntervals(timestamps) {
  if (timestamps.length < 2) return [];
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    const delta = (timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0);
    if (delta > 0 && Number.isFinite(delta)) intervals.push(delta);
  }
  return intervals;
}

function severityFromPValue(pValue, alpha, isAnomaly) {
  if (!isAnomaly) return 'SEVERITY_LEVEL_UNSPECIFIED';
  if (pValue <= alpha / 5) return 'SEVERITY_LEVEL_HIGH';
  if (pValue <= alpha / 2) return 'SEVERITY_LEVEL_MEDIUM';
  return 'SEVERITY_LEVEL_LOW';
}

export function createForensicsWorker() {
  // In-memory calibration store: metricKey → { values: number[], timestamps: number[] }
  const calibrationStore = new Map();

  function getCalibration(metricKey) {
    if (!calibrationStore.has(metricKey)) {
      calibrationStore.set(metricKey, { values: [], timestamps: [] });
    }
    return calibrationStore.get(metricKey);
  }

  return {
    /**
     * Weak supervision fusion via Snorkel-style EM algorithm.
     * Port of runWeakSupervisionFusion() — no external dependencies.
     */
    runWeakSupervisionFusion(signals, feedbackMap = new Map()) {
      if (signals.length === 0) {
        return { fusedSignals: [], learnedWeights: new Map(), learnedAccuracies: new Map(), classPrior: 0.5 };
      }

      const sourceIds = Array.from(new Set(signals.map((s) => s.sourceId)));
      const signalTypes = Array.from(new Set(signals.map((s) => s.signalType)));
      const sourceIndex = new Map(sourceIds.map((id, i) => [id, i]));
      const typeIndex = new Map(signalTypes.map((t, i) => [t, i]));

      const valueMatrix = Array.from({ length: sourceIds.length }, () =>
        Array.from({ length: signalTypes.length }, () => 0),
      );
      const domainBySource = new Map();
      const regionBySource = new Map();
      const evidenceIdsBySource = new Map();

      for (const signal of signals) {
        const i = sourceIndex.get(signal.sourceId);
        const j = typeIndex.get(signal.signalType);
        if (i === undefined || j === undefined) continue;
        valueMatrix[i][j] = (valueMatrix[i][j] ?? 0) + signal.value;
        if (!domainBySource.has(signal.sourceId)) domainBySource.set(signal.sourceId, signal.domain || 'infrastructure');
        if (!regionBySource.has(signal.sourceId)) regionBySource.set(signal.sourceId, signal.region || 'global');
        if (signal.evidenceIds && signal.evidenceIds.length > 0) {
          if (!evidenceIdsBySource.has(signal.sourceId)) evidenceIdsBySource.set(signal.sourceId, new Set());
          for (const id of signal.evidenceIds) evidenceIdsBySource.get(signal.sourceId).add(id);
        }
      }

      const thresholds = signalTypes.map((_, j) => {
        const positives = valueMatrix.map((row) => row[j] ?? 0).filter((v) => v > 0);
        return percentile(positives, 70);
      });

      const labelMatrix = valueMatrix.map((row) => row.map((value, j) => {
        if (!Number.isFinite(value) || value <= 0) return 0;
        const threshold = thresholds[j] ?? Number.POSITIVE_INFINITY;
        return value >= threshold ? 1 : -1;
      }));

      const normalizedValues = signalTypes.map((_, j) => {
        const positives = valueMatrix.map((row) => row[j] ?? 0).filter((v) => v > 0);
        const min = positives.length > 0 ? Math.min(...positives) : 0;
        const max = positives.length > 0 ? Math.max(...positives) : 0;
        return { min, max };
      });

      const propensities = signalTypes.map((_, j) => {
        const active = labelMatrix.reduce((count, row) => count + ((row[j] ?? 0) === 0 ? 0 : 1), 0);
        return sourceIds.length > 0 ? active / sourceIds.length : 0;
      });

      const dependencyPenalty = signalTypes.map(() => 0);
      for (let j = 0; j < signalTypes.length; j++) {
        let weightedCorrelation = 0;
        let totalOverlap = 0;
        for (let k = 0; k < signalTypes.length; k++) {
          if (j === k) continue;
          let overlap = 0, sumJ = 0, sumK = 0, sumJJ = 0, sumKK = 0, sumJK = 0;
          for (let i = 0; i < sourceIds.length; i++) {
            const lj = labelMatrix[i]?.[j] ?? 0;
            const lk = labelMatrix[i]?.[k] ?? 0;
            if (lj === 0 || lk === 0) continue;
            overlap++;
            sumJ += lj; sumK += lk; sumJJ += lj * lj; sumKK += lk * lk; sumJK += lj * lk;
          }
          if (overlap < 6) continue;
          const meanJ = sumJ / overlap, meanK = sumK / overlap;
          const varJ = (sumJJ / overlap) - (meanJ * meanJ);
          const varK = (sumKK / overlap) - (meanK * meanK);
          if (varJ <= 1e-9 || varK <= 1e-9) continue;
          const cov = (sumJK / overlap) - (meanJ * meanK);
          const corr = cov / Math.sqrt(varJ * varK);
          weightedCorrelation += clamp(corr, 0, 1) * overlap;
          totalOverlap += overlap;
        }
        dependencyPenalty[j] = totalOverlap > 0 ? clamp(weightedCorrelation / totalOverlap, 0, 0.95) : 0;
      }

      let accuracies = signalTypes.map(() => 0.7);
      let classPrior = 0.5;
      for (let iter = 0; iter < 80; iter++) {
        const previous = [...accuracies];
        const previousPrior = classPrior;
        const softLabels = labelMatrix.map((labels, i) => {
          const sourceId = sourceIds[i];
          for (let j = 0; j < labels.length; j++) {
            if (labels[j] !== 0) {
              const feedback = feedbackMap.get(`${sourceId}:${signalTypes[j]}`);
              if (feedback !== undefined) return feedback ? 1.0 : 0.0;
            }
          }
          let logit = Math.log(Math.max(1e-6, classPrior) / Math.max(1e-6, 1 - classPrior));
          labels.forEach((label, j) => {
            if (label === 0) return;
            const a = clamp(accuracies[j] ?? 0.7, 0.501, 0.999);
            const propensity = propensities[j] ?? 0;
            const independence = 1 - (0.7 * (dependencyPenalty[j] ?? 0));
            const voteScale = clamp(independence * (0.4 + (0.6 * propensity)), 0.15, 1);
            logit += label > 0 ? Math.log(a / (1 - a)) * voteScale : -Math.log(a / (1 - a)) * voteScale;
          });
          return sigmoid(logit);
        });

        classPrior = clamp(mean(softLabels), 0.05, 0.95);
        accuracies = accuracies.map((_, j) => {
          let correct = 0, total = 0;
          labelMatrix.forEach((labels, i) => {
            const label = labels[j] ?? 0;
            if (label === 0) return;
            const p = softLabels[i] ?? 0.5;
            correct += label > 0 ? p : 1 - p;
            total++;
          });
          if (total === 0) return 0.501;
          return clamp((correct + 6 * 0.55) / (total + 6), 0.501, 0.999);
        });

        const delta = accuracies.reduce((sum, v, j) => sum + Math.abs(v - (previous[j] ?? v)), 0);
        if (delta < 1e-5 && Math.abs(classPrior - previousPrior) < 1e-6) break;
      }

      const rawWeights = accuracies.map((a, j) => {
        const skill = Math.max(0.001, (a - 0.5) * 2);
        const propensity = Math.max(propensities[j] ?? 0, 0.02);
        const redundancyPenalty = Math.pow(1 - (dependencyPenalty[j] ?? 0), 0.8);
        return skill * propensity * Math.max(0.1, redundancyPenalty);
      });
      const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
      const weights = rawWeights.map((w) => totalWeight > 0 ? w / totalWeight : (signalTypes.length > 0 ? 1 / signalTypes.length : 0));

      const fusedSignals = sourceIds.map((sourceId, i) => {
        const row = valueMatrix[i] ?? [];
        const labels = labelMatrix[i] ?? [];
        let logit = Math.log(Math.max(1e-6, classPrior) / Math.max(1e-6, 1 - classPrior));
        let weightedValue = 0;
        let activeWeight = 0;
        const contributors = [];

        signalTypes.forEach((signalType, j) => {
          const label = labels[j] ?? 0;
          const a = clamp(accuracies[j] ?? 0.7, 0.501, 0.999);
          const weight = weights[j] ?? 0;
          const propensity = propensities[j] ?? 0;
          const independence = 1 - (0.7 * (dependencyPenalty[j] ?? 0));
          const voteScale = clamp(independence * (0.4 + (0.6 * propensity)), 0.15, 1);
          const value = row[j] ?? 0;
          if (label === 0) return;
          activeWeight += voteScale;
          logit += label > 0 ? Math.log(a / (1 - a)) * voteScale : -Math.log(a / (1 - a)) * voteScale;
          const { min, max } = normalizedValues[j] ?? { min: 0, max: 0 };
          const normalized = max > min ? (value - min) / (max - min) : 0.5;
          const contribution = normalized * weight * 100;
          weightedValue += contribution;
          contributors.push({ signalType, contribution: Math.round(contribution * 100) / 100, learnedWeight: Math.round(weight * 1_000_000) / 1_000_000 });
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

      fusedSignals.sort((a, b) => b.score - a.score);

      const learnedWeights = new Map(signalTypes.map((t, j) => [t, weights[j] ?? 0]));
      const learnedAccuracies = new Map(signalTypes.map((t, j) => [t, accuracies[j] ?? 0.501]));

      return { fusedSignals, learnedWeights, learnedAccuracies, classPrior };
    },

    /**
     * Conformal anomaly detection with in-memory calibration history.
     * Port of runConformalAnomalies() — uses local Map instead of Redis blackboard.
     */
    detectAnomalies(signals, alpha = 0.05) {
      const anomalies = [];

      for (const signal of signals) {
        const metricKey = `${signal.domain}:${signal.signalType}:${signal.region || 'global'}`;
        const cal = getCalibration(metricKey);
        const historyValues = cal.values;
        const historyTimestamps = cal.timestamps;

        const center = median(historyValues);
        const currentNcm = Math.abs(signal.value - center);
        const valueCalibrationScores = historyValues.map((v) => Math.abs(v - center));
        const valueGreaterOrEqual = valueCalibrationScores.reduce((count, score) => count + (score >= currentNcm ? 1 : 0), 0);
        const pValueValue = valueCalibrationScores.length > 0
          ? (valueGreaterOrEqual + 1) / (valueCalibrationScores.length + 1)
          : 1;

        const avg = mean(historyValues);
        const sd = stddev(historyValues, avg);
        const legacyZScore = sd > 1e-9 ? (signal.value - avg) / sd : 0;

        const previousTimestamp = historyTimestamps.length > 0 ? historyTimestamps[historyTimestamps.length - 1] ?? 0 : 0;
        const intervalMs = previousTimestamp > 0 && signal.observedAt > previousTimestamp ? signal.observedAt - previousTimestamp : 0;
        const intervalCalibration = computeIntervals(historyTimestamps).map((iv) => Math.log1p(iv));

        let pValueTiming = 1, timingNcm = 0;
        if (intervalCalibration.length > 0 && intervalMs > 0) {
          const intervalCenter = median(intervalCalibration);
          const currentLogInterval = Math.log1p(intervalMs);
          timingNcm = Math.abs(currentLogInterval - intervalCenter);
          const timingCalibrationScores = intervalCalibration.map((v) => Math.abs(v - intervalCenter));
          const timingGreaterOrEqual = timingCalibrationScores.reduce((count, score) => count + (score >= timingNcm ? 1 : 0), 0);
          pValueTiming = (timingGreaterOrEqual + 1) / (timingCalibrationScores.length + 1);
        }

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
          counterfactualLevers: [],
        });

        // Append to in-memory calibration history (window: last 200 values)
        cal.values.push(signal.value);
        cal.timestamps.push(signal.observedAt || Date.now());
        if (cal.values.length > 200) { cal.values.shift(); cal.timestamps.shift(); }
      }

      anomalies.sort((a, b) => a.pValue - b.pValue);
      return anomalies;
    },
  };
}
