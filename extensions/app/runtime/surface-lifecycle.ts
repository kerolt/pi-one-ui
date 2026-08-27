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
  saveWorkingLineComponentPatch,
  type UserMessagesComponentConfig,
  type WorkingLineComponentPatch,
  type ZentuiConfig,
} from "../config/shell.ts";
import { EditorSurfaceController } from "../../surfaces/editor/controller.ts";
import { FooterSurfaceController } from "../../surfaces/footer/controller.ts";
export { activeFooterReferences } from "../../surfaces/footer/data.ts";
import { invalidateUsageTotalsCache } from "../../shared/format.ts";
import { emptyGitStatus, readGitStatus } from "../../services/git-data.ts";
import {
  renderTurnSummaryEntry,
  TURN_SUMMARY_ENTRY_TYPE,
} from "../../surfaces/working-line/interaction-summary.ts";
import { LiveContextController } from "../../services/live-context.ts";
import { readPackageVersionResult } from "../../services/package-data.ts";
import {
  createProjectRefreshScheduler,
  ProjectRefreshActivation,
  type ProjectRefreshRun,
  type ScheduleProjectRefreshOptions,
} from "../../services/project-refresh.ts";
import { applyProjectRefreshToState } from "../../services/project-state.ts";
import { readRuntimeInfo } from "../../services/runtime-data.ts";
import {
  installSelectorBorderStyle,
  removeSelectorBorderStyle,
} from "../overlay/selector-border.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { EventCoordinator } from "./event-coordinator.ts";
import {
  createInitialState,
  type FooterState,
  modelLabelFor,
  syncState,
} from "../../surfaces/footer/index.ts";
import { resolveFooterTelemetry } from "../../services/telemetry.ts";
import {
  WorkingLineSurfaceController,
  type WorkingLineMessage,
  type WorkingLineMessageEnd,
} from "../../surfaces/working-line/controller.ts";

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
    const mode = ctx.mode;
    return ctx.hasUI && (mode === undefined || mode === "tui");
  } catch {
    return false;
  }
}

