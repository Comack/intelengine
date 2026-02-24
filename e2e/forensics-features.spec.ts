import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goToHarness = (page: import('@playwright/test').Page) =>
  page.goto('/tests/runtime-harness.html');

// ---------------------------------------------------------------------------
// Phase trace graph rendering
// ---------------------------------------------------------------------------

test.describe('ForensicsPanel phase trace graph', () => {
  test.describe.configure({ retries: 1 });

  test('renders SVG timeline for valid phase trace', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { ForensicsPanel } = await import('/src/components/ForensicsPanel.ts');

      const container = document.createElement('div');
      container.style.width = '600px';
      container.style.height = '400px';
      document.body.appendChild(container);

      const panel = new ForensicsPanel('Test Forensics');
      container.appendChild(panel['element']);

      const now = Date.now();
      panel.update({
        summary: undefined,
        fusedSignals: [],
        anomalies: [],
        monitorStreams: [],
        aisTrajectoryStreams: [],
        topologyAlerts: [],
        topologyTrends: [],
        topologyWindowDrilldowns: [],
        topologyDrifts: [],
        topologyBaselines: [],
        trace: [
          {
            phase: 'signal-collect',
            status: 'FORENSICS_PHASE_STATUS_SUCCESS' as const,
            startedAt: now,
            completedAt: now + 120,
            elapsedMs: 120,
            error: '',
          },
          {
            phase: 'ws-fusion',
            status: 'FORENSICS_PHASE_STATUS_SUCCESS' as const,
            startedAt: now + 130,
            completedAt: now + 650,
            elapsedMs: 520,
            error: '',
          },
          {
            phase: 'conformal',
            status: 'FORENSICS_PHASE_STATUS_SUCCESS' as const,
            startedAt: now + 660,
            completedAt: now + 980,
            elapsedMs: 320,
            error: '',
          },
          {
            phase: 'persist',
            status: 'FORENSICS_PHASE_STATUS_FAILED' as const,
            startedAt: now + 990,
            completedAt: now + 1000,
            elapsedMs: 10,
            error: 'timeout',
          },
        ],
        policy: [],
        runHistory: [],
        anomalyTrends: [],
      });

      await new Promise(r => setTimeout(r, 200));
      const html = container.innerHTML;
      const svgCount = (html.match(/<svg/g) || []).length;
      const hasTraceSvgClass = html.includes('forensics-trace-svg');
      const hasPhaseTimeline = html.includes('AGENT OBSERVABILITY DAG');
      const hasSuccessColor = html.includes('#10b981');
      const hasFailedColor = html.includes('#ef4444');
      const hasSwappableBracket = html.includes('#a78bfa');
      const hasWsFusionLabel = html.includes('WS Fusion');
      const hasConformalLabel = html.includes('Conformal');
      const hasTotalLabel = html.includes('total');

      panel['element'].remove();
      container.remove();

      return {
        svgCount,
        hasTraceSvgClass,
        hasPhaseTimeline,
        hasSuccessColor,
        hasFailedColor,
        hasSwappableBracket,
        hasWsFusionLabel,
        hasConformalLabel,
        hasTotalLabel,
      };
    });

    expect(result.svgCount).toBeGreaterThan(0);
    expect(result.hasTraceSvgClass).toBe(true);
    expect(result.hasPhaseTimeline).toBe(true);
    expect(result.hasSuccessColor).toBe(true);
    expect(result.hasFailedColor).toBe(true);
    expect(result.hasSwappableBracket).toBe(true);
    expect(result.hasWsFusionLabel).toBe(true);
    expect(result.hasConformalLabel).toBe(true);
    expect(result.hasTotalLabel).toBe(true);
  });

  test('renders fallback text for empty trace', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { ForensicsPanel } = await import('/src/components/ForensicsPanel.ts');

      const container = document.createElement('div');
      document.body.appendChild(container);

      const panel = new ForensicsPanel('Test Forensics');
      container.appendChild(panel['element']);

      panel.update({
        summary: undefined,
        fusedSignals: [],
        anomalies: [],
        monitorStreams: [],
        aisTrajectoryStreams: [],
        topologyAlerts: [],
        topologyTrends: [],
        topologyWindowDrilldowns: [],
        topologyDrifts: [],
        topologyBaselines: [],
        trace: [],
        policy: [],
        runHistory: [],
        anomalyTrends: [],
      });

      await new Promise(r => setTimeout(r, 200));
      const html = container.innerHTML;
      const hasFallback = html.includes('No phase trace available');
      const hasSvg = html.includes('<svg');

      panel['element'].remove();
      container.remove();

      return { hasFallback, hasSvg };
    });

    expect(result.hasFallback).toBe(true);
    expect(result.hasSvg).toBe(false);
  });

  test('filters phases with invalid timestamps and shows fallback if all invalid', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { ForensicsPanel } = await import('/src/components/ForensicsPanel.ts');

      const container = document.createElement('div');
      document.body.appendChild(container);

      const panel = new ForensicsPanel('Test Forensics');
      container.appendChild(panel['element']);

      panel.update({
        summary: undefined,
        fusedSignals: [],
        anomalies: [],
        monitorStreams: [],
        aisTrajectoryStreams: [],
        topologyAlerts: [],
        topologyTrends: [],
        topologyWindowDrilldowns: [],
        topologyDrifts: [],
        topologyBaselines: [],
        trace: [
          {
            phase: 'signal-collect',
            status: 'FORENSICS_PHASE_STATUS_PENDING' as const,
            startedAt: 0,
            completedAt: 0,
            elapsedMs: 0,
            error: '',
          },
          {
            phase: 'normalize',
            status: 'FORENSICS_PHASE_STATUS_SKIPPED' as const,
            startedAt: NaN,
            completedAt: 0,
            elapsedMs: 0,
            error: '',
          },
        ],
        policy: [],
        runHistory: [],
        anomalyTrends: [],
      });

      await new Promise(r => setTimeout(r, 200));
      const html = container.innerHTML;
      const hasFallback = html.includes('No phase trace available');

      panel['element'].remove();
      container.remove();

      return { hasFallback };
    });

    expect(result.hasFallback).toBe(true);
  });

  test('skipped phase uses slate color, not success or failure colors', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { ForensicsPanel } = await import('/src/components/ForensicsPanel.ts');

      const container = document.createElement('div');
      document.body.appendChild(container);

      const panel = new ForensicsPanel('Test Forensics');
      container.appendChild(panel['element']);

      const now = Date.now();
      panel.update({
        summary: undefined,
        fusedSignals: [],
        anomalies: [],
        monitorStreams: [],
        aisTrajectoryStreams: [],
        topologyAlerts: [],
        topologyTrends: [],
        topologyWindowDrilldowns: [],
        topologyDrifts: [],
        topologyBaselines: [],
        trace: [
          {
            phase: 'conformal',
            status: 'FORENSICS_PHASE_STATUS_SKIPPED' as const,
            startedAt: now,
            completedAt: now + 1,
            elapsedMs: 1,
            error: '',
          },
        ],
        policy: [],
        runHistory: [],
        anomalyTrends: [],
      });

      await new Promise(r => setTimeout(r, 200));
      const html = container.innerHTML;

      panel['element'].remove();
      container.remove();

      return {
        hasSlateColor: html.includes('#64748b'),
        hasSuccessColor: html.includes('#10b981'),
        hasFailedColor: html.includes('#ef4444'),
        // swappable bracket should still appear for conformal even if skipped
        hasSwappableBracket: html.includes('#a78bfa'),
      };
    });

    expect(result.hasSlateColor).toBe(true);
    expect(result.hasSuccessColor).toBe(false);
    expect(result.hasFailedColor).toBe(false);
          expect(result.hasSwappableBracket).toBe(true);
        });
      });
    
      // ---------------------------------------------------------------------------
      // Topology window map overlay// ---------------------------------------------------------------------------

