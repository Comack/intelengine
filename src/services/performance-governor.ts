import type { MapPerformanceProfile } from '@/components';

interface MapPerfStats {
  profile: MapPerformanceProfile;
  interactionActive: boolean;
  lastFlushMs: number;
  lastBuildMs: number;
  layerCount: number;
  updatedAt: number;
}

interface PerformanceGovernorOptions {
  getStats: () => MapPerfStats | null;
  getProfile: () => MapPerformanceProfile;
  setProfile: (profile: MapPerformanceProfile, reason: string) => void;
  isMapVisible: () => boolean;
}

const PROFILE_ORDER: MapPerformanceProfile[] = ['quality', 'balanced', 'smooth'];

export class PerformanceGovernor {
  private readonly options: PerformanceGovernorOptions;
  private flushSamples: number[] = [];
  private longTaskTimestamps: number[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private perfObserver: PerformanceObserver | null = null;
  private lastTransitionAt = 0;
  private lastSeenUpdateAt = 0;

  constructor(options: PerformanceGovernorOptions) {
    this.options = options;
  }

  start(): void {
    if (typeof window === 'undefined') return;
    if (this.pollTimer) return;

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.perfObserver = new PerformanceObserver((list) => {
          const now = Date.now();
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'longtask' && entry.duration >= 55) {
              this.longTaskTimestamps.push(now);
            }
          }
          this.pruneLongTasks(now);
        });
        this.perfObserver.observe({ type: 'longtask', buffered: true });
      } catch {
        this.perfObserver = null;
      }
    }

    this.pollTimer = setInterval(() => this.evaluate(), 2000);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.perfObserver?.disconnect();
    this.perfObserver = null;
    this.flushSamples = [];
    this.longTaskTimestamps = [];
  }

  private evaluate(): void {
    if (!this.options.isMapVisible()) return;

    const stats = this.options.getStats();
    if (!stats) return;
    if (!Number.isFinite(stats.lastFlushMs) || stats.lastFlushMs <= 0) return;
    if (stats.updatedAt <= this.lastSeenUpdateAt) return;
    this.lastSeenUpdateAt = stats.updatedAt;

    this.flushSamples.push(stats.lastFlushMs);
    if (this.flushSamples.length > 30) this.flushSamples.shift();

    const now = Date.now();
    this.pruneLongTasks(now);

    const avgFlushMs = this.flushSamples.reduce((sum, value) => sum + value, 0) / this.flushSamples.length;
    const highFlushCount = this.flushSamples.filter((value) => value >= 20).length;
    const longTaskCount = this.longTaskTimestamps.length;
    const current = this.options.getProfile();
    const sinceLastTransition = now - this.lastTransitionAt;

    const shouldDegrade = (avgFlushMs > 15 && highFlushCount >= 4) || longTaskCount >= 3;
    const shouldRecover = avgFlushMs < 10 && highFlushCount <= 1 && longTaskCount === 0;

    if (shouldDegrade && sinceLastTransition >= 9000) {
      const next = this.nextProfile(current, 'down');
      if (next !== current) {
        this.options.setProfile(next, `avg=${avgFlushMs.toFixed(1)}ms,longtasks=${longTaskCount}`);
        this.lastTransitionAt = now;
      }
      return;
    }

    if (shouldRecover && sinceLastTransition >= 35000) {
      const next = this.nextProfile(current, 'up');
      if (next !== current) {
        this.options.setProfile(next, `recovery avg=${avgFlushMs.toFixed(1)}ms`);
        this.lastTransitionAt = now;
      }
    }
  }

  private pruneLongTasks(now = Date.now()): void {
    const cutoff = now - 10000;
    this.longTaskTimestamps = this.longTaskTimestamps.filter((timestamp) => timestamp >= cutoff);
  }

  private nextProfile(current: MapPerformanceProfile, direction: 'up' | 'down'): MapPerformanceProfile {
    const currentIndex = PROFILE_ORDER.indexOf(current);
    if (currentIndex < 0) return current;
    if (direction === 'down') {
      return PROFILE_ORDER[Math.min(PROFILE_ORDER.length - 1, currentIndex + 1)] ?? current;
    }
    return PROFILE_ORDER[Math.max(0, currentIndex - 1)] ?? current;
  }
}

