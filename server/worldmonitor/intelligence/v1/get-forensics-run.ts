import type {
  GetForensicsRunRequest,
  GetForensicsRunResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { getForensicsRunRecord } from './forensics-blackboard';

export async function getForensicsRun(
  _ctx: ServerContext,
  req: GetForensicsRunRequest,
): Promise<GetForensicsRunResponse> {
  if (!req.runId || !req.runId.trim()) {
    return {
      run: undefined,
      fusedCount: 0,
      anomalyCount: 0,
      error: 'Missing required field: runId',
    };
  }

  const record = await getForensicsRunRecord(req.runId);
  if (!record) {
    return {
      run: undefined,
      fusedCount: 0,
      anomalyCount: 0,
      error: 'Forensics run not found',
    };
  }

  return {
    run: record.run,
    fusedCount: record.fusedSignals.length,
    anomalyCount: record.anomalies.length,
    error: '',
  };
}
