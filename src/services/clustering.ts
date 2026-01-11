/**
 * News clustering service - main thread wrapper.
 * Core logic is in analysis-core.ts (shared with worker).
 */

import type { NewsItem, ClusteredEvent } from '@/types';
import { getSourceTier } from '@/config';
import { clusterNewsCore } from './analysis-core';

export function clusterNews(items: NewsItem[]): ClusteredEvent[] {
  return clusterNewsCore(items, getSourceTier) as ClusteredEvent[];
}
