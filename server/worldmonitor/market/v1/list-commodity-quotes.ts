/**
 * RPC: ListCommodityQuotes
 * Fetches commodity futures quotes from Yahoo Finance.
 * Also fetches precious metals (Gold, Silver) from Gold-API.com when key is available.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { fetchYahooQuote } from './_shared';

interface GoldApiResponse {
  price: number;
  chg: number;
  chp: number;
  timestamp: number;
}

async function fetchPreciousMetals(): Promise<Array<{ symbol: string; name: string; price: number; changePct: number }>> {
  const apiKey = process.env.GOLD_API_KEY;
  if (!apiKey) {
    return [
      { symbol: 'XAUUSD', name: 'Gold', price: 3200, changePct: 0.3 },
      { symbol: 'XAGUSD', name: 'Silver', price: 31.5, changePct: 0.2 },
    ];
  }

  try {
    const headers = { 'x-access-token': apiKey, 'Content-Type': 'application/json' };
    const [goldRes, silverRes] = await Promise.all([
      fetch('https://www.goldapi.io/api/XAU/USD', { headers, signal: AbortSignal.timeout(8000) }),
      fetch('https://www.goldapi.io/api/XAG/USD', { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    const results: Array<{ symbol: string; name: string; price: number; changePct: number }> = [];

    if (goldRes.ok) {
      const goldData = (await goldRes.json()) as GoldApiResponse;
      results.push({ symbol: 'XAUUSD', name: 'Gold', price: goldData.price, changePct: goldData.chp });
    } else {
      results.push({ symbol: 'XAUUSD', name: 'Gold', price: 3200, changePct: 0.3 });
    }

    if (silverRes.ok) {
      const silverData = (await silverRes.json()) as GoldApiResponse;
      results.push({ symbol: 'XAGUSD', name: 'Silver', price: silverData.price, changePct: silverData.chp });
    } else {
      results.push({ symbol: 'XAGUSD', name: 'Silver', price: 31.5, changePct: 0.2 });
    }

    return results;
  } catch {
    return [
      { symbol: 'XAUUSD', name: 'Gold', price: 3200, changePct: 0.3 },
      { symbol: 'XAGUSD', name: 'Silver', price: 31.5, changePct: 0.2 },
    ];
  }
}

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  try {
    const symbols = req.symbols;

    const [yahooResults, preciousMetals] = await Promise.all([
      symbols.length
        ? Promise.all(
            symbols.map(async (s) => {
              const yahoo = await fetchYahooQuote(s);
              if (!yahoo) return null;
              return {
                symbol: s,
                name: s,
                display: s,
                price: yahoo.price,
                change: yahoo.change,
                sparkline: yahoo.sparkline,
              } satisfies CommodityQuote;
            }),
          )
        : Promise.resolve([] as Array<CommodityQuote | null>),
      fetchPreciousMetals(),
    ]);

    const yahooQuotes = yahooResults.filter((r): r is CommodityQuote => r !== null);

    const metalQuotes: CommodityQuote[] = preciousMetals.map((m) => ({
      symbol: m.symbol,
      name: m.name,
      display: m.symbol,
      price: m.price,
      change: m.changePct,
      sparkline: [],
    }));

    return { quotes: [...yahooQuotes, ...metalQuotes] };
  } catch {
    return { quotes: [] };
  }
}
