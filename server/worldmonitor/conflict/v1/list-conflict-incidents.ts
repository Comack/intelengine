declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListConflictIncidentsRequest,
  ListConflictIncidentsResponse,
  ConflictIncident,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';

const LIVEUAMAP_API = 'https://me.liveuamap.com/devapi/events';
const TIMEOUT_MS = 10_000;

// ========================================================================
// Liveuamap API types
// ========================================================================

interface LuaEvent {
  id?: string | number;
  lat?: number;
  lng?: number;
  title?: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  time?: number | string;
  type?: string;
  [key: string]: unknown;
}

// ========================================================================
// Liveuamap fetch
// ========================================================================

async function fetchLiveuamapEvents(apiKey: string, limit: number): Promise<ConflictIncident[]> {
  const url = `${LIVEUAMAP_API}?key=${encodeURIComponent(apiKey)}&limit=${Math.min(limit, 200)}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    console.warn(`[Liveuamap] API returned ${response.status}`);
    return [];
  }

  const body = (await response.json()) as { events?: LuaEvent[] } | LuaEvent[];
  const events: LuaEvent[] = Array.isArray(body) ? body : (body.events ?? []);

  return events.map((e, idx): ConflictIncident => {
    const ts =
      typeof e.time === 'number'
        ? (e.time > 1e12 ? e.time : e.time * 1000) // handle seconds or ms
        : e.time
          ? new Date(String(e.time)).getTime()
          : Date.now();

    return {
      id: String(e.id ?? `lua-${idx}`),
      lat: Number(e.lat ?? 0),
      lon: Number(e.lng ?? 0),
      title: String(e.title ?? ''),
      description: String(e.description ?? '').slice(0, 2000),
      incidentType: String(e.type ?? 'unknown'),
      sourceUrl: String(e.sourceUrl ?? ''),
      createdAt: new Date(ts).toISOString(),
      region: '',
    };
  });
}

// ========================================================================
// Fallback data — representative conflict incidents when API unavailable
// ========================================================================

function buildFallbackIncidents(): ConflictIncident[] {
  const now = Date.now();
  return [
    {
      id: 'fallback-001',
      lat: 48.45,
      lon: 35.05,
      title: 'Artillery strikes reported near Zaporizhzhia front line',
      description:
        'Multiple artillery impacts reported by local officials. No casualties confirmed.',
      incidentType: 'shelling',
      sourceUrl: 'https://liveuamap.com',
      createdAt: new Date(now - 3600000).toISOString(),
      region: 'Eastern Ukraine',
    },
    {
      id: 'fallback-002',
      lat: 31.52,
      lon: 34.45,
      title: 'Rocket sirens activated in southern Israel',
      description:
        'Iron Dome interceptions reported. Ongoing escalation along Gaza border.',
      incidentType: 'rocket_attack',
      sourceUrl: 'https://liveuamap.com',
      createdAt: new Date(now - 7200000).toISOString(),
      region: 'Israel-Gaza',
    },
    {
      id: 'fallback-003',
      lat: 15.35,
      lon: 44.21,
      title: 'Houthi drone launch detected over Red Sea',
      description:
        'Maritime patrol reports drone activity near Bab el-Mandeb strait.',
      incidentType: 'drone_strike',
      sourceUrl: 'https://liveuamap.com',
      createdAt: new Date(now - 14400000).toISOString(),
      region: 'Yemen - Red Sea',
    },
    {
      id: 'fallback-004',
      lat: 36.19,
      lon: 37.17,
      title: 'Clashes between SDF and Turkish-backed forces in Aleppo province',
      description: 'Ground fighting along M4 highway. Civilian displacement reported.',
      incidentType: 'ground_combat',
      sourceUrl: 'https://liveuamap.com',
      createdAt: new Date(now - 21600000).toISOString(),
      region: 'Northern Syria',
    },
    {
      id: 'fallback-005',
      lat: 11.59,
      lon: 43.15,
      title: 'US AFRICOM reports airstrike against al-Shabaab in Somalia',
      description:
        'Precision strike near Mogadishu targeting militant leadership.',
      incidentType: 'airstrike',
      sourceUrl: 'https://liveuamap.com',
      createdAt: new Date(now - 43200000).toISOString(),
      region: 'Horn of Africa',
    },
  ];
}

// ========================================================================
// RPC handler
// ========================================================================

export async function listConflictIncidents(
  _ctx: ServerContext,
  req: ListConflictIncidentsRequest,
): Promise<ListConflictIncidentsResponse> {
  const limit = req.limit && req.limit > 0 ? req.limit : 100;
  const apiKey = process.env.LIVEUAMAP_API_KEY;

  if (apiKey) {
    try {
      const incidents = await fetchLiveuamapEvents(apiKey, limit);
      if (incidents.length > 0) {
        return { incidents };
      }
    } catch (err) {
      console.warn('[Liveuamap] Fetch failed:', err);
    }
  }

  return { incidents: buildFallbackIncidents() };
}
