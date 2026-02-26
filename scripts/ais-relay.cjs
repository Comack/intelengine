#!/usr/bin/env node
/**
 * AIS WebSocket Relay Server
 * Proxies aisstream.io data to browsers via WebSocket
 *
 * Deploy on Railway with:
 *   AISSTREAM_API_KEY=your_key
 *
 * Local: node scripts/ais-relay.cjs
 */

const http = require('http');
const zlib = require('zlib');
const { WebSocketServer, WebSocket } = require('ws');

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.AISSTREAM_API_KEY || process.env.VITE_AISSTREAM_API_KEY;
const PORT = process.env.PORT || 3004;

if (!API_KEY) {
  console.error('[Relay] Error: AISSTREAM_API_KEY environment variable not set');
  console.error('[Relay] Get a free key at https://aisstream.io');
  process.exit(1);
}

const MAX_WS_CLIENTS = 10; // Cap WS clients — app uses HTTP snapshots, not WS

let upstreamSocket = null;
let clients = new Set();
let messageCount = 0;

// gzip compress & send a response (reduces egress ~80% for JSON)
function sendCompressed(req, res, statusCode, headers, body) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (acceptEncoding.includes('gzip')) {
    zlib.gzip(typeof body === 'string' ? Buffer.from(body) : body, (err, compressed) => {
      if (err) {
        res.writeHead(statusCode, headers);
        res.end(body);
        return;
      }
      res.writeHead(statusCode, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
      res.end(compressed);
    });
  } else {
    res.writeHead(statusCode, headers);
    res.end(body);
  }
}

// AIS aggregate state for snapshot API (server-side fanout)
const GRID_SIZE = 2;
const DENSITY_WINDOW = 30 * 60 * 1000; // 30 minutes
const GAP_THRESHOLD = 60 * 60 * 1000; // 1 hour
const SNAPSHOT_INTERVAL_MS = Math.max(2000, Number(process.env.AIS_SNAPSHOT_INTERVAL_MS || 5000));
const CANDIDATE_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_DENSITY_ZONES = 200;
const MAX_CANDIDATE_REPORTS = 1500;

const vessels = new Map();
const vesselHistory = new Map();
const densityGrid = new Map();
const candidateReports = new Map();

let snapshotSequence = 0;
let lastSnapshot = null;
let lastSnapshotAt = 0;

const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.5, radius: 2 },
  { name: 'Suez Canal', lat: 30.0, lon: 32.5, radius: 1 },
  { name: 'Strait of Malacca', lat: 2.5, lon: 101.5, radius: 2 },
  { name: 'Bab el-Mandeb', lat: 12.5, lon: 43.5, radius: 1.5 },
  { name: 'Panama Canal', lat: 9.0, lon: -79.5, radius: 1 },
  { name: 'Taiwan Strait', lat: 24.5, lon: 119.5, radius: 2 },
  { name: 'South China Sea', lat: 15.0, lon: 115.0, radius: 5 },
  { name: 'Black Sea', lat: 43.5, lon: 34.0, radius: 3 },
];

const NAVAL_PREFIX_RE = /^(USS|USNS|HMS|HMAS|HMCS|INS|JS|ROKS|TCG|FS|BNS|RFS|PLAN|PLA|CGC|PNS|KRI|ITS|SNS|MMSI)/i;

function getGridKey(lat, lon) {
  const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE;
  const gridLon = Math.floor(lon / GRID_SIZE) * GRID_SIZE;
  return `${gridLat},${gridLon}`;
}

function isLikelyMilitaryCandidate(meta) {
  const mmsi = String(meta?.MMSI || '');
  const shipType = Number(meta?.ShipType);
  const name = (meta?.ShipName || '').trim().toUpperCase();

  if (Number.isFinite(shipType) && (shipType === 35 || shipType === 55 || (shipType >= 50 && shipType <= 59))) {
    return true;
  }

  if (name && NAVAL_PREFIX_RE.test(name)) return true;

  if (mmsi.length >= 9) {
    const suffix = mmsi.substring(3);
    if (suffix.startsWith('00') || suffix.startsWith('99')) return true;
  }

  return false;
}

