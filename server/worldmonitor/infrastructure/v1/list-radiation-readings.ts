import type { InfrastructureServiceHandler } from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

const SAFECAST_API = 'https://api.safecast.org/measurements.json';
const NORMAL_CPM_THRESHOLD = 100; // Typical background is 10-60 CPM; above 100 is elevated

export const listRadiationReadings: InfrastructureServiceHandler['listRadiationReadings'] = async (_ctx, req) => {
  const limit = Number(req.limit) || 100;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `${SAFECAST_API}?order=captured_at+desc&per_page=${Math.min(limit, 500)}&since=${since}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[Radiation] Safecast API returned ${response.status}`);
      return { readings: [] };
    }

    const data = (await response.json()) as any[];

    const readings = (data ?? []).slice(0, limit).map((m: any) => ({
      id: String(m.id ?? ''),
      latitude: Number(m.latitude ?? 0),
      longitude: Number(m.longitude ?? 0),
      cpm: Number(m.value ?? 0),
      capturedAt: m.captured_at ? new Date(m.captured_at).getTime() : 0,
      deviceId: String(m.device_id ?? ''),
      locationName: String(m.location_name ?? ''),
      elevated: Number(m.value ?? 0) > NORMAL_CPM_THRESHOLD,
    }));

    return { readings };
  } catch (err) {
    console.warn('[Radiation] Safecast fetch failed:', err);
    return { readings: [] };
  }
};
