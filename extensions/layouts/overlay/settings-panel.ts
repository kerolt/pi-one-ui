import {
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  type SettingItem,
  SettingsList,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  DIFF_INDICATOR_MODES,
  DIFF_VIEW_MODES,
} from "../../app/config/renderer.ts";
import type { SettingsSnapshot } from "../../app/settings/controller.ts";
import { PRESET_VALUES } from "../../app/settings/presets.ts";
import {
  renderEditorSettingsPreview,
  renderUserMessageSettingsPreview,
} from "./settings-previews.ts";

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
const onOff = (value: boolean) => (value ? "on" : "off");
const item = (
  id: string,
  label: string,
  description: string,
  currentValue: string,
  values: readonly string[],
): SettingItem => ({
  id,
  label,
  description,
  currentValue,
  values: [...values],
});
const toggle = (
  id: string,
  label: string,
  description: string,
  enabled: boolean,
) => item(id, label, description, onOff(enabled), ["on", "off"]);

function itemsFor(
  section: SectionId,
  snapshot: SettingsSnapshot,
): SettingItem[] {
  const { components } = snapshot.shell;
  const config = snapshot.renderer;
  switch (section) {
    case "header":
      return [
        toggle(
          "showStartupHeader",
          "Startup header",
          "Show the custom startup header on new sessions.",
          config.showStartupHeader,
        ),
      ];
    case "editor":
      return [
        item(
          "editorStyle",
          "Editor",
          "on applies the Minimalist decoration; off restores Pi's native editor.",
          components.editor.style,
          ["on", "off"],
        ),
        item(
          "editorBorderColorMode",
          "Border color",
          "static keeps one border color; adaptive shifts the border with the effort level.",
          components.editor.borderColorMode,
          ["static", "adaptive"],
        ),
      ];
    case "workingLine":
      return [
        toggle(
          "workingLineEnabled",
          "Working line",
          "Enable the sole owner of Pi's working row.",
          components.workingLine.enabled,
        ),
        item(
          "workingLineSpinner",
          "Working spinner",
          "Select the working line animation preset.",
          components.workingLine.spinner,
          ["braille", "star-bloom", "pinwheel", "claude-inspired", "pulse"],
        ),
      ];
    case "footer":
      return [
        item(
          "footerStyle",
          "Footer",
          "Choose Starship, native, or hidden footer rendering.",
          components.footer.style,
          ["starship", "native", "hidden"],
        ),
      ];
    case "context":
      return [
        toggle(
          "userMessagesEnabled",
          "User messages",
          "Enable custom rendering for previous user messages.",
          components.userMessages.enabled,
        ),
        item(
          "userMessagesStyle",
          "Message style",
          "Choose the previous user message treatment.",
          components.userMessages.style,
          ["framed", "framed-copy-friendly", "compact", "labeled"],
        ),
        item(
          "contextMode",
          "Tool style",
          "on = rich cards, compact = one summary per assistant message, off = native.",
          config.mode,
          ["on", "compact", "off"],
        ),
        item(
          "diffViewMode",
          "Diff layout",
          "Choose automatic, side-by-side, or unified diff layout.",
          config.diffViewMode,
          DIFF_VIEW_MODES,
        ),
        item(
          "diffIndicatorMode",
          "Diff indicator",
          "Choose bars, classic +/- gutters, or no indicator.",
          config.diffIndicatorMode,
          DIFF_INDICATOR_MODES,
        ),
        toggle(
          "diffWordWrap",
          "Diff word wrap",
          "Wrap long diff lines to the available terminal width.",
          config.diffWordWrap,
        ),
        item(
          "thinkingPreviewLines",
          "Thinking preview",
          "Number of thinking body lines shown before expansion.",
          String(config.previewLines),
          ["0", "1", "3", "5", "10"],
        ),
        toggle(
          "dimThinkingText",
          "Dim thinking text",
          "Use the dim theme color for thinking body text.",
          config.dimThinkingText,
        ),
      ];
    case "features":
      return [
        toggle(
          "enableSessionReference",
          "Session reference",
          "Enable @ session search and context injection.",
          config.enableSessionReference,
        ),
        toggle(
          "enableSubagentAutocomplete",
          "Subagent autocomplete",
          "Enable @ subagent completion and delegation hints.",
          config.enableSubagentAutocomplete,
        ),
        toggle(
          "enableContextCommand",
          "Context command",
          "Keep the /context inspection command enabled.",
          config.enableContextCommand,
        ),
        toggle(
          "enableAgentSummary",
          "Agent summary",
          "Show per-turn tool statistics after an agent turn.",
          config.enableAgentSummary,
        ),
        toggle(
          "enableAliases",
          "Command aliases",
          "Register /clear and /exit aliases.",
          config.enableAliases,
        ),
        toggle(
          "enableEffortCommand",
          "Effort command",
          "Register the /effort thinking-level command.",
          config.enableEffortCommand,
        ),
      ];
    case "presets":
      return PRESET_VALUES.map((preset) =>
        item(
          `preset:${preset}`,
          preset,
          preset === "native"
            ? "Disable custom Editor, Footer, WorkingLine and Context rendering."
            : preset === "compact"
              ? "Enable Editor, Footer, WorkingLine and compact Context rendering."
              : "Enable Editor, Footer, WorkingLine and rich Context rendering.",
          "apply",
          ["apply"],
        ),
      );
  }
}