function processPositionReportForSnapshot(data) {
  const meta = data?.MetaData;
  const pos = data?.Message?.PositionReport;
  if (!meta || !pos) return;

  const mmsi = String(meta.MMSI || '');
  if (!mmsi) return;

  const lat = Number.isFinite(pos.Latitude) ? pos.Latitude : meta.latitude;
  const lon = Number.isFinite(pos.Longitude) ? pos.Longitude : meta.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const now = Date.now();

  vessels.set(mmsi, {
    mmsi,
    name: meta.ShipName || '',
    lat,
    lon,
    timestamp: now,
    shipType: meta.ShipType,
    heading: pos.TrueHeading,
    speed: pos.Sog,
    course: pos.Cog,
  });

  const history = vesselHistory.get(mmsi) || [];
  history.push(now);
  if (history.length > 10) history.shift();
  vesselHistory.set(mmsi, history);

  const gridKey = getGridKey(lat, lon);
  let cell = densityGrid.get(gridKey);
  if (!cell) {
    cell = {
      lat: Math.floor(lat / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      lon: Math.floor(lon / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      vessels: new Set(),
      lastUpdate: now,
      previousCount: 0,
    };
    densityGrid.set(gridKey, cell);
  }
  cell.vessels.add(mmsi);
  cell.lastUpdate = now;

  if (isLikelyMilitaryCandidate(meta)) {
    candidateReports.set(mmsi, {
      mmsi,
      name: meta.ShipName || '',
      lat,
      lon,
      shipType: meta.ShipType,
      heading: pos.TrueHeading,
      speed: pos.Sog,
      course: pos.Cog,
      timestamp: now,
    });
  }
}

function cleanupAggregates() {
  const now = Date.now();
  const cutoff = now - DENSITY_WINDOW;

  for (const [mmsi, vessel] of vessels) {
    if (vessel.timestamp < cutoff) {
      vessels.delete(mmsi);
    }
  }

  for (const [mmsi, history] of vesselHistory) {
    const filtered = history.filter((ts) => ts >= cutoff);
    if (filtered.length === 0) {
      vesselHistory.delete(mmsi);
    } else {
      vesselHistory.set(mmsi, filtered);
    }
  }

  for (const [key, cell] of densityGrid) {
    cell.previousCount = cell.vessels.size;

    for (const mmsi of cell.vessels) {
      const vessel = vessels.get(mmsi);
      if (!vessel || vessel.timestamp < cutoff) {
        cell.vessels.delete(mmsi);
      }
    }

    if (cell.vessels.size === 0 && now - cell.lastUpdate > DENSITY_WINDOW * 2) {
      densityGrid.delete(key);
    }
  }

  for (const [mmsi, report] of candidateReports) {
    if (report.timestamp < now - CANDIDATE_RETENTION_MS) {
      candidateReports.delete(mmsi);
    }
  }
}

function detectDisruptions() {
  const disruptions = [];
  const now = Date.now();

  for (const chokepoint of CHOKEPOINTS) {
    let vesselCount = 0;

    for (const vessel of vessels.values()) {
      const distance = Math.sqrt(
        Math.pow(vessel.lat - chokepoint.lat, 2) +
        Math.pow(vessel.lon - chokepoint.lon, 2)
      );
      if (distance <= chokepoint.radius) {
        vesselCount++;
      }
    }

    if (vesselCount >= 5) {
      const normalTraffic = chokepoint.radius * 10;
      const severity = vesselCount > normalTraffic * 1.5
        ? 'high'
        : vesselCount > normalTraffic
          ? 'elevated'
          : 'low';

      disruptions.push({
        id: `chokepoint-${chokepoint.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: chokepoint.name,
        type: 'chokepoint_congestion',
        lat: chokepoint.lat,
        lon: chokepoint.lon,
        severity,
        changePct: normalTraffic > 0 ? Math.round((vesselCount / normalTraffic - 1) * 100) : 0,
        windowHours: 1,
        vesselCount,
        region: chokepoint.name,
        description: `${vesselCount} vessels in ${chokepoint.name}`,
      });
    }
  }

  let darkShipCount = 0;
  for (const history of vesselHistory.values()) {
    if (history.length >= 2) {
      const lastSeen = history[history.length - 1];
      const secondLast = history[history.length - 2];
      if (lastSeen - secondLast > GAP_THRESHOLD && now - lastSeen < 10 * 60 * 1000) {
        darkShipCount++;
      }
    }
  }

  if (darkShipCount >= 1) {
    disruptions.push({
      id: 'global-gap-spike',
      name: 'AIS Gap Spike Detected',
      type: 'gap_spike',
      lat: 0,
      lon: 0,
      severity: darkShipCount > 20 ? 'high' : darkShipCount > 10 ? 'elevated' : 'low',
      changePct: darkShipCount * 10,
      windowHours: 1,
      darkShips: darkShipCount,
      description: `${darkShipCount} vessels returned after extended AIS silence`,
    });
  }

  return disruptions;
}

function calculateDensityZones() {
  const zones = [];
  const allCells = Array.from(densityGrid.values()).filter((c) => c.vessels.size >= 2);
  if (allCells.length === 0) return zones;

  const vesselCounts = allCells.map((c) => c.vessels.size);
  const maxVessels = Math.max(...vesselCounts);
  const minVessels = Math.min(...vesselCounts);

  for (const [key, cell] of densityGrid) {
    if (cell.vessels.size < 2) continue;

    const logMax = Math.log(maxVessels + 1);
    const logMin = Math.log(minVessels + 1);
    const logCurrent = Math.log(cell.vessels.size + 1);

    const intensity = logMax > logMin
      ? 0.2 + (0.8 * (logCurrent - logMin) / (logMax - logMin))
      : 0.5;

    const deltaPct = cell.previousCount > 0
      ? Math.round(((cell.vessels.size - cell.previousCount) / cell.previousCount) * 100)
      : 0;

    zones.push({
      id: `density-${key}`,
      name: `Zone ${key}`,
      lat: cell.lat,
      lon: cell.lon,
      intensity,
      deltaPct,
      shipsPerDay: cell.vessels.size * 48,
      note: cell.vessels.size >= 10 ? 'High traffic area' : undefined,
    });
  }

  return zones
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, MAX_DENSITY_ZONES);
}

function getCandidateReportsSnapshot() {
  return Array.from(candidateReports.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CANDIDATE_REPORTS);
}

function buildSnapshot() {
  const now = Date.now();
  if (lastSnapshot && now - lastSnapshotAt < Math.floor(SNAPSHOT_INTERVAL_MS / 2)) {
    return lastSnapshot;
  }

  cleanupAggregates();
  snapshotSequence++;

  lastSnapshot = {
    sequence: snapshotSequence,
    timestamp: new Date(now).toISOString(),
    status: {
      connected: upstreamSocket?.readyState === WebSocket.OPEN,
      vessels: vessels.size,
      messages: messageCount,
      clients: clients.size,
    },
    disruptions: detectDisruptions(),
    density: calculateDensityZones(),
  };
  lastSnapshotAt = now;
  return lastSnapshot;
}

setInterval(() => {
  if (upstreamSocket?.readyState === WebSocket.OPEN || vessels.size > 0) {
    buildSnapshot();
  }
}, SNAPSHOT_INTERVAL_MS);

// UCDP GED Events cache (persistent in-memory — Railway advantage)
const UCDP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const UCDP_PAGE_SIZE = 1000;
const UCDP_MAX_PAGES = 12;
const UCDP_FETCH_TIMEOUT = 30000; // 30s per page (no Railway limit)
const UCDP_TRAILING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

let ucdpCache = { data: null, timestamp: 0 };
let ucdpFetchInProgress = false;

const UCDP_VIOLENCE_TYPE_MAP = {
  1: 'state-based',
  2: 'non-state',
  3: 'one-sided',
};

function ucdpParseDateMs(value) {
  if (!value) return NaN;
  return Date.parse(String(value));
}

function ucdpGetMaxDateMs(events) {
  let maxMs = NaN;
  for (const event of events) {
    const ms = ucdpParseDateMs(event?.date_start);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(maxMs) || ms > maxMs) maxMs = ms;
  }
  return maxMs;
}

function ucdpBuildVersionCandidates() {
  const year = new Date().getFullYear() - 2000;
  return Array.from(new Set([`${year}.1`, `${year - 1}.1`, '25.1', '24.1']));
}

async function ucdpFetchPage(version, page) {
  const https = require('https');
  const url = `https://ucdpapi.pcr.uu.se/api/gedevents/${version}?pagesize=${UCDP_PAGE_SIZE}&page=${page}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' }, timeout: UCDP_FETCH_TIMEOUT }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`UCDP API ${res.statusCode} (v${version} p${page})`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('UCDP JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('UCDP timeout')); });
  });
}

async function ucdpDiscoverVersion() {
  const candidates = ucdpBuildVersionCandidates();
  for (const version of candidates) {
    try {
      const page0 = await ucdpFetchPage(version, 0);
      if (Array.isArray(page0?.Result)) return { version, page0 };
    } catch { /* next candidate */ }
  }
  throw new Error('No valid UCDP GED version found');
}

async function ucdpFetchAllEvents() {
  const { version, page0 } = await ucdpDiscoverVersion();
  const totalPages = Math.max(1, Number(page0?.TotalPages) || 1);
  const newestPage = totalPages - 1;

  let allEvents = [];
  let latestDatasetMs = NaN;

  for (let offset = 0; offset < UCDP_MAX_PAGES && (newestPage - offset) >= 0; offset++) {
    const page = newestPage - offset;
    const rawData = page === 0 ? page0 : await ucdpFetchPage(version, page);
    const events = Array.isArray(rawData?.Result) ? rawData.Result : [];
    allEvents = allEvents.concat(events);

    const pageMaxMs = ucdpGetMaxDateMs(events);
    if (!Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
      latestDatasetMs = pageMaxMs;
    }
    if (Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
      if (pageMaxMs < latestDatasetMs - UCDP_TRAILING_WINDOW_MS) break;
    }
    console.log(`[UCDP] Fetched v${version} page ${page} (${events.length} events)`);
  }

  const sanitized = allEvents
    .filter(e => {
      if (!Number.isFinite(latestDatasetMs)) return true;
      const ms = ucdpParseDateMs(e?.date_start);
      return Number.isFinite(ms) && ms >= (latestDatasetMs - UCDP_TRAILING_WINDOW_MS);
    })
    .map(e => ({
      id: String(e.id || ''),
      date_start: e.date_start || '',
      date_end: e.date_end || '',
      latitude: Number(e.latitude) || 0,
      longitude: Number(e.longitude) || 0,
      country: e.country || '',
      side_a: (e.side_a || '').substring(0, 200),
      side_b: (e.side_b || '').substring(0, 200),
      deaths_best: Number(e.best) || 0,
      deaths_low: Number(e.low) || 0,
      deaths_high: Number(e.high) || 0,
      type_of_violence: UCDP_VIOLENCE_TYPE_MAP[e.type_of_violence] || 'state-based',
      source_original: (e.source_original || '').substring(0, 300),
    }))
    .sort((a, b) => {
      const bMs = ucdpParseDateMs(b.date_start);
      const aMs = ucdpParseDateMs(a.date_start);
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    });

  return {
    success: true,
    count: sanitized.length,
    data: sanitized,
    version,
    cached_at: new Date().toISOString(),
  };
}

async function handleUcdpEventsRequest(req, res) {
  const now = Date.now();

  if (ucdpCache.data && now - ucdpCache.timestamp < UCDP_CACHE_TTL_MS) {
    return sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': 'HIT',
    }, JSON.stringify(ucdpCache.data));
  }

  if (ucdpCache.data && !ucdpFetchInProgress) {
    ucdpFetchInProgress = true;
    ucdpFetchAllEvents()
      .then(result => {
        ucdpCache = { data: result, timestamp: Date.now() };
        console.log(`[UCDP] Background refresh: ${result.count} events (v${result.version})`);
      })
      .catch(err => console.error('[UCDP] Background refresh error:', err.message))
      .finally(() => { ucdpFetchInProgress = false; });

    return sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
      'X-Cache': 'STALE',
    }, JSON.stringify(ucdpCache.data));
  }

  if (ucdpFetchInProgress) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, count: 0, data: [], cached_at: '', message: 'Fetch in progress' }));
  }

  try {
    ucdpFetchInProgress = true;
    console.log('[UCDP] Cold fetch starting...');
    const result = await ucdpFetchAllEvents();
    ucdpCache = { data: result, timestamp: Date.now() };
    ucdpFetchInProgress = false;
    console.log(`[UCDP] Cold fetch complete: ${result.count} events (v${result.version})`);

    sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': 'MISS',
    }, JSON.stringify(result));
  } catch (err) {
    ucdpFetchInProgress = false;
    console.error('[UCDP] Fetch error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message, count: 0, data: [] }));
  }
}

