import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  type SettingItem,
  SettingsList,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { ShellRuntimeController } from "../shell/index.ts";
import {
  renderEditorSettingsPreview,
  renderUserMessageSettingsPreview,
} from "../shell/settings-previews.ts";
import type { ContextRuntimeController } from "../surfaces/context/index.ts";
import {
  type CompactStyleMode,
  type Config as ContextConfig,
  DIFF_INDICATOR_MODES,
  DIFF_VIEW_MODES,
  config as rendererConfig,
  updateConfig as updateContextConfig,
} from "./config/renderer.ts";
import {
  type EditorStyle,
  type FooterStyle,
  loadConfig as loadShellConfig,
  saveEditorComponentPatch,
  saveFooterComponentPatch,
  saveUserMessagesComponentPatch,
  saveWorkingLineComponentPatch,
  type UserMessageStyle,
  type WorkingLineSpinner,
} from "./config/shell.ts";
import { ownerFor } from "./ownership.ts";
import { applyPreset, PRESET_VALUES, type Preset } from "./presets.ts";

const EDITOR_STYLES: EditorStyle[] = [
  "opencode",
  "opencode-copy-friendly",
  "accent-rail",
  "minimalist",
];
const MESSAGE_STYLES: UserMessageStyle[] = [
  "framed",
  "framed-copy-friendly",
  "compact",
  "labeled",
];
const FOOTER_STYLES: FooterStyle[] = ["starship", "native", "hidden"];
const WORKING_SPINNERS: WorkingLineSpinner[] = [
  "braille",
  "star-bloom",
  "pinwheel",
  "claude-inspired",
  "pulse",
];
const PREVIEW_LINES = ["0", "1", "3", "5", "10"];

