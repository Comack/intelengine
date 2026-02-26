/**
 * ListAirQualityReadings RPC -- fetches real-time air quality data from the
 * World Air Quality Index (WAQI) API across 5 strategic bounding boxes.
 * Falls back to 8 synthetic readings from key cities when no API token is
 * configured.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ClimateServiceHandler,
  ServerContext,
  ListAirQualityReadingsRequest,
  ListAirQualityReadingsResponse,
  AirQualityReading,
  AqiLevel,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

/** Map numeric AQI value to AqiLevel enum string. */
function mapAqiLevel(aqi: number): AqiLevel {
  if (aqi <= 50) return 'AQI_LEVEL_GOOD';
  if (aqi <= 100) return 'AQI_LEVEL_MODERATE';
  if (aqi <= 150) return 'AQI_LEVEL_UNHEALTHY_SENSITIVE';
  if (aqi <= 200) return 'AQI_LEVEL_UNHEALTHY';
  if (aqi <= 300) return 'AQI_LEVEL_VERY_UNHEALTHY';
  return 'AQI_LEVEL_HAZARDOUS';
}

interface WaqiIaqi {
  pm25?: { v: number };
  pm10?: { v: number };
  so2?: { v: number };
  no2?: { v: number };
  o3?: { v: number };
  co?: { v: number };
}

interface WaqiStation {
  uid: number;
  aqi: string;
  lat: number;
  lon: number;
  station: { name: string; time: { stime: string } };
  iaqi: WaqiIaqi;
}

interface WaqiBoundsResponse {
  status: string;
  data: WaqiStation[];
}

/** Find the dominant pollutant by highest absolute concentration value. */
function dominantPollutant(iaqi: WaqiIaqi): string {
  const candidates: [string, number][] = [
    ['pm25', iaqi.pm25?.v ?? 0],
    ['pm10', iaqi.pm10?.v ?? 0],
    ['so2', iaqi.so2?.v ?? 0],
    ['no2', iaqi.no2?.v ?? 0],
    ['o3', iaqi.o3?.v ?? 0],
    ['co', iaqi.co?.v ?? 0],
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (c[1] > best[1]) best = c;
  }
  return best[0];
}