// ── Response caches (eliminates ~1.2TB/day OpenSky + ~30GB/day RSS egress) ──
const openskyResponseCache = new Map(); // key: sorted query params → { data, timestamp }
const openskyInFlight = new Map(); // key: cacheKey → Promise (dedup concurrent requests)
const OPENSKY_CACHE_TTL_MS = 30 * 1000; // 30s — OpenSky updates every ~10s but 58 clients hammer it
const rssResponseCache = new Map(); // key: feed URL → { data, contentType, timestamp }
const rssInFlight = new Map(); // key: feed URL → Promise (dedup concurrent requests)
const RSS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — RSS feeds rarely update faster

// OpenSky OAuth2 token cache + mutex to prevent thundering herd
let openskyToken = null;
let openskyTokenExpiry = 0;
let openskyTokenPromise = null; // mutex: single in-flight token request
let openskyAuthCooldownUntil = 0; // backoff after repeated failures
const OPENSKY_AUTH_COOLDOWN_MS = 60000; // 1 min cooldown after auth failure

async function getOpenSkyToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (openskyToken && Date.now() < openskyTokenExpiry - 60000) {
    return openskyToken;
  }

  // Cooldown: don't retry auth if it recently failed (prevents stampede)
  if (Date.now() < openskyAuthCooldownUntil) {
    return null;
  }

  // Mutex: if a token fetch is already in flight, wait for it
  if (openskyTokenPromise) {
    return openskyTokenPromise;
  }

  openskyTokenPromise = _fetchOpenSkyToken(clientId, clientSecret);
  try {
    return await openskyTokenPromise;
  } finally {
    openskyTokenPromise = null;
  }
}

async function _fetchOpenSkyToken(clientId, clientSecret) {
  try {
    console.log('[Relay] Fetching new OpenSky OAuth2 token...');
    const https = require('https');

    const token = await new Promise((resolve) => {
      const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

      const req = https.request({
        hostname: 'auth.opensky-network.org',
        port: 443,
        path: '/auth/realms/opensky-network/protocol/openid-connect/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              openskyToken = json.access_token;
              openskyTokenExpiry = Date.now() + (json.expires_in || 1800) * 1000;
              console.log('[Relay] OpenSky token acquired, expires in', json.expires_in, 'seconds');
              resolve(openskyToken);
            } else {
              console.error('[Relay] OpenSky token error:', json.error || 'Unknown');
              resolve(null);
            }
          } catch (e) {
            console.error('[Relay] OpenSky token parse error:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Relay] OpenSky token request error:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });

    if (!token) {
      // Auth failed — cooldown to prevent stampede
      openskyAuthCooldownUntil = Date.now() + OPENSKY_AUTH_COOLDOWN_MS;
      console.warn(`[Relay] OpenSky auth failed, cooling down for ${OPENSKY_AUTH_COOLDOWN_MS / 1000}s`);
    }
    return token;
  } catch (err) {
    console.error('[Relay] OpenSky token error:', err.message);
    openskyAuthCooldownUntil = Date.now() + OPENSKY_AUTH_COOLDOWN_MS;
    return null;
  }
}

async function handleOpenSkyRequest(req, res, PORT) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const params = url.searchParams;

    const cacheKey = ['lamin', 'lomin', 'lamax', 'lomax']
      .map(k => params.get(k) || '')
      .join(',');

    const cached = openskyResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < OPENSKY_CACHE_TTL_MS) {
      return sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
        'X-Cache': 'HIT',
      }, cached.data);
    }

    const existing = openskyInFlight.get(cacheKey);
    if (existing) {
      try {
        await existing;
        const deduped = openskyResponseCache.get(cacheKey);
        if (deduped) {
          return sendCompressed(req, res, 200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30',
            'X-Cache': 'DEDUP',
          }, deduped.data);
        }
      } catch { /* in-flight failed, fall through to own fetch */ }
    }

    const token = await getOpenSkyToken();
    if (!token) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenSky not configured or auth failed', time: Date.now(), states: [] }));
      return;
    }

    let openskyUrl = 'https://opensky-network.org/api/states/all';
    const queryParams = [];
    for (const key of ['lamin', 'lomin', 'lamax', 'lomax']) {
      if (params.has(key)) queryParams.push(`${key}=${params.get(key)}`);
    }
    if (queryParams.length > 0) {
      openskyUrl += '?' + queryParams.join('&');
    }

    console.log('[Relay] OpenSky request (MISS):', openskyUrl);

    const fetchPromise = new Promise((resolve, reject) => {
      const https = require('https');
      const request = https.get(openskyUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'WorldMonitor/1.0',
          'Authorization': `Bearer ${token}`,
        },
        timeout: 15000
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode === 401) {
            openskyToken = null;
            openskyTokenExpiry = 0;
          }
          if (response.statusCode === 200) {
            openskyResponseCache.set(cacheKey, { data, timestamp: Date.now() });
          }
          resolve();
          sendCompressed(req, res, response.statusCode, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30',
            'X-Cache': 'MISS',
          }, data);
        });
      });

      request.on('error', (err) => {
        console.error('[Relay] OpenSky error:', err.message);
        if (cached) {
          resolve();
          return sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'X-Cache': 'STALE' }, cached.data);
        }
        reject(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
      });

      request.on('timeout', () => {
        request.destroy();
        if (cached) {
          resolve();
          return sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'X-Cache': 'STALE' }, cached.data);
        }
        reject(new Error('timeout'));
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request timeout', time: Date.now(), states: null }));
      });
    });

    openskyInFlight.set(cacheKey, fetchPromise);
    fetchPromise.catch(() => {}).finally(() => openskyInFlight.delete(cacheKey));
  } catch (err) {
    openskyInFlight.delete(
      ['lamin', 'lomin', 'lamax', 'lomax']
        .map(k => new URL(req.url, `http://localhost:${PORT}`).searchParams.get(k) || '')
        .join(',')
    );
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
  }
}

