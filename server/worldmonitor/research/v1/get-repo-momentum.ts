/**
 * RPC: GetRepoMomentum
 * Fetches GitHub event counts for a curated list of strategic repositories
 * and computes a momentum score for each over the last 24 hours.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  GetRepoMomentumRequest,
  GetRepoMomentumResponse,
  RepoMomentum,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

const TRACKED_REPOS: Array<{ repo: string; ownerEntity: string }> = [
  { repo: 'openai/openai-python', ownerEntity: 'openai' },
  { repo: 'anthropics/anthropic-sdk-python', ownerEntity: 'anthropic' },
  { repo: 'huggingface/transformers', ownerEntity: 'huggingface' },
  { repo: 'pytorch/pytorch', ownerEntity: 'meta' },
  { repo: 'microsoft/vscode', ownerEntity: 'microsoft' },
  { repo: 'google/gemma_pytorch', ownerEntity: 'google' },
  { repo: 'meta-llama/llama', ownerEntity: 'meta' },
  { repo: 'mistralai/mistral-src', ownerEntity: 'mistral' },
  { repo: 'microsoft/TypeScript', ownerEntity: 'microsoft' },
  { repo: 'vercel/next.js', ownerEntity: 'vercel' },
];

interface GitHubEvent {
  type: string;
  created_at: string;
  payload?: {
    action?: string;
  };
}

async function fetchRepoMomentum(
  repo: string,
  ownerEntity: string,
  token: string | undefined,
): Promise<RepoMomentum> {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const computedAt = String(now);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/events?per_page=100`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { repo, ownerEntity, stars1d: 0, forks1d: 0, prOpens1d: 0, momentumScore: 0, computedAt };
    }

    const events = (await response.json()) as GitHubEvent[];

    let stars = 0;
    let forks = 0;
    let prs = 0;

    for (const event of events) {
      const eventTime = new Date(event.created_at).getTime();
      if (eventTime < cutoff) continue;

      if (event.type === 'WatchEvent') {
        stars += 1;
      } else if (event.type === 'ForkEvent') {
        forks += 1;
      } else if (event.type === 'PullRequestEvent' && event.payload?.action === 'opened') {
        prs += 1;
      }
    }

    const momentumScore = Math.min(100, stars * 2 + forks * 3 + prs * 5);

    return { repo, ownerEntity, stars1d: stars, forks1d: forks, prOpens1d: prs, momentumScore, computedAt };
  } catch {
    return { repo, ownerEntity, stars1d: 0, forks1d: 0, prOpens1d: 0, momentumScore: 0, computedAt };
  }
}

export async function getRepoMomentum(
  _ctx: ServerContext,
  _req: GetRepoMomentumRequest,
): Promise<GetRepoMomentumResponse> {
  const token = process.env.GITHUB_TOKEN;
  const computedAt = String(Date.now());

  try {
    const repos = await Promise.all(
      TRACKED_REPOS.map((entry) => fetchRepoMomentum(entry.repo, entry.ownerEntity, token)),
    );
    return { repos, computedAt };
  } catch {
    const repos: RepoMomentum[] = TRACKED_REPOS.map((entry) => ({
      repo: entry.repo,
      ownerEntity: entry.ownerEntity,
      stars1d: 0,
      forks1d: 0,
      prOpens1d: 0,
      momentumScore: 0,
      computedAt,
    }));
    return { repos, computedAt };
  }
}
