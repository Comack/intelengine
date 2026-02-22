import type {
  GetForensicsPolicyRequest,
  GetForensicsPolicyResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { listForensicsPolicyEntries } from './forensics-blackboard';

const DEFAULT_LIMIT = 100;

export async function getForensicsPolicy(
  _ctx: ServerContext,
  req: GetForensicsPolicyRequest,
): Promise<GetForensicsPolicyResponse> {
  const domain = req.domain?.trim() || 'infrastructure';
  const entries = await listForensicsPolicyEntries({
    domain,
    stateHash: req.stateHash,
    limit: req.limit > 0 ? req.limit : DEFAULT_LIMIT,
  });

  return {
    entries,
    error: '',
  };
}
