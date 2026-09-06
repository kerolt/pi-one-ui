/**
 * Effort Command Feature
 *
 * Registers the /effort command for selecting the active thinking level:
 *   /effort        → interactive level picker
 *   /effort high   → apply a level directly (with autocomplete)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EFFORT_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Reports whether a command argument is a supported thinking-effort level. */
function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_LEVELS.some((level) => level === value);
}

/** Registers the /effort command for selecting the active thinking level. */
export default function effortCommand(pi: ExtensionAPI): void {
  pi.registerCommand("effort", {
    description:
      "Set thinking effort: off, minimal, low, medium, high, xhigh, or max",
    getArgumentCompletions: (prefix) => {
      const normalizedPrefix = prefix.toLowerCase();
      const matches = EFFORT_LEVELS.filter((level) =>
        level.startsWith(normalizedPrefix),
      ).map((level) => ({
        value: level,
        label: level,
      }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      let requested = args.trim().toLowerCase();
      if (!requested) {
        if (!ctx.hasUI) {
          return;
        }
        const selected = await ctx.ui.select(
          `Thinking effort (current: ${pi.getThinkingLevel()})`,
          [...EFFORT_LEVELS],
        );
        if (!selected) {
          return;
        }
        requested = selected;
      }

      if (!isEffortLevel(requested)) {
        ctx.ui.notify(
          `Unknown effort "${requested}". Expected: ${EFFORT_LEVELS.join(", ")}`,
          "error",
        );
        return;
      }

      pi.setThinkingLevel(requested);
      // The active model may clamp unsupported levels; surface the applied value.
      const applied = pi.getThinkingLevel();
      if (applied !== requested) {
        ctx.ui.notify(
          `Requested ${requested}; active model applied ${applied}`,
          "warning",
        );
        return;
      }
      ctx.ui.notify(`Thinking effort: ${applied}`, "info");
    },
  });
}
