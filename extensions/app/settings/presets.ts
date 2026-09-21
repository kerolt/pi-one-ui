import { normalizeConfig } from "../config/renderer.ts";
import { mutateComponentsRecord } from "../config/shell.ts";
import {
  type ConfigRecord,
  type ConfigStore,
  configStore,
} from "../config/store.ts";
import { recordValue } from "../config/values.ts";

export type Preset = "balanced" | "compact" | "native";
export const PRESET_VALUES: Preset[] = ["balanced", "compact", "native"];
export function isPreset(value: string): value is Preset {
  return PRESET_VALUES.includes(value as Preset);
}

/** Preset 在同一个配置记录中更新所有组件。 */
export function applyPresetRecord(record: ConfigRecord, preset: Preset): void {
  const enabled = preset !== "native";
  mutateComponentsRecord(
    record,
    (components) => {
      components.editor.style = enabled ? "on" : "off";
      components.userMessages.enabled = enabled;
      components.workingLine.enabled = enabled;
      components.footer.style = enabled ? "starship" : "native";
    },
    ["editor", "footer"],
  );
  record.renderer = {
    ...recordValue(record.renderer),
    ...normalizeConfig({
      ...recordValue(record.renderer),
      mode: preset === "compact" ? "compact" : enabled ? "on" : "off",
    }),
  };
}

export function applyPreset(
  preset: Preset,
  store: ConfigStore = configStore,
): void {
  store.update((record) => applyPresetRecord(record, preset));
}
