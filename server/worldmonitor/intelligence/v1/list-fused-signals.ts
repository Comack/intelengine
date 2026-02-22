import type {
  ListFusedSignalsRequest,
  ListFusedSignalsResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import {
  getForensicsRunRecord,
  getLatestForensicsRunRecord,
} from './forensics-blackboard';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function listFusedSignals(
  _ctx: ServerContext,
  req: ListFusedSignalsRequest,
): Promise<ListFusedSignalsResponse> {
  const record = req.runId
    ? await getForensicsRunRecord(req.runId)
    : await getLatestForensicsRunRecord(req.domain);

  if (!record) {
    return {
      run: undefined,
      signals: [],
      error: 'Forensics run not found',
    };
  }

  let signals = [...record.fusedSignals];
  const domain = req.domain?.trim();
  if (domain) {
    signals = signals.filter((signal) => signal.domain === domain);
  }
  const region = req.region?.trim();
  if (region) {
    signals = signals.filter((signal) => signal.region === region);
  }
  if (req.minScore > 0) {
    signals = signals.filter((signal) => signal.score >= req.minScore);
  }
  if (req.minProbability > 0) {
    signals = signals.filter((signal) => signal.probability >= req.minProbability);
  }

  const limit = req.limit > 0 ? Math.min(req.limit, MAX_LIMIT) : DEFAULT_LIMIT;
  signals = signals.slice(0, limit);

  return {
    run: record.run,
    signals,
    error: '',
  };
}
