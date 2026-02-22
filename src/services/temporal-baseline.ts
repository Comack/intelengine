// Temporal Anomaly Detection Service
// Detects when current activity levels deviate from historical baselines
// Backed by InfrastructureService RPCs (GetTemporalBaseline, RecordBaselineSnapshot)

import { InfrastructureServiceClient } from '@/generated/client/worldmonitor/infrastructure/v1/service_client';
import { IntelligenceServiceClient } from '@/generated/client/worldmonitor/intelligence/v1/service_client';

export type TemporalEventType =
  | 'military_flights'
  | 'vessels'
  | 'protests'
  | 'news'
  | 'ais_gaps'
  | 'satellite_fires';

export interface TemporalAnomaly {
  type: TemporalEventType;
  region: string;
  currentCount: number;
  expectedCount: number;
  zScore: number;
  message: string;
  severity: 'medium' | 'high' | 'critical';
}

const client = new InfrastructureServiceClient('', { fetch: fetch.bind(globalThis) });
const forensicsClient = new IntelligenceServiceClient('', { fetch: fetch.bind(globalThis) });
const USE_CALIBRATED_ANOMALIES = import.meta.env.VITE_ENABLE_CALIBRATED_ANOMALIES === 'true';

const TYPE_LABELS: Record<TemporalEventType, string> = {
  military_flights: 'Military flights',
  vessels: 'Naval vessels',
  protests: 'Protests',
  news: 'News velocity',
  ais_gaps: 'Dark ship activity',
  satellite_fires: 'Satellite fire detections',
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatAnomalyMessage(
  type: TemporalEventType,
  _region: string,
  count: number,
  mean: number,
  multiplier: number,
): string {
  const now = new Date();
  const weekday = WEEKDAY_NAMES[now.getUTCDay()];
  const month = MONTH_NAMES[now.getUTCMonth() + 1];
  const mult = multiplier < 10 ? `${multiplier.toFixed(1)}x` : `${Math.round(multiplier)}x`;
  return `${TYPE_LABELS[type]} ${mult} normal for ${weekday} (${month}) — ${count} vs baseline ${Math.round(mean)}`;
}

function getSeverity(zScore: number): 'medium' | 'high' | 'critical' {
  if (zScore >= 3.0) return 'critical';
  if (zScore >= 2.0) return 'high';
  return 'medium';
}

function getSeverityFromForensics(
  severity: 'SEVERITY_LEVEL_UNSPECIFIED' | 'SEVERITY_LEVEL_LOW' | 'SEVERITY_LEVEL_MEDIUM' | 'SEVERITY_LEVEL_HIGH',
): 'medium' | 'high' | 'critical' {
  if (severity === 'SEVERITY_LEVEL_HIGH') return 'critical';
  if (severity === 'SEVERITY_LEVEL_MEDIUM') return 'high';
  return 'medium';
}

function toTemporalEventType(signalType: string): TemporalEventType | null {
  switch (signalType) {
    case 'military_flights':
    case 'vessels':
    case 'protests':
    case 'news':
    case 'ais_gaps':
    case 'satellite_fires':
      return signalType;
    default:
      return null;
  }
}

// Fire-and-forget baseline update
export async function reportMetrics(
  updates: Array<{ type: TemporalEventType; region: string; count: number }>
): Promise<void> {
  try {
    await client.recordBaselineSnapshot({ updates });
  } catch (e) {
    console.warn('[TemporalBaseline] Update failed:', e);
  }
}

// Check for anomaly (returns null if learning or normal)
export async function checkAnomaly(
  type: TemporalEventType,
  region: string,
  count: number,
): Promise<TemporalAnomaly | null> {
  try {
    const data = await client.getTemporalBaseline({ type, region, count });
    if (!data.anomaly) return null;

    return {
      type,
      region,
      currentCount: count,
      expectedCount: Math.round(data.baseline?.mean ?? 0),
      zScore: data.anomaly.zScore,
      severity: getSeverity(data.anomaly.zScore),
      message: formatAnomalyMessage(type, region, count, data.baseline?.mean ?? 0, data.anomaly.multiplier),
    };
  } catch (e) {
    console.warn('[TemporalBaseline] Check failed:', e);
    return null;
  }
}

// Batch: report metrics AND check for anomalies in one flow
export async function updateAndCheck(
  metrics: Array<{ type: TemporalEventType; region: string; count: number }>
): Promise<TemporalAnomaly[]> {
  // Fire-and-forget the update
  reportMetrics(metrics).catch(() => {});

  // Optional calibrated anomaly path (server-side shadow forensics).
  if (USE_CALIBRATED_ANOMALIES && metrics.length > 0) {
    try {
      const signals = metrics.map((m) => ({
        sourceId: `${m.type}:${m.region || 'global'}`,
        region: m.region || 'global',
        domain: m.type === 'vessels' || m.type === 'ais_gaps' ? 'maritime' : 'infrastructure',
        signalType: m.type,
        value: m.count,
        confidence: 1,
        observedAt: Date.now(),
      }));
      const metricBySourceId = new Map(signals.map((s, i) => [s.sourceId, metrics[i]]));

      const forensics = await forensicsClient.runForensicsShadow({
        domain: 'infrastructure',
        signals,
        alpha: 0.05,
        persist: true,
      });

      const calibrated = forensics.anomalies
        .filter((a) => a.isAnomaly)
        .map((a) => {
          const mappedType = toTemporalEventType(a.signalType);
          if (!mappedType) return null;

          const metric = metricBySourceId.get(a.sourceId);
          const currentCount = metric?.count ?? Math.round(a.value);
          const region = metric?.region || a.region || 'global';
          return {
            type: mappedType,
            region,
            currentCount,
            expectedCount: currentCount,
            zScore: a.legacyZScore,
            severity: getSeverityFromForensics(a.severity),
            message: `[Calibrated] ${TYPE_LABELS[mappedType]} anomaly in ${region}: p=${a.pValue.toFixed(3)}, value=${Math.round(a.value)}`,
          } as TemporalAnomaly;
        })
        .filter((a): a is TemporalAnomaly => a !== null)
        .sort((a, b) => b.zScore - a.zScore);

      if (calibrated.length > 0) {
        return calibrated;
      }
    } catch (e) {
      console.warn('[TemporalBaseline] Calibrated anomaly path failed:', e);
    }
  }

  // Check anomalies in parallel
  const results = await Promise.allSettled(
    metrics.map(m => checkAnomaly(m.type, m.region, m.count))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TemporalAnomaly | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((a): a is TemporalAnomaly => a !== null)
    .sort((a, b) => b.zScore - a.zScore);
}
