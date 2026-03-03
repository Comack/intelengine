declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  GetAircraftDetailsBatchRequest,
  GetAircraftDetailsBatchResponse,
  AircraftDetails,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import { mapWingbitsDetails } from './_shared';

export async function getAircraftDetailsBatch(
  _ctx: ServerContext,
  req: GetAircraftDetailsBatchRequest,
): Promise<GetAircraftDetailsBatchResponse> {
  const apiKey = process.env.WINGBITS_API_KEY;
  if (!apiKey) return { results: {}, fetched: 0, requested: 0, configured: false };

  const limitedList = req.icao24s.slice(0, 20).map((id) => id.toLowerCase());
  const results: Record<string, AircraftDetails> = {};

  const tasks = limitedList.map((icao24) => async () => {
    try {
      const resp = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
        headers: { 'x-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('Retry-After');
        console.warn(`[aircraft-details] Wingbits rate-limited icao24=${icao24} retry-after=${retryAfter ?? 'unset'}`);
        return null;
      }
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>;
        return { icao24, details: mapWingbitsDetails(icao24, data) };
      }
      console.warn(`[aircraft-details] Wingbits returned ${resp.status} for icao24=${icao24}`);
    } catch (err) {
      console.warn(`[aircraft-details] fetch failed icao24=${icao24}:`, (err as Error).message);
    }
    return null;
  });

  // Limit concurrency to 5 to avoid triggering Wingbits rate limits
  const fetchResults = await (async () => {
    const out: (Awaited<ReturnType<typeof tasks[0]>> | null)[] = new Array(tasks.length);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(5, tasks.length) }, async () => {
        while (i < tasks.length) { const idx = i++; const t = tasks[idx]; if (t) out[idx] = await t(); }
      }),
    );
    return out;
  })();
  for (const r of fetchResults) {
    if (r) results[r.icao24] = r.details;
  }

  return {
    results,
    fetched: Object.keys(results).length,
    requested: limitedList.length,
    configured: true,
  };
}
