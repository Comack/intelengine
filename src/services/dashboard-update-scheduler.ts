export type PanelUpdatePriority = 'critical' | 'normal' | 'idle';

interface PanelTask {
  run: () => void;
  priority: PanelUpdatePriority;
}

const PANEL_PRIORITY_ORDER: Record<PanelUpdatePriority, number> = {
  critical: 0,
  normal: 1,
  idle: 2,
};

type IdleCallbackHandle = number;

export class DashboardUpdateScheduler {
  private readonly mapMinIntervalMs: number;
  private mapRafId = 0;
  private mapDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private mapTask: (() => void) | null = null;
  private mapScheduled = false;
  private lastMapRunAt = 0;

  private panelRafId = 0;
  private panelFlushScheduled = false;
  private panelTasks = new Map<string, PanelTask>();

  constructor(options?: { mapMinIntervalMs?: number }) {
    this.mapMinIntervalMs = Math.max(0, options?.mapMinIntervalMs ?? 48);
  }

  scheduleMapUpdate(_reason: string, run: () => void): void {
    this.mapTask = run;
    if (this.mapScheduled) return;
    this.mapScheduled = true;
    this.scheduleMapFrame();
  }

  schedulePanelUpdate(panelId: string, run: () => void, priority: PanelUpdatePriority = 'normal'): void {
    this.panelTasks.set(panelId, { run, priority });
    if (this.panelFlushScheduled) return;
    this.panelFlushScheduled = true;
    this.panelRafId = requestAnimationFrame(() => {
      this.panelRafId = 0;
      this.flushPanelTasks();
    });
  }

  cancelAll(): void {
    if (this.mapRafId) {
      cancelAnimationFrame(this.mapRafId);
      this.mapRafId = 0;
    }
    if (this.mapDelayTimer !== null) {
      clearTimeout(this.mapDelayTimer);
      this.mapDelayTimer = null;
    }
    if (this.panelRafId) {
      cancelAnimationFrame(this.panelRafId);
      this.panelRafId = 0;
    }
    this.mapTask = null;
    this.mapScheduled = false;
    this.panelFlushScheduled = false;
    this.panelTasks.clear();
  }

  private scheduleMapFrame(): void {
    const elapsed = performance.now() - this.lastMapRunAt;
    const delay = Math.max(0, this.mapMinIntervalMs - elapsed);
    if (delay > 0) {
      this.mapDelayTimer = setTimeout(() => {
        this.mapDelayTimer = null;
        this.mapRafId = requestAnimationFrame(() => this.flushMapTask());
      }, delay);
      return;
    }
    this.mapRafId = requestAnimationFrame(() => this.flushMapTask());
  }

  private flushMapTask(): void {
    this.mapRafId = 0;
    const task = this.mapTask;
    this.mapTask = null;
    this.mapScheduled = false;
    this.lastMapRunAt = performance.now();
    if (!task) return;
    task();
  }

  private flushPanelTasks(): void {
    this.panelFlushScheduled = false;
    if (this.panelTasks.size === 0) return;

    const tasks = Array.from(this.panelTasks.entries())
      .sort(([, a], [, b]) => PANEL_PRIORITY_ORDER[a.priority] - PANEL_PRIORITY_ORDER[b.priority]);
    this.panelTasks.clear();

    let idleBudgetExceeded = false;
    const frameStart = performance.now();
    for (const [panelId, task] of tasks) {
      if (task.priority === 'idle' && idleBudgetExceeded) {
        this.panelTasks.set(panelId, task);
        continue;
      }
      task.run();
      if (performance.now() - frameStart > 10) {
        idleBudgetExceeded = true;
      }
    }

    if (this.panelTasks.size > 0) {
      this.panelFlushScheduled = true;
      this.panelRafId = requestAnimationFrame(() => {
        this.panelRafId = 0;
        this.flushPanelTasks();
      });
    }
  }
}

export const dashboardUpdateScheduler = new DashboardUpdateScheduler();

export function queueIdleWork(task: () => void, timeoutMs = 600): { cancel: () => void } {
  const globalWithIdle = window as typeof window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => IdleCallbackHandle;
    cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  };

  if (typeof globalWithIdle.requestIdleCallback === 'function') {
    const handle = globalWithIdle.requestIdleCallback(() => task(), { timeout: timeoutMs });
    return {
      cancel: () => {
        if (typeof globalWithIdle.cancelIdleCallback === 'function') {
          globalWithIdle.cancelIdleCallback(handle);
        }
      },
    };
  }

  const timeout = setTimeout(task, Math.min(timeoutMs, 180));
  return {
    cancel: () => clearTimeout(timeout),
  };
}
