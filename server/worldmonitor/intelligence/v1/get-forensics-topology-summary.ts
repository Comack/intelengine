import type {
  ForensicsCalibratedAnomaly,
  ForensicsTopologyMetricPoint,
  ForensicsTopologyMetricSeries,
  ForensicsTopologyBaselineSummary,
  GetForensicsTopologySummaryRequest,
  GetForensicsTopologySummaryResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import {
  getForensicsRunRecord,
  getLatestForensicsRunRecord,
  listForensicsRunSummaries,
  listTopologyBaselineEntries,
} from './forensics-blackboard';

const DEFAULT_ALERT_LIMIT = 12;
const DEFAULT_HISTORY_LIMIT = 8;
const DEFAULT_BASELINE_LIMIT = 24;
const MAX_ALERT_LIMIT = 500;
const MAX_HISTORY_LIMIT = 120;
const MAX_BASELINE_LIMIT = 500;

function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isTopologySignal(signalType: string): boolean {
  return signalType.startsWith('topology_');
}

function pickMetricAnomaly(
  anomalies: ForensicsCalibratedAnomaly[],
  metric: string,
): ForensicsCalibratedAnomaly | undefined {
  if (metric === 'topology_cycle_risk') {
    return anomalies
      .filter((anomaly) => anomaly.signalType === metric)
      .sort((a, b) => b.value - a.value)[0];
  }
  return anomalies.find((anomaly) => anomaly.signalType === metric);
}

export async function getForensicsTopologySummary(
  _ctx: ServerContext,
  req: GetForensicsTopologySummaryRequest,
): Promise<GetForensicsTopologySummaryResponse> {
  const record = req.runId
    ? await getForensicsRunRecord(req.runId)
    : await getLatestForensicsRunRecord(req.domain);

  if (!record) {
    return {
      run: undefined,
      alerts: [],
      trends: [],
      baselines: [],
      error: 'Forensics run not found',
    };
  }

  const targetDomain = req.domain?.trim() || record.run.domain || 'market';
  const alertLimit = clampInt(req.alertLimit, DEFAULT_ALERT_LIMIT, 1, MAX_ALERT_LIMIT);
  const historyLimit = clampInt(req.historyLimit, DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);
  const baselineLimit = clampInt(req.baselineLimit, DEFAULT_BASELINE_LIMIT, 1, MAX_BASELINE_LIMIT);
  const anomaliesOnly = req.anomaliesOnly !== false;

  let alerts = record.anomalies
    .filter((anomaly) => isTopologySignal(anomaly.signalType));
  if (anomaliesOnly) {
    alerts = alerts.filter((anomaly) => anomaly.isAnomaly);
  }
  alerts = alerts
    .sort((a, b) =>
      (a.pValue - b.pValue)
      || (Math.abs(b.value) - Math.abs(a.value))
      || (Math.abs(b.legacyZScore) - Math.abs(a.legacyZScore)),
    )
    .slice(0, alertLimit);

  const summaries = await listForensicsRunSummaries({
    domain: targetDomain,
    limit: historyLimit,
    offset: 0,
  });
  const trendRunIds: string[] = [];
  const seen = new Set<string>();
  if (record.run.runId) {
    trendRunIds.push(record.run.runId);
    seen.add(record.run.runId);
  }
  for (const summary of summaries) {
    const runId = summary.run?.runId;
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    trendRunIds.push(runId);
    if (trendRunIds.length >= historyLimit) break;
  }

  const trendRecords = await Promise.all(
    trendRunIds.map((runId) => getForensicsRunRecord(runId)),
  );

  const trendDefinitions: Array<{ metric: string; label: string }> = [
    { metric: 'topology_tsi', label: 'Topology Stability Index' },
    { metric: 'topology_beta1', label: 'Topological beta1' },
    { metric: 'topology_cycle_risk', label: 'Max cycle risk' },
  ];

  const trends: ForensicsTopologyMetricSeries[] = [];
  for (const definition of trendDefinitions) {
    const points: ForensicsTopologyMetricPoint[] = [];
    for (const trendRecord of trendRecords) {
      if (!trendRecord) continue;
      const match = pickMetricAnomaly(
        trendRecord.anomalies.filter((anomaly) => isTopologySignal(anomaly.signalType)),
        definition.metric,
      );
      if (!match) continue;
      points.push({
        runId: trendRecord.run.runId,
        completedAt: trendRecord.run.completedAt || trendRecord.run.startedAt || 0,
        value: match.value,
        region: match.region || 'global',
      });
    }
    points.sort((a, b) => a.completedAt - b.completedAt);
    if (points.length > 0) {
      trends.push({
        metric: definition.metric,
        label: definition.label,
        points,
      });
    }
  }

  const baselines: ForensicsTopologyBaselineSummary[] = (await listTopologyBaselineEntries({
    domain: targetDomain,
    limit: baselineLimit,
  }))
    .map((baseline) => ({
      domain: baseline.domain,
      region: baseline.region,
      signalType: baseline.signalType,
      count: baseline.count,
      mean: baseline.mean,
      stdDev: baseline.stdDev,
      minValue: baseline.minValue,
      maxValue: baseline.maxValue,
      lastValue: baseline.lastValue,
      lastUpdated: baseline.lastUpdated,
    }));

  return {
    run: record.run,
    alerts,
    trends,
    baselines,
    error: '',
  };
}
