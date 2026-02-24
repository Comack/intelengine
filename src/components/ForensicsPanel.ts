import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type {
  ForensicsCalibratedAnomaly,
  ForensicsFusedSignal,
  ForensicsPhaseTrace,
  ForensicsPolicyEntry,
  ForensicsRunSummary,
  ForensicsTopologyBaselineSummary,
} from '@/generated/client/worldmonitor/intelligence/v1/service_client';

export interface ForensicsRunTrendPoint {
  runId: string;
  domain: string;
  completedAt: number;
  anomalyFlaggedCount: number;
  minPValue: number;
  maxFusedScore: number;
}

export interface ForensicsAnomalyTrendPoint {
  runId: string;
  completedAt: number;
  pValue: number;
  legacyZScore: number;
  present: boolean;
  flagged: boolean;
}

export interface ForensicsAnomalyTrendSeries {
  key: string;
  sourceId: string;
  signalType: string;
  region: string;
  domain: string;
  points: ForensicsAnomalyTrendPoint[];
}

export interface ForensicsTopologyTrendPoint {
  runId: string;
  completedAt: number;
  value: number;
  region: string;
}

export interface ForensicsTopologyTrendSeries {
  metric: string;
  label: string;
  points: ForensicsTopologyTrendPoint[];
}

export interface ForensicsTopologyWindowDrilldown {
  metric: string;
  label: string;
  region: string;
  shortWindowRuns: number;
  longWindowRuns: number;
  shortMean: number;
  longMean: number;
  delta: number;
  slope: number;
  latestValue: number;
}

export interface ForensicsTopologyDriftDiagnostic {
  signalType: string;
  region: string;
  count: number;
  lastValue: number;
  mean: number;
  stdDev: number;
  zScore: number;
  driftState: 'stable' | 'watch' | 'critical';
  lastUpdated: number;
}

export interface ForensicsMonitorStreamItem {
  sourceId: string;
  signalType: string;
  region: string;
  label: string;
  pValue: number;
  priority: number;
}

export interface ForensicsMonitorStream {
  category: 'market' | 'maritime' | 'cyber' | 'security' | 'infrastructure' | 'other';
  label: string;
  totalFlagged: number;
  nearLiveCount: number;
  minPValue: number;
  maxPriority: number;
  topItems: ForensicsMonitorStreamItem[];
}

export interface ForensicsAisTrajectoryItem {
  sourceId: string;
  region: string;
  corridor: string;
  pValue: number;
  priority: number;
  ageMinutes: number;
}

export interface ForensicsAisTrajectoryStream {
  signalType: 'ais_route_deviation' | 'ais_loitering' | 'ais_silence';
  label: string;
  totalFlagged: number;
  nearLiveCount: number;
  minPValue: number;
  maxPriority: number;
  topCorridors: string[];
  topItems: ForensicsAisTrajectoryItem[];
}

export interface ForensicsPanelSnapshot {
  summary?: ForensicsRunSummary;
  fusedSignals: ForensicsFusedSignal[];
  anomalies: ForensicsCalibratedAnomaly[];
  monitorStreams: ForensicsMonitorStream[];
  aisTrajectoryStreams: ForensicsAisTrajectoryStream[];
  topologyAlerts: ForensicsCalibratedAnomaly[];
  topologyTrends: ForensicsTopologyTrendSeries[];
  topologyWindowDrilldowns: ForensicsTopologyWindowDrilldown[];
  topologyDrifts: ForensicsTopologyDriftDiagnostic[];
  topologyBaselines: ForensicsTopologyBaselineSummary[];
  trace: ForensicsPhaseTrace[];
  policy: ForensicsPolicyEntry[];
  runHistory: ForensicsRunTrendPoint[];
  anomalyTrends: ForensicsAnomalyTrendSeries[];
  error?: string;
}

function formatTimestamp(epochMs: number): string {
  if (!epochMs || !Number.isFinite(epochMs)) return 'N/A';
  return new Date(epochMs).toLocaleString();
}

