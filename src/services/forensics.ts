import {
  IntelligenceServiceClient,
  type ForensicsSignalInput,
  type ForensicsFusedSignal,
  type ForensicsCalibratedAnomaly,
  type ForensicsPhaseTrace,
  type ForensicsRunMetadata,
  type ForensicsRunSummary,
  type ForensicsPolicyEntry,
  type ForensicsTopologyMetricSeries,
  type ForensicsTopologyBaselineSummary,
} from '@/generated/client/worldmonitor/intelligence/v1/service_client';

const client = new IntelligenceServiceClient('', { fetch: fetch.bind(globalThis) });

export interface ForensicsShadowResult {
  run?: ForensicsRunMetadata;
  fusedSignals: ForensicsFusedSignal[];
  anomalies: ForensicsCalibratedAnomaly[];
  trace: ForensicsPhaseTrace[];
  error: string;
}

export async function runForensicsShadow(
  domain: string,
  signals: ForensicsSignalInput[],
  alpha = 0.05,
): Promise<ForensicsShadowResult> {
  try {
    return await client.runForensicsShadow({
      domain,
      signals,
      alpha,
      persist: true,
      evidenceIds: [],
    });
  } catch (error) {
    return {
      run: undefined,
      fusedSignals: [],
      anomalies: [],
      trace: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listFusedSignals(
  runId = '',
  domain = '',
  limit = 100,
  options: {
    region?: string;
    minScore?: number;
    minProbability?: number;
  } = {},
): Promise<{ run?: ForensicsRunMetadata; signals: ForensicsFusedSignal[]; error: string }> {
  try {
    return await client.listFusedSignals({
      runId,
      domain,
      limit,
      region: options.region || '',
      minScore: options.minScore ?? 0,
      minProbability: options.minProbability ?? 0,
    });
  } catch (error) {
    return {
      run: undefined,
      signals: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listCalibratedAnomalies(
  runId = '',
  domain = '',
  anomaliesOnly = true,
  limit = 100,
  options: {
    signalType?: string;
    region?: string;
    maxPValue?: number;
    minAbsLegacyZScore?: number;
  } = {},
): Promise<{ run?: ForensicsRunMetadata; anomalies: ForensicsCalibratedAnomaly[]; error: string }> {
  try {
    return await client.listCalibratedAnomalies({
      runId,
      domain,
      anomaliesOnly,
      limit,
      signalType: options.signalType || '',
      region: options.region || '',
      maxPValue: options.maxPValue ?? 0,
      minAbsLegacyZScore: options.minAbsLegacyZScore ?? 0,
    });
  } catch (error) {
    return {
      run: undefined,
      anomalies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listTopologyAlerts(
  runId = '',
  domain = '',
  limit = 50,
  options: {
    region?: string;
    anomaliesOnly?: boolean;
    maxPValue?: number;
  } = {},
): Promise<{ run?: ForensicsRunMetadata; anomalies: ForensicsCalibratedAnomaly[]; error: string }> {
  return listCalibratedAnomalies(
    runId,
    domain,
    options.anomaliesOnly ?? true,
    limit,
    {
      signalType: 'topology_*',
      region: options.region,
      maxPValue: options.maxPValue,
    },
  );
}

export async function getForensicsTopologySummary(
  runId = '',
  domain = '',
  options: {
    anomaliesOnly?: boolean;
    alertLimit?: number;
    historyLimit?: number;
    baselineLimit?: number;
  } = {},
): Promise<{
  run?: ForensicsRunMetadata;
  alerts: ForensicsCalibratedAnomaly[];
  trends: ForensicsTopologyMetricSeries[];
  baselines: ForensicsTopologyBaselineSummary[];
  error: string;
}> {
  try {
    return await client.getForensicsTopologySummary({
      runId,
      domain,
      anomaliesOnly: options.anomaliesOnly ?? true,
      alertLimit: options.alertLimit ?? 0,
      historyLimit: options.historyLimit ?? 0,
      baselineLimit: options.baselineLimit ?? 0,
    });
  } catch (error) {
    return {
      run: undefined,
      alerts: [],
      trends: [],
      baselines: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getForensicsTrace(
  runId: string,
): Promise<{ run?: ForensicsRunMetadata; trace: ForensicsPhaseTrace[]; error: string }> {
  try {
    return await client.getForensicsTrace({ runId });
  } catch (error) {
    return {
      run: undefined,
      trace: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getForensicsRun(
  runId: string,
): Promise<{ run?: ForensicsRunMetadata; fusedCount: number; anomalyCount: number; error: string }> {
  try {
    return await client.getForensicsRun({ runId });
  } catch (error) {
    return {
      run: undefined,
      fusedCount: 0,
      anomalyCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listForensicsRuns(
  domain = '',
  status = '',
  limit = 50,
  offset = 0,
): Promise<{
  runs: ForensicsRunSummary[];
  error: string;
}> {
  try {
    return await client.listForensicsRuns({ domain, status, limit, offset });
  } catch (error) {
    return {
      runs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getForensicsPolicy(
  domain = 'infrastructure',
  stateHash = '',
  limit = 100,
): Promise<{
  entries: ForensicsPolicyEntry[];
  error: string;
}> {
  try {
    return await client.getForensicsPolicy({ domain, stateHash, limit });
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
