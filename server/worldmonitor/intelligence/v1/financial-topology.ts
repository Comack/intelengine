import type {
  ForensicsSignalInput,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

interface TopologyNode {
  sourceId: string;
  region: string;
  domain: string;
  family: string;
  value: number;
  confidence: number;
  observedAt: number;
  signalTypes: Set<string>;
}

interface TopologyEdge {
  a: number;
  b: number;
  weight: number;
}

export interface FinancialTopologyDiagnostics {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  beta1: number;
  tsi: number;
  derivedSignalCount: number;
}

export interface FinancialTopologyDerivation {
  derivedSignals: ForensicsSignalInput[];
  diagnostics: FinancialTopologyDiagnostics;
}

const FINANCIAL_DOMAIN_HINTS = new Set([
  'market',
  'prediction',
  'finance',
  'economic',
]);

const FINANCIAL_SIGNAL_HINTS = [
  'market',
  'prediction',
  'volatility',
  'conviction',
  'etf',
  'flow',
  'yield',
  'spread',
  'commodity',
  'fx',
];

const EDGE_THRESHOLD = 0.55;
const FILTRATION_THRESHOLDS = [0.55, 0.65, 0.75, 0.85];
const MAX_FINANCIAL_NODES = 40;
const MAX_DERIVED_SIGNALS = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function round(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function isFinancialSignal(signal: ForensicsSignalInput): boolean {
  const domain = signal.domain?.toLowerCase() || '';
  if (FINANCIAL_DOMAIN_HINTS.has(domain)) return true;

  const sourceId = signal.sourceId?.toLowerCase() || '';
  if (sourceId.startsWith('market:') || sourceId.startsWith('prediction:')) return true;

  const signalType = signal.signalType?.toLowerCase() || '';
  return FINANCIAL_SIGNAL_HINTS.some((hint) => signalType.includes(hint));
}

function classifyFamily(sourceId: string, domain: string): string {
  const prefix = sourceId.split(':')[0]?.toLowerCase() || '';
  if (prefix) return prefix;
  if (domain) return domain.toLowerCase();
  return 'unknown';
}

function normalizeNodes(signals: ForensicsSignalInput[]): TopologyNode[] {
  const nodeMap = new Map<string, TopologyNode>();
  for (const signal of signals) {
    if (!isFinancialSignal(signal)) continue;
    if (!signal.sourceId || !signal.signalType || !Number.isFinite(signal.value)) continue;

    const sourceId = signal.sourceId;
    const existing = nodeMap.get(sourceId);
    const region = signal.region || 'global';
    const domain = signal.domain || 'market';
    const confidence = clamp(signal.confidence || 0, 0, 1);
    const observedAt = Number.isFinite(signal.observedAt) && signal.observedAt > 0
      ? signal.observedAt
      : Date.now();
    const magnitude = Math.abs(signal.value);

    if (existing) {
      existing.value += magnitude;
      existing.confidence = (existing.confidence + confidence) / 2;
      existing.observedAt = Math.max(existing.observedAt, observedAt);
      existing.signalTypes.add(signal.signalType);
      if (existing.region === 'global' && region !== 'global') existing.region = region;
    } else {
      nodeMap.set(sourceId, {
        sourceId,
        region,
        domain,
        family: classifyFamily(sourceId, domain),
        value: magnitude,
        confidence,
        observedAt,
        signalTypes: new Set([signal.signalType]),
      });
    }
  }

  return Array.from(nodeMap.values())
    .filter((node) => node.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_FINANCIAL_NODES);
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function buildEdges(nodes: TopologyNode[]): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      if (!left || !right) continue;

      const maxValue = Math.max(left.value, right.value, 1);
      const valueSimilarity = 1 - clamp(Math.abs(left.value - right.value) / maxValue, 0, 1);
      const confidenceSimilarity = 1 - clamp(Math.abs(left.confidence - right.confidence), 0, 1);
      const temporalDelta = Math.abs(left.observedAt - right.observedAt);
      const temporalSimilarity = Math.exp(-temporalDelta / (12 * 60 * 60 * 1000));
      const typeOverlap = jaccardOverlap(left.signalTypes, right.signalTypes);
      const regionBonus = left.region === right.region ? 0.08 : 0;
      const familyBonus = left.family !== right.family ? 0.12 : 0;

      const score = clamp(
        (0.38 * valueSimilarity)
        + (0.18 * confidenceSimilarity)
        + (0.2 * temporalSimilarity)
        + (0.14 * typeOverlap)
        + regionBonus
        + familyBonus,
        0,
        1,
      );

      if (score >= EDGE_THRESHOLD) {
        edges.push({ a: i, b: j, weight: round(score, 6) });
      }
    }
  }
  return edges;
}

