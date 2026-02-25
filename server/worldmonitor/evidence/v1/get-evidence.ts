import type { ServerContext, GetEvidenceRequest, GetEvidenceResponse, Evidence } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

export async function getEvidence(
  _ctx: ServerContext,
  req: GetEvidenceRequest,
): Promise<GetEvidenceResponse> {
  const evidence = (await getCachedJson(`evidence:${req.id}`)) as Evidence | null;
  
  if (!evidence) {
    throw new Error('Evidence not found');
  }

  return { evidence };
}