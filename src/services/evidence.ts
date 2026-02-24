import {
  EvidenceServiceClient,
  type Evidence,
} from '@/generated/client/worldmonitor/evidence/v1/service_client';

const client = new EvidenceServiceClient('', { fetch: fetch.bind(globalThis) });

export async function getEvidence(id: string): Promise<Evidence | null> {
  try {
    const resp = await client.getEvidence({ id });
    return resp.evidence || null;
  } catch (err) {
    console.error('[Evidence] Failed to get evidence:', err);
    return null;
  }
}