function formatElapsed(elapsedMs: number): string {
  if (!elapsedMs || elapsedMs <= 0 || !Number.isFinite(elapsedMs)) return '-';
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`;
  return `${(elapsedMs / 1000).toFixed(2)}s`;
}

function formatPValue(value: number): string {
  if (!Number.isFinite(value)) return 'N/A';
  if (value === 0) return '0';
  if (value < 0.001) return value.toExponential(1);
  return value.toFixed(3);
}

function formatSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function formatCompact(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  return value.toFixed(digits);
}

function enumLabel(value: string, prefix: string): string {
  const normalized = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

function severityClass(value: string): string {
  if (value === 'SEVERITY_LEVEL_HIGH') return 'high';
  if (value === 'SEVERITY_LEVEL_MEDIUM') return 'medium';
  if (value === 'SEVERITY_LEVEL_LOW') return 'low';
  return 'unknown';
}


function topologyDriftClass(value: ForensicsTopologyDriftDiagnostic['driftState']): string {
  if (value === 'critical') return 'critical';
  if (value === 'watch') return 'watch';
  return 'stable';
}

function anomalyKey(sourceId: string, signalType: string, region: string): string {
  return `${sourceId}::${signalType}::${region || 'global'}`;
}

function buildSparkline(
  values: number[],
  options: {
    width?: number;
    height?: number;
    invert?: boolean;
    color?: string;
  } = {},
): string {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length < 2) {
    return '<div class="forensics-sparkline-empty">n/a</div>';
  }

  const width = options.width ?? 92;
  const height = options.height ?? 24;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const range = max - min || 1;
  const color = options.color || 'var(--accent)';

  const points = finiteValues
    .map((value, index) => {
      const x = (index / (finiteValues.length - 1)) * width;
      const normalized = (value - min) / range;
      const adjusted = options.invert ? (1 - normalized) : normalized;
      const y = height - 2 - (adjusted * (height - 4));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="forensics-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

interface ForensicsProvenanceLink {
  label: string;
  url: string;
}

function buildProvenanceLinks(anomaly: ForensicsCalibratedAnomaly): ForensicsProvenanceLink[] {
  const links: ForensicsProvenanceLink[] = [];
  const sourceId = anomaly.sourceId.toLowerCase();
  const signalType = anomaly.signalType.toLowerCase();

  if (sourceId.startsWith('market:')) {
    const symbol = anomaly.sourceId.slice('market:'.length).trim().toUpperCase();
    if (symbol) {
      links.push({
        label: `Yahoo Finance (${symbol})`,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      });
    }
  }

  if (sourceId.startsWith('prediction:') || signalType.includes('prediction')) {
    links.push({
      label: 'Prediction markets',
      url: 'https://polymarket.com/',
    });
  }

  if (signalType.includes('internet_outage')) {
    links.push({
      label: 'NetBlocks',
      url: 'https://netblocks.org/',
    });
  }

  if (signalType.includes('protest')) {
    links.push({
      label: 'ACLED data',
      url: 'https://acleddata.com/',
    });
  }

  if (signalType.includes('ais')) {
    links.push({
      label: 'MarineTraffic',
      url: 'https://www.marinetraffic.com/',
    });
  }

  if (signalType.includes('cyber')) {
    links.push({
      label: 'CISA advisories',
      url: 'https://www.cisa.gov/news-events/cybersecurity-advisories',
    });
  }

  const query = `${anomaly.sourceId} ${anomaly.signalType} ${anomaly.region || 'global'} intelligence signal`;
  links.push({
    label: 'Web context',
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  });

  const deduped = new Map<string, ForensicsProvenanceLink>();
  for (const link of links) {
    if (!deduped.has(link.url)) deduped.set(link.url, link);
  }
  return Array.from(deduped.values());
}

interface ForensicsPhaseNode {
  phase: string;
  displayName: string;
  status: string;
  startedAt: number;
  elapsedMs: number;
  error: string;
  isSwappable: boolean;
  parentPhases: string[];
}

const PHASE_DISPLAY_NAMES: Record<string, string> = {
  'signal-collect': 'Signal Collect',
  'extract-pole': 'Extract POLE',
  'ingest-signals': 'Ingest Signals',
  'topology-tda': 'Topology TDA',
  'ws-fusion': 'WS Fusion',
  'conformal': 'Conformal',
  'conformal-anomaly': 'Conformal',
  'weak-supervision-fusion': 'WS Fusion',
  'policy-select': 'Policy Select',
  'policy-update': 'Policy Update',
  'persist': 'Persist',
  'persist-results': 'Persist Results',
  'normalize': 'Normalize',
  'enrich': 'Enrich',
};

const SWAPPABLE_PHASES = new Set(['ws-fusion', 'conformal', 'weak-supervision-fusion', 'conformal-anomaly']);

function buildTraceGraph(trace: ForensicsPhaseTrace[]): string {
  const validPhases: ForensicsPhaseNode[] = trace
    .filter((phase) => Number.isFinite(phase.startedAt) && phase.startedAt > 0)
    .map((phase) => ({
      phase: phase.phase,
      displayName: PHASE_DISPLAY_NAMES[phase.phase] || enumLabel(phase.phase, ''),
      status: phase.status,
      startedAt: phase.startedAt,
      elapsedMs: Number.isFinite(phase.elapsedMs) && phase.elapsedMs > 0 ? phase.elapsedMs : 0,
      error: phase.error || '',
      isSwappable: SWAPPABLE_PHASES.has(phase.phase),
      parentPhases: phase.parentPhases || [],
    }));

  if (validPhases.length === 0) {
    return '<div class="forensics-empty">No phase trace available.</div>';
  }

  // Sort phases chronologically to ensure parents generally appear above children
  validPhases.sort((a, b) => a.startedAt - b.startedAt);

  // If no parent phase data exists at all (legacy data), infer a linear chain
  const hasDagInfo = validPhases.some(p => p.parentPhases.length > 0);
  if (!hasDagInfo) {
    for (let i = 1; i < validPhases.length; i++) {
      validPhases[i]!.parentPhases = [validPhases[i - 1]!.phase];
    }
  }

  const runStart = Math.min(...validPhases.map((p) => p.startedAt));
  const runEnd = Math.max(...validPhases.map((p) => p.startedAt + p.elapsedMs));
  const totalWindow = Math.max(runEnd - runStart, 1);
  const totalMs = Math.round(totalWindow);

  const labelWidth = 120;
  const barAreaWidth = 360;
  const rowHeight = 32; // Increased to give room for routing edges
  const headerHeight = 20;
  const svgWidth = labelWidth + barAreaWidth + 70;
  const svgHeight = headerHeight + validPhases.length * rowHeight + 10;

  const statusColor = (status: string): string => {
    if (status === 'FORENSICS_PHASE_STATUS_SUCCESS') return '#10b981';
    if (status === 'FORENSICS_PHASE_STATUS_FAILED') return '#ef4444';
    if (status === 'FORENSICS_PHASE_STATUS_SKIPPED') return '#64748b';
    return '#334155';
  };

  let svg = `<svg class="forensics-trace-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;

  // Header
  svg += `<text x="${labelWidth}" y="13" fill="#94a3b8" font-size="9" font-family="monospace" font-weight="600">AGENT OBSERVABILITY DAG</text>`;
  svg += `<text x="${svgWidth - 4}" y="13" fill="#64748b" font-size="9" font-family="monospace" text-anchor="end">total ${formatElapsed(totalMs)}</text>`;

  // Pre-calculate positions to draw edges first (so they render underneath)
  const positions = new Map<string, { x: number, y: number, w: number, h: number }>();
  validPhases.forEach((phase, index) => {
    const y = headerHeight + index * rowHeight;
    const barY = y + 10;
    const barHeight = 12;
    const offsetFrac = (phase.startedAt - runStart) / totalWindow;
    const widthFrac = Math.max(phase.elapsedMs / totalWindow, 0.008);
    const barX = labelWidth + offsetFrac * barAreaWidth;
    const barW = Math.max(widthFrac * barAreaWidth, 3);
    positions.set(phase.phase, { x: barX, y: barY, w: barW, h: barHeight });
  });

  // Draw DAG edges
  validPhases.forEach((childPhase) => {
    const childPos = positions.get(childPhase.phase);
    if (!childPos) return;

    childPhase.parentPhases.forEach(parentId => {
      const parentPos = positions.get(parentId);
      if (!parentPos) return;

      const startX = parentPos.x + parentPos.w;
      const startY = parentPos.y + parentPos.h / 2;
      const endX = childPos.x;
      const endY = childPos.y + childPos.h / 2;

      // Draw a smooth bezier curve from parent end to child start
      // Control points to enforce horizontal exiting/entering
      const cpX1 = startX + Math.max(10, (endX - startX) / 3);
      const cpY1 = startY;
      const cpX2 = endX - Math.max(10, (endX - startX) / 3);
      const cpY2 = endY;

      svg += `<path d="M ${startX} ${startY} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${endX} ${endY}" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#arrowhead)"/>`;
    });
  });

  // Define Arrowhead marker
  svg += `
    <defs>
      <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
        <polygon points="0 0, 6 2, 0 4" fill="#475569" />
      </marker>
    </defs>
  `;

  // Draw Phase Nodes (over the edges)
  validPhases.forEach((phase) => {
    const pos = positions.get(phase.phase);
    if (!pos) return;
    const { x: barX, y: barY, w: barW, h: barHeight } = pos;

    // Label
    svg += `<text x="${labelWidth - 6}" y="${barY + 10}" fill="#cbd5e1" font-size="10" font-family="monospace" text-anchor="end">${escapeHtml(phase.displayName)}</text>`;

    // Duration bar
    const color = statusColor(phase.status);
    svg += `<rect x="${barX}" y="${barY}" width="${barW}" height="${barHeight}" rx="3" fill="${color}" opacity="0.95"/>`;

    // Swappable bracket annotation
    if (phase.isSwappable) {
      svg += `<rect x="${barX - 2}" y="${barY - 2}" width="${barW + 4}" height="${barHeight + 4}" rx="4" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    }

    // Elapsed label
    const elapsedLabel = phase.elapsedMs > 0 ? formatElapsed(phase.elapsedMs) : '-';
    svg += `<text x="${barX + barW + 6}" y="${barY + 10}" fill="#94a3b8" font-size="9" font-family="monospace">${escapeHtml(elapsedLabel)}</text>`;
  });

  svg += '</svg>';
  return svg;
}

export class ForensicsPanel extends Panel {
  private snapshot: ForensicsPanelSnapshot | null = null;
  private selectedAnomalyKey = '';
  private onAnomalySelected?: (anomalyKey: string) => void;
  private onEvidenceSelected?: (evidenceId: string) => void;

  public setOnAnomalySelected(handler: (anomalyKey: string) => void): void {
    this.onAnomalySelected = handler;
  }

  public setOnEvidenceSelected(handler: (evidenceId: string) => void): void {
    this.onEvidenceSelected = handler;
  }

  private onContentClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    
    const evidenceBtn = target.closest('[data-forensics-evidence-id]') as HTMLElement | null;
    if (evidenceBtn) {
      const evidenceId = evidenceBtn.dataset.forensicsEvidenceId;
      if (evidenceId) {
        this.onEvidenceSelected?.(evidenceId);
        return;
      }
    }
    
    const row = target.closest('[data-forensics-anomaly-key]') as HTMLElement | null;
    if (!row) return;
    const key = row.dataset.forensicsAnomalyKey || '';
    if (!key || key === this.selectedAnomalyKey) return;
    this.selectedAnomalyKey = key;
    this.render();
    this.onAnomalySelected?.(key);
  };

  private onContentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement | null;
    
    const evidenceBtn = target?.closest('[data-forensics-evidence-id]') as HTMLElement | null;
    if (evidenceBtn) {
      event.preventDefault();
      const evidenceId = evidenceBtn.dataset.forensicsEvidenceId;
      if (evidenceId) {
        this.onEvidenceSelected?.(evidenceId);
        return;
      }
    }

    const row = target?.closest('[data-forensics-anomaly-key]') as HTMLElement | null;
    if (!row) return;
    event.preventDefault();
    const key = row.dataset.forensicsAnomalyKey || '';
    if (!key || key === this.selectedAnomalyKey) return;
    this.selectedAnomalyKey = key;
    this.render();
    this.onAnomalySelected?.(key);
  };

  constructor(title = 'Forensics Signals') {
    super({
      id: 'forensics',
      title,
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Shadow forensics run summaries combining weak supervision and conformal anomalies.',
    });
    this.content.addEventListener('click', this.onContentClick);
    this.content.addEventListener('keydown', this.onContentKeydown);
    this.showLoading('Loading forensics telemetry...');
  }

  public update(snapshot: ForensicsPanelSnapshot): void {
    this.snapshot = snapshot;
    const flaggedCount = snapshot.summary?.anomalyFlaggedCount
      ?? snapshot.anomalies.filter((anomaly) => anomaly.isAnomaly).length;
    this.setCount(flaggedCount);

    if (snapshot.summary?.run) {
      const run = snapshot.summary.run;
      const detail = run.workerMode || run.backend || run.status || undefined;
      this.setDataBadge('live', detail);
    } else if (snapshot.error) {
      this.setDataBadge('unavailable');
    } else {
      this.clearDataBadge();
    }

    const availableAnomalyKeys = snapshot.anomalies.map((anomaly) =>
      anomalyKey(anomaly.sourceId, anomaly.signalType, anomaly.region || 'global'),
    );
    if (availableAnomalyKeys.length === 0) {
      this.selectedAnomalyKey = '';
    } else if (!availableAnomalyKeys.includes(this.selectedAnomalyKey)) {
      this.selectedAnomalyKey = availableAnomalyKeys[0] || '';
    }

    this.render();
  }

  private render(): void {
    if (!this.snapshot) {
      this.showLoading('Loading forensics telemetry...');
      return;
    }

    const {
      summary,
      fusedSignals,
      anomalies,
      monitorStreams,
      aisTrajectoryStreams,
      topologyAlerts,
      topologyTrends,
      topologyWindowDrilldowns,
      topologyDrifts,
      topologyBaselines,
      trace,
      policy,
      runHistory,
      anomalyTrends,
      error,
    } = this.snapshot;
    const run = summary?.run;
    const statusClass = run?.status
      ? run.status.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'unknown';

    const orderedHistory = [...runHistory]
      .filter((point) => point.runId)
      .sort((a, b) => a.completedAt - b.completedAt);
    const trendCardsHtml = orderedHistory.length > 1
      ? `
          <div class="forensics-trend-grid">
            <div class="forensics-trend-card">
              <div class="forensics-trend-head">
                <span class="forensics-trend-label">Flagged anomalies</span>
                <span class="forensics-trend-value">${orderedHistory[orderedHistory.length - 1]?.anomalyFlaggedCount ?? 0}</span>
              </div>
              ${buildSparkline(orderedHistory.map((point) => point.anomalyFlaggedCount), { color: 'var(--semantic-high)' })}
            </div>
            <div class="forensics-trend-card">
              <div class="forensics-trend-head">
                <span class="forensics-trend-label">Minimum p-value</span>
                <span class="forensics-trend-value">${formatPValue(orderedHistory[orderedHistory.length - 1]?.minPValue ?? 0)}</span>
              </div>
              ${buildSparkline(
                orderedHistory.map((point) => (point.minPValue > 0 ? point.minPValue : 1)),
                { invert: true, color: 'var(--semantic-critical)' },
              )}
            </div>
            <div class="forensics-trend-card">
              <div class="forensics-trend-head">
                <span class="forensics-trend-label">Max fused score</span>
                <span class="forensics-trend-value">${formatCompact(orderedHistory[orderedHistory.length - 1]?.maxFusedScore ?? 0)}</span>
              </div>
              ${buildSparkline(orderedHistory.map((point) => point.maxFusedScore), { color: 'var(--semantic-normal)' })}
            </div>
          </div>
        `
      : '';

    const topologyTrendHtml = topologyTrends.length > 0
      ? `
          <section class="forensics-section">
            <h4>Topology Trends</h4>
            <div class="forensics-trend-grid">
              ${topologyTrends.map((series) => {
                const points = [...series.points]
                  .filter((point) => Number.isFinite(point.value))
                  .sort((a, b) => a.completedAt - b.completedAt);
                const latest = points[points.length - 1];
                const latestRegion = latest?.region || 'global';
                const latestValue = latest ? formatCompact(latest.value, 2) : 'N/A';
                return `
                    <div class="forensics-trend-card">
                      <div class="forensics-trend-head">
                        <span class="forensics-trend-label">${escapeHtml(series.label)}</span>
                        <span class="forensics-trend-value">${escapeHtml(latestValue)}</span>
                      </div>
                      ${buildSparkline(points.map((point) => point.value), { color: 'var(--semantic-high)' })}
                      <div class="forensics-trend-meta">${escapeHtml(latestRegion)}</div>
                    </div>
                  `;
              }).join('')}
            </div>
          </section>
        `
      : '';

    const monitorStreamsHtml = monitorStreams.length > 0
      ? `
          <section class="forensics-section">
            <h4>Monitor Streams</h4>
            <div class="forensics-monitor-grid">
              ${monitorStreams.map((stream) => `
                <article class="forensics-monitor-card monitor-${escapeHtml(stream.category)}">
                  <div class="forensics-monitor-head">
                    <span class="forensics-monitor-title">${escapeHtml(stream.label)}</span>
                    <span class="forensics-monitor-count">${stream.totalFlagged}</span>
                  </div>
                  <div class="forensics-monitor-meta">
                    <span>near-live ${stream.nearLiveCount}</span>
                    <span>min p ${formatPValue(stream.minPValue)}</span>
                    <span>priority ${(stream.maxPriority * 100).toFixed(0)}%</span>
                  </div>
                  <div class="forensics-monitor-items">
                    ${stream.topItems.length > 0
                      ? stream.topItems.map((item) => `
                          <div class="forensics-monitor-item">
                            <span class="forensics-monitor-item-main">${escapeHtml(item.label)} · ${escapeHtml(item.region || 'global')}</span>
                            <span class="forensics-monitor-item-meta">p=${formatPValue(item.pValue)} · ${(item.priority * 100).toFixed(0)}%</span>
                          </div>
                        `).join('')
                      : '<div class="forensics-empty">No stream items.</div>'}
                  </div>
                </article>
              `).join('')}
            </div>
          </section>
        `
      : '';

    const aisTrajectoryHtml = aisTrajectoryStreams.length > 0
      ? `
          <section class="forensics-section">
            <h4>AIS Trajectory Streams</h4>
            <div class="forensics-trajectory-grid">
              ${aisTrajectoryStreams.map((stream) => `
                <article class="forensics-trajectory-card trajectory-${escapeHtml(stream.signalType)}">
                  <div class="forensics-trajectory-head">
                    <span class="forensics-trajectory-title">${escapeHtml(stream.label)}</span>
                    <span class="forensics-trajectory-count">${stream.totalFlagged}</span>
                  </div>
                  <div class="forensics-trajectory-meta">
                    <span>near-live ${stream.nearLiveCount}</span>
                    <span>min p ${formatPValue(stream.minPValue)}</span>
                    <span>priority ${(stream.maxPriority * 100).toFixed(0)}%</span>
                  </div>
                  <div class="forensics-trajectory-corridors">
                    ${stream.topCorridors.length > 0
                      ? stream.topCorridors.map((corridor) => `<span class="forensics-trajectory-chip">${escapeHtml(corridor)}</span>`).join('')
                      : '<span class="forensics-empty">No corridors flagged.</span>'}
                  </div>
                  <div class="forensics-trajectory-items">
                    ${stream.topItems.length > 0
                      ? stream.topItems.map((item) => `
                          <div class="forensics-trajectory-item">
                            <span class="forensics-trajectory-item-main">${escapeHtml(item.corridor)} · ${escapeHtml(item.region || 'global')}</span>
                            <span class="forensics-trajectory-item-meta">p=${formatPValue(item.pValue)} · ${(item.priority * 100).toFixed(0)}% · ${Math.max(0, item.ageMinutes)}m</span>
                          </div>
                        `).join('')
                      : '<div class="forensics-empty">No trajectory items.</div>'}
                  </div>
                </article>
              `).join('')}
            </div>
          </section>
        `
      : '';

    const topologyBaselineHtml = topologyBaselines.length > 0
      ? `
          <section class="forensics-section">
            <h4>Topology Baselines</h4>
            ${topologyBaselines
              .slice()
              .sort((a, b) => (b.lastUpdated - a.lastUpdated) || (b.count - a.count))
              .slice(0, 8)
              .map((baseline) => `
                <div class="forensics-item">
                  <div class="forensics-item-head">
                    <span class="forensics-source">${escapeHtml(baseline.signalType)}</span>
                    <span class="forensics-score">${baseline.count}</span>
                  </div>
                  <div class="forensics-item-meta">
                    <span>${escapeHtml(baseline.region || 'global')}</span>
                    <span>last=${formatCompact(baseline.lastValue, 2)}</span>
                    <span>mean=${formatCompact(baseline.mean, 2)} +/- ${formatCompact(baseline.stdDev, 2)}</span>
                  </div>
                </div>
              `).join('')}
          </section>
        `
      : '';

    const topologyWindowHtml = topologyWindowDrilldowns.length > 0
      ? `
          <section class="forensics-section">
            <h4>Topology Window Drilldowns</h4>
            <div class="forensics-trend-grid">
              ${topologyWindowDrilldowns.slice(0, 6).map((drilldown) => `
                <div class="forensics-trend-card">
                  <div class="forensics-trend-head">
                    <span class="forensics-trend-label">${escapeHtml(drilldown.label)}</span>
                    <span class="forensics-trend-value">${formatCompact(drilldown.latestValue, 2)}</span>
                  </div>
                  <div class="forensics-trend-meta">${escapeHtml(drilldown.region || 'global')} · ${drilldown.shortWindowRuns}/${drilldown.longWindowRuns} runs</div>
                  <div class="forensics-trend-meta">short=${formatCompact(drilldown.shortMean, 2)} · long=${formatCompact(drilldown.longMean, 2)}</div>
                  <div class="forensics-trend-meta">delta=${formatSigned(drilldown.delta, 2)} · slope=${formatSigned(drilldown.slope, 2)}</div>
                </div>
              `).join('')}
            </div>
          </section>
        `
      : '';

    const topologyDriftHtml = topologyDrifts.length > 0
      ? `
          <section class="forensics-section">
            <h4>Topology Drift Diagnostics</h4>
            <div class="forensics-drift-grid">
              ${topologyDrifts
                .slice(0, 8)
                .map((drift) => `
                  <article class="forensics-drift-card drift-${topologyDriftClass(drift.driftState)}">
                    <div class="forensics-drift-head">
                      <span class="forensics-source">${escapeHtml(drift.signalType)}</span>
                      <span class="forensics-drift-badge">${escapeHtml(drift.driftState.toUpperCase())}</span>
                    </div>
                    <div class="forensics-drift-meta">
                      <span>${escapeHtml(drift.region || 'global')}</span>
                      <span>z=${formatSigned(drift.zScore, 2)}</span>
                      <span>n=${drift.count}</span>
                    </div>
                    <div class="forensics-drift-meta">
                      <span>last=${formatCompact(drift.lastValue, 2)}</span>
                      <span>mean=${formatCompact(drift.mean, 2)} +/- ${formatCompact(drift.stdDev, 2)}</span>
                      <span>${escapeHtml(formatTimestamp(drift.lastUpdated))}</span>
                    </div>
                  </article>
                `).join('')}
            </div>
          </section>
        `
      : '';

    const summaryHtml = run
      ? `
          <div class="forensics-summary-card">
            <div class="forensics-summary-top">
              <span class="forensics-run-id">${escapeHtml(run.runId)}</span>
              <span class="forensics-run-status ${escapeHtml(statusClass)}">${escapeHtml(run.status)}</span>
            </div>
            <div class="forensics-summary-meta">
              <span>Domain: ${escapeHtml(run.domain || 'n/a')}</span>
              <span>Started: ${escapeHtml(formatTimestamp(run.startedAt))}</span>
              <span>Completed: ${escapeHtml(formatTimestamp(run.completedAt))}</span>
              <span>Fused: ${summary?.fusedCount ?? fusedSignals.length}</span>
              <span>Anomalies: ${summary?.anomalyCount ?? anomalies.length}</span>
              <span>Flagged: ${summary?.anomalyFlaggedCount ?? anomalies.filter((item) => item.isAnomaly).length}</span>
            </div>
          </div>
        `
      : '<div class="forensics-empty">No completed forensics runs yet.</div>';

    const fusedHtml = fusedSignals.length > 0
      ? fusedSignals.map((signal) => {
        const contributors = signal.contributors
          .slice(0, 2)
          .map((contributor) => `${escapeHtml(contributor.signalType)} ${formatSigned(contributor.learnedWeight)}`)
          .join(' · ');
        return `
            <div class="forensics-item">
              <div class="forensics-item-head">
                <span class="forensics-source">${escapeHtml(signal.sourceId)}</span>
                <span class="forensics-score">${signal.score.toFixed(2)}</span>
              </div>
              <div class="forensics-item-meta">
                <span>${escapeHtml(signal.region || 'global')}</span>
                <span>${(signal.probability * 100).toFixed(1)}%</span>
                <span>${contributors || 'No contributors'}</span>
              </div>
            </div>
          `;
      }).join('')
      : '<div class="forensics-empty">No fused signals for this run.</div>';

    const selectedAnomaly = anomalies.find((anomaly) =>
      anomalyKey(anomaly.sourceId, anomaly.signalType, anomaly.region || 'global') === this.selectedAnomalyKey,
    ) || anomalies[0];
    const selectedKey = selectedAnomaly
      ? anomalyKey(selectedAnomaly.sourceId, selectedAnomaly.signalType, selectedAnomaly.region || 'global')
      : '';
    const selectedTrend = anomalyTrends.find((trend) => trend.key === selectedKey);

    const anomalyHtml = anomalies.length > 0
      ? anomalies.map((anomaly) => {
        const key = anomalyKey(anomaly.sourceId, anomaly.signalType, anomaly.region || 'global');
        const selectedClass = key === selectedKey ? ' selected' : '';
        return `
          <button type="button" class="forensics-item forensics-item-selectable${selectedClass}" data-forensics-anomaly-key="${escapeHtml(key)}">
            <div class="forensics-item-head">
              <span class="forensics-source">${escapeHtml(anomaly.sourceId)}</span>
              <span class="forensics-severity ${severityClass(anomaly.severity)}">${escapeHtml(enumLabel(anomaly.severity, 'SEVERITY_LEVEL_'))}</span>
            </div>
            <div class="forensics-item-meta">
              <span>${escapeHtml(anomaly.signalType)} (${escapeHtml(anomaly.region || 'global')})</span>
              <span>p=${formatPValue(anomaly.pValue)}</span>
              <span>z=${formatSigned(anomaly.legacyZScore)}</span>
            </div>
          </button>
        `;
      }).join('')
      : '<div class="forensics-empty">No calibrated anomalies for this run.</div>';

    const topologyHtml = topologyAlerts.length > 0
      ? topologyAlerts.map((alert) => `
          <div class="forensics-item">
            <div class="forensics-item-head">
              <span class="forensics-source">${escapeHtml(alert.signalType)}</span>
              <span class="forensics-severity ${severityClass(alert.severity)}">${escapeHtml(enumLabel(alert.severity, 'SEVERITY_LEVEL_'))}</span>
            </div>
            <div class="forensics-item-meta">
              <span>${escapeHtml(alert.region || 'global')} · ${escapeHtml(alert.sourceId)}</span>
              <span>p=${formatPValue(alert.pValue)}</span>
              <span>v=${formatCompact(alert.value, 2)}</span>
            </div>
          </div>
        `).join('')
      : '<div class="forensics-empty">No topology alerts for this run.</div>';

    const phaseHtml = buildTraceGraph(trace);

    const policyHtml = policy.length > 0
      ? policy.map((entry) => `
          <div class="forensics-item">
            <div class="forensics-item-head">
              <span class="forensics-source">${escapeHtml(entry.action)}</span>
              <span class="forensics-score">${entry.qValue.toFixed(3)}</span>
            </div>
            <div class="forensics-item-meta">
              <span>Visits: ${entry.visitCount}</span>
              <span>Reward: ${formatSigned(entry.lastReward, 3)}</span>
              <span>${escapeHtml(formatTimestamp(entry.lastUpdated))}</span>
            </div>
          </div>
        `).join('')
      : '<div class="forensics-empty">No policy updates yet.</div>';

    const anomalyDetailHtml = selectedAnomaly
      ? (() => {
        const trendPoints = [...(selectedTrend?.points || [])]
          .filter((point) => point.runId)
          .sort((a, b) => a.completedAt - b.completedAt);
        const pValueSeries = trendPoints.map((point) => point.pValue);
        const zSeries = trendPoints.map((point) => Math.abs(point.legacyZScore));
        const presentCount = trendPoints.filter((point) => point.present).length;
        const flaggedCount = trendPoints.filter((point) => point.flagged).length;

        const linkedContributors = fusedSignals
          .flatMap((signal) => signal.contributors
            .filter((contributor) => contributor.signalType === selectedAnomaly.signalType)
            .map((contributor) => ({
              sourceId: signal.sourceId,
              probability: signal.probability,
              contribution: contributor.contribution,
              learnedWeight: contributor.learnedWeight,
            })))
          .sort((a, b) => Math.abs(b.learnedWeight) - Math.abs(a.learnedWeight))
          .slice(0, 4);

        const contributorHtml = linkedContributors.length > 0
          ? linkedContributors.map((contributor) => `
              <div class="forensics-detail-item">
                <span class="forensics-detail-key">${escapeHtml(contributor.sourceId)}</span>
                <span class="forensics-detail-value">w=${formatSigned(contributor.learnedWeight, 3)} · c=${formatSigned(contributor.contribution, 3)} · p=${formatPValue(contributor.probability)}</span>
              </div>
            `).join('')
          : '<div class="forensics-empty">No contributor trace for this anomaly in current fused window.</div>';

        let provenanceHtml = '';
        if (selectedAnomaly.evidenceIds && selectedAnomaly.evidenceIds.length > 0) {
          provenanceHtml = selectedAnomaly.evidenceIds.map((id) => {
            const shortId = id.replace('evidence_', '').slice(0, 8);
            return `<button type="button" class="forensics-provenance-btn" data-forensics-evidence-id="${escapeHtml(id)}">View Evidence ${escapeHtml(shortId)}</button>`;
          }).join('');
        } else {
          provenanceHtml = buildProvenanceLinks(selectedAnomaly)
            .map((link) => {
              const href = sanitizeUrl(link.url);
              if (!href) return '';
              return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`;
            })
            .filter(Boolean)
            .join('');
        }

        return `
            <section class="forensics-section forensics-detail-section">
              <h4>Anomaly Detail</h4>
              <div class="forensics-detail-top">
                <div class="forensics-detail-title">${escapeHtml(selectedAnomaly.sourceId)}</div>
                <div class="forensics-detail-subtitle">${escapeHtml(selectedAnomaly.signalType)} · ${escapeHtml(selectedAnomaly.region || 'global')} · ${escapeHtml(selectedAnomaly.domain || run?.domain || 'n/a')}</div>
              </div>
              <div class="forensics-detail-grid">
                <div class="forensics-trend-card compact">
                  <div class="forensics-trend-head">
                    <span class="forensics-trend-label">P-value trend</span>
                    <span class="forensics-trend-value">${formatPValue(selectedAnomaly.pValue)}</span>
                  </div>
                  ${buildSparkline(pValueSeries.length > 0 ? pValueSeries : [selectedAnomaly.pValue, selectedAnomaly.pValue], { invert: true, color: 'var(--semantic-critical)' })}
                </div>
                <div class="forensics-trend-card compact">
                  <div class="forensics-trend-head">
                    <span class="forensics-trend-label">|z| trend</span>
                    <span class="forensics-trend-value">${formatCompact(Math.abs(selectedAnomaly.legacyZScore), 2)}</span>
                  </div>
                  ${buildSparkline(zSeries.length > 0 ? zSeries : [Math.abs(selectedAnomaly.legacyZScore), Math.abs(selectedAnomaly.legacyZScore)], { color: 'var(--semantic-high)' })}
                </div>
                <div class="forensics-detail-metric">
                  <span class="forensics-detail-metric-label">Run coverage</span>
                  <span class="forensics-detail-metric-value">${presentCount}/${Math.max(trendPoints.length, 1)} runs</span>
                </div>
                <div class="forensics-detail-metric">
                  <span class="forensics-detail-metric-label">Flagged frequency</span>
                  <span class="forensics-detail-metric-value">${flaggedCount}/${Math.max(trendPoints.length, 1)} runs</span>
                </div>
              </div>
              <div class="forensics-detail-block">
                <div class="forensics-detail-heading">Signal contributors</div>
                ${contributorHtml}
              </div>
              <div class="forensics-detail-block">
                <div class="forensics-detail-heading">Provenance links</div>
                <div class="forensics-provenance-links">
                  ${provenanceHtml || '<span class="forensics-empty">No provenance links available.</span>'}
                </div>
              </div>
            </section>
          `;
      })()
      : `
          <section class="forensics-section forensics-detail-section">
            <h4>Anomaly Detail</h4>
            <div class="forensics-empty">Select an anomaly to inspect trend and provenance.</div>
          </section>
        `;

    const warningHtml = error
      ? `<div class="forensics-warning">${escapeHtml(error)}</div>`
      : '';

    this.setContent(`
      <div class="forensics-panel">
        ${warningHtml}
        ${summaryHtml}
        ${trendCardsHtml}
        ${monitorStreamsHtml}
        ${aisTrajectoryHtml}
        ${topologyTrendHtml}
        ${topologyWindowHtml}
        ${topologyDriftHtml}
        ${topologyBaselineHtml}
        <div class="forensics-grid">
          <section class="forensics-section">
            <h4>Fused Signals</h4>
            ${fusedHtml}
          </section>
          <section class="forensics-section">
            <h4>Calibrated Anomalies</h4>
            ${anomalyHtml}
          </section>
          <section class="forensics-section">
            <h4>Topological Alerts</h4>
            ${topologyHtml}
          </section>
          <section class="forensics-section">
            <h4>Phase Trace</h4>
            ${phaseHtml}
          </section>
          <section class="forensics-section">
            <h4>Policy Q-Table</h4>
            ${policyHtml}
          </section>
        </div>
        ${anomalyDetailHtml}
      </div>
    `);
  }

  public destroy(): void {
    this.content.removeEventListener('click', this.onContentClick);
    this.content.removeEventListener('keydown', this.onContentKeydown);
    super.destroy();
  }
}
