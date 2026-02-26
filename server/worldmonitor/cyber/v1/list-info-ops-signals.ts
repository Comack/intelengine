/**
 * RPC: listInfoOpsSignals -- Wikipedia edit-war / information operations signal feed
 * Source: WS relay server with synthetic fallback
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListInfoOpsSignalsRequest,
  ListInfoOpsSignalsResponse,
  InfoOpsSignal,
} from '../../../../src/generated/server/worldmonitor/cyber/v1/service_server';

const SYNTHETIC_SIGNALS: InfoOpsSignal[] = [
  {
    id: 'io-001',
    pageTitle: 'Russia\u2013Ukraine war',
    wiki: 'enwiki',
    editType: 'edit_war',
    editCount1h: 28,
    uniqueEditors1h: 12,
    botTraffic: false,
    geopoliticalRelevance: 0.94,
    matchedEntity: 'Ukraine',
    detectedAt: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: 'io-002',
    pageTitle: 'Taiwan',
    wiki: 'enwiki',
    editType: 'rapid_revert',
    editCount1h: 22,
    uniqueEditors1h: 8,
    botTraffic: true,
    geopoliticalRelevance: 0.89,
    matchedEntity: 'Taiwan',
    detectedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'io-003',
    pageTitle: 'Gaza Strip',
    wiki: 'enwiki',
    editType: 'edit_war',
    editCount1h: 35,
    uniqueEditors1h: 15,
    botTraffic: false,
    geopoliticalRelevance: 0.91,
    matchedEntity: 'Gaza',
    detectedAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export async function listInfoOpsSignals(
  _ctx: ServerContext,
  req: ListInfoOpsSignalsRequest,
): Promise<ListInfoOpsSignalsResponse> {
  const relayUrl = process.env.WS_RELAY_URL || 'http://localhost:3004';
  const limit = req.limit || 100;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${relayUrl}/info-ops/recent?limit=${limit}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as unknown[];
      if (Array.isArray(data)) {
        const signals: InfoOpsSignal[] = data.map((item: unknown): InfoOpsSignal => {
          const s = item as Record<string, unknown>;
          return {
            id: typeof s['id'] === 'string' ? s['id'] : String(s['id'] ?? ''),
            pageTitle: typeof s['pageTitle'] === 'string' ? s['pageTitle'] : '',
            wiki: typeof s['wiki'] === 'string' ? s['wiki'] : '',
            editType: typeof s['editType'] === 'string' ? s['editType'] : '',
            editCount1h: typeof s['editCount1h'] === 'number' ? s['editCount1h'] : 0,
            uniqueEditors1h: typeof s['uniqueEditors1h'] === 'number' ? s['uniqueEditors1h'] : 0,
            botTraffic: typeof s['botTraffic'] === 'boolean' ? s['botTraffic'] : false,
            geopoliticalRelevance: typeof s['geopoliticalRelevance'] === 'number' ? s['geopoliticalRelevance'] : 0,
            matchedEntity: typeof s['matchedEntity'] === 'string' ? s['matchedEntity'] : '',
            detectedAt: typeof s['detectedAt'] === 'string'
              ? s['detectedAt']
              : new Date(typeof s['detectedAt'] === 'number' ? s['detectedAt'] : Date.now()).toISOString(),
          };
        });
        return { signals, sampledAt: new Date().toISOString() };
      }
    }
  } catch {
    // relay unavailable — fall through to synthetic
  }

  return {
    signals: SYNTHETIC_SIGNALS.slice(0, limit),
    sampledAt: new Date().toISOString(),
  };
}
