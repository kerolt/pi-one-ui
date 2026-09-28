import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../extensions/app/config/shell.ts";
import { WrappedPolishedEditor } from "../../extensions/layouts/editor/ui.ts";

/** 真实 Theme 构造函数要求完整调色板，这里提供一套完整的深色取值。 */
const FG_TOKENS = {
  accent: "#7aa2f7",
  border: "#7aa2f7",
  borderAccent: "#7dcfff",
  borderMuted: "#3b4261",
  success: "#9ece6a",
  error: "#f7768e",
  warning: "#e0af68",
  muted: "#565f89",
  dim: "#414868",
  text: "#c0caf5",
  thinkingText: "#c0caf5",
  searchMatchText: "#1a1b26",
  userMessageText: "#c0caf5",
  customMessageText: "#c0caf5",
  customMessageLabel: "#bb9af7",
  toolTitle: "#7aa2f7",
  toolOutput: "#c0caf5",
  mdHeading: "#7aa2f7",
  mdLink: "#7dcfff",
  mdLinkUrl: "#565f89",
  mdCode: "#9ece6a",
  mdCodeBlock: "#9ece6a",
  mdCodeBlockBorder: "#3b4261",
  mdQuote: "#c0caf5",
  mdQuoteBorder: "#3b4261",
  mdHr: "#3b4261",
  mdListBullet: "#7dcfff",
  toolDiffAdded: "#9ece6a",
  toolDiffRemoved: "#f7768e",
  toolDiffContext: "#565f89",
  syntaxComment: "#565f89",
  syntaxKeyword: "#bb9af7",
  syntaxFunction: "#7dcfff",
  syntaxVariable: "#c0caf5",
  syntaxString: "#9ece6a",
  syntaxNumber: "#ff9e64",
  syntaxType: "#2ac3de",
  syntaxOperator: "#89ddff",
  syntaxPunctuation: "#c0caf5",
  thinkingOff: "#565f89",
  thinkingMinimal: "#565f89",
  thinkingLow: "#7dcfff",
  thinkingMedium: "#7aa2f7",
  thinkingHigh: "#e0af68",
  thinkingXhigh: "#f7768e",
  thinkingMax: "#ff9e64",
  bashMode: "#e0af68",
} satisfies Record<ThemeColor, string>;

const BG_TOKENS = {
  selectedBg: "#292e42",
  scrollbarThumb: "#3b4261",
  searchMatchBg: "#364a82",
  userMessageBg: "#1f2335",
  customMessageBg: "#24283b",
  toolPendingBg: "#1f2335",
  toolSuccessBg: "#1f2d2a",
  toolErrorBg: "#2d1f28",
};

function piTheme(): Theme {
  return new Theme(FG_TOKENS, BG_TOKENS, "truecolor");
}

function uiThemeEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("borderMuted", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("muted", text),
      noMatch: (text) => theme.fg("muted", text),
    },
  };
}

function tuiStub(rows = 40, cols = 120): TUI {
  return {
    terminal: { rows, cols },
    requestRender() {},
  } as unknown as TUI;
}

async function nativeEditorWithSuggestions(theme: Theme): Promise<Editor> {
  const editor = new Editor(tuiStub(), uiThemeEditorTheme(theme));
  editor.setAutocompleteProvider({
    triggerCharacters: ["/"],
    async getSuggestions() {
      return {
        prefix: "/",
        items: [
          { value: "/help", label: "/help", description: "Show help" },
          { value: "/quit", label: "/quit", description: "Quit Pi" },
        ],
      };
    },
    applyCompletion(lines, cursorLine, cursorCol, item) {
      const line = lines[cursorLine] ?? "";
      const next = `${line.slice(0, 1)}${item.value.slice(1)}`;
      lines[cursorLine] = next;
      return { lines, cursorLine, cursorCol: next.length };
    },
  });
  editor.handleInput("/");
  // 原生 getSuggestions 是异步的，等它落地后再渲染。
  await new Promise((resolve) => setTimeout(resolve, 0));
  return editor;
}

function renderThroughFrame(
  editor: Editor,
  theme: Theme,
  configOverrides: Parameters<typeof mergeConfig>[0] = {},
  thinkingLevel = "high",
): string {
  const config = mergeConfig(configOverrides);
  // WrappedPolishedEditor 按运行时的 Pi 私有字段做结构检查，类型上按仓库测试惯例断言。
  const editorComponent = new WrappedPolishedEditor(
    editor as never,
    theme,
    () => config,
    () => ({ modelLabel: "model", providerLabel: "provider" }),
    () => thinkingLevel,
  );
  return editorComponent.render(60).join("\n");
}

function selectedRow(output: string): string {
  return output.split("\n").find((line) => line.includes("→ /help")) ?? "";
}

describe("native autocomplete selection color", () => {
  it("repaints real native suggestion rows with the frame border color", async () => {
    const theme = piTheme();
    const output = renderThroughFrame(
      await nativeEditorWithSuggestions(theme),
      theme,
    );

    expect(selectedRow(output)).toContain(
      `${theme.getFgAnsi("borderMuted")}→ /help`,
    );
    expect(selectedRow(output)).not.toContain(theme.getFgAnsi("accent"));
    expect(output).toContain("  /quit");
    expect(output).toContain("Show help");
  });

  it("keeps native effort border colors for the selected row in adaptive mode", async () => {
    const theme = piTheme();
    const editor = await nativeEditorWithSuggestions(theme);
    editor.borderColor = (text) => theme.fg("thinkingXhigh", text);
    const output = renderThroughFrame(
      editor,
      theme,
      { components: { editor: { borderColorMode: "adaptive" } } },
      "xhigh",
    );

    expect(selectedRow(output)).toContain(
      `${theme.getFgAnsi("thinkingXhigh")}→ /help`,
    );
    expect(selectedRow(output)).not.toContain(theme.getFgAnsi("accent"));
  });
});
