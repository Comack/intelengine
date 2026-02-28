/**
 * Embedded AIS relay for the desktop sidecar.
 * Connects directly to aisstream.io using the user's own API key
 * (no Railway relay required — bypasses blocked Vercel IPs).
 *
 * Port of scripts/ais-relay.cjs adapted as an ESM factory.
 * Usage: const relay = createAisRelay({ logger }); relay.start();
 */

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';

const GRID_SIZE = 2;
const DENSITY_WINDOW = 30 * 60 * 1000;
const GAP_THRESHOLD = 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 5000;
const CANDIDATE_RETENTION_MS = 2 * 60 * 60 * 1000;
const MAX_DENSITY_ZONES = 200;
const MAX_CANDIDATE_REPORTS = 1500;

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
  return `${Math.floor(lat / GRID_SIZE) * GRID_SIZE},${Math.floor(lon / GRID_SIZE) * GRID_SIZE}`;
}

function isLikelyMilitaryCandidate(meta) {
  const mmsi = String(meta?.MMSI || '');
  const shipType = Number(meta?.ShipType);
  const name = (meta?.ShipName || '').trim().toUpperCase();
  if (Number.isFinite(shipType) && (shipType === 35 || shipType === 55 || (shipType >= 50 && shipType <= 59))) return true;
  if (name && NAVAL_PREFIX_RE.test(name)) return true;
  if (mmsi.length >= 9) {
    const suffix = mmsi.substring(3);
    if (suffix.startsWith('00') || suffix.startsWith('99')) return true;
  }
  return false;
}

