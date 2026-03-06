import type { AppContext, AppModule } from '@/app/app-context';

export type RefreshPriority = 'critical' | 'normal' | 'idle';
export type RefreshOutcomeStatus = 'success' | 'no_change' | 'retryable_error' | 'rate_limited';

export interface RefreshOutcome {
  status: RefreshOutcomeStatus;
  retryAfterMs?: number;
}

export interface RefreshPolicy {
  intervalMs: number;
  condition?: () => boolean;
  priority?: RefreshPriority;
  hiddenMultiplier?: number;
  maxBackoffMultiplier?: number;
  minRefreshMs?: number;
  jitterFraction?: number;
  runWhenHidden?: boolean;
  maxRunMs?: number;
  runImmediately?: boolean;
  performanceSensitive?: boolean;
}

export interface RefreshRegistration {
  name: string;
  fn: () => Promise<boolean | void | RefreshOutcome>;
  intervalMs?: number;
  condition?: () => boolean;
  policy?: RefreshPolicy;
}

const DEFAULT_HIDDEN_REFRESH_MULTIPLIER = 10;
const DEFAULT_JITTER_FRACTION = 0.1;
const DEFAULT_MIN_REFRESH_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MULTIPLIER = 4;
const DEFAULT_MAX_RUN_MS = 30_000;

const OUTCOME_TIMEOUT: RefreshOutcome = { status: 'retryable_error' };

type RunnerState = {
  run: () => Promise<void>;
  policy: RefreshPolicy;
};

export class RefreshScheduler implements AppModule {
  private ctx: AppContext;
  private refreshTimeoutIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private refreshRunners = new Map<string, RunnerState>();
  private hiddenSince = 0;
  private performanceMultiplier = 1;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  init(): void {}

  destroy(): void {
    for (const timeoutId of this.refreshTimeoutIds.values()) {
      clearTimeout(timeoutId);
    }
    this.refreshTimeoutIds.clear();
    this.refreshRunners.clear();
  }

  setHiddenSince(ts: number): void {
    this.hiddenSince = ts;
  }

  getHiddenSince(): number {
    return this.hiddenSince;
  }

  setPerformanceLoad(mode: 'normal' | 'elevated' | 'high'): void {
    if (mode === 'high') {
      this.performanceMultiplier = 2;
      return;
    }
    if (mode === 'elevated') {
      this.performanceMultiplier = 1.5;
      return;
    }
    this.performanceMultiplier = 1;
  }

  scheduleRefresh(
    name: string,
    fn: () => Promise<boolean | void | RefreshOutcome>,
    intervalMsOrPolicy: number | RefreshPolicy,
    condition?: () => boolean
  ): void {
    const policy = this.normalizePolicy(intervalMsOrPolicy, condition);
    const maxBackoffMultiplier = Math.max(1, policy.maxBackoffMultiplier ?? DEFAULT_MAX_BACKOFF_MULTIPLIER);
    const minRefreshMs = Math.max(250, policy.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS);
    const jitterFraction = Math.max(0, Math.min(0.45, policy.jitterFraction ?? DEFAULT_JITTER_FRACTION));
    const maxRunMs = Math.max(1_000, policy.maxRunMs ?? DEFAULT_MAX_RUN_MS);
    const hiddenMultiplier = Math.max(1, policy.hiddenMultiplier ?? DEFAULT_HIDDEN_REFRESH_MULTIPLIER);
    const performanceSensitive = policy.performanceSensitive !== false;

    let currentMultiplier = 1;
    let lastKnownRetryAfterMs: number | null = null;

    const computeDelay = (baseMs: number, isHidden: boolean) => {
      let adjusted = baseMs;
      if (isHidden) adjusted *= hiddenMultiplier;

      if (performanceSensitive && this.performanceMultiplier > 1) {
        const priorityFactor = policy.priority === 'critical'
          ? 1
          : policy.priority === 'idle'
            ? this.performanceMultiplier * 1.35
            : this.performanceMultiplier;
        adjusted *= priorityFactor;
      }

      const requiredMinimumMs = lastKnownRetryAfterMs ?? 0;
      if (lastKnownRetryAfterMs && lastKnownRetryAfterMs > adjusted) {
        adjusted = lastKnownRetryAfterMs;
      }

      const jitterRange = adjusted * jitterFraction;
      const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
      return Math.max(minRefreshMs, requiredMinimumMs, Math.round(jittered));
    };

    const scheduleNext = (delay: number) => {
      if (this.ctx.isDestroyed) return;
      const timeoutId = setTimeout(run, delay);
      this.refreshTimeoutIds.set(name, timeoutId);
    };

    const run = async () => {
      if (this.ctx.isDestroyed) return;
      const isHidden = document.visibilityState === 'hidden';
      if (isHidden && !policy.runWhenHidden) {
        scheduleNext(computeDelay(policy.intervalMs * currentMultiplier, true));
        return;
      }
      if (policy.condition && !policy.condition()) {
        scheduleNext(computeDelay(policy.intervalMs, false));
        return;
      }
      if (this.ctx.inFlight.has(name)) {
        scheduleNext(computeDelay(policy.intervalMs, false));
        return;
      }
      this.ctx.inFlight.add(name);
      try {
        const outcome = await this.runWithTimeout(fn, maxRunMs);
        const normalized = this.normalizeOutcome(outcome);
        if (normalized.status === 'success') {
          currentMultiplier = 1;
          lastKnownRetryAfterMs = null;
        } else if (normalized.status === 'rate_limited') {
          currentMultiplier = Math.min(currentMultiplier * 2, maxBackoffMultiplier);
          lastKnownRetryAfterMs = normalized.retryAfterMs ?? null;
        } else {
          currentMultiplier = Math.min(currentMultiplier * 2, maxBackoffMultiplier);
          lastKnownRetryAfterMs = null;
        }
      } catch (e) {
        console.error(`[App] Refresh ${name} failed:`, e);
        currentMultiplier = Math.min(currentMultiplier * 2, maxBackoffMultiplier);
        lastKnownRetryAfterMs = null;
      } finally {
        this.ctx.inFlight.delete(name);
        scheduleNext(computeDelay(policy.intervalMs * currentMultiplier, false));
      }
    };
    this.refreshRunners.set(name, { run, policy });
    const initialDelay = policy.runImmediately ? 0 : computeDelay(policy.intervalMs, document.visibilityState === 'hidden');
    scheduleNext(initialDelay);
  }

