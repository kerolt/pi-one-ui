import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  configStore,
  type ConfigRecord,
} from "../../extensions/app/config/store.ts";
import {
  type AccentRailEditorStyleConfig,
  type ContextStyle,
  type EditorComponentConfig,
  type ExtensionStatusColorMode,
  type ExtensionStatusPlacement,
  type FooterComponentConfig,
  type FooterSegmentsConfig,
  type GitBranchConfig,
  type GitCommitConfig,
  type GitMetricsConfig,
  hasUnsupportedComponentStyle,
  type IconMode,
  loadConfig,
  mergeConfig,
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
} from "../../extensions/app/config/shell.ts";
import registerSurfaceLifecycle, {
  type SurfaceRuntimeOptions,
} from "../../extensions/app/runtime/surface-lifecycle.ts";
import { registerSettingsCommand } from "./settings-command.ts";
import type { SelectorController } from "../../extensions/app/overlay/selector-controller.ts";
import { removeSelectorBorderStyle } from "../../extensions/app/overlay/selector-border.ts";
import {
  installUserMessageStyle,
  removeUserMessageStyle,
} from "../../extensions/surfaces/context/message/user-message.ts";

/**
 * Reports whether a context can install standalone User Message compatibility.
 *
 * @param ctx Candidate Pi extension context.
 * @returns Whether the context exposes an interactive TUI.
 */
function isTuiContext(ctx: ExtensionContext): boolean {
  const mode = (ctx as ExtensionContext & { mode?: string }).mode;
  return ctx.hasUI && (mode === undefined || mode === "tui");
}

type SurfaceBindings = ReturnType<typeof registerSurfaceLifecycle>;

/**
 * Builds the test-only settings dependencies without shipping a settings hook.
 *
 * @param bindings Surface controllers and services from the lifecycle harness.
 * @param setUserMessagesComponent Standalone User Message compatibility setter.
 * @returns Dependencies consumed by the historical settings command tests.
 */
function createSettingsDeps(
  bindings: SurfaceBindings,
  setUserMessagesComponent: (
    patch: Partial<UserMessagesComponentConfig>,
    ctx: ExtensionContext,
  ) => void,
) {
  const refresh = () => bindings.editorController.requestRender();
  const reloadAfterSave = (): void => {
    bindings.reloadConfig();
  };
  const applyFooterDependencyConfigChange = (
    ctx: ExtensionContext,
    save: () => PolishedTuiConfig,
  ) => {
    const before = bindings.footerController.installedFooterReferences();
    save();
    reloadAfterSave();
    const after = bindings.footerController.installedFooterReferences();
    if (
      before.size !== after.size ||
      [...before].some((name) => !after.has(name))
    ) {
      bindings.footerController.reconcileSessionTimer();
      bindings.projectRefreshService.reconcile(ctx, true);
    }
  };

  return {
    sessionLifecycle: bindings.sessionLifecycle,
    getConfig: bindings.getConfig,
    setEditorComponent: (
      patch: Partial<EditorComponentConfig>,
      ctx: ExtensionContext,
    ) => bindings.editorController.setComponent(patch, ctx),
    setPolished(
      patch: Partial<PolishedEditorStyleConfig>,
      _ctx: ExtensionContext,
    ) {
      savePolishedEditorStylePatch(patch);
      reloadAfterSave();
      refresh();
    },
    setPolishedCopyFriendly(
      patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
      _ctx: ExtensionContext,
    ) {
      savePolishedCopyFriendlyEditorStylePatch(patch);
      reloadAfterSave();
      refresh();
    },
    setAccentRail(
      patch: Partial<AccentRailEditorStyleConfig>,
      _ctx: ExtensionContext,
    ) {
      saveAccentRailEditorStylePatch(patch);
      reloadAfterSave();
      refresh();
    },
    setMinimalist(patch: Partial<MinimalistConfig>, ctx: ExtensionContext) {
      saveMinimalistEditorStylePatch(patch);
      reloadAfterSave();
      bindings.editorController.reconcileTimers();
      bindings.projectRefreshService.reconcile(
        ctx,
        patch.pathDisplay !== undefined || patch.showGit !== undefined,
      );
      refresh();
    },
    setUserMessagesComponent,
    setWorkingLineComponent: (
      patch: WorkingLineComponentPatch,
      ctx: ExtensionContext,
    ) => bindings.workingLineController.setComponent(patch, ctx),
    setSelectorBordersComponent(
      patch: Partial<SelectorBordersComponentConfig>,
      _ctx: ExtensionContext,
    ) {
      saveSelectorBordersComponentPatch(patch);
      reloadAfterSave();
      if (patch.enabled !== undefined || patch.style !== undefined)
        bindings.selectorController.reconcile();
      refresh();
    },
    setFooterComponent: (
      patch: Partial<FooterComponentConfig>,
      ctx: ExtensionContext,
    ) => bindings.footerController.setComponent(patch, ctx),
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
      saveIconsModePatch(mode);
      reloadAfterSave();
    },
    setContextStyle(style: ContextStyle) {
      saveStarshipFooterStylePatch({ contextStyle: style });
      reloadAfterSave();
    },
    setSeparator(separator: SeparatorStyle) {
      saveStarshipFooterStylePatch({ separator });
      reloadAfterSave();
    },
    setPathDisplay(patch: Partial<PathDisplayConfig>) {
      saveStarshipFooterStylePatch({ pathDisplay: patch as PathDisplayConfig });
      reloadAfterSave();
    },
    setGitBranch(patch: Partial<GitBranchConfig>) {
      saveStarshipFooterStylePatch({ gitBranch: patch as GitBranchConfig });
      reloadAfterSave();
    },
    setGitCommit(
      patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
      ctx: ExtensionContext,
    ) {
      saveStarshipFooterStylePatch({ gitCommit: patch as GitCommitConfig });
      reloadAfterSave();
      if (patch.showTag !== undefined)
        bindings.projectRefreshService.reconcile(ctx, true);
    },
    setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
      saveStarshipFooterStylePatch({ gitMetrics: patch as GitMetricsConfig });
      reloadAfterSave();
      if (patch.ignoreSubmodules !== undefined)
        bindings.projectRefreshService.reconcile(ctx, true);
    },
    getActiveExtensionStatuses() {
      return bindings.footerController.getExtensionStatuses();
    },
    setExtensionStatusDefaultPlacement(placement: ExtensionStatusPlacement) {
      saveExtensionStatusDefaultPlacement(placement);
      reloadAfterSave();
    },
    setExtensionStatusPlacement(
      key: string,
      placement: ExtensionStatusPlacement,
    ) {
      saveExtensionStatusPlacement(key, placement);
      reloadAfterSave();
    },
    setExtensionStatusColorMode(
      key: string,
      colorMode: ExtensionStatusColorMode,
    ) {
      saveExtensionStatusColorMode(key, colorMode);
      reloadAfterSave();
    },
    requestRender: refresh,
  };
}

