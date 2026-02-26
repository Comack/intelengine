/**
 * Research service handler -- thin composition file.
 *
 * Each RPC is implemented in its own file:
 * - list-arxiv-papers.ts    (arXiv Atom XML API)
 * - list-trending-repos.ts  (GitHub trending JSON APIs)
 * - list-hackernews-items.ts (HN Firebase JSON API)
 * - list-tech-events.ts     (Techmeme ICS + dev.events RSS + curated)
 * - list-social-trends.ts   (WS relay social trend aggregation)
 * - get-repo-momentum.ts    (GitHub Events API momentum scoring)
 */

import type { ResearchServiceHandler } from '../../../../src/generated/server/worldmonitor/research/v1/service_server';
import { listArxivPapers } from './list-arxiv-papers';
import { listTrendingRepos } from './list-trending-repos';
import { listHackernewsItems } from './list-hackernews-items';
import { listTechEvents } from './list-tech-events';
import { listSocialTrends } from './list-social-trends';
import { getRepoMomentum } from './get-repo-momentum';

export const researchHandler: ResearchServiceHandler = {
  listArxivPapers,
  listTrendingRepos,
  listHackernewsItems,
  listTechEvents,
  listSocialTrends,
  getRepoMomentum,
};
