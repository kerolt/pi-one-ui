import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionLifecycle } from "../app/runtime/session-lifecycle.ts";
import { readGitStatus } from "./git-data.ts";
import type { FooterState } from "./session-state.ts";
import { applyProjectRefreshToState } from "./project-state.ts";
import { readPackageVersionResult } from "./package-data.ts";
import { readRuntimeInfo } from "./runtime-data.ts";

export type StopProjectRefreshInterval = () => void;

export type ScheduleProjectRefreshOptions = {
  force?: boolean;
};

export type ProjectRefreshRun = {
  isCurrent: () => boolean;
};

export type ProjectRefreshScheduler<T> = {
  schedule: (target: T, options?: ScheduleProjectRefreshOptions) => void;
  invalidate: () => void;
  stop: () => void;
};

export const PROJECT_REFRESH_THROTTLE_MS = 5_000;

export type ProjectRefreshActivationOptions = {
  needed: boolean;
  intervalMs: number;
  onTick: () => void;
};

/**
 * Owns the optional wall-clock interval used by project refresh consumers.
 */
export class ProjectRefreshActivation {
  private stopInterval: StopProjectRefreshInterval = () => {};
  private active = false;

  /**
   * Reconciles interval ownership with the current consumer requirements.
   *
   * @param options Current requirement, interval, and refresh callback.
   * @returns Whether the interval was newly activated.
   */
  reconcile(options: ProjectRefreshActivationOptions): boolean {
    if (!options.needed) {
      this.stop();
      return false;
    }
    if (this.active) return false;
    this.stopInterval = startProjectRefreshInterval(
      options.intervalMs,
      options.onTick,
    );
    this.active = true;
    return true;
  }

  /**
   * Stops the active interval and clears its ownership state.
   */
  stop(): void {
    this.stopInterval();
    this.stopInterval = () => {};
    this.active = false;
  }
}

export type ProjectRefreshConfig = {
  projectRefreshIntervalMs: number;
  components: {
    footer: {
      styles: {
        starship: {
          gitCommit: { showTag: boolean };
          gitMetrics: { ignoreSubmodules: boolean };
        };
      };
    };
  };
};

export type ProjectRefreshServiceContext = {
  readonly getConfig: () => ProjectRefreshConfig;
  readonly state: FooterState;
  readonly sessionLifecycle: SessionLifecycle;
  readonly getFooterReferences: () => ReadonlySet<string>;
  readonly needsRefresh: () => boolean;
  readonly reconcileOwnership: (ctx: ExtensionContext) => void;
  readonly onProjectRoot: (root: string | undefined) => void;
  readonly refresh: () => void;
};

type ProjectRefreshTarget = { cwd: string; generation: number };

/**
 * Coordinates project data reads and interval activation for Footer and Editor.
 */
export class ProjectRefreshService {
  private readonly context: ProjectRefreshServiceContext;
  private readonly scheduler: ProjectRefreshScheduler<ProjectRefreshTarget>;
  private readonly activation = new ProjectRefreshActivation();
  private lastProjectCwd: string | undefined;
  private requestedProjectCwd: string | undefined;

  /**
   * Creates a generation-aware project refresh service.
   *
   * @param context Shared state and surface-neutral selectors.
   */
  constructor(context: ProjectRefreshServiceContext) {
    this.context = context;
    this.scheduler = createProjectRefreshScheduler(
      (target, run) => this.refreshProjectState(target, run),
      context.refresh,
    );
  }

  /**
   * Schedules an immediate or throttled project refresh for a session context.
   *
   * @param ctx Active Pi extension context.
   * @param options Refresh priority options.
   */
  schedule(
    ctx: ExtensionContext,
    options?: ScheduleProjectRefreshOptions,
  ): void {
    const generation = this.context.sessionLifecycle.currentGeneration();
    if (!this.context.sessionLifecycle.isCurrent(generation)) return;
    this.requestedProjectCwd = ctx.cwd;
    this.scheduler.schedule({ cwd: ctx.cwd, generation }, options);
  }

  /**
   * Reconciles polling ownership with the active Footer or Editor consumers.
   *
   * @param ctx Active Pi extension context.
   * @param force Whether to invalidate an active in-flight schedule.
   */
  reconcile(ctx: ExtensionContext, force = false): void {
    if (
      !this.context.sessionLifecycle.isCurrent() ||
      !this.context.needsRefresh()
    ) {
      this.stop();
      return;
    }
    const activated = this.activation.reconcile({
      needed: true,
      intervalMs: this.context.getConfig().projectRefreshIntervalMs,
      onTick: () => {
        this.context.reconcileOwnership(ctx);
        if (!this.context.needsRefresh()) this.stop();
        else this.schedule(ctx);
      },
    });
    if (force && !activated) this.scheduler.invalidate();
    if (force || activated) this.schedule(ctx, { force: true });
  }

  /**
   * Stops polling and invalidates all pending project refresh callbacks.
   */
  stop(): void {
    this.activation.stop();
    this.scheduler.stop();
  }

