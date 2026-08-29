import {
  type ExtensionCommandContext,
  type ExtensionContext,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  type SettingItem,
  SettingsList,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  renderEditorSettingsPreview,
  renderUserMessageSettingsPreview,
} from "./commands/settings-previews.ts";
import {
  type CompactStyleMode,
  type Config as ContextConfig,
  DIFF_INDICATOR_MODES,
  DIFF_VIEW_MODES,
  config as rendererConfig,
  updateConfig as updateContextConfig,
} from "./config/renderer.ts";
import {
  type EditorComponentConfig,
  type EditorStyle,
  type FooterComponentConfig,
  type FooterStyle,
  loadConfig as loadShellConfig,
  saveEditorComponentPatch,
  saveFooterComponentPatch,
  saveUserMessagesComponentPatch,
  saveWorkingLineComponentPatch,
  type UserMessageStyle,
  type UserMessagesComponentConfig,
  type WorkingLineComponentPatch,
  type WorkingLineSpinner,
} from "./config/shell.ts";
import { overlayManager } from "./overlay/overlay-manager.ts";
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
  { id: "header", label: "Header" },
  { id: "context", label: "Context" },
  { id: "workingLine", label: "WorkingLine" },
  { id: "editor", label: "Editor" },
  { id: "footer", label: "Footer" },
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

/** Adds a stable chrome frame around the settings content. */
function renderPanelFrame(theme: any, width: number, rows: string[]): string[] {
  const safeWidth = Math.max(1, width);
  const border = (text: string) => theme.fg("border", text);
  if (safeWidth === 1)
    return [border("│"), ...rows.map(() => border("│")), border("│")];

  const innerWidth = safeWidth - 2;
  const content = rows.map(
    (row) =>
      `${border("│")}${truncateToWidth(row, innerWidth, "", true)}${border("│")}`,
  );
  if (safeWidth === 2) return [border("╭╮"), ...content, border("╰╯")];
  return [
    border(`╭${"─".repeat(innerWidth)}╮`),
    ...content,
    border(`╰${"─".repeat(innerWidth)}╯`),
  ];
}

function sectionDescription(section: SectionId): string {
  switch (section) {
    case "header":
      return "Header owns startup branding and startup guidance.";
    case "context":
      return `${ownerFor("toolRenderer")} owns messages, tool cards, diffs, thinking, and summaries.`;
    case "workingLine":
      return "WorkingLine is the sole owner of Pi's unkeyed working row.";
    case "editor":
      return `${ownerFor("editor")} owns the input editor factory and its styles.`;
    case "footer":
      return `${ownerFor("footer")} owns footer rendering and project status segments.`;
    case "features":
      return "Feature switches are saved immediately and applied after /reload.";
    case "presets":
      return "Presets change ownership defaults while preserving detailed options.";
  }
}

/**
 * Builds settings owned by the Editor layout.
 */
