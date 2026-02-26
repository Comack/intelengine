declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListSatellitesRequest,
  ListSatellitesResponse,
  Satellite,
  SatelliteCategory,
} from '../../../../src/generated/server/worldmonitor/space/v1/service_server';

const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const FETCH_TIMEOUT_MS = 12000;

interface CelesTrakRecord {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number | string;
  OBJECT_ID?: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR?: number;
  MEAN_MOTION_DOT?: number;
  MEAN_MOTION_DDOT?: number;
  CLASSIFICATION_TYPE?: string;
  TLE_LINE1?: string;
  TLE_LINE2?: string;
}

function categorizeSatellite(name: string, group: string): SatelliteCategory {
  const upper = name.toUpperCase();
  if (upper.startsWith('STARLINK-')) return 'SATELLITE_CATEGORY_STARLINK';
  if (upper.includes('ISS') || upper.includes('ZARYA') || upper.includes('UNITY')) {
    return 'SATELLITE_CATEGORY_ISS';
  }
  if (
    upper.includes('GPS') ||
    upper.includes('NAVSTAR') ||
    upper.includes('GLONASS') ||
    upper.includes('GALILEO') ||
    upper.includes('BEIDOU')
  ) {
    return 'SATELLITE_CATEGORY_NAVIGATION';
  }
  if (group === 'stations') return 'SATELLITE_CATEGORY_ISS';
  return 'SATELLITE_CATEGORY_COMMUNICATIONS';
}

function propagateOrbit(record: CelesTrakRecord): { lat: number; lon: number; altitudeKm: number } {
  try {
    const epochMs = Date.parse(record.EPOCH);
    if (!isFinite(epochMs)) {
      return { lat: 0, lon: 0, altitudeKm: 400 };
    }

    const deltaMinutes = (Date.now() - epochMs) / 60000;

    // Mean motion in rev/day → rad/min
    const n = (record.MEAN_MOTION * 2 * Math.PI) / (24 * 60);

    // Current mean anomaly in radians
    const M0 = record.MEAN_ANOMALY * (Math.PI / 180);
    const M = M0 + n * deltaMinutes;

    // For near-circular orbits, true anomaly ≈ mean anomaly
    const inclRad = record.INCLINATION * (Math.PI / 180);
    const raanDeg = record.RA_OF_ASC_NODE;
    const aopDeg = record.ARG_OF_PERICENTER;

    // Latitude from inclination and current anomaly
    const lat = Math.asin(Math.sin(inclRad) * Math.sin(M)) * (180 / Math.PI);

    // Longitude estimate: RAAN + AoP contribution + anomaly – Earth rotation correction
    const earthRotationOffset = (Date.now() - epochMs) / 240000; // degrees
    let lon =
      raanDeg +
      aopDeg * Math.cos(inclRad) +
      (M * 180) / Math.PI -
      earthRotationOffset;

    // Normalize to -180..180
    lon = ((lon % 360) + 540) % 360 - 180;

    // Altitude from mean motion using vis-viva / Kepler's third law
    // T = 86400 / MEAN_MOTION  (seconds per rev)
    // a^3 = mu * T^2 / (4 * pi^2),  mu = 398600.4418 km^3/s^2
    const T = 86400 / record.MEAN_MOTION;
    const mu = 398600.4418;
    const a = Math.cbrt((mu * T * T) / (4 * Math.PI * Math.PI));
    const altitudeKm = Math.max(0, a - 6371);

    return {
      lat: isFinite(lat) ? lat : 0,
      lon: isFinite(lon) ? lon : 0,
      altitudeKm: isFinite(altitudeKm) ? altitudeKm : 400,
    };
  } catch {
    return { lat: 0, lon: 0, altitudeKm: 400 };
  }
}

async function fetchGroup(group: string): Promise<CelesTrakRecord[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${CELESTRAK_BASE}?GROUP=${group}&FORMAT=json`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data as CelesTrakRecord[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function listSatellites(
  _ctx: ServerContext,
  req: ListSatellitesRequest,
): Promise<ListSatellitesResponse> {
  try {
    const groups = ['stations', 'starlink', 'active', 'gnss'];

    const groupResults = await Promise.allSettled(
      groups.map((g) => fetchGroup(g).then((records) => ({ group: g, records }))),
    );

    // Deduplicate by NORAD_CAT_ID
    const seen = new Set<string>();
    const allRecords: Array<{ group: string; record: CelesTrakRecord }> = [];

    for (const result of groupResults) {
      if (result.status !== 'fulfilled') continue;
      const { group, records } = result.value;
      for (const record of records) {
        const id = String(record.NORAD_CAT_ID);
        if (!seen.has(id)) {
          seen.add(id);
          allRecords.push({ group, record });
        }
      }
    }

    // Propagate positions and build satellite objects
    const maxLimit = Math.min(req.limit || 500, 2000);
    const categoryFilter = req.category;

    const satellites: Satellite[] = [];

    for (const { group, record } of allRecords) {
      if (satellites.length >= maxLimit) break;

      const category = categorizeSatellite(record.OBJECT_NAME, group);

      // Apply category filter if not UNSPECIFIED
      if (
        categoryFilter &&
        categoryFilter !== 'SATELLITE_CATEGORY_UNSPECIFIED' &&
        category !== categoryFilter
      ) {
        continue;
      }

      const { lat, lon, altitudeKm } = propagateOrbit(record);
      const epochMs = Date.parse(record.EPOCH);

      satellites.push({
        id: String(record.NORAD_CAT_ID),
        name: record.OBJECT_NAME,
        category,
        country: record.OBJECT_ID?.split('-')[0] ?? '',
        lat,
        lon,
        altitudeKm,
        inclinationDeg: record.INCLINATION,
        epochMs: String(isFinite(epochMs) ? epochMs : 0),
        tleLine1: record.TLE_LINE1 ?? '',
        tleLine2: record.TLE_LINE2 ?? '',
      });
    }

    return {
      satellites,
      propagatedAt: String(Date.now()),
    };
  } catch {
    return {
      satellites: [],
      propagatedAt: String(Date.now()),
    };
  }
}

void process;
