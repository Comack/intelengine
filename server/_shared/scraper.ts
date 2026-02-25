// Algorithmic Scraper / Content Retrieval

/**
 * Extracts structured JSON-LD data from the HTML if available.
 * News sites and organizations often publish rich metadata here.
 */
function extractJsonLd(html: string): any[] {
  const results: any[] = [];
  const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      try {
        const parsed = JSON.parse(match[1].trim());
        results.push(parsed);
      } catch {
        // Ignore parse errors on malformed JSON-LD
      }
    }
  }
  return results;
}

/**
 * Strips HTML tags and removes noisy elements (scripts, styles, navs, headers, footers).
 * This provides a fast, edge-compatible alternative to JSDOM for text extraction.
 */
function extractMainText(html: string): string {
  // Remove invisible and structural noise
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
  text = text.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ');
  text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Attempt to isolate article body if semantic tags exist
  const articleMatch = text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch && articleMatch[1]) {
    text = articleMatch[1];
  } else {
    // Fallback: try to find main content area
    const mainMatch = text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch && mainMatch[1]) {
      text = mainMatch[1];
    }
  }

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return text;
}

export interface ScrapedContent {
  title: string;
  description: string;
  content: string;
  metadata: any[];
}

/**
 * Attempt to fetch content from a URL using multiple fallback strategies.
 * Tries direct fetch first, then falls back to the Railway relay to bypass IP blocks.
 */
export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  let html = '';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // 1. Direct fetch attempt
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    // If Cloudflare blocks us (403) or we get rate-limited (429), throw to trigger fallback
    if (resp.status === 403 || resp.status === 429 || resp.status === 503) {
      throw new Error(`HTTP ${resp.status} - Possible bot protection`);
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    html = await resp.text();
  } catch (err) {
    console.warn(`[scraper] Direct fetch failed for ${url}, attempting relay fallback...`, err instanceof Error ? err.message : String(err));
    
    // 2. Relay fallback attempt (Railway proxy)
    const relayUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.WS_RELAY_URL;
    if (relayUrl) {
      try {
        const proxyReqUrl = `${relayUrl.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(url)}`;
        const relayResp = await fetch(proxyReqUrl, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

        if (relayResp.ok) {
          html = await relayResp.text();
        } else {
          throw new Error(`Relay HTTP ${relayResp.status}`);
        }
      } catch (relayErr) {
        console.error(`[scraper] Relay fallback also failed for ${url}:`, relayErr instanceof Error ? relayErr.message : String(relayErr));
        throw new Error('All scraping strategies failed');
      }
    } else {
      throw new Error('Direct fetch failed and no relay URL configured');
    }
  }

  // Extract Title (OpenGraph or <title>)
  let title = new URL(url).hostname;
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  
  if (ogTitleMatch && ogTitleMatch[1]) {
    title = ogTitleMatch[1].trim();
  } else if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }
  title = title.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  // Extract Description (OpenGraph or <meta name="description">)
  let description = '';
  const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);

  if (ogDescMatch && ogDescMatch[1]) {
    description = ogDescMatch[1].trim();
  } else if (descMatch && descMatch[1]) {
    description = descMatch[1].trim();
  }
  description = description.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  const metadata = extractJsonLd(html);
  const content = extractMainText(html);

  return { title, description, content, metadata };
}