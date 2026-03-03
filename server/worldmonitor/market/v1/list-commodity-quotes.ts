/**
 * RPC: ListCommodityQuotes
 * Fetches commodity futures quotes from Yahoo Finance.
 */

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { fetchYahooQuotesBatch, parseStringArray } from './_shared';
import { cachedFetchJson } from '../../../_shared/redis';

const REDIS_CACHE_KEY = 'market:commodities:v1';
const REDIS_CACHE_TTL = 600; // 10 min — commodities move slower than indices

const fallbackCommodityCache = new Map<string, { data: ListCommodityQuotesResponse; ts: number }>();
const FALLBACK_MAX_SIZE = 50;
const FALLBACK_TTL_MS = 10 * 60 * 1000; // 10 min

function evictOldestFallback(): void {
  if (fallbackCommodityCache.size <= FALLBACK_MAX_SIZE) return;
  let oldestKey: string | undefined;
  let oldestTs = Infinity;
  for (const [k, v] of fallbackCommodityCache) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  if (oldestKey !== undefined) fallbackCommodityCache.delete(oldestKey);
}

function redisCacheKey(symbols: string[]): string {
  return `${REDIS_CACHE_KEY}:${[...symbols].sort().join(',')}`;
}

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  const symbols = parseStringArray(req.symbols);
  if (!symbols.length) return { quotes: [] };

  const redisKey = redisCacheKey(symbols);

  try {
  const result = await cachedFetchJson<ListCommodityQuotesResponse>(redisKey, REDIS_CACHE_TTL, async () => {
    const batch = await fetchYahooQuotesBatch(symbols);
    const quotes: CommodityQuote[] = [];
    for (const s of symbols) {
      const yahoo = batch.results.get(s);
      if (yahoo) {
        quotes.push({ symbol: s, name: s, display: s, price: yahoo.price, change: yahoo.change, sparkline: yahoo.sparkline });
      }
    }
    return quotes.length > 0 ? { quotes } : null;
  });

  if (result) {
    evictOldestFallback();
    fallbackCommodityCache.set(redisKey, { data: result, ts: Date.now() });
  }
  const fallbackEntry = fallbackCommodityCache.get(redisKey);
  if (!result && fallbackEntry && Date.now() - fallbackEntry.ts > FALLBACK_TTL_MS) {
    fallbackCommodityCache.delete(redisKey);
    return { quotes: [] };
  }
  return result || fallbackEntry?.data || { quotes: [] };
  } catch {
    const fallback = fallbackCommodityCache.get(redisKey);
    if (fallback && Date.now() - fallback.ts > FALLBACK_TTL_MS) {
      fallbackCommodityCache.delete(redisKey);
      return { quotes: [] };
    }
    return fallback?.data || { quotes: [] };
  }
}
