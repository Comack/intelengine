import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const readSrc = (relPath) => readFileSync(resolve(root, relPath), 'utf-8');

describe('Intelligence forensics contracts', () => {
  const serviceProto = readSrc('proto/worldmonitor/intelligence/v1/service.proto');
  const forensicsProto = readSrc('proto/worldmonitor/intelligence/v1/forensics.proto');

  it('declares new forensics RPCs on IntelligenceService', () => {
    assert.match(serviceProto, /rpc\s+RunForensicsShadow/);
    assert.match(serviceProto, /rpc\s+ListFusedSignals/);
    assert.match(serviceProto, /rpc\s+ListCalibratedAnomalies/);
    assert.match(serviceProto, /rpc\s+GetForensicsTrace/);
    assert.match(serviceProto, /rpc\s+GetForensicsRun/);
    assert.match(serviceProto, /rpc\s+ListForensicsRuns/);
    assert.match(serviceProto, /rpc\s+GetForensicsPolicy/);
    assert.match(serviceProto, /rpc\s+GetForensicsTopologySummary/);
  });

  it('declares HTTP route paths for new RPCs', () => {
    assert.match(serviceProto, /path:\s*"\/run-forensics-shadow"/);
    assert.match(serviceProto, /path:\s*"\/list-fused-signals"/);
    assert.match(serviceProto, /path:\s*"\/list-calibrated-anomalies"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-trace"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-run"/);
    assert.match(serviceProto, /path:\s*"\/list-forensics-runs"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-policy"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-topology-summary"/);
  });

  it('declares richer calibrated anomaly diagnostics and run summary model', () => {
    assert.match(forensicsProto, /calibration_count/);
    assert.match(forensicsProto, /calibration_center/);
    assert.match(forensicsProto, /nonconformity/);
    assert.match(forensicsProto, /p_value_value/);
    assert.match(forensicsProto, /p_value_timing/);
    assert.match(forensicsProto, /timing_nonconformity/);
    assert.match(forensicsProto, /interval_ms/);
    assert.match(forensicsProto, /observed_at/);
    assert.match(forensicsProto, /message\s+ForensicsRunSummary/);
    assert.match(forensicsProto, /message\s+ForensicsPolicyEntry/);
  });
});

describe('Intelligence forensics handler wiring', () => {
  const handlerSrc = readSrc('server/worldmonitor/intelligence/v1/handler.ts');

  it('wires forensics handlers in intelligenceHandler', () => {
    assert.match(handlerSrc, /runForensicsShadow/);
    assert.match(handlerSrc, /listFusedSignals/);
    assert.match(handlerSrc, /listCalibratedAnomalies/);
    assert.match(handlerSrc, /getForensicsTrace/);
    assert.match(handlerSrc, /getForensicsRun/);
    assert.match(handlerSrc, /listForensicsRuns/);
    assert.match(handlerSrc, /getForensicsPolicy/);
    assert.match(handlerSrc, /getForensicsTopologySummary/);
  });
});

