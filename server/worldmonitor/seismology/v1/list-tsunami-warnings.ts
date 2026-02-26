/**
 * ListTsunamiWarnings RPC -- proxies the NWS Alerts API for tsunami events.
 *
 * Fetches active tsunami warnings, watches, and advisories from the
 * NOAA/NWS public alerts API and transforms them into proto-shaped objects.
 */

import type {
  SeismologyServiceHandler,
  ServerContext,
  ListTsunamiWarningsRequest,
  ListTsunamiWarningsResponse,
} from '../../../../src/generated/server/worldmonitor/seismology/v1/service_server';

import { getCachedJson, setCachedJson } from '../../../_shared/redis';

const NWS_TSUNAMI_URL =
  'https://api.weather.gov/alerts/active?event=Tsunami%20Warning,Tsunami%20Watch,Tsunami%20Advisory';
const CACHE_KEY = 'seismology:tsunami-warnings:v1';
const CACHE_TTL = 120; // 2 minutes

export const listTsunamiWarnings: SeismologyServiceHandler['listTsunamiWarnings'] = async (
  _ctx: ServerContext,
  _req: ListTsunamiWarningsRequest,
): Promise<ListTsunamiWarningsResponse> => {
  // Check Redis cache first
  const cached = (await getCachedJson(CACHE_KEY)) as { warnings: ListTsunamiWarningsResponse['warnings'] } | null;
  if (cached?.warnings) {
    return { warnings: cached.warnings };
  }

  try {
    const response = await fetch(NWS_TSUNAMI_URL, {
      headers: {
        'User-Agent': 'WorldMonitor/1.0',
        Accept: 'application/geo+json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[Tsunami] NWS API returned ${response.status}`);
      return { warnings: [] };
    }

    const data: any = await response.json();
    const features: any[] = data?.features ?? [];

    const warnings = features
      .filter((f: any) => f?.properties)
      .map((f: any) => {
        const props = f.properties ?? {};
        return {
          id: (props.id as string) || '',
          headline: (props.headline as string) || '',
          severity: (props.severity as string) || '',
          urgency: (props.urgency as string) || '',
          areaDesc: (props.areaDesc as string) || '',
          onset: props.onset ? new Date(props.onset as string).getTime() : 0,
          expires: props.expires ? new Date(props.expires as string).getTime() : 0,
          description: ((props.description as string) || '').slice(0, 2000),
          sender: (props.senderName as string) || 'NWS',
          event: (props.event as string) || '',
        };
      });

    await setCachedJson(CACHE_KEY, { warnings }, CACHE_TTL);

    return { warnings };
  } catch (err) {
    console.warn('[Tsunami] Failed to fetch warnings:', err);
    return { warnings: [] };
  }
};
