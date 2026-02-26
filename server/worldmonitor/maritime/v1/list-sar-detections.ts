declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListSarDetectionsRequest,
  ListSarDetectionsResponse,
  SarDarkShip,
} from '../../../../src/generated/server/worldmonitor/maritime/v1/service_server';

// ========================================================================
// Fallback data
// ========================================================================

function buildFallbackDetections(): SarDarkShip[] {
  const now = Date.now();
  return [
    {
      id: 'sar-001',
      lat: 21.2,
      lon: 115.8,
      lengthM: 185,
      course: 45,
      speedKnots: 8.2,
      aisMatched: false,
      nearestAisVessel: '',
      region: 'South China Sea',
      vesselClassHint: 'tanker',
      detectedAt: new Date(now - 14400000).toISOString(),
      confidence: 0.87,
    },
    {
      id: 'sar-002',
      lat: 26.8,
      lon: 56.2,
      lengthM: 142,
      course: 210,
      speedKnots: 5.1,
      aisMatched: false,
      nearestAisVessel: '',
      region: 'Strait of Hormuz',
      vesselClassHint: 'cargo',
      detectedAt: new Date(now - 28800000).toISOString(),
      confidence: 0.92,
    },
    {
      id: 'sar-003',
      lat: 1.2,
      lon: 103.9,
      lengthM: 220,
      course: 90,
      speedKnots: 12.4,
      aisMatched: true,
      nearestAisVessel: 'LUCKY FORTUNE',
      region: 'Singapore Strait',
      vesselClassHint: 'cargo',
      detectedAt: new Date(now - 43200000).toISOString(),
      confidence: 0.78,
    },
    {
      id: 'sar-004',
      lat: 38.5,
      lon: 26.1,
      lengthM: 95,
      course: 315,
      speedKnots: 4.3,
      aisMatched: false,
      nearestAisVessel: '',
      region: 'Aegean Sea',
      vesselClassHint: 'fishing',
      detectedAt: new Date(now - 57600000).toISOString(),
      confidence: 0.65,
    },
    {
      id: 'sar-005',
      lat: 36.8,
      lon: 14.0,
      lengthM: 312,
      course: 270,
      speedKnots: 15.8,
      aisMatched: false,
      nearestAisVessel: '',
      region: 'Central Mediterranean',
      vesselClassHint: 'tanker',
      detectedAt: new Date(now - 72000000).toISOString(),
      confidence: 0.94,
    },
  ];
}

// ========================================================================
// GFW fetch
// ========================================================================

interface GfwSarEntry {
  id?: string;
  position?: { lat?: number; lon?: number };
  vessel?: { length?: number; course?: number; speed?: number };
  start?: string;
  end?: string;
  [key: string]: unknown;
}

interface GfwResponse {
  entries?: GfwSarEntry[];
}

async function fetchGfwSarDetections(apiKey: string, limit: number): Promise<SarDarkShip[]> {
  const clampedLimit = Math.min(limit, 500);
  const url = `https://gateway.api.globalfishingwatch.org/v3/events?datasets[0]=public-global-sar-presence:latest&limit=${clampedLimit}`;

  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json() as GfwResponse;
  const entries: GfwSarEntry[] = Array.isArray(data.entries) ? data.entries : [];

  return entries.map((entry, idx): SarDarkShip => ({
    id: String(entry.id ?? `gfw-sar-${idx}`),
    lat: Number(entry.position?.lat ?? 0),
    lon: Number(entry.position?.lon ?? 0),
    lengthM: Number(entry.vessel?.length ?? 0),
    course: Number(entry.vessel?.course ?? 0),
    speedKnots: Number(entry.vessel?.speed ?? 0),
    aisMatched: false,
    nearestAisVessel: '',
    region: '',
    vesselClassHint: '',
    detectedAt: entry.start ? new Date(entry.start).toISOString() : new Date().toISOString(),
    confidence: 0,
  }));
}

// ========================================================================
// RPC handler
// ========================================================================

export async function listSarDetections(
  _ctx: ServerContext,
  req: ListSarDetectionsRequest,
): Promise<ListSarDetectionsResponse> {
  const fetchedAt = new Date().toISOString();
  const apiKey = process.env.GLOBAL_FISHING_WATCH_API_KEY;

  if (apiKey) {
    try {
      const detections = await fetchGfwSarDetections(apiKey, req.limit || 100);
      if (detections.length > 0) {
        return { detections, fetchedAt };
      }
    } catch {
      // fall through to fallback
    }
  }

  return { detections: buildFallbackDetections(), fetchedAt };
}