// ── World Bank proxy (World Bank blocks Vercel edge IPs with 403) ──
const worldbankCache = new Map(); // key: query string → { data, timestamp }
const WORLDBANK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — data rarely changes

function handleWorldBankRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const qs = url.search || '';
  const cacheKey = qs;

  const cached = worldbankCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < WORLDBANK_CACHE_TTL_MS) {
    return sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=1800',
      'X-Cache': 'HIT',
    }, cached.data);
  }

  const targetUrl = `https://api.worldbank.org/v2${qs.includes('action=indicators') ? '' : '/country'}${url.pathname.replace('/worldbank', '')}${qs}`;
  // Passthrough: forward query params to the Vercel edge handler format
  // The client sends the same params as /api/worldbank, so we re-fetch from upstream
  const wbParams = new URLSearchParams(url.searchParams);
  const action = wbParams.get('action');

  if (action === 'indicators') {
    // Static response — return indicator list directly (same as api/worldbank.js)
    const indicators = {
      'IT.NET.USER.ZS': 'Internet Users (% of population)',
      'IT.CEL.SETS.P2': 'Mobile Subscriptions (per 100 people)',
      'IT.NET.BBND.P2': 'Fixed Broadband Subscriptions (per 100 people)',
      'IT.NET.SECR.P6': 'Secure Internet Servers (per million people)',
      'GB.XPD.RSDV.GD.ZS': 'R&D Expenditure (% of GDP)',
      'IP.PAT.RESD': 'Patent Applications (residents)',
      'IP.PAT.NRES': 'Patent Applications (non-residents)',
      'IP.TMK.TOTL': 'Trademark Applications',
      'TX.VAL.TECH.MF.ZS': 'High-Tech Exports (% of manufactured exports)',
      'BX.GSR.CCIS.ZS': 'ICT Service Exports (% of service exports)',
      'TM.VAL.ICTG.ZS.UN': 'ICT Goods Imports (% of total goods imports)',
      'SE.TER.ENRR': 'Tertiary Education Enrollment (%)',
      'SE.XPD.TOTL.GD.ZS': 'Education Expenditure (% of GDP)',
      'NY.GDP.MKTP.KD.ZG': 'GDP Growth (annual %)',
      'NY.GDP.PCAP.CD': 'GDP per Capita (current US$)',
      'NE.EXP.GNFS.ZS': 'Exports of Goods & Services (% of GDP)',
    };
    const defaultCountries = [
      'USA','CHN','JPN','DEU','KOR','GBR','IND','ISR','SGP','TWN',
      'FRA','CAN','SWE','NLD','CHE','FIN','IRL','AUS','BRA','IDN',
      'ARE','SAU','QAT','BHR','EGY','TUR','MYS','THA','VNM','PHL',
      'ESP','ITA','POL','CZE','DNK','NOR','AUT','BEL','PRT','EST',
      'MEX','ARG','CHL','COL','ZAF','NGA','KEN',
    ];
    const body = JSON.stringify({ indicators, defaultCountries });
    worldbankCache.set(cacheKey, { data: body, timestamp: Date.now() });
    return sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
      'X-Cache': 'MISS',
    }, body);
  }

  const indicator = wbParams.get('indicator');
  if (!indicator) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing indicator parameter' }));
  }

  const country = wbParams.get('country');
  const countries = wbParams.get('countries');
  const years = parseInt(wbParams.get('years') || '5', 10);
  let countryList = country || (countries ? countries.split(',').join(';') : [
    'USA','CHN','JPN','DEU','KOR','GBR','IND','ISR','SGP','TWN',
    'FRA','CAN','SWE','NLD','CHE','FIN','IRL','AUS','BRA','IDN',
    'ARE','SAU','QAT','BHR','EGY','TUR','MYS','THA','VNM','PHL',
    'ESP','ITA','POL','CZE','DNK','NOR','AUT','BEL','PRT','EST',
    'MEX','ARG','CHL','COL','ZAF','NGA','KEN',
  ].join(';'));

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - years;
  const TECH_INDICATORS = {
    'IT.NET.USER.ZS': 'Internet Users (% of population)',
    'IT.CEL.SETS.P2': 'Mobile Subscriptions (per 100 people)',
    'IT.NET.BBND.P2': 'Fixed Broadband Subscriptions (per 100 people)',
    'IT.NET.SECR.P6': 'Secure Internet Servers (per million people)',
    'GB.XPD.RSDV.GD.ZS': 'R&D Expenditure (% of GDP)',
    'IP.PAT.RESD': 'Patent Applications (residents)',
    'IP.PAT.NRES': 'Patent Applications (non-residents)',
    'IP.TMK.TOTL': 'Trademark Applications',
    'TX.VAL.TECH.MF.ZS': 'High-Tech Exports (% of manufactured exports)',
    'BX.GSR.CCIS.ZS': 'ICT Service Exports (% of service exports)',
    'TM.VAL.ICTG.ZS.UN': 'ICT Goods Imports (% of total goods imports)',
    'SE.TER.ENRR': 'Tertiary Education Enrollment (%)',
    'SE.XPD.TOTL.GD.ZS': 'Education Expenditure (% of GDP)',
    'NY.GDP.MKTP.KD.ZG': 'GDP Growth (annual %)',
    'NY.GDP.PCAP.CD': 'GDP per Capita (current US$)',
    'NE.EXP.GNFS.ZS': 'Exports of Goods & Services (% of GDP)',
  };

  const wbUrl = `https://api.worldbank.org/v2/country/${countryList}/indicator/${encodeURIComponent(indicator)}?format=json&date=${startYear}:${currentYear}&per_page=1000`;

  console.log('[Relay] World Bank request (MISS):', indicator);

  const https = require('https');
  const request = https.get(wbUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; WorldMonitor/1.0; +https://worldmonitor.app)',
    },
    timeout: 15000,
  }, (response) => {
    if (response.statusCode !== 200) {
      res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `World Bank API ${response.statusCode}` }));
    }
    let rawData = '';
    response.on('data', chunk => rawData += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(rawData);
        // Transform raw World Bank response to match client-expected format
        if (!parsed || !Array.isArray(parsed) || parsed.length < 2 || !parsed[1]) {
          const empty = JSON.stringify({
            indicator,
            indicatorName: TECH_INDICATORS[indicator] || indicator,
            metadata: { page: 1, pages: 1, total: 0 },
            byCountry: {}, latestByCountry: {}, timeSeries: [],
          });
          worldbankCache.set(cacheKey, { data: empty, timestamp: Date.now() });
          return sendCompressed(req, res, 200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=1800',
            'X-Cache': 'MISS',
          }, empty);
        }

        const [metadata, records] = parsed;
        const transformed = {
          indicator,
          indicatorName: TECH_INDICATORS[indicator] || (records[0]?.indicator?.value || indicator),
          metadata: { page: metadata.page, pages: metadata.pages, total: metadata.total },
          byCountry: {}, latestByCountry: {}, timeSeries: [],
        };

        for (const record of records || []) {
          const cc = record.countryiso3code || record.country?.id;
          const cn = record.country?.value;
          const yr = record.date;
          const val = record.value;
          if (!cc || val === null) continue;
          if (!transformed.byCountry[cc]) transformed.byCountry[cc] = { code: cc, name: cn, values: [] };
          transformed.byCountry[cc].values.push({ year: yr, value: val });
          if (!transformed.latestByCountry[cc] || yr > transformed.latestByCountry[cc].year) {
            transformed.latestByCountry[cc] = { code: cc, name: cn, year: yr, value: val };
          }
          transformed.timeSeries.push({ countryCode: cc, countryName: cn, year: yr, value: val });
        }
        for (const c of Object.values(transformed.byCountry)) c.values.sort((a, b) => a.year - b.year);
        transformed.timeSeries.sort((a, b) => b.year - a.year || a.countryCode.localeCompare(b.countryCode));

        const body = JSON.stringify(transformed);
        worldbankCache.set(cacheKey, { data: body, timestamp: Date.now() });
        sendCompressed(req, res, 200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800',
          'X-Cache': 'MISS',
        }, body);
      } catch (e) {
        console.error('[Relay] World Bank parse error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parse error' }));
      }
    });
  });
  request.on('error', (err) => {
    console.error('[Relay] World Bank error:', err.message);
    if (cached) {
      return sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'X-Cache': 'STALE',
      }, cached.data);
    }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
  request.on('timeout', () => {
    request.destroy();
    if (cached) {
      return sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'X-Cache': 'STALE',
      }, cached.data);
    }
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'World Bank request timeout' }));
  });
}

