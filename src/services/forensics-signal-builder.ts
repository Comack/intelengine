import type { ForensicsAnomalyOverlay, AisDisruptionEvent } from '@/types';
import type { ForensicsSignalInput, ForensicsCalibratedAnomaly } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import type { MarketData } from '@/types';
import type { PredictionMarket } from '@/services/prediction';
import type { FredSeries, OilAnalytics } from '@/services/economic';
import type { MacroSignalData, ETFFlowsResult, StablecoinResult } from '@/components';
import { SITE_VARIANT } from '@/config';
import { FINANCIAL_CENTERS, COMMODITY_HUBS, STOCK_EXCHANGES } from '@/config/finance-geo';
import { signalAggregator } from '@/services/signal-aggregator';
import { TIER1_COUNTRIES, getCountryData } from '@/services/country-instability';
import {
  FAST_FRESHNESS_PROFILE,
  SLOW_FRESHNESS_PROFILE,
  CONFLICT_FRESHNESS_PROFILE,
  computeFreshnessPenalty,
  computeSignalConfidence,
  logScale1p,
  parseTimestampMs,
  clampNumber as clampSignalNumber,
} from '@/services/forensics-signal-features';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ForensicsSignalContext {
  aisDisruptions: AisDisruptionEvent[];
  predictions: PredictionMarket[];
  markets: MarketData[];
  macroSignals: MacroSignalData | null;
  etfFlows: ETFFlowsResult | null;
  stablecoins: StablecoinResult | null;
  fredSeries: FredSeries[];
  oilAnalytics: OilAnalytics | null;
  conflictFetchedAt: number;
  ucdpFetchedAt: number;
  hapiFetchedAt: number;
  displacementFetchedAt: number;
  climateFetchedAt: number;
  macroFetchedAt: number;
  etfFetchedAt: number;
  stablecoinFetchedAt: number;
  fredFetchedAt: number;
  oilFetchedAt: number;
}

// ---------------------------------------------------------------------------
// Static coordinate maps used by resolveForensicsCoordinate
// ---------------------------------------------------------------------------

const FORENSICS_GLOBAL_HUBS: Array<{ lat: number; lon: number }> = [
  { lat: 40.7128, lon: -74.0060 }, // New York
  { lat: 51.5074, lon: -0.1278 },  // London
  { lat: 35.6762, lon: 139.6503 }, // Tokyo
  { lat: 1.3521, lon: 103.8198 },  // Singapore
  { lat: 25.2048, lon: 55.2708 },  // Dubai
];

const FORENSICS_MARKET_HUBS: Array<{ lat: number; lon: number }> = FINANCIAL_CENTERS
  .slice(0, 12)
  .map((center) => ({ lat: center.lat, lon: center.lon }));

const FORENSICS_MARITIME_HUBS: Array<{ lat: number; lon: number }> = COMMODITY_HUBS
  .filter((hub) => hub.type === 'port' || hub.type === 'exchange')
  .slice(0, 12)
  .map((hub) => ({ lat: hub.lat, lon: hub.lon }));

const FORENSICS_MONITOR_STREAM_LABELS: Record<ForensicsAnomalyOverlay['monitorCategory'], string> = {
  market: 'Market Shock',
  maritime: 'Maritime Disruption',
  cyber: 'Cyber Spike',
  security: 'Security Escalation',
  infrastructure: 'Infrastructure Stress',
  other: 'Cross-Signal',
};

// Shared country bounds used by resolveForensicsCoordinate.
// These mirror App.COUNTRY_BOUNDS so the builder can resolve coordinates
// without depending on the App class at runtime.
const COUNTRY_BOUNDS: Record<string, { n: number; s: number; e: number; w: number }> = {
  IR: { n: 40, s: 25, e: 63, w: 44 }, IL: { n: 33.3, s: 29.5, e: 35.9, w: 34.3 },
  SA: { n: 32, s: 16, e: 55, w: 35 }, AE: { n: 26.1, s: 22.6, e: 56.4, w: 51.6 },
  IQ: { n: 37.4, s: 29.1, e: 48.6, w: 38.8 }, SY: { n: 37.3, s: 32.3, e: 42.4, w: 35.7 },
  YE: { n: 19, s: 12, e: 54.5, w: 42 }, LB: { n: 34.7, s: 33.1, e: 36.6, w: 35.1 },
  CN: { n: 53.6, s: 18.2, e: 134.8, w: 73.5 }, TW: { n: 25.3, s: 21.9, e: 122, w: 120 },
  JP: { n: 45.5, s: 24.2, e: 153.9, w: 122.9 }, KR: { n: 38.6, s: 33.1, e: 131.9, w: 124.6 },
  KP: { n: 43.0, s: 37.7, e: 130.7, w: 124.2 }, IN: { n: 35.5, s: 6.7, e: 97.4, w: 68.2 },
  PK: { n: 37, s: 24, e: 77, w: 61 }, AF: { n: 38.5, s: 29.4, e: 74.9, w: 60.5 },
  UA: { n: 52.4, s: 44.4, e: 40.2, w: 22.1 }, RU: { n: 82, s: 41.2, e: 180, w: 19.6 },
  BY: { n: 56.2, s: 51.3, e: 32.8, w: 23.2 }, PL: { n: 54.8, s: 49, e: 24.1, w: 14.1 },
  EG: { n: 31.7, s: 22, e: 36.9, w: 25 }, LY: { n: 33, s: 19.5, e: 25, w: 9.4 },
  SD: { n: 22, s: 8.7, e: 38.6, w: 21.8 }, US: { n: 49, s: 24.5, e: -66.9, w: -125 },
  GB: { n: 58.7, s: 49.9, e: 1.8, w: -8.2 }, DE: { n: 55.1, s: 47.3, e: 15.0, w: 5.9 },
  FR: { n: 51.1, s: 41.3, e: 9.6, w: -5.1 }, TR: { n: 42.1, s: 36, e: 44.8, w: 26 },
  BR: { n: 5.3, s: -33.8, e: -34.8, w: -73.9 },
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  IL: ['israel', 'israeli', 'gaza', 'hamas', 'hezbollah', 'netanyahu', 'idf', 'west bank', 'tel aviv', 'jerusalem'],
  IR: ['iran', 'iranian', 'tehran', 'persian', 'irgc', 'khamenei'],
  RU: ['russia', 'russian', 'moscow', 'kremlin', 'putin', 'ukraine war'],
  UA: ['ukraine', 'ukrainian', 'kyiv', 'zelensky', 'zelenskyy'],
  CN: ['china', 'chinese', 'beijing', 'taiwan strait', 'south china sea', 'xi jinping'],
  TW: ['taiwan', 'taiwanese', 'taipei'],
  KP: ['north korea', 'pyongyang', 'kim jong'],
  KR: ['south korea', 'seoul'],
  SA: ['saudi', 'riyadh', 'mbs'],
  SY: ['syria', 'syrian', 'damascus', 'assad'],
  YE: ['yemen', 'houthi', 'sanaa'],
  IQ: ['iraq', 'iraqi', 'baghdad'],
  AF: ['afghanistan', 'afghan', 'kabul', 'taliban'],
  PK: ['pakistan', 'pakistani', 'islamabad'],
  IN: ['india', 'indian', 'new delhi', 'modi'],
  EG: ['egypt', 'egyptian', 'cairo', 'suez'],
  LB: ['lebanon', 'lebanese', 'beirut'],
  TR: ['turkey', 'turkish', 'ankara', 'erdogan', 'türkiye'],
  US: ['united states', 'american', 'washington', 'pentagon', 'white house'],
  GB: ['united kingdom', 'british', 'london', 'uk '],
  BR: ['brazil', 'brazilian', 'brasilia', 'lula', 'bolsonaro'],
  AE: ['united arab emirates', 'uae', 'emirati', 'dubai', 'abu dhabi'],
};

