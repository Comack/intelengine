/**
 * RPC: listRegulatoryFilings -- SEC EDGAR current filings feed
 * Source: SEC EDGAR Atom RSS with tracked-entity enrichment
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListRegulatoryFilingsRequest,
  ListRegulatoryFilingsResponse,
  RegulatoryFiling,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

const TRACKED_TICKERS: Record<string, string> = {
  'NVIDIA': 'NVDA',
  'APPLE': 'AAPL',
  'MICROSOFT': 'MSFT',
  'TESLA': 'TSLA',
  'AMAZON': 'AMZN',
  'ALPHABET': 'GOOGL',
  'META': 'META',
  'BOEING': 'BA',
  'LOCKHEED': 'LMT',
  'RAYTHEON': 'RTX',
  'PALANTIR': 'PLTR',
  'OPENAI': '',
  'ANTHROPIC': '',
  'JPMORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'BLACKROCK': 'BLK',
  'EXXON': 'XOM',
  'CHEVRON': 'CVX',
  'PFIZER': 'PFE',
  'JOHNSON': 'JNJ',
};

const FORM_TYPE_BASE_SCORE: Record<string, number> = {
  '8-K': 70,
  'S-1': 85,
  '13F': 50,
  '10-Q': 40,
  '10-K': 55,
  '4': 30,
  'SC 13G': 35,
  'SC 13D': 45,
};

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1]!.trim() : '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1]!.trim() : '';
}

function findTrackedTicker(companyName: string): { keyword: string; ticker: string } | null {
  const upper = companyName.toUpperCase();
  for (const [keyword, ticker] of Object.entries(TRACKED_TICKERS)) {
    if (upper.includes(keyword)) {
      return { keyword, ticker };
    }
  }
  return null;
}

function computeMarketImpactScore(formType: string, isTracked: boolean): number {
  const base = FORM_TYPE_BASE_SCORE[formType] ?? 35;
  return isTracked ? Math.round(base * 1.2) : base;
}

export async function listRegulatoryFilings(
  _ctx: ServerContext,
  req: ListRegulatoryFilingsRequest,
): Promise<ListRegulatoryFilingsResponse> {
  const formType = req.formType || '8-K';
  const limit = Math.min(req.limit || 40, 100);

  try {
    const url =
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent` +
      `&type=${encodeURIComponent(formType)}` +
      `&dateb=&owner=include` +
      `&count=${limit}` +
      `&search_text=&output=atom`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WorldMonitor/1.0 contact@worldmonitor.app' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`SEC EDGAR responded with ${response.status}`);
    }

    const xml = await response.text();

    // Split into <entry> blocks
    const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
    const filings: RegulatoryFiling[] = [];
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = entryRe.exec(xml)) !== null && filings.length < limit) {
      const entry = match[1]!;

      const title = extractTag(entry, 'title');
      const filed = extractTag(entry, 'filed');
      const updated = extractTag(entry, 'updated');
      const linkHref = extractAttr(entry, 'link', 'href');
      const companyName = extractTag(entry, 'conformed-name') || extractTag(entry, 'company-name');
      const cik = extractTag(entry, 'cik');
      const id = `edgar-${index++}`;

      // Derive the actual form type from title (e.g. "8-K - NVIDIA CORP")
      const titleFormType = title.split(' - ')[0]?.trim() || formType;
      const titleCompany = title.includes(' - ') ? title.split(' - ').slice(1).join(' - ').trim() : companyName;
      const resolvedCompany = titleCompany || companyName || 'Unknown';

      const tracked = findTrackedTicker(resolvedCompany);
      const marketImpactScore = computeMarketImpactScore(titleFormType, tracked !== null);

      // Use 'filed' date if available, otherwise fall back to 'updated'
      const filedAt = filed ? new Date(filed).toISOString() : (updated ? new Date(updated).toISOString() : new Date().toISOString());

      filings.push({
        id,
        formType: titleFormType,
        companyName: resolvedCompany,
        ticker: tracked?.ticker ?? '',
        cik,
        filingDescription: title,
        url: linkHref,
        marketImpactScore,
        filedAt,
      });
    }

    return { filings, fetchedAt: new Date().toISOString() };
  } catch (error) {
    console.error('Error fetching SEC EDGAR filings:', error);
    return { filings: [], fetchedAt: new Date().toISOString() };
  }
}
