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

  it('adds forensics panel defaults for full and finance variants', () => {
    assert.match(panelConfigSrc, /forensics:\s*\{\s*name:\s*'Forensics Signals'/);
  });

  it('exports and defines the forensics panel component', () => {
    assert.match(componentIndexSrc, /ForensicsPanel/);
    assert.match(panelSrc, /export class ForensicsPanel extends Panel/);
    assert.match(panelSrc, /forensics-grid/);
    assert.match(panelSrc, /forensics-trend-grid/);
    assert.match(panelSrc, /Topology Trends/);
    assert.match(panelSrc, /Topology Baselines/);
    assert.match(panelSrc, /data-forensics-anomaly-key/);
    assert.match(panelSrc, /Provenance links/);
    assert.match(panelSrc, /Topological Alerts/);
    assert.match(panelSrc, /Calibrated Anomalies/);
  });

  it('wires forensics panel loading and scheduled refresh in App', () => {
    assert.match(appSrc, /const forensicsPanel = new ForensicsPanel/);
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
    assert.match(appSrc, /topologyTrends:/);
    assert.match(appSrc, /topologyAlerts:/);
    assert.match(appSrc, /topologyBaselines:/);
    assert.match(appSrc, /tasks\.push\(\{ name: 'forensics'/);
    assert.match(appSrc, /scheduleRefresh\('forensics', \(\) => this\.loadForensicsPanel\(\), 5 \* 60 \* 1000\)/);
  });
});

describe('Forensics map overlay integration', () => {
  const appSrc = readSrc('src/App.ts');
  const deckSrc = readSrc('src/components/DeckGLMap.ts');
  const popupSrc = readSrc('src/components/MapPopup.ts');
  const mapContainerSrc = readSrc('src/components/MapContainer.ts');
  const panelConfigSrc = readSrc('src/config/panels.ts');

  it('builds and applies map overlay anomalies from calibrated runs', () => {
    assert.match(appSrc, /buildForensicsMapAnomalies/);
    assert.match(appSrc, /applyForensicsMapOverlay/);
    assert.match(appSrc, /classifyForensicsMonitor/);
    assert.match(appSrc, /resolveMarketSourceCoordinate/);
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
    assert.match(mapContainerSrc, /setForensicsAnomalies/);
  });

  it('enables map-layer defaults for forensics in full and finance variants', () => {
    assert.match(panelConfigSrc, /const FULL_MAP_LAYERS:[\s\S]*?forensics:\s*true/);
    assert.match(panelConfigSrc, /const FINANCE_MAP_LAYERS:[\s\S]*?forensics:\s*true/);
  });
});

describe('Operational signal integration', () => {
  const appSrc = readSrc('src/App.ts');
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
    assert.match(appSrc, /buildIntelligenceForensicsSignals/);
    assert.match(appSrc, /buildMarketForensicsSignals/);
    assert.match(appSrc, /runForensicsShadow\(domain, signals, alpha\)/);
    assert.match(appSrc, /signalAggregator\.ingestTemporalAnomalies\(derivedAnomalies\)/);
  });

  it('feeds cyber and AIS data into operational forensics path', () => {
    assert.match(appSrc, /signalAggregator\.ingestCyberThreats\(threats\)/);
    assert.match(appSrc, /signalAggregator\.ingestAisDisruptions\(disruptions\)/);
  });
});