export function createAisRelay({ logger = console } = {}) {
  const vessels = new Map();
  const vesselHistory = new Map();
  const densityGrid = new Map();
  const candidateReports = new Map();

  let upstreamSocket = null;
  let messageCount = 0;
  let snapshotSequence = 0;
  let lastSnapshot = null;
  let lastSnapshotAt = 0;
  let reconnectTimer = null;
  let reconnectDelay = 2000;
  let stopped = false;
  let snapshotTimer = null;

  function processPositionReport(data) {
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
      mmsi, name: meta.ShipName || '', lat, lon, timestamp: now,
      shipType: meta.ShipType, heading: pos.TrueHeading, speed: pos.Sog, course: pos.Cog,
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
        vessels: new Set(), lastUpdate: now, previousCount: 0,
      };
      densityGrid.set(gridKey, cell);
    }
    cell.vessels.add(mmsi);
    cell.lastUpdate = now;

    if (isLikelyMilitaryCandidate(meta)) {
      candidateReports.set(mmsi, {
        mmsi, name: meta.ShipName || '', lat, lon,
        shipType: meta.ShipType, heading: pos.TrueHeading, speed: pos.Sog, course: pos.Cog,
        timestamp: now,
      });
    }
  }

  function cleanupAggregates() {
    const now = Date.now();
    const cutoff = now - DENSITY_WINDOW;
    for (const [mmsi, vessel] of vessels) { if (vessel.timestamp < cutoff) vessels.delete(mmsi); }
    for (const [mmsi, history] of vesselHistory) {
      const filtered = history.filter((ts) => ts >= cutoff);
      if (filtered.length === 0) vesselHistory.delete(mmsi); else vesselHistory.set(mmsi, filtered);
    }
    for (const [key, cell] of densityGrid) {
      cell.previousCount = cell.vessels.size;
      for (const mmsi of cell.vessels) {
        const vessel = vessels.get(mmsi);
        if (!vessel || vessel.timestamp < cutoff) cell.vessels.delete(mmsi);
      }
      if (cell.vessels.size === 0 && now - cell.lastUpdate > DENSITY_WINDOW * 2) densityGrid.delete(key);
    }
    for (const [mmsi, report] of candidateReports) {
      if (report.timestamp < now - CANDIDATE_RETENTION_MS) candidateReports.delete(mmsi);
    }
  }

  function detectDisruptions() {
    const disruptions = [];
    const now = Date.now();
    for (const chokepoint of CHOKEPOINTS) {
      let vesselCount = 0;
      for (const vessel of vessels.values()) {
        const dist = Math.sqrt(Math.pow(vessel.lat - chokepoint.lat, 2) + Math.pow(vessel.lon - chokepoint.lon, 2));
        if (dist <= chokepoint.radius) vesselCount++;
      }
      if (vesselCount >= 5) {
        const normalTraffic = chokepoint.radius * 10;
        const severity = vesselCount > normalTraffic * 1.5 ? 'high' : vesselCount > normalTraffic ? 'elevated' : 'low';
        disruptions.push({
          id: `chokepoint-${chokepoint.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: chokepoint.name, type: 'chokepoint_congestion',
          lat: chokepoint.lat, lon: chokepoint.lon, severity,
          changePct: normalTraffic > 0 ? Math.round((vesselCount / normalTraffic - 1) * 100) : 0,
          windowHours: 1, vesselCount, region: chokepoint.name,
          description: `${vesselCount} vessels in ${chokepoint.name}`,
        });
      }
    }
    let darkShipCount = 0;
    for (const history of vesselHistory.values()) {
      if (history.length >= 2) {
        const lastSeen = history[history.length - 1];
        const secondLast = history[history.length - 2];
        if (lastSeen - secondLast > GAP_THRESHOLD && now - lastSeen < 10 * 60 * 1000) darkShipCount++;
      }
    }
    if (darkShipCount >= 1) {
      disruptions.push({
        id: 'global-gap-spike', name: 'AIS Gap Spike Detected', type: 'gap_spike',
        lat: 0, lon: 0,
        severity: darkShipCount > 20 ? 'high' : darkShipCount > 10 ? 'elevated' : 'low',
        changePct: darkShipCount * 10, windowHours: 1, darkShips: darkShipCount,
        description: `${darkShipCount} vessels returned after extended AIS silence`,
      });
    }
    return disruptions;
  }

  function calculateDensityZones() {
    const allCells = Array.from(densityGrid.values()).filter((c) => c.vessels.size >= 2);
    if (allCells.length === 0) return [];
    const vesselCounts = allCells.map((c) => c.vessels.size);
    const maxVessels = Math.max(...vesselCounts);
    const minVessels = Math.min(...vesselCounts);
    const zones = [];
    for (const [key, cell] of densityGrid) {
      if (cell.vessels.size < 2) continue;
      const logMax = Math.log(maxVessels + 1);
      const logMin = Math.log(minVessels + 1);
      const logCurrent = Math.log(cell.vessels.size + 1);
      const intensity = logMax > logMin ? 0.2 + (0.8 * (logCurrent - logMin) / (logMax - logMin)) : 0.5;
      const deltaPct = cell.previousCount > 0
        ? Math.round(((cell.vessels.size - cell.previousCount) / cell.previousCount) * 100) : 0;
      zones.push({
        id: `density-${key}`, name: `Zone ${key}`,
        lat: cell.lat, lon: cell.lon, intensity, deltaPct,
        shipsPerDay: cell.vessels.size * 48,
        note: cell.vessels.size >= 10 ? 'High traffic area' : undefined,
      });
    }
    return zones.sort((a, b) => b.intensity - a.intensity).slice(0, MAX_DENSITY_ZONES);
  }

  function buildSnapshot() {
    const now = Date.now();
    if (lastSnapshot && now - lastSnapshotAt < Math.floor(SNAPSHOT_INTERVAL_MS / 2)) return lastSnapshot;
    cleanupAggregates();
    snapshotSequence++;
    lastSnapshot = {
      sequence: snapshotSequence,
      timestamp: new Date(now).toISOString(),
      status: {
        connected: upstreamSocket !== null && upstreamSocket.readyState === 1,
        vessels: vessels.size,
        messages: messageCount,
      },
      disruptions: detectDisruptions(),
      density: calculateDensityZones(),
    };
    lastSnapshotAt = now;
    return lastSnapshot;
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      connect();
    }, reconnectDelay);
  }

  async function connect() {
    if (stopped) return;
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      logger.warn('[ais-relay] AISSTREAM_API_KEY not set — relay inactive');
      return;
    }

    let WebSocketImpl;
    try {
      const wsModule = await import('ws').catch(() => null);
      if (!wsModule) {
        logger.warn('[ais-relay] ws package not available — AIS relay inactive');
        return;
      }
      WebSocketImpl = wsModule.WebSocket || wsModule.default?.WebSocket || wsModule.default;
    } catch {
      logger.warn('[ais-relay] ws package not available — AIS relay inactive');
      return;
    }

    try {
      upstreamSocket = new WebSocketImpl(AISSTREAM_URL);
    } catch (err) {
      logger.error('[ais-relay] WebSocket constructor failed', err.message);
      scheduleReconnect();
      return;
    }

    upstreamSocket.on('open', () => {
      reconnectDelay = 2000;
      logger.log('[ais-relay] connected to aisstream.io');
      upstreamSocket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    });

    upstreamSocket.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        messageCount++;
        if (data?.Message?.PositionReport) processPositionReport(data);
      } catch { /* ignore parse errors */ }
    });

    upstreamSocket.on('error', (err) => {
      logger.warn('[ais-relay] WebSocket error', err.message);
    });

    upstreamSocket.on('close', () => {
      logger.warn('[ais-relay] WebSocket closed');
      upstreamSocket = null;
      if (!stopped) scheduleReconnect();
    });
  }

  return {
    start() {
      stopped = false;
      void connect();
      snapshotTimer = setInterval(() => {
        if (vessels.size > 0) buildSnapshot();
      }, SNAPSHOT_INTERVAL_MS);
    },

    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(snapshotTimer);
      if (upstreamSocket) {
        try { upstreamSocket.close(); } catch { /* ignore */ }
        upstreamSocket = null;
      }
    },

    isConnected() {
      return upstreamSocket !== null && upstreamSocket.readyState === 1;
    },

    buildSnapshot,
    getCandidateReports() {
      return Array.from(candidateReports.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_CANDIDATE_REPORTS);
    },
  };
}
