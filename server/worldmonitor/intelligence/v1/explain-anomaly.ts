import type {
  ExplainAnomalyRequest,
  ExplainAnomalyResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import type { Evidence } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

export async function explainAnomaly(
  req: ExplainAnomalyRequest,
): Promise<ExplainAnomalyResponse> {
  const { anomalyId, evidenceIds } = req;

  if (!evidenceIds || evidenceIds.length === 0) {
    return {
      explanation: "No underlying evidence was found to explain this anomaly.",
      supportingEvidenceIds: [],
    };
  }

  // Fetch evidence contents
  const evidencePromises = evidenceIds.map(id => getCachedJson(`evidence:${id}`) as Promise<Evidence | null>);
  const evidences = (await Promise.all(evidencePromises)).filter((e): e is Evidence => e !== null);

  if (evidences.length === 0) {
    return {
      explanation: "Failed to retrieve the underlying evidence texts to explain this anomaly.",
      supportingEvidenceIds: [],
    };
  }

  const evidenceText = evidences.map(e => `[Title: ${e.title}]\n${e.rawContent?.slice(0, 500) || e.summary || ''}`).join('\n\n');

  // Attempt to summarize using a local LLM or fallback
  const prompt = `You are an intelligence analyst. Explain the following anomaly (${anomalyId}) based on the provided evidence.\n\nEvidence:\n${evidenceText}\n\nExplanation:`;
  
  let explanation = '';
  try {
    const ollamaUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt,
        stream: false,
      }),
    });
    
    if (res.ok) {
      const data = await res.json();
      explanation = data.response;
    } else {
      explanation = `[Local LLM Unavailable] Semantic search indicates this anomaly is heavily driven by recent events:\n${evidences.map(e => `- ${e.title}`).join('\n')}`;
    }
  } catch {
    explanation = `[Local LLM Unavailable] Semantic search indicates this anomaly is heavily driven by recent events:\n${evidences.map(e => `- ${e.title}`).join('\n')}`;
  }

  return {
    explanation,
    supportingEvidenceIds: evidences.map(e => e.id),
  };
}