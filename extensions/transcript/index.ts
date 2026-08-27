import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { config } from "../app/config/renderer.ts";

// shell
import piAliases from "../features/shell/aliases.ts";
import { installFlushDockedBash } from "../features/shell/flush-docked-bash.ts";
import workingMessage from "../features/shell/working-message.ts";

// feature
import agentAutocomplete from "../features/reference/subagent.ts";
import agentSummary from "../features/agent-summary/index.ts";
import context from "../features/context.ts";
import sessionReference from "../features/reference/index.ts";
import { installCompactThinking } from "../features/compact-thinking.ts";

// renderer
import registerTranscriptRenderer, {
  getCompactThinkingConfig,
} from "./renderer/index.ts";
import markdownEnhance from "./renderer/markdown-enhance.ts";

export type TranscriptRuntimeController = {
  setMode: (mode: "on" | "compact" | "off", ctx: ExtensionContext) => void;
  updateConfig: (
    partial: Partial<typeof config>,
    ctx: ExtensionContext,
  ) => void;
};

export type TranscriptExtensionOptions = {
  /**
   * Exposes live context refresh to the unified settings panel.
   */
  onRuntimeController?: (controller: TranscriptRuntimeController) => void;
};

export default function (
  pi: ExtensionAPI,
  options: TranscriptExtensionOptions = {},
): void {
  // shell chrome
  if (config.enableAliases) piAliases(pi);
  installFlushDockedBash();
  if (config.enableWorkingMessage) workingMessage(pi);

  // The thinking controller is queried directly by the context render stack.
  markdownEnhance(pi);
  registerTranscriptRenderer(
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
}
