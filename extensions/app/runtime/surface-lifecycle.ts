import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { AccentRailLayoutPatchDiagnostic } from "../../surfaces/editor/accent-rail-layout-patch.ts";
import {
  ensureConfigExists,
  hasUnsupportedComponentStyle,
  loadConfig,
  saveEditorComponentPatch,
  saveFooterComponentPatch,
  saveWorkingLineComponentPatch,
  type PolishedTuiConfig,
  mergeConfig,
} from "../config/shell.ts";
import { configStore, type ConfigRecord } from "../config/store.ts";
import { EditorSurfaceController } from "../../surfaces/editor/controller.ts";
import { FooterSurfaceController } from "../../surfaces/footer/controller.ts";
export { activeFooterReferences } from "../../surfaces/footer/data.ts";
import {
  SessionStateService,
  syncState,
} from "../../services/session-state.ts";
import {
  renderTurnSummaryEntry,
  TURN_SUMMARY_ENTRY_TYPE,
} from "../../surfaces/working-line/interaction-summary.ts";
import { LiveContextController } from "../../services/live-context.ts";
import {
  ProjectRefreshService,
  type ScheduleProjectRefreshOptions,
} from "../../services/project-refresh.ts";
import { SelectorController } from "../overlay/selector-controller.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { EventCoordinator } from "./event-coordinator.ts";
import { resolveFooterTelemetry } from "../../services/telemetry.ts";
import {
  WorkingLineSurfaceController,
  type WorkingLineMessage,
  type WorkingLineMessageEnd,
} from "../../surfaces/working-line/controller.ts";

function isTuiContext(ctx: ExtensionContext): boolean {
  try {
    const mode = ctx.mode;
    return ctx.hasUI && (mode === undefined || mode === "tui");
  } catch {
    return false;
  }
}

