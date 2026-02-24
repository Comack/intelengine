import type { ServerContext, IngestEvidenceRequest, IngestEvidenceResponse, Evidence, POLEGraph } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';
import { setCachedJson, getCachedJson } from '../../../_shared/redis';
import { scrapeUrl } from '../../../_shared/scraper';

// Simple UUID generator since we don't have crypto.randomUUID everywhere in edge
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

async function extractPoleGraph(text: string, description?: string, metadata?: any[]): Promise<POLEGraph> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const prompt = `You are an expert intelligence analyst. Extract a POLE (Person, Object, Location, Event) graph from the following text and metadata.
Return ONLY valid JSON matching this structure:
{
  "persons": [{ "id": "p1", "name": "...", "aliases": ["..."], "role": "..." }],
  "objects": [{ "id": "o1", "type": "...", "name": "...", "description": "..." }],
  "locations": [{ "id": "l1", "name": "...", "lat": 0.0, "lon": 0.0, "countryCode": "..." }],
  "events": [{ "id": "e1", "type": "...", "description": "...", "timestamp": 1234567890000, "involvedPersonIds": ["p1"], "involvedObjectIds": ["o1"], "locationIds": ["l1"] }]
}

Metadata:
${description ? `Description: ${description}\n` : ''}${metadata && metadata.length > 0 ? `JSON-LD: ${JSON.stringify(metadata)}\n` : ''}

Text to analyze:
${text}`;

  try {
    const resp = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`LLM extraction failed: ${resp.status}`);
    }

    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message.content;
    if (!content) throw new Error('Empty response from LLM');

    return JSON.parse(content) as POLEGraph;
  } catch (err) {
    console.error('[ingest-evidence] LLM error:', err);
    throw err;
  }
}

export async function ingestEvidence(
  ctx: ServerContext,
  req: IngestEvidenceRequest,
): Promise<IngestEvidenceResponse> {
  const id = `evidence_${generateId()}`;
  let extractedPole: POLEGraph | undefined;
  let isProcessed = false;
  
  let title = req.title;
  let rawContent = req.rawContent;
  let description = '';
  let metadata: any[] = [];

  try {
    // If we have a URL but no content, use the scraper
    if (req.sourceUrl && !rawContent) {
      const scraped = await scrapeUrl(req.sourceUrl);
      title = title || scraped.title;
      rawContent = scraped.content;
      description = scraped.description;
      metadata = scraped.metadata;
    }
    
    // Attempt to extract POLE graph
    const textToAnalyze = rawContent.substring(0, 15000); // Llama 3 8k context supports ~25k chars
    if (textToAnalyze.length > 50) {
       extractedPole = await extractPoleGraph(textToAnalyze, description, metadata);
       isProcessed = true;
    }
  } catch (err) {
    console.error(`[ingest-evidence] Failed to extract POLE for ${id}:`, err);
  }

  const evidence: Evidence = {
    id,
    sourceUrl: req.sourceUrl,
    title,
    rawContent,
    scrapedAt: Date.now(),
    extractedPole,
    isProcessed,
  };

  // Store in Redis (TTL: 30 days)
  await setCachedJson(`evidence:${id}`, evidence, 30 * 24 * 60 * 60);

  // Update the global index of evidence IDs
  const indexKey = 'evidence:index';
  let index = (await getCachedJson(indexKey)) as string[];
  if (!Array.isArray(index)) {
    index = [];
  }
  index.unshift(id);
  if (index.length > 1000) index.length = 1000;
  await setCachedJson(indexKey, index, 30 * 24 * 60 * 60);

  return { evidence };
}