declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListRoutingAnomaliesRequest,
  ListRoutingAnomaliesResponse,
  RoutingAnomaly,
  RoutingAnomalyType,
} from '../../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';

// ========================================================================
// Constants
// ========================================================================

const BGPSTREAM_URL = 'https://bgpstream.caida.org/api/v2/events';
const TIMEOUT_MS = 10_000;

// ========================================================================
// Country coordinate lookup for top ASN countries
// ========================================================================

const COUNTRY_COORDS: Record<string, { lat: number; lon: number; code: string }> = {
  'United States': { lat: 38.9, lon: -77.0, code: 'US' },
  'China': { lat: 39.9, lon: 116.4, code: 'CN' },
  'Russia': { lat: 55.7, lon: 37.6, code: 'RU' },
  'Germany': { lat: 52.5, lon: 13.4, code: 'DE' },
  'United Kingdom': { lat: 51.5, lon: -0.1, code: 'GB' },
  'Netherlands': { lat: 52.4, lon: 4.9, code: 'NL' },
  'Brazil': { lat: -15.8, lon: -47.9, code: 'BR' },
  'India': { lat: 28.6, lon: 77.2, code: 'IN' },
};

// ========================================================================
// BGPStream API types
// ========================================================================

interface BgpStreamEvent {
  eventType: string;
  detectedAt: string;
  summary?: {
    prefixes?: string[];
    victimAsn?: number;
    attackerAsn?: number;
    victimAsnName?: string;
    attackerAsnName?: string;
  };
}

interface BgpStreamResponse {
  data?: {
    events?: BgpStreamEvent[];
  };
}

// ========================================================================
// Helpers
// ========================================================================

function mapEventType(eventType: string): RoutingAnomalyType {
  if (eventType === 'HIJACK') return 'ROUTING_ANOMALY_TYPE_BGP_HIJACK';
  if (eventType === 'LEAK') return 'ROUTING_ANOMALY_TYPE_BGP_LEAK';
  return 'ROUTING_ANOMALY_TYPE_ROUTE_FLAP';
}

function getPrefixSeverity(prefix: string): string {
  const match = /\/(\d+)$/.exec(prefix);
  if (!match || match[1] === undefined) return 'low';
  const bits = parseInt(match[1], 10);
  if (bits >= 24) return 'high';
  if (bits >= 16) return 'medium';
  return 'low';
}

function lookupCountry(asnName: string | undefined): { lat: number; lon: number; code: string } {
  if (!asnName) return { lat: 0, lon: 0, code: '' };
  for (const [country, coords] of Object.entries(COUNTRY_COORDS)) {
    if (asnName.toLowerCase().includes(country.toLowerCase())) {
      return coords;
    }
  }
  return { lat: 0, lon: 0, code: '' };
}

// ========================================================================
// RPC implementation
// ========================================================================

export async function listRoutingAnomalies(
  _ctx: ServerContext,
  req: ListRoutingAnomaliesRequest,
): Promise<ListRoutingAnomaliesResponse> {
  try {
    const limit = Math.min(req.limit || 50, 200);
    const url = `${BGPSTREAM_URL}?type=hijack,leak&limit=${limit}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      return { anomalies: [] };
    }

    const data: BgpStreamResponse = await response.json();
    const events = data?.data?.events ?? [];

    const anomalies: RoutingAnomaly[] = events.map((event, idx) => {
      const prefixes = event.summary?.prefixes ?? [];
      const firstPrefix = prefixes[0] ?? '';
      const severity = getPrefixSeverity(firstPrefix);
      const victimName = event.summary?.victimAsnName ?? '';
      const attackerName = event.summary?.attackerAsnName ?? '';
      const coords = lookupCountry(victimName) || lookupCountry(attackerName);
      const anomalyType = mapEventType(event.eventType ?? '');

      const victimAsn = event.summary?.victimAsn;
      const attackerAsn = event.summary?.attackerAsn;

      const description = [
        anomalyType === 'ROUTING_ANOMALY_TYPE_BGP_HIJACK' ? 'BGP hijack detected' : '',
        anomalyType === 'ROUTING_ANOMALY_TYPE_BGP_LEAK' ? 'BGP route leak detected' : '',
        anomalyType === 'ROUTING_ANOMALY_TYPE_ROUTE_FLAP' ? 'Route flap detected' : '',
        prefixes.length > 0 ? `affecting prefixes: ${prefixes.slice(0, 3).join(', ')}` : '',
      ].filter(Boolean).join(' ');

      return {
        id: `bgp-${event.detectedAt}-${idx}`,
        type: anomalyType,
        prefix: firstPrefix,
        victimAsn: victimAsn !== undefined ? String(victimAsn) : '',
        attackerAsn: attackerAsn !== undefined ? String(attackerAsn) : '',
        victimName,
        attackerName,
        country: coords.code,
        lat: coords.lat,
        lon: coords.lon,
        severity,
        detectedAt: event.detectedAt ?? '',
        description,
      };
    });

    return { anomalies };
  } catch {
    return { anomalies: [] };
  }
}