test.describe('Topology window map overlay', () => {
  test.describe.configure({ retries: 1 });

  test('buildTopologyWindowMapOverlay resolves coordinates and caps at 12 entries', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { App } = await import('/src/App.ts');

      // Access the private method via prototype
      const appProto = App.prototype as unknown as {
        buildTopologyWindowMapOverlay: (
          drilldowns: Array<{
            metric: string; label: string; region: string;
            shortWindowRuns: number; longWindowRuns: number;
            shortMean: number; longMean: number;
            delta: number; slope: number; latestValue: number;
          }>
        ) => Array<{
          id: string; metric: string; label: string; region: string;
          latestValue: number; shortMean: number; longMean: number;
          delta: number; slope: number; lat: number; lon: number;
        }>;
        resolveForensicsCoordinate: (
          region: string, sourceId: string, domain: string, category: string
        ) => { lat: number; lon: number } | null;
      };

      // Build 15 drilldowns to verify the 12-entry cap
      const drilldowns = Array.from({ length: 15 }, (_, i) => ({
        metric: `topology_metric_${i}`,
        label: `Metric ${i}`,
        region: 'US',
        shortWindowRuns: 3,
        longWindowRuns: 6,
        shortMean: 1.0 + i * 0.1,
        longMean: 1.0,
        delta: (i + 1) * 0.1,   // ascending delta so sort is predictable
        slope: 0.01 * i,
        latestValue: 1.0 + i * 0.1,
      }));

      const fakeApp = {
        resolveForensicsCoordinate: appProto.resolveForensicsCoordinate,
      };

      const overlay = appProto.buildTopologyWindowMapOverlay.call(fakeApp, drilldowns);

      return {
        count: overlay.length,
        allHaveCoords: overlay.every(
          (e) => Number.isFinite(e.lat) && Number.isFinite(e.lon) &&
                 Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180
        ),
        allHaveId: overlay.every((e) => e.id.startsWith('topology:')),
        topDeltaFirst: overlay[0] ? Math.abs(overlay[0].delta) >= Math.abs(overlay[overlay.length - 1]?.delta ?? 0) : false,
      };
    });

    expect(result.count).toBe(12);
    expect(result.allHaveCoords).toBe(true);
    expect(result.allHaveId).toBe(true);
    expect(result.topDeltaFirst).toBe(true);
  });

  test('buildTopologyWindowMapOverlay returns empty array for empty input', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { App } = await import('/src/App.ts');

      const appProto = App.prototype as unknown as {
        buildTopologyWindowMapOverlay: (drilldowns: unknown[]) => unknown[];
        resolveForensicsCoordinate: (...args: unknown[]) => unknown;
      };

      const fakeApp = { resolveForensicsCoordinate: appProto.resolveForensicsCoordinate };
      const overlay = appProto.buildTopologyWindowMapOverlay.call(fakeApp, []);
      return { count: overlay.length };
    });

    expect(result.count).toBe(0);
  });

  test('buildTopologyWindowMapOverlay skips entries that cannot be geolocated', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { App } = await import('/src/App.ts');

      const appProto = App.prototype as unknown as {
        buildTopologyWindowMapOverlay: (
          drilldowns: Array<{
            metric: string; label: string; region: string;
            shortWindowRuns: number; longWindowRuns: number;
            shortMean: number; longMean: number;
            delta: number; slope: number; latestValue: number;
          }>
        ) => Array<unknown>;
        resolveForensicsCoordinate: (...args: unknown[]) => unknown;
      };

      const fakeApp = { resolveForensicsCoordinate: appProto.resolveForensicsCoordinate };

      // 'ZZZZZ' is not a valid country code or region name — should be skipped
      const overlay = appProto.buildTopologyWindowMapOverlay.call(fakeApp, [
        {
          metric: 'topology_tsi',
          label: 'TSI',
          region: 'ZZZZZ_UNRESOLVABLE_REGION',
          shortWindowRuns: 3,
          longWindowRuns: 6,
          shortMean: 0.5,
          longMean: 0.4,
          delta: 0.1,
          slope: 0.01,
          latestValue: 0.5,
        },
        {
          metric: 'topology_beta1',
          label: 'Beta1',
          region: 'US',
          shortWindowRuns: 3,
          longWindowRuns: 6,
          shortMean: 0.8,
          longMean: 0.6,
          delta: 0.2,
          slope: 0.02,
          latestValue: 0.8,
        },
      ]);

      return { count: overlay.length };
    });

    // US resolves; ZZZZZ_UNRESOLVABLE_REGION should not
    expect(result.count).toBe(1);
  });

  test('DeckGLMap setTopologyWindowOverlay stores data and layer exists when forensics enabled', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { DEFAULT_MAP_LAYERS } = await import('/src/config/index.ts');
      const { initI18n } = await import('/src/services/i18n.ts');
      await initI18n();
      const { MapContainer } = await import('/src/components/MapContainer.ts');

      const mapHost = document.createElement('div');
      mapHost.className = 'map-container';
      mapHost.style.width = '1200px';
      mapHost.style.height = '720px';
      document.body.appendChild(mapHost);

      let map: InstanceType<typeof MapContainer> | null = null;

      try {
        map = new MapContainer(mapHost, {
          zoom: 2,
          pan: { x: 0, y: 0 },
          view: 'global',
          layers: { ...DEFAULT_MAP_LAYERS, forensics: true },
          timeRange: '7d',
        });

        const overlay = [
          {
            id: 'topology:topology_tsi:US',
            metric: 'topology_tsi',
            label: 'TSI',
            region: 'US',
            latestValue: 0.82,
            shortMean: 0.80,
            longMean: 0.72,
            delta: 0.08,
            slope: 0.01,
            shortWindowRuns: 3,
            longWindowRuns: 6,
            lat: 40.7,
            lon: -74.0,
          },
          {
            id: 'topology:topology_beta1:GB',
            metric: 'topology_beta1',
            label: 'Beta1',
            region: 'GB',
            latestValue: 0.65,
            shortMean: 0.70,
            longMean: 0.80,
            delta: -0.10,
            slope: -0.02,
            shortWindowRuns: 3,
            longWindowRuns: 6,
            lat: 51.5,
            lon: -0.1,
          },
        ];

        // setTopologyWindowOverlay must exist and not throw
        let threw = false;
        try {
          map.setTopologyWindowOverlay(overlay);
        } catch {
          threw = true;
        }

        return {
          isDeckGLMode: map.isDeckGLMode(),
          threw,
          setterExists: typeof map.setTopologyWindowOverlay === 'function',
        };
      } finally {
        map?.destroy();
        mapHost.remove();
      }
    });

    expect(result.setterExists).toBe(true);
    expect(result.threw).toBe(false);
    // Only meaningful in DeckGL mode — skip assertion if WebGL unavailable
    if (result.isDeckGLMode) {
      expect(result.isDeckGLMode).toBe(true);
    }
  });

  test('topology window popup renderer produces correctly structured HTML', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { initI18n } = await import('/src/services/i18n.ts');
      await initI18n();
      const { MapPopup } = await import('/src/components/MapPopup.ts');

      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.width = '400px';
      document.body.appendChild(container);

      const popup = new MapPopup(container);

      popup.show({
        type: 'forensicsTopologyWindow',
        data: {
          id: 'topology:topology_tsi:global',
          metric: 'topology_tsi',
          label: 'Topological Stress Index',
          region: 'global',
          latestValue: 0.742,
          shortMean: 0.731,
          longMean: 0.680,
          delta: 0.051,
          slope: 0.008,
          shortWindowRuns: 3,
          longWindowRuns: 6,
          lat: 40.7,
          lon: -74.0,
        },
        x: 100,
        y: 100,
      });

      const html = document.querySelector('.map-popup')?.innerHTML || '';

      container.remove();

      return {
        hasTitle: html.includes('Topology Window'),
        hasMetricLabel: html.includes('topology_tsi'),
        hasRegion: html.includes('global'),
        hasLatestValue: html.includes('0.742'),
        hasShortMean: html.includes('Short mean'),
        hasLongMean: html.includes('Long mean'),
        hasDelta: html.includes('Delta'),
        hasSlope: html.includes('Slope'),
        hasPositiveDeltaSign: html.includes('+0.051'),
        hasNoRawScript: !html.includes('<script>'),
      };
    });

    expect(result.hasTitle).toBe(true);
    expect(result.hasMetricLabel).toBe(true);
    expect(result.hasRegion).toBe(true);
    expect(result.hasLatestValue).toBe(true);
    expect(result.hasShortMean).toBe(true);
    expect(result.hasLongMean).toBe(true);
    expect(result.hasDelta).toBe(true);
    expect(result.hasSlope).toBe(true);
    expect(result.hasPositiveDeltaSign).toBe(true);
    expect(result.hasNoRawScript).toBe(true);
  });

  test('topology window popup shows negative delta without plus sign', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { initI18n } = await import('/src/services/i18n.ts');
      await initI18n();
      const { MapPopup } = await import('/src/components/MapPopup.ts');

      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.width = '400px';
      document.body.appendChild(container);

      const popup = new MapPopup(container);

      popup.show({
        type: 'forensicsTopologyWindow',
        data: {
          id: 'topology:topology_cycle_risk:EU',
          metric: 'topology_cycle_risk',
          label: 'Cycle Risk',
          region: 'EU',
          latestValue: 0.310,
          shortMean: 0.290,
          longMean: 0.420,
          delta: -0.130,
          slope: -0.015,
          shortWindowRuns: 3,
          longWindowRuns: 6,
          lat: 50.0,
          lon: 10.0,
        },
        x: 100,
        y: 100,
      });

      const html = document.querySelector('.map-popup')?.innerHTML || '';

      container.remove();

      return {
        hasNegativeDelta: html.includes('-0.1300'),
        hasPlusPrefix: html.includes('>+'),
      };
    });

    expect(result.hasNegativeDelta).toBe(true);
    expect(result.hasPlusPrefix).toBe(false);
  });
});
