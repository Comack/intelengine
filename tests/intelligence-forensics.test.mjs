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
  const topologySummaryProto = readSrc('proto/worldmonitor/intelligence/v1/get_forensics_topology_summary.proto');

  it('declares forensics RPCs on IntelligenceService', () => {
    assert.match(serviceProto, /rpc\s+RunForensicsShadow/);
    assert.match(serviceProto, /rpc\s+ListFusedSignals/);
    assert.match(serviceProto, /rpc\s+ListCalibratedAnomalies/);
    assert.match(serviceProto, /rpc\s+GetForensicsTrace/);
    assert.match(serviceProto, /rpc\s+GetForensicsRun/);
    assert.match(serviceProto, /rpc\s+ListForensicsRuns/);
    assert.match(serviceProto, /rpc\s+GetForensicsPolicy/);
    assert.match(serviceProto, /rpc\s+GetForensicsTopologySummary/);
  });

  it('declares HTTP route paths for forensics RPCs', () => {
    assert.match(serviceProto, /path:\s*"\/run-forensics-shadow"/);
    assert.match(serviceProto, /path:\s*"\/list-fused-signals"/);
    assert.match(serviceProto, /path:\s*"\/list-calibrated-anomalies"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-trace"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-run"/);
    assert.match(serviceProto, /path:\s*"\/list-forensics-runs"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-policy"/);
    assert.match(serviceProto, /path:\s*"\/get-forensics-topology-summary"/);
  });

  it('keeps calibrated anomaly and policy/topology schema fields', () => {
    assert.match(forensicsProto, /calibration_count/);
    assert.match(forensicsProto, /calibration_center/);
    assert.match(forensicsProto, /nonconformity/);
    assert.match(forensicsProto, /p_value_value/);
    assert.match(forensicsProto, /p_value_timing/);
    assert.match(forensicsProto, /message\s+ForensicsRunSummary/);
    assert.match(forensicsProto, /message\s+ForensicsPolicyEntry/);
    assert.match(topologySummaryProto, /message\s+ForensicsTopologyBaselineSummary/);
  });
});

describe('Intelligence forensics server wiring', () => {
  const handlerSrc = readSrc('server/worldmonitor/intelligence/v1/handler.ts');
  const orchestratorSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-orchestrator.ts');
  const workerRoute = readSrc('api/internal/forensics/v1/[task].ts');

  it('wires all forensics handlers in intelligenceHandler', () => {
    assert.match(handlerSrc, /runForensicsShadow/);
    assert.match(handlerSrc, /listFusedSignals/);
    assert.match(handlerSrc, /listCalibratedAnomalies/);
    assert.match(handlerSrc, /getForensicsTrace/);
    assert.match(handlerSrc, /getForensicsRun/);
    assert.match(handlerSrc, /listForensicsRuns/);
    assert.match(handlerSrc, /getForensicsPolicy/);
    assert.match(handlerSrc, /getForensicsTopologySummary/);
  });

  it('supports worker fallback and local execution in orchestrator', () => {
    assert.match(orchestratorSrc, /\/internal\/forensics\/v1\/fuse/);
    assert.match(orchestratorSrc, /\/internal\/forensics\/v1\/anomaly/);
    assert.match(orchestratorSrc, /runWeakSupervisionFusion/);
    assert.match(orchestratorSrc, /runConformalAnomalies/);
    assert.match(orchestratorSrc, /saveForensicsRun/);
  });

  it('keeps dynamic policy and shared-secret hooks', () => {
    assert.match(orchestratorSrc, /FORENSICS_DYNAMIC_POLICY/);
    assert.match(orchestratorSrc, /selectPolicyOrder/);
    assert.match(orchestratorSrc, /updatePolicyValue/);
    assert.match(orchestratorSrc, /FORENSICS_WORKER_SHARED_SECRET/);
    assert.match(orchestratorSrc, /X-Forensics-Worker-Secret/);
  });

  it('worker endpoint supports fuse+anomaly tasks with normalization', () => {
    assert.match(workerRoute, /segment === 'fuse'/);
    assert.match(workerRoute, /segment === 'anomaly'/);
    assert.match(workerRoute, /normalizeSignals/);
    assert.match(workerRoute, /runWeakSupervisionFusion/);
    assert.match(workerRoute, /runConformalAnomalies/);
  });
});

