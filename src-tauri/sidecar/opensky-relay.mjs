/**
 * Embedded OpenSky relay for the desktop sidecar.
 * Handles OAuth2 client credentials flow directly from the user's machine
 * (no external relay server needed).
 *
 * Usage: const relay = createOpenSkyRelay(); await relay.fetchStates(params);
 */

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const TOKEN_BUFFER_MS = 60_000; // Refresh token 60s before expiry

export function createOpenSkyRelay() {
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenRefreshPromise = null;

  async function getToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - TOKEN_BUFFER_MS) {
      return cachedToken;
    }
    if (tokenRefreshPromise) return tokenRefreshPromise;

    const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;

    tokenRefreshPromise = (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });

        const resp = await fetch(OPENSKY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`Token request failed: ${resp.status} ${text.slice(0, 200)}`);
        }

        const data = await resp.json();
        cachedToken = data.access_token;
        const expiresIn = Number(data.expires_in) || 300;
        tokenExpiresAt = Date.now() + expiresIn * 1000;
        return cachedToken;
      } catch (err) {
        console.warn('[opensky-relay] token acquisition failed:', err.message);
        return null;
      } finally {
        tokenRefreshPromise = null;
      }
    })();
    return tokenRefreshPromise;
  }

  return {
    async fetchStates(params = {}) {
      const token = await getToken();
      if (!token) {
        return { error: 'OpenSky credentials not configured or token unavailable', states: null };
      }

      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value != null) query.set(key, String(value));
      }

      try {
        const url = `${OPENSKY_API_BASE}/states/all${query.toString() ? '?' + query.toString() : ''}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        });

        if (!resp.ok) {
          // Invalidate token on auth failure
          if (resp.status === 401 || resp.status === 403) {
            cachedToken = null;
            tokenExpiresAt = 0;
          }
          return { error: `OpenSky API error: ${resp.status}`, states: null };
        }

        return await resp.json();
      } catch (err) {
        return { error: `OpenSky fetch failed: ${err.message}`, states: null };
      }
    },

    getTokenStatus() {
      return {
        hasToken: !!cachedToken && Date.now() < tokenExpiresAt,
        expiresAt: tokenExpiresAt > 0 ? new Date(tokenExpiresAt).toISOString() : null,
        hasCredentials: !!(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
      };
    },

    /** Reset cached token (call when credentials change). */
    reset() {
      cachedToken = null;
      tokenExpiresAt = 0;
    },
  };
}
