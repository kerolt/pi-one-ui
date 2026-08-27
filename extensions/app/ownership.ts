/** Legacy slot map retained for existing callers during Layout extraction. */
export const UI_OWNERSHIP = {
  editor: "editor",
  userMessage: "context",
  footer: "shell",
  workingLine: "shell",
  selector: "overlay",
  toolRenderer: "context",
  diffRenderer: "context",
  thinking: "context",
  agentSummary: "context",
} as const;

export type UiSlot = keyof typeof UI_OWNERSHIP;
export type UiOwner = (typeof UI_OWNERSHIP)[UiSlot];

/**
 * Returns the canonical visual owner for a Pi UI slot.
 *
 * @param slot UI slot to resolve.
 * @returns Canonical owner identifier.
 */
export function ownerFor(slot: UiSlot): UiOwner {
  return UI_OWNERSHIP[slot];
}

export {
  LAYOUT_OWNERSHIP,
  LayoutRegistry,
  type LayoutId,
  type LayoutOwner,
} from "./ownership/layout-registry.ts";
