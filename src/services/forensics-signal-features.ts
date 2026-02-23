export interface FreshnessProfile {
  penaltyAfterMs: number;
  skipAfterMs: number;
  maxPenalty: number;
}

export interface FreshnessPenaltyResult {
  ageMs: number;
  penalty: number;
  isStale: boolean;
}

export const FAST_FRESHNESS_PROFILE: FreshnessProfile = {
  penaltyAfterMs: 30 * 60 * 1000,
  skipAfterMs: 90 * 60 * 1000,
  maxPenalty: 0.22,
};

export const SLOW_FRESHNESS_PROFILE: FreshnessProfile = {
  penaltyAfterMs: 24 * 60 * 60 * 1000,
  skipAfterMs: 7 * 24 * 60 * 60 * 1000,
  maxPenalty: 0.2,
};

export const CONFLICT_FRESHNESS_PROFILE: FreshnessProfile = {
  penaltyAfterMs: 6 * 60 * 60 * 1000,
  skipAfterMs: 48 * 60 * 60 * 1000,
  maxPenalty: 0.24,
};

export const EVENT_FRESHNESS_PROFILE: FreshnessProfile = {
  penaltyAfterMs: 2 * 60 * 60 * 1000,
  skipAfterMs: 24 * 60 * 60 * 1000,
  maxPenalty: 0.22,
};

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) && ts > 0 ? Math.round(ts) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }
  return null;
}

export function logScale1p(value: number, multiplier = 1): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.log1p(value) * multiplier;
}

export function bucketSignalTimestamp(observedAtMs: number, bucketMs = 5 * 60 * 1000): number {
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) return 0;
  const safeBucket = Math.max(1, Math.round(bucketMs));
  return Math.floor(observedAtMs / safeBucket) * safeBucket;
}

export function bucketSignalValue(value: number, bucketSize = 0.1): number {
  if (!Number.isFinite(value)) return 0;
  const safeBucket = Math.max(0.0001, Math.abs(bucketSize));
  return Math.round(value / safeBucket) * safeBucket;
}

export function computeFreshnessPenalty(
  observedAtMs: number,
  profile: FreshnessProfile,
  nowMs = Date.now(),
): FreshnessPenaltyResult {
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) {
    return { ageMs: Number.POSITIVE_INFINITY, penalty: profile.maxPenalty, isStale: true };
  }
  const ageMs = Math.max(0, nowMs - observedAtMs);
  if (ageMs >= profile.skipAfterMs) {
    return { ageMs, penalty: profile.maxPenalty, isStale: true };
  }
  if (ageMs <= profile.penaltyAfterMs) {
    return { ageMs, penalty: 0, isStale: false };
  }
  const span = Math.max(1, profile.skipAfterMs - profile.penaltyAfterMs);
  const ratio = (ageMs - profile.penaltyAfterMs) / span;
  return {
    ageMs,
    penalty: clampNumber(ratio * profile.maxPenalty, 0, profile.maxPenalty),
    isStale: false,
  };
}

export function computeSignalConfidence(
  base: number,
  magnitudeBonus: number,
  freshnessPenalty: number,
): number {
  return clampNumber(base + magnitudeBonus - freshnessPenalty, 0.52, 0.95);
}
