import { getSnapshotTimestamps, getSnapshotAt, type DashboardSnapshot } from '@/services/storage';
import { t } from '@/services/i18n';

export class PlaybackControl {
  private element: HTMLElement;
  private isPlaybackMode = false;
  private isPlaying = false;
  private playInterval: number | null = null;
  private timestamps: number[] = [];
  private currentIndex = 0;
  private onSnapshotChange: ((snapshot: DashboardSnapshot | null) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'playback-control';
    this.element.innerHTML = `
      <button class="playback-toggle" title="${t('components.playback.toggleMode')}">
        <span class="playback-icon">⏪</span>
      </button>
      <div class="playback-panel hidden">
        <div class="playback-header">
          <span>${t('components.playback.historicalPlayback')}</span>
          <button class="playback-close">×</button>
        </div>
        <div class="playback-slider-container">
          <input type="range" class="playback-slider" min="0" max="100" value="100">
          <div class="playback-time">${t('components.playback.live')}</div>
        </div>
        <div class="playback-controls">
          <button class="playback-btn" data-action="start">⏮</button>
          <button class="playback-btn" data-action="prev">◀</button>
          <button class="playback-btn" data-action="play" title="Play">⏵</button>
          <button class="playback-btn playback-live" data-action="live">${t('components.playback.live')}</button>
          <button class="playback-btn" data-action="next">▶</button>
          <button class="playback-btn" data-action="end">⏭</button>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const toggle = this.element.querySelector('.playback-toggle')!;
    const panel = this.element.querySelector('.playback-panel')!;
    const closeBtn = this.element.querySelector('.playback-close')!;
    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;

    toggle.addEventListener('click', async () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        await this.loadTimestamps();
      }
    });

    closeBtn.addEventListener('click', () => {
      panel.classList.add('hidden');
      this.goLive();
    });

    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value);
      this.currentIndex = idx;
      this.loadSnapshot(idx);
    });

    this.element.querySelectorAll('.playback-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        this.handleAction(action!);
      });
    });
  }

  private async loadTimestamps(): Promise<void> {
    this.timestamps = await getSnapshotTimestamps();
    this.timestamps.sort((a, b) => a - b);

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    slider.max = String(Math.max(0, this.timestamps.length - 1));
    slider.value = slider.max;
    this.currentIndex = this.timestamps.length - 1;

    this.updateTimeDisplay();
  }

  private async loadSnapshot(index: number): Promise<void> {
    if (index < 0 || index >= this.timestamps.length) {
      this.goLive();
      return;
    }

    const timestamp = this.timestamps[index];
    if (!timestamp) {
      this.goLive();
      return;
    }

    this.isPlaybackMode = true;
    this.updateTimeDisplay();

    const snapshot = await getSnapshotAt(timestamp);
    this.onSnapshotChange?.(snapshot);

    document.body.classList.add('playback-mode');
    this.element.querySelector('.playback-live')?.classList.remove('active');
  }

  public stopPlayback(): void {
    this.isPlaying = false;
    if (this.playInterval !== null) {
      window.clearInterval(this.playInterval);
      this.playInterval = null;
    }
    const playBtn = this.element.querySelector('[data-action="play"]');
    if (playBtn) playBtn.textContent = '⏵';
  }

  private goLive(): void {
    this.stopPlayback();
    this.isPlaybackMode = false;
    this.currentIndex = this.timestamps.length - 1;

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    if (slider) slider.value = slider.max;

    this.updateTimeDisplay();
    this.onSnapshotChange?.(null);

    document.body.classList.remove('playback-mode');
    this.element.querySelector('.playback-live')?.classList.add('active');
  }

  private handleAction(action: string): void {
    if (action !== 'play') this.stopPlayback();

    switch (action) {
      case 'start':
        this.currentIndex = 0;
        break;
      case 'prev':
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        break;
      case 'play':
        if (this.isPlaying) {
          this.stopPlayback();
          return;
        }
        this.isPlaying = true;
        const playBtn = this.element.querySelector('[data-action="play"]');
        if (playBtn) playBtn.textContent = '⏸';
        if (this.currentIndex >= this.timestamps.length - 1) {
          this.currentIndex = 0;
        }
        this.playInterval = window.setInterval(() => {
          if (this.currentIndex >= this.timestamps.length - 1) {
            this.stopPlayback();
            return;
          }
          this.currentIndex++;
          const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
          if (slider) slider.value = String(this.currentIndex);
          this.loadSnapshot(this.currentIndex);
        }, 1500) as unknown as number;
        // Load the current frame immediately
        this.loadSnapshot(this.currentIndex);
        return;
      case 'next':
        this.currentIndex = Math.min(this.timestamps.length - 1, this.currentIndex + 1);
        break;
      case 'end':
        this.currentIndex = this.timestamps.length - 1;
        break;
      case 'live':
        this.goLive();
        return;
    }

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    if (slider) slider.value = String(this.currentIndex);
    this.loadSnapshot(this.currentIndex);
  }

  private updateTimeDisplay(): void {
    const display = this.element.querySelector('.playback-time')!;

    if (!this.isPlaybackMode || this.timestamps.length === 0) {
      display.textContent = t('components.playback.live');
      display.classList.remove('historical');
      return;
    }

    const timestamp = this.timestamps[this.currentIndex];
    if (timestamp) {
      const date = new Date(timestamp);
      display.textContent = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      display.classList.add('historical');
    }
  }

  public onSnapshot(callback: (snapshot: DashboardSnapshot | null) => void): void {
    this.onSnapshotChange = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public isInPlaybackMode(): boolean {
    return this.isPlaybackMode;
  }
}