export type SurfaceRuntimeController = {
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

export type SurfaceRuntimeOptions = {
  /**
   * Exposes remaining surface configuration hooks to standalone callers.
   */
  /**
   * Allows standalone compatibility tests to opt into the old command.
   */
  registerCommand?: (pi: ExtensionAPI, deps: never) => void;
  /**
   * Keeps turn-summary entry ownership available for standalone compatibility.
   */
  ownTurnSummary?: boolean;
  onRuntimeController?: (controller: SurfaceRuntimeController) => void;
  onEditorController?: (controller: EditorSurfaceController) => void;
  onWorkingLineController?: (controller: WorkingLineSurfaceController) => void;
  /**
   * Keeps standalone User Message compatibility outside the production runtime.
   */
  standaloneUserMessageHandler?: (
    patch: Partial<UserMessagesComponentConfig>,
    ctx: ExtensionContext,
  ) => void;
  /**
   * Lets the unified runtime own Editor and WorkingLine session installation.
   */
  manageEditorLifecycle?: boolean;
  /**
   * Shared lifecycle coordinator supplied by the unified runtime.
   */
  eventCoordinator?: EventCoordinator;
};

export default function (
  pi: ExtensionAPI,
  options: SurfaceRuntimeOptions = {},
) {
  const eventCoordinator =
    options.eventCoordinator ??
    new EventCoordinator({
      on: (event, handler) => pi.on(event as never, handler as never),
    });
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
  let cleanupSelectorBorderStyle: () => void = () => {};
  let selectorBorderStyleInstalled = false;
  let lastProjectCwd: string | undefined;
  let requestedProjectCwd: string | undefined;
  let minimalistProjectRoot: string | undefined;
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

  const effectiveSelectorBordersEnabled = () =>
    currentConfig.components.selectorBorders.enabled &&
    !hasUnsupportedComponentStyle(currentConfig, "selectorBorders");
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
  const workingLineController = new WorkingLineSurfaceController({
    pi,
    getConfig: getCurrentConfig,
    getTheme: () => activeTheme as Theme,
    sessionLifecycle,
    refresh,
    onAgentActiveChanged: (active) => {
      editorController.setAgentRunActive(active);
    },
  });
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
    render: { request: () => footerController.requestRender() },
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
    getAgentDurationMs: () => workingLineController.duration().elapsedMs() ?? 0,
    isAgentActive: () => workingLineController.isAgentActive(),
    isAgentDurationActive: () => workingLineController.duration().isActive(),
    subscribeAgentDuration: (listener) =>
      workingLineController.duration().subscribe(() => listener()),
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
  type ProjectRefreshTarget = { cwd: string; generation: number };
  const refreshProjectState = async (
    { cwd, generation }: ProjectRefreshTarget,
    run: ProjectRefreshRun,
  ) => {
    if (!run.isCurrent() || !sessionLifecycle.isCurrent(generation)) return;
    const starship = currentConfig.components.footer.styles.starship;
    const gitCommitConfig = starship.gitCommit;
    const gitMetricsConfig = starship.gitMetrics;
    const references = footerController.installedFooterReferences();
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
    footerController.needsProjectRefresh() ||
    editorController.needsProjectRefresh();

  const projectRefreshActivation = new ProjectRefreshActivation();

  const stopProjectRefresh = () => {
    projectRefreshActivation.stop();
    projectRefreshScheduler.stop();
  };

  /**
   * Starts, stops, or invalidates shared project refresh work.
   */
  const reconcileProjectRefresh = (ctx: ExtensionContext, force = false) => {
    if (!sessionLifecycle.isCurrent() || !needsProjectRefresh()) {
      stopProjectRefresh();
      return;
    }
    const activated = projectRefreshActivation.reconcile({
      needed: true,
      intervalMs: currentConfig.projectRefreshIntervalMs,
      onTick: () => {
        editorController.reconcileOwnership(ctx);
        if (!needsProjectRefresh()) {
          stopProjectRefresh();
          return;
        }
        scheduleProjectRefresh(ctx);
      },
    });
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

  const reconcileSessionTimer = () => footerController.reconcileSessionTimer();

  const sameReferences = (left: Set<string>, right: Set<string>) =>
    left.size === right.size && [...left].every((name) => right.has(name));

  const applyFooterDependencyConfigChange = (
    ctx: ExtensionContext,
    save: () => PolishedTuiConfig,
  ) => {
    const before = footerController.installedFooterReferences();
    const nextConfig = save();
    currentConfig = nextConfig;
    const after = footerController.installedFooterReferences();
    if (sameReferences(before, after)) return;
    reconcileSessionTimer();
    reconcileProjectRefresh(ctx, true);
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

  const footerController = new FooterSurfaceController({
    getConfig: getCurrentConfig,
    state,
    sessionLifecycle,
    refresh,
    scheduleProjectRefresh: (ctx) => scheduleProjectRefresh(ctx),
    getLiveContext: () => liveContext.get(),
    onProjectRequirementChanged: (ctx, force) =>
      reconcileProjectRefresh(ctx, force),
  });

  const applyConfiguredUi = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    reconcileSelectorBorders();
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
    ensureConfigExists();
    currentConfig = loadConfig();
    syncFooterState(ctx);
    stopProjectRefresh();

    uninstallSelectorBorders();
    try {
      removeSelectorBorderStyle();
    } catch {
      // Startup alone may supersede a stale registration from an earlier reload.
    }
    footerController.install(ctx);
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
    footerController.cleanup(ctx);
    stopProjectRefresh();
    uninstallSelectorBorders();
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

  eventCoordinator.on("session_start", async (_event, ctx) => {
    sessionLifecycle.start();
    if (options.manageEditorLifecycle !== false)
      await editorController.startSession(ctx);
    if (!sessionLifecycle.isCurrent()) return;
    liveContext.clear();
    state.sessionStartEpoch = Date.now();
    invalidateUsageTotalsCache();
    lastProjectCwd = undefined;
    requestedProjectCwd = undefined;
    minimalistProjectRoot = undefined;
    installUi(ctx);
    if (options.manageEditorLifecycle !== false)
      workingLineController.startSession(ctx);
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
    ctx: ExtensionContext,
  ) => {
    options.standaloneUserMessageHandler?.(patch, ctx);
    refresh();
  };
  const setWorkingLineComponent = (
    patch: WorkingLineComponentPatch,
    ctx: ExtensionContext,
  ) => {
    currentConfig = saveWorkingLineComponentPatch(patch);
    return workingLineController.reconcile(ctx);
  };
  const setFooterComponent = (
    patch: Partial<FooterComponentConfig>,
    ctx: ExtensionContext,
  ) => {
    const previousStyle = currentConfig.components.footer.style;
    currentConfig = saveFooterComponentPatch(patch);
    const styleChanged =
      currentConfig.components.footer.style !== previousStyle;
    if (patch.style !== undefined) footerController.reconcile(ctx);
    if (patch.modelLabel !== undefined) syncFooterState(ctx);
    reconcileProjectRefresh(ctx, styleChanged);
    reconcileSessionTimer();
    refresh();
  };
  options.onEditorController?.(editorController);
  options.onWorkingLineController?.(workingLineController);
  options.onRuntimeController?.({
    setUserMessagesComponent,
    setWorkingLineComponent,
    setFooterComponent,
  });

  options.registerCommand?.(pi, {
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
    setUserMessagesComponent,
    setWorkingLineComponent(
      patch: WorkingLineComponentPatch,
      ctx: ExtensionContext,
    ) {
      currentConfig = saveWorkingLineComponentPatch(patch);
      return workingLineController.reconcile(ctx);
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
      const previousStyle = currentConfig.components.footer.style;
      currentConfig = saveFooterComponentPatch(patch);
      const styleChanged =
        currentConfig.components.footer.style !== previousStyle;
      if (patch.style !== undefined) footerController.reconcile(ctx);
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
      return footerController.getExtensionStatuses();
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
  } as never);

  eventCoordinator.on("session_shutdown", async (_event, ctx) => {
    liveContext.clear();
    if (options.manageEditorLifecycle !== false)
      workingLineController.dispose(ctx);
    cleanupUi(ctx);
  });

  const syncInteractiveAndProjectStateWithUsage = (
    _event: unknown,
    ctx: ExtensionContext,
  ) => {
    invalidateUsageTotalsCache();
    refreshInteractiveState(ctx, true);
  };

  eventCoordinator.on("agent_start", (event, ctx) => {
    liveContext.clear();
    workingLineController.agentStart(ctx);
    syncInteractiveState(event, ctx);
  });
  eventCoordinator.on("turn_start", (_event, ctx) => {
    workingLineController.turnStart(ctx);
  });
  eventCoordinator.on("agent_end", (event, ctx) => {
    liveContext.clear();
    workingLineController.agentEnd(ctx);
    // Reconcile once more after Pi has persisted the assistant message.
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  eventCoordinator.on("model_select", (event, ctx) => {
    liveContext.clear();
    syncInteractiveState(event, ctx);
  });
  eventCoordinator.on("thinking_level_select", syncInteractiveState);
  eventCoordinator.on("session_info_changed", syncInteractiveState);
  eventCoordinator.on("message_update", (event, ctx) => {
    const payload = event as {
      message: WorkingLineMessage;
      assistantMessageEvent?: Parameters<
        WorkingLineSurfaceController["messageUpdate"]
      >[1];
    };
    liveContext.update(payload.message);
    workingLineController.messageUpdate(
      payload.message,
      payload.assistantMessageEvent,
      ctx,
    );
  });
  eventCoordinator.on("message_end", (event, ctx) => {
    const payload = event as {
      message: WorkingLineMessageEnd & { stopReason?: string };
    };
    const result = workingLineController.messageEnd(payload.message, ctx);
    // Pi notifies extensions before persisting a successful message, so retain its live
    // context until agent_end; accepted failed messages clear immediately instead of showing
    // stale usage. Rejected and duplicate finals are not authoritative.
    if (
      result.status === "accepted" &&
      payload.message.role === "assistant" &&
      (payload.message.stopReason === "error" ||
        payload.message.stopReason === "aborted")
    ) {
      liveContext.clear();
    }
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  eventCoordinator.on("agent_settled", (_event, ctx) => {
    workingLineController.agentSettled(ctx, options.ownTurnSummary !== false);
  });
  eventCoordinator.on("tool_execution_start", (event, ctx) => {
    liveContext.clear();
    const payload = event as { toolCallId: string; toolName: string };
    workingLineController.toolStart(payload.toolCallId, payload.toolName, ctx);
    syncInteractiveState(event, ctx);
  });
  eventCoordinator.on("tool_execution_end", (event, ctx) => {
    const payload = event as { toolCallId: string };
    workingLineController.toolEnd(payload.toolCallId, ctx);
    syncInteractiveAndProjectState(event, ctx);
  });
  eventCoordinator.on("session_compact", (event, ctx) => {
    liveContext.clear();
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  eventCoordinator.on("session_tree", (event, ctx) => {
    liveContext.clear();
    syncInteractiveAndProjectStateWithUsage(event, ctx);
  });
  if (!options.eventCoordinator) eventCoordinator.install();
}