  flushStaleRefreshes(): void {
    if (!this.hiddenSince) return;
    const hiddenMs = Date.now() - this.hiddenSince;
    this.hiddenSince = 0;

    let stagger = 0;
    for (const [name, { run, policy }] of this.refreshRunners) {
      if (hiddenMs < policy.intervalMs) continue;
      const pending = this.refreshTimeoutIds.get(name);
      if (pending) clearTimeout(pending);
      const delay = stagger;
      stagger += 150;
      this.refreshTimeoutIds.set(name, setTimeout(() => void run(), delay));
    }
  }

  registerAll(registrations: RefreshRegistration[]): void {
    for (const reg of registrations) {
      const policy = reg.policy ?? {
        intervalMs: reg.intervalMs ?? 60_000,
        condition: reg.condition,
      };
      this.scheduleRefresh(reg.name, reg.fn, policy);
    }
  }

  private normalizePolicy(intervalMsOrPolicy: number | RefreshPolicy, condition?: () => boolean): RefreshPolicy {
    if (typeof intervalMsOrPolicy === 'number') {
      return {
        intervalMs: intervalMsOrPolicy,
        condition,
      };
    }
    return {
      intervalMs: intervalMsOrPolicy.intervalMs,
      condition: intervalMsOrPolicy.condition,
      priority: intervalMsOrPolicy.priority ?? 'normal',
      hiddenMultiplier: intervalMsOrPolicy.hiddenMultiplier,
      maxBackoffMultiplier: intervalMsOrPolicy.maxBackoffMultiplier,
      minRefreshMs: intervalMsOrPolicy.minRefreshMs,
      jitterFraction: intervalMsOrPolicy.jitterFraction,
      runWhenHidden: intervalMsOrPolicy.runWhenHidden ?? false,
      maxRunMs: intervalMsOrPolicy.maxRunMs,
      runImmediately: intervalMsOrPolicy.runImmediately ?? false,
      performanceSensitive: intervalMsOrPolicy.performanceSensitive ?? true,
    };
  }

  private normalizeOutcome(result: boolean | void | RefreshOutcome): RefreshOutcome {
    if (typeof result === 'boolean') {
      return { status: result ? 'success' : 'no_change' };
    }
    if (result && typeof result === 'object' && 'status' in result) {
      return result;
    }
    return { status: 'success' };
  }

  private async runWithTimeout(
    fn: () => Promise<boolean | void | RefreshOutcome>,
    timeoutMs: number
  ): Promise<boolean | void | RefreshOutcome> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        fn(),
        new Promise<RefreshOutcome>((resolve) => {
          timeoutId = setTimeout(() => resolve(OUTCOME_TIMEOUT), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
