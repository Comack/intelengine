/**
 * Unified military service module.
 *
 * Re-exports from legacy service files that have complex client-side logic
 * (OpenSky/Wingbits polling, AIS streaming, trail tracking, surge analysis).
 * Server-side theater posture is consolidated in the handler.
 */

// Military flights (client-side OpenSky/Wingbits tracking)
export * from '../military-flights';

// Military vessels (client-side AIS tracking)
export * from '../military-vessels';

// Cached theater posture (client-side cache layer)
export * from '../cached-theater-posture';

// Military surge analysis (client-side posture computation)
export * from '../military-surge';

// ---- ACARS Messages (direct RPC) ----
import {
  MilitaryServiceClient,
  type ListAcarsMessagesResponse,
  type AcarsMessage,
} from '@/generated/client/worldmonitor/military/v1/service_client';
import { createCircuitBreaker } from '@/utils';

const militaryClient = new MilitaryServiceClient('', { fetch: fetch.bind(globalThis) });
const acarsBreaker = createCircuitBreaker<ListAcarsMessagesResponse>({ name: 'ACARS Messages' });
const emptyAcarsFallback: ListAcarsMessagesResponse = { messages: [], sampledAt: '' };

export type { AcarsMessage };

export async function fetchAcarsMessages(limit = 100): Promise<AcarsMessage[]> {
  const res = await acarsBreaker.execute(async () => {
    return militaryClient.listAcarsMessages({ limit, milCategory: 'ACARS_MIL_CATEGORY_UNSPECIFIED' });
  }, emptyAcarsFallback);
  return res.messages;
}
