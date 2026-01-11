/**
 * Correlation analysis service - main thread wrapper.
 * Core logic is in analysis-core.ts (shared with worker).
 */

import type { ClusteredEvent, PredictionMarket, MarketData } from '@/types';
import { getSourceType } from '@/config/feeds';
import {
  analyzeCorrelationsCore,
  type CorrelationSignalCore,
  type StreamSnapshot,
  type SourceType,
} from './analysis-core';

// Re-export types
export type SignalType = CorrelationSignalCore['type'];
export type CorrelationSignal = CorrelationSignalCore;

// Main-thread state management
let previousSnapshot: StreamSnapshot | null = null;
const signalHistory: CorrelationSignal[] = [];
const recentSignalKeys = new Set<string>();

function isRecentDuplicate(key: string): boolean {
  return recentSignalKeys.has(key);
}

function markSignalSeen(key: string): void {
  recentSignalKeys.add(key);
  setTimeout(() => recentSignalKeys.delete(key), 30 * 60 * 1000);
}

export function analyzeCorrelations(
  events: ClusteredEvent[],
  predictions: PredictionMarket[],
  markets: MarketData[]
): CorrelationSignal[] {
  const getSourceTypeFn = (source: string): SourceType => getSourceType(source) as SourceType;

  const { signals, snapshot } = analyzeCorrelationsCore(
    events,
    predictions,
    markets,
    previousSnapshot,
    getSourceTypeFn,
    isRecentDuplicate,
    markSignalSeen
  );

  previousSnapshot = snapshot;
  return signals;
}

export function getRecentSignals(): CorrelationSignal[] {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return signalHistory.filter(s => s.timestamp.getTime() > cutoff);
}

export function addToSignalHistory(signals: CorrelationSignal[]): void {
  signalHistory.push(...signals);
  while (signalHistory.length > 100) {
    signalHistory.shift();
  }
}