// ── Polymarket proxy (Cloudflare JA3 blocks Vercel edge runtime) ──
const polymarketCache = new Map(); // key: query string → { data, timestamp }
const POLYMARKET_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — market data changes frequently

function handlePolymarketRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cacheKey = url.search || '';

  const cached = polymarketCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < POLYMARKET_CACHE_TTL_MS) {
    return sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120',
      'X-Cache': 'HIT',
      'X-Polymarket-Source': 'railway-cache',
    }, cached.data);
  }

  const endpoint = url.searchParams.get('endpoint') || 'markets';
  const params = new URLSearchParams();
  params.set('closed', url.searchParams.get('closed') || 'false');
  params.set('order', url.searchParams.get('order') || 'volume');
  params.set('ascending', url.searchParams.get('ascending') || 'false');
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  params.set('limit', String(limit));
  const tag = url.searchParams.get('tag') || url.searchParams.get('tag_slug');
  if (tag && endpoint === 'events') params.set('tag_slug', tag.replace(/[^a-z0-9-]/gi, '').slice(0, 100));

  const gammaUrl = `https://gamma-api.polymarket.com/${endpoint}?${params}`;
  console.log('[Relay] Polymarket request (MISS):', endpoint, tag || '');

  const https = require('https');
  const request = https.get(gammaUrl, {
    headers: { 'Accept': 'application/json' },
    timeout: 10000,
  }, (response) => {
    if (response.statusCode !== 200) {
      console.error(`[Relay] Polymarket upstream ${response.statusCode}`);
      res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      polymarketCache.set(cacheKey, { data, timestamp: Date.now() });
      sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120',
        'X-Cache': 'MISS',
        'X-Polymarket-Source': 'railway',
      }, data);
    });
  });
  request.on('error', (err) => {
    console.error('[Relay] Polymarket error:', err.message);
    if (cached) {
      return sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'X-Cache': 'STALE',
        'X-Polymarket-Source': 'railway-stale',
      }, cached.data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  });
  request.on('timeout', () => {
    request.destroy();
    if (cached) {
      return sendCompressed(req, res, 200, {
        'Content-Type': 'application/json',
        'X-Cache': 'STALE',
        'X-Polymarket-Source': 'railway-stale',
      }, cached.data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  });
}

// Periodic cache cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of openskyResponseCache) {
    if (now - entry.timestamp > OPENSKY_CACHE_TTL_MS * 2) openskyResponseCache.delete(key);
  }
  for (const [key, entry] of rssResponseCache) {
    if (now - entry.timestamp > RSS_CACHE_TTL_MS * 2) rssResponseCache.delete(key);
  }
  for (const [key, entry] of worldbankCache) {
    if (now - entry.timestamp > WORLDBANK_CACHE_TTL_MS * 2) worldbankCache.delete(key);
  }
  for (const [key, entry] of polymarketCache) {
    if (now - entry.timestamp > POLYMARKET_CACHE_TTL_MS * 2) polymarketCache.delete(key);
  }
}, 60 * 1000);

// CORS origin allowlist — only our domains can use this relay
const ALLOWED_ORIGINS = [
  'https://worldmonitor.app',
  'https://tech.worldmonitor.app',
  'https://finance.worldmonitor.app',
  'http://localhost:5173',   // Vite dev
  'http://localhost:5174',   // Vite dev alt port
  'http://localhost:4173',   // Vite preview
  'https://localhost',       // Tauri desktop
  'tauri://localhost',       // Tauri iOS/macOS
];

function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Allow Vercel preview deployments
  if (origin.endsWith('.vercel.app')) return origin;
  return '';
}

