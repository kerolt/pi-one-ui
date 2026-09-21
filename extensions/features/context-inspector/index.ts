import {
  type BuildSystemPromptOptions,
  type ExtensionAPI,
  type ExtensionCommandContext,
  estimateTokens,
  formatSkillsForPrompt,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
  type OverlayManager,
  overlayManager,
} from "../../app/overlay/overlay-manager.ts";
import {
  type ContextPart,
  type ContextPreviewKey,
  formatTokens,
  showContextInspector,
} from "../../layouts/overlay/context-inspector.ts";

export type { ContextPart } from "../../layouts/overlay/context-inspector.ts";
export type ContextBreakdown = {
  parts: ContextPart[];
  previews: Record<ContextPreviewKey, string>;
};
const tokenEstimate = (value: unknown): number => {
  if (!value) {
    return 0;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(0, Math.ceil(text.length / 4));
};
function embeddedTokens(prompt: string, chunk: string): number {
  return chunk && prompt.includes(chunk) ? tokenEstimate(chunk) : 0;
}

export function capParts(
  parts: ContextPart[],
  target: number,
  fixedPrefix = 0,
): ContextPart[] {
  const fixed = parts.slice(0, fixedPrefix);
  const variable = parts.slice(fixedPrefix);
  const variableTarget = Math.max(
    0,
    target - fixed.reduce((sum, part) => sum + part.tokens, 0),
  );
  const estimated = variable.reduce((sum, part) => sum + part.tokens, 0);
  if (estimated <= variableTarget || estimated === 0) {
    return parts;
  }
  if (variableTarget === 0) {
    return [...fixed, ...variable.map((part) => ({ ...part, tokens: 0 }))];
  }
  let previous = 0;
  let cumulative = 0;
  return [
    ...fixed,
    ...variable.map((part, index) => {
      cumulative += part.tokens;
      const next =
        index === variable.length - 1
          ? variableTarget
          : Math.round((cumulative / estimated) * variableTarget);
      const tokens = next - previous;
      previous = next;
      return { ...part, tokens };
    }),
  ];
}

export function resolveUsedTokens(
  usage: { tokens: number | null; percent: number | null } | undefined,
  estimated: number,
  contextWindow: number,
): number {
  const reported = usage?.tokens;
  const fromPercent =
    usage?.percent !== null && usage?.percent !== undefined && contextWindow > 0
      ? Math.round((usage.percent / 100) * contextWindow)
      : undefined;
  let resolved = reported ?? fromPercent ?? estimated;
  if (
    reported !== null &&
    reported !== undefined &&
    fromPercent !== undefined
  ) {
    const tolerance = Math.max(32, Math.round(contextWindow * 0.001));
    if (Math.abs(reported - fromPercent) > tolerance) {
      resolved = fromPercent;
    }
  }
  return estimated > 0 && resolved < estimated * 0.25 ? estimated : resolved;
}

function previewValue(value: unknown): string {
  return typeof value === "string"
    ? value
    : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

/** 按当前请求的 system prompt、tools 和 messages 计算数据与预览。 */
export function collectContextBreakdown(
  ctx: ExtensionCommandContext,
  allTools: ToolInfo[],
): ContextBreakdown {
  const options = (ctx.getSystemPromptOptions?.() ??
    {}) as BuildSystemPromptOptions;
  const systemPrompt =
    typeof ctx.getSystemPrompt === "function" ? ctx.getSystemPrompt() : "";
  const selectedTools = new Set(
    options.selectedTools ?? ["read", "bash", "edit", "write"],
  );
  const toolDefinitionPreview: string[] = [];
  const toolResultPreview: string[] = [];
  const contextPreview: string[] = [];
  const memoryPreview: string[] = [];
  let toolDefinitionTokens = 0;
  let toolResultTokens = 0;
  let contextTokens = 0;
  let memoryTokens = 0;
  for (const file of options.contextFiles ?? []) {
    memoryTokens += embeddedTokens(systemPrompt, file.content);
    memoryPreview.push(`## ${file.path}\n\n${previewValue(file.content)}`);
  }
  const skillsText = formatSkillsForPrompt(options.skills ?? []).trim();
  const skillsTokens = embeddedTokens(systemPrompt, skillsText);
  for (const tool of allTools) {
    if (!selectedTools.has(tool.name)) {
      continue;
    }
    const definition = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
    toolDefinitionTokens += tokenEstimate(definition);
    toolDefinitionPreview.push(
      `## Definition: ${tool.name}\n\n${previewValue(definition)}`,
    );
  }
  for (const entry of ctx.sessionManager.buildContextEntries()) {
    if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "toolCall") {
            contextTokens +=
              tokenEstimate(block.name) + tokenEstimate(block.arguments);
            contextPreview.push(
              `## Assistant tool call: ${block.name}\n\n${previewValue(block.arguments)}`,
            );
          } else if (block.type === "text") {
            contextTokens += tokenEstimate(block.text);
            contextPreview.push(`## Assistant\n\n${block.text}`);
          } else if (block.type === "thinking") {
            contextTokens += tokenEstimate(block.thinking);
            contextPreview.push(`## Assistant thinking\n\n${block.thinking}`);
          }
        }
      } else if (message.role === "toolResult") {
        toolResultTokens += estimateTokens(message);
        toolResultPreview.push(
          `## Result: ${message.toolName}\n\n${previewValue(message.content)}`,
        );
      } else if (message.role === "bashExecution") {
        toolResultTokens += estimateTokens(message);
        toolResultPreview.push(
          `## Bash\n\nCommand:\n\n${previewValue(message.command)}\n\nOutput:\n\n${previewValue(message.output)}`,
        );
      } else if (
        message.role === "branchSummary" ||
        message.role === "compactionSummary"
      ) {
        contextTokens += estimateTokens(message);
        contextPreview.push(`## ${message.role}\n\n${message.summary}`);
      } else {
        contextTokens += estimateTokens(message);
        contextPreview.push(
          `## ${message.role}\n\n${previewValue(message.content)}`,
        );
      }
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      contextTokens += tokenEstimate(entry.summary);
      contextPreview.push(
        `## ${entry.type === "compaction" ? "Compaction" : "Branch summary"}\n\n${entry.summary}`,
      );
    } else if (entry.type === "custom_message") {
      contextTokens += tokenEstimate(entry.content);
      contextPreview.push(
        `## Custom: ${entry.customType}\n\n${previewValue(entry.content)}`,
      );
    }
  }
  return {
    parts: [
      {
        label: "System prompt",
        tokens: Math.max(
          0,
          tokenEstimate(systemPrompt) - memoryTokens - skillsTokens,
        ),
        color: "accent",
      },
      { label: "Memory", tokens: memoryTokens, color: "error" },
      { label: "Skills", tokens: skillsTokens, color: "warning" },
      {
        label: "Tools definition",
        tokens: toolDefinitionTokens,
        color: "success",
      },
      {
        label: "Tool results",
        tokens: toolResultTokens,
        color: "customMessageLabel",
      },
      { label: "Context", tokens: contextTokens, color: "warning" },
    ],
    previews: {
      systemPrompt: systemPrompt || "No system prompt.",
      memoryFiles: memoryPreview.join("\n\n") || "No memory files in context.",
      skills: skillsText || "No skills in context.",
      tools:
        toolDefinitionPreview.join("\n\n") || "No active tool definitions.",
      toolResults:
        toolResultPreview.join("\n\n") ||
        "No tool results in the current context.",
      contextFiles: contextPreview.join("\n\n") || "No conversation context.",
    },
  };
}

