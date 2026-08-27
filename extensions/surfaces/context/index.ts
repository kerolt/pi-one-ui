import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { config } from "../../app/config/renderer.ts";
import { configStore, type ConfigRecord } from "../../app/config/store.ts";
import {
  hasUnsupportedComponentStyle,
  loadConfig,
  mergeConfig,
  type ZentuiConfig,
} from "../../app/config/shell.ts";
import {
  installUserMessageStyle,
  removeUserMessageStyle,
} from "./message/user-message.ts";

// shell
import piAliases from "../../features/shell/aliases.ts";
import { installFlushDockedBash } from "../../features/shell/flush-docked-bash.ts";

// feature
import agentAutocomplete from "../../features/reference/subagent.ts";
import agentSummary from "./summary/index.ts";
import context from "../../features/context-inspector/index.ts";
import sessionReference from "../../features/reference/index.ts";
import { installCompactThinking } from "./thinking/compact-thinking.ts";

// renderer
import registerContextRenderer, {
  getCompactThinkingConfig,
} from "./renderer/index.ts";
import markdownEnhance from "./renderer/markdown-enhance.ts";

export type ContextRuntimeController = {
  setMode: (mode: "on" | "compact" | "off", ctx: ExtensionContext) => void;
  updateConfig: (
    partial: Partial<typeof config>,
    ctx: ExtensionContext,
  ) => void;
};

export type ContextExtensionOptions = {
  /**
   * Exposes live context refresh to the unified settings panel.
   */
  onRuntimeController?: (controller: ContextRuntimeController) => void;
};

let contextConfig: ZentuiConfig = loadConfig();
let activeTheme: Theme | undefined;
let cleanupUserMessageStyle: () => void = () => {};
let userMessageStyleInstalled = false;
let unsubscribeConfig: () => void = () => {};

/**
 * Reports whether a session context can safely install TUI-owned patches.
 */
function isTuiContext(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui" && ctx.hasUI;
}

/**
 * Installs the Context-owned User Message renderer once for the active session.
 */
function installContextUserMessages(): void {
  if (userMessageStyleInstalled || !activeTheme) return;
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
}

/**
 * Removes the Context-owned User Message renderer and clears its patch state.
 */
function uninstallContextUserMessages(): void {
  try {
    cleanupUserMessageStyle();
  } finally {
    cleanupUserMessageStyle = () => {};
    userMessageStyleInstalled = false;
    removeUserMessageStyle();
  }
}

/**
 * Reconciles User Message ownership with the latest shell configuration.
 */
function reconcileContextUserMessages(): void {
  const enabled =
    contextConfig.components.userMessages.enabled &&
    !hasUnsupportedComponentStyle(contextConfig, "userMessages");
  if (enabled) installContextUserMessages();
  else uninstallContextUserMessages();
}

/**
 * Starts the Context session binding and subscribes it to shared config updates.
 */
function startContextSession(ctx: ExtensionContext): void {
  if (!isTuiContext(ctx)) return;
  activeTheme = ctx.ui.theme;
  contextConfig = loadConfig();
  unsubscribeConfig();
  unsubscribeConfig = configStore.subscribe((record: ConfigRecord) => {
    contextConfig = mergeConfig(record);
    reconcileContextUserMessages();
  });
  reconcileContextUserMessages();
}

/**
 * Releases Context session bindings and restores the original User Message patch.
 */
function stopContextSession(): void {
  unsubscribeConfig();
  unsubscribeConfig = () => {};
  uninstallContextUserMessages();
  activeTheme = undefined;
}

/**
 * Registers the Context surface, its renderer stack and its feature hooks.
 */
export default function (
  pi: ExtensionAPI,
  options: ContextExtensionOptions = {},
): void {
  // shell chrome
  if (config.enableAliases) piAliases(pi);
  installFlushDockedBash();
  // The thinking controller is queried directly by the context render stack.
  markdownEnhance(pi);
  registerContextRenderer(
    pi,
    undefined,
    installCompactThinking(pi, getCompactThinkingConfig()),
    {
      onRuntimeController: options.onRuntimeController,
    },
  );

  // features
  if (config.enableContextCommand) context(pi);
  if (config.enableSessionReference) sessionReference(pi);
  if (config.enableSubagentAutocomplete) agentAutocomplete(pi);
  if (config.enableAgentSummary) agentSummary(pi);

  pi.on("session_start", (_event, ctx) => {
    startContextSession(ctx);
  });
  pi.on("session_shutdown", () => {
    stopContextSession();
  });
}
