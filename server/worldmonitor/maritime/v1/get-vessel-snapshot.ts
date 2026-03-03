import type {
  ServerContext,
  GetVesselSnapshotRequest,
  GetVesselSnapshotResponse,
  VesselSnapshot,
  AisDensityZone,
  AisDisruption,
  AisDisruptionType,
  AisDisruptionSeverity,
} from '../../../../src/generated/server/worldmonitor/maritime/v1/service_server';

import { CHROME_UA } from '../../../_shared/constants';

// ========================================================================
// Helpers
// ========================================================================

function getRelayBaseUrl(): string | null {
  const relayUrl = process.env.WS_RELAY_URL;
  if (!relayUrl) return null;
  return relayUrl
    .replace('wss://', 'https://')
    .replace('ws://', 'http://')
    .replace(/\/$/, '');
}

function getRelayRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': CHROME_UA,
  };
  const relaySecret = process.env.RELAY_SHARED_SECRET;
  if (relaySecret) {
    const relayHeader = (process.env.RELAY_AUTH_HEADER || 'x-relay-key').toLowerCase();
    headers[relayHeader] = relaySecret;
    headers.Authorization = `Bearer ${relaySecret}`;
  }
  return headers;
}

const DISRUPTION_TYPE_MAP: Record<string, AisDisruptionType> = {
  gap_spike: 'AIS_DISRUPTION_TYPE_GAP_SPIKE',
  chokepoint_congestion: 'AIS_DISRUPTION_TYPE_CHOKEPOINT_CONGESTION',
};

const SEVERITY_MAP: Record<string, AisDisruptionSeverity> = {
  low: 'AIS_DISRUPTION_SEVERITY_LOW',
  elevated: 'AIS_DISRUPTION_SEVERITY_ELEVATED',
  high: 'AIS_DISRUPTION_SEVERITY_HIGH',
};

// In-memory cache (matches old /api/ais-snapshot behavior)
const SNAPSHOT_CACHE_TTL_MS = 300_000; // 5 min -- matches client poll interval
let cachedSnapshot: VesselSnapshot | undefined;
let cacheTimestamp = 0;
let inFlightRequest: Promise<VesselSnapshot | undefined> | null = null;

async function fetchVesselSnapshot(): Promise<VesselSnapshot | undefined> {
  // Return cached if fresh
  const now = Date.now();
  if (cachedSnapshot && (now - cacheTimestamp) < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  // In-flight dedup: if a request is already running, await it
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const thisRequest = inFlightRequest = fetchVesselSnapshotFromRelay();
  try {
    const result = await thisRequest;
    if (result) {
      cachedSnapshot = result;
      cacheTimestamp = Date.now();
    }
    return result ?? cachedSnapshot; // serve stale on relay failure
  } finally {
    if (inFlightRequest === thisRequest) inFlightRequest = null;
  }
}

async function fetchVesselSnapshotFromRelay(): Promise<VesselSnapshot | undefined> {
  try {
    const relayBaseUrl = getRelayBaseUrl();
    if (!relayBaseUrl) return undefined;

    const response = await fetch(
      `${relayBaseUrl}/ais/snapshot?candidates=false`,
      {
        headers: getRelayRequestHeaders(),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return undefined;

    const data = await response.json();
    if (!data || !Array.isArray(data.disruptions) || !Array.isArray(data.density)) {
      return undefined;
    }

    const densityZones: AisDensityZone[] = data.density
      .filter((z: any) => {
        const lat = Number(z.lat);
        const lon = Number(z.lon);
        return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
      })
      .map((z: any): AisDensityZone => ({
        id: String(z.id || ''),
        name: String(z.name || ''),
        location: {
          latitude: Number(z.lat),
          longitude: Number(z.lon),
        },
        intensity: Number(z.intensity) || 0,
        deltaPct: Number(z.deltaPct) || 0,
        shipsPerDay: Number(z.shipsPerDay) || 0,
        note: String(z.note || ''),
      }));

    const disruptions: AisDisruption[] = data.disruptions
      .filter((d: any) => {
        const lat = Number(d.lat);
        const lon = Number(d.lon);
        return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
      })
      .map((d: any): AisDisruption => ({
        id: String(d.id || ''),
        name: String(d.name || ''),
        type: DISRUPTION_TYPE_MAP[d.type] || 'AIS_DISRUPTION_TYPE_UNSPECIFIED',
        location: {
          latitude: Number(d.lat),
          longitude: Number(d.lon),
        },
        severity: SEVERITY_MAP[d.severity] || 'AIS_DISRUPTION_SEVERITY_UNSPECIFIED',
        changePct: Number(d.changePct) || 0,
        windowHours: Number(d.windowHours) || 0,
        darkShips: Number(d.darkShips) || 0,
        vesselCount: Number(d.vesselCount) || 0,
        region: String(d.region || ''),
        description: String(d.description || ''),
      }));

    return {
      snapshotAt: Date.now(),
      densityZones,
      disruptions,
    };
  } catch {
    return undefined;
  }
}

// ========================================================================
// RPC handler
// ========================================================================

export async function getVesselSnapshot(
  _ctx: ServerContext,
  _req: GetVesselSnapshotRequest,
): Promise<GetVesselSnapshotResponse> {
  try {
    const snapshot = await fetchVesselSnapshot();
    return { snapshot };
  } catch {
    return { snapshot: undefined };
  }
}
