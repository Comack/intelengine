import type { AppContext, AppModule } from '@/app/app-context';
import type { ClusteredEvent, NewsItem, MapLayers, SocialUnrestEvent } from '@/types';
import type { MarketData } from '@/types';
import type { TimeRange } from '@/components';
import {
  FEEDS,
  INTEL_SOURCES,
  SECTORS,
  COMMODITIES,
  MARKET_SYMBOLS,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
} from '@/config';
import { INTEL_HOTSPOTS, CONFLICT_ZONES } from '@/config/geo';
import { tokenizeForMatch, matchKeyword } from '@/utils/keyword-match';
import {
  fetchCategoryFeeds,
  getFeedFailures,
  fetchMultipleStocks,
  fetchCrypto,
  fetchPredictions,
  fetchEarthquakes,
  fetchWeatherAlerts,
  fetchFredData,
  fetchInternetOutages,
  isOutagesConfigured,
  fetchAisSignals,
  getAisStatus,
  isAisConfigured,
  fetchCableActivity,
  fetchCableHealth,
  fetchProtestEvents,
  getProtestStatus,
  fetchFlightDelays,
  fetchMilitaryFlights,
  fetchMilitaryVessels,
  initMilitaryVesselStream,
  isMilitaryVesselTrackingConfigured,
  fetchUSNIFleetReport,
  updateBaseline,
  calculateDeviation,
  addToSignalHistory,
  analysisWorker,
  fetchPizzIntStatus,
  fetchGdeltTensions,
  fetchNaturalEvents,
  fetchRecentAwards,
  fetchOilAnalytics,
  fetchBisData,
  fetchCyberThreats,
  drainTrendingSignals,
  fetchTradeRestrictions,
  fetchTariffTrends,
  fetchTradeFlows,
  fetchTradeBarriers,
  fetchShippingRates,
  fetchChokepointStatus,
  fetchCriticalMinerals,
} from '@/services';
import { checkBatchForBreakingAlerts, dispatchOrefBreakingAlert } from '@/services/breaking-news-alerts';
import { clusterNewsHybrid } from '@/services/clustering';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats, toMapFires } from '@/services/wildfires';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { ingestProtestsForCII, ingestMilitaryForCII, ingestNewsForCII, ingestOutagesForCII, ingestConflictsForCII, ingestUcdpForCII, ingestHapiForCII, ingestDisplacementForCII, ingestClimateForCII, ingestStrikesForCII, ingestOrefForCII, ingestAviationForCII, ingestAdvisoriesForCII, ingestGpsJammingForCII, ingestAisDisruptionsForCII, ingestSatelliteFiresForCII, ingestCyberThreatsForCII, ingestTemporalAnomaliesForCII, isInLearningMode } from '@/services/country-instability';
import { fetchGpsInterference } from '@/services/gps-interference';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { fetchConflictEvents, fetchUcdpClassifications, fetchHapiSummary, fetchUcdpEvents, deduplicateAgainstAcled, fetchIranEvents, fetchConflictIncidents, type ConflictIncident } from '@/services/conflict';
import { fetchUnhcrPopulation } from '@/services/displacement';
import { fetchClimateAnomalies, fetchAirQualityReadings, fetchDeforestationAlerts, fetchPollutionGrid, type AirQualityReading, type DeforestationAlert, type PollutionGridTile } from '@/services/climate';
import { fetchSarDetections, fetchPortCongestion, fetchNavWarnings, type SarDarkShip, type NavigationalWarning } from '@/services/maritime';
import { fetchGridStatus, fetchRoutingAnomalies, fetchRadiationReadings, type GridZone, type RoutingAnomaly, type RadiationReading } from '@/services/infrastructure';
import { fetchWhaleTransfers } from '@/services/market';
import { fetchAcarsMessages } from '@/services/military';
import { fetchRepoMomentum, fetchSocialTrends } from '@/services/research';
import { getSpaceWeather } from '@/services/space';
import { ForensicsSignalBuilder } from '@/services/forensics-signal-builder';
import { runForensicsShadow, listForensicsRuns, getForensicsPolicy, getForensicsTopologySummary } from '@/services/forensics';
import type { ForensicsPanel } from '@/components/ForensicsPanel';
import type { AisDisruptionEvent } from '@/types';
import type { WhaleTransfer } from '@/services/market';
import { fetchSecurityAdvisories } from '@/services/security-advisories';
import { fetchTelegramFeed } from '@/services/telegram-intel';
import { fetchOrefAlerts, onOrefAlertsUpdate, acquireOrefPolling, releaseOrefPolling } from '@/services/oref-alerts';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { debounce, getCircuitBreakerCooldownInfo } from '@/utils';
import { isFeatureAvailable, isFeatureEnabled } from '@/services/runtime-config';
import { getAiFlowSettings } from '@/services/ai-flow-settings';
import { t, getCurrentLanguage } from '@/services/i18n';
import { getHydratedData } from '@/services/bootstrap';
import { canQueueAiClassification, AI_CLASSIFY_MAX_PER_FEED } from '@/services/ai-classify-queue';
import { classifyWithAI } from '@/services/threat-classifier';
import { ingestHeadlines } from '@/services/trending-keywords';
import type { ListFeedDigestResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import type { GetSectorSummaryResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import { mountCommunityWidget } from '@/components/CommunityWidget';
import { ResearchServiceClient } from '@/generated/client/worldmonitor/research/v1/service_client';
import {
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  InsightsPanel,
  CIIPanel,
  StrategicPosturePanel,
  EconomicPanel,
  TechReadinessPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TradePolicyPanel,
  SupplyChainPanel,
  SecurityAdvisoriesPanel,
  OrefSirensPanel,
  TelegramIntelPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { classifyNewsItem } from '@/services/positive-classifier';
import { fetchGivingSummary } from '@/services/giving';
import { GivingPanel } from '@/components';
import { fetchProgressData } from '@/services/progress-data';
import { fetchConservationWins } from '@/services/conservation-data';
import { fetchRenewableEnergyData, fetchEnergyCapacity } from '@/services/renewable-energy-data';
import { checkMilestones } from '@/services/celebration';
import { fetchHappinessScores } from '@/services/happiness-data';
import { fetchRenewableInstallations } from '@/services/renewable-installations';
import { filterBySentiment } from '@/services/sentiment-gate';
import { fetchAllPositiveTopicIntelligence } from '@/services/gdelt-intel';
import { fetchPositiveGeoEvents, geocodePositiveNewsItems } from '@/services/positive-events-geo';
import { fetchKindnessData } from '@/services/kindness-data';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import type { ThreatLevel as ClientThreatLevel } from '@/services/threat-classifier';
import type { NewsItem as ProtoNewsItem, ThreatLevel as ProtoThreatLevel } from '@/generated/client/worldmonitor/news/v1/service_client';

const PROTO_TO_CLIENT_LEVEL: Record<ProtoThreatLevel, ClientThreatLevel> = {
  THREAT_LEVEL_UNSPECIFIED: 'info',
  THREAT_LEVEL_LOW: 'low',
  THREAT_LEVEL_MEDIUM: 'medium',
  THREAT_LEVEL_HIGH: 'high',
  THREAT_LEVEL_CRITICAL: 'critical',
};

function protoItemToNewsItem(p: ProtoNewsItem): NewsItem {
  const level = PROTO_TO_CLIENT_LEVEL[p.threat?.level ?? 'THREAT_LEVEL_UNSPECIFIED'];
  return {
    source: p.source,
    title: p.title,
    link: p.link,
    pubDate: new Date(p.publishedAt),
    isAlert: p.isAlert,
    threat: p.threat ? {
      level,
      category: p.threat.category as import('@/services/threat-classifier').EventCategory,
      confidence: p.threat.confidence,
      source: (p.threat.source || 'keyword') as 'keyword' | 'ml' | 'llm',
    } : undefined,
    ...(p.locationName && { locationName: p.locationName }),
    ...(p.location && { lat: p.location.latitude, lon: p.location.longitude }),
  };
}

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export interface DataLoaderCallbacks {
  renderCriticalBanner: (postures: TheaterPostureSummary[]) => void;
}

export class DataLoaderManager implements AppModule {
  private ctx: AppContext;
  private callbacks: DataLoaderCallbacks;

  private mapFlashCache: Map<string, number> = new Map();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;

  // Forensics signal caches — populated by each loadXxx() method and used by loadForensics()
  private cachedAisDisruptions: AisDisruptionEvent[] = [];
  private cachedSarDetections: SarDarkShip[] = [];
  // portCongestion kept as generic record to satisfy the ForensicsSignalContext index signature
  private cachedPortCongestion: Record<string, unknown>[] = [];
  private cachedGridZones: GridZone[] = [];
  private cachedRoutingAnomalies: RoutingAnomaly[] = [];
  private cachedAirQualityReadings: AirQualityReading[] = [];
  private cachedRadiationReadings: RadiationReading[] = [];
  private cachedDeforestationAlerts: DeforestationAlert[] = [];
  private cachedConflictIncidents: ConflictIncident[] = [];
  private cachedPollutionGrid: PollutionGridTile[] = [];
  private cachedAcarsMessages: Record<string, unknown>[] = [];
  private cachedWhaleTransfers: WhaleTransfer[] = [];
  private cachedNavWarnings: NavigationalWarning[] = [];
  private sarFetchedAt = 0;
  private portFetchedAt = 0;
  private gridFetchedAt = 0;
  private routingFetchedAt = 0;
  private aqiFetchedAt = 0;
  private radiationFetchedAt = 0;
  private deforestationFetchedAt = 0;
  private acarsFetchedAt = 0;
  private whaleFetchedAt = 0;
  private navFetchedAt = 0;
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
    this.applyTimeRangeFilterToNewsPanels();
  }, 120);
  private ciiRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly ciiRefreshDebounceMs = 140;

  public updateSearchIndex: () => void = () => {};

  private digestBreaker = { state: 'closed' as 'closed' | 'open' | 'half-open', failures: 0, cooldownUntil: 0 };
  private readonly digestRequestTimeoutMs = 8000;
  private readonly digestBreakerCooldownMs = 5 * 60 * 1000;
  private readonly persistedDigestMaxAgeMs = 6 * 60 * 60 * 1000;
  private readonly perFeedFallbackCategoryFeedLimit = 3;
  private readonly perFeedFallbackIntelFeedLimit = 6;
  private readonly perFeedFallbackBatchSize = 2;
  private lastGoodDigest: ListFeedDigestResponse | null = null;
  private orefUnsubscribe: (() => void) | null = null;
  private orefPollingRelease: (() => void) | null = null;
  private readonly orefPollingConsumerId = `data-loader:${SITE_VARIANT}`;
  private pendingMapMutations: Array<() => void> = [];
  private mapMutationRafId: number | null = null;
  private mapMutationTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClusterNewsSignature = '';
  private lastClusterResult: ClusteredEvent[] = [];

  constructor(ctx: AppContext, callbacks: DataLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  init(): void {
    // OREF subscription/polling is demand-driven.
  }

  destroy(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced.cancel();
    if (this.ciiRefreshTimeout) {
      clearTimeout(this.ciiRefreshTimeout);
      this.ciiRefreshTimeout = null;
    }
    if (this.mapMutationRafId != null) {
      cancelAnimationFrame(this.mapMutationRafId);
      this.mapMutationRafId = null;
    }
    if (this.mapMutationTimer) {
      clearTimeout(this.mapMutationTimer);
      this.mapMutationTimer = null;
    }
    this.pendingMapMutations = [];
    this.updateOrefDemand(false);
  }

  private withMapBatch(action: () => void): void {
    if (!this.ctx.map) {
      action();
      return;
    }
    this.pendingMapMutations.push(action);
    this.scheduleMapMutationFlush();
  }

  private scheduleMapMutationFlush(): void {
    if (this.mapMutationRafId != null || this.mapMutationTimer) return;
    if (document.hidden) {
      this.mapMutationTimer = setTimeout(() => {
        this.mapMutationTimer = null;
        this.flushMapMutations();
      }, 70);
      return;
    }
    this.mapMutationRafId = requestAnimationFrame(() => {
      this.mapMutationRafId = null;
      this.flushMapMutations();
    });
  }

  private flushMapMutations(): void {
    if (!this.ctx.map || this.pendingMapMutations.length === 0) return;
    const actions = this.pendingMapMutations;
    this.pendingMapMutations = [];
    this.ctx.map.runInUpdateBatch(() => {
      for (const action of actions) {
        try {
          action();
        } catch (error) {
          console.warn('[DataLoader] Deferred map mutation failed:', error);
        }
      }
    });
  }

  private scheduleCiiRefresh(forceLocal = false): void {
    if (this.ciiRefreshTimeout) clearTimeout(this.ciiRefreshTimeout);
    this.ciiRefreshTimeout = setTimeout(() => {
      this.ciiRefreshTimeout = null;
      const ciiPanel = this.ctx.panels['cii'] as CIIPanel | undefined;
      if (!ciiPanel) return;
      void ciiPanel.refresh(forceLocal);
    }, this.ciiRefreshDebounceMs);
  }

  private isPanelEnabledAndVisible(panelId: string): boolean {
    const panel = this.ctx.panels[panelId];
    if (!panel) return false;
    const setting = this.ctx.panelSettings[panelId];
    if (setting && !setting.enabled) return false;
    return panel.isVisible();
  }

  private isAnyPanelVisible(panelIds: string[]): boolean {
    return panelIds.some((id) => this.isPanelEnabledAndVisible(id));
  }

  private isAnyLayerEnabled(layerIds: (keyof MapLayers)[]): boolean {
    return layerIds.some((id) => this.ctx.mapLayers[id]);
  }

  private ensureOrefSubscription(): void {
    if (this.orefUnsubscribe) return;
    this.orefUnsubscribe = onOrefAlertsUpdate((update) => this.handleOrefAlertsUpdate(update));
  }

  private updateOrefDemand(enabled: boolean): void {
    if (enabled) {
      this.ensureOrefSubscription();
      if (!this.orefPollingRelease) {
        acquireOrefPolling(this.orefPollingConsumerId);
        this.orefPollingRelease = () => releaseOrefPolling(this.orefPollingConsumerId);
      }
      return;
    }

    this.orefPollingRelease?.();
    this.orefPollingRelease = null;
    this.orefUnsubscribe?.();
    this.orefUnsubscribe = null;
  }

  private handleOrefAlertsUpdate(data: Awaited<ReturnType<typeof fetchOrefAlerts>>): void {
    (this.ctx.panels['oref-sirens'] as OrefSirensPanel)?.setData(data);
    const alertCount = data.alerts?.length ?? 0;
    const historyCount24h = data.historyCount24h ?? 0;
    ingestOrefForCII(alertCount, historyCount24h);
    this.ctx.intelligenceCache.orefAlerts = { alertCount, historyCount24h };
    if (data.alerts?.length) dispatchOrefBreakingAlert(data.alerts);
  }

  private async tryFetchDigest(): Promise<ListFeedDigestResponse | null> {
    const now = Date.now();

    if (this.digestBreaker.state === 'open') {
      if (now < this.digestBreaker.cooldownUntil) {
        return this.lastGoodDigest ?? await this.loadPersistedDigest();
      }
      this.digestBreaker.state = 'half-open';
    }

    try {
      const resp = await fetch(
        `/api/news/v1/list-feed-digest?variant=${SITE_VARIANT}&lang=${getCurrentLanguage()}`,
        { signal: AbortSignal.timeout(this.digestRequestTimeoutMs) },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as ListFeedDigestResponse;
      const catCount = Object.keys(data.categories ?? {}).length;
      console.info(`[News] Digest fetched: ${catCount} categories`);
      this.lastGoodDigest = data;
      this.persistDigest(data);
      this.digestBreaker = { state: 'closed', failures: 0, cooldownUntil: 0 };
      return data;
    } catch (e) {
      console.warn('[News] Digest fetch failed, using fallback:', e);
      this.digestBreaker.failures++;
      if (this.digestBreaker.failures >= 2) {
        this.digestBreaker.state = 'open';
        this.digestBreaker.cooldownUntil = now + this.digestBreakerCooldownMs;
      }
      return this.lastGoodDigest ?? await this.loadPersistedDigest();
    }
  }

  private persistDigest(data: ListFeedDigestResponse): void {
    setPersistentCache('digest:last-good', data).catch(() => {});
  }

  private async loadPersistedDigest(): Promise<ListFeedDigestResponse | null> {
    try {
      const envelope = await getPersistentCache<ListFeedDigestResponse>('digest:last-good');
      if (!envelope) return null;
      if (Date.now() - envelope.updatedAt > this.persistedDigestMaxAgeMs) return null;
      this.lastGoodDigest = envelope.data;
      return envelope.data;
    } catch { return null; }
  }

  private isPerFeedFallbackEnabled(): boolean {
    return isFeatureEnabled('newsPerFeedFallback');
  }

  private getStaleNewsItems(category: string): NewsItem[] {
    const staleItems = this.ctx.newsByCategory[category];
    if (!Array.isArray(staleItems) || staleItems.length === 0) return [];
    return [...staleItems].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  }

  private selectLimitedFeeds<T>(feeds: T[], maxFeeds: number): T[] {
    if (feeds.length <= maxFeeds) return feeds;
    return feeds.slice(0, maxFeeds);
  }

  private shouldShowIntelligenceNotifications(): boolean {
    return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  private createGuardedRunner(): (name: string, fn: () => Promise<void>) => Promise<void> {
    return async (name: string, fn: () => Promise<void>): Promise<void> => {
      if (this.ctx.isDestroyed || this.ctx.inFlight.has(name)) return;
      this.ctx.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        if (!this.ctx.isDestroyed) console.error(`[App] ${name} failed:`, e);
      } finally {
        this.ctx.inFlight.delete(name);
      }
    };
  }

  async loadCriticalData(): Promise<void> {
    const runGuarded = this.createGuardedRunner();

    const tasks: Array<{ name: string; task: Promise<void> }> = [
      { name: 'news', task: runGuarded('news', () => this.loadNews()) },
    ];

    // Happy variant only loads news data -- skip all geopolitical/financial/military data
    if (SITE_VARIANT !== 'happy') {
      if (this.isAnyPanelVisible(['markets', 'heatmap', 'commodities', 'crypto', 'strategic-risk', 'forensics'])) {
        tasks.push({ name: 'markets', task: runGuarded('markets', () => this.loadMarkets()) });
      }
      if (this.isAnyPanelVisible(['polymarket', 'strategic-risk', 'forensics'])) {
        tasks.push({ name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions()) });
      }
      if (SITE_VARIANT === 'full' && this.ctx.pizzintIndicator) {
        tasks.push({ name: 'pizzint', task: runGuarded('pizzint', () => this.loadPizzInt()) });
      }
      if (this.isAnyPanelVisible(['economic', 'strategic-risk', 'forensics'])) {
        tasks.push({ name: 'fred', task: runGuarded('fred', () => this.loadFredData()) });
        tasks.push({ name: 'oil', task: runGuarded('oil', () => this.loadOilAnalytics()) });
        tasks.push({ name: 'spending', task: runGuarded('spending', () => this.loadGovernmentSpending()) });
        tasks.push({ name: 'bis', task: runGuarded('bis', () => this.loadBisData()) });
      }

    }

    // Progress charts data (happy variant only)
    if (SITE_VARIANT === 'happy') {
      tasks.push({
        name: 'progress',
        task: runGuarded('progress', () => this.loadProgressData()),
      });
      tasks.push({
        name: 'species',
        task: runGuarded('species', () => this.loadSpeciesData()),
      });
      tasks.push({
        name: 'renewable',
        task: runGuarded('renewable', () => this.loadRenewableData()),
      });
      tasks.push({
        name: 'happinessMap',
        task: runGuarded('happinessMap', async () => {
          const data = await fetchHappinessScores();
          this.withMapBatch(() => {
            this.ctx.map?.setHappinessScores(data);
          });
        }),
      });
      tasks.push({
        name: 'renewableMap',
        task: runGuarded('renewableMap', async () => {
          const installations = await fetchRenewableInstallations();
          this.withMapBatch(() => {
            this.ctx.map?.setRenewableInstallations(installations);
          });
        }),
      });
    }

    if (
      SITE_VARIANT === 'full' && (
        this.isAnyPanelVisible(['cii', 'strategic-posture', 'strategic-risk', 'forensics']) ||
        this.isAnyLayerEnabled(['outages', 'protests', 'military', 'ucdpEvents', 'displacement', 'climate', 'gpsJamming'])
      )
    ) {
      tasks.push({ name: 'intelligence', task: runGuarded('intelligence', () => this.loadIntelligenceSignals()) });
    }

    if (SITE_VARIANT === 'full' && (this.ctx.mapLayers.fires || this.isAnyPanelVisible(['satellite-fires', 'cii', 'strategic-risk']))) {
      tasks.push({ name: 'firms', task: runGuarded('firms', () => this.loadFirmsData()) });
    }
    if (this.ctx.mapLayers.natural) tasks.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.weather) tasks.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.ais) tasks.push({ name: 'ais', task: runGuarded('ais', () => this.loadAisSignals()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cables', task: runGuarded('cables', () => this.loadCableActivity()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cableHealth', task: runGuarded('cableHealth', () => this.loadCableHealth()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights) tasks.push({ name: 'flights', task: runGuarded('flights', () => this.loadFlightDelays()) });
    if (SITE_VARIANT !== 'happy' && CYBER_LAYER_ENABLED && this.ctx.mapLayers.cyberThreats) tasks.push({ name: 'cyberThreats', task: runGuarded('cyberThreats', () => this.loadCyberThreats()) });
    if (SITE_VARIANT !== 'happy') tasks.push({ name: 'iranAttacks', task: runGuarded('iranAttacks', () => this.loadIranEvents()) });
    if (SITE_VARIANT !== 'happy' && (this.ctx.mapLayers.techEvents || SITE_VARIANT === 'tech')) tasks.push({ name: 'techEvents', task: runGuarded('techEvents', () => this.loadTechEvents()) });

    // New signal layers
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.sarDetections) tasks.push({ name: 'sarDetections', task: runGuarded('sarDetections', () => this.loadSarDetections()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.portCongestion) tasks.push({ name: 'portCongestion', task: runGuarded('portCongestion', () => this.loadPortCongestion()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.gridZones) tasks.push({ name: 'gridZones', task: runGuarded('gridZones', () => this.loadGridZones()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.routingAnomalies) tasks.push({ name: 'routingAnomalies', task: runGuarded('routingAnomalies', () => this.loadRoutingAnomalies()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.radiationReadings) tasks.push({ name: 'radiationReadings', task: runGuarded('radiationReadings', () => this.loadRadiationReadings()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.airQuality) tasks.push({ name: 'airQuality', task: runGuarded('airQuality', () => this.loadAirQualityReadings()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.deforestationAlerts) tasks.push({ name: 'deforestationAlerts', task: runGuarded('deforestationAlerts', () => this.loadDeforestationAlerts()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.acarsMessages) tasks.push({ name: 'acarsMessages', task: runGuarded('acarsMessages', () => this.loadAcarsMessages()) });
    if ((SITE_VARIANT === 'finance' || SITE_VARIANT === 'full') && this.ctx.mapLayers.whaleTransfers) tasks.push({ name: 'whaleTransfers', task: runGuarded('whaleTransfers', () => this.loadWhaleTransfers()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.navWarnings) tasks.push({ name: 'navWarnings', task: runGuarded('navWarnings', () => this.loadNavWarnings()) });
    if (SITE_VARIANT === 'full' && this.isPanelEnabledAndVisible('forensics')) {
      tasks.push({ name: 'forensics', task: runGuarded('forensics', () => this.loadForensics()) });
    }

    const results = await Promise.allSettled(tasks.map(t => t.task));

    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[App] ${tasks[idx]?.name} load failed:`, result.reason);
      }
    });

    this.updateSearchIndex();
  }

  async loadDeferredData(): Promise<void> {
    const runGuarded = this.createGuardedRunner();
    const tasks: Array<{ name: string; task: Promise<void> }> = [];

    // Trade + supply chain are lower urgency and can be deferred after first paint.
    if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
      tasks.push({ name: 'tradePolicy', task: runGuarded('tradePolicy', () => this.loadTradePolicy()) });
      tasks.push({ name: 'supplyChain', task: runGuarded('supplyChain', () => this.loadSupplyChain()) });
    }

    // Global giving panel can warm in after core map/news settle.
    tasks.push({
      name: 'giving',
      task: runGuarded('giving', async () => {
        const givingResult = await fetchGivingSummary();
        if (!givingResult.ok) {
          dataFreshness.recordError('giving', 'Giving data unavailable (retaining prior state)');
          return;
        }
        const data = givingResult.data;
        (this.ctx.panels['giving'] as GivingPanel)?.setData(data);
        if (data.platforms.length > 0) dataFreshness.recordUpdate('giving', data.platforms.length);
      }),
    });

    if (SITE_VARIANT !== 'happy') {
      tasks.push({ name: 'spaceWeather', task: runGuarded('spaceWeather', () => this.loadSpaceWeather()) });
    }

    if (SITE_VARIANT === 'tech') {
      tasks.push({
        name: 'techReadiness',
        task: runGuarded('techReadiness', () => (this.ctx.panels['tech-readiness'] as TechReadinessPanel)?.refresh()),
      });
    }

    if (tasks.length === 0) return;
    const results = await Promise.allSettled(tasks.map((t) => t.task));
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[App] ${tasks[idx]?.name} deferred load failed:`, result.reason);
      }
    });
    this.updateSearchIndex();
  }

  async loadAllData(): Promise<void> {
    await this.loadCriticalData();
    await this.loadDeferredData();
  }

  async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.ctx.isDestroyed || this.ctx.inFlight.has(layer)) return;
    this.ctx.inFlight.add(layer);
    this.ctx.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadCyberThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await Promise.all([this.loadCableActivity(), this.loadCableHealth()]);
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadMilitary();
          break;
        case 'techEvents':
          await this.loadTechEvents();
          break;
        case 'positiveEvents':
          await this.loadPositiveEvents();
          break;
        case 'kindness':
          this.loadKindnessData();
          break;
        case 'iranAttacks':
          await this.loadIranEvents();
          break;
        case 'conflictIncidents':
          await this.loadConflictIncidents();
          break;
        case 'pollutionGrid':
          await this.loadPollutionGrid();
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
        case 'gpsJamming':
          await this.loadIntelligenceSignals();
          break;
        case 'sarDetections':
          await this.loadSarDetections();
          break;
        case 'portCongestion':
          await this.loadPortCongestion();
          break;
        case 'gridZones':
          await this.loadGridZones();
          break;
        case 'routingAnomalies':
          await this.loadRoutingAnomalies();
          break;
        case 'radiationReadings':
          await this.loadRadiationReadings();
          break;
        case 'airQuality':
          await this.loadAirQualityReadings();
          break;
        case 'deforestationAlerts':
          await this.loadDeforestationAlerts();
          break;
        case 'acarsMessages':
          await this.loadAcarsMessages();
          break;
        case 'whaleTransfers':
          await this.loadWhaleTransfers();
          break;
        case 'navWarnings':
          await this.loadNavWarnings();
          break;
      }
    } finally {
      this.ctx.inFlight.delete(layer);
      this.ctx.map?.setLayerLoading(layer, false);
    }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const tokens = tokenizeForMatch(title);
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && matchKeyword(tokens, cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of INTEL_HOTSPOTS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of CONFLICT_ZONES) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.ctx.map || !this.ctx.initialLoadComplete) return;
    if (!getAiFlowSettings().mapNewsFlash) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.ctx.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  getTimeRangeWindowMs(range: TimeRange): number {
    const ranges: Record<TimeRange, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    };
    return ranges[range];
  }

  filterItemsByTimeRange(items: NewsItem[], range: TimeRange = this.ctx.currentTimeRange): NewsItem[] {
    if (range === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  getTimeRangeLabel(range: TimeRange = this.ctx.currentTimeRange): string {
    const labels: Record<TimeRange, string> = {
      '1h': 'the last hour',
      '6h': 'the last 6 hours',
      '24h': 'the last 24 hours',
      '48h': 'the last 48 hours',
      '7d': 'the last 7 days',
      'all': 'all time',
    };
    return labels[range];
  }

  renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.ctx.newsByCategory[category] = items;
    const panel = this.ctx.newsPanels[category];
    if (!panel) return;
    const filteredItems = this.filterItemsByTimeRange(items);
    if (filteredItems.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
      return;
    }
    panel.renderNews(filteredItems);
  }

  applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      this.renderNewsForCategory(category, items);
    });
  }

  applyTimeRangeFilterDebounced(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced();
  }

  private async clusterNewsForDashboard(items: NewsItem[]): Promise<ClusteredEvent[]> {
    const signature = this.getNewsClusterSignature(items);
    if (signature === this.lastClusterNewsSignature && this.lastClusterResult.length > 0) {
      return this.lastClusterResult;
    }

    try {
      const clusters = await analysisWorker.clusterNews(items);
      this.lastClusterNewsSignature = signature;
      this.lastClusterResult = clusters;
      return clusters;
    } catch (error) {
      console.warn('[News] Worker clustering failed, falling back to hybrid clustering:', error);
      const clusters = await clusterNewsHybrid(items);
      this.lastClusterNewsSignature = signature;
      this.lastClusterResult = clusters;
      return clusters;
    }
  }

  private getNewsClusterSignature(items: NewsItem[]): string {
    let hash = 2166136261;
    for (const item of items) {
      const payload = `${item.source}|${item.link || item.title}|${item.pubDate.getTime()}`;
      for (let i = 0; i < payload.length; i++) {
        hash ^= payload.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    }
    return `${items.length}:${hash >>> 0}`;
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics, digest?: ListFeedDigestResponse | null): Promise<NewsItem[]> {
    try {
      const panel = this.ctx.newsPanels[category];

      const enabledFeeds = (feeds ?? []).filter(f => !this.ctx.disabledSources.has(f.name));
      if (enabledFeeds.length === 0) {
        delete this.ctx.newsByCategory[category];
        if (panel) panel.showError(t('common.allSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }
      const enabledNames = new Set(enabledFeeds.map(f => f.name));

      // Digest branch: server already aggregated feeds — map proto items to client types
      if (digest?.categories && category in digest.categories) {
        let items = (digest.categories[category]?.items ?? [])
          .map(protoItemToNewsItem)
          .filter(i => enabledNames.has(i.source));

        ingestHeadlines(items.map(i => ({ title: i.title, pubDate: i.pubDate, source: i.source, link: i.link })));

        const aiCandidates = items
          .filter(i => i.threat?.source === 'keyword')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
          .slice(0, AI_CLASSIFY_MAX_PER_FEED);
        for (const item of aiCandidates) {
          if (!canQueueAiClassification(item.title)) continue;
          classifyWithAI(item.title, SITE_VARIANT).then(ai => {
            if (ai && item.threat && ai.confidence > item.threat.confidence) {
              item.threat = ai;
              item.isAlert = ai.level === 'critical' || ai.level === 'high';
            }
          }).catch(() => {});
        }

        checkBatchForBreakingAlerts(items);
        this.flashMapForNews(items);
        this.renderNewsForCategory(category, items);

        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: items.length,
        });

        if (panel) {
          try {
            const baseline = await updateBaseline(`news:${category}`, items.length);
            const deviation = calculateDeviation(items.length, baseline);
            panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
          } catch (e) { console.warn(`[Baseline] news:${category} write failed:`, e); }
        }

        return items;
      }

      // Per-feed fallback: fetch each feed individually (first load or digest unavailable)
      const renderIntervalMs = 100;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      const flushPendingRender = () => {
        if (!pendingItems) return;
        this.renderNewsForCategory(category, pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        pendingItems = partialItems;
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      const staleItems = this.getStaleNewsItems(category).filter(i => enabledNames.has(i.source));
      if (staleItems.length > 0) {
        console.warn(`[News] Digest missing for "${category}", serving stale headlines (${staleItems.length})`);
        this.renderNewsForCategory(category, staleItems);
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: staleItems.length,
        });
        return staleItems;
      }

      if (!this.isPerFeedFallbackEnabled()) {
        console.warn(`[News] Digest missing for "${category}", limited per-feed fallback disabled`);
        this.renderNewsForCategory(category, []);
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'error',
          errorMessage: 'Digest unavailable',
        });
        return [];
      }

      const fallbackFeeds = this.selectLimitedFeeds(enabledFeeds, this.perFeedFallbackCategoryFeedLimit);
      if (fallbackFeeds.length < enabledFeeds.length) {
        console.warn(`[News] Digest missing for "${category}", using limited per-feed fallback (${fallbackFeeds.length}/${enabledFeeds.length} feeds)`);
      } else {
        console.warn(`[News] Digest missing for "${category}", using per-feed fallback (${fallbackFeeds.length} feeds)`);
      }

      const items = await fetchCategoryFeeds(fallbackFeeds, {
        batchSize: this.perFeedFallbackBatchSize,
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          this.flashMapForNews(partialItems);
          checkBatchForBreakingAlerts(partialItems);
        },
      });

      this.renderNewsForCategory(category, items);
      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }

        if (items.length === 0) {
          const failures = getFeedFailures();
          const failedFeeds = fallbackFeeds.filter(f => failures.has(f.name));
          if (failedFeeds.length > 0) {
            const names = failedFeeds.map(f => f.name).join(', ');
            panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
          }
        }

        try {
          const baseline = await updateBaseline(`news:${category}`, items.length);
          const deviation = calculateDeviation(items.length, baseline);
          panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) { console.warn(`[Baseline] news:${category} write failed:`, e); }
      }

      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'ok',
        itemCount: items.length,
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

      return items;
    } catch (error) {
      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      delete this.ctx.newsByCategory[category];
      return [];
    }
  }

  async loadNews(): Promise<void> {
    // Reset happy variant accumulator for fresh pipeline run
    if (SITE_VARIANT === 'happy') {
      this.ctx.happyAllItems = [];
    }

    // Fire digest fetch early (non-blocking) — await before category loop
    const digestPromise = this.tryFetchDigest();

    const categories = Object.entries(FEEDS)
      .filter((entry): entry is [string, typeof FEEDS[keyof typeof FEEDS]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([key, feeds]) => ({ key, feeds }));

    const digest = await digestPromise;

    const maxCategoryConcurrency = SITE_VARIANT === 'tech' ? 4 : 5;
    const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
    const categoryResults: PromiseSettledResult<NewsItem[]>[] = [];
    for (let i = 0; i < categories.length; i += categoryConcurrency) {
      const chunk = categories.slice(i, i + categoryConcurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map(({ key, feeds }) => this.loadNewsCategory(key, feeds, digest))
      );
      categoryResults.push(...chunkResults);
    }

    const collectedNews: NewsItem[] = [];
    categoryResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const items = result.value;
        // Tag items with content categories for happy variant
        if (SITE_VARIANT === 'happy') {
          for (const item of items) {
            item.happyCategory = classifyNewsItem(item.source, item.title);
          }
          // Accumulate curated items for the positive news pipeline
          this.ctx.happyAllItems = this.ctx.happyAllItems.concat(items);
        }
        collectedNews.push(...items);
      } else {
        console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
      }
    });

    if (SITE_VARIANT === 'full') {
      const enabledIntelSources = INTEL_SOURCES.filter(f => !this.ctx.disabledSources.has(f.name));
      const enabledIntelNames = new Set(enabledIntelSources.map(f => f.name));
      const intelPanel = this.ctx.newsPanels['intel'];
      if (enabledIntelSources.length === 0) {
        delete this.ctx.newsByCategory['intel'];
        if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      } else if (digest?.categories && 'intel' in digest.categories) {
        // Digest branch for intel
        const intel = (digest.categories['intel']?.items ?? [])
          .map(protoItemToNewsItem)
          .filter(i => enabledIntelNames.has(i.source));
        checkBatchForBreakingAlerts(intel);
        this.renderNewsForCategory('intel', intel);
        if (intelPanel) {
          try {
            const baseline = await updateBaseline('news:intel', intel.length);
            const deviation = calculateDeviation(intel.length, baseline);
            intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
          } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
        }
        this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
        collectedNews.push(...intel);
        this.flashMapForNews(intel);
      } else {
        const staleIntel = this.getStaleNewsItems('intel').filter(i => enabledIntelNames.has(i.source));
        if (staleIntel.length > 0) {
          console.warn(`[News] Intel digest missing, serving stale headlines (${staleIntel.length})`);
          this.renderNewsForCategory('intel', staleIntel);
          if (intelPanel) {
            try {
              const baseline = await updateBaseline('news:intel', staleIntel.length);
              const deviation = calculateDeviation(staleIntel.length, baseline);
              intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
            } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
          }
          this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: staleIntel.length });
          collectedNews.push(...staleIntel);
        } else if (!this.isPerFeedFallbackEnabled()) {
          console.warn('[News] Intel digest missing, limited per-feed fallback disabled');
          delete this.ctx.newsByCategory['intel'];
          this.ctx.statusPanel?.updateFeed('Intel', { status: 'error', errorMessage: 'Digest unavailable' });
        } else {
          const fallbackIntelFeeds = this.selectLimitedFeeds(enabledIntelSources, this.perFeedFallbackIntelFeedLimit);
          if (fallbackIntelFeeds.length < enabledIntelSources.length) {
            console.warn(`[News] Intel digest missing, using limited per-feed fallback (${fallbackIntelFeeds.length}/${enabledIntelSources.length} feeds)`);
          }

          const intelResult = await Promise.allSettled([
            fetchCategoryFeeds(fallbackIntelFeeds, { batchSize: this.perFeedFallbackBatchSize }),
          ]);
          if (intelResult[0]?.status === 'fulfilled') {
            const intel = intelResult[0].value;
            checkBatchForBreakingAlerts(intel);
            this.renderNewsForCategory('intel', intel);
            if (intelPanel) {
              try {
                const baseline = await updateBaseline('news:intel', intel.length);
                const deviation = calculateDeviation(intel.length, baseline);
                intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
              } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
            }
            this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
            collectedNews.push(...intel);
            this.flashMapForNews(intel);
          } else {
            delete this.ctx.newsByCategory['intel'];
            console.error('[App] Intel feed failed:', intelResult[0]?.reason);
          }
        }
      }
    }

    this.ctx.allNews = collectedNews;
    this.ctx.initialLoadComplete = true;
    mountCommunityWidget();
    updateAndCheck([
      { type: 'news', region: 'global', count: collectedNews.length },
    ]).then(anomalies => {
      if (anomalies.length > 0) {
        signalAggregator.ingestTemporalAnomalies(anomalies);
        ingestTemporalAnomaliesForCII(anomalies);
        this.scheduleCiiRefresh();
      }
    }).catch(() => { });

    const mapEnabled = this.ctx.panelSettings.map?.enabled !== false;
    const shouldUpdateMapNewsOverlays = mapEnabled && this.ctx.mapLayers.hotspots;
    if (shouldUpdateMapNewsOverlays) {
      this.withMapBatch(() => {
        this.ctx.map?.updateHotspotActivity(this.ctx.allNews);
      });
    }

    this.updateMonitorResults();

    try {
      this.ctx.latestClusters = await this.clusterNewsForDashboard(this.ctx.allNews);

      if (this.ctx.latestClusters.length > 0) {
        const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
        insightsPanel?.updateInsights(this.ctx.latestClusters);
      }

      const geoLocated = this.ctx.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map(c => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
          timestamp: c.lastUpdated,
        }));
      if (shouldUpdateMapNewsOverlays && geoLocated.length > 0) {
        this.withMapBatch(() => {
          this.ctx.map?.setNewsLocations(geoLocated);
        });
      }
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
    }

    // Happy variant: run multi-stage positive news pipeline + map layers
    if (SITE_VARIANT === 'happy') {
      await this.loadHappySupplementaryAndRender();
      await Promise.allSettled([
        this.ctx.mapLayers.positiveEvents ? this.loadPositiveEvents() : Promise.resolve(),
        this.ctx.mapLayers.kindness ? Promise.resolve(this.loadKindnessData()) : Promise.resolve(),
      ]);
    }
  }

  async loadMarkets(): Promise<void> {
    try {
      const stocksResult = await fetchMultipleStocks(MARKET_SYMBOLS, {
        onBatch: (partialStocks) => {
          this.ctx.latestMarkets = partialStocks;
          (this.ctx.panels['markets'] as MarketPanel).renderMarkets(partialStocks);
        },
      });

      const finnhubConfigMsg = 'FINNHUB_API_KEY not configured — add in Settings';
      this.ctx.latestMarkets = stocksResult.data;
      (this.ctx.panels['markets'] as MarketPanel).renderMarkets(stocksResult.data, stocksResult.rateLimited);

      if (stocksResult.rateLimited && stocksResult.data.length === 0) {
        const rlMsg = 'Market data temporarily unavailable (rate limited) — retrying shortly';
        this.ctx.panels['commodities']?.showError(rlMsg);
      } else if (stocksResult.skipped) {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
        if (stocksResult.data.length === 0) {
          this.ctx.panels['markets']?.showConfigError(finnhubConfigMsg);
        }
      } else {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'ok' });
      }

      // Sector heatmap: always attempt loading regardless of market rate-limit status
      const hydratedSectors = getHydratedData('sectors') as GetSectorSummaryResponse | undefined;
      if (hydratedSectors?.sectors?.length) {
        const mapped = hydratedSectors.sectors.map((s) => ({ name: s.name, change: s.change }));
        (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(mapped);
      } else if (!stocksResult.skipped) {
        const sectorsResult = await fetchMultipleStocks(
          SECTORS.map((s) => ({ ...s, display: s.name })),
          {
            onBatch: (partialSectors) => {
              (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
                partialSectors.map((s) => ({ name: s.name, change: s.change }))
              );
            },
          }
        );
        (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
          sectorsResult.data.map((s) => ({ name: s.name, change: s.change }))
        );
      } else {
        this.ctx.panels['heatmap']?.showConfigError(finnhubConfigMsg);
      }

      const commoditiesPanel = this.ctx.panels['commodities'] as CommoditiesPanel;
      const mapCommodity = (c: MarketData) => ({ display: c.display, price: c.price, change: c.change, sparkline: c.sparkline });

      let commoditiesLoaded = false;
      if (!(stocksResult.rateLimited && stocksResult.data.length === 0)) {
        const commoditiesResult = await fetchMultipleStocks(COMMODITIES, {
          onBatch: (partial) => commoditiesPanel.renderCommodities(partial.map(mapCommodity)),
        });
        const mapped = commoditiesResult.data.map(mapCommodity);
        if (mapped.some(d => d.price !== null)) {
          commoditiesPanel.renderCommodities(mapped);
          commoditiesLoaded = true;
        }
      }
      if (!commoditiesLoaded) {
        commoditiesPanel.renderCommodities([]);
      }
    } catch {
      this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }

    try {
      const crypto = await fetchCrypto();
      (this.ctx.panels['crypto'] as CryptoPanel).renderCrypto(crypto);
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: crypto.length > 0 ? 'ok' : 'error' });
    } catch {
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: 'error' });
    }
  }

  async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions();
      this.ctx.latestPredictions = predictions;
      (this.ctx.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);
      dataFreshness.recordUpdate('predictions', predictions.length);

      void this.runCorrelationAnalysis();
    } catch (error) {
      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
      dataFreshness.recordError('predictions', String(error));
    }
  }

  async loadNatural(): Promise<void> {
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    if (earthquakeResult.status === 'fulfilled') {
      this.ctx.intelligenceCache.earthquakes = earthquakeResult.value;
      ingestEarthquakes(earthquakeResult.value);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      this.ctx.intelligenceCache.earthquakes = [];
      this.ctx.statusPanel?.updateApi('USGS', { status: 'error' });
      dataFreshness.recordError('usgs', String(earthquakeResult.reason));
    }

    if (eonetResult.status === 'fulfilled') {
      this.ctx.statusPanel?.updateFeed('EONET', {
        status: 'ok',
        itemCount: eonetResult.value.length,
      });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
    } else {
      this.ctx.statusPanel?.updateFeed('EONET', { status: 'error', errorMessage: String(eonetResult.reason) });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'error' });
    }

    const hasEarthquakes = earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
    const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
    this.withMapBatch(() => {
      this.ctx.map?.setEarthquakes(earthquakeResult.status === 'fulfilled' ? earthquakeResult.value : []);
      this.ctx.map?.setNaturalEvents(eonetResult.status === 'fulfilled' ? eonetResult.value : []);
      this.ctx.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
    });
  }

  async loadTechEvents(): Promise<void> {
    if (SITE_VARIANT !== 'tech' && !this.ctx.mapLayers.techEvents) {
      return;
    }

    try {
      const client = new ResearchServiceClient('', { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
      const data = await client.listTechEvents({
        type: 'conference',
        mappable: true,
        days: 90,
        limit: 50,
      });
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const now = new Date();
      const mapEvents = data.events.map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords?.lat ?? 0,
        lng: e.coords?.lng ?? 0,
        country: e.coords?.country ?? '',
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      this.withMapBatch(() => {
        this.ctx.map?.setTechEvents(mapEvents);
        this.ctx.map?.setLayerReady('techEvents', mapEvents.length > 0);
      });
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

      if (SITE_VARIANT === 'tech' && this.ctx.searchModal) {
        this.ctx.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
          id: e.id,
          title: e.title,
          subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          data: e,
        })));
      }
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.withMapBatch(() => {
        this.ctx.map?.setTechEvents([]);
        this.ctx.map?.setLayerReady('techEvents', false);
      });
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
    }
  }

  async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      this.withMapBatch(() => {
        this.ctx.map?.setWeatherAlerts(alerts);
        this.ctx.map?.setLayerReady('weather', alerts.length > 0);
      });
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
      dataFreshness.recordUpdate('weather', alerts.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('weather', false);
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'error' });
      dataFreshness.recordError('weather', String(error));
    }
  }

  async loadIntelligenceSignals(): Promise<void> {
    const needsCoreIntel = this.isAnyPanelVisible(['cii', 'strategic-risk', 'strategic-posture', 'forensics']);
    const needsOutages = this.ctx.mapLayers.outages || needsCoreIntel;
    const needsProtests = this.ctx.mapLayers.protests || needsCoreIntel || this.isAnyPanelVisible(['ucdp-events', 'population-exposure']);
    const needsMilitary = this.ctx.mapLayers.military || needsCoreIntel || this.isPanelEnabledAndVisible('strategic-posture');
    const needsUcdpEvents = this.ctx.mapLayers.ucdpEvents || needsCoreIntel || this.isAnyPanelVisible(['ucdp-events', 'population-exposure']);
    const needsDisplacement = this.ctx.mapLayers.displacement || needsCoreIntel || this.isPanelEnabledAndVisible('displacement');
    const needsClimate = this.ctx.mapLayers.climate || needsCoreIntel || this.isPanelEnabledAndVisible('climate');
    const needsAdvisories = needsCoreIntel || this.isPanelEnabledAndVisible('security-advisories');
    const needsTelegram = needsCoreIntel || this.isPanelEnabledAndVisible('telegram-intel');
    const needsOref = needsCoreIntel || this.isPanelEnabledAndVisible('oref-sirens');
    const needsGpsJamming = this.ctx.mapLayers.gpsJamming || needsCoreIntel;
    const needsPopulationExposure = this.isPanelEnabledAndVisible('population-exposure');
    this.updateOrefDemand(needsOref);

    const tasks: Promise<void>[] = [];

    if (needsOutages) tasks.push((async () => {
      try {
        const outages = await fetchInternetOutages();
        this.ctx.intelligenceCache.outages = outages;
        ingestOutagesForCII(outages);
        signalAggregator.ingestOutages(outages);
        dataFreshness.recordUpdate('outages', outages.length);
        if (this.ctx.mapLayers.outages) {
          this.withMapBatch(() => {
            this.ctx.map?.setOutages(outages);
            this.ctx.map?.setLayerReady('outages', outages.length > 0);
          });
          this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
        }
      } catch (error) {
        console.error('[Intelligence] Outages fetch failed:', error);
        dataFreshness.recordError('outages', String(error));
      }
    })());

    const protestsTask: Promise<SocialUnrestEvent[]> = needsProtests ? (async (): Promise<SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.ctx.intelligenceCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForCII(protestData.events);
        signalAggregator.ingestProtests(protestData.events);
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
        if (this.ctx.mapLayers.protests) {
          this.withMapBatch(() => {
            this.ctx.map?.setProtests(protestData.events);
            this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
          });
          const status = getProtestStatus();
          this.ctx.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Intelligence] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })() : Promise.resolve([]);
    if (needsProtests) tasks.push(protestsTask.then(() => undefined));

    if (needsCoreIntel) tasks.push((async () => {
      try {
        const conflictData = await fetchConflictEvents();
        ingestConflictsForCII(conflictData.events);
        if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
      } catch (error) {
        console.error('[Intelligence] Conflict events fetch failed:', error);
        dataFreshness.recordError('acled_conflict', String(error));
      }
    })());

    if (needsCoreIntel) tasks.push((async () => {
      try {
        const classifications = await fetchUcdpClassifications();
        ingestUcdpForCII(classifications);
        if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
      } catch (error) {
        console.error('[Intelligence] UCDP fetch failed:', error);
        dataFreshness.recordError('ucdp', String(error));
      }
    })());

    if (needsCoreIntel) tasks.push((async () => {
      try {
        const summaries = await fetchHapiSummary();
        ingestHapiForCII(summaries);
        if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
      } catch (error) {
        console.error('[Intelligence] HAPI fetch failed:', error);
        dataFreshness.recordError('hapi', String(error));
      }
    })());

    if (needsMilitary) tasks.push((async () => {
      try {
        if (isMilitaryVesselTrackingConfigured()) {
          initMilitaryVesselStream();
        }
        const [flightData, vesselData] = await Promise.all([
          fetchMilitaryFlights(),
          fetchMilitaryVessels(),
        ]);
        this.ctx.intelligenceCache.military = {
          flights: flightData.flights,
          flightClusters: flightData.clusters,
          vessels: vesselData.vessels,
          vesselClusters: vesselData.clusters,
        };
        fetchUSNIFleetReport().then((report) => {
          if (report) this.ctx.intelligenceCache.usniFleet = report;
        }).catch(() => {});
        ingestFlights(flightData.flights);
        ingestVessels(vesselData.vessels);
        ingestMilitaryForCII(flightData.flights, vesselData.vessels);
        signalAggregator.ingestFlights(flightData.flights);
        signalAggregator.ingestVessels(vesselData.vessels);
        dataFreshness.recordUpdate('opensky', flightData.flights.length);
        updateAndCheck([
          { type: 'military_flights', region: 'global', count: flightData.flights.length },
          { type: 'vessels', region: 'global', count: vesselData.vessels.length },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
            ingestTemporalAnomaliesForCII(anomalies);
            this.scheduleCiiRefresh();
          }
        }).catch(() => { });
        if (this.ctx.mapLayers.military) {
          this.withMapBatch(() => {
            this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
            this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
            this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
          });
          const militaryCount = flightData.flights.length + vesselData.vessels.length;
          this.ctx.statusPanel?.updateFeed('Military', {
            status: militaryCount > 0 ? 'ok' : 'warning',
            itemCount: militaryCount,
          });
        }
        if (!isInLearningMode()) {
          const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
          if (surgeAlerts.length > 0) {
            const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
            addToSignalHistory(surgeSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
          }
          const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
          if (foreignAlerts.length > 0) {
            const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
            addToSignalHistory(foreignSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
          }
        }
      } catch (error) {
        console.error('[Intelligence] Military fetch failed:', error);
        dataFreshness.recordError('opensky', String(error));
      }
    })());

    if (needsUcdpEvents) tasks.push((async () => {
      try {
        const protestEvents = await protestsTask;
        const result = await fetchUcdpEvents();
        if (!result.success) {
          dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
          return;
        }
        const acledEvents = protestEvents.map(e => ({
          latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
        }));
        const events = deduplicateAgainstAcled(result.data, acledEvents);
        (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.setEvents(events);
        if (this.ctx.mapLayers.ucdpEvents) {
          this.withMapBatch(() => {
            this.ctx.map?.setUcdpEvents(events);
          });
        }
        if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
      } catch (error) {
        console.error('[Intelligence] UCDP events fetch failed:', error);
        dataFreshness.recordError('ucdp_events', String(error));
      }
    })());

    if (needsDisplacement) tasks.push((async () => {
      try {
        const unhcrResult = await fetchUnhcrPopulation();
        if (!unhcrResult.ok) {
          dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
          return;
        }
        const data = unhcrResult.data;
        (this.ctx.panels['displacement'] as DisplacementPanel)?.setData(data);
        ingestDisplacementForCII(data.countries);
        if (this.ctx.mapLayers.displacement && data.topFlows) {
          this.withMapBatch(() => {
            this.ctx.map?.setDisplacementFlows(data.topFlows);
          });
        }
        if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
      } catch (error) {
        console.error('[Intelligence] UNHCR displacement fetch failed:', error);
        dataFreshness.recordError('unhcr', String(error));
      }
    })());

    if (needsClimate) tasks.push((async () => {
      try {
        const climateResult = await fetchClimateAnomalies();
        if (!climateResult.ok) {
          dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
          return;
        }
        const anomalies = climateResult.anomalies;
        (this.ctx.panels['climate'] as ClimateAnomalyPanel)?.setAnomalies(anomalies);
        ingestClimateForCII(anomalies);
        if (this.ctx.mapLayers.climate) {
          this.withMapBatch(() => {
            this.ctx.map?.setClimateAnomalies(anomalies);
          });
        }
        if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
      } catch (error) {
        console.error('[Intelligence] Climate anomalies fetch failed:', error);
        dataFreshness.recordError('climate', String(error));
      }
    })());

    // Security advisories
    if (needsAdvisories) tasks.push(this.loadSecurityAdvisories());

    // Telegram Intel
    if (needsTelegram) tasks.push(this.loadTelegramIntel());

    // OREF sirens
    if (needsOref) tasks.push((async () => {
      try {
        const data = await fetchOrefAlerts();
        this.handleOrefAlertsUpdate(data);
      } catch (error) {
        console.error('[Intelligence] OREF alerts fetch failed:', error);
      }
    })());

    // GPS/GNSS jamming
    if (needsGpsJamming) tasks.push((async () => {
      try {
        const data = await fetchGpsInterference();
        if (!data) {
          ingestGpsJammingForCII([]);
          this.ctx.map?.setLayerReady('gpsJamming', false);
          return;
        }
        ingestGpsJammingForCII(data.hexes);
        if (this.ctx.mapLayers.gpsJamming) {
          this.withMapBatch(() => {
            this.ctx.map?.setGpsJamming(data.hexes);
            this.ctx.map?.setLayerReady('gpsJamming', data.hexes.length > 0);
          });
        }
        this.ctx.statusPanel?.updateFeed('GPS Jam', { status: 'ok', itemCount: data.hexes.length });
        dataFreshness.recordUpdate('gpsjam', data.hexes.length);
      } catch (error) {
        this.ctx.map?.setLayerReady('gpsJamming', false);
        this.ctx.statusPanel?.updateFeed('GPS Jam', { status: 'error' });
        dataFreshness.recordError('gpsjam', String(error));
      }
    })());

    await Promise.allSettled(tasks);

    if (needsPopulationExposure) {
      try {
        const ucdpEvts = (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.getEvents?.() || [];
        const events = [
          ...(this.ctx.intelligenceCache.protests?.events || []).slice(0, 10).map(e => ({
            id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
          })),
          ...ucdpEvts.slice(0, 10).map(e => ({
            id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
          })),
        ];
        if (events.length > 0) {
          const exposures = await enrichEventsWithExposure(events);
          (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
          if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
        } else {
          (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures([]);
        }
      } catch (error) {
        console.error('[Intelligence] Population exposure fetch failed:', error);
        dataFreshness.recordError('worldpop', String(error));
      }
    }

    if (needsCoreIntel || this.isPanelEnabledAndVisible('cii')) {
      this.scheduleCiiRefresh();
    }
  }

  async loadOutages(): Promise<void> {
    if (this.ctx.intelligenceCache.outages) {
      const outages = this.ctx.intelligenceCache.outages;
      this.withMapBatch(() => {
        this.ctx.map?.setOutages(outages);
        this.ctx.map?.setLayerReady('outages', outages.length > 0);
      });
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.ctx.intelligenceCache.outages = outages;
      this.withMapBatch(() => {
        this.ctx.map?.setOutages(outages);
        this.ctx.map?.setLayerReady('outages', outages.length > 0);
      });
      ingestOutagesForCII(outages);
      signalAggregator.ingestOutages(outages);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('outages', false);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
      dataFreshness.recordError('outages', String(error));
    }
  }

  async loadCyberThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      this.ctx.mapLayers.cyberThreats = false;
      this.ctx.map?.setLayerReady('cyberThreats', false);
      return;
    }

    const cachedThreats = this.ctx.cyberThreatsCache;
    if (cachedThreats) {
      this.withMapBatch(() => {
        this.ctx.map?.setCyberThreats(cachedThreats);
        this.ctx.map?.setLayerReady('cyberThreats', cachedThreats.length > 0);
      });
      ingestCyberThreatsForCII(cachedThreats);
      this.scheduleCiiRefresh();
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: cachedThreats.length });
      return;
    }

    try {
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.ctx.cyberThreatsCache = threats;
      this.withMapBatch(() => {
        this.ctx.map?.setCyberThreats(threats);
        this.ctx.map?.setLayerReady('cyberThreats', threats.length > 0);
      });
      ingestCyberThreatsForCII(threats);
      this.scheduleCiiRefresh();
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: threats.length });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('cyberThreats', false);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'error' });
      dataFreshness.recordError('cyber_threats', String(error));
    }
  }

  async loadIranEvents(): Promise<void> {
    try {
      const events = await fetchIranEvents();
      this.ctx.intelligenceCache.iranEvents = events;
      this.withMapBatch(() => {
        this.ctx.map?.setIranEvents(events);
        this.ctx.map?.setLayerReady('iranAttacks', events.length > 0);
      });
      const coerced = events.map(e => ({ ...e, timestamp: Number(e.timestamp) || 0 }));
      signalAggregator.ingestConflictEvents(coerced);
      ingestStrikesForCII(coerced);
      this.scheduleCiiRefresh();
    } catch {
      this.ctx.map?.setLayerReady('iranAttacks', false);
    }
  }

  async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const aisStatus = getAisStatus();
      this.cachedAisDisruptions = disruptions;
      const hasData = disruptions.length > 0 || density.length > 0;
      this.withMapBatch(() => {
        this.ctx.map?.setAisData(disruptions, density);
        this.ctx.map?.setLayerReady('ais', hasData);
      });
      signalAggregator.ingestAisDisruptions(disruptions);
      ingestAisDisruptionsForCII(disruptions);
      this.scheduleCiiRefresh();
      updateAndCheck([
        { type: 'ais_gaps', region: 'global', count: disruptions.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) {
          signalAggregator.ingestTemporalAnomalies(anomalies);
          ingestTemporalAnomaliesForCII(anomalies);
          this.scheduleCiiRefresh();
        }
      }).catch(() => { });

      const shippingCount = disruptions.length + density.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
      this.ctx.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage: !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
      });
      this.ctx.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.ctx.map?.setLayerReady('ais', false);
      this.ctx.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      if (this.ctx.isDestroyed) return;
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.ctx.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.ctx.map?.setLayerLoading('ais', false);
        this.ctx.map?.setLayerReady('ais', false);
        this.ctx.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout'
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  async loadCableActivity(): Promise<void> {
    try {
      const activity = await fetchCableActivity();
      this.withMapBatch(() => {
        this.ctx.map?.setCableActivity(activity.advisories, activity.repairShips);
      });
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  async loadCableHealth(): Promise<void> {
    try {
      const healthData = await fetchCableHealth();
      this.withMapBatch(() => {
        this.ctx.map?.setCableHealth(healthData.cables);
      });
      const cableIds = Object.keys(healthData.cables);
      const faultCount = cableIds.filter((id) => healthData.cables[id]?.status === 'fault').length;
      const degradedCount = cableIds.filter((id) => healthData.cables[id]?.status === 'degraded').length;
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'ok', itemCount: faultCount + degradedCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'error' });
    }
  }

  async loadProtests(): Promise<void> {
    if (this.ctx.intelligenceCache.protests) {
      const protestData = this.ctx.intelligenceCache.protests;
      this.withMapBatch(() => {
        this.ctx.map?.setProtests(protestData.events);
        this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      });
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.ctx.intelligenceCache.protests = protestData;
      this.withMapBatch(() => {
        this.ctx.map?.setProtests(protestData.events);
        this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      });
      ingestProtests(protestData.events);
      ingestProtestsForCII(protestData.events);
      signalAggregator.ingestProtests(protestData.events);
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      this.scheduleCiiRefresh();
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('protests', false);
      this.ctx.statusPanel?.updateFeed('Protests', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('ACLED', { status: 'error' });
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'error' });
      dataFreshness.recordError('gdelt_doc', String(error));
    }
  }

  async loadFlightDelays(): Promise<void> {
    try {
      const delays = await fetchFlightDelays();
      this.withMapBatch(() => {
        this.ctx.map?.setFlightDelays(delays);
        this.ctx.map?.setLayerReady('flights', delays.length > 0);
      });
      this.ctx.intelligenceCache.flightDelays = delays;
      const severe = delays.filter(d => d.severity === 'major' || d.severity === 'severe' || d.delayType === 'closure');
      if (severe.length > 0) ingestAviationForCII(severe);
      this.ctx.statusPanel?.updateFeed('Flights', {
        status: 'ok',
        itemCount: delays.length,
      });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('flights', false);
      this.ctx.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'error' });
    }
  }

  async loadMilitary(): Promise<void> {
    if (this.ctx.intelligenceCache.military) {
      const { flights, flightClusters, vessels, vesselClusters } = this.ctx.intelligenceCache.military;
      const hasData = flights.length > 0 || vessels.length > 0;
      this.withMapBatch(() => {
        this.ctx.map?.setMilitaryFlights(flights, flightClusters);
        this.ctx.map?.setMilitaryVessels(vessels, vesselClusters);
        this.ctx.map?.updateMilitaryForEscalation(flights, vessels);
        this.ctx.map?.setLayerReady('military', hasData);
      });
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flights);
      const militaryCount = flights.length + vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      if (isMilitaryVesselTrackingConfigured()) {
        initMilitaryVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchMilitaryFlights(),
        fetchMilitaryVessels(),
      ]);
      this.ctx.intelligenceCache.military = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      fetchUSNIFleetReport().then((report) => {
        if (report) this.ctx.intelligenceCache.usniFleet = report;
      }).catch(() => {});
      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.withMapBatch(() => {
        this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
        this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
        this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
        this.ctx.map?.setLayerReady('military', hasData);
      });
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestMilitaryForCII(flightData.flights, vesselData.vessels);
      signalAggregator.ingestFlights(flightData.flights);
      signalAggregator.ingestVessels(vesselData.vessels);
      updateAndCheck([
        { type: 'military_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) {
          signalAggregator.ingestTemporalAnomalies(anomalies);
          ingestTemporalAnomaliesForCII(anomalies);
          this.scheduleCiiRefresh();
        }
      }).catch(() => { });
      this.scheduleCiiRefresh();
      if (!isInLearningMode()) {
        const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
        if (surgeAlerts.length > 0) {
          const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
          addToSignalHistory(surgeSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
        }
        const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
        if (foreignAlerts.length > 0) {
          const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
          addToSignalHistory(foreignSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
        }
      }

      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flightData.flights);
      const militaryCount = flightData.flights.length + vesselData.vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('military', false);
      this.ctx.statusPanel?.updateFeed('Military', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.callbacks.renderCriticalBanner(data.postures);
        const posturePanel = this.ctx.panels['strategic-posture'] as StrategicPosturePanel | undefined;
        posturePanel?.updatePostures(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }

  async loadFredData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
    if (cbInfo.onCooldown) {
      economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      economicPanel?.setLoading(true);
      const data = await fetchFredData();

      const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
      if (postInfo.onCooldown) {
        economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        if (!isFeatureAvailable('economicFred')) {
          economicPanel?.setErrorState(true, 'FRED_API_KEY not configured — add in Settings');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      economicPanel?.setErrorState(false);
      economicPanel?.update(data);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch {
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
      economicPanel?.setLoading(false);
    }
  }

  async loadOilAnalytics(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchOilAnalytics();
      economicPanel?.updateOil(data);
      const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
      this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        const metricCount = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(Boolean).length;
        dataFreshness.recordUpdate('oil', metricCount || 1);
      } else {
        dataFreshness.recordError('oil', 'Oil analytics returned no values');
      }
    } catch (e) {
      console.error('[App] Oil analytics failed:', e);
      this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
      dataFreshness.recordError('oil', String(e));
    }
  }

  async loadGovernmentSpending(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
      economicPanel?.updateSpending(data);
      this.ctx.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
      if (data.awards.length > 0) {
        dataFreshness.recordUpdate('spending', data.awards.length);
      } else {
        dataFreshness.recordError('spending', 'No awards returned');
      }
    } catch (e) {
      console.error('[App] Government spending failed:', e);
      this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
      dataFreshness.recordError('spending', String(e));
    }
  }

  async loadBisData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchBisData();
      economicPanel?.updateBis(data);
      const hasData = data.policyRates.length > 0;
      this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        dataFreshness.recordUpdate('bis', data.policyRates.length);
      }
    } catch (e) {
      console.error('[App] BIS data failed:', e);
      this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
      dataFreshness.recordError('bis', String(e));
    }
  }

  async loadTradePolicy(): Promise<void> {
    const tradePanel = this.ctx.panels['trade-policy'] as TradePolicyPanel | undefined;
    if (!tradePanel) return;

    try {
      const [restrictions, tariffs, flows, barriers] = await Promise.all([
        fetchTradeRestrictions([], 50),
        fetchTariffTrends('840', '156', '', 10),
        fetchTradeFlows('840', '156', 10),
        fetchTradeBarriers([], '', 50),
      ]);

      tradePanel.updateRestrictions(restrictions);
      tradePanel.updateTariffs(tariffs);
      tradePanel.updateFlows(flows);
      tradePanel.updateBarriers(barriers);

      const totalItems = restrictions.restrictions.length + tariffs.datapoints.length + flows.flows.length + barriers.barriers.length;
      const anyUnavailable = restrictions.upstreamUnavailable || tariffs.upstreamUnavailable || flows.upstreamUnavailable || barriers.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('WTO', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('wto_trade', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Trade policy failed:', e);
      this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
      dataFreshness.recordError('wto_trade', String(e));
    }
  }

  async loadSupplyChain(): Promise<void> {
    const scPanel = this.ctx.panels['supply-chain'] as SupplyChainPanel | undefined;
    if (!scPanel) return;

    try {
      const [shipping, chokepoints, minerals] = await Promise.allSettled([
        fetchShippingRates(),
        fetchChokepointStatus(),
        fetchCriticalMinerals(),
      ]);

      const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
      const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
      const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;

      if (shippingData) scPanel.updateShippingRates(shippingData);
      if (chokepointData) scPanel.updateChokepointStatus(chokepointData);
      if (mineralsData) scPanel.updateCriticalMinerals(mineralsData);

      const totalItems = (shippingData?.indices.length || 0) + (chokepointData?.chokepoints.length || 0) + (mineralsData?.minerals.length || 0);
      const anyUnavailable = shippingData?.upstreamUnavailable || chokepointData?.upstreamUnavailable || mineralsData?.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('SupplyChain', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('supply_chain', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Supply chain failed:', e);
      this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
      dataFreshness.recordError('supply_chain', String(e));
    }
  }

  updateMonitorResults(): void {
    const monitorPanel = this.ctx.panels['monitors'] as MonitorPanel;
    if (!monitorPanel || !this.isPanelEnabledAndVisible('monitors')) return;
    monitorPanel.renderResults(this.ctx.allNews);
  }

  async runCorrelationAnalysis(): Promise<void> {
    try {
      if (this.ctx.latestClusters.length === 0 && this.ctx.allNews.length > 0) {
        this.ctx.latestClusters = await this.clusterNewsForDashboard(this.ctx.allNews);
      }

      if (this.ctx.latestClusters.length > 0) {
        ingestNewsForCII(this.ctx.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.ctx.latestClusters.length);
        this.scheduleCiiRefresh();
      }

      const signals = await analysisWorker.analyzeCorrelations(
        this.ctx.latestClusters,
        this.ctx.latestPredictions,
        this.ctx.latestMarkets
      );

      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.ctx.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
      }

      const keywordSpikeSignals = drainTrendingSignals();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
        if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(allSignals);
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  async loadFirmsData(): Promise<void> {
    try {
      const fireResult = await fetchAllFires(1);
      if (fireResult.skipped) {
        this.ctx.panels['satellite-fires']?.showConfigError('NASA_FIRMS_API_KEY not configured — add in Settings');
        this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
        return;
      }
      const { regions, totalCount } = fireResult;
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const stats = computeRegionStats(regions);
        const satelliteFires = flat.map(f => ({
          lat: f.location?.latitude ?? 0,
          lon: f.location?.longitude ?? 0,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: new Date(f.detectedAt).toISOString().slice(0, 10),
        }));

        signalAggregator.ingestSatelliteFires(satelliteFires);
        ingestSatelliteFiresForCII(satelliteFires);
        this.scheduleCiiRefresh();

        this.withMapBatch(() => {
          this.ctx.map?.setFires(toMapFires(flat));
        });

        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

        dataFreshness.recordUpdate('firms', totalCount);

        updateAndCheck([
          { type: 'satellite_fires', region: 'global', count: totalCount },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
            ingestTemporalAnomaliesForCII(anomalies);
            this.scheduleCiiRefresh();
          }
        }).catch(() => { });
      } else {
        ingestSatelliteFiresForCII([]);
        this.scheduleCiiRefresh();
        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      }
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  async loadPizzInt(): Promise<void> {
    try {
      const [status, tensions] = await Promise.all([
        fetchPizzIntStatus(),
        fetchGdeltTensions()
      ]);

      if (status.locationsMonitored === 0) {
        this.ctx.pizzintIndicator?.hide();
        this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
        dataFreshness.recordError('pizzint', 'No monitored locations returned');
        return;
      }

      this.ctx.pizzintIndicator?.show();
      this.ctx.pizzintIndicator?.updateStatus(status);
      this.ctx.pizzintIndicator?.updateTensions(tensions);
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'ok' });
      dataFreshness.recordUpdate('pizzint', Math.max(status.locationsMonitored, tensions.length));
    } catch (error) {
      console.error('[App] PizzINT load failed:', error);
      this.ctx.pizzintIndicator?.hide();
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
      dataFreshness.recordError('pizzint', String(error));
    }
  }

  syncDataFreshnessWithLayers(): void {
    for (const [layer, sourceIds] of Object.entries(LAYER_TO_SOURCE)) {
      const enabled = this.ctx.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  private static readonly HAPPY_ITEMS_CACHE_KEY = 'happy-all-items';

  async hydrateHappyPanelsFromCache(): Promise<void> {
    try {
      type CachedItem = Omit<NewsItem, 'pubDate'> & { pubDate: number };
      const entry = await getPersistentCache<CachedItem[]>(DataLoaderManager.HAPPY_ITEMS_CACHE_KEY);
      if (!entry || !entry.data || entry.data.length === 0) return;
      if (Date.now() - entry.updatedAt > 24 * 60 * 60 * 1000) return;

      const items: NewsItem[] = entry.data.map(item => ({
        ...item,
        pubDate: new Date(item.pubDate),
      }));

      const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
      this.ctx.breakthroughsPanel?.setItems(
        items.filter(item => scienceSources.includes(item.source) || item.happyCategory === 'science-health')
      );
      this.ctx.heroPanel?.setHeroStory(
        items.filter(item => item.happyCategory === 'humanity-kindness')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0]
      );
      this.ctx.digestPanel?.setStories(
        [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()).slice(0, 5)
      );
      this.ctx.positivePanel?.renderPositiveNews(items);
    } catch (err) {
      console.warn('[App] Happy panel cache hydration failed:', err);
    }
  }

  private async loadHappySupplementaryAndRender(): Promise<void> {
    if (!this.ctx.positivePanel) return;

    const curated = [...this.ctx.happyAllItems];
    this.ctx.positivePanel.renderPositiveNews(curated);

    let supplementary: NewsItem[] = [];
    try {
      const gdeltTopics = await fetchAllPositiveTopicIntelligence();
      const gdeltItems: NewsItem[] = gdeltTopics.flatMap(topic =>
        topic.articles.map(article => ({
          source: 'GDELT',
          title: article.title,
          link: article.url,
          pubDate: article.date ? new Date(article.date) : new Date(),
          isAlert: false,
          imageUrl: article.image || undefined,
          happyCategory: classifyNewsItem('GDELT', article.title),
        }))
      );

      supplementary = await filterBySentiment(gdeltItems);
    } catch (err) {
      console.warn('[App] Happy supplementary pipeline failed, using curated only:', err);
    }

    if (supplementary.length > 0) {
      const merged = [...curated, ...supplementary];
      merged.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      this.ctx.positivePanel.renderPositiveNews(merged);
    }

    const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
    const scienceItems = this.ctx.happyAllItems.filter(item =>
      scienceSources.includes(item.source) || item.happyCategory === 'science-health'
    );
    this.ctx.breakthroughsPanel?.setItems(scienceItems);

    const heroItem = this.ctx.happyAllItems
      .filter(item => item.happyCategory === 'humanity-kindness')
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0];
    this.ctx.heroPanel?.setHeroStory(heroItem);

    const digestItems = [...this.ctx.happyAllItems]
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, 5);
    this.ctx.digestPanel?.setStories(digestItems);

    setPersistentCache(
      DataLoaderManager.HAPPY_ITEMS_CACHE_KEY,
      this.ctx.happyAllItems.map(item => ({ ...item, pubDate: item.pubDate.getTime() }))
    ).catch(() => {});
  }

  private async loadPositiveEvents(): Promise<void> {
    const gdeltEvents = await fetchPositiveGeoEvents();
    const rssEvents = geocodePositiveNewsItems(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        category: item.happyCategory,
      }))
    );
    const seen = new Set<string>();
    const merged = [...gdeltEvents, ...rssEvents].filter(e => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });
    this.withMapBatch(() => {
      this.ctx.map?.setPositiveEvents(merged);
    });
  }

  private loadKindnessData(): void {
    const kindnessItems = fetchKindnessData(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        happyCategory: item.happyCategory,
      }))
    );
    this.withMapBatch(() => {
      this.ctx.map?.setKindnessData(kindnessItems);
    });
  }

  private async loadProgressData(): Promise<void> {
    const datasets = await fetchProgressData();
    this.ctx.progressPanel?.setData(datasets);
  }

  private async loadSpeciesData(): Promise<void> {
    const species = await fetchConservationWins();
    this.ctx.speciesPanel?.setData(species);
    this.withMapBatch(() => {
      this.ctx.map?.setSpeciesRecoveryZones(species);
    });
    if (SITE_VARIANT === 'happy' && species.length > 0) {
      checkMilestones({
        speciesRecoveries: species.map(s => ({ name: s.commonName, status: s.recoveryStatus })),
        newSpeciesCount: species.length,
      });
    }
  }

  private async loadRenewableData(): Promise<void> {
    const data = await fetchRenewableEnergyData();
    this.ctx.renewablePanel?.setData(data);
    if (SITE_VARIANT === 'happy' && data?.globalPercentage) {
      checkMilestones({
        renewablePercent: data.globalPercentage,
      });
    }
    try {
      const capacity = await fetchEnergyCapacity();
      this.ctx.renewablePanel?.setCapacityData(capacity);
    } catch {
      // EIA failure does not break the existing World Bank gauge
    }
  }

  async loadSecurityAdvisories(): Promise<void> {
    try {
      const result = await fetchSecurityAdvisories();
      if (result.ok) {
        (this.ctx.panels['security-advisories'] as SecurityAdvisoriesPanel)?.setData(result.advisories);
        this.ctx.intelligenceCache.advisories = result.advisories;
        ingestAdvisoriesForCII(result.advisories);
      }
    } catch (error) {
      console.error('[App] Security advisories fetch failed:', error);
    }
  }

  async loadTelegramIntel(): Promise<void> {
    try {
      const result = await fetchTelegramFeed();
      (this.ctx.panels['telegram-intel'] as TelegramIntelPanel)?.setData(result);
    } catch (error) {
      console.error('[App] Telegram intel fetch failed:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // New signal layer loaders
  // ---------------------------------------------------------------------------

  async loadSarDetections(): Promise<void> {
    try {
      const data = await fetchSarDetections();
      this.cachedSarDetections = data;
      this.sarFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setSarDetections(data);
        this.ctx.map?.setLayerReady('sarDetections', data.length > 0);
      });
      signalAggregator.ingestSarDetections(data);
      dataFreshness.recordUpdate('sar_detections', data.length);
      this.ctx.statusPanel?.updateFeed('SAR Detections', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Global Fishing Watch', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('sarDetections', false);
      this.ctx.statusPanel?.updateFeed('SAR Detections', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Global Fishing Watch', { status: 'error' });
      dataFreshness.recordError('sar_detections', String(error));
    }
  }

  async loadPortCongestion(): Promise<void> {
    try {
      const data = await fetchPortCongestion();
      this.cachedPortCongestion = data as unknown as Record<string, unknown>[];
      this.portFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setPortCongestion(data);
        this.ctx.map?.setLayerReady('portCongestion', data.length > 0);
      });
      signalAggregator.ingestPortCongestion(data);
      dataFreshness.recordUpdate('port_congestion', data.length);
      this.ctx.statusPanel?.updateFeed('Port Congestion', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Portcast', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('portCongestion', false);
      this.ctx.statusPanel?.updateFeed('Port Congestion', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Portcast', { status: 'error' });
      dataFreshness.recordError('port_congestion', String(error));
    }
  }

  async loadGridZones(): Promise<void> {
    try {
      const data = await fetchGridStatus();
      this.cachedGridZones = data;
      this.gridFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setGridZones(data);
        this.ctx.map?.setLayerReady('gridZones', data.length > 0);
      });
      signalAggregator.ingestGridZones(data);
      dataFreshness.recordUpdate('grid_zones', data.length);
      this.ctx.statusPanel?.updateFeed('Grid Stress', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Electricity Maps', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('gridZones', false);
      this.ctx.statusPanel?.updateFeed('Grid Stress', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Electricity Maps', { status: 'error' });
      dataFreshness.recordError('grid_zones', String(error));
    }
  }

  async loadRoutingAnomalies(): Promise<void> {
    try {
      const data = await fetchRoutingAnomalies();
      this.cachedRoutingAnomalies = data;
      this.routingFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setRoutingAnomalies(data);
        this.ctx.map?.setLayerReady('routingAnomalies', data.length > 0);
      });
      signalAggregator.ingestRoutingAnomalies(data);
      dataFreshness.recordUpdate('routing_anomalies', data.length);
      this.ctx.statusPanel?.updateFeed('BGP Anomalies', { status: 'ok', itemCount: data.length });
    } catch (error) {
      this.ctx.map?.setLayerReady('routingAnomalies', false);
      this.ctx.statusPanel?.updateFeed('BGP Anomalies', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('routing_anomalies', String(error));
    }
  }

  async loadRadiationReadings(): Promise<void> {
    try {
      const data = await fetchRadiationReadings();
      this.cachedRadiationReadings = data;
      this.radiationFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setRadiationReadings(data);
        this.ctx.map?.setLayerReady('radiationReadings', data.length > 0);
      });
      signalAggregator.ingestRadiationReadings(data);
      dataFreshness.recordUpdate('radiation_readings', data.length);
      this.ctx.statusPanel?.updateFeed('Radiation', { status: 'ok', itemCount: data.length });
    } catch (error) {
      this.ctx.map?.setLayerReady('radiationReadings', false);
      this.ctx.statusPanel?.updateFeed('Radiation', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('radiation_readings', String(error));
    }
  }

  async loadAirQualityReadings(): Promise<void> {
    try {
      const data = await fetchAirQualityReadings();
      this.cachedAirQualityReadings = data;
      this.aqiFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setAirQualityReadings(data);
        this.ctx.map?.setLayerReady('airQuality', data.length > 0);
      });
      signalAggregator.ingestAirQualityReadings(data);
      dataFreshness.recordUpdate('air_quality', data.length);
      this.ctx.statusPanel?.updateFeed('Air Quality', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('WAQI', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('airQuality', false);
      this.ctx.statusPanel?.updateFeed('Air Quality', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('WAQI', { status: 'error' });
      dataFreshness.recordError('air_quality', String(error));
    }
  }

  async loadDeforestationAlerts(): Promise<void> {
    try {
      const data = await fetchDeforestationAlerts();
      this.cachedDeforestationAlerts = data;
      this.deforestationFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setDeforestationAlerts(data);
        this.ctx.map?.setLayerReady('deforestationAlerts', data.length > 0);
      });
      signalAggregator.ingestDeforestationAlerts(data);
      dataFreshness.recordUpdate('deforestation_alerts', data.length);
      this.ctx.statusPanel?.updateFeed('Deforestation', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Global Forest Watch', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('deforestationAlerts', false);
      this.ctx.statusPanel?.updateFeed('Deforestation', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Global Forest Watch', { status: 'error' });
      dataFreshness.recordError('deforestation_alerts', String(error));
    }
  }

  async loadAcarsMessages(): Promise<void> {
    try {
      const data = await fetchAcarsMessages();
      this.cachedAcarsMessages = data as unknown as Record<string, unknown>[];
      this.acarsFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setAcarsMessages(data);
        this.ctx.map?.setLayerReady('acarsMessages', data.length > 0);
      });
      signalAggregator.ingestAcarsMessages(data);
      dataFreshness.recordUpdate('acars_messages', data.length);
      this.ctx.statusPanel?.updateFeed('ACARS Messages', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Airframes', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('acarsMessages', false);
      this.ctx.statusPanel?.updateFeed('ACARS Messages', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Airframes', { status: 'error' });
      dataFreshness.recordError('acars_messages', String(error));
    }
  }

  async loadWhaleTransfers(): Promise<void> {
    try {
      const data = await fetchWhaleTransfers();
      this.cachedWhaleTransfers = data;
      this.whaleFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setWhaleTransfers(data);
        this.ctx.map?.setLayerReady('whaleTransfers', data.length > 0);
      });
      signalAggregator.ingestWhaleTransfers(data);
      dataFreshness.recordUpdate('whale_transfers', data.length);
      this.ctx.statusPanel?.updateFeed('Whale Transfers', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Whale Alert', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('whaleTransfers', false);
      this.ctx.statusPanel?.updateFeed('Whale Transfers', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Whale Alert', { status: 'error' });
      dataFreshness.recordError('whale_transfers', String(error));
    }
  }

  async loadNavWarnings(): Promise<void> {
    try {
      const data = await fetchNavWarnings();
      this.cachedNavWarnings = data;
      this.navFetchedAt = Date.now();
      this.withMapBatch(() => {
        this.ctx.map?.setNavWarnings(data);
        this.ctx.map?.setLayerReady('navWarnings', data.length > 0);
      });
      signalAggregator.ingestNavWarnings(data);
      dataFreshness.recordUpdate('nav_warnings', data.length);
      this.ctx.statusPanel?.updateFeed('Nav Warnings', { status: 'ok', itemCount: data.length });
    } catch (error) {
      this.ctx.map?.setLayerReady('navWarnings', false);
      this.ctx.statusPanel?.updateFeed('Nav Warnings', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('nav_warnings', String(error));
    }
  }

  async loadConflictIncidents(): Promise<void> {
    try {
      const data = await fetchConflictIncidents();
      this.cachedConflictIncidents = data;
      this.withMapBatch(() => {
        this.ctx.map?.setConflictIncidents(data);
        this.ctx.map?.setLayerReady('conflictIncidents', data.length > 0);
      });
      signalAggregator.ingestConflictIncidents(data);
      dataFreshness.recordUpdate('conflict_incidents', data.length);
      this.ctx.statusPanel?.updateFeed('Liveuamap', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Liveuamap', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('conflictIncidents', false);
      this.ctx.statusPanel?.updateFeed('Liveuamap', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Liveuamap', { status: 'error' });
      dataFreshness.recordError('conflict_incidents', String(error));
    }
  }

  async loadPollutionGrid(): Promise<void> {
    try {
      // Use a global bounding box for initial load or get from map
      const data = await fetchPollutionGrid(-60, 80, -180, 180);
      this.cachedPollutionGrid = data;
      this.withMapBatch(() => {
        this.ctx.map?.setPollutionGrid(data);
        this.ctx.map?.setLayerReady('pollutionGrid', data.length > 0);
      });
      signalAggregator.ingestPollutionGrid(data);
      dataFreshness.recordUpdate('pollution_grid', data.length);
      this.ctx.statusPanel?.updateFeed('Pollution Grid', { status: 'ok', itemCount: data.length });
      this.ctx.statusPanel?.updateApi('Sentinel Hub', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('pollutionGrid', false);
      this.ctx.statusPanel?.updateFeed('Pollution Grid', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Sentinel Hub', { status: 'error' });
      dataFreshness.recordError('pollution_grid', String(error));
    }
  }

  async loadRepoMomentum(): Promise<void> {
    try {
      const data = await fetchRepoMomentum();
      signalAggregator.ingestRepoMomentum(data);
      dataFreshness.recordUpdate('repo_momentum', data.length);
      this.ctx.statusPanel?.updateApi('GitHub', { status: 'ok' });
      this.ctx.statusPanel?.updateFeed('GitHub Momentum', { status: 'ok', itemCount: data.length });
    } catch (error) {
      this.ctx.statusPanel?.updateApi('GitHub', { status: 'error' });
      this.ctx.statusPanel?.updateFeed('GitHub Momentum', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('repo_momentum', String(error));
    }
  }

  async loadSocialTrends(): Promise<void> {
    try {
      const data = await fetchSocialTrends();
      signalAggregator.ingestSocialTrends(data);
      dataFreshness.recordUpdate('social_trends', data.length);
      this.ctx.statusPanel?.updateFeed('Social Trends', { status: 'ok', itemCount: data.length });
    } catch (error) {
      this.ctx.statusPanel?.updateFeed('Social Trends', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('social_trends', String(error));
    }
  }

  async loadSpaceWeather(): Promise<void> {
    try {
      const result = await getSpaceWeather();
      const status = result.status;
      if (status) {
        this.ctx.intelligenceCache.spaceWeather = status;
        this.withMapBatch(() => {
          this.ctx.map?.setSpaceWeather(status);
        });
        dataFreshness.recordUpdate('space_weather', 1);
      }
    } catch {
      // Space weather is best-effort — no error propagation needed
    }
  }

  async loadForensics(): Promise<void> {
    try {
      if (!this.isPanelEnabledAndVisible('forensics')) return;
      const panel = this.ctx.panels['forensics'] as ForensicsPanel | undefined;
      if (!panel) return;

      const now = Date.now();
      const ctx = {
        aisDisruptions: this.cachedAisDisruptions,
        predictions: this.ctx.latestPredictions,
        markets: this.ctx.latestMarkets,
        macroSignals: null,
        etfFlows: null,
        stablecoins: null,
        fredSeries: [],
        oilAnalytics: null,
        conflictFetchedAt: now,
        ucdpFetchedAt: now,
        hapiFetchedAt: now,
        displacementFetchedAt: now,
        climateFetchedAt: now,
        macroFetchedAt: 0,
        etfFetchedAt: 0,
        stablecoinFetchedAt: 0,
        fredFetchedAt: 0,
        oilFetchedAt: 0,
        routingAnomalies: this.cachedRoutingAnomalies,
        gridZones: this.cachedGridZones,
        sarDetections: this.cachedSarDetections,
        portCongestion: this.cachedPortCongestion,
        acarsMessages: this.cachedAcarsMessages,
        whaleTransfers: this.cachedWhaleTransfers,
        airQualityReadings: this.cachedAirQualityReadings,
        radiationReadings: this.cachedRadiationReadings,
        deforestationAlerts: this.cachedDeforestationAlerts,
        conflictIncidents: this.cachedConflictIncidents,
        pollutionGrid: this.cachedPollutionGrid,
        navWarnings: this.cachedNavWarnings,
        spaceWeather: this.ctx.intelligenceCache.spaceWeather ?? null,
        routingFetchedAt: this.routingFetchedAt,
        gridFetchedAt: this.gridFetchedAt,
        sarFetchedAt: this.sarFetchedAt,
        portFetchedAt: this.portFetchedAt,
        radiationFetchedAt: this.radiationFetchedAt,
        deforestationFetchedAt: this.deforestationFetchedAt,
        acarsFetchedAt: this.acarsFetchedAt,
        whaleFetchedAt: this.whaleFetchedAt,
        aqiFetchedAt: this.aqiFetchedAt,
        navFetchedAt: this.navFetchedAt,
        spaceFetchedAt: this.ctx.intelligenceCache.spaceWeather ? now : 0,
      };

      const builder = new ForensicsSignalBuilder(ctx);
      const signals = [
        ...builder.buildIntelligenceSignals(),
        ...builder.buildMarketSignals(),
      ];

      if (signals.length === 0) return;

      const shadowResult = await runForensicsShadow('global', signals);

      const [runsResult, policyResult, topologyResult] = await Promise.allSettled([
        listForensicsRuns('global', '', 20),
        getForensicsPolicy('global'),
        getForensicsTopologySummary(shadowResult.run?.runId ?? '', 'global', { anomaliesOnly: true, alertLimit: 20 }),
      ]);

      const runs = runsResult.status === 'fulfilled' ? runsResult.value.runs : [];
      const policy = policyResult.status === 'fulfilled' ? policyResult.value.entries : [];
      const topologyResult_ = topologyResult.status === 'fulfilled' ? topologyResult.value : null;
      const topologyAlerts = topologyResult_?.alerts ?? [];
      const topologyBaselines = topologyResult_?.baselines ?? [];

      const latestRun = runs[0];

      panel.update({
        summary: latestRun,
        fusedSignals: shadowResult.fusedSignals,
        anomalies: shadowResult.anomalies,
        causalEdges: shadowResult.causalEdges,
        monitorStreams: [],
        aisTrajectoryStreams: [],
        topologyAlerts,
        topologyTrends: [],
        topologyWindowDrilldowns: [],
        topologyDrifts: [],
        topologyBaselines,
        trace: shadowResult.trace,
        policy,
        runHistory: runs.map(r => ({
          runId: r.run?.runId ?? '',
          domain: r.run?.domain ?? 'global',
          completedAt: r.run?.completedAt ?? 0,
          anomalyFlaggedCount: r.anomalyFlaggedCount,
          minPValue: r.minPValue,
          maxFusedScore: r.maxFusedScore,
        })),
        anomalyTrends: [],
        error: shadowResult.error || undefined,
      });
    } catch (err) {
      console.error('[Forensics] loadForensics failed:', err);
    }
  }
}
