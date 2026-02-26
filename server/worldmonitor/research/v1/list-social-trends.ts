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

  // Apply platform filter if requested
  if (req.platform) {
    trends = trends.filter((t) => t.platform === req.platform);
  }

  return { trends, sampledAt: String(Date.now()) };
}