  /**
   * Refreshes Git, runtime, package, and repository-root data safely.
   *
   * @param target Session cwd and generation target.
   * @param run Scheduler freshness guard.
   */
  private async refreshProjectState(
    { cwd, generation }: ProjectRefreshTarget,
    run: ProjectRefreshRun,
  ): Promise<void> {
    if (
      !run.isCurrent() ||
      !this.context.sessionLifecycle.isCurrent(generation)
    )
      return;
    const starship = this.context.getConfig().components.footer.styles.starship;
    const references = this.context.getFooterReferences();
    const wantExactTag =
      (references.has("git_commit") && starship.gitCommit.showTag) ||
      references.has("git_tag");
    const wantMetrics =
      references.has("git_metrics") ||
      references.has("git_added") ||
      references.has("git_deleted");
    const wantPackage =
      references.has("package") || references.has("package_version");
    const wantRuntime = references.has("runtime");
    const [git, runtime, packageVersion] = await Promise.all([
      readGitStatus(cwd, {
        readExactTag: wantExactTag,
        readMetrics: wantMetrics,
        ignoreSubmodules: starship.gitMetrics.ignoreSubmodules,
      }),
      wantRuntime
        ? readRuntimeInfo(cwd)
        : Promise.resolve({ kind: "ok" as const, runtime: undefined }),
      wantPackage
        ? readPackageVersionResult(cwd)
        : Promise.resolve({ kind: "ok" as const, result: null }),
    ]);
    if (
      !run.isCurrent() ||
      !this.context.sessionLifecycle.isCurrent(generation) ||
      this.requestedProjectCwd !== cwd
    )
      return;
    this.context.onProjectRoot(
      git.kind === "ok" ? findRepositoryRoot(cwd) : undefined,
    );
    this.lastProjectCwd = applyProjectRefreshToState(this.context.state, {
      cwd,
      previousCwd: this.lastProjectCwd,
      git,
      runtime,
      packageVersion,
    });
  }
}

/**
 * Finds the nearest repository root without invoking a shell.
 *
 * @param cwd Starting directory.
 * @returns Repository root, when one is visible.
 */
function findRepositoryRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Starts a polling interval unless the configured interval disables polling.
 *
 * @param intervalMs Polling interval in milliseconds.
 * @param refresh Callback invoked for each polling tick.
 * @returns Idempotent interval cleanup function.
 */
export function startProjectRefreshInterval(
  intervalMs: number,
  refresh: () => void,
): StopProjectRefreshInterval {
  if (intervalMs <= 0) return () => {};

  const timer = setInterval(refresh, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

/**
 * Creates a throttled, generation-invalidatable project refresh scheduler.
 *
 * @param refresh Asynchronous project refresh operation.
 * @param afterRefresh Callback invoked after a current refresh settles.
 * @param throttleMs Minimum delay between ordinary refreshes.
 * @returns Scheduler controls.
 */
export function createProjectRefreshScheduler<T>(
  refresh: (target: T, run: ProjectRefreshRun) => Promise<void>,
  afterRefresh: () => void,
  throttleMs = PROJECT_REFRESH_THROTTLE_MS,
): ProjectRefreshScheduler<T> {
  let refreshInFlight = false;
  let refreshPending = false;
  let pendingForce = false;
  let pendingTarget: T | undefined;
  let delayedRefresh: ReturnType<typeof setTimeout> | undefined;
  let lastRefreshStartedAt: number | undefined;
  let generation = 0;

  const clearDelayedRefresh = () => {
    if (!delayedRefresh) return;
    clearTimeout(delayedRefresh);
    delayedRefresh = undefined;
  };

  const runRefresh = (
    target: T,
    options: ScheduleProjectRefreshOptions = {},
  ) => {
    clearDelayedRefresh();
    if (refreshInFlight) {
      refreshPending = true;
      pendingForce ||= options.force === true;
      pendingTarget = target;
      return;
    }

    const currentGeneration = generation;
    const run: ProjectRefreshRun = {
      isCurrent: () => currentGeneration === generation,
    };
    refreshInFlight = true;
    lastRefreshStartedAt = Date.now();
    void refresh(target, run)
      .catch(() => undefined)
      .finally(() => {
        if (currentGeneration !== generation) return;
        refreshInFlight = false;
        afterRefresh();
        if (refreshPending) {
          refreshPending = false;
          const nextForce = pendingForce;
          pendingForce = false;
          const nextTarget = pendingTarget ?? target;
          pendingTarget = undefined;
          schedule(nextTarget, { force: nextForce });
        }
      });
  };

  const schedule = (target: T, options: ScheduleProjectRefreshOptions = {}) => {
    if (
      options.force ||
      throttleMs <= 0 ||
      lastRefreshStartedAt === undefined
    ) {
      runRefresh(target, options);
      return;
    }

    const delayMs = Math.max(
      0,
      throttleMs - (Date.now() - lastRefreshStartedAt),
    );
    if (delayMs === 0) {
      runRefresh(target);
      return;
    }

    pendingTarget = target;
    if (delayedRefresh) return;
    delayedRefresh = setTimeout(() => {
      delayedRefresh = undefined;
      const nextTarget = pendingTarget ?? target;
      pendingTarget = undefined;
      runRefresh(nextTarget);
    }, delayMs);
    delayedRefresh.unref?.();
  };

  const invalidate = () => {
    generation += 1;
    clearDelayedRefresh();
    refreshInFlight = false;
    refreshPending = false;
    pendingForce = false;
    pendingTarget = undefined;
    lastRefreshStartedAt = undefined;
  };

  return {
    schedule,
    invalidate,
    stop: invalidate,
  };
}