describe('Forensics orchestrator safety and fallback', () => {
  const orchestratorSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-orchestrator.ts');

  it('contains worker endpoint calls with local fallback execution', () => {
    assert.match(orchestratorSrc, /\/internal\/forensics\/v1\/fuse/);
    assert.match(orchestratorSrc, /\/internal\/forensics\/v1\/anomaly/);
    assert.match(orchestratorSrc, /runWeakSupervisionFusion/);
    assert.match(orchestratorSrc, /runConformalAnomalies/);
  });

  it('uses dependency-aware weak supervision fusion', () => {
    assert.match(orchestratorSrc, /dependencyPenalty/);
    assert.match(orchestratorSrc, /classPrior/);
    assert.match(orchestratorSrc, /propensities/);
    assert.match(orchestratorSrc, /weightedCorrelation/);
  });

  it('persists completed or failed runs to blackboard', () => {
    assert.match(orchestratorSrc, /saveForensicsRun/);
    assert.match(orchestratorSrc, /status:\s*'completed'/);
    assert.match(orchestratorSrc, /status:\s*'failed'/);
  });

  it('records conformal diagnostics for each anomaly', () => {
    assert.match(orchestratorSrc, /calibrationCount/);
    assert.match(orchestratorSrc, /calibrationCenter/);
    assert.match(orchestratorSrc, /nonconformity/);
    assert.match(orchestratorSrc, /pValueValue/);
    assert.match(orchestratorSrc, /pValueTiming/);
    assert.match(orchestratorSrc, /timingNonconformity/);
    assert.match(orchestratorSrc, /intervalMs/);
    assert.match(orchestratorSrc, /observedAt:\s*Math\.max\(0,\s*Math\.round\(signal\.observedAt/);
    assert.match(orchestratorSrc, /Bonferroni/);
  });

  it('implements dynamic policy selection and Q-value updates', () => {
    assert.match(orchestratorSrc, /FORENSICS_DYNAMIC_POLICY/);
    assert.match(orchestratorSrc, /selectPolicyOrder/);
    assert.match(orchestratorSrc, /updatePolicyValue/);
    assert.match(orchestratorSrc, /policy-select/);
  });

  it('forwards shared-secret auth header to worker when configured', () => {
    assert.match(orchestratorSrc, /FORENSICS_WORKER_SHARED_SECRET/);
    assert.match(orchestratorSrc, /X-Forensics-Worker-Secret/);
  });

  it('derives topology labeling signals before fusion/anomaly execution', () => {
    assert.match(orchestratorSrc, /topology-tda/);
    assert.match(orchestratorSrc, /deriveFinancialTopologySignals/);
    assert.match(orchestratorSrc, /enrichTopologySignalsWithBaseline/);
    assert.match(orchestratorSrc, /upsertTopologyBaselineEntry/);
    assert.match(orchestratorSrc, /_baseline_delta/);
    assert.match(orchestratorSrc, /enrichedSignals/);
    assert.match(orchestratorSrc, /signals: enrichedSignals/);
  });
});

describe('Financial topology derivation', () => {
  const topologySrc = readSrc('server/worldmonitor/intelligence/v1/financial-topology.ts');
  const blackboardSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-blackboard.ts');

  it('generates topology-focused TDA signals and diagnostics', () => {
    assert.match(topologySrc, /topology_tsi/);
    assert.match(topologySrc, /topology_beta1/);
    assert.match(topologySrc, /topology_cycle_risk/);
    assert.match(topologySrc, /topology_degree_centrality/);
    assert.match(topologySrc, /topology_cycle_membership/);
    assert.match(topologySrc, /betaSeries/);
    assert.match(topologySrc, /deriveFinancialTopologySignals/);
  });

  it('persists topology baseline rows for calibration by domain and region', () => {
    assert.match(blackboardSrc, /ForensicsTopologyBaselineEntry/);
    assert.match(blackboardSrc, /TOPOLOGY_BASELINE_KEY_PREFIX/);
    assert.match(blackboardSrc, /upsertTopologyBaselineEntry/);
    assert.match(blackboardSrc, /getTopologyBaselineEntry/);
    assert.match(blackboardSrc, /listTopologyBaselineEntries/);
  });
});

describe('Temporal baseline calibrated anomaly integration', () => {
  const baselineSrc = readSrc('src/services/temporal-baseline.ts');

  it('guards calibrated path behind runtime flag and calls forensics shadow RPC', () => {
    assert.match(baselineSrc, /VITE_ENABLE_CALIBRATED_ANOMALIES/);
    assert.match(baselineSrc, /forensicsClient\.runForensicsShadow/);
  });
});

describe('Forensics list endpoint filters', () => {
  const fusedHandler = readSrc('server/worldmonitor/intelligence/v1/list-fused-signals.ts');
  const anomalyHandler = readSrc('server/worldmonitor/intelligence/v1/list-calibrated-anomalies.ts');

  it('applies fused signal filters for region/score/probability', () => {
    assert.match(fusedHandler, /req\.region/);
    assert.match(fusedHandler, /req\.minScore/);
    assert.match(fusedHandler, /req\.minProbability/);
  });

  it('applies anomaly filters for signal type/region/pvalue/zscore', () => {
    assert.match(anomalyHandler, /req\.signalType/);
    assert.match(anomalyHandler, /req\.region/);
    assert.match(anomalyHandler, /req\.maxPValue/);
    assert.match(anomalyHandler, /req\.minAbsLegacyZScore/);
    assert.match(anomalyHandler, /signalType\.endsWith\('\*'\)/);
    assert.match(anomalyHandler, /startsWith\('topology_'\)/);
  });
});

describe('Internal forensics worker endpoint', () => {
  const workerRoute = readSrc('api/internal/forensics/v1/[task].ts');

  it('supports fuse and anomaly tasks with shared normalization logic', () => {
    assert.match(workerRoute, /segment === 'fuse'/);
    assert.match(workerRoute, /segment === 'anomaly'/);
    assert.match(workerRoute, /normalizeSignals/);
    assert.match(workerRoute, /runWeakSupervisionFusion/);
    assert.match(workerRoute, /runConformalAnomalies/);
  });

  it('enforces worker shared secret in protected mode', () => {
    assert.match(workerRoute, /FORENSICS_WORKER_SHARED_SECRET/);
    assert.match(workerRoute, /X-Forensics-Worker-Secret/);
  });
});

describe('Forensics UI integration', () => {
  const appSrc = readSrc('src/App.ts');
  const panelConfigSrc = readSrc('src/config/panels.ts');
  const componentIndexSrc = readSrc('src/components/index.ts');
  const panelSrc = readSrc('src/components/ForensicsPanel.ts');

  it('adds forensics panel defaults for full, tech, and finance variants', () => {
    assert.match(panelConfigSrc, /forensics:\s*\{\s*name:\s*'Forensics Signals'/);
    assert.match(panelConfigSrc, /const TECH_PANELS:[\s\S]*?forensics:\s*\{\s*name:\s*'Forensics Signals'/);
  });

  it('exports and defines the forensics panel component', () => {
    assert.match(componentIndexSrc, /ForensicsPanel/);
    assert.match(panelSrc, /export class ForensicsPanel extends Panel/);
    assert.match(panelSrc, /forensics-grid/);
    assert.match(panelSrc, /forensics-trend-grid/);
    assert.match(panelSrc, /forensics-monitor-grid/);
    assert.match(panelSrc, /forensics-trajectory-grid/);
    assert.match(panelSrc, /forensics-drift-grid/);
    assert.match(panelSrc, /Monitor Streams/);
    assert.match(panelSrc, /AIS Trajectory Streams/);
    assert.match(panelSrc, /Topology Trends/);
    assert.match(panelSrc, /Topology Window Drilldowns/);
    assert.match(panelSrc, /Topology Drift Diagnostics/);
    assert.match(panelSrc, /Topology Baselines/);
    assert.match(panelSrc, /data-forensics-anomaly-key/);
    assert.match(panelSrc, /Provenance links/);
    assert.match(panelSrc, /Topological Alerts/);
    assert.match(panelSrc, /Calibrated Anomalies/);
  });

  it('wires forensics panel loading and scheduled refresh in App', () => {
    assert.match(appSrc, /const forensicsPanel = new ForensicsPanel/);
    assert.match(appSrc, /forensicsPanel\.setOnAnomalySelected/);
    assert.match(appSrc, /this\.panels\['forensics'\] = forensicsPanel/);
    assert.match(appSrc, /private async loadForensicsPanel\(\): Promise<void>/);
    assert.match(appSrc, /const historyLimit = 10/);
    assert.match(appSrc, /runHistory:/);
    assert.match(appSrc, /anomalyTrends:/);
    assert.match(appSrc, /listCalibratedAnomalies\(trendRunId, '', false, 80\)/);
    assert.match(appSrc, /getForensicsTopologySummary\(runId, policyDomain,/);
    assert.match(appSrc, /topologySummaryResult\.alerts/);
    assert.match(appSrc, /topologySummaryResult\.trends/);
    assert.match(appSrc, /topologySummaryResult\.baselines/);
    assert.match(appSrc, /buildTopologyWindowDrilldowns/);
    assert.match(appSrc, /buildTopologyDriftDiagnostics/);
    assert.match(appSrc, /buildForensicsMonitorStreams/);
    assert.match(appSrc, /buildAisTrajectoryStreams/);
    assert.match(appSrc, /monitorStreams:/);
    assert.match(appSrc, /aisTrajectoryStreams:/);
    assert.match(appSrc, /topologyTrends:/);
    assert.match(appSrc, /topologyWindowDrilldowns:/);
    assert.match(appSrc, /topologyDrifts:/);
    assert.match(appSrc, /topologyAlerts:/);
    assert.match(appSrc, /topologyBaselines:/);
    assert.match(appSrc, /tasks\.push\(\{ name: 'forensics'/);
    assert.match(appSrc, /scheduleRefresh\('forensics', \(\) => this\.loadForensicsPanel\(\), 5 \* 60 \* 1000\)/);
  });
});

describe('Forensics map overlay integration', () => {
  const appSrc = readSrc('src/App.ts');
  const builderSrc = readSrc('src/services/forensics-signal-builder.ts');
  const deckSrc = readSrc('src/components/DeckGLMap.ts');
  const popupSrc = readSrc('src/components/MapPopup.ts');
  const mapContainerSrc = readSrc('src/components/MapContainer.ts');
  const panelConfigSrc = readSrc('src/config/panels.ts');

  it('builds and applies map overlay anomalies from calibrated runs', () => {
    assert.match(appSrc, /buildForensicsMapAnomalies/);
    assert.match(appSrc, /applyForensicsMapOverlay/);
    assert.match(appSrc, /classifyForensicsMonitor/);
    assert.match(appSrc, /resolveForensicsAnomalyFreshness/);
    assert.match(appSrc, /anomaly\.observedAt/);
    assert.match(builderSrc, /resolveMarketSourceCoordinate/);
    assert.match(appSrc, /monitorCategory:\s*monitor\.category/);
    assert.match(appSrc, /isNearLive/);
    assert.match(appSrc, /this\.map\?\.setForensicsAnomalies\(overlay\)/);
    assert.match(appSrc, /this\.map\?\.setLayerReady\('forensics', overlay\.length > 0\)/);
  });

  it('adds forensics anomaly deck layer and popup wiring', () => {
    assert.match(deckSrc, /forensics-anomalies-layer/);
    assert.match(deckSrc, /forensics-anomalies-pulse/);
    assert.match(deckSrc, /shouldPulseForensicsAnomaly/);
    assert.match(deckSrc, /hasRecentForensicsAnomaly/);
    assert.match(deckSrc, /setForensicsAnomalies/);
    assert.match(deckSrc, /'forensics-anomalies-layer': 'forensicsAnomaly'/);
    assert.match(popupSrc, /forensicsAnomaly/);
    assert.match(popupSrc, /renderForensicsAnomalyPopup/);
    assert.match(popupSrc, /Monitor focus/);
    assert.match(popupSrc, /Freshness/);
    assert.match(popupSrc, /Trajectory class/);
    assert.match(popupSrc, /Interpretation/);
    assert.match(mapContainerSrc, /setForensicsAnomalies/);
    assert.match(mapContainerSrc, /triggerForensicsAnomalyClick/);
    assert.match(deckSrc, /public triggerForensicsAnomalyClick\(id: string\)/);
  });

  it('enables map-layer defaults for forensics in full, tech, and finance variants', () => {
    assert.match(panelConfigSrc, /const FULL_MAP_LAYERS:[\s\S]*?forensics:\s*true/);
    assert.match(panelConfigSrc, /const TECH_MAP_LAYERS:[\s\S]*?forensics:\s*true/);
    assert.match(panelConfigSrc, /const FINANCE_MAP_LAYERS:[\s\S]*?forensics:\s*true/);
    assert.match(panelConfigSrc, /const TECH_MOBILE_MAP_LAYERS:[\s\S]*?forensics:\s*false/);
  });
});

describe('Operational signal integration', () => {
  const appSrc = readSrc('src/App.ts');
  const builderSrc = readSrc('src/services/forensics-signal-builder.ts');
  const aggregatorSrc = readSrc('src/services/signal-aggregator.ts');
  const focalPointSrc = readSrc('src/services/focal-point-detector.ts');

  it('extends signal aggregator with cyber threat signal type and ingestion', () => {
    assert.match(aggregatorSrc, /'cyber_threat'/);
    assert.match(aggregatorSrc, /ingestCyberThreats/);
    assert.match(aggregatorSrc, /cyber threat indicators/);
  });

  it('supports cyber threat signal narrative in focal point detector', () => {
    assert.match(focalPointSrc, /cyber_threat:\s*'cyber threats'/);
    assert.match(focalPointSrc, /cyber_threat:\s*'🛡️'/);
    assert.match(focalPointSrc, /signals\.signalTypes\.has\('cyber_threat'\)/);
  });

  it('runs operational shadow forensics from intelligence and market data sources', () => {
    assert.match(appSrc, /runOperationalForensicsShadow\('intelligence'\)/);
    assert.match(appSrc, /runOperationalForensicsShadow\('market'\)/);
    assert.match(appSrc, /scope === 'market' && SITE_VARIANT !== 'finance' && SITE_VARIANT !== 'tech'/);
    assert.match(builderSrc, /buildIntelligenceSignals/);
    assert.match(builderSrc, /buildMarketSignals/);
    assert.match(appSrc, /runForensicsShadow\(domain, signals, alpha\)/);
    assert.match(appSrc, /signalAggregator\.ingestTemporalAnomalies\(derivedAnomalies\)/);
    assert.match(appSrc, /buildAisTrajectoryStreams/);
  });

  it('feeds cyber and AIS data into operational forensics path', () => {
    assert.match(appSrc, /signalAggregator\.ingestCyberThreats\(threats\)/);
    assert.match(appSrc, /signalAggregator\.ingestAisDisruptions\(disruptions\)/);
    assert.match(builderSrc, /classifyAisTrajectorySignal/);
    assert.match(builderSrc, /buildAisTrajectorySignals/);
    assert.match(builderSrc, /ais_route_deviation/);
    assert.match(builderSrc, /ais_loitering/);
    assert.match(builderSrc, /ais_silence/);
    assert.match(builderSrc, /sourceId\.match\(\/@/);
    assert.match(aggregatorSrc, /e\.observedAt/);
    assert.match(aggregatorSrc, /new Date\(observedAt\)/);
  });
});

describe('Forensics signal enrichment from in-app sources', () => {
  const appSrc = readSrc('src/App.ts');
  const builderSrc = readSrc('src/services/forensics-signal-builder.ts');
  const macroPanelSrc = readSrc('src/components/MacroSignalsPanel.ts');
  const etfPanelSrc = readSrc('src/components/ETFFlowsPanel.ts');
  const stablePanelSrc = readSrc('src/components/StablecoinPanel.ts');

  it('adds panel callback APIs for macro, ETF, and stablecoin snapshots', () => {
    assert.match(macroPanelSrc, /setOnDataUpdated\(cb/);
    assert.match(macroPanelSrc, /this\.onDataUpdated\?\.\(this\.data\)/);
    assert.match(etfPanelSrc, /setOnDataUpdated\(cb/);
    assert.match(etfPanelSrc, /this\.onDataUpdated\?\.\(this\.data\)/);
    assert.match(stablePanelSrc, /setOnDataUpdated\(cb/);
    assert.match(stablePanelSrc, /this\.onDataUpdated\?\.\(this\.data\)/);
    assert.match(appSrc, /this\.latestMacroSignals = data/);
    assert.match(appSrc, /this\.latestEtfFlows = data/);
    assert.match(appSrc, /this\.latestStablecoins = data/);
    assert.match(appSrc, /runOperationalForensicsShadow\('market'\)/);
  });

  it('builds tiered enrichment families for intelligence and market scopes', () => {
    assert.match(builderSrc, /buildCountryRiskSignals/);
    assert.match(builderSrc, /buildMacroSignals/);
    assert.match(builderSrc, /buildEtfSignals/);
    assert.match(builderSrc, /buildStablecoinSignals/);
    assert.match(builderSrc, /buildEconomicSignals/);
    assert.match(builderSrc, /conflict_event_burst/);
    assert.match(builderSrc, /ucdp_intensity/);
    assert.match(builderSrc, /hapi_political_violence/);
    assert.match(builderSrc, /displacement_outflow/);
    assert.match(builderSrc, /climate_stress/);
    assert.match(builderSrc, /macro_liquidity_extreme/);
    assert.match(builderSrc, /macro_flow_structure_divergence/);
    assert.match(builderSrc, /macro_regime_rotation/);
    assert.match(builderSrc, /macro_technical_dislocation/);
    assert.match(builderSrc, /macro_hashrate_volatility/);
    assert.match(builderSrc, /macro_fear_greed_extremity/);
    assert.match(builderSrc, /etf_flow_pressure/);
    assert.match(builderSrc, /etf_net_flow_pressure/);
    assert.match(builderSrc, /stablecoin_depeg_pressure/);
    assert.match(builderSrc, /stablecoin_systemic_stress/);
    assert.match(builderSrc, /fred_.*_delta_pct/);
    assert.match(builderSrc, /oil_.*_delta_pct/);
  });

  it('preserves variant guards and adds observed-time bucketing to shadow state keys', () => {
    assert.match(appSrc, /scope === 'intelligence' && SITE_VARIANT !== 'full'/);
    assert.match(appSrc, /scope === 'market' && SITE_VARIANT !== 'finance' && SITE_VARIANT !== 'tech'/);
    assert.match(appSrc, /bucketSignalTimestamp\(signal\.observedAt, 5 \* 60 \* 1000\)/);
  });
});

describe('Forensics cross-view integrations', () => {
  const appSrc = readSrc('src/App.ts');
  const insightsSrc = readSrc('src/components/InsightsPanel.ts');
  const riskPanelSrc = readSrc('src/components/StrategicRiskPanel.ts');
  const searchModalSrc = readSrc('src/components/SearchModal.ts');
  const signalModalSrc = readSrc('src/components/SignalModal.ts');
  const timelineSrc = readSrc('src/components/CountryTimeline.ts');
  const briefSrc = readSrc('src/components/CountryBriefPage.ts');

  it('wires forensics search type and search source indexing', () => {
    assert.match(searchModalSrc, /'forensics'/);
    assert.match(appSrc, /registerSource\('forensics'/);
    assert.match(appSrc, /case 'forensics':/);
  });

  it('adds country brief forensics diagnostics and map drilldown hooks', () => {
    assert.match(briefSrc, /setForensicsAnomalyClickHandler/);
    assert.match(briefSrc, /cb-forensics-section/);
    assert.match(appSrc, /setForensicsAnomalyClickHandler/);
    assert.match(appSrc, /focusForensicsOverlayById/);
    assert.match(appSrc, /getCountryForensicsSummary/);
  });

  it('adds forensics lane to country timeline rendering', () => {
    assert.match(timelineSrc, /'forensics'/);
    assert.match(appSrc, /lane: 'forensics'/);
  });

  it('adds forensics digest visualization to signal modal notifications', () => {
    assert.match(signalModalSrc, /showForensicsAnomalies/);
    assert.match(signalModalSrc, /FORENSICS DIGEST/);
    assert.match(signalModalSrc, /signal-forensics-severity/);
    assert.match(appSrc, /maybeShowForensicsSignalDigest/);
    assert.match(appSrc, /showForensicsAnomalies/);
  });

  it('propagates forensics overlays into insights and strategic risk panels', () => {
    assert.match(insightsSrc, /setForensicsAnomalies/);
    assert.match(insightsSrc, /renderForensicsWatchlist/);
    assert.match(insightsSrc, /setForensicsSelectHandler/);
    assert.match(riskPanelSrc, /setForensicsAnomalies/);
    assert.match(riskPanelSrc, /risk-item-forensics/);
    assert.match(appSrc, /insightsPanel\.setForensicsSelectHandler/);
    assert.match(appSrc, /insightsPanel\?\.setForensicsAnomalies\(overlay\)/);
    assert.match(appSrc, /strategicRiskPanel\?\.setForensicsAnomalies\(overlay\)/);
  });
});

describe('Market/prediction event-time fidelity', () => {
  const builderSrc = readSrc('src/services/forensics-signal-builder.ts');
  const marketSrc = readSrc('src/services/market/index.ts');
  const predictionSrc = readSrc('src/services/prediction/index.ts');
  const typesSrc = readSrc('src/types/index.ts');

  it('propagates observed timestamps from source services into forensics signal inputs', () => {
    assert.match(typesSrc, /interface MarketData[\s\S]*observedAt\?: number/);
    assert.match(marketSrc, /batchObservedAt = Date\.now\(\)/);
    assert.match(marketSrc, /observedAt,/);
    assert.match(predictionSrc, /interface PredictionMarket[\s\S]*observedAt\?: number/);
    assert.match(predictionSrc, /resolveObservedAt\(/);
    assert.match(builderSrc, /market\.observedAt/);
    assert.match(builderSrc, /prediction\.observedAt/);
    assert.match(builderSrc, /latestMarketObservedAt/);
    assert.match(builderSrc, /latestPredictionObservedAt/);
  });
});

describe('AIS disruption timestamp propagation', () => {
  const maritimeSrc = readSrc('src/services/maritime/index.ts');

  it('stamps disruption events with snapshot time for downstream freshness', () => {
    assert.match(maritimeSrc, /snapshotAt/);
    assert.match(maritimeSrc, /timestamp:\s*response\.snapshot\.snapshotAt/);
    assert.match(maritimeSrc, /observedAt:/);
  });
});

describe('Forensics topology map overlay', () => {
  const typesSrc = readSrc('src/types/index.ts');
  const appSrc = readSrc('src/App.ts');
  const deckSrc = readSrc('src/components/DeckGLMap.ts');
  const popupSrc = readSrc('src/components/MapPopup.ts');
  const mapContainerSrc = readSrc('src/components/MapContainer.ts');

  it('declares ForensicsTopologyWindowOverlay interface in types', () => {
    assert.match(typesSrc, /interface ForensicsTopologyWindowOverlay/);
    assert.match(typesSrc, /metric:\s*string/);
    assert.match(typesSrc, /delta:\s*number/);
    assert.match(typesSrc, /slope:\s*number/);
    assert.match(typesSrc, /shortMean:\s*number/);
    assert.match(typesSrc, /longMean:\s*number/);
  });

  it('builds and applies topology window map overlay in App', () => {
    assert.match(appSrc, /buildTopologyWindowMapOverlay/);
    assert.match(appSrc, /applyTopologyWindowMapOverlay/);
    assert.match(appSrc, /this\.map\?\.setTopologyWindowOverlay\(overlay\)/);
    assert.match(appSrc, /this\.applyTopologyWindowMapOverlay\(topologyWindowDrilldowns\)/);
    assert.match(appSrc, /this\.applyTopologyWindowMapOverlay\(\[\]\)/);
  });

  it('adds topology window scatter layer and popup wiring in DeckGLMap', () => {
    assert.match(deckSrc, /forensics-topology-window-layer/);
    assert.match(deckSrc, /setTopologyWindowOverlay/);
    assert.match(deckSrc, /createTopologyWindowLayer/);
    assert.match(deckSrc, /'forensics-topology-window-layer': 'forensicsTopologyWindow'/);
  });

  it('renders topology window popup in MapPopup', () => {
    assert.match(popupSrc, /forensicsTopologyWindow/);
    assert.match(popupSrc, /renderForensicsTopologyWindowPopup/);
    assert.match(popupSrc, /Topology Window/);
    assert.match(popupSrc, /Short mean/);
    assert.match(popupSrc, /Long mean/);
  });

  it('fans out topology window overlay through MapContainer', () => {
    assert.match(mapContainerSrc, /setTopologyWindowOverlay/);
    assert.match(mapContainerSrc, /ForensicsTopologyWindowOverlay/);
  });
});

describe('Causal discovery module', () => {
  const causalSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-causal.ts');

  it('exports runCausalDiscovery with key constants', () => {
    assert.match(causalSrc, /export function runCausalDiscovery/);
    assert.match(causalSrc, /BUCKET_MS/);
    assert.match(causalSrc, /CAUSAL_LOOKBACK_BUCKETS/);
    assert.match(causalSrc, /MIN_SUPPORT/);
  });

  it('computes conditionalLift and delayMs', () => {
    assert.match(causalSrc, /conditionalLift/);
    assert.match(causalSrc, /delayMs/);
    assert.match(causalSrc, /mdlGain/);
  });
});

describe('Causal discovery proto contracts', () => {
  const forensicsProto = readSrc('proto/worldmonitor/intelligence/v1/forensics.proto');
  const shadowProto = readSrc('proto/worldmonitor/intelligence/v1/run_forensics_shadow.proto');

  it('declares ForensicsCausalEdge and ForensicsCounterfactualLever messages', () => {
    assert.match(forensicsProto, /message ForensicsCausalEdge/);
    assert.match(forensicsProto, /message ForensicsCounterfactualLever/);
  });

  it('extends ForensicsCalibratedAnomaly with counterfactual_levers', () => {
    assert.match(forensicsProto, /counterfactual_levers/);
  });

  it('extends RunForensicsShadowResponse with causal_edges', () => {
    assert.match(shadowProto, /causal_edges/);
  });
});

describe('Hyperedge topology extension', () => {
  const topologySrc = readSrc('server/worldmonitor/intelligence/v1/financial-topology.ts');

  it('adds hyperedge detection function and constants', () => {
    assert.match(topologySrc, /detectCoordinationHyperedges/);
    assert.match(topologySrc, /HYPEREDGE_MIN_DISTINCT_DOMAINS/);
  });

  it('emits hyperedge-derived signals', () => {
    assert.match(topologySrc, /topology_hyperedge_density/);
    assert.match(topologySrc, /topology_cross_domain_sync/);
  });

  it('includes hyperedgeCount in diagnostics', () => {
    assert.match(topologySrc, /hyperedgeCount/);
  });
});

describe('Counterfactual lever computation', () => {
  const orchestratorSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-orchestrator.ts');
  const serviceSrc = readSrc('src/services/forensics.ts');
  const panelSrc = readSrc('src/components/ForensicsPanel.ts');

  it('computes counterfactual levers from learned weights', () => {
    assert.match(orchestratorSrc, /computeCounterfactualLevers/);
    assert.match(orchestratorSrc, /learnedWeights/);
  });

  it('adds causal-discovery phase to pipeline', () => {
    assert.match(orchestratorSrc, /causal-discovery/);
  });

  it('propagates causalEdges through service and panel', () => {
    assert.match(serviceSrc, /causalEdges/);
    assert.match(panelSrc, /buildCausalChainHtml/);
    assert.match(panelSrc, /buildCounterfactualLeversHtml/);
    assert.match(panelSrc, /causalEdges/);
  });
});

describe('Forensics phase trace graph', () => {
  const panelSrc = readSrc('src/components/ForensicsPanel.ts');
  const cssSrc = readSrc('src/styles/main.css');

  it('defines trace graph builder and phase constants', () => {
    assert.match(panelSrc, /buildTraceGraph/);
    assert.match(panelSrc, /forensics-trace-svg/);
    assert.match(panelSrc, /PHASE_DISPLAY_NAMES/);
    assert.match(panelSrc, /SWAPPABLE_PHASES/);
    assert.match(panelSrc, /ForensicsPhaseNode/);
  });

  it('uses correct status colors for phase bars', () => {
    assert.match(panelSrc, /#10b981/);
    assert.match(panelSrc, /#ef4444/);
    assert.match(panelSrc, /#64748b/);
    assert.match(panelSrc, /#334155/);
    assert.match(panelSrc, /#a78bfa/);
  });

  it('calls buildTraceGraph instead of flat rendering', () => {
    assert.match(panelSrc, /const phaseHtml = buildTraceGraph\(trace\)/);
    assert.doesNotMatch(panelSrc, /trace\.map\(\(phase\) => `\s*<div class="forensics-item">/);
  });

  it('adds forensics-trace-svg CSS rule', () => {
    assert.match(cssSrc, /\.forensics-trace-svg/);
    assert.match(cssSrc, /max-width:\s*100%/);
  });
});
