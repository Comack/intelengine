import type { ServerContext, ListEvidenceRequest, ListEvidenceResponse, Evidence } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

export async function listEvidence(
  _ctx: ServerContext,
  req: ListEvidenceRequest,
): Promise<ListEvidenceResponse> {
  const indexKey = 'evidence:index';
  let index = (await getCachedJson(indexKey)) as string[];
  if (!Array.isArray(index)) {
    index = [];
  }

  const limit = req.limit || 20;
  const startIndex = req.nextToken ? parseInt(req.nextToken, 10) : 0;
  if (isNaN(startIndex)) throw new Error('Invalid nextToken');

  const pagedIds = index.slice(startIndex, startIndex + limit);
  const nextToken = startIndex + limit < index.length ? String(startIndex + limit) : '';

  const evidencePromises = pagedIds.map(async (id) => {
    return (await getCachedJson(`evidence:${id}`)) as Evidence | null;
  });

  const evidenceItems = await Promise.all(evidencePromises);
  const validEvidence = evidenceItems.filter((e): e is Evidence => e !== null);

  return {
    evidence: validEvidence,
    nextToken,
  };
}