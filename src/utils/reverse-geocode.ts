/**
 * Reverse geocoding using Nominatim (OpenStreetMap) - free, no API key
 * Converts lat/lon to country name + ISO code
 */

export interface GeoResult {
  country: string;
  code: string; // ISO 3166-1 alpha-2 (e.g. "IR", "US")
  displayName: string;
}

const GEOCODE_CACHE_MAX = 500;
const cache = new Map<string, { result: GeoResult | null; timestamp: number }>();
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1100; // Nominatim: max 1 req/sec

function evictOldestGeocodeEntry(): void {
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, entry] of cache) {
    if (entry.timestamp < oldestTs) {
      oldestTs = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

function cacheKey(lat: number, lon: number): string {
  // Round to ~11km grid to avoid duplicate calls for nearby clicks
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

function setGeocodeCache(key: string, result: GeoResult | null): void {
  if (cache.size >= GEOCODE_CACHE_MAX) evictOldestGeocodeEntry();
  cache.set(key, { result, timestamp: Date.now() });
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeoResult | null> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached !== undefined) return cached.result;

  // Throttle — reserve the slot synchronously to prevent concurrent callers
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestTime);
  lastRequestTime = now + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3&accept-language=en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WorldMonitor/2.0 (https://worldmonitor.app)' },
    });
    if (!res.ok) {
      setGeocodeCache(key, null);
      return null;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      setGeocodeCache(key, null);
      return null;
    }
    const country = data.address?.country;
    const code = data.address?.country_code?.toUpperCase();

    if (!country || !code) {
      setGeocodeCache(key, null);
      return null;
    }

    const result: GeoResult = { country, code, displayName: data.display_name || country };
    setGeocodeCache(key, result);
    return result;
  } catch (err) {
    console.warn('[reverseGeocode] Failed:', err);
    setGeocodeCache(key, null);
    return null;
  }
}
