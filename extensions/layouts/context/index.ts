import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type Config, config } from "../../app/config/renderer.ts";
import {
  hasUnsupportedComponentStyle,
  type ZentuiConfig,
} from "../../app/config/shell.ts";
import { installUserMessageStyle } from "./message/user-message.ts";
import registerContextRenderer, {
  getCompactThinkingConfig,
  type RendererExtensionOptions,
  type RendererRuntimeController,
} from "./renderer/index.ts";
import markdownEnhance from "./renderer/markdown-enhance.ts";
import agentSummary from "./summary/index.ts";
import { installCompactThinking } from "./thinking/compact-thinking.ts";

export type ContextRuntimeController = RendererRuntimeController & {
  applyConfig(ctx: ExtensionContext, previous: Config): void;
};
export type ContextExtensionOptions = {
  readonly getConfig: () => ZentuiConfig;
  readonly services?: RendererExtensionOptions["services"];
};

/** Context 仅组织自身内容组件，Feature 的启用由 app 决定。 */
export default function registerContext(
  pi: ExtensionAPI,
  options: ContextExtensionOptions,
): ContextRuntimeController {
  let activeTheme: Theme | undefined;
  let cleanupUserMessages: (() => void) | undefined;
  const reconcile = (): void => {
    const current = options.getConfig();
    const enabled =
      current.components.userMessages.enabled &&
      !hasUnsupportedComponentStyle(current, "userMessages");
    if (!enabled || !activeTheme) {
      cleanupUserMessages?.();
      cleanupUserMessages = undefined;
      return;
    }
    if (!cleanupUserMessages) {
      cleanupUserMessages = installUserMessageStyle(
        () => activeTheme,
        options.getConfig,
      );
    }
  };

  markdownEnhance(pi);
  const thinking = installCompactThinking(pi, getCompactThinkingConfig());
  const renderer = registerContextRenderer(pi, undefined, thinking, {
    services: options.services,
  });
  if (config.enableAgentSummary) {
    agentSummary(pi);
  }
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      return;
    }
    activeTheme = ctx.ui.theme;
    reconcile();
  });
  pi.on("session_shutdown", () => {
    cleanupUserMessages?.();
    cleanupUserMessages = undefined;
    activeTheme = undefined;
  });
  return {
    ...renderer,
    applyConfig(ctx, previous) {
      reconcile();
      thinking.updateConfig(getCompactThinkingConfig());
      if (config.mode !== previous.mode) {
        renderer.setMode(config.mode, ctx);
      } else {
        renderer.updateConfig(config, ctx);
      }
    },
  };
}
