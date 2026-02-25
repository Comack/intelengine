import { expect, test } from '@playwright/test';

const goToHarness = (page: import('@playwright/test').Page) =>
  page.goto('/tests/runtime-harness.html');

test.describe('Forensics Visualizations', () => {
  test.describe.configure({ retries: 1 });

  test('renderCausalDag renders nodes and edges correctly', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { renderCausalDag } = await import('/src/components/ForensicsVisualizations.ts');

      const container = document.createElement('div');
      container.id = 'dag-test-container';
      container.style.width = '600px';
      container.style.height = '400px';
      document.body.appendChild(container);

      const causalEdges = [
        { causeSignalType: 'military_surge', effectSignalType: 'market_drop', causalScore: 0.85, delayMs: 3600000, supportCount: 12, conditionalLift: 2.5 },
        { causeSignalType: 'flow_drop', effectSignalType: 'market_drop', causalScore: 0.92, delayMs: 7200000, supportCount: 8, conditionalLift: 3.1 }
      ];

      const anomalies = [
        { signalType: 'military_surge', isAnomaly: true }
      ] as any;

      renderCausalDag('#dag-test-container', causalEdges as any, anomalies);

      await new Promise(r => setTimeout(r, 500)); // wait for D3 simulation
      
      const svg = container.querySelector('svg');
      const nodes = container.querySelectorAll('circle');
      const links = container.querySelectorAll('line');
      const labels = Array.from(container.querySelectorAll('text')).map(t => t.textContent);
      const isMilitaryHot = Array.from(nodes).some(n => n.getAttribute('fill') === '#ef4444' && n.nextElementSibling?.textContent?.includes('military surge'));

      const cleanup = () => container.remove();
      const res = {
        hasSvg: !!svg,
        nodeCount: nodes.length,
        linkCount: links.length,
        labels,
        isMilitaryHot
      };
      cleanup();
      return res;
    });

    expect(result.hasSvg).toBe(true);
    expect(result.nodeCount).toBe(3); // military_surge, market_drop, flow_drop
    expect(result.linkCount).toBe(2);
    expect(result.labels).toContain('military surge');
    expect(result.labels).toContain('market drop');
    expect(result.labels).toContain('flow drop');
    expect(result.isMilitaryHot).toBe(true);
  });

  test('renderPoleGraph renders POLE entities correctly', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { renderPoleGraph } = await import('/src/components/ForensicsVisualizations.ts');

      const container = document.createElement('div');
      container.id = 'pole-test-container';
      container.style.width = '600px';
      container.style.height = '400px';
      document.body.appendChild(container);

      const poleData = {
        persons: [{ name: 'John Doe' }],
        objects: [{ name: 'Laptop' }],
        locations: [{ name: 'London' }],
        events: [{ type: 'Meeting' }]
      };

      renderPoleGraph('#pole-test-container', poleData);

      await new Promise(r => setTimeout(r, 500));
      
      const nodes = container.querySelectorAll('circle');
      const links = container.querySelectorAll('line');
      const labels = Array.from(container.querySelectorAll('text')).map(t => t.textContent);

      const cleanup = () => container.remove();
      const res = {
        nodeCount: nodes.length,
        linkCount: links.length,
        labels
      };
      cleanup();
      return res;
    });

    expect(result.nodeCount).toBe(4);
    expect(result.linkCount).toBe(3); // 3 non-event nodes linked to 1 event node
    expect(result.labels).toContain('John Doe');
    expect(result.labels).toContain('Laptop');
    expect(result.labels).toContain('London');
    expect(result.labels).toContain('Meeting');
  });

  test('renderConvergenceRadar renders correctly for 3 topics', async ({ page }) => {
    await goToHarness(page);

    const result = await page.evaluate(async () => {
      const { renderConvergenceRadar } = await import('/src/components/ForensicsVisualizations.ts');

      const container = document.createElement('div');
      container.id = 'radar-test-container';
      container.style.width = '300px';
      container.style.height = '150px';
      document.body.appendChild(container);

      const topics = ['gov', 'intel', 'wire'];

      renderConvergenceRadar('#radar-test-container', topics);

      await new Promise(r => setTimeout(r, 100));
      
      const circles = container.querySelectorAll('circle');
      const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent);

      const cleanup = () => container.remove();
      const res = {
        circleCount: circles.length,
        texts
      };
      cleanup();
      return res;
    });

    expect(result.circleCount).toBe(3);
    expect(result.texts).toEqual(['gov', 'intel', 'wire']);
  });
  
  test('PlaybackControl toggles playback state and changes button text', async ({ page }) => {
    await goToHarness(page);
    
    const result = await page.evaluate(async () => {
      const { PlaybackControl } = await import('/src/components/PlaybackControl.ts');
      
      const container = document.createElement('div');
      document.body.appendChild(container);
      
      const playback = new PlaybackControl();
      container.appendChild(playback.getElement());
      
      // Add mock timestamps to enable play functionality
      playback['timestamps'] = [Date.now() - 2000, Date.now() - 1000, Date.now()];
      playback['currentIndex'] = 0;
      
      const getPlayBtnText = () => {
        return container.querySelector('[data-action="play"]')?.textContent;
      }
      
      const initialText = getPlayBtnText();
      
      // Simulate click play
      (playback as any).handleAction('play');
      const playingText = getPlayBtnText();
      const isPlaying = (playback as any).isPlaying;
      
      // Simulate click pause
      (playback as any).handleAction('play');
      const pausedText = getPlayBtnText();
      const isPaused = !(playback as any).isPlaying;
      
      container.remove();
      
      return {
        initialText,
        playingText,
        isPlaying,
        pausedText,
        isPaused
      }
    });
    
    expect(result.initialText).toBe('⏵');
    expect(result.playingText).toBe('⏸');
    expect(result.isPlaying).toBe(true);
    expect(result.pausedText).toBe('⏵');
    expect(result.isPaused).toBe(true);
  });
});
