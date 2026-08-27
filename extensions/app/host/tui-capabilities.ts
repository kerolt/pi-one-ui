import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type TuiCapabilities = Readonly<{
  interactive: boolean;
  customUi: boolean;
  editorFactory: boolean;
  footer: boolean;
  header: boolean;
  workingIndicator: boolean;
  overlays: boolean;
}>;

/**
 * Detects which interactive UI seams are available in the current host context.
 */
export function detectTuiCapabilities(ctx: ExtensionContext): TuiCapabilities {
  const ui = ctx.ui as Partial<ExtensionContext["ui"]>;
  return {
    interactive: ctx.mode === "tui" && ctx.hasUI,
    customUi: typeof ui.custom === "function",
    editorFactory: typeof ui.setEditorComponent === "function",
    footer: typeof ui.setFooter === "function",
    header: typeof ui.setHeader === "function",
    workingIndicator: typeof ui.setWorkingIndicator === "function",
    overlays: typeof ui.custom === "function",
  };
}
