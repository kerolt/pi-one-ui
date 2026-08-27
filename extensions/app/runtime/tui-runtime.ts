import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { showOneUiPanel, type TuiPanelRuntime } from "../panel.ts";
import {
  createPiExtensionPort,
  type PiExtensionPort,
} from "../host/pi-extension-port.ts";
import { createPiUiPort, type PiUiPort } from "../host/pi-ui-port.ts";
import { LayoutRegistry } from "../ownership/layout-registry.ts";
import registerHeaderLayout from "../../layouts/header/index.ts";
import { EventCoordinator } from "./event-coordinator.ts";
import { RenderScheduler } from "./render-scheduler.ts";
import { RuntimeStateStore } from "./runtime-state.ts";
import { EditorLayoutController } from "../../layouts/editor/controller.ts";
import { FooterLayoutController } from "../../layouts/footer/controller.ts";
import {
  WorkingLineLayoutController,
  type WorkingLineMessage,
  type WorkingLineMessageEnd,
} from "../../layouts/working-line/controller.ts";
import registerContext, {
  type ContextExtensionOptions,
  type ContextRuntimeController,
} from "../../layouts/context/index.ts";
import type { AccentRailLayoutPatchDiagnostic } from "../../layouts/editor/accent-rail-layout-patch.ts";
import {
  ensureConfigExists,
  hasUnsupportedComponentStyle,
  loadConfig,
  mergeConfig,
  saveEditorComponentPatch,
  saveFooterComponentPatch,
  saveWorkingLineComponentPatch,
  type PolishedTuiConfig,
} from "../config/shell.ts";
import { configStore, type ConfigRecord } from "../config/store.ts";
import {
  SessionStateService,
  syncState,
} from "../../services/session-state.ts";
import {
  renderTurnSummaryEntry,
  TURN_SUMMARY_ENTRY_TYPE,
} from "../../layouts/working-line/interaction-summary.ts";
import { LiveContextController } from "../../services/live-context.ts";
import {
  ProjectRefreshService,
  type ScheduleProjectRefreshOptions,
} from "../../services/project-refresh.ts";
import { SelectorController } from "../overlay/selector-controller.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { resolveFooterTelemetry } from "../../services/telemetry.ts";

export type TuiRuntimeContext = {
  readonly extensions: PiExtensionPort;
  readonly state: RuntimeStateStore;
  readonly render: RenderScheduler;
  readonly layouts: LayoutRegistry;
  readonly ui: () => PiUiPort | undefined;
};

/**
 * The single composition root for the plugin. Remaining compatibility glue
 * is mounted behind this seam while Layout ownership is finalized.
 */
export class TuiRuntime {
  private readonly pi: ExtensionAPI;
  readonly extensions: PiExtensionPort;
  readonly state = new RuntimeStateStore();
  readonly layouts = new LayoutRegistry();

  private readonly coordinator: EventCoordinator;
  private readonly renderScheduler: RenderScheduler;
  private activeUi: PiUiPort | undefined;
  private installed = false;
  private editorController: EditorLayoutController | undefined;
  private footerController: FooterLayoutController | undefined;
  private workingLineController: WorkingLineLayoutController | undefined;
  private contextController: ContextRuntimeController | undefined;

