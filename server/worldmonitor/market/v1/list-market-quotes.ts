/**
 * RPC: ListMarketQuotes
 * Fetches stock/index quotes from Finnhub (stocks) and Yahoo Finance (indices/futures).
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListMarketQuotesRequest,
  ListMarketQuotesResponse,
  MarketQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { YAHOO_ONLY_SYMBOLS, fetchFinnhubQuote, fetchYahooQuote } from './_shared';

/** Fetch items with at most `limit` concurrent requests. */
async function withConcurrencyLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (idx < tasks.length) { const i = idx++; const t = tasks[i]; if (t) results[i] = await t(); }
    }),
  );
  return results;
}

export async function listMarketQuotes(
  _ctx: ServerContext,
  req: ListMarketQuotesRequest,
): Promise<ListMarketQuotesResponse> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const symbols = req.symbols;
    if (!symbols.length) return { quotes: [], finnhubSkipped: !apiKey, skipReason: !apiKey ? 'FINNHUB_API_KEY not configured' : '' };

    const finnhubSymbols = symbols.filter((s) => !YAHOO_ONLY_SYMBOLS.has(s));
    const yahooSymbols = symbols.filter((s) => YAHOO_ONLY_SYMBOLS.has(s));

    const quotes: MarketQuote[] = [];

    // Fetch Finnhub quotes (only if API key is set); limit to 3 concurrent
    // requests to stay within Finnhub's 60 req/min free-tier rate limit.
    if (finnhubSymbols.length > 0 && apiKey) {
      const results = await withConcurrencyLimit(
        finnhubSymbols.map((s) => () => fetchFinnhubQuote(s, apiKey)),
        3,
      );
      for (const r of results) {
        if (r) {
          quotes.push({
            symbol: r.symbol,
            name: r.symbol,
            display: r.symbol,
            price: r.price,
            change: r.changePercent,
            sparkline: [],
          });
        }
      }
    }

    // Fetch Yahoo Finance quotes for indices/futures
    if (yahooSymbols.length > 0) {
      const results = await Promise.all(
        yahooSymbols.map(async (s) => {
          const yahoo = await fetchYahooQuote(s);
          if (!yahoo) return null;
          return {
            symbol: s,
            name: s,
            display: s,
            price: yahoo.price,
            change: yahoo.change,
            sparkline: yahoo.sparkline,
          } satisfies MarketQuote;
        }),
      );
      for (const r of results) {
        if (r) quotes.push(r);
      }
    }

    return { quotes, finnhubSkipped: !apiKey, skipReason: !apiKey ? 'FINNHUB_API_KEY not configured' : '' };
  } catch {
    return { quotes: [], finnhubSkipped: false, skipReason: '' };
  }
}
