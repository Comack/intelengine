import type {
  ListCalibratedAnomaliesRequest,
  ListCalibratedAnomaliesResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import {
  getForensicsRunRecord,
  getLatestForensicsRunRecord,
} from './forensics-blackboard';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function listCalibratedAnomalies(
  _ctx: ServerContext,
  req: ListCalibratedAnomaliesRequest,
): Promise<ListCalibratedAnomaliesResponse> {
  const record = req.runId
    ? await getForensicsRunRecord(req.runId)
    : await getLatestForensicsRunRecord(req.domain);

  if (!record) {
    return {
      run: undefined,
      anomalies: [],
      error: 'Forensics run not found',
    };
  }

  let anomalies = [...record.anomalies];
  const domain = req.domain?.trim();
  if (domain) {
    anomalies = anomalies.filter((anomaly) => anomaly.domain === domain);
  }
  const signalType = req.signalType?.trim();
  if (signalType) {
    if (signalType.endsWith('*')) {
      const prefix = signalType.slice(0, -1);
      anomalies = anomalies.filter((anomaly) => anomaly.signalType.startsWith(prefix));
    } else if (signalType === 'topology') {
      anomalies = anomalies.filter((anomaly) => anomaly.signalType.startsWith('topology_'));
    } else {
      anomalies = anomalies.filter((anomaly) => anomaly.signalType === signalType);
    }
  }
  const region = req.region?.trim();
  if (region) {
    anomalies = anomalies.filter((anomaly) => anomaly.region === region);
  }
  if (req.anomaliesOnly) {
    anomalies = anomalies.filter((anomaly) => anomaly.isAnomaly);
  }
  if (req.maxPValue > 0) {
    anomalies = anomalies.filter((anomaly) => anomaly.pValue <= req.maxPValue);
  }
  if (req.minAbsLegacyZScore > 0) {
    anomalies = anomalies.filter((anomaly) => Math.abs(anomaly.legacyZScore) >= req.minAbsLegacyZScore);
  }

  const limit = req.limit > 0 ? Math.min(req.limit, MAX_LIMIT) : DEFAULT_LIMIT;
  anomalies = anomalies.slice(0, limit);

  return {
    run: record.run,
    anomalies,
    error: '',
  };
}
