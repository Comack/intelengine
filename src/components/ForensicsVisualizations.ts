import * as d3 from 'd3';
import type { ForensicsCausalEdge, ForensicsCalibratedAnomaly } from '@/generated/client/worldmonitor/intelligence/v1/service_client';

export function renderCausalDag(
  containerSelector: string,
  causalEdges: ForensicsCausalEdge[],
  anomalies: ForensicsCalibratedAnomaly[],
): void {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  container.innerHTML = '';

  if (causalEdges.length === 0) {
    container.innerHTML = '<div class="forensics-empty">No causal edges discovered yet.</div>';
    return;
  }

  const flaggedTypes = new Set(
    anomalies.filter((a) => a.isAnomaly).map((a) => a.signalType)
  );

  const width = container.clientWidth || 400;
  const height = 300;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const nodesMap = new Map<string, { id: string; isHot: boolean }>();
  causalEdges.forEach(edge => {
    if (!nodesMap.has(edge.causeSignalType)) {
      nodesMap.set(edge.causeSignalType, { id: edge.causeSignalType, isHot: flaggedTypes.has(edge.causeSignalType) });
    }
    if (!nodesMap.has(edge.effectSignalType)) {
      nodesMap.set(edge.effectSignalType, { id: edge.effectSignalType, isHot: flaggedTypes.has(edge.effectSignalType) });
    }
  });

  const nodes = Array.from(nodesMap.values());
  const links = causalEdges.map(edge => ({
    source: edge.causeSignalType,
    target: edge.effectSignalType,
    score: edge.causalScore,
    delay: edge.delayMs
  }));

  const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
    .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));

  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 18)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#94a3b8');

  const link = svg.append('g')
    .attr('stroke', '#475569')
    .attr('stroke-opacity', 0.6)
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-width', d => Math.max(1, d.score * 3))
    .attr('marker-end', 'url(#arrow)');

  const nodeGroup = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(d3.drag()
      .on('start', (e, d: any) => {
        if (!e.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (e, d: any) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on('end', (e, d: any) => {
        if (!e.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }) as any);

  nodeGroup.append('circle')
    .attr('r', 8)
    .attr('fill', d => d.isHot ? '#ef4444' : '#3b82f6')
    .attr('stroke', '#1e293b')
    .attr('stroke-width', 2);

  nodeGroup.append('text')
    .text(d => d.id.replace(/_/g, ' '))
    .attr('x', 12)
    .attr('y', 4)
    .attr('font-size', '10px')
    .attr('fill', '#cbd5e1')
    .attr('font-family', 'monospace');

  simulation.on('tick', () => {
    link
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    nodeGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
  });
}

export function renderPoleGraph(
  containerSelector: string,
  poleData: any
): void {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  container.innerHTML = '';

  const { persons = [], objects = [], locations = [], events = [] } = poleData;
  if (!persons.length && !objects.length && !locations.length && !events.length) {
    container.innerHTML = '<div class="forensics-empty">No POLE entities extracted.</div>';
    return;
  }

  const width = container.clientWidth || 400;
  const height = 300;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const nodes: any[] = [];
  const links: any[] = [];

  const addNodes = (items: any[], type: string, color: string) => {
    items.forEach((item, index) => {
      const id = `${type}_${index}`;
      nodes.push({ id, label: item.name || item.type || id, type, color });
      // Implicitly link everything to the first event or central node to form a graph
      if (type !== 'event' && events.length > 0) {
        links.push({ source: id, target: `event_0` });
      } else if (type === 'event' && index > 0) {
        links.push({ source: id, target: `event_0` });
      }
    });
  };

  addNodes(events, 'event', '#ef4444');    // Red
  addNodes(persons, 'person', '#3b82f6');  // Blue
  addNodes(objects, 'object', '#f97316');  // Orange
  addNodes(locations, 'location', '#22c55e'); // Green

  // Fallback links if no events
  if (events.length === 0 && nodes.length > 1) {
    for (let i = 1; i < nodes.length; i++) {
      links.push({ source: nodes[i].id, target: nodes[0].id });
    }
  }

  const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
    .force('link', d3.forceLink(links).id((d: any) => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const link = svg.append('g')
    .attr('stroke', '#475569')
    .attr('stroke-opacity', 0.6)
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-width', 1.5);

  const nodeGroup = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(d3.drag()
      .on('start', (e, d: any) => {
        if (!e.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (e, d: any) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on('end', (e, d: any) => {
        if (!e.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }) as any);

  nodeGroup.append('circle')
    .attr('r', 10)
    .attr('fill', d => d.color)
    .attr('stroke', '#1e293b')
    .attr('stroke-width', 2);

  nodeGroup.append('text')
    .text(d => d.label)
    .attr('x', 14)
    .attr('y', 4)
    .attr('font-size', '10px')
    .attr('fill', '#cbd5e1')
    .attr('font-family', 'sans-serif');

  simulation.on('tick', () => {
    link
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    nodeGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
  });
}

export function renderConvergenceRadar(
  containerSelector: string,
  topics: string[]
): void {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  container.innerHTML = '';
  
  const width = container.clientWidth || 300;
  const height = 150;
  
  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  if (topics.length >= 3) {
    const r = 40;
    const cx = width / 2;
    const cy = height / 2;
    
    const centers = [
      { x: cx, y: cy - 20, color: 'rgba(59, 130, 246, 0.4)' },
      { x: cx - 25, y: cy + 15, color: 'rgba(239, 68, 68, 0.4)' },
      { x: cx + 25, y: cy + 15, color: 'rgba(34, 197, 94, 0.4)' }
    ];

    svg.selectAll('circle')
      .data(centers)
      .enter()
      .append('circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', r)
      .attr('fill', d => d.color)
      .attr('stroke', d => d.color.replace('0.4', '1.0'))
      .attr('stroke-width', 2);
      
    svg.selectAll('text')
      .data(topics.slice(0, 3))
      .enter()
      .append('text')
      .attr('x', (_d, i) => centers[i]?.x ?? 0)
      .attr('y', (_d, i) => centers[i]?.y ?? 0)
      .text(d => d)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#cbd5e1')
      .attr('font-family', 'sans-serif')
      .style('text-shadow', '1px 1px 2px #000');
  } else {
    container.innerHTML = '<div style="color: #94a3b8; font-size: 12px; padding: 10px;">Overlap data unavailable</div>';
  }
}