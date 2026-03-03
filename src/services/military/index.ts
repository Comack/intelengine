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

// ---------------------------------------------------------------------------
// ACARS messages (ADSB.lol / ACARS aggregators)
// ---------------------------------------------------------------------------

import {
  MilitaryServiceClient,
  type AcarsMessage,
  type AcarsMilCategory,
} from '@/generated/client/worldmonitor/military/v1/service_client';
import { createCircuitBreaker } from '@/utils';

export type { AcarsMessage };

const militaryClient = new MilitaryServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const acarsBreaker = createCircuitBreaker<AcarsMessage[]>({ name: 'ACARS Messages', cacheTtlMs: 10 * 60 * 1000, persistCache: true });

export async function fetchAcarsMessages(limit = 100, milCategory: AcarsMilCategory = 'ACARS_MIL_CATEGORY_UNSPECIFIED'): Promise<AcarsMessage[]> {
  return acarsBreaker.execute(
    () => militaryClient.listAcarsMessages({ limit, milCategory }).then((r) => r.messages),
    [],
  );
}
