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

export interface FinancialTopologyDiagnostics {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  beta1: number;
  tsi: number;
  derivedSignalCount: number;
  hyperedgeCount: number;
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
const MAX_FINANCIAL_NODES = 40;
const MAX_DERIVED_SIGNALS = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

interface PersistencePair {
  birth: number;
  death: number | null;
  persistence: number;
}

function computePersistentHomology(nodes: TopologyNode[]) {
  const numNodes = nodes.length;
  const distanceMatrix = Array.from({ length: numNodes }, () => new Float64Array(numNodes).fill(0));

  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      const left = nodes[i]!;
      const right = nodes[j]!;
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

      const dist = 1 - score;
      distanceMatrix[i]![j] = dist;
      distanceMatrix[j]![i] = dist;
    }
  }

  interface Simplex {
    dim: number;
    vertices: number[];
    weight: number;
  }

  const simplices: Simplex[] = [];
  for (let i = 0; i < numNodes; i++) {
    simplices.push({ dim: 0, vertices: [i], weight: 0 });
  }

  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      simplices.push({ dim: 1, vertices: [i, j], weight: distanceMatrix[i]![j]! });
    }
  }

  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      for (let k = j + 1; k < numNodes; k++) {
        const w = Math.max(distanceMatrix[i]![j]!, distanceMatrix[j]![k]!, distanceMatrix[i]![k]!);
        simplices.push({ dim: 2, vertices: [i, j, k], weight: w });
      }
    }
  }

  simplices.sort((a, b) => {
    if (Math.abs(a.weight - b.weight) > 1e-9) return a.weight - b.weight;
    return a.dim - b.dim;
  });

  const getVertexKey = (v: number[]): number => {
    if (v.length === 1) return v[0]!;
    if (v.length === 2) return v[0]! + (v[1]! << 6);
    if (v.length === 3) return v[0]! + (v[1]! << 6) + (v[2]! << 12);
    return 0;
  };

  const vertexToId = new Map<number, number>();
  for (let i = 0; i < simplices.length; i++) {
    vertexToId.set(getVertexKey(simplices[i]!.vertices), i);
  }

  const getBoundary = (vertices: number[]): number[] => {
    const boundary: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const face: number[] = [];
      for (let j = 0; j < vertices.length; j++) {
        if (j !== i) face.push(vertices[j]!);
      }
      const faceIndex = vertexToId.get(getVertexKey(face));
      if (faceIndex !== undefined) {
        boundary.push(faceIndex);
      }
    }
    return boundary.sort((a, b) => b - a);
  };

  const pivot = new Map<number, number>(); 
  const V: number[][] = []; 
  
  const h0Pairs: PersistencePair[] = [];
  const h1Pairs: PersistencePair[] = [];
  
  const symDiff = (a: number[], b: number[]): number[] => {
    const res: number[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++; j++;
      } else if (a[i]! > b[j]!) {
        res.push(a[i]!); i++;
      } else {
        res.push(b[j]!); j++;
      }
    }
    while (i < a.length) res.push(a[i++]!);
    while (j < b.length) res.push(b[j++]!);
    return res;
  };

  const createdBy = new Array(simplices.length).fill(true);

  for (let j = 0; j < simplices.length; j++) {
    let col = getBoundary(simplices[j]!.vertices);
    
    while (col.length > 0) {
      const low = col[0]!;
      if (pivot.has(low)) {
        const k = pivot.get(low)!;
        col = symDiff(col, V[k]!);
      } else {
        break;
      }
    }
    
    V.push(col);
    
    if (col.length === 0) {
      createdBy[j] = true;
    } else {
      const i = col[0]!;
      pivot.set(i, j);
      createdBy[j] = false;
      createdBy[i] = false;
      
      const birthWeight = simplices[i]!.weight;
      const deathWeight = simplices[j]!.weight;
      const persistence = deathWeight - birthWeight;
      
      if (persistence > 1e-6) {
        if (simplices[i]!.dim === 0) {
          h0Pairs.push({ birth: birthWeight, death: deathWeight, persistence });
        } else if (simplices[i]!.dim === 1) {
          h1Pairs.push({ birth: birthWeight, death: deathWeight, persistence });
        }
      }
    }
  }

  for (let j = 0; j < simplices.length; j++) {
    if (createdBy[j]) {
      const birth = simplices[j]!.weight;
      const death = 1.0; 
      const persistence = death - birth;
      if (persistence > 1e-6) {
        if (simplices[j]!.dim === 0) {
          h0Pairs.push({ birth, death: null, persistence });
        } else if (simplices[j]!.dim === 1) {
          h1Pairs.push({ birth, death: null, persistence });
        }
      }
    }
  }

  return { h0Pairs, h1Pairs, distanceMatrix };
}