function countComponents(nodeCount: number, edges: TopologyEdge[], threshold: number): number {
  if (nodeCount <= 0) return 0;
  const adjacency = Array.from({ length: nodeCount }, () => [] as number[]);
  for (const edge of edges) {
    if (edge.weight < threshold) continue;
    adjacency[edge.a]?.push(edge.b);
    adjacency[edge.b]?.push(edge.a);
  }

  const seen = new Array<boolean>(nodeCount).fill(false);
  let components = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    if (seen[i]) continue;
    components += 1;
    const stack = [i];
    seen[i] = true;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      for (const next of adjacency[node] || []) {
        if (seen[next]) continue;
        seen[next] = true;
        stack.push(next);
      }
    }
  }
  return components;
}

function computeBetaSeries(nodeCount: number, edges: TopologyEdge[]): number[] {
  return FILTRATION_THRESHOLDS.map((threshold) => {
    const filteredEdges = edges.filter((edge) => edge.weight >= threshold);
    const components = countComponents(nodeCount, filteredEdges, threshold);
    const beta1 = filteredEdges.length - nodeCount + components;
    return Math.max(0, beta1);
  });
}

function triangleStrengthByNode(nodeCount: number, edges: TopologyEdge[]): { cycleStrength: number[]; cycleCount: number[] } {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    weights.set(`${edge.a}:${edge.b}`, edge.weight);
    weights.set(`${edge.b}:${edge.a}`, edge.weight);
  }

  const cycleStrength = new Array<number>(nodeCount).fill(0);
  const cycleCount = new Array<number>(nodeCount).fill(0);

  for (let i = 0; i < nodeCount; i += 1) {
    for (let j = i + 1; j < nodeCount; j += 1) {
      const wij = weights.get(`${i}:${j}`);
      if (!wij) continue;
      for (let k = j + 1; k < nodeCount; k += 1) {
        const wik = weights.get(`${i}:${k}`);
        const wjk = weights.get(`${j}:${k}`);
        if (!wik || !wjk) continue;
        const triangleStrength = (wij + wik + wjk) / 3;
        cycleStrength[i] += triangleStrength;
        cycleStrength[j] += triangleStrength;
        cycleStrength[k] += triangleStrength;
        cycleCount[i] += 1;
        cycleCount[j] += 1;
        cycleCount[k] += 1;
      }
    }
  }

  return { cycleStrength, cycleCount };
}

function valueFromBetaSeries(betaSeries: number[], nodeCount: number): number {
  const avg = mean(betaSeries);
  const dispersion = stddev(betaSeries, avg);
  const persistenceMass = betaSeries.reduce((sum, beta, index) => {
    const prev = index > 0 ? FILTRATION_THRESHOLDS[index - 1] : 0;
    const width = (FILTRATION_THRESHOLDS[index] || prev) - prev;
    return sum + (beta * Math.max(width, 0));
  }, 0);
  const baseBeta = betaSeries[0] ?? 0;
  const nodeScale = Math.max(1, nodeCount / 4);
  const raw = (dispersion + (0.8 * persistenceMass) + (0.5 * baseBeta)) / nodeScale;
  return clamp(raw * 22, 0, 100);
}