export type SurfaceRuntimeOptions = {
  /**
   * Keeps turn-summary entry ownership available for standalone compatibility.
   */
  ownTurnSummary?: boolean;
  /**
   * Lets the unified runtime own Editor and WorkingLine session installation.
   */
  manageEditorLifecycle?: boolean;
  /**
   * Lets the unified runtime own selector session installation.
   */
  manageSelectorLifecycle?: boolean;
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
  const sessionLifecycle = new SessionLifecycle();
  let currentConfig: PolishedTuiConfig = loadConfig();
  configStore.subscribe((record: ConfigRecord) => {
    currentConfig = mergeConfig(record);
  });
  const sessionState = new SessionStateService({
    getCacheHitIcon: () => currentConfig.icons.cacheHit,
    resolveTelemetry: resolveFooterTelemetry,
    syncState,
  });
  const state = sessionState.state;
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

  /**
   * Reloads the canonical configuration after an external test-support write.
   *
   * @returns The refreshed normalized configuration snapshot.
   */
  const reloadConfig = (): PolishedTuiConfig => {
    currentConfig = loadConfig();
    return currentConfig;
  };
  const workingLineController = new WorkingLineSurfaceController({
    pi,
    getConfig: getCurrentConfig,
    saveComponent: (patch) => {
      currentConfig = saveWorkingLineComponentPatch(patch);
      return currentConfig;
    },
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
      if (activeTuiContext) projectRefreshService.reconcile(activeTuiContext);
    },
    onModelLabelChanged: (ctx) => syncFooterState(ctx),
    recordLayoutDiagnostic: recordAccentRailLayoutPatchDiagnostic,
  });
  const syncFooterState = (ctx: ExtensionContext) => sessionState.sync(ctx);
  const projectRefreshService = new ProjectRefreshService({
    getConfig: getCurrentConfig,
    state,
    sessionLifecycle,
    getFooterReferences: () => footerController.installedFooterReferences(),
    needsRefresh: () =>
      footerController.needsProjectRefresh() ||
      editorController.needsProjectRefresh(),
    reconcileOwnership: (ctx) => editorController.reconcileOwnership(ctx),
    onProjectRoot: (root) => {
      minimalistProjectRoot = root;
    },
    refresh,
  });
  const scheduleProjectRefresh = (
    ctx: ExtensionContext,
    options?: ScheduleProjectRefreshOptions,
  ) => projectRefreshService.schedule(ctx, options);

  /**
   * Synchronizes shared session state and requests a visible redraw.
   *
   * @param ctx Active Pi extension context.
   * @param project Whether project data should be scheduled.
   */
  const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
    if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
    editorController.reconcileOwnership(ctx);
    syncFooterState(ctx);
    if (project) scheduleProjectRefresh(ctx);
    refresh();
  };

  /**
   * Reconciles Footer timer dependencies after configuration updates.
   */
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
    projectRefreshService.reconcile(ctx, true);
  };

  const selectorController = new SelectorController({
    getConfig: getCurrentConfig,
  });
  const footerController = new FooterSurfaceController({
    getConfig: getCurrentConfig,
    saveComponent: (patch) => {
      currentConfig = saveFooterComponentPatch(patch);
      return currentConfig;
    },
    state,
    sessionLifecycle,
    refresh,
    scheduleProjectRefresh: (ctx) => scheduleProjectRefresh(ctx),
    getLiveContext: () => liveContext.get(),
    onProjectRequirementChanged: (ctx, force) =>
      projectRefreshService.reconcile(ctx, force),
    onModelLabelChanged: (ctx) => syncFooterState(ctx),
  });

  const applyConfiguredUi = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    if (options.manageSelectorLifecycle !== false)
      selectorController.reconcile();
    projectRefreshService.reconcile(ctx);
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
    projectRefreshService.stop();

    if (options.manageSelectorLifecycle !== false)
      selectorController.startSession(ctx);
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
    projectRefreshService.stop();
    if (options.manageSelectorLifecycle !== false) selectorController.cleanup();
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

  /**
   * Registers session and runtime effects with the supplied event coordinator.
   *
   * @param coordinator Shared lifecycle event coordinator.
   */
  const installEventHandlers = (coordinator: EventCoordinator): void => {
    coordinator.on("session_start", async (_event, ctx) => {
      sessionLifecycle.start();
      if (options.manageEditorLifecycle !== false)
        await editorController.startSession(ctx);
      if (!sessionLifecycle.isCurrent()) return;
      liveContext.startSession();
      sessionState.startSession();
      minimalistProjectRoot = undefined;
      installUi(ctx);
      if (options.manageEditorLifecycle !== false)
        workingLineController.startSession(ctx);
    });

    coordinator.on("session_shutdown", async (_event, ctx) => {
      liveContext.shutdown();
      if (options.manageEditorLifecycle !== false)
        workingLineController.dispose(ctx);
      cleanupUi(ctx);
    });

    const syncInteractiveAndProjectStateWithUsage = (
      _event: unknown,
      ctx: ExtensionContext,
    ) => {
      sessionState.invalidateUsageCache();
      refreshInteractiveState(ctx, true);
    };

    coordinator.on("agent_start", (event, ctx) => {
      liveContext.clear();
      workingLineController.agentStart(ctx);
      syncInteractiveState(event, ctx);
    });
    coordinator.on("turn_start", (_event, ctx) => {
      workingLineController.turnStart(ctx);
    });
    coordinator.on("agent_end", (event, ctx) => {
      liveContext.clear();
      workingLineController.agentEnd(ctx);
      // Reconcile once more after Pi has persisted the assistant message.
      syncInteractiveAndProjectStateWithUsage(event, ctx);
    });
    coordinator.on("model_select", (event, ctx) => {
      liveContext.clear();
      syncInteractiveState(event, ctx);
    });
    coordinator.on("thinking_level_select", syncInteractiveState);
    coordinator.on("session_info_changed", syncInteractiveState);
    coordinator.on("message_update", (event, ctx) => {
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
    coordinator.on("message_end", (event, ctx) => {
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
    coordinator.on("agent_settled", (_event, ctx) => {
      workingLineController.agentSettled(ctx, options.ownTurnSummary !== false);
    });
    coordinator.on("tool_execution_start", (event, ctx) => {
      liveContext.clear();
      const payload = event as { toolCallId: string; toolName: string };
      workingLineController.toolStart(
        payload.toolCallId,
        payload.toolName,
        ctx,
      );
      syncInteractiveState(event, ctx);
    });
    coordinator.on("tool_execution_end", (event, ctx) => {
      const payload = event as { toolCallId: string };
      workingLineController.toolEnd(payload.toolCallId, ctx);
      syncInteractiveAndProjectState(event, ctx);
    });
    coordinator.on("session_compact", (event, ctx) => {
      liveContext.clear();
      syncInteractiveAndProjectStateWithUsage(event, ctx);
    });
    coordinator.on("session_tree", (event, ctx) => {
      liveContext.clear();
      syncInteractiveAndProjectStateWithUsage(event, ctx);
    });
  };
  if (!options.eventCoordinator) {
    installEventHandlers(eventCoordinator);
    eventCoordinator.install();
  }

  return {
    sessionLifecycle,
    getConfig: getCurrentConfig,
    editorController,
    footerController,
    workingLineController,
    selectorController,
    projectRefreshService,
    reloadConfig,
    installEventHandlers,
  };
}
