import type {
  GetForensicsTraceRequest,
  GetForensicsTraceResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { getForensicsRunRecord } from './forensics-blackboard';

export async function getForensicsTrace(
  _ctx: ServerContext,
  req: GetForensicsTraceRequest,
): Promise<GetForensicsTraceResponse> {
  if (!req.runId || !req.runId.trim()) {
    return {
      run: undefined,
      trace: [],
      error: 'Missing required field: runId',
    };
  }

  const record = await getForensicsRunRecord(req.runId);
  if (!record) {
    return {
      run: undefined,
      trace: [],
      error: 'Forensics run not found',
    };
  }

  return {
    run: record.run,
    trace: record.trace,
    error: '',
  };
}
