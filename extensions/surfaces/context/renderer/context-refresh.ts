import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { walkComponentTree } from "../../../tools/component-tree.ts";
import {
  COMPACT_MODE_PATCH_KEY,
  patchRegistry,
} from "../../../tools/patch-keys.ts";

// pi-coding-agent 类型声明中 AssistantMessageComponent 仅能以 value 形式使用，
// updateContent/lastMessage 用结构化类型访问。
type ContextComponentInternals = {
  lastMessage?: AssistantMessage;
  updateContent(message: AssistantMessage): void;
  invalidate?(): void;
};

/**
 * Refreshes one constructed context component.
 *
 * Assistant components receive their latest message, while tool components
 * refresh their display so resumed content returns to the current shell.
 */
export function refreshContextComponent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (value instanceof AssistantMessageComponent) {
    const self = value as unknown as ContextComponentInternals;
    if (self.lastMessage) self.updateContent(self.lastMessage);
    else self.invalidate?.();
    return true;
  }
  if (value instanceof ToolExecutionComponent) {
    // updateDisplay is private, but it is the only resume-time path that
    // restores content to the correct shell container.
    (value as unknown as { updateDisplay(): void }).updateDisplay();
    return true;
  }
  return false;
}

/**
 * Asserts that compact-mode remains the outer patch in compact mode.
 *
 * Resume and reload can rebuild components without emitting a message update,
 * so the ownership order is checked before any mounted component is refreshed.
 */
function assertCompactModeOutermost(): void {
  try {
    const patch = patchRegistry.get<{ assertAssistantOwnership?: () => void }>(
      COMPACT_MODE_PATCH_KEY,
    );
    if (patch && typeof patch.assertAssistantOwnership === "function") {
      patch.assertAssistantOwnership();
    }
  } catch {
    // Continue scanning when compact-mode is absent or the assertion fails.
  }
}

/**
 * Scans mounted roots and refreshes all constructed assistant and tool components.
 *
 * This covers reload, resume and compaction paths where Pi rebuilds components
 * before the renderer patches are installed.
 */
export function refreshMountedContext(tui?: unknown): void {
  if (!tui || typeof (tui as any).getMountedRoots !== "function") return;
  // Fix patch order before refreshing so updateContent runs through the outer patch.
  assertCompactModeOutermost();
  walkComponentTree(tui, (value: any) => {
    try {
      refreshContextComponent(value);
    } catch {
      // Isolate one component failure; a later tree rebuild can retry it.
    }
  });
}
