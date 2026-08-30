import { updateConfig as updateRendererConfig } from "./config/renderer.ts";
import {
  saveEditorComponentPatch,
  saveFooterComponentPatch,
  saveUserMessagesComponentPatch,
  saveWorkingLineComponentPatch,
} from "./config/shell.ts";

export type Preset = "balanced" | "compact" | "native";

export const PRESET_VALUES: Preset[] = ["balanced", "compact", "native"];

export function isPreset(value: string): value is Preset {
  return PRESET_VALUES.includes(value as Preset);
}

/** Apply only ownership-related values; detailed options remain user-editable. */
export function applyPreset(preset: Preset): void {
  if (preset === "native") {
    saveEditorComponentPatch({ enabled: false });
    saveUserMessagesComponentPatch({ enabled: false });
    saveWorkingLineComponentPatch({ enabled: false });
    saveFooterComponentPatch({ style: "native" });
    updateRendererConfig({ mode: "off" });
    return;
  }

  saveEditorComponentPatch({ enabled: true });
  saveUserMessagesComponentPatch({ enabled: true });
  saveWorkingLineComponentPatch({ enabled: true });
  saveFooterComponentPatch({ style: "starship" });
  updateRendererConfig({
    mode: preset === "compact" ? "compact" : "on",
  });
}
