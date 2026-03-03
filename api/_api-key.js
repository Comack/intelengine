import { timingSafeEqual } from 'node:crypto';

const DESKTOP_ORIGIN_PATTERNS = [
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.tauri\.localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/,
  /^asset:\/\/localhost$/,
];

function isDesktopOrigin(origin) {
  return Boolean(origin) && DESKTOP_ORIGIN_PATTERNS.some(p => p.test(origin));
}

function isValidKey(key, validKeys) {
  const keyBuf = Buffer.from(key);
  return validKeys.some((k) => {
    const kBuf = Buffer.from(k);
    return kBuf.length === keyBuf.length && timingSafeEqual(kBuf, keyBuf);
  });
}

export function validateApiKey(req) {
  // Bypass all key checks when running inside the authenticated local sidecar.
  // Require both sentinels so a stray LOCAL_API_TOKEN in a cloud environment
  // cannot silently skip key validation.
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar' && process.env.LOCAL_API_TOKEN) {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return { valid: false, required: true, error: 'Bearer token required for local API' };
    const expected = Buffer.from(process.env.LOCAL_API_TOKEN);
    const provided = Buffer.from(token);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return { valid: false, required: true, error: 'Invalid local API token' };
    }
    return { valid: true, required: true };
  }

  const key = req.headers.get('X-WorldMonitor-Key');
  const origin = req.headers.get('Origin') || '';

  if (isDesktopOrigin(origin)) {
    if (!key) return { valid: false, required: true, error: 'API key required for desktop access' };
    const validKeys = (process.env.WORLDMONITOR_VALID_KEYS || '').split(',').filter(Boolean);
    if (!isValidKey(key, validKeys)) return { valid: false, required: true, error: 'Invalid API key' };
    return { valid: true, required: true };
  }

  if (key) {
    const validKeys = (process.env.WORLDMONITOR_VALID_KEYS || '').split(',').filter(Boolean);
    if (!isValidKey(key, validKeys)) return { valid: false, required: true, error: 'Invalid API key' };
    return { valid: true, required: true };
  }

  return { valid: false, required: false };
}
