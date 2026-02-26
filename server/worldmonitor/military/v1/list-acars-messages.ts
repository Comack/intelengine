/**
 * RPC: listAcarsMessages -- Military ACARS message feed
 * Source: WS relay server (Airframes.io) with synthetic fallback
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListAcarsMessagesRequest,
  ListAcarsMessagesResponse,
  AcarsMessage,
  AcarsMilCategory,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

function classifyMilCategory(messageText: string): AcarsMilCategory {
  if (/MEDIVAC|EVAC|DUSTOFF/i.test(messageText)) return 'ACARS_MIL_CATEGORY_MEDICAL_EVAC';
  if (/STRIKE|WEAPON|LOAD|TARGET/i.test(messageText)) return 'ACARS_MIL_CATEGORY_TACTICAL';
  if (/CARGO|PALLETS|AIRLIFT|REACH\d+/i.test(messageText)) return 'ACARS_MIL_CATEGORY_LOGISTICS';
  return 'ACARS_MIL_CATEGORY_UNKNOWN';
}

const SYNTHETIC_MESSAGES: AcarsMessage[] = [
  {
    id: 'acars-001',
    tailNumber: 'RCH123',
    flightNumber: 'RCH123',
    messageText: 'CARGO PALLETS 24EA/AIRLIFT MISSION REACH123',
    messageType: 'FREEFMT',
    milCategory: 'ACARS_MIL_CATEGORY_LOGISTICS',
    lat: 38.9,
    lon: -77.0,
    altitudeFt: 35000,
    freqMhz: '129.125',
    receivedAt: new Date(Date.now() - 1800000).toISOString(),
    station: 'KIAD',
  },
  {
    id: 'acars-002',
    tailNumber: 'EVAC42',
    flightNumber: 'EVAC42',
    messageText: 'MEDIVAC PATIENT TRANSPORT DUSTOFF ALPHA',
    messageType: 'FREEFMT',
    milCategory: 'ACARS_MIL_CATEGORY_MEDICAL_EVAC',
    lat: 49.5,
    lon: 8.4,
    altitudeFt: 25000,
    freqMhz: '136.900',
    receivedAt: new Date(Date.now() - 3600000).toISOString(),
    station: 'EDDF',
  },
  {
    id: 'acars-003',
    tailNumber: 'PAT001',
    flightNumber: '',
    messageText: 'OOOI OUT1342 OFF1358 ETA 1715',
    messageType: 'OOOI',
    milCategory: 'ACARS_MIL_CATEGORY_UNKNOWN',
    lat: 51.5,
    lon: -0.5,
    altitudeFt: 38000,
    freqMhz: '131.550',
    receivedAt: new Date(Date.now() - 900000).toISOString(),
    station: 'EGLL',
  },
  {
    id: 'acars-004',
    tailNumber: 'PRED77',
    flightNumber: 'PRED77',
    messageText: 'STRIKE PACKAGE ALPHA WEAPONS HOT TARGET CONFIRMED',
    messageType: 'FREEFMT',
    milCategory: 'ACARS_MIL_CATEGORY_TACTICAL',
    lat: 35.1,
    lon: 38.8,
    altitudeFt: 20000,
    freqMhz: '129.125',
    receivedAt: new Date(Date.now() - 5400000).toISOString(),
    station: 'UDSC',
  },
  {
    id: 'acars-005',
    tailNumber: 'C5M001',
    flightNumber: 'REACH500',
    messageText: 'AIRLIFT REACH500 CARGO PALLETS 48EA VEHICLE 2EA',
    messageType: 'FREEFMT',
    milCategory: 'ACARS_MIL_CATEGORY_LOGISTICS',
    lat: 37.7,
    lon: 126.4,
    altitudeFt: 31000,
    freqMhz: '129.125',
    receivedAt: new Date(Date.now() - 7200000).toISOString(),
    station: 'RKSO',
  },
];

export async function listAcarsMessages(
  _ctx: ServerContext,
  req: ListAcarsMessagesRequest,
): Promise<ListAcarsMessagesResponse> {
  const apiKey = process.env.AIRFRAMES_API_KEY;
  const relayUrl = process.env.WS_RELAY_URL || 'http://localhost:3004';
  const limit = Math.min(req.limit || 100, 500);

  let messages: AcarsMessage[] = [];
  let usedRelay = false;

  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `${relayUrl}/acars/recent?limit=${limit}`,
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as unknown[];
        if (Array.isArray(data)) {
          messages = data.map((item: unknown): AcarsMessage => {
            const m = item as Record<string, unknown>;
            const text = typeof m['messageText'] === 'string' ? m['messageText'] : '';
            return {
              id: typeof m['id'] === 'string' ? m['id'] : String(m['id'] ?? ''),
              tailNumber: typeof m['tailNumber'] === 'string' ? m['tailNumber'] : '',
              flightNumber: typeof m['flightNumber'] === 'string' ? m['flightNumber'] : '',
              messageText: text,
              messageType: typeof m['messageType'] === 'string' ? m['messageType'] : '',
              milCategory: classifyMilCategory(text),
              lat: typeof m['lat'] === 'number' ? m['lat'] : 0,
              lon: typeof m['lon'] === 'number' ? m['lon'] : 0,
              altitudeFt: typeof m['altitudeFt'] === 'number' ? m['altitudeFt'] : 0,
              freqMhz: typeof m['freqMhz'] === 'string' ? m['freqMhz'] : '',
              receivedAt: typeof m['receivedAt'] === 'string'
                ? m['receivedAt']
                : new Date(typeof m['receivedAt'] === 'number' ? m['receivedAt'] : Date.now()).toISOString(),
              station: typeof m['station'] === 'string' ? m['station'] : '',
            };
          });
          usedRelay = true;
        }
      }
    } catch {
      // relay unavailable — fall through to synthetic
    }
  }

  if (!usedRelay) {
    messages = SYNTHETIC_MESSAGES.slice(0, limit);
  }

  // Apply milCategory filter if not UNSPECIFIED
  if (req.milCategory && req.milCategory !== 'ACARS_MIL_CATEGORY_UNSPECIFIED') {
    messages = messages.filter(m => m.milCategory === req.milCategory);
  }

  return {
    messages,
    sampledAt: new Date().toISOString(),
  };
}