describe('Forensics frontend integration (current architecture)', () => {
  const panelLayoutSrc = readSrc('src/app/panel-layout.ts');
  const dataLoaderSrc = readSrc('src/app/data-loader.ts');
  const forensicsServiceSrc = readSrc('src/services/forensics.ts');
  const panelSrc = readSrc('src/components/ForensicsPanel.ts');
  const componentIndexSrc = readSrc('src/components/index.ts');

  it('registers ForensicsPanel in panel layout', () => {
    assert.match(panelLayoutSrc, /const forensicsPanel = new ForensicsPanel\(\)/);
    assert.match(panelLayoutSrc, /this\.ctx\.panels\['forensics'\] = forensicsPanel/);
  });

  it('exports and defines ForensicsPanel snapshot fields', () => {
    assert.match(componentIndexSrc, /ForensicsPanel/);
    assert.match(panelSrc, /export interface ForensicsPanelSnapshot/);
    assert.match(panelSrc, /causalEdges\?: ForensicsCausalEdge\[\]/);
    assert.match(panelSrc, /topologyAlerts: ForensicsCalibratedAnomaly\[\]/);
    assert.match(panelSrc, /topologyBaselines: ForensicsTopologyBaselineSummary\[\]/);
    assert.match(panelSrc, /runHistory: ForensicsRunTrendPoint\[\]/);
    assert.match(panelSrc, /anomalyTrends: ForensicsAnomalyTrendSeries\[\]/);
  });

  it('loads forensics from DataLoader with builder + RPC pipeline', () => {
    assert.match(dataLoaderSrc, /new ForensicsSignalBuilder\(ctx\)/);
    assert.match(dataLoaderSrc, /builder\.buildIntelligenceSignals\(\)/);
    assert.match(dataLoaderSrc, /builder\.buildMarketSignals\(\)/);
    assert.match(dataLoaderSrc, /runForensicsShadow\('global', signals\)/);
    assert.match(dataLoaderSrc, /Promise\.allSettled\(\[/);
    assert.match(dataLoaderSrc, /listForensicsRuns\('global', '', 20\)/);
    assert.match(dataLoaderSrc, /getForensicsPolicy\('global'\)/);
    assert.match(dataLoaderSrc, /getForensicsTopologySummary\(/);
  });

  it('updates panel snapshot with fused/anomaly/causal/topology data', () => {
    assert.match(dataLoaderSrc, /panel\.update\(\{/);
    assert.match(dataLoaderSrc, /fusedSignals: shadowResult\.fusedSignals/);
    assert.match(dataLoaderSrc, /anomalies: shadowResult\.anomalies/);
    assert.match(dataLoaderSrc, /causalEdges: shadowResult\.causalEdges/);
    assert.match(dataLoaderSrc, /topologyAlerts/);
    assert.match(dataLoaderSrc, /topologyBaselines/);
    assert.match(dataLoaderSrc, /trace: shadowResult\.trace/);
    assert.match(dataLoaderSrc, /policy/);
    assert.match(dataLoaderSrc, /runHistory:/);
  });

  it('gates scheduled forensics loading to full variant + visible panel', () => {
    assert.match(dataLoaderSrc, /SITE_VARIANT === 'full' && this\.isPanelEnabledAndVisible\('forensics'\)/);
    assert.match(dataLoaderSrc, /tasks\.push\(\{ name: 'forensics', task: runGuarded\('forensics', \(\) => this\.loadForensics\(\)\) \}\)/);
  });

  it('service wrapper normalizes causalEdges and error fallbacks', () => {
    assert.match(forensicsServiceSrc, /runForensicsShadow\(/);
    assert.match(forensicsServiceSrc, /return \{ \.\.\.result, causalEdges: result\.causalEdges \?\? \[\] \}/);
    assert.match(forensicsServiceSrc, /causalEdges: \[\]/);
    assert.match(forensicsServiceSrc, /listForensicsRuns\(/);
    assert.match(forensicsServiceSrc, /getForensicsPolicy\(/);
  });
});

describe('Forensics topology overlay plumbing', () => {
  const mapContainerSrc = readSrc('src/components/MapContainer.ts');
  const deckSrc = readSrc('src/components/DeckGLMap.ts');

  it('keeps topology overlay setter pass-through in MapContainer', () => {
    assert.match(mapContainerSrc, /setTopologyWindowOverlay\(data: any\)/);
    assert.match(mapContainerSrc, /setTopologyWindowOverlay\?\.\(data\)/);
  });

  it('keeps DeckGL topology overlay hook for rendering integration', () => {
    assert.match(deckSrc, /setTopologyWindowOverlay\(_show: boolean\)/);
    assert.match(deckSrc, /forensics-topology-window-layer/);
  });
});

describe('Forensics algorithm modules', () => {
  const causalSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-causal.ts');
  const topologySrc = readSrc('server/worldmonitor/intelligence/v1/financial-topology.ts');
  const forensicsProto = readSrc('proto/worldmonitor/intelligence/v1/forensics.proto');
  const shadowProto = readSrc('proto/worldmonitor/intelligence/v1/run_forensics_shadow.proto');
  const orchestratorSrc = readSrc('server/worldmonitor/intelligence/v1/forensics-orchestrator.ts');
  const panelSrc = readSrc('src/components/ForensicsPanel.ts');

  it('exports causal discovery with score/lift/delay fields', () => {
    assert.match(causalSrc, /export function runCausalDiscovery/);
    assert.match(causalSrc, /HORIZONS/);
    assert.match(causalSrc, /MIN_SUPPORT/);
    assert.match(causalSrc, /conditionalLift/);
    assert.match(causalSrc, /delayMs/);
  });

  it('declares causal and counterfactual contracts in proto', () => {
    assert.match(forensicsProto, /message ForensicsCausalEdge/);
    assert.match(forensicsProto, /message ForensicsCounterfactualLever/);
    assert.match(forensicsProto, /counterfactual_levers/);
    assert.match(shadowProto, /causal_edges/);
  });

  it('keeps hyperedge/topology signal support', () => {
    assert.match(topologySrc, /detectCoordinationHyperedges/);
    assert.match(topologySrc, /topology_hyperedge_density/);
    assert.match(topologySrc, /topology_cross_domain_sync/);
    assert.match(topologySrc, /hyperedgeCount/);
  });

  it('propagates counterfactual and causal rendering hooks', () => {
    assert.match(orchestratorSrc, /computeCounterfactualLevers/);
    assert.match(orchestratorSrc, /causal-discovery/);
    assert.match(panelSrc, /buildCausalChainHtml/);
    assert.match(panelSrc, /buildCounterfactualLeversHtml/);
    assert.match(panelSrc, /renderCausalDag/);
  });
});
