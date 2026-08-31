import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  hasUnsupportedComponentStyle,
  loadConfig,
  mergeConfig,
  type ZentuiConfig,
} from "../../extensions/app/config/shell.ts";
import {
  type ConfigRecord,
  configStore,
} from "../../extensions/app/config/store.ts";
import { removeSelectorBorderStyle } from "../../extensions/app/overlay/selector-border.ts";
import { EventCoordinator } from "../../extensions/app/runtime/event-coordinator.ts";
import {
  installUserMessageStyle,
  removeUserMessageStyle,
} from "../../extensions/layouts/context/message/user-message.ts";
import registerLayoutLifecycle from "./standalone-layout-runtime.ts";

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

type TestLayoutOptions = {
  ownTurnSummary?: boolean;
};

/**
 * Registers production layout lifecycle and test-only User Message ownership.
 *
 * @param pi Pi extension API.
 * @param options Test-only compatibility options.
 */
export default function (
  pi: ExtensionAPI,
  options: TestLayoutOptions = {},
): ReturnType<typeof registerLayoutLifecycle> {
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
  const coordinator = new EventCoordinator({
    on: (event, handler) => pi.on(event as never, handler as never),
  });
  const bindings = registerLayoutLifecycle(pi, coordinator);
  bindings.workingLineController.setSummaryWriterEnabled(
    options.ownTurnSummary !== false,
  );
  bindings.installEventHandlers(coordinator);
  coordinator.install();
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
  return bindings;
}

export { activeFooterReferences } from "../../extensions/layouts/footer/data.ts";
