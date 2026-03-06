import { Panel } from './Panel';
import { isDesktopRuntime, getLocalApiPort } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '../services/i18n';
import { trackWebcamSelected, trackWebcamRegionFiltered } from '@/services/analytics';
import { getStreamQuality, subscribeStreamQualityChange } from '@/services/ai-flow-settings';
import { dashboardUpdateScheduler } from '@/services/dashboard-update-scheduler';

type WebcamRegion = 'iran' | 'middle-east' | 'europe' | 'asia' | 'americas';

interface WebcamFeed {
  id: string;
  city: string;
  country: string;
  region: WebcamRegion;
  channelHandle: string;
  fallbackVideoId: string;
}

// Verified YouTube live stream IDs — validated Feb 2026 via title cross-check.
// IDs may rotate; update when stale.
const WEBCAM_FEEDS: WebcamFeed[] = [
  // Iran Attacks — Tehran, Tel Aviv, Jerusalem
  { id: 'iran-tehran', city: 'Tehran', country: 'Iran', region: 'iran', channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'iran-telaviv', city: 'Tel Aviv', country: 'Israel', region: 'iran', channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'iran-jerusalem', city: 'Jerusalem', country: 'Israel', region: 'iran', channelHandle: '@JerusalemLive', fallbackVideoId: 'dpx0xxbPLN8' },
  { id: 'iran-multicam', city: 'Middle East', country: 'Multi', region: 'iran', channelHandle: '@MiddleEastCams', fallbackVideoId: '4E-iFtUM2kk' },
  // Middle East — Jerusalem & Tehran adjacent (conflict hotspots)
  { id: 'jerusalem', city: 'Jerusalem', country: 'Israel', region: 'middle-east', channelHandle: '@TheWesternWall', fallbackVideoId: 'UyduhBUpO7Q' },
  { id: 'tehran', city: 'Tehran', country: 'Iran', region: 'middle-east', channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'tel-aviv', city: 'Tel Aviv', country: 'Israel', region: 'middle-east', channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'mecca', city: 'Mecca', country: 'Saudi Arabia', region: 'middle-east', channelHandle: '@MakkahLive', fallbackVideoId: 'DEcpmPUbkDQ' },
  // Europe
  { id: 'kyiv', city: 'Kyiv', country: 'Ukraine', region: 'europe', channelHandle: '@DWNews', fallbackVideoId: '-Q7FuPINDjA' },
  { id: 'odessa', city: 'Odessa', country: 'Ukraine', region: 'europe', channelHandle: '@UkraineLiveCam', fallbackVideoId: 'e2gC37ILQmk' },
  { id: 'paris', city: 'Paris', country: 'France', region: 'europe', channelHandle: '@PalaisIena', fallbackVideoId: 'OzYp4NRZlwQ' },
  { id: 'st-petersburg', city: 'St. Petersburg', country: 'Russia', region: 'europe', channelHandle: '@SPBLiveCam', fallbackVideoId: 'CjtIYbmVfck' },
  { id: 'london', city: 'London', country: 'UK', region: 'europe', channelHandle: '@EarthCam', fallbackVideoId: 'Lxqcg1qt0XU' },
  // Americas
  { id: 'washington', city: 'Washington DC', country: 'USA', region: 'americas', channelHandle: '@AxisCommunications', fallbackVideoId: '1wV9lLe14aU' },
  { id: 'new-york', city: 'New York', country: 'USA', region: 'americas', channelHandle: '@EarthCam', fallbackVideoId: '4qyZLflp-sI' },
  { id: 'los-angeles', city: 'Los Angeles', country: 'USA', region: 'americas', channelHandle: '@VeniceVHotel', fallbackVideoId: 'EO_1LWqsCNE' },
  { id: 'miami', city: 'Miami', country: 'USA', region: 'americas', channelHandle: '@FloridaLiveCams', fallbackVideoId: '5YCajRjvWCg' },
  // Asia-Pacific — Taipei first (strait hotspot), then Shanghai, Tokyo, Seoul
  { id: 'taipei', city: 'Taipei', country: 'Taiwan', region: 'asia', channelHandle: '@JackyWuTaipei', fallbackVideoId: 'z_fY1pj1VBw' },
  { id: 'shanghai', city: 'Shanghai', country: 'China', region: 'asia', channelHandle: '@SkylineWebcams', fallbackVideoId: '76EwqI5XZIc' },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', region: 'asia', channelHandle: '@TokyoLiveCam4K', fallbackVideoId: '4pu9sF5Qssw' },
  { id: 'seoul', city: 'Seoul', country: 'South Korea', region: 'asia', channelHandle: '@UNvillage_live', fallbackVideoId: '-JhoMGoAfFc' },
  { id: 'sydney', city: 'Sydney', country: 'Australia', region: 'asia', channelHandle: '@WebcamSydney', fallbackVideoId: '7pcL-0Wo77U' },
];