/** Fetch WAQI bounds endpoint with a 10s timeout. */
async function fetchWaqiBounds(
  latlng: string,
  token: string,
): Promise<WaqiStation[]> {
  const url = `https://api.waqi.info/map/bounds/?latlng=${latlng}&token=${token}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return [];
  const json = await response.json() as WaqiBoundsResponse;
  if (json.status !== 'ok' || !Array.isArray(json.data)) return [];
  return json.data;
}

/** Convert a raw WAQI station record to an AirQualityReading. */
function waqiToReading(station: WaqiStation): AirQualityReading | null {
  const aqiNum = parseInt(station.aqi, 10);
  if (isNaN(aqiNum) || aqiNum < 0) return null;

  const iaqi = station.iaqi ?? {};
  const nameParts = station.station.name.split(',');
  const city = nameParts[0]?.trim() ?? station.station.name;
  const country = nameParts[nameParts.length - 1]?.trim() ?? '';
  const observedAt = station.station.time?.stime
    ? new Date(station.station.time.stime).toISOString()
    : new Date(Date.now() - 3_600_000).toISOString();

  return {
    stationId: `waqi-${station.uid}`,
    stationName: station.station.name,
    city,
    country,
    lat: station.lat,
    lon: station.lon,
    aqi: aqiNum,
    level: mapAqiLevel(aqiNum),
    dominantPollutant: dominantPollutant(iaqi),
    pm25: iaqi.pm25?.v ?? 0,
    pm10: iaqi.pm10?.v ?? 0,
    so2: iaqi.so2?.v ?? 0,
    no2: iaqi.no2?.v ?? 0,
    observedAt,
  };
}

/** Synthetic fallback readings covering key global cities. */
function syntheticReadings(): AirQualityReading[] {
  const observedAt = new Date(Date.now() - 3_600_000).toISOString();
  return [
    {
      stationId: 'w-1', stationName: 'Beijing Olympic Center',
      city: 'Beijing', country: 'CN', lat: 39.98, lon: 116.39,
      aqi: 156, level: 'AQI_LEVEL_UNHEALTHY', dominantPollutant: 'pm25',
      pm25: 68.4, pm10: 82.1, so2: 12.3, no2: 45.6, observedAt,
    },
    {
      stationId: 'w-2', stationName: 'Delhi ITO',
      city: 'Delhi', country: 'IN', lat: 28.63, lon: 77.24,
      aqi: 210, level: 'AQI_LEVEL_VERY_UNHEALTHY', dominantPollutant: 'pm25',
      pm25: 124.8, pm10: 178.2, so2: 18.4, no2: 67.2, observedAt,
    },
    {
      stationId: 'w-3', stationName: 'London Marylebone',
      city: 'London', country: 'GB', lat: 51.52, lon: -0.15,
      aqi: 42, level: 'AQI_LEVEL_GOOD', dominantPollutant: 'no2',
      pm25: 8.2, pm10: 14.5, so2: 2.1, no2: 28.4, observedAt,
    },
    {
      stationId: 'w-4', stationName: 'Tehran Darabad',
      city: 'Tehran', country: 'IR', lat: 35.84, lon: 51.48,
      aqi: 134, level: 'AQI_LEVEL_UNHEALTHY_SENSITIVE', dominantPollutant: 'pm25',
      pm25: 44.2, pm10: 68.3, so2: 9.8, no2: 52.1, observedAt,
    },
    {
      stationId: 'w-5', stationName: 'New York Queens',
      city: 'New York', country: 'US', lat: 40.73, lon: -73.85,
      aqi: 58, level: 'AQI_LEVEL_MODERATE', dominantPollutant: 'o3',
      pm25: 12.4, pm10: 18.7, so2: 1.8, no2: 22.3, observedAt,
    },
    {
      stationId: 'w-6', stationName: 'Riyadh South',
      city: 'Riyadh', country: 'SA', lat: 24.62, lon: 46.72,
      aqi: 88, level: 'AQI_LEVEL_MODERATE', dominantPollutant: 'pm25',
      pm25: 22.6, pm10: 89.4, so2: 5.2, no2: 18.7, observedAt,
    },
    {
      stationId: 'w-7', stationName: 'Lagos Mainland',
      city: 'Lagos', country: 'NG', lat: 6.46, lon: 3.37,
      aqi: 115, level: 'AQI_LEVEL_UNHEALTHY_SENSITIVE', dominantPollutant: 'pm10',
      pm25: 38.6, pm10: 92.3, so2: 7.4, no2: 31.5, observedAt,
    },
    {
      stationId: 'w-8', stationName: 'Jakarta Kemayoran',
      city: 'Jakarta', country: 'ID', lat: -6.16, lon: 106.85,
      aqi: 97, level: 'AQI_LEVEL_MODERATE', dominantPollutant: 'pm25',
      pm25: 28.3, pm10: 52.1, so2: 4.6, no2: 35.8, observedAt,
    },
  ];
}

export const listAirQualityReadings: ClimateServiceHandler['listAirQualityReadings'] =
  async (
    _ctx: ServerContext,
    req: ListAirQualityReadingsRequest,
  ): Promise<ListAirQualityReadingsResponse> => {
    const token = process.env['WAQI_API_TOKEN'];
    const limit = req.limit || 200;

    if (!token) {
      return {
        readings: syntheticReadings().slice(0, limit),
        fetchedAt: new Date().toISOString(),
      };
    }

    // 5 strategic bounding boxes: latlng = latMin,lonMin,latMax,lonMax
    const BOUNDING_BOXES = [
      '12,25,40,60',   // Middle East
      '20,100,45,145', // East Asia
      '35,-10,60,40',  // Europe
      '25,-130,55,-60', // Americas
      '-35,10,35,55',  // Africa
    ];

    const settled = await Promise.allSettled(
      BOUNDING_BOXES.map((bb) => fetchWaqiBounds(bb, token)),
    );

    // Merge results, deduplicate by uid
    const seenUids = new Set<number>();
    const merged: WaqiStation[] = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const station of result.value) {
        if (!seenUids.has(station.uid)) {
          seenUids.add(station.uid);
          merged.push(station);
        }
      }
    }

    // Convert to AirQualityReading, filter nulls, apply limit
    const readings: AirQualityReading[] = [];
    for (const station of merged) {
      if (readings.length >= limit) break;
      const reading = waqiToReading(station);
      if (reading != null) readings.push(reading);
    }

    // Fall back to synthetic if the API returned nothing useful
    if (readings.length === 0) {
      return {
        readings: syntheticReadings().slice(0, limit),
        fetchedAt: new Date().toISOString(),
      };
    }

    return {
      readings,
      fetchedAt: new Date().toISOString(),
    };
  };
