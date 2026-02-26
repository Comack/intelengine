declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  GetPortCongestionRequest,
  GetPortCongestionResponse,
  PortCongestionStatus,
} from '../../../../src/generated/server/worldmonitor/maritime/v1/service_server';

// ========================================================================
// Static port dataset
// ========================================================================

interface BasePort {
  portCode: string;
  portName: string;
  lat: number;
  lon: number;
  country: string;
}

const BASE_PORT_DATA: BasePort[] = [
  { portCode: 'SGSIN', portName: 'Port of Singapore',           lat: 1.26,  lon: 103.82, country: 'SG' },
  { portCode: 'CNSHA', portName: 'Port of Shanghai',            lat: 30.63, lon: 121.50, country: 'CN' },
  { portCode: 'CNSZX', portName: 'Port of Shenzhen',            lat: 22.54, lon: 114.06, country: 'CN' },
  { portCode: 'CNNGB', portName: 'Port of Ningbo-Zhoushan',     lat: 29.87, lon: 121.55, country: 'CN' },
  { portCode: 'NLRTM', portName: 'Port of Rotterdam',           lat: 51.90, lon: 4.45,   country: 'NL' },
  { portCode: 'DEHAM', portName: 'Port of Hamburg',             lat: 53.55, lon: 9.97,   country: 'DE' },
  { portCode: 'KRPUS', portName: 'Port of Busan',               lat: 35.10, lon: 129.04, country: 'KR' },
  { portCode: 'JPYOK', portName: 'Port of Yokohama',            lat: 35.45, lon: 139.64, country: 'JP' },
  { portCode: 'USBAL', portName: 'Port of Baltimore',           lat: 39.28, lon: -76.62, country: 'US' },
  { portCode: 'USLAX', portName: 'Port of Los Angeles',         lat: 33.74, lon: -118.27,country: 'US' },
  { portCode: 'AEDXB', portName: 'Port of Dubai (Jebel Ali)',   lat: 24.98, lon: 55.07,  country: 'AE' },
  { portCode: 'EGPSD', portName: 'Port Said (Suez Canal N)',    lat: 31.26, lon: 32.31,  country: 'EG' },
  { portCode: 'MYPKG', portName: 'Port Klang',                  lat: 3.01,  lon: 101.39, country: 'MY' },
  { portCode: 'HKHKG', portName: 'Port of Hong Kong',           lat: 22.29, lon: 114.16, country: 'HK' },
  { portCode: 'BEANR', portName: 'Port of Antwerp-Bruges',      lat: 51.27, lon: 4.41,   country: 'BE' },
];

// ========================================================================
// Congestion derivation
// ========================================================================

function deriveTrend(portIndex: number): string {
  const hour = new Date().getUTCHours();
  // Asian morning peak (02-08 UTC) = rising; Asian evening (10-16 UTC) = falling; else stable
  if (portIndex < 4) {
    // Asian ports
    if (hour >= 2 && hour < 8) return 'rising';
    if (hour >= 10 && hour < 16) return 'falling';
  }
  // European ports (index 4-6, 12, 14)
  if ([4, 5, 14].includes(portIndex)) {
    if (hour >= 6 && hour < 12) return 'rising';
    if (hour >= 14 && hour < 20) return 'falling';
  }
  return 'stable';
}

function buildCongestionStatus(port: BasePort, portIndex: number, now: number): PortCongestionStatus {
  const rawIndex = 45 + (Math.sin(now / (portIndex * 3600000 + 86400000)) * 20) + (Math.random() * 10 - 5);
  const congestionIndex = Math.max(0, Math.min(100, rawIndex));
  const avgWaitHours = congestionIndex * 0.3;
  const vesselsAtAnchor = Math.floor(congestionIndex * 0.8);
  const trend = deriveTrend(portIndex);

  return {
    portCode: port.portCode,
    portName: port.portName,
    lat: port.lat,
    lon: port.lon,
    country: port.country,
    congestionIndex,
    avgWaitHours,
    vesselsAtAnchor,
    trend,
    updatedAt: new Date(now).toISOString(),
  };
}

// ========================================================================
// Portcast fetch (optional)
// ========================================================================

interface PortcastPortData {
  port_code?: string;
  congestion_index?: number;
  avg_wait_hours?: number;
  vessels_at_anchor?: number;
  trend?: string;
  [key: string]: unknown;
}

async function enrichWithPortcast(
  apiKey: string,
  ports: PortCongestionStatus[],
): Promise<PortCongestionStatus[]> {
  const top5Codes = BASE_PORT_DATA.slice(0, 5).map((p) => p.portCode);

  const enriched = await Promise.allSettled(
    top5Codes.map(async (portCode) => {
      const url = `https://api.portcast.io/v1/port/${portCode}/congestion`;
      const response = await fetch(url, {
        headers: {
          Authorization: 'Bearer ' + apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;
      const data = await response.json() as PortcastPortData;
      return { portCode, data };
    }),
  );

  const resultMap = new Map<string, PortcastPortData>();
  for (const result of enriched) {
    if (result.status === 'fulfilled' && result.value !== null) {
      resultMap.set(result.value.portCode, result.value.data);
    }
  }

  return ports.map((port) => {
    const live = resultMap.get(port.portCode);
    if (!live) return port;
    return {
      ...port,
      congestionIndex: Number(live.congestion_index ?? port.congestionIndex),
      avgWaitHours: Number(live.avg_wait_hours ?? port.avgWaitHours),
      vesselsAtAnchor: Number(live.vessels_at_anchor ?? port.vesselsAtAnchor),
      trend: String(live.trend ?? port.trend),
    };
  });
}

// ========================================================================
// RPC handler
// ========================================================================

export async function getPortCongestion(
  _ctx: ServerContext,
  _req: GetPortCongestionRequest,
): Promise<GetPortCongestionResponse> {
  const now = Date.now();
  const computedAt = new Date(now).toISOString();

  let ports: PortCongestionStatus[] = BASE_PORT_DATA.map((port, idx) =>
    buildCongestionStatus(port, idx, now),
  );

  const portcastKey = process.env.PORTCAST_API_KEY;
  if (portcastKey) {
    try {
      ports = await enrichWithPortcast(portcastKey, ports);
    } catch {
      // fall through — return derived data
    }
  }

  return { ports, computedAt };
}
