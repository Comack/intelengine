/**
 * RPC: ListSocialTrends
 * Fetches trending social topics from a relay service.
 * Falls back to synthetic data when the relay is unavailable.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListSocialTrendsRequest,
  ListSocialTrendsResponse,
  SocialTrend,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

function syntheticTrends(): SocialTrend[] {
  const now = Date.now();
  return [
    {
      topic: 'AI regulation',
      platform: 'bluesky',
      mentionCount1h: 234,
      velocity: 3.9,
      topPosts: ['Congress moves on AI safety bill...', 'EU AI Act enforcement begins...'],
      matchedEntities: ['OpenAI', 'Anthropic'],
      observedAt: String(now - 300000),
    },
    {
      topic: 'Taiwan Strait tensions',
      platform: 'bluesky',
      mentionCount1h: 189,
      velocity: 3.2,
      topPosts: ['China military exercises near...'],
      matchedEntities: ['Taiwan', 'China'],
      observedAt: String(now - 600000),
    },
    {
      topic: 'Bitcoin ETF flows',
      platform: 'bluesky',
      mentionCount1h: 156,
      velocity: 2.6,
      topPosts: ['BlackRock BTC ETF sees record...'],
      matchedEntities: ['Bitcoin', 'BlackRock'],
      observedAt: String(now - 900000),
    },
  ];
}

interface RelayTrend {
  topic: string;
  platform: string;
  mention_count_1h?: number;
  mentionCount1h?: number;
  velocity: number;
  top_posts?: string[];
  topPosts?: string[];
  matched_entities?: string[];
  matchedEntities?: string[];
  observed_at?: string | number;
  observedAt?: string | number;
}

async function fetchFromRelay(req: ListSocialTrendsRequest): Promise<SocialTrend[]> {
  const relayUrl = process.env.WS_RELAY_URL || 'http://localhost:3004';
  const platform = req.platform || '';
  const limit = req.limit || 20;
  const url = `${relayUrl}/social/trends?platform=${encodeURIComponent(platform)}&limit=${limit}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return syntheticTrends();

  const data = (await response.json()) as { trends?: RelayTrend[] } | RelayTrend[];
  const rawTrends: RelayTrend[] = Array.isArray(data) ? data : (data as { trends?: RelayTrend[] }).trends ?? [];

  return rawTrends.map((t): SocialTrend => {
    const observedRaw = t.observedAt ?? t.observed_at ?? Date.now();
    return {
      topic: t.topic,
      platform: t.platform,
      mentionCount1h: t.mentionCount1h ?? t.mention_count_1h ?? 0,
      velocity: t.velocity,
      topPosts: t.topPosts ?? t.top_posts ?? [],
      matchedEntities: t.matchedEntities ?? t.matched_entities ?? [],
      observedAt: String(observedRaw),
    };
  });
}

const BLUESKY_WATCHLIST = [
  { query: 'Ukraine war', entities: ['Ukraine', 'Russia'] },
  { query: 'Gaza conflict', entities: ['Israel', 'Hamas', 'Gaza'] },
  { query: 'Taiwan China', entities: ['Taiwan', 'China'] },
  { query: 'AI safety', entities: ['OpenAI', 'Anthropic', 'AI'] },
  { query: 'cybersecurity breach', entities: ['Cyber'] },
  { query: 'NATO military', entities: ['NATO'] },
  { query: 'cryptocurrency bitcoin', entities: ['Bitcoin', 'Crypto'] },
  { query: 'climate change extreme weather', entities: ['Climate'] },
  { query: 'oil prices energy', entities: ['Oil', 'Energy'] },
  { query: 'Federal Reserve interest rates', entities: ['Fed', 'Markets'] },
  { query: 'nuclear weapons Iran', entities: ['Iran', 'Nuclear'] },
  { query: 'supply chain disruption', entities: ['Supply Chain'] },
];

interface BskyPost {
  uri: string;
  cid: string;
  author: { handle: string; displayName?: string };
  record: { text: string; createdAt: string };
  indexedAt: string;
}

interface BskySearchResponse {
  posts: BskyPost[];
  cursor?: string;
}

const BSKY_API = 'https://public.api.bsky.app';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFromBluesky(): Promise<SocialTrend[]> {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const trends: SocialTrend[] = [];

  const results = await Promise.allSettled(
    BLUESKY_WATCHLIST.map(async (item, i) => {
      // Rate limit: 100ms between each request
      if (i > 0) await sleep(i * 100);

      const url = `${BSKY_API}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(item.query)}&limit=25&sort=latest`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'WorldMonitor/1.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as BskySearchResponse;
      return { item, data };
    }),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { item, data } = result.value;

    const recentPosts = data.posts.filter(
      (p) => new Date(p.indexedAt).getTime() >= oneHourAgo,
    );
    if (recentPosts.length < 2) continue;

    const velocity = recentPosts.length / 60; // mentions per minute
    const topPosts = recentPosts
      .slice(0, 3)
      .map((p) => p.record.text.slice(0, 200));

    trends.push({
      topic: item.query,
      platform: 'bluesky',
      mentionCount1h: recentPosts.length,
      velocity: Math.round(velocity * 100) / 100,
      topPosts,
      matchedEntities: item.entities,
      observedAt: String(now),
    });
  }

  trends.sort((a, b) => b.mentionCount1h - a.mentionCount1h);
  return trends;
}

function isSyntheticOnly(trends: SocialTrend[]): boolean {
  const synTopics = new Set(syntheticTrends().map((t) => t.topic));
  return trends.length > 0 && trends.every((t) => synTopics.has(t.topic));
}

export async function listSocialTrends(
  _ctx: ServerContext,
  req: ListSocialTrendsRequest,
): Promise<ListSocialTrendsResponse> {
  let trends: SocialTrend[];

  try {
    trends = await fetchFromRelay(req);
  } catch {
    trends = syntheticTrends();
  }

  // Augment with real Bluesky data when relay returned synthetic or failed
  const wantBluesky = !req.platform || req.platform === 'bluesky';
  if (wantBluesky && isSyntheticOnly(trends)) {
    try {
      const bskyTrends = await fetchFromBluesky();
      if (bskyTrends.length > 0) {
        // Merge: deduplicate by topic (prefer real Bluesky data)
        const bskyTopics = new Set(bskyTrends.map((t) => t.topic.toLowerCase()));
        const filtered = trends.filter(
          (t) => !bskyTopics.has(t.topic.toLowerCase()),
        );
        trends = [...bskyTrends, ...filtered];
        trends.sort((a, b) => b.mentionCount1h - a.mentionCount1h);
      }
    } catch {
      // Bluesky fetch failed; keep existing trends
    }
  }

  // Apply platform filter if requested
  if (req.platform) {
    trends = trends.filter((t) => t.platform === req.platform);
  }

  // Apply limit
  const limit = req.limit || 20;
  if (trends.length > limit) {
    trends = trends.slice(0, limit);
  }

  return { trends, sampledAt: String(Date.now()) };
}
