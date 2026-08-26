export const UI_OWNERSHIP = {
  editor: "shell",
  userMessage: "shell",
  footer: "shell",
  workingLine: "shell",
  selector: "shell",
  toolRenderer: "transcript",
  diffRenderer: "transcript",
  thinking: "transcript",
  agentSummary: "features",
} as const;

export type UiSlot = keyof typeof UI_OWNERSHIP;
export type UiOwner = (typeof UI_OWNERSHIP)[UiSlot];

export function ownerFor(slot: UiSlot): UiOwner {
  return UI_OWNERSHIP[slot];
}
