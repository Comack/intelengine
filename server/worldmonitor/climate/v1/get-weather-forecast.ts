/**
 * GetWeatherForecast RPC -- fetches 7-day precipitation and wind forecasts
 * from the Open-Meteo free API for 15 strategically important locations.
 * Computes a flood risk score and identifies extreme event types.
 * Open-Meteo requires no API key.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ClimateServiceHandler,
  ServerContext,
  GetWeatherForecastRequest,
  GetWeatherForecastResponse,
  WeatherForecastZone,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

const STRATEGIC_LOCATIONS: { lat: number; lon: number; name: string }[] = [
  { lat: 30.0, lon: 31.2,   name: 'Nile Delta (Egypt)' },
  { lat: 13.5, lon: 2.1,    name: 'Sahel (Niger)' },
  { lat: 20.0, lon: 75.0,   name: 'Deccan Plateau (India)' },
  { lat: 35.7, lon: 51.4,   name: 'Tehran Basin (Iran)' },
  { lat: 48.5, lon: 31.0,   name: 'Ukraine Wheat Belt' },
  { lat: -8.0, lon: -60.0,  name: 'Amazon Basin (Brazil)' },
  { lat: 15.0, lon: 100.0,  name: 'Mekong Delta (SE Asia)' },
  { lat: 1.0,  lon: 32.0,   name: 'East Africa (Uganda)' },
  { lat: 25.0, lon: 90.0,   name: 'Bangladesh (Flood Risk)' },
  { lat: 29.0, lon: 48.0,   name: 'Kuwait (Extreme Heat)' },
  { lat: 37.9, lon: 23.7,   name: 'Athens (Wildfire Risk)' },
  { lat: -29.0, lon: 26.0,  name: 'South Africa (Drought)' },
  { lat: 18.5, lon: -72.3,  name: 'Haiti (Hurricane Risk)' },
  { lat: 45.0, lon: 60.0,   name: 'Central Asia Steppe' },
  { lat: -6.2, lon: 106.8,  name: 'Jakarta (Flooding)' },
];

interface OpenMeteoDaily {
  time: string[];
  precipitation_sum: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  precipitation_probability_max: (number | null)[];
}

interface OpenMeteoResponse {
  daily: OpenMeteoDaily;
}

/** Sum an array, treating nulls as zero. */
function sumNullable(arr: (number | null)[]): number {
  return arr.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/** Max of an array, treating nulls as zero. */
function maxNullable(arr: (number | null)[]): number {
  return arr.reduce<number>((m, v) => Math.max(m, v ?? 0), 0);
}

/** Classify extreme event type based on forecast metrics. */
function classifyExtremeEvent(
  floodRiskScore: number,
  maxWindKmh: number,
): string {
  if (maxWindKmh >= 120) return 'hurricane';
  if (floodRiskScore > 70) return 'flood';
  if (maxWindKmh >= 80) return 'storm';
  return 'none';
}

/** Fetch a single location from Open-Meteo and build a WeatherForecastZone. */
async function fetchLocation(loc: {
  lat: number;
  lon: number;
  name: string;
}): Promise<WeatherForecastZone> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&daily=precipitation_sum,wind_speed_10m_max,precipitation_probability_max` +
    `&forecast_days=7&timezone=UTC`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo ${response.status} for ${loc.name}`);
  }

  const data = await response.json() as OpenMeteoResponse;
  const daily = data.daily;

  const precipitation7d = sumNullable(daily.precipitation_sum);
  const maxWindSpeedKmh = maxNullable(daily.wind_speed_10m_max);
  const maxPrecipProb = maxNullable(daily.precipitation_probability_max);

  const floodRiskScore = Math.min(
    100,
    (precipitation7d / 100) * 60 + (maxPrecipProb / 100) * 40,
  );

  const now = Date.now();
  return {
    lat: loc.lat,
    lon: loc.lon,
    locationName: loc.name,
    precipitationMm7d: Math.round(precipitation7d * 10) / 10,
    floodRiskScore: Math.round(floodRiskScore * 10) / 10,
    maxWindSpeedKmh: Math.round(maxWindSpeedKmh * 10) / 10,
    extremeEventType: classifyExtremeEvent(floodRiskScore, maxWindSpeedKmh),
    forecastFrom: new Date(now).toISOString(),
    forecastUntil: new Date(now + 7 * 86_400_000).toISOString(),
  };
}

export const getWeatherForecast: ClimateServiceHandler['getWeatherForecast'] = async (
  _ctx: ServerContext,
  _req: GetWeatherForecastRequest,
): Promise<GetWeatherForecastResponse> => {
  const results = await Promise.allSettled(
    STRATEGIC_LOCATIONS.map((loc) => fetchLocation(loc)),
  );

  const zones: WeatherForecastZone[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      zones.push(result.value);
    } else {
      const reason = result.reason;
      console.error(
        '[CLIMATE] getWeatherForecast location error:',
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  }

  return {
    zones,
    fetchedAt: new Date().toISOString(),
  };
};