const SECTIONS = [
  { id: "shell", label: "Shell" },
  { id: "context", label: "Context" },
  { id: "features", label: "Features" },
  { id: "presets", label: "Presets" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function renderTabs(theme: any, active: number, width: number): string {
  const text = SECTIONS.map((section, index) => {
    const label = index === active ? theme.bold(section.label) : section.label;
    return index === active ? theme.fg("text", label) : theme.fg("dim", label);
  }).join(theme.fg("dim", " / "));
  return truncateToWidth(text, Math.max(0, width));
}

function sectionDescription(section: SectionId): string {
  switch (section) {
    case "shell":
      return `${ownerFor("editor")} owns the editor, user messages, working line, and footer.`;
    case "context":
      return `${ownerFor("toolRenderer")} owns tool cards, rich diffs, thinking, and context layout.`;
    case "features":
      return "Feature switches are saved immediately and applied after /reload.";
    case "presets":
      return "Presets change ownership defaults while preserving detailed options.";
  }
}

function shellItems(): SettingItem[] {
  const config = loadShellConfig();
  return [
    {
      id: "editorEnabled",
      label: "Editor",
      description: "Enable Zentui's custom input editor.",
      currentValue: onOff(config.components.editor.enabled),
      values: ["on", "off"],
    },
    {
      id: "editorStyle",
      label: "Editor style",
      description: "Choose the input editor treatment.",
      currentValue: config.components.editor.style,
      values: EDITOR_STYLES,
    },
    {
      id: "userMessagesEnabled",
      label: "User messages",
      description: "Enable custom rendering for previous user messages.",
      currentValue: onOff(config.components.userMessages.enabled),
      values: ["on", "off"],
    },
    {
      id: "userMessagesStyle",
      label: "Message style",
      description: "Choose the previous user message treatment.",
      currentValue: config.components.userMessages.style,
      values: MESSAGE_STYLES,
    },
    {
      id: "workingLineEnabled",
      label: "Working line",
      description: "Zentui is the sole owner of Pi's working row.",
      currentValue: onOff(config.components.workingLine.enabled),
      values: ["on", "off"],
    },
    {
      id: "workingLineSpinner",
      label: "Working spinner",
      description: "Select the working line animation preset.",
      currentValue: config.components.workingLine.spinner,
      values: WORKING_SPINNERS,
    },
    {
      id: "footerStyle",
      label: "Footer",
      description: "Choose Starship, native, or hidden footer rendering.",
      currentValue: config.components.footer.style,
      values: FOOTER_STYLES,
    },
  ];
}

function contextItems(config: ContextConfig): SettingItem[] {
  return [
    {
      id: "contextMode",
      label: "Tool style",
      description:
        "on = rich cards, compact = one summary per assistant message, off = native.",
      currentValue: config.mode,
      values: ["on", "compact", "off"],
    },
    {
      id: "diffViewMode",
      label: "Diff layout",
      description: "Choose automatic, side-by-side, or unified diff layout.",
      currentValue: config.diffViewMode,
      values: [...DIFF_VIEW_MODES],
    },
    {
      id: "diffIndicatorMode",
      label: "Diff indicator",
      description: "Choose bars, classic +/- gutters, or no indicator.",
      currentValue: config.diffIndicatorMode,
      values: [...DIFF_INDICATOR_MODES],
    },
    {
      id: "diffWordWrap",
      label: "Diff word wrap",
      description: "Wrap long diff lines to the available terminal width.",
      currentValue: onOff(config.diffWordWrap),
      values: ["on", "off"],
    },
    {
      id: "thinkingPreviewLines",
      label: "Thinking preview",
      description: "Number of thinking body lines shown before expansion.",
      currentValue: String(config.previewLines),
      values: PREVIEW_LINES,
    },
    {
      id: "dimThinkingText",
      label: "Dim thinking text",
      description: "Use the dim theme color for thinking body text.",
      currentValue: onOff(config.dimThinkingText),
      values: ["on", "off"],
    },
  ];
}

function featureItems(config: ContextConfig): SettingItem[] {
  return [
    {
      id: "enableSessionReference",
      label: "Session reference",
      description: "Enable @ session search and context injection.",
      currentValue: onOff(config.enableSessionReference),
      values: ["on", "off"],
    },
    {
      id: "enableSubagentAutocomplete",
      label: "Subagent autocomplete",
      description: "Enable @ subagent completion and delegation hints.",
      currentValue: onOff(config.enableSubagentAutocomplete),
      values: ["on", "off"],
    },
    {
      id: "enableContextCommand",
      label: "Context command",
      description: "Keep the /context inspection command enabled.",
      currentValue: onOff(config.enableContextCommand),
      values: ["on", "off"],
    },
    {
      id: "enableAgentSummary",
      label: "Agent summary",
      description: "Show per-turn tool statistics after an agent turn.",
      currentValue: onOff(config.enableAgentSummary),
      values: ["on", "off"],
    },
    {
      id: "enableAliases",
      label: "Command aliases",
      description: "Register /clear and /exit aliases.",
      currentValue: onOff(config.enableAliases),
      values: ["on", "off"],
    },
    {
      id: "showStartupHeader",
      label: "Startup header",
      description: "Show CC Style's startup header on new sessions.",
      currentValue: onOff(config.showStartupHeader),
      values: ["on", "off"],
    },
  ];
}

function presetItems(): SettingItem[] {
  return PRESET_VALUES.map((preset) => ({
    id: `preset:${preset}`,
    label: preset,
    description:
      preset === "balanced"
        ? "Zentui shell + rich CC Style context renderer."
        : preset === "compact"
          ? "Zentui shell + compact CC Style context."
          : "Disable custom shell and context rendering.",
    currentValue: "apply",
    values: ["apply"],
  }));
}

function itemsFor(section: SectionId): SettingItem[] {
  switch (section) {
    case "shell":
      return shellItems();
    case "context":
      return contextItems(rendererConfig);
    case "features":
      return featureItems(rendererConfig);
    case "presets":
      return presetItems();
  }
}

function isOn(value: string): boolean {
  return value === "on";
}

type UnifiedPanelDeps = {
  shell?: ShellRuntimeController;
  context?: ContextRuntimeController;
};

function renderShellPreview(theme: any, width: number): string[] {
  const config = loadShellConfig();
  const previewWidth = Math.max(20, Math.min(72, width - 2));
  return [
    "",
    theme.fg("muted", "  Editor preview"),
    ...renderEditorSettingsPreview(config, theme, previewWidth).map(
      (line) => `  ${line}`,
    ),
    "",
    theme.fg("muted", "  User message preview"),
    ...renderUserMessageSettingsPreview(config, theme, previewWidth).map(
      (line) => `  ${line}`,
    ),
  ];
}

function saveNotice(ctx: any, label: string, value: string): void {
  ctx.ui.notify(
    `${label}: ${value} saved; live preview updated when supported.`,
    "info",
  );
}

function updateSetting(
  id: string,
  value: string,
  ctx: any,
  deps: UnifiedPanelDeps,
): void {
  if (id === "editorEnabled") {
    if (deps.shell)
      deps.shell.setEditorComponent({ enabled: isOn(value) }, ctx);
    else saveEditorComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "Editor", value);
    return;
  }
  if (id === "editorStyle" && EDITOR_STYLES.includes(value as EditorStyle)) {
    if (deps.shell)
      deps.shell.setEditorComponent({ style: value as EditorStyle }, ctx);
    else saveEditorComponentPatch({ style: value as EditorStyle });
    saveNotice(ctx, "Editor style", value);
    return;
  }
  if (id === "userMessagesEnabled") {
    if (deps.shell)
      deps.shell.setUserMessagesComponent({ enabled: isOn(value) }, ctx);
    else saveUserMessagesComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "User messages", value);
    return;
  }
  if (
    id === "userMessagesStyle" &&
    MESSAGE_STYLES.includes(value as UserMessageStyle)
  ) {
    if (deps.shell)
      deps.shell.setUserMessagesComponent(
        { style: value as UserMessageStyle },
        ctx,
      );
    else saveUserMessagesComponentPatch({ style: value as UserMessageStyle });
    saveNotice(ctx, "Message style", value);
    return;
  }
  if (id === "workingLineEnabled") {
    if (deps.shell)
      deps.shell.setWorkingLineComponent({ enabled: isOn(value) }, ctx);
    else saveWorkingLineComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "Working line", value);
    return;
  }
  if (
    id === "workingLineSpinner" &&
    WORKING_SPINNERS.includes(value as WorkingLineSpinner)
  ) {
    if (deps.shell)
      deps.shell.setWorkingLineComponent(
        { spinner: value as WorkingLineSpinner },
        ctx,
      );
    else
      saveWorkingLineComponentPatch({ spinner: value as WorkingLineSpinner });
    saveNotice(ctx, "Working spinner", value);
    return;
  }
  if (id === "footerStyle" && FOOTER_STYLES.includes(value as FooterStyle)) {
    if (deps.shell)
      deps.shell.setFooterComponent({ style: value as FooterStyle }, ctx);
    else saveFooterComponentPatch({ style: value as FooterStyle });
    saveNotice(ctx, "Footer", value);
    return;
  }
  if (id === "contextMode") {
    if (deps.context) deps.context.setMode(value as CompactStyleMode, ctx);
    else updateContextConfig({ mode: value as CompactStyleMode });
    saveNotice(ctx, "Tool style", value);
    return;
  }
  if (id === "diffViewMode" && DIFF_VIEW_MODES.includes(value as never)) {
    const patch = { diffViewMode: value as ContextConfig["diffViewMode"] };
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Diff layout", value);
    return;
  }
  if (
    id === "diffIndicatorMode" &&
    DIFF_INDICATOR_MODES.includes(value as never)
  ) {
    const patch = {
      diffIndicatorMode: value as ContextConfig["diffIndicatorMode"],
    };
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Diff indicator", value);
    return;
  }
  if (id === "diffWordWrap") {
    const patch = { diffWordWrap: isOn(value) };
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Diff word wrap", value);
    return;
  }
  if (id === "thinkingPreviewLines") {
    const patch = { previewLines: Number(value) };
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Thinking preview", value);
    return;
  }
  if (id === "dimThinkingText") {
    const patch = { dimThinkingText: isOn(value) };
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Thinking text", value);
    return;
  }
  if (
    id === "enableSessionReference" ||
    id === "enableSubagentAutocomplete" ||
    id === "enableContextCommand" ||
    id === "enableAgentSummary" ||
    id === "enableAliases" ||
    id === "showStartupHeader"
  ) {
    const patch = { [id]: isOn(value) } as Partial<ContextConfig>;
    if (deps.context) deps.context.updateConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, id, value);
    return;
  }
  if (id.startsWith("preset:")) {
    const preset = id.slice("preset:".length);
    if (PRESET_VALUES.includes(preset as Preset)) {
      applyPreset(preset as Preset);
      if (deps.context) {
        deps.context.setMode(
          preset === "compact" ? "compact" : preset === "native" ? "off" : "on",
          ctx,
        );
      }
      saveNotice(ctx, "Preset", preset);
    }
    return;
  }
}

