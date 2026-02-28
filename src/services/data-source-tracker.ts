/**
 * Lightweight per-endpoint data source tracker.
 * Records whether each API path was served from local sidecar or cloud.
 * Used by ServiceStatusPanel to render source badges.
 */

export type DataSourceLabel = 'local-sidecar' | 'cloud' | 'unknown';

const sources = new Map<string, DataSourceLabel>();
const listeners = new Set<() => void>();

export function recordApiSource(path: string, source: DataSourceLabel): void {
  const prev = sources.get(path);
  if (prev === source) return;
  sources.set(path, source);
  for (const listener of listeners) {
    try { listener(); } catch { /* ignore */ }
  }
}

export function getApiSource(path: string): DataSourceLabel {
  return sources.get(path) ?? 'unknown';
}

export function getAllApiSources(): ReadonlyMap<string, DataSourceLabel> {
  return sources;
}

export function subscribeDataSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
