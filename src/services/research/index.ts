import {
  ResearchServiceClient,
  type ArxivPaper,
  type GithubRepo,
  type HackernewsItem,
  type RepoMomentum,
  type SocialTrend,
} from '@/generated/client/worldmonitor/research/v1/service_client';
import { createCircuitBreaker } from '@/utils';

// Re-export proto types
export type { ArxivPaper, GithubRepo, HackernewsItem, RepoMomentum, SocialTrend };

const client = new ResearchServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

const arxivBreaker = createCircuitBreaker<ArxivPaper[]>({ name: 'ArXiv Papers', cacheTtlMs: 10 * 60 * 1000, persistCache: true });
const trendingBreaker = createCircuitBreaker<GithubRepo[]>({ name: 'GitHub Trending', cacheTtlMs: 10 * 60 * 1000, persistCache: true });
const hnBreaker = createCircuitBreaker<HackernewsItem[]>({ name: 'Hacker News', cacheTtlMs: 10 * 60 * 1000, persistCache: true });
const momentumBreaker = createCircuitBreaker<RepoMomentum[]>({ name: 'GitHub Momentum', cacheTtlMs: 30 * 60 * 1000, persistCache: true });
const trendsBreaker = createCircuitBreaker<SocialTrend[]>({ name: 'Social Trends', cacheTtlMs: 15 * 60 * 1000, persistCache: true });

export async function fetchArxivPapers(
  category = 'cs.AI',
  query = '',
  pageSize = 50,
): Promise<ArxivPaper[]> {
  return arxivBreaker.execute(async () => {
    const resp = await client.listArxivPapers({
      category,
      query,
      pageSize,
      cursor: '',
    });
    return resp.papers;
  }, []);
}

export async function fetchTrendingRepos(
  language = 'python',
  period = 'daily',
  pageSize = 50,
): Promise<GithubRepo[]> {
  return trendingBreaker.execute(async () => {
    const resp = await client.listTrendingRepos({
      language,
      period,
      pageSize,
      cursor: '',
    });
    return resp.repos;
  }, []);
}

export async function fetchHackernewsItems(
  feedType = 'top',
  pageSize = 30,
): Promise<HackernewsItem[]> {
  return hnBreaker.execute(async () => {
    const resp = await client.listHackernewsItems({
      feedType,
      pageSize,
      cursor: '',
    });
    return resp.items;
  }, []);
}

export async function fetchRepoMomentum(): Promise<RepoMomentum[]> {
  return momentumBreaker.execute(async () => {
    const resp = await client.getRepoMomentum({});
    return resp.repos;
  }, []);
}

export async function fetchSocialTrends(platform = '', limit = 20): Promise<SocialTrend[]> {
  return trendsBreaker.execute(async () => {
    const resp = await client.listSocialTrends({ platform, limit });
    return resp.trends;
  }, []);
}
