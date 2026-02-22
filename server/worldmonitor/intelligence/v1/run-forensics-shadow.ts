import type {
  RunForensicsShadowRequest,
  RunForensicsShadowResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { runForensicsShadowPipeline } from './forensics-orchestrator';

export async function runForensicsShadow(
  _ctx: ServerContext,
  req: RunForensicsShadowRequest,
): Promise<RunForensicsShadowResponse> {
  if (!req.domain || !req.domain.trim()) {
    return {
      run: undefined,
      fusedSignals: [],
      anomalies: [],
      trace: [],
      error: 'Missing required field: domain',
    };
  }
  if (!Array.isArray(req.signals) || req.signals.length === 0) {
    return {
      run: undefined,
      fusedSignals: [],
      anomalies: [],
      trace: [],
      error: 'Missing required field: signals',
    };
  }
  return runForensicsShadowPipeline(req);
}