export default function contextUsageExtension(
  pi: ExtensionAPI,
  overlays: OverlayManager = overlayManager,
): void {
  pi.registerCommand("context", {
    description: "Show the current context-window distribution",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const contextWindow =
        usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      const breakdown = collectContextBreakdown(ctx, pi.getAllTools());
      const estimated = breakdown.parts.reduce(
        (sum, part) => sum + part.tokens,
        0,
      );
      const fixedTokens = breakdown.parts
        .slice(0, 4)
        .reduce((sum, part) => sum + part.tokens, 0);
      const used = Math.max(
        resolveUsedTokens(usage, estimated, contextWindow),
        fixedTokens,
      );
      const parts = capParts(breakdown.parts, used, 4);
      const attributed = parts.reduce((sum, part) => sum + part.tokens, 0);
      const allParts: ContextPart[] = [
        ...parts,
        {
          label: "Other",
          tokens: Math.max(0, used - attributed),
          color: "muted",
        },
        {
          label: "Free space",
          tokens: Math.max(0, contextWindow - used),
          color: "dim",
        },
      ];
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          allParts
            .map((part) => `${part.label}: ${formatTokens(part.tokens)} tokens`)
            .join("\n"),
          "info",
        );
        return;
      }
      await showContextInspector(
        ctx,
        { parts: allParts, used, contextWindow, previews: breakdown.previews },
        overlays,
      );
    },
  });
}