/**
 * Registers production surface lifecycle and test-only User Message ownership.
 *
 * @param pi Pi extension API.
 * @param options Production lifecycle options.
 */
export default function (
  pi: ExtensionAPI,
  options: SurfaceRuntimeOptions = {},
): void {
  let contextConfig: ZentuiConfig = loadConfig();
  let activeTheme: Theme | undefined;
  let cleanupUserMessageStyle: () => void = () => {};
  let userMessageStyleInstalled = false;
  let unsubscribeConfig: () => void = () => {};
  let selectorController: SelectorController | undefined;

  /**
   * Reconciles the standalone User Message compatibility renderer.
   */
  const reconcileUserMessages = (): void => {
    const enabled =
      contextConfig.components.userMessages.enabled &&
      !hasUnsupportedComponentStyle(contextConfig, "userMessages");
    if (!enabled || !activeTheme) {
      try {
        cleanupUserMessageStyle();
      } finally {
        cleanupUserMessageStyle = () => {};
        userMessageStyleInstalled = false;
        removeUserMessageStyle();
      }
      return;
    }
    if (userMessageStyleInstalled) return;
    try {
      cleanupUserMessageStyle = installUserMessageStyle(
        () => activeTheme,
        () => contextConfig,
      );
      userMessageStyleInstalled = true;
    } catch {
      cleanupUserMessageStyle = () => {};
      userMessageStyleInstalled = false;
    }
  };

  /**
   * Applies a standalone User Message configuration patch.
   *
   * @param patch User Message configuration changes.
   * @param _ctx Active Pi extension context.
   */
  const updateUserMessages = (
    patch: Partial<UserMessagesComponentConfig>,
    _ctx: ExtensionContext,
  ): void => {
    contextConfig = saveUserMessagesComponentPatch(patch);
    if (patch.enabled !== undefined || patch.style !== undefined)
      reconcileUserMessages();
  };

  pi.on("session_start", (_event, ctx) => {
    if (!isTuiContext(ctx)) return;
    unsubscribeConfig();
    unsubscribeConfig = () => {};
    try {
      cleanupUserMessageStyle();
    } finally {
      cleanupUserMessageStyle = () => {};
      userMessageStyleInstalled = false;
      removeUserMessageStyle();
      removeSelectorBorderStyle();
    }
  });
  const bindings = registerSurfaceLifecycle(pi, {
    ...options,
    manageSelectorLifecycle: false,
  });
  selectorController = bindings.selectorController;
  if (typeof pi.registerCommand === "function") {
    registerSettingsCommand(
      pi,
      createSettingsDeps(bindings, updateUserMessages),
    );
  }
  pi.on("session_start", (_event, ctx) => {
    if (!isTuiContext(ctx)) return;
    activeTheme = ctx.ui.theme;
    selectorController?.startSession(ctx);
    contextConfig = loadConfig();
    unsubscribeConfig();
    unsubscribeConfig = configStore.subscribe((record: ConfigRecord) => {
      contextConfig = mergeConfig(record);
      reconcileUserMessages();
    });
    reconcileUserMessages();
  });
  pi.on("session_shutdown", () => {
    selectorController?.cleanup();
    unsubscribeConfig();
    unsubscribeConfig = () => {};
    try {
      cleanupUserMessageStyle();
    } finally {
      cleanupUserMessageStyle = () => {};
      userMessageStyleInstalled = false;
      activeTheme = undefined;
    }
  });
}

export { activeFooterReferences } from "../../extensions/surfaces/footer/data.ts";
