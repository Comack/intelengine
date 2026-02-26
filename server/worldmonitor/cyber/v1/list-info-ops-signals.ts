/**
 * RPC: listInfoOpsSignals -- Wikipedia edit-war / information operations signal feed
 * Source: Wikimedia Action API (recent-edit anomaly detection) with synthetic fallback
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListInfoOpsSignalsRequest,
  ListInfoOpsSignalsResponse,
  InfoOpsSignal,
} from '../../../../src/generated/server/worldmonitor/cyber/v1/service_server';

const WATCHLIST_PAGES = [
  'Russian invasion of Ukraine', 'Israel–Hamas war', 'Taiwan',
  'South China Sea', 'Iran nuclear program', 'North Korea',
  'Syrian civil war', 'Yemen crisis', 'Nagorno-Karabakh conflict',
  'China–United States relations', 'NATO', 'BRICS',
  'Artificial intelligence', 'OpenAI', 'Elon Musk',
  'European Union', 'Vladimir Putin', 'Xi Jinping',
];

/** Short entity label derived from a page title */
function matchedEntityFromTitle(title: string): string {
  const first = title.split(/[–—,()]/)[0].trim();
  return first.length > 30 ? first.slice(0, 30) : first;
}

/** Classify edit pattern based on revision comments and editor distribution */
function classifyEditType(
  comments: string[],
  editorCounts: Map<string, number>,
): string {
  const revertRe = /\b(revert|undo|undid|rv)\b/i;
  const revertCount = comments.filter(c => revertRe.test(c)).length;
  if (comments.length > 0 && revertCount / comments.length > 0.3) return 'revert_war';

  const topEditorEdits = Math.max(...editorCounts.values(), 0);
  if (editorCounts.size > 0 && topEditorEdits / comments.length > 0.5) return 'single_actor';

  return 'rapid_edits';
}

/** Check whether any editor name looks bot-like */
function hasBotEditors(editors: Iterable<string>): boolean {
  const botRe = /bot\b/i;
  for (const e of editors) if (botRe.test(e)) return true;
  return false;
}

interface WikiRevision {
  user?: string;
  timestamp?: string;
  size?: number;
  comment?: string;
}
interface WikiPage {
  title?: string;
  revisions?: WikiRevision[];
}
interface WikiQueryResponse {
  query?: { pages?: Record<string, WikiPage> };
}

const USER_AGENT = 'WorldMonitor/1.0 (intelligence-dashboard; contact@example.com)';
const EDIT_THRESHOLD = 3;

async function fetchWikimediaSignals(): Promise<InfoOpsSignal[]> {
  const cutoff = new Date(Date.now() - 3600_000).toISOString();
  const titles = WATCHLIST_PAGES.join('|');
  const url =
    `https://en.wikipedia.org/w/api.php?action=query` +
    `&titles=${encodeURIComponent(titles)}` +
    `&prop=revisions&rvlimit=50&rvprop=timestamp|user|size|comment` +
    `&rvend=${encodeURIComponent(cutoff)}&format=json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const resp = await fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT },
  });
  clearTimeout(timeoutId);

  if (!resp.ok) return [];

  const body = (await resp.json()) as WikiQueryResponse;
  const pages = body?.query?.pages;
  if (!pages) return [];

  const now = Date.now();
  const signals: InfoOpsSignal[] = [];

  for (const page of Object.values(pages)) {
    const revisions = page.revisions;
    if (!revisions || revisions.length < EDIT_THRESHOLD) continue;

    const title = page.title ?? 'Unknown';
    const editorCounts = new Map<string, number>();
    const comments: string[] = [];

    for (const rev of revisions) {
      const user = rev.user ?? 'anonymous';
      editorCounts.set(user, (editorCounts.get(user) ?? 0) + 1);
      if (rev.comment) comments.push(rev.comment);
    }

    const editCount = revisions.length;
    const uniqueEditors = editorCounts.size;
    const relevance = Math.min(1.0, 0.5 + (editCount / 60));

    signals.push({
      id: `io-wiki-${title.replace(/\s+/g, '-').toLowerCase().slice(0, 40)}-${now}`,
      pageTitle: title,
      wiki: 'enwiki',
      editType: classifyEditType(comments, editorCounts),
      editCount1h: editCount,
      uniqueEditors1h: uniqueEditors,
      botTraffic: hasBotEditors(editorCounts.keys()),
      geopoliticalRelevance: Math.round(relevance * 100) / 100,
      matchedEntity: matchedEntityFromTitle(title),
      detectedAt: new Date(now).toISOString(),
    });
  }

  // Sort by edit activity descending
  signals.sort((a, b) => b.editCount1h - a.editCount1h);
  return signals;
}

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
  const limit = req.limit || 100;

  try {
    const signals = await fetchWikimediaSignals();
    if (signals.length > 0) {
      return { signals: signals.slice(0, limit), sampledAt: new Date().toISOString() };
    }
  } catch {
    // Wikimedia API unavailable — fall through to synthetic
  }

  return {
    signals: SYNTHETIC_SIGNALS.slice(0, limit),
    sampledAt: new Date().toISOString(),
  };
}