export function deriveFinancialTopologySignals(
  inputSignals: ForensicsSignalInput[],
  runDomain: string,
): FinancialTopologyDerivation {
  const nodes = normalizeNodes(inputSignals);
  if (nodes.length < 4) {
    return {
      derivedSignals: [],
      diagnostics: {
        nodeCount: nodes.length,
        edgeCount: 0,
        componentCount: nodes.length,
        beta1: 0,
        tsi: 0,
        derivedSignalCount: 0,
      },
    };
  }

  const edges = buildEdges(nodes);
  if (edges.length < 3) {
    return {
      derivedSignals: [],
      diagnostics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        componentCount: countComponents(nodes.length, edges, EDGE_THRESHOLD),
        beta1: 0,
        tsi: 0,
        derivedSignalCount: 0,
      },
    };
  }

  const degreeStrength = new Array<number>(nodes.length).fill(0);
  for (const edge of edges) {
    degreeStrength[edge.a] = (degreeStrength[edge.a] || 0) + edge.weight;
    degreeStrength[edge.b] = (degreeStrength[edge.b] || 0) + edge.weight;
  }

  const { cycleStrength, cycleCount } = triangleStrengthByNode(nodes.length, edges);
  const betaSeries = computeBetaSeries(nodes.length, edges);
  const beta1 = betaSeries[0] ?? 0;
  const tsi = valueFromBetaSeries(betaSeries, nodes.length);

  const maxDegree = Math.max(...degreeStrength, 1);
  const maxCycle = Math.max(...cycleStrength, 1);
  const maxObservedAt = Math.max(...nodes.map((node) => node.observedAt), Date.now());
  const domain = FINANCIAL_DOMAIN_HINTS.has(runDomain.toLowerCase()) ? runDomain : 'market';
  const edgeDensity = edges.length / Math.max(1, (nodes.length * (nodes.length - 1)) / 2);
  const baseConfidence = clamp(0.55 + (0.35 * edgeDensity), 0.55, 0.95);

  const derivedSignals: ForensicsSignalInput[] = [];

  derivedSignals.push({
    sourceId: `topology:tsi:${domain}`,
    region: 'global',
    domain,
    signalType: 'topology_tsi',
    value: round(tsi, 4),
    confidence: round(baseConfidence, 6),
    observedAt: maxObservedAt,
  });

  derivedSignals.push({
    sourceId: `topology:beta1:${domain}`,
    region: 'global',
    domain,
    signalType: 'topology_beta1',
    value: round(beta1, 4),
    confidence: round(clamp(baseConfidence - 0.05, 0.45, 0.9), 6),
    observedAt: maxObservedAt,
  });

  const nodeOrder = nodes
    .map((node, index) => {
      const degreeNorm = clamp((degreeStrength[index] || 0) / maxDegree, 0, 1);
      const cycleNorm = clamp((cycleStrength[index] || 0) / maxCycle, 0, 1);
      const risk = clamp((degreeNorm * 55) + (cycleNorm * 45), 0, 100);
      return { node, index, degreeNorm, cycleNorm, risk };
    })
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 24);

  for (const ranked of nodeOrder) {
    const nodeConfidence = round(clamp(0.45 + (ranked.node.confidence * 0.3) + (edgeDensity * 0.2), 0.45, 0.98), 6);

    if (ranked.degreeNorm > 0.15) {
      derivedSignals.push({
        sourceId: ranked.node.sourceId,
        region: ranked.node.region,
        domain: ranked.node.domain || domain,
        signalType: 'topology_degree_centrality',
        value: round(ranked.degreeNorm * 100, 4),
        confidence: nodeConfidence,
        observedAt: ranked.node.observedAt,
      });
    }

    if (ranked.cycleNorm > 0.1 || (cycleCount[ranked.index] || 0) > 0) {
      derivedSignals.push({
        sourceId: ranked.node.sourceId,
        region: ranked.node.region,
        domain: ranked.node.domain || domain,
        signalType: 'topology_cycle_membership',
        value: round(ranked.cycleNorm * 100, 4),
        confidence: nodeConfidence,
        observedAt: ranked.node.observedAt,
      });
    }
  }

  const regionCycleMap = new Map<string, { strength: number; count: number; latest: number }>();
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    const region = node.region || 'global';
    const entry = regionCycleMap.get(region) || { strength: 0, count: 0, latest: 0 };
    entry.strength += cycleStrength[i] || 0;
    entry.count += 1;
    entry.latest = Math.max(entry.latest, node.observedAt);
    regionCycleMap.set(region, entry);
  }

  const regionAlerts = Array.from(regionCycleMap.entries())
    .map(([region, data]) => {
      const normalizedStrength = clamp((data.strength / Math.max(maxCycle, 1)), 0, 1);
      const risk = clamp((normalizedStrength * 75) + (Math.min(data.count, 12) * 2.1), 0, 100);
      return {
        region,
        risk,
        observedAt: data.latest || maxObservedAt,
      };
    })
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 6);

  for (const alert of regionAlerts) {
    if (alert.risk < 10) continue;
    derivedSignals.push({
      sourceId: `topology:region:${alert.region.toLowerCase()}`,
      region: alert.region,
      domain,
      signalType: 'topology_cycle_risk',
      value: round(alert.risk, 4),
      confidence: round(clamp(baseConfidence + 0.05, 0.5, 0.98), 6),
      observedAt: alert.observedAt,
    });
  }

  const dedupedByKey = new Map<string, ForensicsSignalInput>();
  for (const signal of derivedSignals) {
    const key = `${signal.sourceId}::${signal.signalType}::${signal.region || 'global'}`;
    const existing = dedupedByKey.get(key);
    if (!existing || signal.value > existing.value) {
      dedupedByKey.set(key, signal);
    }
  }

  const outputSignals = Array.from(dedupedByKey.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_DERIVED_SIGNALS);

  const componentCount = countComponents(nodes.length, edges, EDGE_THRESHOLD);
  return {
    derivedSignals: outputSignals,
    diagnostics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      componentCount,
      beta1,
      tsi: round(tsi, 4),
      derivedSignalCount: outputSignals.length,
    },
  };
}
