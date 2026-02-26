declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  GetGridStatusRequest,
  GetGridStatusResponse,
  GridZone,
  GridStressLevel,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

// ========================================================================
// Constants
// ========================================================================

const ELECTRICITY_MAPS_BASE = 'https://api.electricitymap.org/v3/power-breakdown/latest';
const TIMEOUT_MS = 8_000;

const STRATEGIC_ZONES = [
  'US-TEX-ERCO',
  'US-CAL-CISO',
  'DE',
  'FR',
  'GB',
  'CN-SO',
  'IN-SO',
  'AU-NSW',
] as const;

// ========================================================================
// Static fallback dataset
// ========================================================================

function buildStaticZones(): GridZone[] {
  const now = new Date().toISOString();
  return [
    { zoneId: 'US-TEX-ERCO', zoneName: 'ERCOT (Texas)', lat: 30.3, lon: -97.7, carbonIntensity: 380, renewablePct: 34, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: -2000, observedAt: now },
    { zoneId: 'US-CAL-CISO', zoneName: 'California ISO', lat: 37.4, lon: -121.0, carbonIntensity: 220, renewablePct: 52, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: 1500, observedAt: now },
    { zoneId: 'DE', zoneName: 'Germany', lat: 51.2, lon: 10.4, carbonIntensity: 340, renewablePct: 48, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: -3000, observedAt: now },
    { zoneId: 'FR', zoneName: 'France', lat: 46.2, lon: 2.2, carbonIntensity: 60, renewablePct: 82, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: -8000, observedAt: now },
    { zoneId: 'GB', zoneName: 'United Kingdom', lat: 54.0, lon: -2.5, carbonIntensity: 180, renewablePct: 62, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: 2000, observedAt: now },
    { zoneId: 'CN-SO', zoneName: 'China South', lat: 23.1, lon: 113.3, carbonIntensity: 580, renewablePct: 22, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: 0, observedAt: now },
    { zoneId: 'IN-SO', zoneName: 'India South', lat: 13.1, lon: 80.3, carbonIntensity: 510, renewablePct: 18, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: 500, observedAt: now },
    { zoneId: 'AU-NSW', zoneName: 'Australia NSW', lat: -33.9, lon: 151.2, carbonIntensity: 520, renewablePct: 28, stressLevel: 'GRID_STRESS_NORMAL', powerImportExportMw: -800, observedAt: now },
  ];
}

// ========================================================================
// Zone metadata for mapping zone IDs to display names and coordinates
// ========================================================================

const ZONE_METADATA: Record<string, { zoneName: string; lat: number; lon: number }> = {
  'US-TEX-ERCO': { zoneName: 'ERCOT (Texas)', lat: 30.3, lon: -97.7 },
  'US-CAL-CISO': { zoneName: 'California ISO', lat: 37.4, lon: -121.0 },
  'DE': { zoneName: 'Germany', lat: 51.2, lon: 10.4 },
  'FR': { zoneName: 'France', lat: 46.2, lon: 2.2 },
  'GB': { zoneName: 'United Kingdom', lat: 54.0, lon: -2.5 },
  'CN-SO': { zoneName: 'China South', lat: 23.1, lon: 113.3 },
  'IN-SO': { zoneName: 'India South', lat: 13.1, lon: 80.3 },
  'AU-NSW': { zoneName: 'Australia NSW', lat: -33.9, lon: 151.2 },
};

// ========================================================================
// Electricity Maps API types
// ========================================================================

interface ElectricityMapsBreakdown {
  powerProductionBreakdown?: Record<string, number | null>;
  fossilFreePercentage?: number | null;
  carbonIntensity?: number | null;
  powerImportTotal?: number | null;
  powerExportTotal?: number | null;
  datetime?: string;
}

// ========================================================================
// Helpers
// ========================================================================

function deriveStressLevel(carbonIntensity: number, renewablePct: number): GridStressLevel {
  // High carbon and low renewables = elevated stress proxy
  if (carbonIntensity > 700 || renewablePct < 10) return 'GRID_STRESS_HIGH';
  if (carbonIntensity > 500 || renewablePct < 20) return 'GRID_STRESS_ELEVATED';
  return 'GRID_STRESS_NORMAL';
}

async function fetchZone(zoneId: string, apiKey: string): Promise<GridZone | null> {
  try {
    const url = `${ELECTRICITY_MAPS_BASE}?zone=${encodeURIComponent(zoneId)}`;
    const response = await fetch(url, {
      headers: { 'auth-token': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data: ElectricityMapsBreakdown = await response.json();
    const meta = ZONE_METADATA[zoneId];
    if (!meta) return null;

    const carbonIntensity = data.carbonIntensity ?? 0;
    const renewablePct = data.fossilFreePercentage ?? 0;
    const importMw = data.powerImportTotal ?? 0;
    const exportMw = data.powerExportTotal ?? 0;
    const powerImportExportMw = importMw - exportMw;
    const observedAt = data.datetime ? new Date(data.datetime).toISOString() : new Date().toISOString();
    const stressLevel = deriveStressLevel(carbonIntensity, renewablePct);

    return {
      zoneId,
      zoneName: meta.zoneName,
      lat: meta.lat,
      lon: meta.lon,
      carbonIntensity,
      renewablePct,
      stressLevel,
      powerImportExportMw,
      observedAt,
    };
  } catch {
    return null;
  }
}

// ========================================================================
// RPC implementation
// ========================================================================

export async function getGridStatus(
  _ctx: ServerContext,
  _req: GetGridStatusRequest,
): Promise<GetGridStatusResponse> {
  const apiKey = process.env.ELECTRICITY_MAPS_API_KEY;

  if (!apiKey) {
    return {
      zones: buildStaticZones(),
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    const results = await Promise.all(
      STRATEGIC_ZONES.map((zoneId) => fetchZone(zoneId, apiKey)),
    );

    const zones: GridZone[] = results.filter((z): z is GridZone => z !== null);

    if (zones.length === 0) {
      return {
        zones: buildStaticZones(),
        fetchedAt: new Date().toISOString(),
      };
    }

    return {
      zones,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return {
      zones: buildStaticZones(),
      fetchedAt: new Date().toISOString(),
    };
  }
}
