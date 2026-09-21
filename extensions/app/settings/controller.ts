import {
  normalizePanelOverlay,
  type PanelOverlayConfig,
} from "../config/panel.ts";
import { type Config, normalizeConfig } from "../config/renderer.ts";
import {
  mergeConfig,
  mutateComponentsRecord,
  type ZentuiConfig,
} from "../config/shell.ts";
import {
  type ConfigRecord,
  type ConfigStore,
  configStore,
} from "../config/store.ts";
import { recordValue } from "../config/values.ts";
import { applyPresetRecord, isPreset } from "./presets.ts";

export type SettingsChange = Readonly<{ id: string; value: string }>;

export type SettingsSnapshot = Readonly<{
  shell: ZentuiConfig;
  renderer: Config;
  panel: PanelOverlayConfig;
}>;

export function settingsSnapshot(record: ConfigRecord): SettingsSnapshot {
  return {
    shell: mergeConfig(record),
    renderer: normalizeConfig(recordValue(record.renderer)),
    panel: normalizePanelOverlay(record.panel),
  };
}

const booleanSettings = [
  "enableSessionReference",
  "enableSubagentAutocomplete",
  "enableContextCommand",
  "enableAgentSummary",
  "enableAliases",
  "enableEffortCommand",
  "showStartupHeader",
  "diffWordWrap",
  "dimThinkingText",
] as const;

/** 设置命令只修改配置；运行时订阅负责应用，视图只提交用户选择。 */
export class SettingsController {
  private change: SettingsChange | undefined;

  constructor(readonly store: ConfigStore = configStore) {}

  snapshot(): SettingsSnapshot {
    return settingsSnapshot(this.store.read());
  }

  subscribe(
    listener: (snapshot: SettingsSnapshot, change?: SettingsChange) => void,
  ): () => void {
    return this.store.subscribe((record) =>
      listener(settingsSnapshot(record), this.change),
    );
  }

  update(id: string, value: string): SettingsSnapshot {
    const previous = this.change;
    this.change = { id, value };
    try {
      return this.commit(id, value);
    } finally {
      this.change = previous;
    }
  }

  private commit(id: string, value: string): SettingsSnapshot {
    const record = this.store.update((record) => {
      record.version = 1;
      if (id.startsWith("preset:")) {
        const preset = id.slice("preset:".length);
        if (!isPreset(preset)) {
          throw new Error(`Unknown preset: ${preset}`);
        }
        applyPresetRecord(record, preset);
        return;
      }
      if (booleanSettings.some((key) => key === id)) {
        this.updateRenderer(record, { [id]: this.boolean(value) });
        return;
      }
      switch (id) {
        case "editorStyle":
          this.enum(value, ["on", "off"]);
          mutateComponentsRecord(
            record,
            (components) => {
              components.editor.style = value;
            },
            ["editor"],
          );
          break;
        case "editorBorderColorMode":
          this.enum(value, ["static", "adaptive"]);
          mutateComponentsRecord(record, (components) => {
            components.editor.borderColorMode = value;
          });
          break;
        case "userMessagesEnabled":
          mutateComponentsRecord(record, (components) => {
            components.userMessages.enabled = this.boolean(value);
          });
          break;
        case "userMessagesStyle":
          this.enum(value, [
            "framed",
            "framed-copy-friendly",
            "compact",
            "labeled",
          ]);
          mutateComponentsRecord(
            record,
            (components) => {
              components.userMessages.style = value;
            },
            ["userMessages"],
          );
          break;
        case "workingLineEnabled":
          mutateComponentsRecord(record, (components) => {
            components.workingLine.enabled = this.boolean(value);
          });
          break;
        case "workingLineSpinner":
          this.enum(value, [
            "braille",
            "star-bloom",
            "pinwheel",
            "claude-inspired",
            "pulse",
          ]);
          mutateComponentsRecord(record, (components) => {
            components.workingLine.spinner = value;
          });
          break;
        case "footerStyle":
          this.enum(value, ["starship", "native", "hidden"]);
          mutateComponentsRecord(
            record,
            (components) => {
              components.footer.style = value;
            },
            ["footer"],
          );
          break;
        case "contextMode":
          this.enum(value, ["on", "compact", "off"]);
          this.updateRenderer(record, { mode: value });
          break;
        case "diffViewMode":
          this.enum(value, ["auto", "split", "unified"]);
          this.updateRenderer(record, { diffViewMode: value });
          break;
        case "diffIndicatorMode":
          this.enum(value, ["bars", "classic", "none"]);
          this.updateRenderer(record, { diffIndicatorMode: value });
          break;
        case "thinkingPreviewLines": {
          const count = Number(value);
          if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error(`Invalid preview line count: ${value}`);
          }
          this.updateRenderer(record, { previewLines: count });
          break;
        }
        default:
          throw new Error(`Unknown setting: ${id}`);
      }
    });
    return settingsSnapshot(record);
  }

  private updateRenderer(record: ConfigRecord, patch: Partial<Config>): void {
    const current = recordValue(record.renderer);
    record.renderer = {
      ...current,
      ...normalizeConfig({ ...current, ...patch }),
    };
  }

  private boolean(value: string): boolean {
    this.enum(value, ["on", "off"]);
    return value === "on";
  }

  private enum<T extends string>(
    value: string,
    values: readonly T[],
  ): asserts value is T {
    if (!(values as readonly string[]).includes(value)) {
      throw new Error(`Invalid setting value: ${value}`);
    }
  }
}
