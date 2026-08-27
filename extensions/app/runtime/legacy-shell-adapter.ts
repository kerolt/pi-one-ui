import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { AccentRailLayoutPatchDiagnostic } from "../../surfaces/editor/accent-rail-layout-patch.ts";
import {
  type AccentRailEditorStyleConfig,
  type ContextStyle,
  type EditorComponentConfig,
  type ExtensionStatusColorMode,
  type ExtensionStatusPlacement,
  ensureConfigExists,
  FOOTER_FORMAT_ALIASES,
  type FooterComponentConfig,
  type FooterSegmentsConfig,
  type GitBranchConfig,
  type GitCommitConfig,
  type GitMetricsConfig,
  hasUnsupportedComponentStyle,
  type IconMode,
  loadConfig,
  type MinimalistConfig,
  type PathDisplayConfig,
  type PolishedCopyFriendlyEditorStyleConfig,
  type PolishedEditorStyleConfig,
  type PolishedTuiConfig,
  type SelectorBordersComponentConfig,
  type SeparatorStyle,
  saveAccentRailEditorStylePatch,
  saveEditorComponentPatch,
  saveExtensionStatusColorMode,
  saveExtensionStatusDefaultPlacement,
  saveExtensionStatusPlacement,
  saveFooterComponentPatch,
  saveIconsModePatch,
  saveMinimalistEditorStylePatch,
  savePolishedCopyFriendlyEditorStylePatch,
  savePolishedEditorStylePatch,
  saveSelectorBordersComponentPatch,
  saveStarshipFooterStylePatch,
  saveUserMessagesComponentPatch,
  saveWorkingLineComponentPatch,
  type UserMessagesComponentConfig,
  type WorkingLineComponentPatch,
  type ZentuiConfig,
} from "../config/shell.ts";
import { EditorSurfaceController } from "../../surfaces/editor/controller.ts";
import {
  installFooter,
  installHiddenFooter,
} from "../../surfaces/footer/index.ts";
import {
  collectFooterFormatReferences,
  parseFooterFormat,
} from "../../surfaces/footer/index.ts";
import {
  buildSessionDurationLabel,
  invalidateUsageTotalsCache,
} from "../../shared/format.ts";
import { emptyGitStatus, readGitStatus } from "../../services/git-data.ts";
import {
  InteractionMetricsTracker,
  renderTurnSummaryEntry,
  TURN_SUMMARY_ENTRY_TYPE,
} from "../../surfaces/working-line/interaction-summary.ts";
import { LiveContextController } from "../../services/live-context.ts";
import { readPackageVersionResult } from "../../services/package-data.ts";
import {
  createProjectRefreshScheduler,
  type ProjectRefreshRun,
  type ScheduleProjectRefreshOptions,
  type StopProjectRefreshInterval,
  startProjectRefreshInterval,
} from "../../services/project-refresh.ts";
import { applyProjectRefreshToState } from "../../services/project-state.ts";
import { readRuntimeInfo } from "../../services/runtime-data.ts";
import {
  installSelectorBorderStyle,
  removeSelectorBorderStyle,
} from "../overlay/selector-border.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { registerShellSettingsCommand } from "../commands/legacy-shell-settings.ts";
import {
  createInitialState,
  type FooterState,
  modelLabelFor,
  syncState,
} from "../../surfaces/footer/index.ts";
import { resolveFooterTelemetry } from "../../services/telemetry.ts";
import {
  installUserMessageStyle,
  removeUserMessageStyle,
} from "../../surfaces/context/message/user-message.ts";
import {
  AgentDurationClock,
  snapshotWorkingLineHighStyle,
  WorkingLineController,
} from "../../surfaces/working-line/working-line.ts";

const ZENTUI_FOOTER_OWNER = Symbol.for("pi-zentui.footer-owner");

type InstalledFooterKind = "starship" | "hidden";

export function activeFooterReferences(config: ZentuiConfig): Set<string> {
  const starship = config.components.footer.styles.starship;
  const references = starship.format
    ? collectFooterFormatReferences(
        parseFooterFormat(starship.format),
        FOOTER_FORMAT_ALIASES,
      )
    : new Set<string>([
        ...(starship.segments.sessionName ? ["session_name"] : []),
        ...(starship.segments.runtime ? ["runtime"] : []),
        ...(starship.segments.gitCommit ? ["git_commit"] : []),
        ...(starship.segments.gitMetrics ? ["git_metrics"] : []),
        ...(starship.segments.packageVersion ? ["package"] : []),
        ...(starship.segments.sessionDuration ? ["session_duration"] : []),
        ...(starship.segments.time ? ["time"] : []),
      ]);
  if (starship.responsive) {
    for (const name of collectFooterFormatReferences(
      parseFooterFormat(starship.compactFormat),
      FOOTER_FORMAT_ALIASES,
    )) {
      references.add(name);
    }
  }
  return references;
}

function findRepositoryRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isTuiContext(ctx: ExtensionContext): boolean {
  try {
    const mode = (ctx as ExtensionContext & { mode?: string }).mode;
    return ctx.hasUI && (mode === undefined || mode === "tui");
  } catch {
    return false;
  }
}

export type ShellRuntimeController = {
  setUserMessagesComponent: (
    patch: Partial<UserMessagesComponentConfig>,
    ctx: ExtensionContext,
  ) => void;
  setWorkingLineComponent: (
    patch: WorkingLineComponentPatch,
    ctx: ExtensionContext,
  ) => { applied: boolean; reason?: string };
  setFooterComponent: (
    patch: Partial<FooterComponentConfig>,
    ctx: ExtensionContext,
  ) => void;
};

export type ShellExtensionOptions = {
  /**
   * Exposes the live shell reconciler to the unified settings panel.
   */
  /**
   * Keeps legacy standalone registration disabled in the unified package.
   */
  registerCommand?: boolean;
  /**
   * Keeps User Message patch ownership in Shell for standalone compatibility.
   */
  ownUserMessages?: boolean;
  /**
   * Keeps turn-summary entry ownership in Shell for standalone compatibility.
   */
  ownTurnSummary?: boolean;
  onRuntimeController?: (controller: ShellRuntimeController) => void;
  onEditorController?: (controller: EditorSurfaceController) => void;
  /**
   * Lets the unified runtime own Editor session installation.
   */
  manageEditorLifecycle?: boolean;
};

