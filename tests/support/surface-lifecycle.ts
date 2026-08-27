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
  hasUnsupportedComponentStyle,
  loadConfig,
  mergeConfig,
  saveUserMessagesComponentPatch,
  type UserMessagesComponentConfig,
  type ZentuiConfig,
} from "../../extensions/app/config/shell.ts";
import registerSurfaceLifecycle, {
  type SurfaceRuntimeOptions,
} from "../../extensions/app/runtime/surface-lifecycle.ts";
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
    }
  });
  registerSurfaceLifecycle(pi, {
    ...options,
    standaloneUserMessageHandler: updateUserMessages,
  });
  pi.on("session_start", (_event, ctx) => {
    if (!isTuiContext(ctx)) return;
    activeTheme = ctx.ui.theme;
    contextConfig = loadConfig();
    unsubscribeConfig();
    unsubscribeConfig = configStore.subscribe((record: ConfigRecord) => {
      contextConfig = mergeConfig(record);
      reconcileUserMessages();
    });
    reconcileUserMessages();
  });
  pi.on("session_shutdown", () => {
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
