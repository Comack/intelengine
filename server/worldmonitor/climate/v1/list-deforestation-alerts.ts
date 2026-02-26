/**
 * ListDeforestationAlerts RPC -- returns deforestation alert data from the
 * Global Forest Watch (GFW) Data API when an API key is configured, falling
 * back to 8 synthetic alerts covering major tropical forest regions.
 *
 * Supports filtering by strategicOnly and applying a result limit.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ClimateServiceHandler,
  ServerContext,
  ListDeforestationAlertsRequest,
  ListDeforestationAlertsResponse,
  DeforestationAlert,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

/** GFW Data API query endpoint for integrated alerts. */
const GFW_API_BASE =
  'https://data-api.globalforestwatch.org/dataset/gfw_integrated_alerts/latest/query';

interface GfwFeature {
  attributes: {
    latitude: number;
    longitude: number;
    area__ha: number;
    alert_date: string;
    confidence: string;
    country_iso3: string;
    subnational1: string;
  };
}

interface GfwResponse {
  data: GfwFeature[];
}

/** Map GFW confidence strings to a 0–1 float. */
function mapConfidence(raw: string): number {
  if (raw === 'highest') return 0.95;
  if (raw === 'high') return 0.80;
  if (raw === 'medium') return 0.65;
  return 0.50;
}

/** Attempt to fetch real deforestation data from GFW when an API key is present. */
async function fetchFromGfw(
  apiKey: string,
  req: ListDeforestationAlertsRequest,
): Promise<DeforestationAlert[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const sql = `SELECT latitude, longitude, area__ha, alert_date, confidence, country_iso3, subnational1 FROM data WHERE alert_date >= '${thirtyDaysAgo}' ORDER BY area__ha DESC LIMIT ${req.limit || 50}`;

  const url = `${GFW_API_BASE}?sql=${encodeURIComponent(sql)}`;

  const response = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`GFW API ${response.status}`);
  }

  const json = await response.json() as GfwResponse;
  if (!Array.isArray(json.data)) return [];

  return json.data.map<DeforestationAlert>((feat, i) => {
    const attr = feat.attributes;
    return {
      id: `gfw-live-${i + 1}`,
      lat: attr.latitude,
      lon: attr.longitude,
      areaHa: attr.area__ha,
      alertType: 'GLAD-L',
      country: attr.country_iso3,
      region: attr.subnational1 ?? '',
      confidence: mapConfidence(attr.confidence),
      nearStrategicSite: false,
      detectedAt: new Date(attr.alert_date).toISOString(),
    };
  });
}

/** Synthetic fallback alerts covering key deforestation hotspots. */
function syntheticAlerts(): DeforestationAlert[] {
  const now = Date.now();
  return [
    {
      id: 'gfw-001', lat: -3.1, lon: -60.0, areaHa: 450.2,
      alertType: 'GLAD-L', country: 'BR', region: 'Amazonas',
      confidence: 0.92, nearStrategicSite: false,
      detectedAt: new Date(now - 172_800_000).toISOString(),
    },
    {
      id: 'gfw-002', lat: 0.5, lon: 24.2, areaHa: 320.7,
      alertType: 'RADD', country: 'CD', region: 'Équateur',
      confidence: 0.78, nearStrategicSite: false,
      detectedAt: new Date(now - 259_200_000).toISOString(),
    },
    {
      id: 'gfw-003', lat: 1.4, lon: 109.5, areaHa: 185.4,
      alertType: 'GLAD-S2', country: 'MY', region: 'Sarawak',
      confidence: 0.88, nearStrategicSite: true,
      detectedAt: new Date(now - 345_600_000).toISOString(),
    },
    {
      id: 'gfw-004', lat: -8.5, lon: -74.2, areaHa: 680.1,
      alertType: 'GLAD-L', country: 'PE', region: 'Ucayali',
      confidence: 0.94, nearStrategicSite: false,
      detectedAt: new Date(now - 432_000_000).toISOString(),
    },
    {
      id: 'gfw-005', lat: 5.1, lon: -1.2, areaHa: 124.8,
      alertType: 'RADD', country: 'GH', region: 'Western Region',
      confidence: 0.71, nearStrategicSite: true,
      detectedAt: new Date(now - 518_400_000).toISOString(),
    },
    {
      id: 'gfw-006', lat: -1.5, lon: 136.2, areaHa: 238.3,
      alertType: 'GLAD-S2', country: 'ID', region: 'Papua',
      confidence: 0.85, nearStrategicSite: false,
      detectedAt: new Date(now - 604_800_000).toISOString(),
    },
    {
      id: 'gfw-007', lat: 3.8, lon: 11.5, areaHa: 97.6,
      alertType: 'RADD', country: 'CM', region: 'Centre',
      confidence: 0.68, nearStrategicSite: false,
      detectedAt: new Date(now - 691_200_000).toISOString(),
    },
    {
      id: 'gfw-008', lat: -12.4, lon: -50.1, areaHa: 512.0,
      alertType: 'GLAD-L', country: 'BR', region: 'Mato Grosso',
      confidence: 0.96, nearStrategicSite: true,
      detectedAt: new Date(now - 777_600_000).toISOString(),
    },
  ];
}

export const listDeforestationAlerts: ClimateServiceHandler['listDeforestationAlerts'] =
  async (
    _ctx: ServerContext,
    req: ListDeforestationAlertsRequest,
  ): Promise<ListDeforestationAlertsResponse> => {
    const apiKey = process.env['GLOBAL_FOREST_WATCH_API_KEY'];
    const limit = req.limit || 50;

    let alerts: DeforestationAlert[] = [];

    if (apiKey) {
      try {
        alerts = await fetchFromGfw(apiKey, req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[CLIMATE] GFW fetch failed, using synthetic data:', msg);
      }
    }

    // Use synthetic data if GFW fetch failed or no API key
    if (alerts.length === 0) {
      alerts = syntheticAlerts();
    }

    // Apply strategicOnly filter
    if (req.strategicOnly) {
      alerts = alerts.filter((a) => a.nearStrategicSite);
    }

    // Apply limit
    alerts = alerts.slice(0, limit);

    return {
      alerts,
      fetchedAt: new Date().toISOString(),
    };
  };