  /**
   * Creates the runtime services and coordinates session lifecycle ownership.
   */
  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.extensions = createPiExtensionPort(pi);
    this.renderScheduler = new RenderScheduler((force) =>
      this.activeUi?.requestRender(force),
    );
    this.coordinator = new EventCoordinator({
      on: (event, handler) =>
        this.extensions.on(event as never, handler as never),
    });
  }

  /**
   * Returns the shared render scheduler used by installed layouts.
   */
  get render(): RenderScheduler {
    return this.renderScheduler;
  }

  /**
   * Returns the active session UI port, when a TUI session is mounted.
   */
  ui(): PiUiPort | undefined {
    return this.activeUi;
  }

  /**
   * Exposes the narrow runtime contract consumed by the settings panel.
   *
   * @returns Layout-independent panel operations.
   */
  private panelRuntime(): TuiPanelRuntime {
    return {
      setEditorComponent: (patch, ctx) =>
        this.editorController?.setComponent(patch, ctx) ?? { applied: false },
      setUserMessagesComponent: (patch, ctx) =>
        this.contextController?.setUserMessagesComponent(patch, ctx),
      setWorkingLineComponent: (patch, ctx) =>
        this.workingLineController?.setComponent(patch, ctx) ?? {
          applied: false,
          reason: "WorkingLine runtime is not available",
        },
      setFooterComponent: (patch, ctx) =>
        this.footerController?.setComponent(patch, ctx),
      setContextMode: (mode, ctx) => this.contextController?.setMode(mode, ctx),
      updateContextConfig: (patch, ctx) =>
        this.contextController?.updateConfig(patch, ctx),
    };
  }

  /**
   * Installs the runtime once and mounts remaining layout lifecycle glue.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    const contextOptions: ContextExtensionOptions = {
      onRuntimeController: (controller) => {
        this.contextController = controller;
      },
    };

    const layoutBindings = createLayoutRuntime(this.pi, this.coordinator);
    layoutBindings.workingLineController.setSummaryWriterEnabled(false);
    this.editorController = layoutBindings.editorController;
    this.footerController = layoutBindings.footerController;
    this.workingLineController = layoutBindings.workingLineController;
    layoutBindings.installEventHandlers(this.coordinator);
    registerHeaderLayout(this.pi);
    registerContext(this.pi, contextOptions);
    this.coordinator.on("session_start", async (_event, ctx) => {
      this.state.start(ctx.mode);
      if (ctx.mode === "tui" && ctx.hasUI) {
        // Pi exposes redraw through concrete TUI components; layouts will
        // connect that callback when they migrate behind this runtime.
        this.activeUi = createPiUiPort(ctx);
      }
    });
    this.coordinator.on("session_shutdown", (_event, ctx) => {
      this.activeUi = undefined;
      this.state.shutdown();
    });
    this.coordinator.install();

    this.extensions.registerCommand("oneui", {
      description: "Open pi-one-ui settings",
      handler: async (_args, ctx) => {
        await showOneUiPanel(ctx, { runtime: this.panelRuntime() });
      },
    });
  }
}

/**
 * Creates a single TUI runtime for the plugin composition root.
 */
export function createTuiRuntime(pi: ExtensionAPI): TuiRuntime {
  return new TuiRuntime(pi);
}

/**
 * Reports whether a context exposes the interactive TUI layout.
 *
 * @param ctx Candidate Pi extension context.
 * @returns Whether the context can install TUI-owned layouts.
 */
function isTuiContext(ctx: ExtensionContext): boolean {
  try {
    const mode = ctx.mode;
    return ctx.hasUI && (mode === undefined || mode === "tui");
  } catch {
    return false;
  }
}

/**
 * Creates the layout controllers and shared services used by TuiRuntime.
 *
 * @param pi Pi extension API.
 * @param eventCoordinator Shared lifecycle event coordinator.
 * @returns Layout controllers and lifecycle registration bindings.
 */
function createLayoutRuntime(
  pi: ExtensionAPI,
  eventCoordinator: EventCoordinator,
) {
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
  const workingLineController = new WorkingLineLayoutController({
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
  const editorController = new EditorLayoutController({
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

  const selectorController = new SelectorController({
    getConfig: getCurrentConfig,
  });
  const footerController = new FooterLayoutController({
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
    selectorController.reconcile();
    projectRefreshService.reconcile(ctx);
    footerController.reconcileSessionTimer();
  };

  /**
   * Installs compatibility layouts around the extracted Editor controller.
   */
  const installUi = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    activeTuiContext = ctx;
    activeTheme = ctx.ui.theme;
    ensureConfigExists();
    currentConfig = loadConfig();
    syncFooterState(ctx);
    projectRefreshService.stop();

    footerController.install(ctx);
    editorController.install(ctx, true);
    selectorController.startSession(ctx);
    applyConfiguredUi(ctx);
    refresh();
  };

  /**
   * Cleans all session-owned layout resources in dependency order.
   */
  const cleanupUi = (ctx?: ExtensionContext) => {
    if (!ctx || !sessionLifecycle.isCurrent()) return;
    editorController.cleanup(ctx);
    footerController.cleanup(ctx);
    projectRefreshService.stop();
    selectorController.cleanup();
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
      await editorController.startSession(ctx);
      if (!sessionLifecycle.isCurrent()) return;
      liveContext.startSession();
      sessionState.startSession();
      minimalistProjectRoot = undefined;
      installUi(ctx);
      workingLineController.startSession(ctx);
    });

    coordinator.on("session_shutdown", async (_event, ctx) => {
      liveContext.shutdown();
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
          WorkingLineLayoutController["messageUpdate"]
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
      workingLineController.agentSettled(ctx);
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
