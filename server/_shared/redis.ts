declare const process: { env: Record<string, string | undefined> };

/**
 * Environment-based key prefix to avoid collisions when multiple deployments
 * share the same Upstash Redis instance (M-6 fix).
 */
function getKeyPrefix(): string {
  const env = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
  if (!env || env === 'production') return '';
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev';
  return `${env}:${sha}:`;
}

let cachedPrefix: string | undefined;
function prefixKey(key: string): string {
  if (cachedPrefix === undefined) cachedPrefix = getKeyPrefix();
  if (!cachedPrefix) return key;
  return `${cachedPrefix}${key}`;
}

async function getSidecarCachedJson(key: string): Promise<unknown | null> {
  const mode = process.env.LOCAL_API_MODE || '';
  if (!mode.includes('sidecar') && mode !== 'tauri-sidecar') return null;
  const port = process.env.LOCAL_API_PORT || '46123';
  try {
    const resp = await fetch(
      `http://127.0.0.1:${port}/api/local-cache?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(500) },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { value?: unknown };
    return data.value ?? null;
  } catch {
    return null;
  }
}

export async function getCachedJson(key: string): Promise<unknown | null> {
  // In sidecar mode, probe local file-backed cache first (no Upstash needed)
  const sidecarResult = await getSidecarCachedJson(key);
  if (sidecarResult !== null) return sidecarResult;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(prefixKey(key))}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { result?: string };
    return data.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    // Atomic SET with EX — single call avoids race between SET and EXPIRE (C-3 fix)
    await fetch(`${url}/set/${encodeURIComponent(prefixKey(key))}/${encodeURIComponent(JSON.stringify(value))}/EX/${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch { /* best-effort */ }
}