const MAX_GRID_CELLS = 4;

type ViewMode = 'grid' | 'single';
type RegionFilter = 'all' | WebcamRegion;

export class LiveWebcamsPanel extends Panel {
  private viewMode: ViewMode = 'grid';
  private regionFilter: RegionFilter = 'iran';
  private activeFeed: WebcamFeed = WEBCAM_FEEDS[0]!;
  private toolbar: HTMLElement | null = null;
  private iframeByFeedId = new Map<string, HTMLIFrameElement>();
  private observer: IntersectionObserver | null = null;
  private streamsVisible = false;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingGridMountTimers: ReturnType<typeof setTimeout>[] = [];
  private activeRenderToken = 0;
  private renderSignature = '';
  private forceRenderPending = false;
  private boundIdleResetHandler!: () => void;
  private boundVisibilityHandler!: () => void;
  private readonly IDLE_PAUSE_MS = 5 * 60 * 1000;
  private isIdle = false;
  private fullscreenBtn: HTMLButtonElement | null = null;
  private isFullscreen = false;
  private unsubscribeStreamQuality: (() => void) | null = null;

  constructor() {
    super({ id: 'live-webcams', title: t('panels.liveWebcams'), className: 'panel-wide' });
    this.createFullscreenButton();
    this.createToolbar();
    this.setupIntersectionObserver();
    this.setupIdleDetection();
    this.unsubscribeStreamQuality = subscribeStreamQualityChange(() => this.handleStreamQualityChange());
    this.requestRender(true, 'critical');
    document.addEventListener('keydown', this.boundFullscreenEscHandler);
  }

  protected override onPanelVisibilityChanged(visible: boolean): void {
    if (visible) {
      if (!this.isIdle) this.requestRender(true, 'critical');
      return;
    }
    this.streamsVisible = false;
    this.suspendStreams('components.webcams.paused');
  }

