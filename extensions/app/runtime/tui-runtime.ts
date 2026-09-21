import { isDeepStrictEqual } from "node:util";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import aliases from "../../features/aliases.ts";
import contextInspector from "../../features/context-inspector/index.ts";
import effortCommand from "../../features/effort-command.ts";
import sessionReference from "../../features/session-reference/index.ts";
import subagentAutocomplete from "../../features/subagent-autocomplete.ts";
import registerContext, {
  type ContextRuntimeController,
} from "../../layouts/context/index.ts";
import { EditorLayoutController } from "../../layouts/editor/index.ts";
import { FooterLayoutController } from "../../layouts/footer/index.ts";
import registerHeader, {
  applyStartupHeader,
} from "../../layouts/header/index.ts";
import { SelectorController } from "../../layouts/overlay/selector-controller.ts";
import { WorkingLineLayoutController } from "../../layouts/working-line/controller.ts";
import {
  renderTurnSummaryEntry,
  TURN_SUMMARY_ENTRY_TYPE,
} from "../../layouts/working-line/interaction-summary.ts";
import { LiveContextController } from "../../services/live-context.ts";
import {
  ProjectRefreshService,
  type ScheduleProjectRefreshOptions,
} from "../../services/project-refresh.ts";
import {
  SessionStateService,
  syncState,
} from "../../services/session-state.ts";
import { resolveFooterTelemetry } from "../../services/telemetry.ts";
import { type Config, config, setConfig } from "../config/renderer.ts";
import {
  type EditorComponentConfig,
  hasUnsupportedComponentStyle,
  loadConfig,
  type PolishedTuiConfig,
} from "../config/shell.ts";
import { InputRouter } from "../overlay/input-router.ts";
import { OverlayManager } from "../overlay/overlay-manager.ts";
import {
  type SettingsChange,
  SettingsController,
} from "../settings/controller.ts";
import { showOneUiPanel } from "../settings/panel.ts";
import { EventCoordinator } from "./event-coordinator.ts";
import { installFlushDockedBash } from "./flush-docked-bash.ts";
import { RenderScheduler } from "./render-scheduler.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";

/** 产品入口只组织组件、Feature 和共享生命周期。 */
export class TuiRuntime {
  readonly render = new RenderScheduler();
  readonly settings = new SettingsController();
  readonly overlays = new OverlayManager();
  readonly input = new InputRouter();
  private readonly coordinator: EventCoordinator;
  private readonly coordinatedPi: ExtensionAPI;
  private context: ContextRuntimeController | undefined;
  private installed = false;
  private currentContext: ExtensionContext | undefined;

  constructor(pi: ExtensionAPI) {
    this.coordinator = new EventCoordinator({
      on: (event, handler) => pi.on(event as never, handler as never),
    });
    this.coordinatedPi = this.coordinator.coordinate(pi);
  }

  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;
    setConfig(this.settings.snapshot().renderer);
    const pi = this.coordinatedPi;
    this.coordinator.on("session_start", (_event, ctx) => {
      this.overlays.startSession();
      this.input.clear();
      this.currentContext = ctx;
    });
    this.coordinator.on("session_shutdown", () => {
      this.overlays.reset();
      this.input.clear();
    });
    const bindings = createLayoutRuntime(pi, {
      render: this.render,
      settings: this.settings,
      onConfigChanged: (previous, ctx) => {
        this.context?.applyConfig(ctx, previous);
        if (previous.showStartupHeader !== config.showStartupHeader) {
          applyStartupHeader(ctx);
        }
      },
    });
    bindings.workingLineController.setSummaryWriterEnabled(false);
    bindings.installEventHandlers(this.coordinator);
    registerHeader(pi);
    this.context = registerContext(pi, {
      getConfig: bindings.getConfig,
      services: {
        input: this.input,
        overlays: this.overlays,
        render: this.render,
      },
    });
    if (config.enableAliases) {
      aliases(pi);
    }
    if (config.enableEffortCommand) {
      effortCommand(pi);
    }
    if (config.enableContextCommand) {
      contextInspector(pi, this.overlays);
    }
    if (config.enableSessionReference) {
      sessionReference(pi);
    }
    if (config.enableSubagentAutocomplete) {
      subagentAutocomplete(pi);
    }
    let cleanupBash: (() => void) | undefined;
    this.coordinator.on("session_start", (_event, ctx) => {
      if (ctx.mode === "tui" && ctx.hasUI) {
        cleanupBash = installFlushDockedBash();
      }
    });
    this.coordinator.on("session_shutdown", () => {
      cleanupBash?.();
      cleanupBash = undefined;
      this.currentContext = undefined;
    });
    this.coordinator.install();
    pi.registerCommand("oneui", {
      description: "Open pi-one-ui settings",
      handler: async (_args, ctx) => {
        await showOneUiPanel(ctx, {
          settings: this.settings,
          overlays: this.overlays,
        });
      },
    });
  }

  async dispose(ctx = this.currentContext): Promise<void> {
    if (ctx && this.currentContext) {
      await this.coordinator.dispatch(
        "session_shutdown",
        { type: "session_shutdown", reason: "quit" },
        ctx,
      );
    }
  }
}

