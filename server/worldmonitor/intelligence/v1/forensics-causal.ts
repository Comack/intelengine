import type {
  ForensicsCausalEdge,
  ForensicsSignalInput,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

const BUCKET_MS = 30 * 60 * 1000;        // 30-minute buckets
const CAUSAL_LOOKBACK_BUCKETS = 8;        // look back up to 4 hours
const MIN_SUPPORT = 4;
const MIN_CAUSAL_SCORE = 0.15;
const MAX_CAUSAL_EDGES = 40;

function sigmoid(x: number): number {
  if (x < -30) return 0;
  if (x > 30) return 1;
  return 1 / (1 + Math.exp(-x));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function bucketizeActivations(
  signals: ForensicsSignalInput[],
): { activeBuckets: Map<string, Set<number>>; thresholds: Map<string, number>; bucketMin: number; bucketMax: number } {
  // Compute per-type value thresholds (70th percentile of positive values)
  const valuesByType = new Map<string, number[]>();
  for (const signal of signals) {
    if (!Number.isFinite(signal.value) || signal.value <= 0) continue;
    const type = signal.signalType;
    if (!valuesByType.has(type)) valuesByType.set(type, []);
    valuesByType.get(type)!.push(signal.value);
  }

  const thresholds = new Map<string, number>();
  for (const [type, values] of valuesByType) {
    const sorted = [...values].sort((a, b) => a - b);
    const pos = Math.floor(0.7 * (sorted.length - 1));
    thresholds.set(type, sorted[pos] ?? 0);
  }

  // Assign signals to buckets
  let bucketMin = Number.POSITIVE_INFINITY;
  let bucketMax = Number.NEGATIVE_INFINITY;
  for (const signal of signals) {
    if (!Number.isFinite(signal.observedAt) || signal.observedAt <= 0) continue;
    const b = Math.floor(signal.observedAt / BUCKET_MS);
    if (b < bucketMin) bucketMin = b;
    if (b > bucketMax) bucketMax = b;
  }
  if (!Number.isFinite(bucketMin)) bucketMin = 0;
  if (!Number.isFinite(bucketMax)) bucketMax = 0;

  const activeBuckets = new Map<string, Set<number>>();
  for (const signal of signals) {
    const type = signal.signalType;
    const threshold = thresholds.get(type) ?? 0;
    if (!Number.isFinite(signal.value) || signal.value < threshold) continue;
    if (!Number.isFinite(signal.observedAt) || signal.observedAt <= 0) continue;
    const b = Math.floor(signal.observedAt / BUCKET_MS);
    if (!activeBuckets.has(type)) activeBuckets.set(type, new Set());
    activeBuckets.get(type)!.add(b);
  }

  return { activeBuckets, thresholds, bucketMin, bucketMax };
}

function computeBaselineRates(
  activeBuckets: Map<string, Set<number>>,
  totalBuckets: number,
): Map<string, number> {
  const baselines = new Map<string, number>();
  for (const [type, buckets] of activeBuckets) {
    baselines.set(type, totalBuckets > 0 ? buckets.size / totalBuckets : 0);
  }
  return baselines;
}

function medianOffset(offsets: number[]): number {
  if (offsets.length === 0) return 0;
  const sorted = [...offsets].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function runCausalDiscovery(signals: ForensicsSignalInput[]): ForensicsCausalEdge[] {
  const signalTypes = Array.from(new Set(signals.map((s) => s.signalType)));
  if (signals.length < 8 || signalTypes.length < 3) return [];

  const { activeBuckets, bucketMin, bucketMax } = bucketizeActivations(signals);
  const totalBuckets = Math.max(1, bucketMax - bucketMin + 1);
  const baselines = computeBaselineRates(activeBuckets, totalBuckets);

  const types = Array.from(activeBuckets.keys());
  const edges: ForensicsCausalEdge[] = [];

  for (let ai = 0; ai < types.length; ai++) {
    const typeA = types[ai]!;
    const bucketsA = activeBuckets.get(typeA)!;
    for (let bi = 0; bi < types.length; bi++) {
      if (ai === bi) continue;
      const typeB = types[bi]!;
      const bucketsB = activeBuckets.get(typeB)!;
      const baselineB = baselines.get(typeB) ?? 0;
      if (baselineB < 1e-9) continue;

      // For each active bucket of A, check if B activates within lookback window
      let coActivationCount = 0;
      const offsetList: number[] = [];

      for (const bucketA of bucketsA) {
        for (let lag = 1; lag <= CAUSAL_LOOKBACK_BUCKETS; lag++) {
          if (bucketsB.has(bucketA + lag)) {
            coActivationCount++;
            offsetList.push(lag);
            break; // Count each A-bucket at most once per B direction
          }
        }
      }

      if (coActivationCount < MIN_SUPPORT) continue;

      // P(B within window | A active)
      const pBgivenA = coActivationCount / bucketsA.size;
      // Adjust baseline for the window width: P(B in any of 8 consecutive buckets)
      const adjustedBaseline = clamp(1 - Math.pow(Math.max(0, 1 - baselineB), CAUSAL_LOOKBACK_BUCKETS), 1e-9, 1);
      const conditionalLift = pBgivenA / adjustedBaseline;

      if (conditionalLift <= 1) continue;

      const mdlGain = conditionalLift * Math.log2(conditionalLift) * (coActivationCount / totalBuckets);
      const causalScore = clamp(sigmoid(mdlGain * 2 - 1), 0, 1);
      if (causalScore < MIN_CAUSAL_SCORE) continue;

      const delayMs = Math.round(medianOffset(offsetList) * BUCKET_MS);

      edges.push({
        causeSignalType: typeA,
        effectSignalType: typeB,
        causalScore: Math.round(causalScore * 1_000_000) / 1_000_000,
        delayMs,
        supportCount: coActivationCount,
        conditionalLift: Math.round(conditionalLift * 1_000_000) / 1_000_000,
      });
    }
  }

  edges.sort((a, b) => b.causalScore - a.causalScore);
  return edges.slice(0, MAX_CAUSAL_EDGES);
}