let unifiedPanelOpen = false;

export async function showOneUiPanel(
  ctx: any,
  deps: UnifiedPanelDeps = {},
): Promise<void> {
  if (
    ctx?.mode !== "tui" ||
    !ctx?.hasUI ||
    typeof ctx.ui?.custom !== "function"
  ) {
    ctx.ui?.notify?.("/oneui requires TUI mode", "warning");
    return;
  }
  if (unifiedPanelOpen) {
    ctx.ui.notify("/oneui panel is already open", "info");
    return;
  }

  unifiedPanelOpen = true;
  try {
    await ctx.ui.custom(
      (tui: any, theme: any, _keybindings: any, done: () => void) => {
        let activeIndex = 0;
        let list: SettingsList;
        const createList = () => {
          list = new SettingsList(
            itemsFor(SECTIONS[activeIndex].id),
            10,
            getSettingsListTheme(),
            (id, value) => {
              updateSetting(id, value, ctx, deps);
              list.updateValue(id, value);
              tui.requestRender();
            },
            done,
          );
        };
        createList();

        const switchSection = (delta: number) => {
          activeIndex =
            (activeIndex + delta + SECTIONS.length) % SECTIONS.length;
          createList();
          tui.requestRender();
        };

        return {
          render: (width: number) => [
            renderTabs(theme, activeIndex, width),
            theme.fg("dim", "─".repeat(Math.max(0, width))),
            theme.fg(
              "muted",
              `  ${sectionDescription(SECTIONS[activeIndex].id)}`,
            ),
            "",
            ...list.render(width),
            ...(SECTIONS[activeIndex].id === "shell"
              ? renderShellPreview(theme, width)
              : []),
            "",
            truncateToWidth(
              theme.fg(
                "dim",
                "  Tab/Shift+Tab switch sections · Enter/Space change · Esc close",
              ),
              width,
            ),
          ],
          invalidate: () => list.invalidate(),
          handleInput: (data: string) => {
            if (data === "\x1b[Z" || matchesKey(data, "shift+tab")) {
              switchSection(-1);
              return;
            }
            if (matchesKey(data, "tab")) {
              switchSection(1);
              return;
            }
            list.handleInput(data);
          },
        };
      },
    );
  } finally {
    unifiedPanelOpen = false;
  }
}