const server = http.createServer(async (req, res) => {
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(corsOrigin ? 204 : 403);
    return res.end();
  }

  if (req.url === '/health' || req.url === '/') {
    sendCompressed(req, res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({
      status: 'ok',
      clients: clients.size,
      messages: messageCount,
      connected: upstreamSocket?.readyState === WebSocket.OPEN,
      vessels: vessels.size,
      densityZones: Array.from(densityGrid.values()).filter(c => c.vessels.size >= 2).length,
      cache: {
        opensky: openskyResponseCache.size,
        rss: rssResponseCache.size,
        ucdp: ucdpCache.data ? 'warm' : 'cold',
        worldbank: worldbankCache.size,
        polymarket: polymarketCache.size,
      },
    }));
  } else if (req.url.startsWith('/ais/snapshot')) {
    // Aggregated AIS snapshot for server-side fanout
    connectUpstream();
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const includeCandidates = url.searchParams.get('candidates') === 'true';
    const snapshot = buildSnapshot();
    const payload = includeCandidates
      ? { ...snapshot, candidateReports: getCandidateReportsSnapshot() }
      : { ...snapshot, candidateReports: [] };

    sendCompressed(req, res, 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=2'
    }, JSON.stringify(payload));
  } else if (req.url === '/opensky-diag') {
    // Temporary diagnostic route with safe output only (no token payloads).
    const now = Date.now();
    const hasFreshToken = !!(openskyToken && now < openskyTokenExpiry - 60000);
    const diag = { timestamp: new Date().toISOString(), steps: [] };
    const clientId = process.env.OPENSKY_CLIENT_ID;
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

    diag.steps.push({ step: 'env_check', hasClientId: !!clientId, hasClientSecret: !!clientSecret });
    diag.steps.push({
      step: 'auth_state',
      cachedToken: !!openskyToken,
      freshToken: hasFreshToken,
      tokenExpiry: openskyTokenExpiry ? new Date(openskyTokenExpiry).toISOString() : null,
      cooldownRemainingMs: Math.max(0, openskyAuthCooldownUntil - now),
      tokenFetchInFlight: !!openskyTokenPromise,
    });

    if (!clientId || !clientSecret) {
      diag.steps.push({ step: 'FAILED', reason: 'Missing OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET' });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(diag, null, 2));
    }

    // Use shared token path so diagnostics respect mutex + cooldown protections.
    const tokenStart = Date.now();
    const token = await getOpenSkyToken();
    diag.steps.push({
      step: 'token_request',
      method: 'getOpenSkyToken',
      success: !!token,
      fromCache: hasFreshToken,
      latencyMs: Date.now() - tokenStart,
      cooldownRemainingMs: Math.max(0, openskyAuthCooldownUntil - Date.now()),
    });

    if (token) {
      const https = require('https');
      const apiResult = await new Promise((resolve) => {
        const start = Date.now();
        const apiReq = https.get('https://opensky-network.org/api/states/all?lamin=47&lomin=5&lamax=48&lomax=6', {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          timeout: 15000,
        }, (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => resolve({
            status: apiRes.statusCode,
            latencyMs: Date.now() - start,
            bodyLength: data.length,
            statesCount: (data.match(/"states":\s*\[/) ? 'present' : 'missing'),
          }));
        });
        apiReq.on('error', (err) => resolve({ error: err.message, code: err.code, latencyMs: Date.now() - start }));
        apiReq.on('timeout', () => { apiReq.destroy(); resolve({ error: 'timeout', latencyMs: Date.now() - start }); });
      });
      diag.steps.push({ step: 'api_request', ...apiResult });
    } else {
      diag.steps.push({ step: 'api_request', skipped: true, reason: 'No token available (auth failure or cooldown active)' });
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(diag, null, 2));
  } else if (req.url.startsWith('/rss')) {
    // Proxy RSS feeds that block Vercel IPs
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const feedUrl = url.searchParams.get('url');

      if (!feedUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing url parameter' }));
      }

      // Allow domains that block Vercel IPs (must match feeds.ts railwayRss usage)
      const allowedDomains = [
        // Original
        'rss.cnn.com',
        'www.defensenews.com',
        'layoffs.fyi',
        // International Organizations
        'news.un.org',
        'www.cisa.gov',
        'www.iaea.org',
        'www.who.int',
        'www.crisisgroup.org',
        // Middle East & Regional News
        'english.alarabiya.net',
        'www.arabnews.com',
        'www.timesofisrael.com',
        'www.scmp.com',
        'kyivindependent.com',
        'www.themoscowtimes.com',
        // Africa
        'feeds.24.com',
        'feeds.capi24.com',  // News24 redirect destination
        'www.atlanticcouncil.org',
        // RSSHub (NHK, MIIT, MOFCOM)
        'rsshub.app',
      ];
      const parsed = new URL(feedUrl);
      if (!allowedDomains.includes(parsed.hostname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Domain not allowed on Railway proxy' }));
      }

      // Serve from cache if fresh (5 min TTL)
      const rssCached = rssResponseCache.get(feedUrl);
      if (rssCached && Date.now() - rssCached.timestamp < RSS_CACHE_TTL_MS) {
        return sendCompressed(req, res, 200, {
          'Content-Type': rssCached.contentType || 'application/xml',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'HIT',
        }, rssCached.data);
      }

      // In-flight dedup: if another request for the same feed is already fetching,
      // wait for it and serve from cache instead of hammering upstream.
      const existing = rssInFlight.get(feedUrl);
      if (existing) {
        try {
          await existing;
          const deduped = rssResponseCache.get(feedUrl);
          if (deduped) {
            return sendCompressed(req, res, 200, {
              'Content-Type': deduped.contentType || 'application/xml',
              'Cache-Control': 'public, max-age=300',
              'X-Cache': 'DEDUP',
            }, deduped.data);
          }
        } catch { /* in-flight failed, fall through to own fetch */ }
      }

      console.log('[Relay] RSS request (MISS):', feedUrl);

      const fetchPromise = new Promise((resolveInFlight, rejectInFlight) => {
      const https = require('https');
      const http = require('http');

      let responseHandled = false;

      const sendError = (statusCode, message) => {
        if (responseHandled || res.headersSent) return;
        responseHandled = true;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
        rejectInFlight(new Error(message));
      };

      const fetchWithRedirects = (url, redirectCount = 0) => {
        if (redirectCount > 3) {
          return sendError(502, 'Too many redirects');
        }

        const protocol = url.startsWith('https') ? https : http;
        const request = protocol.get(url, {
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000
        }, (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            const redirectUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, url).href;
            console.log(`[Relay] Following redirect to: ${redirectUrl}`);
            return fetchWithRedirects(redirectUrl, redirectCount + 1);
          }

          const encoding = response.headers['content-encoding'];
          let stream = response;
          if (encoding === 'gzip' || encoding === 'deflate') {
            const zlib = require('zlib');
            stream = encoding === 'gzip' ? response.pipe(zlib.createGunzip()) : response.pipe(zlib.createInflate());
          }

          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            if (responseHandled || res.headersSent) return;
            responseHandled = true;
            const data = Buffer.concat(chunks);
            // Cache successful responses
            if (response.statusCode >= 200 && response.statusCode < 300) {
              rssResponseCache.set(feedUrl, { data, contentType: 'application/xml', timestamp: Date.now() });
            }
            resolveInFlight();
            sendCompressed(req, res, response.statusCode, {
              'Content-Type': 'application/xml',
              'Cache-Control': 'public, max-age=300',
              'X-Cache': 'MISS',
            }, data);
          });
          stream.on('error', (err) => {
            console.error('[Relay] Decompression error:', err.message);
            sendError(502, 'Decompression failed: ' + err.message);
          });
        });

        request.on('error', (err) => {
          console.error('[Relay] RSS error:', err.message);
          // Serve stale on error
          if (rssCached) {
            if (!responseHandled && !res.headersSent) {
              responseHandled = true;
              sendCompressed(req, res, 200, { 'Content-Type': 'application/xml', 'X-Cache': 'STALE' }, rssCached.data);
            }
            return;
          }
          sendError(502, err.message);
        });

        request.on('timeout', () => {
          request.destroy();
          if (rssCached && !responseHandled && !res.headersSent) {
            responseHandled = true;
            return sendCompressed(req, res, 200, { 'Content-Type': 'application/xml', 'X-Cache': 'STALE' }, rssCached.data);
          }
          sendError(504, 'Request timeout');
        });
      };

      fetchWithRedirects(feedUrl);
      }); // end fetchPromise

      rssInFlight.set(feedUrl, fetchPromise);
      fetchPromise.catch(() => {}).finally(() => rssInFlight.delete(feedUrl));
    } catch (err) {
      rssInFlight.delete(feedUrl);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  } else if (req.url.startsWith('/ucdp-events')) {
    handleUcdpEventsRequest(req, res);
  } else if (req.url.startsWith('/opensky')) {
    handleOpenSkyRequest(req, res, PORT);
  } else if (req.url.startsWith('/worldbank')) {
    handleWorldBankRequest(req, res);
  } else if (req.url.startsWith('/polymarket')) {
    handlePolymarketRequest(req, res);
  } else if (req.url.startsWith('/info-ops/recent')) {
    handleInfoOpsRequest(req, res);
  } else if (req.url.startsWith('/acars/recent')) {
    handleAcarsRequest(req, res);
  } else if (req.url.startsWith('/social/trends')) {
    handleSocialTrendsRequest(req, res);
  } else if (req.url.startsWith('/bgp/events')) {
    handleBgpEventsRequest(req, res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Info-Ops: Wikimedia SSE rolling buffer
// ---------------------------------------------------------------------------
const INFO_OPS_BUFFER_SIZE = 100;
const INFO_OPS_EDIT_RATE = new Map(); // pageTitle → { count, editors: Set, firstSeen }
const infoOpsBuffer = [];

// Geopolitical entity registry for relevance scoring
const GEO_ENTITIES = [
  'Ukraine', 'Russia', 'China', 'Taiwan', 'Israel', 'Gaza', 'Palestine',
  'Iran', 'North Korea', 'South Korea', 'United States', 'NATO', 'EU',
  'Syria', 'Yemen', 'Sudan', 'Somalia', 'Afghanistan', 'Pakistan',
  'India', 'Kashmir', 'Tibet', 'Xinjiang', 'Hong Kong', 'Crimea',
  'Belarus', 'Poland', 'Baltic', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan',
  'Hezbollah', 'Hamas', 'ISIS', 'Wagner', 'AI regulation', 'sanctions',
];

function scoreGeopoliticalRelevance(title) {
  const lower = title.toLowerCase();
  for (const entity of GEO_ENTITIES) {
    if (lower.includes(entity.toLowerCase())) return { score: 0.8 + Math.random() * 0.2, entity };
  }
  return { score: 0, entity: '' };
}

let wikimediaSSE = null;

function connectWikimediaSSE() {
  if (wikimediaSSE) return;
  const https = require('https');
  console.log('[Relay] Connecting to Wikimedia SSE stream...');
  const req = https.get('https://stream.wikimedia.org/v2/stream/recentchange', {
    headers: { Accept: 'text/event-stream' },
    timeout: 30000,
  }, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type !== 'edit' && ev.type !== 'new') continue;
          const title = ev.title || '';
          const wiki = ev.wiki || 'enwiki';
          const { score, entity } = scoreGeopoliticalRelevance(title);
          if (score === 0) continue;

          const key = `${wiki}:${title}`;
          const now = Date.now();
          let entry = INFO_OPS_EDIT_RATE.get(key);
          if (!entry || now - entry.firstSeen > 3600000) {
            entry = { count: 0, editors: new Set(), firstSeen: now, wiki, title };
            INFO_OPS_EDIT_RATE.set(key, entry);
          }
          entry.count++;
          entry.editors.add(ev.user || 'anon');

          if (entry.count >= 20 && entry.editors.size >= 5) {
            const signal = {
              id: `io-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              pageTitle: title,
              wiki,
              editType: 'edit_war',
              editCount1h: entry.count,
              uniqueEditors1h: entry.editors.size,
              botTraffic: (ev.bot === true),
              geopoliticalRelevance: score,
              matchedEntity: entity,
              detectedAt: now,
            };
            infoOpsBuffer.unshift(signal);
            if (infoOpsBuffer.length > INFO_OPS_BUFFER_SIZE) infoOpsBuffer.pop();
          }
        } catch { /* ignore malformed events */ }
      }
    });
    res.on('end', () => {
      wikimediaSSE = null;
      console.log('[Relay] Wikimedia SSE disconnected, reconnecting in 10s...');
      setTimeout(connectWikimediaSSE, 10000);
    });
    res.on('error', () => {
      wikimediaSSE = null;
      setTimeout(connectWikimediaSSE, 15000);
    });
  });
  req.on('error', () => {
    wikimediaSSE = null;
    console.log('[Relay] Wikimedia SSE error, retry in 15s');
    setTimeout(connectWikimediaSSE, 15000);
  });
  wikimediaSSE = req;
}

// Start Wikimedia SSE in background (non-blocking; relay still works without it)
setTimeout(connectWikimediaSSE, 5000);

async function handleInfoOpsRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 100);
  const data = JSON.stringify(infoOpsBuffer.slice(0, limit));
  sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, data);
}

// ---------------------------------------------------------------------------
// ACARS: Airframes.io rolling buffer
// ---------------------------------------------------------------------------
const ACARS_BUFFER_SIZE = 500;
const acarsBuffer = [];
const ACARS_API_KEY = process.env.AIRFRAMES_API_KEY;

const ACARS_MIL_RE = {
  medivac: /MEDIVAC|EVAC|DUSTOFF/i,
  tactical: /STRIKE|WEAPON|LOAD|TARGET/i,
  logistics: /CARGO|PALLETS|AIRLIFT|REACH\d+/i,
};

function classifyAcarsMessage(text) {
  if (ACARS_MIL_RE.medivac.test(text)) return 'ACARS_MIL_CATEGORY_MEDICAL_EVAC';
  if (ACARS_MIL_RE.tactical.test(text)) return 'ACARS_MIL_CATEGORY_TACTICAL';
  if (ACARS_MIL_RE.logistics.test(text)) return 'ACARS_MIL_CATEGORY_LOGISTICS';
  return 'ACARS_MIL_CATEGORY_UNKNOWN';
}

let airframesWs = null;

function connectAirframesWS() {
  if (!ACARS_API_KEY) return;
  if (airframesWs) return;
  console.log('[Relay] Connecting to Airframes.io ACARS stream...');
  const ws = new WebSocket('wss://feed.airframes.io/acars', {
    headers: { 'x-api-key': ACARS_API_KEY },
  });
  airframesWs = ws;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const entry = {
        id: `acars-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tailNumber: msg.tail || '',
        flightNumber: msg.flight || '',
        messageText: msg.text || '',
        messageType: msg.label || 'FREEFMT',
        milCategory: classifyAcarsMessage(msg.text || ''),
        lat: msg.position?.lat || 0,
        lon: msg.position?.lon || 0,
        altitudeFt: msg.altitude || 0,
        freqMhz: msg.freq || '',
        receivedAt: Date.now(),
        station: msg.station_id || '',
      };
      acarsBuffer.unshift(entry);
      if (acarsBuffer.length > ACARS_BUFFER_SIZE) acarsBuffer.pop();
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    airframesWs = null;
    console.log('[Relay] Airframes WS disconnected, retry in 30s');
    setTimeout(connectAirframesWS, 30000);
  });
  ws.on('error', (err) => {
    console.error('[Relay] Airframes WS error:', err.message);
  });
}

if (ACARS_API_KEY) setTimeout(connectAirframesWS, 3000);

async function handleAcarsRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const category = url.searchParams.get('category') || '';
  let results = acarsBuffer.slice(0, limit);
  if (category && category !== 'ACARS_MIL_CATEGORY_UNSPECIFIED') {
    results = results.filter((m) => m.milCategory === category);
  }
  const data = JSON.stringify({ messages: results, sampledAt: Date.now() });
  sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, data);
}