function triangleStrengthByNode(numNodes: number, edges: {a: number, b: number, weight: number}[]): { cycleStrength: number[]; cycleCount: number[] } {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    weights.set(`\${edge.a}:\${edge.b}`, edge.weight);
    weights.set(`\${edge.b}:\${edge.a}`, edge.weight);
  }

  const cycleStrength = new Array<number>(numNodes).fill(0);
  const cycleCount = new Array<number>(numNodes).fill(0);

  for (let i = 0; i < numNodes; i += 1) {
    for (let j = i + 1; j < numNodes; j += 1) {
      const wij = weights.get(`\${i}:\${j}`);
      if (!wij) continue;
      for (let k = j + 1; k < numNodes; k += 1) {
        const wik = weights.get(`\${i}:\${k}`);
        const wjk = weights.get(`\${j}:\${k}`);
        if (!wik || !wjk) continue;
        const triangleStrength = (wij + wik + wjk) / 3;
        cycleStrength[i] = (cycleStrength[i] ?? 0) + triangleStrength;
        cycleStrength[j] = (cycleStrength[j] ?? 0) + triangleStrength;
        cycleStrength[k] = (cycleStrength[k] ?? 0) + triangleStrength;
        cycleCount[i] = (cycleCount[i] ?? 0) + 1;
        cycleCount[j] = (cycleCount[j] ?? 0) + 1;
        cycleCount[k] = (cycleCount[k] ?? 0) + 1;
      }
    }
  }

  return { cycleStrength, cycleCount };
}

const HYPEREDGE_WINDOW_MS = 4 * 60 * 60 * 1000;
const HYPEREDGE_MIN_SIMILARITY = 0.6;
const HYPEREDGE_MIN_DISTINCT_DOMAINS = 3;
const MAX_HYPEREDGES = 20;

interface Hyperedge {
  nodeIndices: number[];
  avgPairwiseSimilarity: number;
  domains: Set<string>;
}