// ---------------------------------------------------------------------------
// Local helpers (replicate App.ts private helpers that stay in App.ts)
// ---------------------------------------------------------------------------

function resolveObservedAt(rawValue: unknown, fallbackMs: number): number {
  return parseTimestampMs(rawValue) ?? fallbackMs;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Standalone exported helpers (called from buildForensicsMonitorStreams,
// buildAisTrajectoryStreams, and buildForensicsMapAnomalies which stay in App.ts)
// ---------------------------------------------------------------------------

export function normalizeForensicsSeverity(
  severity: ForensicsCalibratedAnomaly['severity'],
): ForensicsAnomalyOverlay['severity'] {
  if (severity === 'SEVERITY_LEVEL_HIGH') return 'high';
  if (severity === 'SEVERITY_LEVEL_MEDIUM') return 'medium';
  if (severity === 'SEVERITY_LEVEL_LOW') return 'low';
  return 'unspecified';
}

export function classifyForensicsMonitor(anomaly: ForensicsCalibratedAnomaly): {
  category: ForensicsAnomalyOverlay['monitorCategory'];
  label: string;
} {
  const signal = anomaly.signalType.toLowerCase();
  const source = anomaly.sourceId.toLowerCase();
  const domain = anomaly.domain.toLowerCase();

  if (signal.startsWith('topology_')) {
    return { category: 'market', label: 'Financial topology instability' };
  }
  if (
    signal.includes('market')
    || signal.includes('prediction')
    || source.startsWith('market:')
    || source.startsWith('prediction:')
    || domain === 'market'
    || domain === 'prediction'
  ) {
    if (signal.includes('volatility')) {
      return { category: 'market', label: 'Market volatility spike' };
    }
    if (signal.includes('conviction')) {
      return { category: 'market', label: 'Prediction conviction anomaly' };
    }
    return { category: 'market', label: 'Unusual market movement' };
  }
  if (
    signal.includes('ais')
    || signal.includes('maritime')
    || signal.includes('vessel')
    || signal.includes('shipping')
    || source.includes('ais')
    || domain === 'maritime'
  ) {
    if (signal.includes('ais_silence')) {
      return { category: 'maritime', label: 'AIS silence spike' };
    }
    if (signal.includes('ais_loitering')) {
      return { category: 'maritime', label: 'Vessel loitering anomaly' };
    }
    if (signal.includes('ais_route_deviation')) {
      return { category: 'maritime', label: 'Route deviation anomaly' };
    }
    return { category: 'maritime', label: 'Unusual maritime activity' };
  }
  if (signal.includes('cyber') || domain === 'cyber') {
    return { category: 'cyber', label: 'Cyber activity anomaly' };
  }
  if (
    signal.includes('protest')
    || signal.includes('conflict')
    || signal.includes('military')
    || domain === 'conflict'
    || domain === 'military'
  ) {
    return { category: 'security', label: 'Security activity anomaly' };
  }
  if (
    signal.includes('outage')
    || signal.includes('infrastructure')
    || signal.includes('cable')
    || domain === 'infrastructure'
  ) {
    return { category: 'infrastructure', label: 'Infrastructure stress anomaly' };
  }
  return { category: 'other', label: 'Cross-signal anomaly' };
}

export function computeForensicsMonitorPriority(
  anomaly: ForensicsCalibratedAnomaly,
  supportCount: number,
  isNearLive: boolean,
): number {
  const zScoreWeight = Math.min(1, Math.abs(anomaly.legacyZScore || 0) / 8);
  const pValueWeight = 1 - clampSignalNumber(anomaly.pValue || 0, 0, 1);
  const supportWeight = Math.min(1, Math.max(1, supportCount) / 4);
  const freshnessWeight = isNearLive ? 1 : 0;
  const priority = (zScoreWeight * 0.38) + (pValueWeight * 0.37) + (supportWeight * 0.15) + (freshnessWeight * 0.10);
  return Math.round(clampSignalNumber(priority, 0, 1) * 1000) / 1000;
}

export function resolveForensicsAnomalyFreshness(
  anomaly: ForensicsCalibratedAnomaly,
  runCompletedAt: number,
): { ageMinutes: number; isNearLive: boolean } {
  const now = Date.now();
  const observedAt = Number.isFinite(anomaly.observedAt) && anomaly.observedAt > 0
    ? anomaly.observedAt
    : 0;
  const fallbackCompletedAt = Number.isFinite(runCompletedAt) && runCompletedAt > 0
    ? runCompletedAt
    : now;
  const referenceTimestamp = observedAt > 0 ? observedAt : fallbackCompletedAt;
  const ageMinutes = Math.max(0, Math.round((now - referenceTimestamp) / 60000));
  return {
    ageMinutes,
    isNearLive: ageMinutes <= 45,
  };
}

export function resolveMarketSourceCoordinate(sourceId: string): { lat: number; lon: number } | null {
  const sourceUpper = sourceId.toUpperCase();
  const symbol = sourceUpper.includes(':')
    ? sourceUpper.slice(sourceUpper.indexOf(':') + 1)
    : sourceUpper;

  const exchangeIdHints: string[] = [];
  if (/\.HK$/.test(symbol)) exchangeIdHints.push('hkex');
  if (/\.SS$/.test(symbol)) exchangeIdHints.push('sse');
  if (/\.SZ$/.test(symbol)) exchangeIdHints.push('szse');
  if (/\.KS$/.test(symbol)) exchangeIdHints.push('krx');
  if (/\.TO$/.test(symbol)) exchangeIdHints.push('tsx');
  if (/\.AX$/.test(symbol)) exchangeIdHints.push('asx');
  if (/\.L$/.test(symbol)) exchangeIdHints.push('lse');
  if (/\.T$/.test(symbol)) exchangeIdHints.push('jpx');
  if (/\.NS$/.test(symbol)) exchangeIdHints.push('nse-india');
  if (/\.BO$/.test(symbol)) exchangeIdHints.push('bse-india');
  if (/\.TW$/.test(symbol)) exchangeIdHints.push('twse');
  if (/^(BTC|ETH|SOL|XRP|BNB)/.test(symbol)) exchangeIdHints.push('nasdaq');
  if (/^(\^GSPC|\^DJI|\^IXIC|SPY|QQQ|DIA|IWM|AAPL|MSFT|NVDA|AMZN|META|GOOGL|GOOG|TSLA)/.test(symbol)) {
    exchangeIdHints.push('nasdaq', 'nyse');
  }

  for (const exchangeId of exchangeIdHints) {
    const exchange = STOCK_EXCHANGES.find((candidate) => candidate.id === exchangeId);
    if (exchange) return { lat: exchange.lat, lon: exchange.lon };
  }
  return null;
}

export function resolveForensicsCoordinate(
  region: string,
  sourceId: string,
  domain: string,
  category: ForensicsAnomalyOverlay['monitorCategory'],
): { lat: number; lon: number } | null {
  const sourceCoordinateMatch = sourceId.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (sourceCoordinateMatch?.[1] && sourceCoordinateMatch?.[2]) {
    const lat = Number(sourceCoordinateMatch[1]);
    const lon = Number(sourceCoordinateMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  if (category === 'market') {
    const marketCoordinate = resolveMarketSourceCoordinate(sourceId);
    if (marketCoordinate) return marketCoordinate;
  }

  const trimmed = region.trim();
  const normalized = trimmed.toLowerCase();

  const latLonMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (latLonMatch?.[1] && latLonMatch?.[2]) {
    const lat = Number(latLonMatch[1]);
    const lon = Number(latLonMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  const directCode = trimmed.toUpperCase();
  const directBounds = COUNTRY_BOUNDS[directCode];
  if (directBounds) {
    return {
      lat: (directBounds.n + directBounds.s) / 2,
      lon: (directBounds.e + directBounds.w) / 2,
    };
  }

  for (const [code, name] of Object.entries(TIER1_COUNTRIES)) {
    if (name.toLowerCase() === normalized) {
      const bounds = COUNTRY_BOUNDS[code];
      if (bounds) {
        return {
          lat: (bounds.n + bounds.s) / 2,
          lon: (bounds.e + bounds.w) / 2,
        };
      }
    }
  }

  for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
      const bounds = COUNTRY_BOUNDS[code];
      if (bounds) {
        return {
          lat: (bounds.n + bounds.s) / 2,
          lon: (bounds.e + bounds.w) / 2,
        };
      }
    }
  }

  const regionCenters: Record<string, { lat: number; lon: number }> = {
    'middle east': { lat: 29, lon: 45 },
    'east asia': { lat: 33, lon: 121 },
    'south asia': { lat: 22, lon: 78 },
    'eastern europe': { lat: 50, lon: 30 },
    'north africa': { lat: 27, lon: 17 },
    'sahel region': { lat: 15, lon: 2 },
  };
  const namedCenter = regionCenters[normalized];
  if (namedCenter) return namedCenter;

  if (!normalized || normalized === 'global' || normalized === 'world' || normalized === 'all') {
    const hubs = category === 'market'
      ? (FORENSICS_MARKET_HUBS.length > 0 ? FORENSICS_MARKET_HUBS : FORENSICS_GLOBAL_HUBS)
      : category === 'maritime'
      ? (FORENSICS_MARITIME_HUBS.length > 0 ? FORENSICS_MARITIME_HUBS : FORENSICS_GLOBAL_HUBS)
      : FORENSICS_GLOBAL_HUBS;
    const hash = hashString(`${sourceId}:${domain}`);
    return hubs[hash % hubs.length] || null;
  }

  return null;
}

export { FORENSICS_MONITOR_STREAM_LABELS };

// ---------------------------------------------------------------------------
// ForensicsSignalBuilder class
// ---------------------------------------------------------------------------

export class ForensicsSignalBuilder {
  constructor(private ctx: ForensicsSignalContext) {}

  private confidenceWithFreshness(base: number, magnitudeBonus: number, freshnessPenalty: number): number {
    return Math.round(computeSignalConfidence(base, magnitudeBonus, freshnessPenalty) * 1000) / 1000;
  }

  private classifyAisTrajectorySignal(
    event: AisDisruptionEvent,
  ): 'ais_route_deviation' | 'ais_loitering' | 'ais_silence' {
    const text = `${event.name} ${event.description || ''} ${event.region || ''}`.toLowerCase();
    const darkShips = Math.max(0, event.darkShips || 0);
    const vesselCount = Math.max(0, event.vesselCount || 0);
    const changeMagnitude = Math.abs(event.changePct || 0);
    const windowHours = Math.max(1, event.windowHours || 1);

    const silenceMatches = /dark|silence|gap|transponder|offline|blackout|signal loss|ais off/.test(text) ? 1 : 0;
    const loiterMatches = /loiter|holding|queue|anchorage|waiting|dwell|congestion|bottleneck/.test(text) ? 1 : 0;
    const routeMatches = /rerout|divert|deviat|off route|course shift|detour|alternate route/.test(text) ? 1 : 0;

    const silenceScore = (event.type === 'gap_spike' ? 2 : 0)
      + (darkShips > 0 ? 2 : 0)
      + silenceMatches
      + (changeMagnitude >= 20 ? 1 : 0);
    const loiterScore = (event.type === 'chokepoint_congestion' ? 2 : 0)
      + loiterMatches
      + (vesselCount >= 30 ? 1 : 0)
      + (windowHours >= 4 ? 1 : 0);
    const routeScore = routeMatches
      + (changeMagnitude >= 25 ? 1 : 0)
      + (event.type === 'chokepoint_congestion' && changeMagnitude >= 35 ? 1 : 0);

    if (silenceScore >= loiterScore && silenceScore >= routeScore) return 'ais_silence';
    if (routeScore > loiterScore) return 'ais_route_deviation';
    return 'ais_loitering';
  }

  buildAisTrajectorySignals(now = Date.now()): ForensicsSignalInput[] {
    if (this.ctx.aisDisruptions.length === 0) return [];

    const severityWeight: Record<AisDisruptionEvent['severity'], number> = {
      low: 1,
      elevated: 1.4,
      high: 1.9,
    };

    const signals: ForensicsSignalInput[] = [];
    for (const event of this.ctx.aisDisruptions) {
      const signalType = this.classifyAisTrajectorySignal(event);
      const observedAt = resolveObservedAt(event.observedAt, now);
      const freshness = computeFreshnessPenalty(observedAt, CONFLICT_FRESHNESS_PROFILE, now);
      if (freshness.isStale) continue;
      const changeMagnitude = Math.abs(event.changePct || 0);
      const windowHours = Math.max(1, event.windowHours || 1);
      const darkShips = Math.max(0, event.darkShips || 0);
      const vesselCount = Math.max(0, event.vesselCount || 0);
      const baseSeverity = severityWeight[event.severity] || 1;

      let value = 0;
      if (signalType === 'ais_silence') {
        value = (darkShips * 2.2) + (changeMagnitude * 0.72) + (windowHours * 0.7) + (baseSeverity * 4.5);
      } else if (signalType === 'ais_loitering') {
        value = (vesselCount * 0.24) + (changeMagnitude * 0.66) + (windowHours * 0.95) + (baseSeverity * 3.6);
      } else {
        value = (changeMagnitude * 0.94) + (windowHours * 0.74) + (vesselCount * 0.12) + (baseSeverity * 3.4);
      }

      const trajectorySlug = event.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'corridor';
      const lat = Number.isFinite(event.lat) ? event.lat : 0;
      const lon = Number.isFinite(event.lon) ? event.lon : 0;
      const locationToken = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      const magnitudeBonus = Math.min(
        0.24,
        Math.max(changeMagnitude / 180, darkShips / 16, vesselCount / 120) * 0.08,
      );
      const confidence = this.confidenceWithFreshness(
        0.58 + (baseSeverity * 0.07),
        magnitudeBonus + (signalType === 'ais_silence' && darkShips > 0 ? 0.03 : 0),
        freshness.penalty,
      );

      signals.push({
        sourceId: `ais:${signalType}:${trajectorySlug}@${locationToken}`,
        region: event.region || event.name || 'global',
        domain: 'maritime',
        signalType,
        value: Math.round(Math.max(0.1, value) * 100) / 100,
        confidence: Math.round(confidence * 1000) / 1000,
        observedAt,
        evidenceIds: [],
      });
    }

    return signals;
  }

  buildCountryRiskSignals(now = Date.now()): ForensicsSignalInput[] {
    if (SITE_VARIANT !== 'full') return [];

    const signals: ForensicsSignalInput[] = [];

    for (const [code, countryName] of Object.entries(TIER1_COUNTRIES)) {
      const countryData = getCountryData(code);
      if (!countryData) continue;

      const conflicts = countryData.conflicts;
      if (conflicts.length >= 2) {
        const events = conflicts.length;
        const fatalities = conflicts.reduce((sum, event) => sum + Math.max(0, event.fatalities || 0), 0);
        const latestEventAt = conflicts.reduce((latest, event) => {
          const ts = parseTimestampMs(event.time);
          return ts ? Math.max(latest, ts) : latest;
        }, 0);
        const observedAt = latestEventAt || this.ctx.conflictFetchedAt;
        if (observedAt > 0) {
          const freshness = computeFreshnessPenalty(observedAt, CONFLICT_FRESHNESS_PROFILE, now);
          if (!freshness.isStale) {
            const value = clampSignalNumber(
              (logScale1p(events, 12)) + (Math.sqrt(Math.max(0, fatalities)) * 2.5),
              0,
              100,
            );
            const magnitudeBonus = Math.min(0.26, Math.max(events / 2, Math.sqrt(Math.max(1, fatalities)) / 3) * 0.05);
            signals.push({
              sourceId: `country-risk:${code}:conflict`,
              region: countryName,
              domain: 'conflict',
              signalType: 'conflict_event_burst',
              value: Math.round(value * 100) / 100,
              confidence: this.confidenceWithFreshness(0.62, magnitudeBonus, freshness.penalty),
              observedAt,
              evidenceIds: [],
            });
          }
        }
      }

      if (countryData.ucdpStatus && this.ctx.ucdpFetchedAt > 0) {
        const valueByIntensity: Record<'war' | 'minor' | 'none', number> = {
          war: 95,
          minor: 60,
          none: 15,
        };
        const intensity = countryData.ucdpStatus.intensity;
        const value = valueByIntensity[intensity] ?? 15;
        const freshness = computeFreshnessPenalty(this.ctx.ucdpFetchedAt, SLOW_FRESHNESS_PROFILE, now);
        if (!freshness.isStale) {
          signals.push({
            sourceId: `country-risk:${code}:ucdp`,
            region: countryName,
            domain: 'conflict',
            signalType: 'ucdp_intensity',
            value,
            confidence: this.confidenceWithFreshness(0.6, Math.min(0.24, value / 460), freshness.penalty),
            observedAt: this.ctx.ucdpFetchedAt,
            evidenceIds: [],
          });
        }
      }

      if (countryData.hapiSummary && countryData.hapiSummary.eventsPoliticalViolence >= 3 && this.ctx.hapiFetchedAt > 0) {
        const politicalEvents = countryData.hapiSummary.eventsPoliticalViolence;
        const fatalities = Math.max(0, countryData.hapiSummary.fatalitiesTotalPoliticalViolence || 0);
        const freshness = computeFreshnessPenalty(this.ctx.hapiFetchedAt, SLOW_FRESHNESS_PROFILE, now);
        if (!freshness.isStale) {
          const value = clampSignalNumber(
            (logScale1p(politicalEvents, 16)) + (logScale1p(fatalities, 5)),
            0,
            100,
          );
          const magnitudeBonus = Math.min(0.26, Math.max(politicalEvents / 3, logScale1p(fatalities, 1)) * 0.05);
          signals.push({
            sourceId: `country-risk:${code}:hapi`,
            region: countryName,
            domain: 'conflict',
            signalType: 'hapi_political_violence',
            value: Math.round(value * 100) / 100,
            confidence: this.confidenceWithFreshness(0.6, magnitudeBonus, freshness.penalty),
            observedAt: this.ctx.hapiFetchedAt,
            evidenceIds: [],
          });
        }
      }

      if (countryData.displacementOutflow >= 10_000 && this.ctx.displacementFetchedAt > 0) {
        const outflow = Math.max(0, countryData.displacementOutflow);
        const freshness = computeFreshnessPenalty(this.ctx.displacementFetchedAt, SLOW_FRESHNESS_PROFILE, now);
        if (!freshness.isStale) {
          const value = clampSignalNumber(Math.log10(outflow + 1) * 24, 0, 100);
          const magnitudeBonus = Math.min(0.25, (outflow / 10_000) * 0.035);
          signals.push({
            sourceId: `country-risk:${code}:displacement`,
            region: countryName,
            domain: 'displacement',
            signalType: 'displacement_outflow',
            value: Math.round(value * 100) / 100,
            confidence: this.confidenceWithFreshness(0.6, magnitudeBonus, freshness.penalty),
            observedAt: this.ctx.displacementFetchedAt,
            evidenceIds: [],
          });
        }
      }

      if (countryData.climateStress >= 4 && this.ctx.climateFetchedAt > 0) {
        const stress = Math.max(0, countryData.climateStress);
        const freshness = computeFreshnessPenalty(this.ctx.climateFetchedAt, SLOW_FRESHNESS_PROFILE, now);
        if (!freshness.isStale) {
          const value = clampSignalNumber(stress * 5, 0, 100);
          const magnitudeBonus = Math.min(0.22, (stress / 4) * 0.05);
          signals.push({
            sourceId: `country-risk:${code}:climate`,
            region: countryName,
            domain: 'climate',
            signalType: 'climate_stress',
            value: Math.round(value * 100) / 100,
            confidence: this.confidenceWithFreshness(0.58, magnitudeBonus, freshness.penalty),
            observedAt: this.ctx.climateFetchedAt,
            evidenceIds: [],
          });
        }
      }
    }

    return signals
      .sort((a, b) => b.value - a.value);
  }

  buildIntelligenceSignals(): ForensicsSignalInput[] {
    const summary = signalAggregator.getSummary();
    const typeDomain: Record<string, string> = {
      internet_outage: 'infrastructure',
      military_flight: 'military',
      military_vessel: 'military',
      protest: 'conflict',
      ais_disruption: 'maritime',
      cyber_threat: 'cyber',
      satellite_fire: 'climate',
      temporal_anomaly: 'infrastructure',
    };
    const severityWeight: Record<'low' | 'medium' | 'high', number> = {
      low: 1,
      medium: 2,
      high: 3,
    };
    const now = Date.now();

    const bucket = new Map<string, {
      sourceId: string;
      region: string;
      domain: string;
      signalType: string;
      count: number;
      severityTotal: number;
      maxSeverity: number;
      latestObservedAt: number;
      convergenceScore: number;
    }>();

    for (const cluster of summary.topCountries) {
      for (const signal of cluster.signals) {
        const sourceId = `${cluster.country}:${signal.type}`;
        const existing = bucket.get(sourceId);
        const severity = severityWeight[signal.severity];
        const observedAt = signal.timestamp?.getTime?.() || now;
        if (existing) {
          existing.count += 1;
          existing.severityTotal += severity;
          existing.maxSeverity = Math.max(existing.maxSeverity, severity);
          existing.latestObservedAt = Math.max(existing.latestObservedAt, observedAt);
          existing.convergenceScore = Math.max(existing.convergenceScore, cluster.convergenceScore);
        } else {
          bucket.set(sourceId, {
            sourceId,
            region: cluster.country,
            domain: typeDomain[signal.type] || 'infrastructure',
            signalType: signal.type,
            count: 1,
            severityTotal: severity,
            maxSeverity: severity,
            latestObservedAt: observedAt,
            convergenceScore: cluster.convergenceScore,
          });
        }
      }
    }

    for (const [signalType, count] of Object.entries(summary.byType)) {
      if (!count) continue;
      const sourceId = `global:${signalType}`;
      bucket.set(sourceId, {
        sourceId,
        region: 'global',
        domain: typeDomain[signalType] || 'infrastructure',
        signalType,
        count,
        severityTotal: count > 8 ? 3 : count > 3 ? 2 : 1,
        maxSeverity: count > 8 ? 3 : count > 3 ? 2 : 1,
        latestObservedAt: now,
        convergenceScore: 50,
      });
    }

    const baseSignals = Array.from(bucket.values())
      .map((entry) => {
        const severityAverage = entry.severityTotal / Math.max(1, entry.count);
        const value = (entry.count * 2.5) + (severityAverage * 3) + (entry.convergenceScore / 12);
        const confidence = clampSignalNumber(
          0.45 + (entry.maxSeverity * 0.12) + Math.min(0.25, entry.count * 0.03),
          0.45,
          0.98,
        );
        return {
          sourceId: entry.sourceId,
          region: entry.region,
          domain: entry.domain,
          signalType: entry.signalType,
          value: Math.round(value * 100) / 100,
          confidence: Math.round(confidence * 1000) / 1000,
          observedAt: entry.latestObservedAt,
          evidenceIds: [],
        };
      });
    const trajectorySignals = this.buildAisTrajectorySignals(now)
      .sort((a, b) => b.value - a.value);
    const countryRiskSignals = this.buildCountryRiskSignals(now)
      .sort((a, b) => b.value - a.value);
    const merged = new Map<string, ForensicsSignalInput>();
    for (const signal of [...baseSignals, ...countryRiskSignals, ...trajectorySignals]) {
      const key = `${signal.sourceId}:${signal.signalType}`;
      const existing = merged.get(key);
      if (!existing || signal.value > existing.value) {
        merged.set(key, signal);
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => b.value - a.value);
  }

  buildMacroSignals(now = Date.now()): ForensicsSignalInput[] {
    const macro = this.ctx.macroSignals;
    if (!macro) return [];
    const observedAt = parseTimestampMs(macro.timestamp) ?? this.ctx.macroFetchedAt;
    if (observedAt <= 0) return [];
    const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
    if (freshness.isStale) return [];

    const signals: ForensicsSignalInput[] = [];
    const pushMacroSignal = (
      signalType: string,
      sourceSuffix: string,
      magnitude: number,
      threshold: number,
      value: number,
    ) => {
      if (!Number.isFinite(magnitude) || magnitude < threshold) return;
      const magnitudeBonus = Math.min(0.26, ((magnitude / threshold) - 1 + 1) * 0.06);
      signals.push({
        sourceId: `macro:${sourceSuffix}`,
        region: 'global',
        domain: 'market',
        signalType,
        value: Math.round(clampSignalNumber(value, 0, 100) * 100) / 100,
        confidence: this.confidenceWithFreshness(0.61, magnitudeBonus, freshness.penalty),
        observedAt,
        evidenceIds: [],
      });
    };

    const liquidityMagnitude = Math.abs(macro.signals.liquidity.value ?? 0);
    pushMacroSignal(
      'macro_liquidity_extreme',
      'liquidity',
      liquidityMagnitude,
      8,
      liquidityMagnitude * 6,
    );

    const flowDivergence = Math.abs((macro.signals.flowStructure.btcReturn5 ?? 0) - (macro.signals.flowStructure.qqqReturn5 ?? 0));
    pushMacroSignal(
      'macro_flow_structure_divergence',
      'flow-structure',
      flowDivergence,
      4,
      flowDivergence * 10,
    );

    const regimeRotation = Math.abs((macro.signals.macroRegime.qqqRoc20 ?? 0) - (macro.signals.macroRegime.xlpRoc20 ?? 0));
    pushMacroSignal(
      'macro_regime_rotation',
      'regime',
      regimeRotation,
      3,
      regimeRotation * 11,
    );

    const technicalDeltas: number[] = [];
    const btcPrice = macro.signals.technicalTrend.btcPrice ?? 0;
    const sma200 = macro.signals.technicalTrend.sma200 ?? 0;
    const vwap30d = macro.signals.technicalTrend.vwap30d ?? 0;
    const mayerMultiple = macro.signals.technicalTrend.mayerMultiple ?? 0;
    if (btcPrice > 0 && sma200 > 0) {
      technicalDeltas.push(Math.abs((btcPrice - sma200) / sma200));
    }
    if (btcPrice > 0 && vwap30d > 0) {
      technicalDeltas.push(Math.abs((btcPrice - vwap30d) / vwap30d));
    }
    if (mayerMultiple > 0) {
      technicalDeltas.push(Math.abs(mayerMultiple - 1));
    }
    const technicalDislocation = technicalDeltas.length > 0 ? Math.max(...technicalDeltas) : 0;
    pushMacroSignal(
      'macro_technical_dislocation',
      'technical',
      technicalDislocation,
      0.08,
      technicalDislocation * 520,
    );

    const hashrateVolatility = Math.abs(macro.signals.hashRate.change30d ?? 0);
    pushMacroSignal(
      'macro_hashrate_volatility',
      'hashrate',
      hashrateVolatility,
      4,
      hashrateVolatility * 8,
    );

    const fearGreedExtremity = Math.abs((macro.signals.fearGreed.value ?? 50) - 50);
    pushMacroSignal(
      'macro_fear_greed_extremity',
      'fear-greed',
      fearGreedExtremity,
      12,
      fearGreedExtremity * 2.2,
    );

    return signals
      .sort((a, b) => b.value - a.value);
  }

  buildEtfSignals(now = Date.now()): ForensicsSignalInput[] {
    const etfData = this.ctx.etfFlows;
    if (!etfData) return [];
    const observedAt = parseTimestampMs(etfData.timestamp) ?? this.ctx.etfFetchedAt;
    if (observedAt <= 0) return [];
    const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
    if (freshness.isStale) return [];

    const signals: ForensicsSignalInput[] = [];
    let included = 0;
    for (const etf of etfData.etfs) {
      const flowAbs = Math.abs(etf.estFlow || 0);
      const volumeRatio = Math.max(0, etf.volumeRatio || 0);
      if (flowAbs < 15_000_000 && volumeRatio < 1.35) continue;
      included += 1;
      const value = clampSignalNumber(
        logScale1p(flowAbs, 4.5) + Math.max(0, (volumeRatio - 1) * 30) + (Math.abs(etf.priceChange || 0) * 2.5),
        0,
        100,
      );
      const magnitudeBonus = Math.min(0.28, Math.max(flowAbs / 15_000_000, volumeRatio / 1.35) * 0.05);
      signals.push({
        sourceId: `etf:${etf.ticker}`,
        region: 'global',
        domain: 'market',
        signalType: 'etf_flow_pressure',
        value: Math.round(value * 100) / 100,
        confidence: this.confidenceWithFreshness(0.6, magnitudeBonus, freshness.penalty),
        observedAt,
        evidenceIds: [],
      });
    }

    const summaryFlow = Math.abs(etfData.summary?.totalEstFlow ?? 0);
    if (summaryFlow >= 15_000_000 || included > 0) {
      const value = clampSignalNumber(logScale1p(summaryFlow, 5.2) + (included * 2.5), 0, 100);
      const magnitudeBonus = Math.min(0.24, Math.max(summaryFlow / 15_000_000, included / 4) * 0.05);
      signals.push({
        sourceId: 'etf:net-flow',
        region: 'global',
        domain: 'market',
        signalType: 'etf_net_flow_pressure',
        value: Math.round(value * 100) / 100,
        confidence: this.confidenceWithFreshness(0.62, magnitudeBonus, freshness.penalty),
        observedAt,
        evidenceIds: [],
      });
    }

    return signals
      .sort((a, b) => b.value - a.value);
  }

  buildStablecoinSignals(now = Date.now()): ForensicsSignalInput[] {
    const stableData = this.ctx.stablecoins;
    if (!stableData) return [];
    const observedAt = parseTimestampMs(stableData.timestamp) ?? this.ctx.stablecoinFetchedAt;
    if (observedAt <= 0) return [];
    const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
    if (freshness.isStale) return [];

    const signals: ForensicsSignalInput[] = [];
    let depeggedCount = 0;
    let maxDeviation = 0;
    for (const coin of stableData.stablecoins) {
      const deviation = Math.abs(coin.deviation || 0);
      if (deviation < 0.2) continue;
      depeggedCount += 1;
      maxDeviation = Math.max(maxDeviation, deviation);
      const value = clampSignalNumber(
        (deviation * 140) + (Math.abs(coin.change24h || 0) * 4) + logScale1p(Math.abs(coin.volume24h || 0), 1.2),
        0,
        100,
      );
      const magnitudeBonus = Math.min(0.28, Math.max(deviation / 0.2, Math.abs(coin.change24h || 0) / 2) * 0.05);
      signals.push({
        sourceId: `stablecoin:${coin.symbol}`,
        region: 'global',
        domain: 'market',
        signalType: 'stablecoin_depeg_pressure',
        value: Math.round(value * 100) / 100,
        confidence: this.confidenceWithFreshness(0.62, magnitudeBonus, freshness.penalty),
        observedAt,
        evidenceIds: [],
      });
    }

    if (depeggedCount > 0) {
      const summaryVolume = Math.abs(stableData.summary?.totalVolume24h ?? 0);
      const value = clampSignalNumber(
        (depeggedCount * 18) + (maxDeviation * 110) + logScale1p(summaryVolume, 0.75),
        0,
        100,
      );
      const magnitudeBonus = Math.min(0.24, Math.max(depeggedCount / 2, maxDeviation / 0.2) * 0.05);
      signals.push({
        sourceId: 'stablecoin:systemic',
        region: 'global',
        domain: 'market',
        signalType: 'stablecoin_systemic_stress',
        value: Math.round(value * 100) / 100,
        confidence: this.confidenceWithFreshness(0.64, magnitudeBonus, freshness.penalty),
        observedAt,
        evidenceIds: [],
      });
    }

    return signals
      .sort((a, b) => b.value - a.value);
  }

  buildEconomicSignals(now = Date.now()): ForensicsSignalInput[] {
    const signals: ForensicsSignalInput[] = [];

    if (this.ctx.fredSeries.length > 0 && this.ctx.fredFetchedAt > 0) {
      const fredFreshness = computeFreshnessPenalty(this.ctx.fredFetchedAt, FAST_FRESHNESS_PROFILE, now);
      if (!fredFreshness.isStale) {
        for (const series of this.ctx.fredSeries) {
          const changePercent = Math.abs(series.changePercent ?? 0);
          if (!Number.isFinite(changePercent) || changePercent < 0.4) continue;
          const value = clampSignalNumber(
            (changePercent * 14) + logScale1p(Math.abs(series.change ?? 0), 6),
            0,
            100,
          );
          const magnitudeBonus = Math.min(0.26, (changePercent / 0.4) * 0.04);
          signals.push({
            sourceId: `fred:${series.id}`,
            region: 'global',
            domain: 'economic',
            signalType: `fred_${series.id.toLowerCase()}_delta_pct`,
            value: Math.round(value * 100) / 100,
            confidence: this.confidenceWithFreshness(0.58, magnitudeBonus, fredFreshness.penalty),
            observedAt: this.ctx.fredFetchedAt,
            evidenceIds: [],
          });
        }
      }
    }

    if (this.ctx.oilAnalytics) {
      const metrics = [
        this.ctx.oilAnalytics.wtiPrice,
        this.ctx.oilAnalytics.brentPrice,
        this.ctx.oilAnalytics.usProduction,
        this.ctx.oilAnalytics.usInventory,
      ].filter((metric): metric is NonNullable<typeof metric> => Boolean(metric));

      for (const metric of metrics) {
        const changePct = Math.abs(metric.changePct || 0);
        if (changePct < 0.8) continue;
        const observedAt = parseTimestampMs(metric.lastUpdated)
          || this.ctx.oilFetchedAt
          || parseTimestampMs(this.ctx.oilAnalytics.fetchedAt)
          || 0;
        if (observedAt <= 0) continue;
        const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
        if (freshness.isStale) continue;
        const value = clampSignalNumber((changePct * 12) + logScale1p(Math.abs(metric.current || 0), 1.8), 0, 100);
        const magnitudeBonus = Math.min(0.26, (changePct / 0.8) * 0.04);
        signals.push({
          sourceId: `oil:${metric.id.toLowerCase()}`,
          region: 'global',
          domain: 'economic',
          signalType: `oil_${metric.id.toLowerCase()}_delta_pct`,
          value: Math.round(value * 100) / 100,
          confidence: this.confidenceWithFreshness(0.6, magnitudeBonus, freshness.penalty),
          observedAt,
          evidenceIds: [],
        });
      }
    }

    return signals
      .sort((a, b) => b.value - a.value);
  }

  buildMarketSignals(): ForensicsSignalInput[] {
    const now = Date.now();
    const marketSignals: ForensicsSignalInput[] = [];
    const predictionSignals: ForensicsSignalInput[] = [];
    const absChanges: number[] = [];
    const convictions: number[] = [];
    let latestMarketObservedAt = 0;
    let latestPredictionObservedAt = 0;

    for (const market of this.ctx.markets) {
      const change = market.change;
      if (typeof change !== 'number' || !Number.isFinite(change)) continue;
      const absChange = Math.abs(change);
      if (absChange < 0.25) continue;
      absChanges.push(absChange);
      const observedAt = resolveObservedAt(market.observedAt, now);
      const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
      if (freshness.isStale) continue;
      latestMarketObservedAt = Math.max(latestMarketObservedAt, observedAt);
      const confidence = this.confidenceWithFreshness(
        0.62,
        Math.min(0.28, (absChange / 10) * 0.08),
        freshness.penalty,
      );
      marketSignals.push({
        sourceId: `market:${market.symbol}`,
        region: 'global',
        domain: 'market',
        signalType: 'market_change_pct',
        value: Math.round(absChange * 100) / 100,
        confidence,
        observedAt,
        evidenceIds: [],
      });
    }

    for (const prediction of this.ctx.predictions) {
      if (!Number.isFinite(prediction.yesPrice)) continue;
      const conviction = Math.abs(prediction.yesPrice - 50) / 50 * 100;
      if (conviction < 12) continue;
      convictions.push(conviction);
      const observedAt = resolveObservedAt(prediction.observedAt, now);
      const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
      if (freshness.isStale) continue;
      latestPredictionObservedAt = Math.max(latestPredictionObservedAt, observedAt);
      const titleSlug = prediction.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'untitled';
      const confidence = this.confidenceWithFreshness(
        0.6,
        Math.min(0.3, (conviction / 100) * 0.1),
        freshness.penalty,
      );
      predictionSignals.push({
        sourceId: `prediction:${titleSlug}`,
        region: 'global',
        domain: 'prediction',
        signalType: 'prediction_conviction',
        value: Math.round(conviction * 100) / 100,
        confidence,
        observedAt,
        evidenceIds: [],
      });
    }

    if (absChanges.length > 0) {
      const avgVolatility = absChanges.reduce((sum, value) => sum + value, 0) / absChanges.length;
      const observedAt = latestMarketObservedAt > 0 ? latestMarketObservedAt : now;
      const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
      if (!freshness.isStale) {
        marketSignals.push({
          sourceId: 'global:market_volatility',
          region: 'global',
          domain: 'market',
          signalType: 'market_volatility',
          value: Math.round(avgVolatility * 100) / 100,
          confidence: this.confidenceWithFreshness(0.64, Math.min(0.18, avgVolatility * 0.01), freshness.penalty),
          observedAt,
          evidenceIds: [],
        });
      }
    }

    if (convictions.length > 0) {
      const avgConviction = convictions.reduce((sum, value) => sum + value, 0) / convictions.length;
      const observedAt = latestPredictionObservedAt > 0 ? latestPredictionObservedAt : now;
      const freshness = computeFreshnessPenalty(observedAt, FAST_FRESHNESS_PROFILE, now);
      if (!freshness.isStale) {
        predictionSignals.push({
          sourceId: 'global:prediction_conviction',
          region: 'global',
          domain: 'prediction',
          signalType: 'prediction_conviction',
          value: Math.round(avgConviction * 100) / 100,
          confidence: this.confidenceWithFreshness(0.62, Math.min(0.17, avgConviction / 180), freshness.penalty),
          observedAt,
          evidenceIds: [],
        });
      }
    }

    const cappedSignals = [
      ...marketSignals.sort((a, b) => b.value - a.value),
      ...predictionSignals.sort((a, b) => b.value - a.value),
      ...this.buildMacroSignals(now),
      ...this.buildEtfSignals(now),
      ...this.buildStablecoinSignals(now),
      ...this.buildEconomicSignals(now),
    ];

    return cappedSignals
      .sort((a, b) => b.value - a.value);
  }
}