// ---------------------------------------------------------------------------
// Social: Bluesky AT Protocol firehose — rolling keyword trend window
// ---------------------------------------------------------------------------
const SOCIAL_WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window
const socialMentions = new Map(); // entity → [{ ts, snippet }]
let blueskyWs = null;

const SOCIAL_ENTITIES = [
  'OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Meta', 'Apple', 'Nvidia',
  'Bitcoin', 'Ethereum', 'crypto', 'AI', 'ChatGPT', 'Claude', 'Gemini',
  'Ukraine', 'Russia', 'Taiwan', 'China', 'Iran', 'Gaza', 'Israel',
  'Fed', 'interest rates', 'inflation', 'recession', 'SPY', 'QQQ',
  'earthquake', 'hurricane', 'flood', 'wildfire', 'tsunami',
];

function connectBlueskeyFirehose() {
  if (blueskyWs) return;
  // Use the public Bluesky Jetstream (simpler than AT Protocol DAG-CBOR)
  const ws = new WebSocket('wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post');
  blueskyWs = ws;

  ws.on('message', (data) => {
    try {
      const ev = JSON.parse(data.toString());
      if (ev.kind !== 'commit' || !ev.commit?.record?.text) return;
      const text = ev.commit.record.text;
      const now = Date.now();
      for (const entity of SOCIAL_ENTITIES) {
        if (text.toLowerCase().includes(entity.toLowerCase())) {
          const list = socialMentions.get(entity) || [];
          list.push({ ts: now, snippet: text.slice(0, 120) });
          // Keep only last 5-min window
          const cutoff = now - SOCIAL_WINDOW_MS;
          const trimmed = list.filter((m) => m.ts > cutoff);
          socialMentions.set(entity, trimmed.slice(-200)); // cap to 200 entries
          break; // only count first matching entity per post
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    blueskyWs = null;
    console.log('[Relay] Bluesky Jetstream disconnected, retry in 20s');
    setTimeout(connectBlueskeyFirehose, 20000);
  });
  ws.on('error', () => {
    blueskyWs = null;
    setTimeout(connectBlueskeyFirehose, 30000);
  });
}

// Start Bluesky firehose consumer (non-blocking)
setTimeout(connectBlueskeyFirehose, 8000);

async function handleSocialTrendsRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const platform = url.searchParams.get('platform') || '';

  const now = Date.now();
  const cutoff = now - SOCIAL_WINDOW_MS;

  const trends = [];
  for (const [entity, mentions] of socialMentions.entries()) {
    const recent = mentions.filter((m) => m.ts > cutoff);
    if (recent.length === 0) continue;
    const velocity = recent.length / (SOCIAL_WINDOW_MS / 60000); // mentions/min
    trends.push({
      topic: entity,
      platform: 'bluesky',
      mentionCount1h: recent.length * 12, // extrapolate 5-min to 1-hr
      velocity: Math.round(velocity * 100) / 100,
      topPosts: recent.slice(-3).map((m) => m.snippet),
      matchedEntities: [entity],
      observedAt: now,
    });
  }

  // Sort by velocity descending
  trends.sort((a, b) => b.velocity - a.velocity);

  let results = trends.slice(0, limit);
  if (platform && platform !== 'bluesky') results = [];

  const data = JSON.stringify({ trends: results, sampledAt: now });
  sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, data);
}

// ---------------------------------------------------------------------------
// BGP Events: Cache-proxied BGPStream CAIDA API
// ---------------------------------------------------------------------------
let bgpCache = null;
let bgpCacheAt = 0;
const BGP_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

async function handleBgpEventsRequest(req, res) {
  const now = Date.now();
  if (bgpCache && now - bgpCacheAt < BGP_CACHE_TTL_MS) {
    sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=180' }, bgpCache);
    return;
  }
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      const r = https.get(
        'https://bgpstream.caida.org/api/v2/events?type=hijack,leak&limit=50',
        { timeout: 10000 },
        (response) => {
          let body = '';
          response.on('data', (c) => body += c);
          response.on('end', () => resolve(body));
        }
      );
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('BGP timeout')); });
    });
    bgpCache = data;
    bgpCacheAt = now;
    sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=180' }, data);
  } catch (err) {
    const empty = JSON.stringify({ data: { events: [] } });
    sendCompressed(req, res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, empty);
  }
}