function detectCoordinationHyperedges(
  nodes: TopologyNode[],
  distanceMatrix: Float64Array[],
): Hyperedge[] {
  const numNodes = nodes.length;
  if (numNodes < HYPEREDGE_MIN_DISTINCT_DOMAINS) return [];

  const hyperedges: Hyperedge[] = [];

  // Enumerate triples
  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      const simIJ = 1 - (distanceMatrix[i]![j] ?? 1);
      if (simIJ < HYPEREDGE_MIN_SIMILARITY) continue;

      for (let k = j + 1; k < numNodes; k++) {
        const simIK = 1 - (distanceMatrix[i]![k] ?? 1);
        const simJK = 1 - (distanceMatrix[j]![k] ?? 1);
        if (simIK < HYPEREDGE_MIN_SIMILARITY || simJK < HYPEREDGE_MIN_SIMILARITY) continue;

        // Time window check
        const obs = [nodes[i]!.observedAt, nodes[j]!.observedAt, nodes[k]!.observedAt];
        const windowSpan = Math.max(...obs) - Math.min(...obs);
        if (windowSpan > HYPEREDGE_WINDOW_MS) continue;

        const domains = new Set([nodes[i]!.domain, nodes[j]!.domain, nodes[k]!.domain]);
        if (domains.size < HYPEREDGE_MIN_DISTINCT_DOMAINS) continue;

        const avgSim3 = (simIJ + simIK + simJK) / 3;
        const triple: Hyperedge = { nodeIndices: [i, j, k], avgPairwiseSimilarity: avgSim3, domains };

        // Attempt to grow to 4-node group
        for (let l = k + 1; l < numNodes; l++) {
          const simIL = 1 - (distanceMatrix[i]![l] ?? 1);
          const simJL = 1 - (distanceMatrix[j]![l] ?? 1);
          const simKL = 1 - (distanceMatrix[k]![l] ?? 1);
          if (simIL < HYPEREDGE_MIN_SIMILARITY || simJL < HYPEREDGE_MIN_SIMILARITY || simKL < HYPEREDGE_MIN_SIMILARITY) continue;

          const obsL = nodes[l]!.observedAt;
          const allObs = [...obs, obsL];
          if (Math.max(...allObs) - Math.min(...allObs) > HYPEREDGE_WINDOW_MS) continue;

          const domains4 = new Set([...domains, nodes[l]!.domain]);
          if (domains4.size < HYPEREDGE_MIN_DISTINCT_DOMAINS) continue;

          const avgSim4 = (simIJ + simIK + simJK + simIL + simJL + simKL) / 6;
          hyperedges.push({ nodeIndices: [i, j, k, l], avgPairwiseSimilarity: avgSim4, domains: domains4 });
          break; // one 4-node extension per triple
        }

        // Only add the triple if we didn't already add a 4-node group from it
        const alreadyExtended = hyperedges.some(
          (h) => h.nodeIndices.length === 4 && [i, j, k].every((idx) => h.nodeIndices.includes(idx)),
        );
        if (!alreadyExtended) {
          hyperedges.push(triple);
        }

        if (hyperedges.length >= MAX_HYPEREDGES) break;
      }
      if (hyperedges.length >= MAX_HYPEREDGES) break;
    }
    if (hyperedges.length >= MAX_HYPEREDGES) break;
  }

  // Deduplicate: remove subsets
  const deduped: Hyperedge[] = [];
  for (const candidate of hyperedges) {
    const cSet = new Set(candidate.nodeIndices);
    const isSubset = deduped.some((existing) => {
      const eSet = new Set(existing.nodeIndices);
      for (const idx of cSet) {
        if (!eSet.has(idx)) return false;
      }
      return true;
    });
    if (!isSubset) deduped.push(candidate);
    if (deduped.length >= MAX_HYPEREDGES) break;
  }

  return deduped;
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
        hyperedgeCount: 0,
      },
    };
  }

  const { h0Pairs, h1Pairs, distanceMatrix } = computePersistentHomology(nodes);

  const numNodes = nodes.length;
  let edgeCount = 0;
  const degreeStrength = new Array<number>(numNodes).fill(0);
  const edges: {a: number, b: number, weight: number}[] = [];

  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      const dist = distanceMatrix[i]![j]!;
      const weight = 1 - dist;
      if (weight >= EDGE_THRESHOLD) {
        edgeCount++;
        degreeStrength[i] = (degreeStrength[i] ?? 0) + weight;
        degreeStrength[j] = (degreeStrength[j] ?? 0) + weight;
        edges.push({ a: i, b: j, weight });
      }
    }
  }

  const { cycleStrength, cycleCount } = triangleStrengthByNode(numNodes, edges);

  const totalH0Persistence = h0Pairs.reduce((sum, p) => sum + p.persistence, 0);
  const totalH1Persistence = h1Pairs.reduce((sum, p) => sum + p.persistence, 0);

  const h0Norm = totalH0Persistence / Math.max(1, numNodes - 1);
  const h1Norm = totalH1Persistence / Math.max(1, numNodes / 2);
  const tsi = clamp((h0Norm * 40) + (h1Norm * 60), 0, 100);

  const robustCycles = h1Pairs.filter(p => p.persistence > 0.05).length;
  const beta1 = robustCycles;

  const maxDegree = Math.max(...degreeStrength, 1);
  const maxCycle = Math.max(...cycleStrength, 1);
  const maxObservedAt = Math.max(...nodes.map((node) => node.observedAt), Date.now());
  const domain = FINANCIAL_DOMAIN_HINTS.has(runDomain.toLowerCase()) ? runDomain : 'market';
  const edgeDensity = edgeCount / Math.max(1, (numNodes * (numNodes - 1)) / 2);
  const baseConfidence = clamp(0.55 + (0.35 * edgeDensity), 0.55, 0.95);

  const derivedSignals: ForensicsSignalInput[] = [];

  derivedSignals.push({
    sourceId: `topology:tsi:\${domain}`,
    region: 'global',
    domain,
    signalType: 'topology_tsi',
    value: round(tsi, 4),
    confidence: round(baseConfidence, 6),
    observedAt: maxObservedAt,
    evidenceIds: [],
  });

  derivedSignals.push({
    sourceId: `topology:beta1:\${domain}`,
    region: 'global',
    domain,
    signalType: 'topology_beta1',
    value: round(totalH1Persistence, 4),
    confidence: round(clamp(baseConfidence - 0.05, 0.45, 0.9), 6),
    observedAt: maxObservedAt,
    evidenceIds: [],
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
        evidenceIds: [],
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
        evidenceIds: [],
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
      sourceId: `topology:region:\${alert.region.toLowerCase()}`,
      region: alert.region,
      domain,
      signalType: 'topology_cycle_risk',
      value: round(alert.risk, 4),
      confidence: round(clamp(baseConfidence + 0.05, 0.5, 0.98), 6),
      observedAt: alert.observedAt,
      evidenceIds: [],
    });
  }

  // Hyperedge coordination detection
  const hyperedges = detectCoordinationHyperedges(nodes, distanceMatrix);
  if (hyperedges.length > 0) {
    const participatingNodeIndices = new Set(hyperedges.flatMap((h) => h.nodeIndices));
    const hyperedgeDensity = participatingNodeIndices.size / numNodes;
    const avgSim = hyperedges.reduce((sum, h) => sum + h.avgPairwiseSimilarity, 0) / hyperedges.length;

    derivedSignals.push({
      sourceId: `topology:hyperedge:\${domain}`,
      region: 'global',
      domain,
      signalType: 'topology_hyperedge_density',
      value: round(hyperedgeDensity * 100, 4),
      confidence: round(clamp(baseConfidence - 0.05, 0.45, 0.92), 6),
      observedAt: maxObservedAt,
      evidenceIds: [],
    });

    derivedSignals.push({
      sourceId: `topology:crossdomain:\${domain}`,
      region: 'global',
      domain,
      signalType: 'topology_cross_domain_sync',
      value: round(avgSim * 100, 4),
      confidence: round(clamp(baseConfidence - 0.05, 0.45, 0.92), 6),
      observedAt: maxObservedAt,
      evidenceIds: [],
    });
  }

  const dedupedByKey = new Map<string, ForensicsSignalInput>();
  for (const signal of derivedSignals) {
    const key = `\${signal.sourceId}::\${signal.signalType}::\${signal.region || 'global'}`;
    const existing = dedupedByKey.get(key);
    if (!existing || signal.value > existing.value) {
      dedupedByKey.set(key, signal);
    }
  }

  const outputSignals = Array.from(dedupedByKey.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_DERIVED_SIGNALS);

  return {
    derivedSignals: outputSignals,
    diagnostics: {
      nodeCount: numNodes,
      edgeCount,
      componentCount: h0Pairs.filter(p => p.death === null).length,
      beta1,
      tsi: round(tsi, 4),
      derivedSignalCount: outputSignals.length,
      hyperedgeCount: hyperedges.length,
    },
  };
}