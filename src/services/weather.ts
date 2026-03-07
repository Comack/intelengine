import { createCircuitBreaker, getCSSColor } from '@/utils';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  description: string;
  areaDesc: string;
  onset: Date;
  expires: Date;
  coordinates: [number, number][];
  polygons?: [number, number][][];
  centroid?: [number, number];
}

interface NWSAlert {
  id: string;
  properties: {
    event: string;
    severity: string;
    headline: string;
    description: string;
    areaDesc: string;
    onset: string;
    expires: string;
  };
  geometry?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface NWSResponse {
  features: NWSAlert[];
}

const NWS_API = 'https://api.weather.gov/alerts/active';
const breaker = createCircuitBreaker<WeatherAlert[]>({ name: 'NWS Weather', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

export async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  return breaker.execute(async () => {
    const response = await fetch(NWS_API, {
      headers: { 'User-Agent': 'WorldMonitor/1.0' }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data: NWSResponse = await response.json();

    return data.features
      .filter(alert => alert.properties.severity !== 'Unknown')
      .slice(0, 50)
      .map(alert => {
        const polygons = extractPolygons(alert.geometry);
        const coords = flattenCoordinates(polygons);
        return {
          id: alert.id,
          event: alert.properties.event,
          severity: alert.properties.severity as WeatherAlert['severity'],
          headline: alert.properties.headline,
          description: alert.properties.description?.slice(0, 500) || '',
          areaDesc: alert.properties.areaDesc,
          onset: new Date(alert.properties.onset),
          expires: new Date(alert.properties.expires),
          coordinates: coords,
          polygons,
          centroid: calculateCentroid(coords),
        };
      });
  }, []);
}

export function getWeatherStatus(): string {
  return breaker.getStatus();
}

function extractPolygons(geometry?: NWSAlert['geometry']): [number, number][][] {
  if (!geometry) return [];

  const normalizeRing = (ring: unknown): [number, number][] => {
    if (!Array.isArray(ring)) return [];
    const normalized: [number, number][] = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        normalized.push([lon, lat]);
      }
    }
    return normalized;
  };

  try {
    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates as unknown as number[][][];
      const ring = normalizeRing(coords[0]);
      return ring.length >= 3 ? [ring] : [];
    }
    if (geometry.type === 'MultiPolygon') {
      const coords = geometry.coordinates as unknown as number[][][][];
      const polygons: [number, number][][] = [];
      for (const polygon of coords) {
        const ring = normalizeRing(polygon?.[0]);
        if (ring.length >= 3) polygons.push(ring);
      }
      return polygons;
    }
  } catch {
    return [];
  }
  return [];
}

function flattenCoordinates(polygons: [number, number][][]): [number, number][] {
  if (polygons.length === 0) return [];
  return polygons.flatMap((ring) => ring);
}

function calculateCentroid(coords: [number, number][]): [number, number] | undefined {
  if (coords.length === 0) return undefined;

  const sum = coords.reduce(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0]
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
}

export function getSeverityColor(severity: WeatherAlert['severity']): string {
  switch (severity) {
    case 'Extreme': return getCSSColor('--semantic-critical');
    case 'Severe': return getCSSColor('--semantic-high');
    case 'Moderate': return getCSSColor('--semantic-elevated');
    case 'Minor': return getCSSColor('--semantic-elevated');
    default: return getCSSColor('--text-dim');
  }
}