function editorItems(): SettingItem[] {
  const config = loadShellConfig();
  return [
    {
      id: "editorEnabled",
      label: "Editor",
      description: "Enable the custom input editor.",
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
  ];
}

/**
 * Builds settings owned by the WorkingLine layout.
 */
function workingLineItems(): SettingItem[] {
  const config = loadShellConfig();
  return [
    {
      id: "workingLineEnabled",
      label: "Working line",
      description: "Enable the sole owner of Pi's working row.",
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
  ];
}

/**
 * Builds settings owned by the Footer layout.
 */
function footerItems(): SettingItem[] {
  const config = loadShellConfig();
  return [
    {
      id: "footerStyle",
      label: "Footer",
      description: "Choose Starship, native, or hidden footer rendering.",
      currentValue: config.components.footer.style,
      values: FOOTER_STYLES,
    },
  ];
}

/**
 * Builds settings owned by the Context layout.
 */
function contextItems(config: ContextConfig): SettingItem[] {
  const shellConfig = loadShellConfig();
  return [
    {
      id: "userMessagesEnabled",
      label: "User messages",
      description: "Enable custom rendering for previous user messages.",
      currentValue: onOff(shellConfig.components.userMessages.enabled),
      values: ["on", "off"],
    },
    {
      id: "userMessagesStyle",
      label: "Message style",
      description: "Choose the previous user message treatment.",
      currentValue: shellConfig.components.userMessages.style,
      values: MESSAGE_STYLES,
    },
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

/**
 * Builds settings owned by the Header layout.
 */
function headerItems(config: ContextConfig): SettingItem[] {
  return [
    {
      id: "showStartupHeader",
      label: "Startup header",
      description: "Show the custom startup header on new sessions.",
      currentValue: onOff(config.showStartupHeader),
      values: ["on", "off"],
    },
  ];
}

/**
 * Builds non-visual feature switches.
 */
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
    case "header":
      return headerItems(rendererConfig);
    case "context":
      return contextItems(rendererConfig);
    case "workingLine":
      return workingLineItems();
    case "editor":
      return editorItems();
    case "footer":
      return footerItems();
    case "features":
      return featureItems(rendererConfig);
    case "presets":
      return presetItems();
  }
}

function isOn(value: string): boolean {
  return value === "on";
}

export type TuiPanelRuntime = {
  setEditorComponent: (
    patch: Partial<EditorComponentConfig>,
    ctx: ExtensionContext,
  ) => { applied: boolean; reason?: string };
  setUserMessagesComponent: (
    patch: Partial<UserMessagesComponentConfig>,
    ctx: ExtensionContext,
  ) => void;
  setWorkingLineComponent: (
    patch: WorkingLineComponentPatch,
    ctx: ExtensionContext,
  ) => { applied: boolean; reason?: string };
  setFooterComponent: (
    patch: Partial<FooterComponentConfig>,
    ctx: ExtensionContext,
  ) => void;
  setContextMode: (mode: CompactStyleMode, ctx: ExtensionContext) => void;
  updateContextConfig: (
    patch: Partial<ContextConfig>,
    ctx: ExtensionContext,
  ) => void;
};

type UnifiedPanelDeps = {
  runtime?: TuiPanelRuntime;
};

/**
 * Renders the Editor layout preview for the settings panel.
 */
function renderEditorPreview(theme: any, width: number): string[] {
  const config = loadShellConfig();
  const previewWidth = Math.max(20, Math.min(72, width - 2));
  return [
    "",
    theme.fg("muted", "  Editor preview"),
    ...renderEditorSettingsPreview(config, theme, previewWidth).map(
      (line) => `  ${line}`,
    ),
  ];
}

/**
 * Renders the Context layout User Message preview for the settings panel.
 */
function renderContextPreview(theme: any, width: number): string[] {
  const config = loadShellConfig();
  const previewWidth = Math.max(20, Math.min(72, width - 2));
  return [
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

/**
 * Persists one panel setting and reconciles its owning runtime layout.
 *
 * @param id Stable settings item identifier.
 * @param value Selected settings value.
 * @param ctx Active Pi extension context.
 * @param deps Live runtime controllers available to the panel.
 */
function updateSetting(
  id: string,
  value: string,
  ctx: any,
  deps: UnifiedPanelDeps,
): void {
  if (id === "editorEnabled") {
    if (deps.runtime)
      deps.runtime.setEditorComponent({ enabled: isOn(value) }, ctx);
    else saveEditorComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "Editor", value);
    return;
  }
  if (id === "editorStyle" && EDITOR_STYLES.includes(value as EditorStyle)) {
    if (deps.runtime)
      deps.runtime.setEditorComponent({ style: value as EditorStyle }, ctx);
    else saveEditorComponentPatch({ style: value as EditorStyle });
    saveNotice(ctx, "Editor style", value);
    return;
  }
  if (id === "userMessagesEnabled") {
    if (deps.runtime)
      deps.runtime.setUserMessagesComponent({ enabled: isOn(value) }, ctx);
    else saveUserMessagesComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "User messages", value);
    return;
  }
  if (
    id === "userMessagesStyle" &&
    MESSAGE_STYLES.includes(value as UserMessageStyle)
  ) {
    if (deps.runtime)
      deps.runtime.setUserMessagesComponent(
        { style: value as UserMessageStyle },
        ctx,
      );
    else saveUserMessagesComponentPatch({ style: value as UserMessageStyle });
    saveNotice(ctx, "Message style", value);
    return;
  }
  if (id === "workingLineEnabled") {
    if (deps.runtime)
      deps.runtime.setWorkingLineComponent({ enabled: isOn(value) }, ctx);
    else saveWorkingLineComponentPatch({ enabled: isOn(value) });
    saveNotice(ctx, "Working line", value);
    return;
  }
  if (
    id === "workingLineSpinner" &&
    WORKING_SPINNERS.includes(value as WorkingLineSpinner)
  ) {
    if (deps.runtime)
      deps.runtime.setWorkingLineComponent(
        { spinner: value as WorkingLineSpinner },
        ctx,
      );
    else
      saveWorkingLineComponentPatch({ spinner: value as WorkingLineSpinner });
    saveNotice(ctx, "Working spinner", value);
    return;
  }
  if (id === "footerStyle" && FOOTER_STYLES.includes(value as FooterStyle)) {
    if (deps.runtime)
      deps.runtime.setFooterComponent({ style: value as FooterStyle }, ctx);
    else saveFooterComponentPatch({ style: value as FooterStyle });
    saveNotice(ctx, "Footer", value);
    return;
  }
  if (id === "contextMode") {
    if (deps.runtime)
      deps.runtime.setContextMode(value as CompactStyleMode, ctx);
    else updateContextConfig({ mode: value as CompactStyleMode });
    saveNotice(ctx, "Tool style", value);
    return;
  }
  if (id === "diffViewMode" && DIFF_VIEW_MODES.includes(value as never)) {
    const patch = { diffViewMode: value as ContextConfig["diffViewMode"] };
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
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
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Diff indicator", value);
    return;
  }
  if (id === "diffWordWrap") {
    const patch = { diffWordWrap: isOn(value) };
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Diff word wrap", value);
    return;
  }
  if (id === "thinkingPreviewLines") {
    const patch = { previewLines: Number(value) };
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, "Thinking preview", value);
    return;
  }
  if (id === "dimThinkingText") {
    const patch = { dimThinkingText: isOn(value) };
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
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
    if (deps.runtime) deps.runtime.updateContextConfig(patch, ctx);
    else updateContextConfig(patch);
    saveNotice(ctx, id, value);
    return;
  }
  if (id.startsWith("preset:")) {
    const preset = id.slice("preset:".length);
    if (PRESET_VALUES.includes(preset as Preset)) {
      applyPreset(preset as Preset);
      if (deps.runtime) {
        deps.runtime.setContextMode(
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

/**
 * Opens the unified settings panel as a managed overlay.
 *
 * @param ctx Active TUI extension context.
 * @param deps Runtime controllers used for live updates.
 */
export async function showOneUiPanel(
  ctx: ExtensionCommandContext,
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
    let panelHandle: { focus: () => void } | undefined;
    await overlayManager.run(() =>
      ctx.ui.custom(
        (tui, theme, _keybindings, done) => {
          let activeIndex = 0;
          let list: SettingsList;
          const createList = () => {
            list = new SettingsList(
              itemsFor(SECTIONS[activeIndex].id),
              10,
              getSettingsListTheme(),
              (id, value) => {
                // Replacing Pi's editor synchronously moves focus away from
                // this overlay. Restore the overlay handle after the editor
                // has been reconciled so the panel remains interactive.
                if (id === "editorEnabled") {
                  try {
                    updateSetting(id, value, ctx, deps);
                    list.updateValue(id, value);
                  } catch (error) {
                    ctx.ui?.notify?.(
                      `Could not update Editor setting: ${error instanceof Error ? error.message : String(error)}`,
                      "error",
                    );
                  } finally {
                    panelHandle?.focus();
                    tui.requestRender();
                  }
                  return;
                }
                updateSetting(id, value, ctx, deps);
                list.updateValue(id, value);
                tui.requestRender();
              },
              () => done(undefined),
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
            render: (width: number) => {
              const contentWidth = Math.max(0, width - 2);
              return renderPanelFrame(theme, width, [
                renderTabs(theme, activeIndex, contentWidth),
                theme.fg("dim", "─".repeat(contentWidth)),
                theme.fg(
                  "muted",
                  `  ${sectionDescription(SECTIONS[activeIndex].id)}`,
                ),
                "",
                ...list.render(contentWidth),
                ...(SECTIONS[activeIndex].id === "editor"
                  ? renderEditorPreview(theme, contentWidth)
                  : SECTIONS[activeIndex].id === "context"
                    ? renderContextPreview(theme, contentWidth)
                    : []),
                "",
                truncateToWidth(
                  theme.fg(
                    "dim",
                    "  Tab/Shift+Tab switch sections · Enter/Space change · Esc close",
                  ),
                  contentWidth,
                ),
              ]);
            },
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
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-center",
            width: "85%",
            maxHeight: "90%",
            margin: {
              top: 10,
              right: 1,
              bottom: 1,
              left: 1,
            },
          },
          onHandle: (handle: { focus: () => void }) => {
            panelHandle = handle;
          },
        },
      ),
    );
  } finally {
    unifiedPanelOpen = false;
  }
}