export default function (
  pi: ExtensionAPI,
  options: ShellExtensionOptions = {},
) {
  const state: FooterState = createInitialState(emptyGitStatus());
  const sessionLifecycle = new SessionLifecycle();
  let currentConfig: PolishedTuiConfig = loadConfig();
  // Keep the capability guard defensive for hosts with incomplete extension APIs.
  if (typeof pi.registerEntryRenderer === "function") {
    pi.registerEntryRenderer(TURN_SUMMARY_ENTRY_TYPE, (entry, options, theme) =>
      renderTurnSummaryEntry(
        entry,
        {
          ...options,
          colorSource: currentConfig.components.workingLine.colorSource,
          workingLineHigh: currentConfig.colors.workingLineHigh,
        },
        theme,
      ),
    );
  }
  let activeTheme: Theme | undefined;
  let requestFooterRender: (() => void) | undefined;
  let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () =>
    new Map();
  let stopRefreshInterval: StopProjectRefreshInterval = () => {};
  let cleanupUserMessageStyle: () => void = () => {};
  let userMessageStyleInstalled = false;
  let cleanupSelectorBorderStyle: () => void = () => {};
  let selectorBorderStyleInstalled = false;
  let installedFooterKind: InstalledFooterKind | undefined;
  let installedFooterToken: symbol | undefined;
  let stopSessionTimer: () => void = () => {};
  let sessionTimerRequirements = "";
  let lastDurationLabel = "";
  let lastProjectCwd: string | undefined;
  let requestedProjectCwd: string | undefined;
  const agentDurationClock = new AgentDurationClock();
  const interactionMetrics = new InteractionMetricsTracker();
  let agentRunActive = false;
  let minimalistProjectRoot: string | undefined;
  let projectRefreshActive = false;
  let activeTuiContext: ExtensionContext | undefined;

  const recordAccentRailLayoutPatchDiagnostic = (
    diagnostic: AccentRailLayoutPatchDiagnostic,
    version?: string,
  ) => {
    if (process.env.ZENTUI_DEBUG === "1") {
      console.error(
        `[zentui] Accent Rail fullscreen layout patch: ${diagnostic}${version ? ` (Pi TUI ${version})` : ""}`,
      );
    }
  };

  const effectiveUserMessagesEnabled = () =>
    options.ownUserMessages !== false &&
    currentConfig.components.userMessages.enabled &&
    !hasUnsupportedComponentStyle(currentConfig, "userMessages");
  const effectiveSelectorBordersEnabled = () =>
    currentConfig.components.selectorBorders.enabled &&
    !hasUnsupportedComponentStyle(currentConfig, "selectorBorders");
  const effectiveFooterStyle = () =>
    hasUnsupportedComponentStyle(currentConfig, "footer")
      ? ("native" as const)
      : currentConfig.components.footer.style;

  /**
   * Requests redraws from the Editor controller and shared render seam.
   */
  const refresh = () => {
    if (!sessionLifecycle.isCurrent()) return;
    editorController.requestRender();
  };
  const liveContext = new LiveContextController(sessionLifecycle, refresh);
  const getActiveTheme = () => activeTheme;
  const getCurrentConfig = () => currentConfig;
  const workingLine = new WorkingLineController(
    getCurrentConfig,
    () => activeTheme as Theme,
    agentDurationClock,
    Math.random,
    Date.now,
    () => interactionMetrics.currentThought(),
  );
  const getThinkingLevel = () =>
    sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
  const editorController = new EditorSurfaceController({
    getConfig: getCurrentConfig,
    saveComponent: (patch) => {
      currentConfig = saveEditorComponentPatch(patch);
      return currentConfig;
    },
    getState: () => state,
    sessionLifecycle,
    render: { request: () => requestFooterRender?.() },
    getThinkingLevel,
    getContextWindow: (ctx) =>
      ctx.model?.contextWindow ?? ctx.getContextUsage()?.contextWindow,
    getContextPercent: (ctx) => {
      const usage = ctx.getContextUsage();
      const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow;
      const live = liveContext.get();
      return live && contextWindow && contextWindow > 0
        ? (live.tokens / contextWindow) * 100
        : (usage?.percent ?? undefined);
    },
    getAgentDurationMs: () => agentDurationClock.elapsedMs() ?? 0,
    isAgentActive: () => agentRunActive,
    isAgentDurationActive: () => agentDurationClock.isActive(),
    subscribeAgentDuration: (listener) =>
      agentDurationClock.subscribe(listener),
    getProjectRoot: () => minimalistProjectRoot,
    onProjectRequirementChanged: () => {
      if (activeTuiContext) reconcileProjectRefresh(activeTuiContext);
    },
    onModelLabelChanged: (ctx) => syncFooterState(ctx),
    recordLayoutDiagnostic: recordAccentRailLayoutPatchDiagnostic,
  });
  const syncFooterState = (ctx: ExtensionContext) =>
    syncState(
      state,
      ctx,
      currentConfig.icons.cacheHit,
      resolveFooterTelemetry(ctx),
    );
  const ownsInstalledFooter = () =>
    Boolean(
      activeTuiContext &&
        installedFooterToken &&
        ctxFooterOwner(activeTuiContext) === installedFooterToken,
    );
  const installedFooterReferences = () =>
    installedFooterKind === "starship" && ownsInstalledFooter()
      ? activeFooterReferences(currentConfig)
      : new Set<string>();

  type ProjectRefreshTarget = { cwd: string; generation: number };
  const refreshProjectState = async (
    { cwd, generation }: ProjectRefreshTarget,
    run: ProjectRefreshRun,
  ) => {
    if (!run.isCurrent() || !sessionLifecycle.isCurrent(generation)) return;
    const starship = currentConfig.components.footer.styles.starship;
    const gitCommitConfig = starship.gitCommit;
    const gitMetricsConfig = starship.gitMetrics;
    const references = installedFooterReferences();
    const wantExactTag =
      (references.has("git_commit") && gitCommitConfig.showTag) ||
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
        ignoreSubmodules: gitMetricsConfig.ignoreSubmodules,
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
      !sessionLifecycle.isCurrent(generation) ||
      requestedProjectCwd !== cwd
    ) {
      return;
    }
    minimalistProjectRoot =
      git.kind === "ok" ? findRepositoryRoot(cwd) : undefined;
    lastProjectCwd = applyProjectRefreshToState(state, {
      cwd,
      previousCwd: lastProjectCwd,
      git,
      runtime,
      packageVersion,
    });
  };

  const projectRefreshScheduler = createProjectRefreshScheduler(
    refreshProjectState,
    refresh,
  );
  const scheduleProjectRefresh = (
    ctx: ExtensionContext,
    options?: ScheduleProjectRefreshOptions,
  ) => {
    const generation = sessionLifecycle.currentGeneration();
    if (!sessionLifecycle.isCurrent(generation)) return;
    const cwd = ctx.cwd;
    requestedProjectCwd = cwd;
    projectRefreshScheduler.schedule({ cwd, generation }, options);
  };

  /**
   * Reports whether any active surface currently needs project metadata.
   */
  const needsProjectRefresh = () =>
    (installedFooterKind === "starship" && ownsInstalledFooter()) ||
    editorController.needsProjectRefresh();

  const stopProjectRefresh = () => {
    stopRefreshInterval();
    stopRefreshInterval = () => {};
    projectRefreshScheduler.stop();
    projectRefreshActive = false;
  };

  /**
   * Starts, stops, or invalidates shared project refresh work.
   */
  const reconcileProjectRefresh = (ctx: ExtensionContext, force = false) => {
    if (!sessionLifecycle.isCurrent() || !needsProjectRefresh()) {
      stopProjectRefresh();
      return;
    }
    const activated = !projectRefreshActive;
    if (activated) {
      stopRefreshInterval = startProjectRefreshInterval(
        currentConfig.projectRefreshIntervalMs,
        () => {
          editorController.reconcileOwnership(ctx);
          if (!needsProjectRefresh()) {
            stopProjectRefresh();
            return;
          }
          scheduleProjectRefresh(ctx);
        },
      );
      projectRefreshActive = true;
    }
    if (force && !activated) projectRefreshScheduler.invalidate();
    if (force || activated) scheduleProjectRefresh(ctx, { force: true });
  };

  /**
   * Synchronizes shared session state and requests a visible redraw.
   */
  const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
    if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
    editorController.reconcileOwnership(ctx);
    syncFooterState(ctx);
    if (project && needsProjectRefresh()) scheduleProjectRefresh(ctx);
    refresh();
  };

  const reconcileSessionTimer = () => {
    const references = installedFooterReferences();
    const needsTime = references.has("time");
    const needsDuration = references.has("session_duration");
    const nextRequirements =
      needsTime || needsDuration ? `${needsTime}:${needsDuration}` : "";
    if (
      !sessionLifecycle.isCurrent() ||
      installedFooterKind !== "starship" ||
      !ownsInstalledFooter() ||
      !nextRequirements
    ) {
      stopSessionTimer();
      sessionTimerRequirements = "";
      lastDurationLabel = "";
      return;
    }
    if (sessionTimerRequirements === nextRequirements) return;

    stopSessionTimer();
    sessionTimerRequirements = nextRequirements;
    lastDurationLabel = "";
    const timer = setInterval(() => {
      if (!sessionLifecycle.isCurrent()) return;
      if (needsTime) {
        refresh();
        return;
      }
      const label = state.sessionStartEpoch
        ? buildSessionDurationLabel(state.sessionStartEpoch)
        : "";
      if (label === lastDurationLabel) return;
      lastDurationLabel = label;
      refresh();
    }, 1000);
    stopSessionTimer = () => {
      clearInterval(timer);
      sessionTimerRequirements = "";
      stopSessionTimer = () => {};
    };
  };

  /**
   * Starts agent timing and notifies the Editor controller.
   */
  const startAgentTurn = (interactionStarted: boolean) => {
    agentRunActive = true;
    if (interactionStarted) agentDurationClock.start();
    editorController.setAgentRunActive(true);
    refresh();
  };

  /**
   * Pauses agent timing and notifies the Editor controller.
   */
  const pauseAgentRun = () => {
    agentRunActive = false;
    editorController.setAgentRunActive(false);
    refresh();
  };

  /**
   * Settles or rolls forward agent timing after an idle check.
   */
  const settleAgentTurn = (nextStartedAt?: number) => {
    agentRunActive = nextStartedAt !== undefined;
    if (nextStartedAt === undefined) agentDurationClock.finish();
    else agentDurationClock.start(nextStartedAt);
    editorController.setAgentRunActive(agentRunActive);
    refresh();
  };

  /**
   * Resets agent timing for the next session generation.
   */
  const resetAgentTimer = () => {
    agentRunActive = false;
    agentDurationClock.reset();
    editorController.resetAgentTimer();
  };

  const sameReferences = (left: Set<string>, right: Set<string>) =>
    left.size === right.size && [...left].every((name) => right.has(name));

  const applyFooterDependencyConfigChange = (
    ctx: ExtensionContext,
    save: () => PolishedTuiConfig,
  ) => {
    const before = activeFooterReferences(currentConfig);
    const nextConfig = save();
    const after = activeFooterReferences(nextConfig);
    currentConfig = nextConfig;
    if (sameReferences(before, after)) return;
    reconcileSessionTimer();
    reconcileProjectRefresh(ctx, true);
  };

  const installUserMessages = () => {
    if (userMessageStyleInstalled) return;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = installUserMessageStyle(getActiveTheme, getCurrentConfig);
      cleanupUserMessageStyle = cleanup ?? (() => {});
      userMessageStyleInstalled = true;
    } catch {
      try {
        cleanup?.();
      } catch {
        // Best effort: the installer is locally transactional.
      }
      cleanupUserMessageStyle = () => {};
      userMessageStyleInstalled = false;
    }
  };

  const uninstallUserMessages = () => {
    try {
      cleanupUserMessageStyle();
    } catch {
      // Best effort cleanup.
    } finally {
      cleanupUserMessageStyle = () => {};
      userMessageStyleInstalled = false;
    }
  };

  const reconcileUserMessages = () => {
    if (effectiveUserMessagesEnabled()) installUserMessages();
    else uninstallUserMessages();
  };

  const installSelectorBorders = () => {
    if (selectorBorderStyleInstalled) return;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = installSelectorBorderStyle(getActiveTheme, getCurrentConfig);
      cleanupSelectorBorderStyle = cleanup;
      selectorBorderStyleInstalled = true;
    } catch {
      try {
        cleanup?.();
      } catch {
        // Best effort: the installer is locally transactional.
      }
      cleanupSelectorBorderStyle = () => {};
      selectorBorderStyleInstalled = false;
    }
  };

  const uninstallSelectorBorders = () => {
    try {
      cleanupSelectorBorderStyle();
    } catch {
      // Best effort cleanup.
    } finally {
      cleanupSelectorBorderStyle = () => {};
      selectorBorderStyleInstalled = false;
    }
  };

  const reconcileSelectorBorders = () => {
    const selectors = currentConfig.components.selectorBorders;
    if (effectiveSelectorBordersEnabled() && selectors.style === "zentui") {
      installSelectorBorders();
    } else uninstallSelectorBorders();
  };

  const ctxFooterOwner = (ctx: ExtensionContext): unknown =>
    (ctx.ui as unknown as Record<PropertyKey, unknown>)[ZENTUI_FOOTER_OWNER];

  const setStatusLineOwnership = (
    ctx: ExtensionContext,
    token: symbol | undefined,
  ) => {
    const ui = ctx.ui as unknown as Record<PropertyKey, unknown>;
    try {
      if (token) ui[ZENTUI_FOOTER_OWNER] = token;
      else delete ui[ZENTUI_FOOTER_OWNER];
    } catch {
      // Failure to mark ownership intentionally prevents Native from restoring it.
    }
  };

  const ownsStatusLine = (ctx: ExtensionContext) =>
    installedFooterToken !== undefined &&
    ctxFooterOwner(ctx) === installedFooterToken;

  const clearFooterOwnership = (ctx: ExtensionContext, token: symbol) => {
    if (installedFooterToken !== token) return;
    installedFooterKind = undefined;
    installedFooterToken = undefined;
    if (ctxFooterOwner(ctx) === token) setStatusLineOwnership(ctx, undefined);
    requestFooterRender = undefined;
    getActiveExtensionStatuses = () => new Map();
    stopSessionTimer();
    if (sessionLifecycle.isCurrent()) reconcileProjectRefresh(ctx, true);
  };

  type FooterBookkeepingSnapshot = {
    token: symbol | undefined;
    requestRender: (() => void) | undefined;
    getExtensionStatuses: () => ReadonlyMap<string, string>;
  };

  const snapshotFooterBookkeeping = (
    ctx: ExtensionContext,
  ): FooterBookkeepingSnapshot => ({
    token: ownsStatusLine(ctx) ? installedFooterToken : undefined,
    requestRender: requestFooterRender,
    getExtensionStatuses: getActiveExtensionStatuses,
  });

  const resetFailedFooterInstallation = (
    ctx: ExtensionContext,
    token: symbol,
    previous: FooterBookkeepingSnapshot,
  ) => {
    // Pi has no transactional Footer replacement API. If a live replacement
    // fails while retaining our predecessor, preserve that Footer's callbacks
    // and timer. Otherwise clear only local bookkeeping; never issue a
    // destructive setFooter(undefined) rollback.
    if (
      previous.token !== undefined &&
      installedFooterToken === previous.token &&
      ctxFooterOwner(ctx) === previous.token
    ) {
      requestFooterRender = previous.requestRender;
      getActiveExtensionStatuses = previous.getExtensionStatuses;
      return;
    }
    clearFooterOwnership(ctx, token);
    requestFooterRender = undefined;
    getActiveExtensionStatuses = () => new Map();
    stopSessionTimer();
  };

  const installStatusLine = (ctx: ExtensionContext) => {
    if (installedFooterKind === "starship" && ownsStatusLine(ctx)) return;
    const token = Symbol("zentui-starship-footer");
    const previous = snapshotFooterBookkeeping(ctx);
    try {
      installFooter(ctx, state, getCurrentConfig, {
        setRequestRender: (fn) => {
          requestFooterRender = fn;
        },
        scheduleProjectRefresh,
        setExtensionStatusesGetter(fn) {
          getActiveExtensionStatuses = fn ?? (() => new Map());
        },
        getLiveContext: () => liveContext.get(),
        onDispose: () => clearFooterOwnership(ctx, token),
      });
      installedFooterKind = "starship";
      installedFooterToken = token;
      setStatusLineOwnership(ctx, token);
      refresh();
      reconcileSessionTimer();
    } catch {
      resetFailedFooterInstallation(ctx, token, previous);
    }
  };

  const installHiddenStatusLine = (ctx: ExtensionContext) => {
    if (installedFooterKind === "hidden" && ownsStatusLine(ctx)) return;
    const token = Symbol("zentui-hidden-footer");
    const previous = snapshotFooterBookkeeping(ctx);
    try {
      installHiddenFooter(ctx, () => clearFooterOwnership(ctx, token));
      installedFooterKind = "hidden";
      installedFooterToken = token;
      setStatusLineOwnership(ctx, token);
      requestFooterRender = undefined;
      getActiveExtensionStatuses = () => new Map();
      stopSessionTimer();
    } catch {
      resetFailedFooterInstallation(ctx, token, previous);
    }
  };

  const uninstallStatusLine = (
    ctx: ExtensionContext,
    options: { forceLocalCleanup?: boolean } = {},
  ) => {
    const ownedToken = ownsStatusLine(ctx) ? installedFooterToken : undefined;
    if (!ownedToken) return;
    try {
      ctx.ui.setFooter(undefined);
    } catch {
      // A live transition must preserve an owned Footer that Pi retained.
      // Shutdown cannot keep local callbacks alive, so it clears bookkeeping.
      if (!options.forceLocalCleanup) return;
    }
    clearFooterOwnership(ctx, ownedToken);
  };

  const reconcileFooter = (ctx: ExtensionContext) => {
    switch (effectiveFooterStyle()) {
      case "starship":
        installStatusLine(ctx);
        break;
      case "hidden":
        installHiddenStatusLine(ctx);
        break;
      case "native":
        uninstallStatusLine(ctx);
        break;
    }
  };

  /**
   * Reconciles non-Editor compatibility surfaces for the active session.
   */
  const applyConfiguredUi = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    reconcileUserMessages();
    reconcileSelectorBorders();
    reconcileFooter(ctx);
    reconcileProjectRefresh(ctx);
    reconcileSessionTimer();
  };

  /**
   * Installs compatibility surfaces around the extracted Editor controller.
   */
  const installUi = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    activeTuiContext = ctx;
    activeTheme = ctx.ui.theme;
    const staleFooterOwner = ctxFooterOwner(ctx);
    if (typeof staleFooterOwner === "symbol")
      installedFooterToken = staleFooterOwner;
    ensureConfigExists();
    currentConfig = loadConfig();
    syncFooterState(ctx);
    stopProjectRefresh();

    uninstallUserMessages();
    uninstallSelectorBorders();
    try {
      removeUserMessageStyle();
    } catch {
      // Startup alone may supersede a stale registration from an earlier reload.
    }
    try {
      removeSelectorBorderStyle();
    } catch {
      // Startup alone may supersede a stale registration from an earlier reload.
    }
    uninstallStatusLine(ctx);
    if (options.manageEditorLifecycle !== false)
      editorController.install(ctx, true);
    applyConfiguredUi(ctx);
    refresh();
  };

  /**
   * Cleans all session-owned surface resources in dependency order.
   */
  const cleanupUi = (ctx?: ExtensionContext) => {
    if (!ctx || !sessionLifecycle.isCurrent()) return;
    editorController.cleanup(ctx);
    stopSessionTimer();
    stopProjectRefresh();
    uninstallStatusLine(ctx, { forceLocalCleanup: true });
    uninstallUserMessages();
    uninstallSelectorBorders();
    installedFooterKind = undefined;
    installedFooterToken = undefined;
    requestFooterRender = undefined;
    getActiveExtensionStatuses = () => new Map();
    activeTheme = undefined;
    activeTuiContext = undefined;
  };

  const syncInteractiveState = (_event: unknown, ctx: ExtensionContext) => {
    refreshInteractiveState(ctx);
  };
  const syncInteractiveAndProjectState = (
    _event: unknown,
    ctx: ExtensionContext,
  ) => {
    refreshInteractiveState(ctx, true);
  };

  pi.on("session_start", async (_event, ctx) => {
    sessionLifecycle.start();
    if (options.manageEditorLifecycle !== false)
      await editorController.startSession(ctx);
    if (!sessionLifecycle.isCurrent()) return;
    liveContext.clear();
    interactionMetrics.shutdown();
    state.sessionStartEpoch = Date.now();
    invalidateUsageTotalsCache();
    resetAgentTimer();
    lastProjectCwd = undefined;
    requestedProjectCwd = undefined;
    minimalistProjectRoot = undefined;
    installUi(ctx);
    workingLine.startSession(ctx);
  });

  /**
   * Delegates a live Editor configuration change to the Editor controller.
   */
  const setEditorComponent = (
    patch: Partial<EditorComponentConfig>,
    ctx: ExtensionContext,
  ) => editorController.setComponent(patch, ctx);
  const setUserMessagesComponent = (
    patch: Partial<UserMessagesComponentConfig>,
    _ctx: ExtensionContext,
  ) => {
    currentConfig = saveUserMessagesComponentPatch(patch);
    if (patch.enabled !== undefined || patch.style !== undefined)
      reconcileUserMessages();
    refresh();
  };
  const setWorkingLineComponent = (
    patch: WorkingLineComponentPatch,
    ctx: ExtensionContext,
  ) => {
    currentConfig = saveWorkingLineComponentPatch(patch);
    return workingLine.reconcile(ctx);
  };
  const setFooterComponent = (
    patch: Partial<FooterComponentConfig>,
    ctx: ExtensionContext,
  ) => {
    const previousStyle = effectiveFooterStyle();
    currentConfig = saveFooterComponentPatch(patch);
    const styleChanged = effectiveFooterStyle() !== previousStyle;
    if (patch.style !== undefined) reconcileFooter(ctx);
    if (patch.modelLabel !== undefined) syncFooterState(ctx);
    reconcileProjectRefresh(ctx, styleChanged);
    reconcileSessionTimer();
    refresh();
  };
  options.onEditorController?.(editorController);
  options.onRuntimeController?.({
    setUserMessagesComponent,
    setWorkingLineComponent,
    setFooterComponent,
  });

  if (options.registerCommand !== false)
    registerShellSettingsCommand(pi, {
      sessionLifecycle,
      getConfig: getCurrentConfig,
      setEditorComponent,
      setPolished(
        patch: Partial<PolishedEditorStyleConfig>,
        _ctx: ExtensionContext,
      ) {
        currentConfig = savePolishedEditorStylePatch(patch);
        refresh();
      },
      setPolishedCopyFriendly(
        patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
        _ctx: ExtensionContext,
      ) {
        currentConfig = savePolishedCopyFriendlyEditorStylePatch(patch);
        refresh();
      },
      setAccentRail(
        patch: Partial<AccentRailEditorStyleConfig>,
        _ctx: ExtensionContext,
      ) {
        currentConfig = saveAccentRailEditorStylePatch(patch);
        refresh();
      },
      setMinimalist(patch: Partial<MinimalistConfig>, ctx: ExtensionContext) {
        currentConfig = saveMinimalistEditorStylePatch(patch);
        editorController.reconcileTimers();
        reconcileProjectRefresh(
          ctx,
          patch.pathDisplay !== undefined || patch.showGit !== undefined,
        );
        refresh();
      },
      setUserMessagesComponent(
        patch: Partial<UserMessagesComponentConfig>,
        _ctx: ExtensionContext,
      ) {
        currentConfig = saveUserMessagesComponentPatch(patch);
        if (patch.enabled !== undefined || patch.style !== undefined)
          reconcileUserMessages();
        refresh();
      },
      setWorkingLineComponent(
        patch: WorkingLineComponentPatch,
        ctx: ExtensionContext,
      ) {
        currentConfig = saveWorkingLineComponentPatch(patch);
        return workingLine.reconcile(ctx);
      },
      setSelectorBordersComponent(
        patch: Partial<SelectorBordersComponentConfig>,
        _ctx: ExtensionContext,
      ) {
        currentConfig = saveSelectorBordersComponentPatch(patch);
        if (patch.enabled !== undefined || patch.style !== undefined)
          reconcileSelectorBorders();
        refresh();
      },
      setFooterComponent(
        patch: Partial<FooterComponentConfig>,
        ctx: ExtensionContext,
      ) {
        const previousStyle = effectiveFooterStyle();
        currentConfig = saveFooterComponentPatch(patch);
        const styleChanged = effectiveFooterStyle() !== previousStyle;
        if (patch.style !== undefined) reconcileFooter(ctx);
        if (patch.modelLabel !== undefined) syncFooterState(ctx);
        reconcileProjectRefresh(ctx, styleChanged);
        reconcileSessionTimer();
        refresh();
      },
      setFooterSegments(
        patch: Partial<FooterSegmentsConfig>,
        ctx: ExtensionContext,
      ) {
        applyFooterDependencyConfigChange(ctx, () =>
          saveStarshipFooterStylePatch({
            segments: patch as FooterSegmentsConfig,
          }),
        );
      },
      setFooterFormat(value: string, ctx: ExtensionContext) {
        applyFooterDependencyConfigChange(ctx, () =>
          saveStarshipFooterStylePatch({ format: value }),
        );
      },
      setResponsiveFooter(
        patch: Partial<
          Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterMaxLines">
        >,
        ctx: ExtensionContext,
      ) {
        applyFooterDependencyConfigChange(ctx, () =>
          saveStarshipFooterStylePatch({
            ...(patch.responsiveFooter === undefined
              ? {}
              : { responsive: patch.responsiveFooter }),
            ...(patch.compactFooterMaxLines === undefined
              ? {}
              : { compactMaxLines: patch.compactFooterMaxLines }),
          }),
        );
      },
      setIconMode(mode: IconMode) {
        currentConfig = saveIconsModePatch(mode);
      },
      setContextStyle(style: ContextStyle) {
        currentConfig = saveStarshipFooterStylePatch({ contextStyle: style });
      },
      setSeparator(separator: SeparatorStyle) {
        currentConfig = saveStarshipFooterStylePatch({ separator });
      },
      setPathDisplay(patch: Partial<PathDisplayConfig>) {
        currentConfig = saveStarshipFooterStylePatch({
          pathDisplay: patch as PathDisplayConfig,
        });
      },
      setGitBranch(patch: Partial<GitBranchConfig>) {
        currentConfig = saveStarshipFooterStylePatch({
          gitBranch: patch as GitBranchConfig,
        });
      },
      setGitCommit(
        patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
        ctx: ExtensionContext,
      ) {
        currentConfig = saveStarshipFooterStylePatch({
          gitCommit: patch as GitCommitConfig,
        });
        if (patch.showTag !== undefined) reconcileProjectRefresh(ctx, true);
      },
      setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
        currentConfig = saveStarshipFooterStylePatch({
          gitMetrics: patch as GitMetricsConfig,
        });
        if (patch.ignoreSubmodules !== undefined)
          reconcileProjectRefresh(ctx, true);
      },
      getActiveExtensionStatuses() {
        return getActiveExtensionStatuses();
      },
      setExtensionStatusDefaultPlacement(placement: ExtensionStatusPlacement) {
        currentConfig = saveExtensionStatusDefaultPlacement(placement);
      },
      setExtensionStatusPlacement(
        key: string,
        placement: ExtensionStatusPlacement,
      ) {
        currentConfig = saveExtensionStatusPlacement(key, placement);
      },
      setExtensionStatusColorMode(
        key: string,
        colorMode: ExtensionStatusColorMode,
      ) {
        currentConfig = saveExtensionStatusColorMode(key, colorMode);
      },
      requestRender() {
        refresh();
      },
    });

  pi.on("session_shutdown", async (_event, ctx) => {
    liveContext.clear();
    interactionMetrics.shutdown();
    workingLine.dispose(ctx);
    cleanupUi(ctx);
  });

  const syncInteractiveAndProjectStateWithUsage = (
    _event: unknown,
    ctx: ExtensionContext,
  ) => {
    invalidateUsageTotalsCache();
    refreshInteractiveState(ctx, true);
  };

  pi.on("agent_start", (event, ctx) => {
    liveContext.clear();
    const { interactionStarted } = interactionMetrics.agentStart();
    startAgentTurn(interactionStarted);
    workingLine.startAgent(ctx);
    syncInteractiveState(event, ctx);
  });
  pi.on("turn_start", (_event, ctx) => {
    interactionMetrics.turnStart();
    workingLine.startTurn(ctx);
  });
  pi.on("agent_end", (event, ctx) => {
    liveContext.clear();
    const displayTokens = interactionMetrics.currentDisplayTokens();
    interactionMetrics.agentEnd();
    pauseAgentRun();
    workingLine.finishAgent(ctx);
    workingLine.updateMetrics(
      displayTokens,
      interactionMetrics.currentThought(),
      ctx,
    );
    // Reconcile once more after Pi has persisted the assistant message.
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  pi.on("model_select", (event, ctx) => {
    liveContext.clear();
    syncInteractiveState(event, ctx);
  });
  pi.on("thinking_level_select", syncInteractiveState);
  pi.on("session_info_changed", syncInteractiveState);
  pi.on("message_update", (event, ctx) => {
    liveContext.update(event.message);
    const metrics = interactionMetrics.messageUpdate(
      event.message,
      "assistantMessageEvent" in event
        ? event.assistantMessageEvent
        : undefined,
    );
    if (metrics.usageChanged || metrics.thoughtChanged) {
      workingLine.updateMetrics(
        metrics.displayTokens,
        interactionMetrics.currentThought(),
        ctx,
      );
    }
  });
  pi.on("message_end", (event, ctx) => {
    const result = interactionMetrics.messageEnd(event.message);
    if (result.status === "accepted") {
      workingLine.updateMetrics(
        result.displayTokens,
        interactionMetrics.currentThought(),
        ctx,
      );
    }
    // Pi notifies extensions before persisting a successful message, so retain its live
    // context until agent_end; accepted failed messages clear immediately instead of showing
    // stale usage. Rejected and duplicate finals are not authoritative.
    if (
      result.status === "accepted" &&
      event.message.role === "assistant" &&
      (event.message.stopReason === "error" ||
        event.message.stopReason === "aborted")
    ) {
      liveContext.clear();
    }
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    const settled = interactionMetrics.settle(ctx.isIdle());
    if (!settled) return;
    settleAgentTurn(settled.nextStartedAt);
    workingLine.settle(settled.nextTokens, settled.nextThought, ctx);
    const config = currentConfig.components.workingLine;
    if (
      options.ownTurnSummary !== false &&
      config.enabled &&
      config.turnSummary
    ) {
      try {
        pi.appendEntry(TURN_SUMMARY_ENTRY_TYPE, {
          version: 3,
          ...settled.summary,
          stylePrefix: snapshotWorkingLineHighStyle(
            ctx.ui.theme,
            config,
            currentConfig.colors,
          ),
        });
      } catch {
        // A transcript persistence failure must not break settlement cleanup.
      }
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    liveContext.clear();
    workingLine.startTool(event.toolCallId, event.toolName, ctx);
    syncInteractiveState(event, ctx);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    workingLine.finishTool(event.toolCallId, ctx);
    syncInteractiveAndProjectState(event, ctx);
  });
  pi.on("session_compact", (event, ctx) => {
    liveContext.clear();
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  pi.on("session_tree", (event, ctx) => {
    liveContext.clear();
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
}