export function createTuiRuntime(pi: ExtensionAPI): TuiRuntime {
  return new TuiRuntime(pi);
}

function isTuiContext(ctx: ExtensionContext): boolean {
  const mode = ctx.mode;
  return ctx.hasUI && (mode === undefined || mode === "tui");
}

type LayoutRuntimeOptions = {
  render?: RenderScheduler;
  settings?: SettingsController;
  onConfigChanged?: (previous: Config, ctx: ExtensionContext) => void;
};

/** 生产运行时与组件集成测试共同使用的实际装配。 */
export function createLayoutRuntime(
  pi: ExtensionAPI,
  options: LayoutRuntimeOptions = {},
) {
  const sessionLifecycle = new SessionLifecycle();
  const render = options.render ?? new RenderScheduler();
  const settings = options.settings ?? new SettingsController();
  let currentConfig: PolishedTuiConfig = loadConfig();
  let unsubscribeConfig: (() => void) | undefined;
  let activeTheme: Theme | undefined;
  let minimalistProjectRoot: string | undefined;
  let activeTuiContext: ExtensionContext | undefined;
  const sessionState = new SessionStateService({
    getCacheHitIcon: () => currentConfig.icons.cacheHit,
    resolveTelemetry: resolveFooterTelemetry,
    syncState,
  });
  const state = sessionState.state;
  if (typeof pi.registerEntryRenderer === "function") {
    pi.registerEntryRenderer(
      TURN_SUMMARY_ENTRY_TYPE,
      (entry, entryOptions, theme) =>
        renderTurnSummaryEntry(
          entry,
          {
            ...entryOptions,
            workingLineHigh: currentConfig.colors.workingLineHigh,
          },
          theme,
        ),
    );
  }
  const refresh = (): void => {
    if (sessionLifecycle.isCurrent()) {
      render.request();
    }
  };
  const liveContext = new LiveContextController(sessionLifecycle, refresh);
  const getConfig = () => currentConfig;
  const syncFooterState = (ctx: ExtensionContext) => sessionState.sync(ctx);
  const workingLineController = new WorkingLineLayoutController({
    pi,
    getConfig,
    getTheme: () => activeTheme as Theme,
    sessionLifecycle,
    refresh,
    onAgentActiveChanged: (active) =>
      editorController.setAgentRunActive(active),
  });
  const editorController = new EditorLayoutController({
    getConfig,
    getState: () => state,
    sessionLifecycle,
    render,
    getThinkingLevel: () =>
      sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : "off",
    getAgentDurationMs: () => workingLineController.duration().elapsedMs() ?? 0,
    isAgentActive: () => workingLineController.isAgentActive(),
    isAgentDurationActive: () => workingLineController.duration().isActive(),
    subscribeAgentDuration: (listener) =>
      workingLineController.duration().subscribe(() => listener()),
    getProjectRoot: () => minimalistProjectRoot,
    onProjectRequirementChanged: () => {
      if (activeTuiContext) {
        projectRefreshService.reconcile(activeTuiContext);
      }
    },
    onModelLabelChanged: syncFooterState,
  });
  const projectRefreshService = new ProjectRefreshService({
    getConfig,
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
    refreshOptions?: ScheduleProjectRefreshOptions,
  ) => projectRefreshService.schedule(ctx, refreshOptions);
  const selectorController = new SelectorController({ getConfig });
  const footerController = new FooterLayoutController({
    getConfig,
    state,
    sessionLifecycle,
    render,
    refresh,
    scheduleProjectRefresh: (ctx) => scheduleProjectRefresh(ctx),
    getLiveContext: () => liveContext.get(),
    onProjectRequirementChanged: (ctx, force) =>
      projectRefreshService.reconcile(ctx, force),
    onModelLabelChanged: syncFooterState,
  });

  const applyConfig = (
    previous: PolishedTuiConfig,
    previousRenderer: Config,
    ctx: ExtensionContext,
    change?: SettingsChange,
  ): void => {
    if (!sessionLifecycle.isCurrent() || !isTuiContext(ctx)) {
      return;
    }
    const oldEditor = previous.components.editor;
    const editor = currentConfig.components.editor;
    const patch: Partial<EditorComponentConfig> = {};
    for (const key of [
      "style",
      "modelLabel",
      "borderColorMode",
      "viewportIndicators",
    ] as const) {
      if (oldEditor[key] !== editor[key]) {
        Object.assign(patch, { [key]: editor[key] });
      }
    }
    const preset = change?.id.startsWith("preset:") ?? false;
    if (
      preset ||
      change?.id === "editorStyle" ||
      hasUnsupportedComponentStyle(previous, "editor") !==
        hasUnsupportedComponentStyle(currentConfig, "editor")
    ) {
      patch.style = editor.style;
    }
    const editorChange = editorController.applyConfig(patch, ctx);
    const oldFooter = previous.components.footer;
    const footer = currentConfig.components.footer;
    const footerChange = footerController.applyConfig(
      {
        ...(oldFooter.style !== footer.style ||
        preset ||
        change?.id === "footerStyle" ||
        hasUnsupportedComponentStyle(previous, "footer") !==
          hasUnsupportedComponentStyle(currentConfig, "footer")
          ? { style: footer.style }
          : {}),
        ...(oldFooter.modelLabel !== footer.modelLabel
          ? { modelLabel: footer.modelLabel }
          : {}),
      },
      ctx,
      oldFooter.style,
    );
    const workingLineUpdated = Boolean(
      preset ||
        !isDeepStrictEqual(
          previous.components.workingLine,
          currentConfig.components.workingLine,
        ),
    );
    const workingLineChange = workingLineUpdated
      ? workingLineController.applyConfig(ctx)
      : undefined;
    selectorController.reconcile();
    options.onConfigChanged?.(previousRenderer, ctx);
    refresh();
    const failures = [
      editorChange,
      footerChange,
      ...(workingLineChange ? [workingLineChange] : []),
    ]
      .filter((result) => !result.applied)
      .map(
        (result) =>
          new Error(
            result.reason ?? "Layout could not apply the configuration",
          ),
      );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Layout configuration could not be applied",
      );
    }
  };
  const subscribeConfig = (): void => {
    unsubscribeConfig?.();
    unsubscribeConfig = settings.subscribe((snapshot, change) => {
      const previous = currentConfig;
      const previousRenderer = { ...config };
      currentConfig = snapshot.shell;
      setConfig(snapshot.renderer);
      if (activeTuiContext) {
        applyConfig(previous, previousRenderer, activeTuiContext, change);
      }
    });
  };

  const refreshInteractiveState = (
    ctx: ExtensionContext,
    project = false,
  ): void => {
    if (!sessionLifecycle.isCurrent() || !ctx.hasUI) {
      return;
    }
    editorController.reconcileOwnership(ctx);
    syncFooterState(ctx);
    if (project) {
      scheduleProjectRefresh(ctx);
    }
    refresh();
  };
  const reloadConfig = (): PolishedTuiConfig => {
    currentConfig = loadConfig();
    return currentConfig;
  };
  const installUi = (ctx: ExtensionContext): void => {
    if (!isTuiContext(ctx)) {
      return;
    }
    activeTuiContext = ctx;
    activeTheme = ctx.ui.theme;
    reloadConfig();
    syncFooterState(ctx);
    projectRefreshService.stop();
    footerController.install(ctx);
    editorController.install(ctx, true);
    selectorController.startSession(ctx);
    projectRefreshService.reconcile(ctx);
    footerController.reconcileSessionTimer();
    refresh();
  };
  const dispose = (ctx = activeTuiContext): void => {
    if (!sessionLifecycle.isCurrent()) {
      return;
    }
    sessionLifecycle.shutdown();
    activeTuiContext = undefined;
    unsubscribeConfig?.();
    unsubscribeConfig = undefined;
    liveContext.shutdown();
    if (ctx) {
      workingLineController.dispose(ctx);
    }
    editorController.cleanup(ctx);
    footerController.cleanup(ctx);
    projectRefreshService.stop();
    selectorController.cleanup();
    activeTheme = undefined;
    render.dispose();
  };
  const syncInteractiveState = (_event: unknown, ctx: ExtensionContext) =>
    refreshInteractiveState(ctx);
  const syncInteractiveAndProjectState = (
    _event: unknown,
    ctx: ExtensionContext,
  ) => refreshInteractiveState(ctx, true);
  const syncWithUsage = (_event: unknown, ctx: ExtensionContext) => {
    sessionState.invalidateUsageCache();
    refreshInteractiveState(ctx, true);
  };

  const installEventHandlers = (coordinator: EventCoordinator): void => {
    coordinator.on("session_start", (_event, ctx) => {
      dispose();
      sessionLifecycle.start();
      render.reset();
      subscribeConfig();
      liveContext.startSession();
      sessionState.startSession();
      minimalistProjectRoot = undefined;
      installUi(ctx);
      workingLineController.startSession(ctx);
    });
    coordinator.on("session_shutdown", (_event, ctx) => dispose(ctx));
    coordinator.on("agent_start", (event, ctx) => {
      liveContext.clear();
      workingLineController.agentStart(ctx);
      syncInteractiveState(event, ctx);
    });
    coordinator.on("turn_start", (_event, ctx) =>
      workingLineController.turnStart(ctx),
    );
    coordinator.on("agent_end", (event, ctx) => {
      liveContext.clear();
      workingLineController.agentEnd(ctx);
      syncWithUsage(event, ctx);
    });
    coordinator.on("model_select", (event, ctx) => {
      liveContext.clear();
      syncInteractiveState(event, ctx);
    });
    coordinator.on("thinking_level_select", syncInteractiveState);
    coordinator.on("session_info_changed", syncInteractiveState);
    coordinator.on("message_update", (event, ctx) => {
      liveContext.update(event.message);
      workingLineController.messageUpdate(
        event.message,
        event.assistantMessageEvent,
        ctx,
      );
    });
    coordinator.on("message_end", (event, ctx) => {
      const result = workingLineController.messageEnd(event.message, ctx);
      if (
        result.status === "accepted" &&
        event.message.role === "assistant" &&
        (event.message.stopReason === "error" ||
          event.message.stopReason === "aborted")
      ) {
        liveContext.clear();
      }
      syncWithUsage(event, ctx);
    });
    coordinator.on("agent_settled", (_event, ctx) =>
      workingLineController.agentSettled(ctx),
    );
    coordinator.on("tool_execution_start", (event, ctx) => {
      liveContext.clear();
      workingLineController.toolStart(event.toolCallId, event.toolName, ctx);
      syncInteractiveState(event, ctx);
    });
    coordinator.on("tool_execution_end", (event, ctx) => {
      workingLineController.toolEnd(event.toolCallId, ctx);
      syncInteractiveAndProjectState(event, ctx);
    });
    coordinator.on("session_compact", (event, ctx) => {
      liveContext.clear();
      syncWithUsage(event, ctx);
    });
    coordinator.on("session_tree", (event, ctx) => {
      liveContext.clear();
      syncWithUsage(event, ctx);
    });
  };

  return {
    sessionLifecycle,
    settings,
    getConfig,
    editorController,
    footerController,
    workingLineController,
    selectorController,
    projectRefreshService,
    reloadConfig,
    installEventHandlers,
    dispose,
  };
}
