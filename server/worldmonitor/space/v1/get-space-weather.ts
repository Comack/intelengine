declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  GetSpaceWeatherRequest,
  GetSpaceWeatherResponse,
  SpaceWeatherAlert,
} from '../../../../src/generated/server/worldmonitor/space/v1/service_server';

const FALLBACK: GetSpaceWeatherResponse = {
  status: {
    kpIndex: 0,
    kpLevel: 'quiet',
    xrayClass: 'A',
    xrayFlux: 0,
    auroraLatNorth: 66,
    auroraLatSouth: -60,
    alerts: [],
    observedAt: String(Date.now()),
  },
};

function kpToLevel(kp: number): string {
  if (kp >= 9) return 'extreme';
  if (kp >= 8) return 'severe';
  if (kp >= 7) return 'strong_storm';
  if (kp >= 6) return 'moderate_storm';
  if (kp >= 5) return 'minor_storm';
  if (kp >= 4) return 'active';
  if (kp >= 3) return 'unsettled';
  return 'quiet';
}

function classifyXray(flux: number): string {
  if (flux >= 1e-4) return 'X';
  if (flux >= 1e-5) return 'M';
  if (flux >= 1e-6) return 'C';
  if (flux >= 1e-7) return 'B';
  return 'A';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseAlertType(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('geomagnetic') || lower.includes('kp') || lower.includes('storm')) {
    return 'geomagnetic_storm';
  }
  if (lower.includes('solar flare') || lower.includes('flare') || lower.includes('x-ray')) {
    return 'solar_flare';
  }
  if (lower.includes('radio') || lower.includes('blackout')) {
    return 'radio_blackout';
  }
  return 'general';
}

function parseAlertSeverity(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('extreme') || lower.includes('g5') || lower.includes('x5') || lower.includes('r5')) {
    return 'extreme';
  }
  if (lower.includes('severe') || lower.includes('g4') || lower.includes('x3') || lower.includes('r4')) {
    return 'severe';
  }
  if (lower.includes('strong') || lower.includes('g3') || lower.includes('x1') || lower.includes('r3')) {
    return 'strong';
  }
  if (lower.includes('moderate') || lower.includes('g2') || lower.includes('m5') || lower.includes('r2')) {
    return 'moderate';
  }
  return 'minor';
}

interface KpRecord {
  kp_index?: string | number;
  estimated_kp?: number;
}

interface XrayRecord {
  energy?: string;
  flux?: number;
  time_tag?: string;
}

interface AlertRecord {
  message?: string;
  issue_datetime?: string;
}

export async function getSpaceWeather(
  _ctx: ServerContext,
  _req: GetSpaceWeatherRequest,
): Promise<GetSpaceWeatherResponse> {
  try {
    const timeout = 8000;

    const kpController = new AbortController();
    const xrayController = new AbortController();
    const alertsController = new AbortController();

    const kpTimer = setTimeout(() => kpController.abort(), timeout);
    const xrayTimer = setTimeout(() => xrayController.abort(), timeout);
    const alertsTimer = setTimeout(() => alertsController.abort(), timeout);

    const [kpRes, xrayRes, alertsRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', {
        signal: kpController.signal,
      }),
      fetch('https://services.swpc.noaa.gov/json/goes/primary/xray-fluxes-7-day.json', {
        signal: xrayController.signal,
      }),
      fetch('https://services.swpc.noaa.gov/json/alerts.json', {
        signal: alertsController.signal,
      }),
    ]);

    clearTimeout(kpTimer);
    clearTimeout(xrayTimer);
    clearTimeout(alertsTimer);

    // Parse Kp index
    let kp = 0;
    if (kpRes.status === 'fulfilled' && kpRes.value.ok) {
      try {
        const kpData: KpRecord[] = await kpRes.value.json();
        if (Array.isArray(kpData) && kpData.length > 0) {
          const last: KpRecord | undefined = kpData[kpData.length - 1];
          if (last !== undefined) {
            const raw = last.estimated_kp ?? Number(last.kp_index ?? 0);
            kp = isFinite(raw) ? clamp(raw, 0, 9) : 0;
          }
        }
      } catch {
        // leave kp = 0
      }
    }

    // Parse X-ray flux
    let xrayFlux = 0;
    if (xrayRes.status === 'fulfilled' && xrayRes.value.ok) {
      try {
        const xrayData: XrayRecord[] = await xrayRes.value.json();
        if (Array.isArray(xrayData)) {
          const primary = xrayData.filter((r) => r.energy === '0.1-0.8nm');
          const last: XrayRecord | undefined = primary[primary.length - 1];
          if (last !== undefined) {
            xrayFlux = typeof last.flux === 'number' && isFinite(last.flux) ? last.flux : 0;
          }
        }
      } catch {
        // leave xrayFlux = 0
      }
    }

    // Parse alerts
    const alerts: SpaceWeatherAlert[] = [];
    if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
      try {
        const alertsData: AlertRecord[] = await alertsRes.value.json();
        if (Array.isArray(alertsData)) {
          const recentAlerts = alertsData.slice(0, 5);
          for (const a of recentAlerts) {
            const message = a.message ?? '';
            alerts.push({
              type: parseAlertType(message),
              severity: parseAlertSeverity(message),
              message: message.slice(0, 500),
            });
          }
        }
      } catch {
        // leave alerts = []
      }
    }

    // Compute aurora latitudes from Kp
    const auroraLatNorth = clamp(66 - (kp - 1) * 3, 30, 70);
    const auroraLatSouth = clamp(-60 + (kp - 1) * 3, -70, -30);

    return {
      status: {
        kpIndex: kp,
        kpLevel: kpToLevel(kp),
        xrayClass: classifyXray(xrayFlux),
        xrayFlux,
        auroraLatNorth,
        auroraLatSouth,
        alerts,
        observedAt: String(Date.now()),
      },
    };
  } catch {
    return { ...FALLBACK, status: { ...FALLBACK.status!, observedAt: String(Date.now()) } };
  }
}

void process;
