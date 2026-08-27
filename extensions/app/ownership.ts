// Legacy slot map retained for existing tests and callers during migration.
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

export {
  SURFACE_OWNERSHIP,
  SurfaceRegistry,
  type SurfaceId,
  type SurfaceOwner,
} from "./ownership/surface-registry.ts";