  private createFullscreenButton(): void {
    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.className = 'live-mute-btn';
    this.fullscreenBtn.title = 'Fullscreen';
    this.fullscreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    this.fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });
    const header = this.element.querySelector('.panel-header');
    header?.appendChild(this.fullscreenBtn);
  }

  private toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    this.element.classList.toggle('live-news-fullscreen', this.isFullscreen);
    document.body.classList.toggle('live-news-fullscreen-active', this.isFullscreen);
    if (this.fullscreenBtn) {
      this.fullscreenBtn.title = this.isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
      this.fullscreenBtn.innerHTML = this.isFullscreen
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    }
  }

  private boundFullscreenEscHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.isFullscreen) this.toggleFullscreen();
  };

  private get filteredFeeds(): WebcamFeed[] {
    if (this.regionFilter === 'all') return WEBCAM_FEEDS;
    return WEBCAM_FEEDS.filter(f => f.region === this.regionFilter);
  }

  private static readonly ALL_GRID_IDS = ['jerusalem', 'tehran', 'kyiv', 'washington'];

  private get gridFeeds(): WebcamFeed[] {
    if (this.regionFilter === 'all') {
      return LiveWebcamsPanel.ALL_GRID_IDS
        .map(id => WEBCAM_FEEDS.find(f => f.id === id)!)
        .filter(Boolean);
    }
    return this.filteredFeeds.slice(0, MAX_GRID_CELLS);
  }

  private createToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'webcam-toolbar';

    const regionGroup = document.createElement('div');
    regionGroup.className = 'webcam-toolbar-group';

    const regions: { key: RegionFilter; label: string }[] = [
      { key: 'iran', label: t('components.webcams.regions.iran') },
      { key: 'all', label: t('components.webcams.regions.all') },
      { key: 'middle-east', label: t('components.webcams.regions.mideast') },
      { key: 'europe', label: t('components.webcams.regions.europe') },
      { key: 'americas', label: t('components.webcams.regions.americas') },
      { key: 'asia', label: t('components.webcams.regions.asia') },
    ];

    regions.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.className = `webcam-region-btn${key === this.regionFilter ? ' active' : ''}`;
      btn.dataset.region = key;
      btn.textContent = label;
      btn.addEventListener('click', () => this.setRegionFilter(key));
      regionGroup.appendChild(btn);
    });

    const viewGroup = document.createElement('div');
    viewGroup.className = 'webcam-toolbar-group';

    const gridBtn = document.createElement('button');
    gridBtn.className = `webcam-view-btn${this.viewMode === 'grid' ? ' active' : ''}`;
    gridBtn.dataset.mode = 'grid';
    gridBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
    gridBtn.title = 'Grid view';
    gridBtn.addEventListener('click', () => this.setViewMode('grid'));

    const singleBtn = document.createElement('button');
    singleBtn.className = `webcam-view-btn${this.viewMode === 'single' ? ' active' : ''}`;
    singleBtn.dataset.mode = 'single';
    singleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="18" height="14" rx="2"/><rect x="3" y="19" width="18" height="2" rx="1"/></svg>';
    singleBtn.title = 'Single view';
    singleBtn.addEventListener('click', () => this.setViewMode('single'));

    viewGroup.appendChild(gridBtn);
    viewGroup.appendChild(singleBtn);

    this.toolbar.appendChild(regionGroup);
    this.toolbar.appendChild(viewGroup);
    this.element.insertBefore(this.toolbar, this.content);
  }

  private setRegionFilter(filter: RegionFilter): void {
    if (filter === this.regionFilter) return;
    trackWebcamRegionFiltered(filter);
    this.regionFilter = filter;
    this.toolbar?.querySelectorAll('.webcam-region-btn').forEach(btn => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.region === filter);
    });
    const feeds = this.filteredFeeds;
    if (feeds.length > 0 && !feeds.includes(this.activeFeed)) {
      this.activeFeed = feeds[0]!;
    }
    this.requestRender(true, 'normal');
  }

  private setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.toolbar?.querySelectorAll('.webcam-view-btn').forEach(btn => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });
    this.requestRender(true, 'normal');
  }

  private buildEmbedUrl(videoId: string): string {
    const quality = getStreamQuality();
    if (isDesktopRuntime()) {
      // Use local sidecar embed — YouTube rejects tauri:// parent origin with error 153.
      // The sidecar serves the embed from http://127.0.0.1:PORT which YouTube accepts.
      const params = new URLSearchParams({ videoId, autoplay: '1', mute: '1' });
      if (quality !== 'auto') params.set('vq', quality);
      return `http://localhost:${getLocalApiPort()}/api/youtube-embed?${params.toString()}`;
    }
    const vq = quality !== 'auto' ? `&vq=${quality}` : '';
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0${vq}`;
  }

  private createIframe(feed: WebcamFeed): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.className = 'webcam-iframe';
    iframe.src = this.buildEmbedUrl(feed.fallbackVideoId);
    iframe.title = `${feed.city} live webcam`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    if (!isDesktopRuntime()) {
      iframe.allowFullscreen = true;
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    }
    return iframe;
  }

  private requestRender(force = false, priority: 'critical' | 'normal' | 'idle' = 'normal'): void {
    this.forceRenderPending = this.forceRenderPending || force;
    dashboardUpdateScheduler.schedulePanelUpdate('live-webcams', () => {
      const shouldForceRender = this.forceRenderPending;
      this.forceRenderPending = false;
      this.render(shouldForceRender);
    }, priority);
  }

  private render(force = false): void {
    if (!this.streamsVisible || this.isIdle) {
      const key = this.isIdle ? 'components.webcams.pausedIdle' : 'components.webcams.paused';
      this.suspendStreams(key);
      return;
    }

    const signature = `${this.viewMode}|${this.regionFilter}|${this.activeFeed.id}`;
    if (!force && signature === this.renderSignature) {
      return;
    }

    this.renderSignature = signature;
    this.activeRenderToken += 1;
    this.clearPendingGridMounts();

    if (this.viewMode === 'grid') {
      this.renderGrid(this.activeRenderToken);
    } else {
      this.renderSingle();
    }
  }

  private renderGrid(renderToken: number): void {
    this.content.innerHTML = '';
    this.content.className = 'panel-content webcam-content';

    const grid = document.createElement('div');
    grid.className = 'webcam-grid';

    const feeds = this.gridFeeds;
    const desktop = isDesktopRuntime();

    feeds.forEach((feed, i) => {
      const cell = document.createElement('div');
      cell.className = 'webcam-cell';

      const label = document.createElement('div');
      label.className = 'webcam-cell-label';
      label.innerHTML = `<span class="webcam-live-dot"></span><span class="webcam-city">${escapeHtml(feed.city.toUpperCase())}</span>`;

      if (desktop) {
        // On desktop, clicks pass through label (pointer-events:none in CSS)
        // to YouTube iframe so users click play directly. Add expand button.
        const expandBtn = document.createElement('button');
        expandBtn.className = 'webcam-expand-btn';
        expandBtn.title = t('webcams.expand') || 'Expand';
        expandBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          trackWebcamSelected(feed.id, feed.city, 'grid');
          this.activeFeed = feed;
          this.setViewMode('single');
        });
        label.appendChild(expandBtn);
      } else {
        cell.addEventListener('click', () => {
          trackWebcamSelected(feed.id, feed.city, 'grid');
          this.activeFeed = feed;
          this.setViewMode('single');
        });
      }

      cell.appendChild(label);
      grid.appendChild(cell);

      const attachIframe = () => {
        if (renderToken !== this.activeRenderToken || !this.streamsVisible || this.isIdle) return;
        const iframe = this.getOrCreateIframe(feed);
        if (iframe.parentElement !== cell) {
          cell.insertBefore(iframe, label);
        }
      };

      if (desktop && i > 0) {
        const timer = setTimeout(attachIframe, i * 800);
        this.pendingGridMountTimers.push(timer);
      } else {
        attachIframe();
      }
    });

    this.content.appendChild(grid);
  }

  private renderSingle(): void {
    this.content.innerHTML = '';
    this.content.className = 'panel-content webcam-content';

    const wrapper = document.createElement('div');
    wrapper.className = 'webcam-single';

    const iframe = this.getOrCreateIframe(this.activeFeed);
    wrapper.appendChild(iframe);

    const switcher = document.createElement('div');
    switcher.className = 'webcam-switcher';

    const backBtn = document.createElement('button');
    backBtn.className = 'webcam-feed-btn webcam-back-btn';
    backBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg> Grid';
    backBtn.addEventListener('click', () => this.setViewMode('grid'));
    switcher.appendChild(backBtn);

    this.filteredFeeds.forEach(feed => {
      const btn = document.createElement('button');
      btn.className = `webcam-feed-btn${feed.id === this.activeFeed.id ? ' active' : ''}`;
      btn.textContent = feed.city;
      btn.addEventListener('click', () => {
        trackWebcamSelected(feed.id, feed.city, 'single');
        this.activeFeed = feed;
        this.requestRender(true, 'normal');
      });
      switcher.appendChild(btn);
    });

    this.content.appendChild(wrapper);
    this.content.appendChild(switcher);
  }

  private destroyIframes(clearCache = false): void {
    this.iframeByFeedId.forEach(iframe => {
      iframe.src = 'about:blank';
      iframe.remove();
    });
    if (clearCache) this.iframeByFeedId.clear();
  }

  private getOrCreateIframe(feed: WebcamFeed): HTMLIFrameElement {
    const existing = this.iframeByFeedId.get(feed.id);
    if (existing) {
      this.ensureIframeQuality(existing, feed);
      return existing;
    }
    const iframe = this.createIframe(feed);
    this.iframeByFeedId.set(feed.id, iframe);
    return iframe;
  }

  private ensureIframeQuality(iframe: HTMLIFrameElement, feed: WebcamFeed): void {
    const nextSrc = this.buildEmbedUrl(feed.fallbackVideoId);
    const current = iframe.getAttribute('src') ?? '';
    if (current !== nextSrc) iframe.src = nextSrc;
  }

  private handleStreamQualityChange(): void {
    if (!this.streamsVisible || this.isIdle) return;
    this.iframeByFeedId.forEach((iframe, feedId) => {
      const feed = WEBCAM_FEEDS.find((entry) => entry.id === feedId);
      if (!feed) return;
      this.ensureIframeQuality(iframe, feed);
    });
    this.requestRender(true, 'normal');
  }

  private clearPendingGridMounts(): void {
    this.pendingGridMountTimers.forEach((timer) => clearTimeout(timer));
    this.pendingGridMountTimers = [];
  }

  private suspendStreams(messageKey: string): void {
    this.clearPendingGridMounts();
    this.destroyIframes();
    this.renderSignature = '';
    this.content.className = 'panel-content webcam-content';
    this.content.innerHTML = `<div class="webcam-placeholder">${escapeHtml(t(messageKey))}</div>`;
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        const wasVisible = this.streamsVisible;
        this.streamsVisible = entries.some(e => e.isIntersecting);
        if (this.streamsVisible && !wasVisible && !this.isIdle) {
          this.requestRender(true, 'normal');
        } else if (!this.streamsVisible && wasVisible) {
          this.suspendStreams('components.webcams.paused');
        }
      },
      { threshold: 0.1 }
    );
    this.observer.observe(this.element);
  }

  private setupIdleDetection(): void {
    this.boundVisibilityHandler = () => {
      if (document.hidden) {
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
      } else {
        if (this.isIdle) {
          this.isIdle = false;
          if (this.streamsVisible) this.requestRender(true, 'normal');
        }
        this.boundIdleResetHandler();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    this.boundIdleResetHandler = () => {
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      if (this.isIdle) {
        this.isIdle = false;
        if (this.streamsVisible) this.requestRender(true, 'normal');
      }
      this.idleTimeout = setTimeout(() => {
        this.isIdle = true;
        this.suspendStreams('components.webcams.pausedIdle');
      }, this.IDLE_PAUSE_MS);
    };

    ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler, { passive: true });
    });

    this.boundIdleResetHandler();
  }

  public refresh(): void {
    if (this.streamsVisible && !this.isIdle) {
      this.requestRender(true, 'idle');
    }
  }

  public destroy(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    document.removeEventListener('keydown', this.boundFullscreenEscHandler);
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
      document.removeEventListener(event, this.boundIdleResetHandler);
    });
    if (this.isFullscreen) this.toggleFullscreen();
    this.observer?.disconnect();
    this.clearPendingGridMounts();
    this.destroyIframes(true);
    this.unsubscribeStreamQuality?.();
    this.unsubscribeStreamQuality = null;
    super.destroy();
  }
}
