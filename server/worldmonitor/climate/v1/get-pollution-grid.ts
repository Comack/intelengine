/**
 * GetPollutionGrid RPC -- generates a 0.5° resolution pollution grid covering
 * the requested bounding box (default: Europe). NO2 and SO2 values are computed
 * from a realistic synthetic model that reflects known industrial and clean-air
 * regions. When Sentinel Hub credentials are present a real data call would be
 * used; for now the synthetic model is the primary path.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ClimateServiceHandler,
  ServerContext,
  GetPollutionGridRequest,
  GetPollutionGridResponse,
  PollutionGridTile,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

/** Known industrial hotspots with elevated pollution and approximate radius. */
const POLLUTION_HOTSPOTS: {
  lat: number;
  lon: number;
  no2: number;
  so2: number;
  radius: number;
}[] = [
  // China coast / Pearl River Delta
  { lat: 23.1, lon: 113.3, no2: 9.5e-5, so2: 4.2e-5, radius: 4.0 },
  // China / Beijing-Tianjin
  { lat: 39.9, lon: 116.4, no2: 8.8e-5, so2: 3.8e-5, radius: 3.5 },
  // Rhine-Ruhr industrial belt
  { lat: 51.5, lon: 6.9, no2: 7.2e-5, so2: 2.6e-5, radius: 2.0 },
  // Po Valley (Italy)
  { lat: 45.5, lon: 9.2, no2: 6.8e-5, so2: 2.1e-5, radius: 2.0 },
  // Cairo / Nile Delta
  { lat: 30.1, lon: 31.2, no2: 5.4e-5, so2: 1.8e-5, radius: 2.5 },
  // Mumbai industrial
  { lat: 19.0, lon: 72.9, no2: 6.2e-5, so2: 2.4e-5, radius: 2.5 },
  // Tehran Basin
  { lat: 35.7, lon: 51.4, no2: 7.6e-5, so2: 3.1e-5, radius: 2.0 },
  // Johannesburg / Highveld
  { lat: -26.2, lon: 28.0, no2: 5.8e-5, so2: 3.5e-5, radius: 3.0 },
];

/** Background NO2 level (mol/m²) for a given lat/lon. */
function backgroundNo2(lat: number, lon: number): number {
  // Ocean and polar areas: near-zero background
  const isOcean = (lon < -30 && lat > -60) || lon > 150 || lat > 65 || lat < -60;
  if (isOcean) return 5e-7 + Math.random() * 2e-7;
  // Continental background varies slightly by latitude
  return 1.5e-6 + Math.abs(Math.sin(lat * Math.PI / 180)) * 5e-7;
}

/** Background SO2 level (mol/m²) for a given lat/lon. */
function backgroundSo2(lat: number, lon: number): number {
  const isOcean = (lon < -30 && lat > -60) || lon > 150 || lat > 65 || lat < -60;
  if (isOcean) return 1e-7 + Math.random() * 1e-7;
  return 4e-7 + Math.abs(Math.cos(lon * Math.PI / 180)) * 2e-7;
}

/** Euclidean-ish distance in degrees (fast approximation). */
function degDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat1 - lat2;
  const dlon = (lon1 - lon2) * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

/** Compute NO2 and SO2 for a tile, adding hotspot contributions. */
function pollutionAt(lat: number, lon: number): { no2: number; so2: number } {
  let no2 = backgroundNo2(lat, lon);
  let so2 = backgroundSo2(lat, lon);

  for (const hs of POLLUTION_HOTSPOTS) {
    const dist = degDist(lat, lon, hs.lat, hs.lon);
    if (dist < hs.radius * 3) {
      // Gaussian plume falloff
      const factor = Math.exp(-(dist * dist) / (2 * hs.radius * hs.radius));
      no2 += hs.no2 * factor;
      so2 += hs.so2 * factor;
    }
  }

  return { no2, so2 };
}

/** Estimate AOD from NO2 — crude but directionally consistent. */
function aodFromNo2(no2: number): number {
  return Math.min(1.5, no2 / 1e-4 * 0.3 + 0.05);
}

/** Estimate cloud coverage from latitude (higher near ITCZ, poles). */
function cloudCoverage(lat: number): number {
  const itcz = Math.exp(-((lat - 5) ** 2) / 200) * 0.7;
  const midLat = Math.exp(-((Math.abs(lat) - 55) ** 2) / 200) * 0.6;
  return Math.min(95, Math.max(5, (itcz + midLat) * 100 + 10));
}

/** Generate a synthetic grid of ~50 tiles for the requested bounding box. */
function generateSyntheticGrid(req: GetPollutionGridRequest): PollutionGridTile[] {
  // Default to Europe if no valid bounds provided
  const latMin = req.latMin !== 0 || req.latMax !== 0 ? req.latMin : 35.0;
  const latMax = req.latMin !== 0 || req.latMax !== 0 ? req.latMax : 60.0;
  const lonMin = req.lonMin !== 0 || req.lonMax !== 0 ? req.lonMin : -10.0;
  const lonMax = req.lonMin !== 0 || req.lonMax !== 0 ? req.lonMax : 40.0;

  const latRange = latMax - latMin;
  const lonRange = lonMax - lonMin;

  // Target ~50 tiles: compute step size accordingly
  const area = latRange * lonRange;
  const tileArea = area / 50;
  const step = Math.max(0.5, Math.sqrt(tileArea));

  const acquiredAt = new Date(Date.now() - 86_400_000).toISOString();
  const tiles: PollutionGridTile[] = [];

  for (let lat = latMin + step / 2; lat < latMax; lat += step) {
    for (let lon = lonMin + step / 2; lon < lonMax; lon += step) {
      const { no2, so2 } = pollutionAt(lat, lon);
      tiles.push({
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
        no2MolPerM2: Math.round(no2 * 1e10) / 1e10,
        so2MolPerM2: Math.round(so2 * 1e10) / 1e10,
        aod: Math.round(aodFromNo2(no2) * 1000) / 1000,
        acquiredAt,
        cloudCoveragePct: Math.round(cloudCoverage(lat)),
      });
    }
  }

  return tiles;
}

export const getPollutionGrid: ClimateServiceHandler['getPollutionGrid'] = async (
  _ctx: ServerContext,
  req: GetPollutionGridRequest,
): Promise<GetPollutionGridResponse> => {
  // Check for Sentinel Hub credentials — reserved for real satellite data path
  const clientId = process.env['SENTINEL_HUB_CLIENT_ID'];
  const clientSecret = process.env['SENTINEL_HUB_CLIENT_SECRET'];

  // Even with credentials the real Sentinel Hub Statistics API requires
  // a bespoke evalscript and async job flow; use synthetic model as primary
  // and log when credentials are present for future integration.
  if (clientId && clientSecret) {
    console.info('[CLIMATE] Sentinel Hub credentials found — using synthetic model until full integration is complete.');
  }

  try {
    const tiles = generateSyntheticGrid(req);
    return {
      tiles,
      acquiredAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CLIMATE] getPollutionGrid error:', msg);
    return { tiles: [], acquiredAt: new Date().toISOString() };
  }
};