const descriptions: Record<SectionId, string> = {
  header: "Header owns startup branding and startup guidance.",
  context: "Context owns messages, tool cards, diffs, thinking, and summaries.",
  workingLine: "WorkingLine is the sole owner of Pi's unkeyed working row.",
  editor: "Editor owns the input editor factory and its styles.",
  footer: "Footer owns footer rendering and project status segments.",
  features: "Feature switches are saved immediately and applied after /reload.",
  presets:
    "Presets change component settings while preserving detailed options.",
};

function renderPanelFrame(
  theme: Theme,
  width: number,
  rows: string[],
): string[] {
  const safeWidth = Math.max(1, width);
  const border = (text: string) => theme.fg("border", text);
  if (safeWidth === 1) {
    return [border("│"), ...rows.map(() => border("│")), border("│")];
  }
  const inner = safeWidth - 2;
  const content = rows.map(
    (row) =>
      `${border("│")}${truncateToWidth(row, inner, "", true)}${border("│")}`,
  );
  return [
    border(`╭${"─".repeat(inner)}╮`),
    ...content,
    border(`╰${"─".repeat(inner)}╯`),
  ];
}

export type SettingsPanelOptions = {
  readonly snapshot: () => SettingsSnapshot;
  readonly change: (id: string, value: string) => void;
  readonly onError: (error: unknown) => void;
};

/** 面板负责显示和交互，配置提交与焦点协作由 app 提供。 */
export function createSettingsPanel(
  tui: Pick<TUI, "requestRender">,
  theme: Theme,
  done: () => void,
  options: SettingsPanelOptions,
): Component {
  let activeIndex = 0;
  let list: SettingsList;
  const createList = (): void => {
    list = new SettingsList(
      itemsFor(SECTIONS[activeIndex].id, options.snapshot()),
      10,
      getSettingsListTheme(),
      (id, value) => {
        try {
          options.change(id, value);
          list.updateValue(id, value);
        } catch (error) {
          options.onError(error);
          createList();
          list.selectItem(id);
        } finally {
          tui.requestRender();
        }
      },
      done,
    );
  };
  createList();
  const switchSection = (delta: number): void => {
    activeIndex = (activeIndex + delta + SECTIONS.length) % SECTIONS.length;
    createList();
    tui.requestRender();
  };
  return {
    render(width) {
      const inner = Math.max(0, width - 2);
      const section = SECTIONS[activeIndex].id;
      const tabs = SECTIONS.map((entry, index) =>
        index === activeIndex
          ? theme.fg("text", theme.bold(entry.label))
          : theme.fg("dim", entry.label),
      ).join(theme.fg("dim", " / "));
      const config = options.snapshot().shell;
      const previewWidth = Math.max(20, Math.min(72, inner - 2));
      const preview =
        section === "editor"
          ? [
              "",
              theme.fg("muted", "  Editor preview"),
              ...renderEditorSettingsPreview(config, theme, previewWidth).map(
                (line) => `  ${line}`,
              ),
            ]
          : section === "context"
            ? [
                "",
                theme.fg("muted", "  User message preview"),
                ...renderUserMessageSettingsPreview(
                  config,
                  theme,
                  previewWidth,
                ).map((line) => `  ${line}`),
              ]
            : [];
      return renderPanelFrame(theme, width, [
        truncateToWidth(tabs, inner),
        theme.fg("dim", "─".repeat(inner)),
        theme.fg("muted", `  ${descriptions[section]}`),
        "",
        ...list.render(inner),
        ...preview,
        "",
        truncateToWidth(
          theme.fg(
            "dim",
            "  Tab/Shift+Tab switch sections · Enter/Space change · Esc close",
          ),
          inner,
        ),
      ]);
    },
    invalidate: () => list.invalidate(),
    handleInput(data) {
      if (data === "\x1b[Z" || matchesKey(data, "shift+tab")) {
        switchSection(-1);
      } else if (matchesKey(data, "tab")) {
        switchSection(1);
      } else {
        list.handleInput(data);
      }
    },
  };
}