function connectUpstream() {
  // Skip if already connected or connecting
  if (upstreamSocket?.readyState === WebSocket.OPEN ||
      upstreamSocket?.readyState === WebSocket.CONNECTING) return;

  console.log('[Relay] Connecting to aisstream.io...');
  const socket = new WebSocket(AISSTREAM_URL);
  upstreamSocket = socket;

  socket.on('open', () => {
    // Verify this socket is still the current one (race condition guard)
    if (upstreamSocket !== socket) {
      console.log('[Relay] Stale socket open event, closing');
      socket.close();
      return;
    }
    console.log('[Relay] Connected to aisstream.io');
    socket.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    }));
  });

  socket.on('message', (data) => {
    if (upstreamSocket !== socket) return;
    messageCount++;
    if (messageCount % 1000 === 0) {
      console.log(`[Relay] ${messageCount} messages, ${clients.size} clients, cache: opensky=${openskyResponseCache.size} rss=${rssResponseCache.size}`);
    }
    const message = data.toString();
    try {
      const parsed = JSON.parse(message);
      if (parsed?.MessageType === 'PositionReport') {
        processPositionReportForSnapshot(parsed);
      }
    } catch {
      // Ignore malformed upstream payloads
    }

    // Throttled fanout: only forward every 10th message to WS clients
    // The app uses HTTP snapshot polling, not WS — this is mostly for external consumers
    if (clients.size > 0 && messageCount % 10 === 0) {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    }
  });

  socket.on('close', () => {
    if (upstreamSocket === socket) {
      upstreamSocket = null;
      console.log('[Relay] Disconnected, reconnecting in 5s...');
      setTimeout(connectUpstream, 5000);
    }
  });

  socket.on('error', (err) => {
    console.error('[Relay] Upstream error:', err.message);
  });
}

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`[Relay] WebSocket relay on port ${PORT}`);
});

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_WS_CLIENTS) {
    console.log(`[Relay] WS client rejected (max ${MAX_WS_CLIENTS})`);
    ws.close(1013, 'Max clients reached');
    return;
  }
  console.log(`[Relay] Client connected (${clients.size + 1}/${MAX_WS_CLIENTS})`);
  clients.add(ws);
  connectUpstream();

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Relay] Client error:', err.message);
  });
});
