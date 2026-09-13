import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderEditorSettingsPreview } from "../../extensions/app/commands/settings-previews.ts";
import {
  defaultConfig,
  mergeConfig,
  type PolishedTuiConfig,
} from "../../extensions/app/config/shell";
import {
  formatElapsedDuration,
  type MinimalistEditorMetadata,
  renderMinimalistFrame,
} from "../../extensions/layouts/editor/minimalist-editor";

function theme(): Theme {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    strikethrough: (text: string) => text,
    inverse: (text: string) => text,
  } as Theme;
}

function recordingTheme(calls: Array<{ color: string; text: string }>): Theme {
  return {
    ...theme(),
    fg(color: string, text: string) {
      calls.push({ color, text });
      return text;
    },
  } as Theme;
}

function config(overrides: Partial<PolishedTuiConfig> = {}): PolishedTuiConfig {
  const editor = defaultConfig.components.editor;
  return {
    ...defaultConfig,
    ...overrides,
    components: {
      ...defaultConfig.components,
      editor: {
        ...editor,
        style: "minimalist",
        borderColorMode:
          overrides.editorBorderColorMode ?? editor.borderColorMode,
        styles: {
          ...editor.styles,
          minimalist: {
            ...editor.styles.minimalist,
            ...overrides.editorStyles?.minimalist,
          },
        },
      },
    },
  };
}

function render(
  width = 80,
  inputText = "draft",
  viewport?: { above?: string; below?: string },
) {
  return renderMinimalistFrame({
    width,
    editorLines: ["draft"],
    autocompleteLines: ["suggestion"],
    viewport,
    inputText,
    metadata: {
      cwd: `${homedir()}/project`,
      branch: "feature/minimalist",
      dirty: true,
      ahead: 2,
      behind: 1,
      costLabel: "$0.123",
      modelLabel: "model-x",
      thinkingLevel: "high",
      sessionName: "release prep",
      agentDurationMs: 12_500,
      agentActive: true,
    },
    uiTheme: theme(),
    config: config(),
  });
}

describe("minimalist editor frame", () => {
  it("prefers theme tokens over native fallbacks when the theme defines them", () => {
    const calls: Array<{ color: string; text: string }> = [];
    const themed = {
      ...recordingTheme(calls),
      // 模拟主题定义了 cwd / editorModel / editorBorder 专有 token。
      hasThemeToken: (token: string) =>
        token === "cwd" || token === "editorModel" || token === "editorBorder",
    } as Theme;
    const lines = renderMinimalistFrame({
      width: 120,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp/project",
        costLabel: "$0.123",
        modelLabel: "model-x",
      },
      uiTheme: themed,
      config: config({ editorBorderColorMode: "static" }),
    }).join("\n");
    expect(calls).toContainEqual({ color: "cwd", text: "project" });
    expect(calls).toContainEqual({ color: "editorModel", text: "model-x" });
    expect(calls.some(({ color }) => color === "editorBorder")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders metadata and framed autocomplete", () => {
    const lines = render();
    expect(lines[0]).toContain("12s · release prep");
    const plain0 = lines[0].replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain0).toContain("$0.123 – model-x – high");
    expect(lines[0]).toMatch(/^╭.*╮$/);
    expect(lines[1]).toMatch(/^│ draft\s+│$/);
    expect(lines[2]).toMatch(/^├─+┤$/);
    expect(lines[3]).toContain("suggestion");
    expect(lines.at(-1)).toContain("feature/minimalist * ↑2 ↓1");
    expect(lines.at(-1)).toContain("project");
    expect(lines.at(-1)).toMatch(/^╰.*╯$/);
  });

  it("uses distinct theme roles for default minimalist metadata", () => {
    const calls: Array<{ color: string; text: string }> = [];
    const lines = renderMinimalistFrame({
      width: 120,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp/project",
        branch: "main",
        costLabel: "$0.123",
        modelLabel: "model-x",
        thinkingLevel: "high",
      },
      uiTheme: recordingTheme(calls),
      config: config(),
    });

    expect(lines.join("\n")).toContain("main");
    // 测试主题未定义 cwd/editorModel 专有 token → 回落原生默认。
    expect(calls).toEqual(
      expect.arrayContaining([
        { color: "success", text: "$0.123" },
        { color: "syntaxKeyword", text: "model-x" },
        { color: "warning", text: "high" },
        { color: "syntaxKeyword", text: "main" },
        { color: "syntaxFunction", text: "project" },
      ]),
    );
    const branchColor = calls.find(({ text }) => text === "main")?.color;
    const cwdColor = calls.find(({ text }) => text === "project")?.color;
    expect(branchColor).toBe("syntaxKeyword");
    expect(branchColor).not.toBe(cwdColor);
    const chromeCalls = calls.filter(({ text }) => /^[╭╮╰╯─│ –]+$/.test(text));
    expect(chromeCalls.length).toBeGreaterThan(0);
    expect(new Set(chromeCalls.map(({ color }) => color))).toEqual(
      new Set(["borderMuted"]),
    );
  });

  it.each(["bold purple", "success"] as const)(
    "ignores the removed gitBranch fallback color %s",
    (gitBranch) => {
      const calls: Array<{ color: string; text: string }> = [];
      renderMinimalistFrame({
        width: 80,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: "", branch: "main" },
        uiTheme: recordingTheme(calls),
        config: config({
          colors: mergeConfig({ colors: { gitBranch } }).colors,
        }),
      });
      expect(calls).toContainEqual({
        color: "syntaxKeyword",
        text: "main",
      });
    },
  );

  it("preserves custom theme roles", () => {
    const calls: Array<{ color: string; text: string }> = [];
    const colors = {
      ...defaultConfig.colors,
      cwd: "accent",
      gitBranch: "bold purple",
      editorGitBranch: "success",
      cost: "warning",
      editorModel: "text",
      editorThinkingHigh: "thinkingHigh",
    };
    renderMinimalistFrame({
      width: 120,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp/project",
        branch: "main",
        costLabel: "$0.123",
        modelLabel: "model-x",
        thinkingLevel: "high",
      },
      uiTheme: recordingTheme(calls),
      config: config({ colors }),
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        { color: "warning", text: "$0.123" },
        { color: "text", text: "model-x" },
        { color: "thinkingHigh", text: "high" },
        { color: "success", text: "main" },
        { color: "accent", text: "project" },
      ]),
    );
  });

  it("renders defaults and unconfigured colors through theme tokens", () => {
    const calls: Array<{ color: string; text: string }> = [];
    const output = renderMinimalistFrame({
      width: 120,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp/project",
        branch: "main",
        costLabel: "$0.123",
        modelLabel: "model-x",
        thinkingLevel: "high",
      },
      uiTheme: recordingTheme(calls),
      config: config(),
    }).join("\n");

    // 默认值按 theme 语义映射成语义 token，未配置字段回落原生默认。
    expect(calls).toEqual(
      expect.arrayContaining([
        { color: "success", text: "$0.123" },
        { color: "warning", text: "high" },
        { color: "syntaxKeyword", text: "main" },
        { color: "syntaxFunction", text: "project" },
        { color: "syntaxKeyword", text: "model-x" },
      ]),
    );
    expect(output).not.toContain("\\x1b[");
  });

  it("uses only the canonical editor branch color", () => {
    const colorsWithoutEditorBranch = mergeConfig({
      colors: {
        gitBranch: "cyan",
        editorModel: "bright-purple",
        editorThinkingHigh: "yellow",
      },
    }).colors;
    const calls: Array<{ color: string; text: string }> = [];
    renderMinimalistFrame({
      width: 120,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "",
        branch: "main",
        modelLabel: "model-x",
        thinkingLevel: "high",
      },
      uiTheme: recordingTheme(calls),
      config: config({ colors: colorsWithoutEditorBranch }),
    });
    // 未配置 editorGitBranch → 回退 bold syntaxKeyword；ANSI 色名映射到语义 token。
    expect(calls).toEqual(
      expect.arrayContaining([
        { color: "syntaxKeyword", text: "main" },
        { color: "syntaxKeyword", text: "model-x" },
        { color: "warning", text: "high" },
      ]),
    );

    const canonicalCalls: Array<{ color: string; text: string }> = [];
    renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: { cwd: "", branch: "main" },
      uiTheme: recordingTheme(canonicalCalls),
      config: config({
        colors: mergeConfig({
          colors: { gitBranch: "cyan", editorGitBranch: "bright-green" },
        }).colors,
      }),
    });
    expect(canonicalCalls).toContainEqual({
      color: "success",
      text: "main",
    });
  });

  it("puts complete viewport counts first on their matching borders", () => {
    const lines = render(80, "draft", { above: "7", below: "11" });
    expect(lines[0]).toMatch(/^╭─ ↑ 7 more · 12s · release prep/);
    expect(lines.at(-1)).toMatch(
      /^╰─ ↓ 11 more · feature\/minimalist \* ↑2 ↓1/,
    );
  });

  it.each([
    [{ above: "7" }, "↑ 7 more", "↓"],
    [{ below: "11" }, "↓ 11 more", "↑"],
  ] as const)(
    "supports one-sided viewport counts",
    (viewport, present, absent) => {
      const borders = [
        render(80, "draft", viewport)[0],
        render(80, "draft", viewport).at(-1),
      ].join("\n");
      expect(borders).toContain(present);
      expect(borders).not.toContain(`${absent} `);
    },
  );

  it("omits viewport counts atomically when they do not fit", () => {
    const lines = renderMinimalistFrame({
      width: 18,
      editorLines: ["draft"],
      viewport: { above: "123456789", below: "987654321" },
      inputText: "draft",
      metadata: { cwd: "" },
      uiTheme: theme(),
      config: config(),
    });
    expect(lines[0]).not.toContain("more");
    expect(lines.at(-1)).not.toContain("more");
    expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
  });

  it("shows visual shell markers without changing editor text", () => {
    expect(render(80, "  !pwd")[0]).toContain("$ · 12s");
    expect(render(80, "  !!pwd")[0]).toContain("$ · 12s");
    expect(render(80, "draft")[0]).not.toContain("$ · 12s");
    expect(render(80, "  !pwd")[1]).toContain("draft");
  });

  it("shows the explicit session name after the timer and omits it when disabled", () => {
    const enabled = renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp",
        agentDurationMs: 12_000,
        sessionName: "release\nprep",
      },
      uiTheme: theme(),
      config: config(),
    })[0];
    expect(enabled).toContain("12s · release prep");

    const disabled = renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp",
        agentDurationMs: 12_000,
        sessionName: "release prep",
      },
      uiTheme: theme(),
      config: config({
        editorStyles: {
          minimalist: {
            ...defaultConfig.editorStyles.minimalist,
            showSessionName: false,
          },
        },
      }),
    })[0];
    expect(disabled).not.toContain("release prep");
  });

  it("drops a long session name before viewport and operational indicators", () => {
    const top = renderMinimalistFrame({
      width: 34,
      editorLines: ["draft"],
      viewport: { above: "7" },
      inputText: "!pwd",
      metadata: {
        cwd: "/tmp",
        agentDurationMs: 12_000,
        sessionName: "a very long session name that cannot fit",
      },
      uiTheme: theme(),
      config: config(),
    })[0];
    expect(top).toContain("↑ 7 more · $ · 12s");
    expect(top).not.toContain("session");
    expect(visibleWidth(top)).toBeLessThanOrEqual(34);
  });

  it("formats active and completed elapsed durations", () => {
    expect(formatElapsedDuration(-1)).toBe("0s");
    expect(formatElapsedDuration(65_999)).toBe("1m 5s");
    expect(formatElapsedDuration(3_661_000)).toBe("1h 1m");
  });

  it.each([5, 6, 8, 12, 20, 40, 80])(
    "keeps every decorated row within %i columns",
    (width) => {
      const lines = render(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines[0]).toMatch(/^╭.*╮$/);
      expect(lines.at(-1)).toMatch(/^╰.*╯$/);
    },
  );

  it("fits long Git and cwd labels with the shared balanced border rule", () => {
    const lines = renderMinimalistFrame({
      width: 32,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/a/very/long/project/path/that/does/not/fit",
        branch: "feature/a-very-long-branch-name-that-does-not-fit",
        dirty: true,
      },
      uiTheme: theme(),
      config: config(),
    });
    expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(lines.at(-1)).toMatch(/^╰.*╯$/);
    expect(lines.at(-1)).toContain("…");
  });

  it("renders Unicode and ANSI content without overflowing", () => {
    const lines = renderMinimalistFrame({
      width: 18,
      editorLines: ["界 e\u0301 👩‍💻 \x1b[31mred\x1b[0m"],
      inputText: "界",
      metadata: {
        cwd: "/tmp/界-project",
        branch: "feature/👩‍💻-e\u0301-long",
        modelLabel: "模型-👩‍💻",
      },
      uiTheme: theme(),
      config: config(),
    });
    expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
    expect(lines.join("\n")).toContain("界");
  });

  it("renders compact, project-relative, and full minimalist paths", () => {
    const pathLine = (
      pathDisplay: "compact" | "project" | "full",
      projectRoot?: string,
    ) =>
      renderMinimalistFrame({
        width: 80,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: `${homedir()}/workspace/repo/src/lib`, projectRoot },
        uiTheme: theme(),
        config: config({
          editorStyles: {
            minimalist: {
              ...defaultConfig.editorStyles.minimalist,
              pathDisplay,
            },
          },
        }),
      }).at(-1) ?? "";

    expect(pathLine("compact")).toContain("lib");
    expect(pathLine("project", `${homedir()}/workspace/repo`)).toContain(
      "repo/src/lib",
    );
    expect(pathLine("project")).toContain("~/workspace/repo/src/lib");
    expect(pathLine("full")).toContain("~/workspace/repo/src/lib");
  });

  it.each(["compact", "project", "full"] as const)(
    "hides and restores the cwd label without changing other content in %s mode",
    (pathDisplay) => {
      const currentConfig = mergeConfig({
        components: {
          editor: { styles: { minimalist: { pathDisplay } } },
        },
      });
      const options = {
        width: 120,
        editorLines: ["draft"],
        autocompleteLines: ["suggestion"],
        inputText: "draft",
        metadata: {
          cwd: "/workspace/project/cwd-marker",
          projectRoot: "/workspace/project",
          branch: "main",
          dirty: true,
          ahead: 2,
          behind: 1,
          modelLabel: "model-x",
          costLabel: "$1.000",
        },
        uiTheme: theme(),
        config: currentConfig,
      };
      const visible = renderMinimalistFrame(options);
      expect(visible.at(-1)).toContain("cwd-marker");

      currentConfig.components.editor.styles.minimalist.showCwd = false;
      const hidden = renderMinimalistFrame(options);
      expect(hidden.join("\n")).not.toContain("cwd-marker");
      expect(hidden.at(-1)).toContain("main * ↑2 ↓1");
      expect(hidden.at(-1)).toMatch(/^╰.*╯$/);
      // Only the directory label changes; input, completion and top metadata stay intact.
      expect(hidden.slice(0, -1)).toEqual(visible.slice(0, -1));
      expect(hidden.every((line) => visibleWidth(line) <= options.width)).toBe(
        true,
      );
      expect(
        currentConfig.components.editor.styles.minimalist.pathDisplay,
      ).toBe(pathDisplay);

      currentConfig.components.editor.styles.minimalist.showCwd = true;
      expect(renderMinimalistFrame(options)).toEqual(visible);
    },
  );

  it.each([5, 8, 20, 80])(
    "keeps a complete plain bottom border when cwd and Git are hidden at width %i",
    (width) => {
      const lines = renderMinimalistFrame({
        width,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: "/workspace/cwd-marker", branch: "main" },
        uiTheme: theme(),
        config: mergeConfig({
          components: {
            editor: {
              styles: { minimalist: { showCwd: false, showGit: false } },
            },
          },
        }),
      });
      // An absent label must not leave padding, a placeholder, or broken corners.
      expect(lines.at(-1)).toBe(`╰${"─".repeat(width - 2)}╯`);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    },
  );

  it("uses the same cwd visibility setting in the Editor panel preview", () => {
    const currentConfig = mergeConfig({});
    const visible = renderEditorSettingsPreview(currentConfig, theme(), 72);
    expect(visible.at(-1)).toContain("src");
    currentConfig.components.editor.styles.minimalist.showCwd = false;
    const hidden = renderEditorSettingsPreview(currentConfig, theme(), 72);
    expect(hidden.at(-1)).not.toContain("src");
    expect(hidden.slice(0, -1)).toEqual(visible.slice(0, -1));
  });

  it("supports focused visibility controls", () => {
    const lines = renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "/tmp/project",
        branch: "main",
        costLabel: "$1.000",
        agentDurationMs: 5000,
      },
      uiTheme: theme(),
      config: config({
        editorStyles: {
          minimalist: {
            ...defaultConfig.editorStyles.minimalist,
            showTimer: false,
            showCost: false,
            showGit: false,
          },
        },
      }),
    });
    const rendered = lines.join("\n");
    expect(rendered).not.toContain("5s");
    expect(rendered).not.toContain("$1.000");
    expect(rendered).not.toContain("main");
  });

  it("does not render legacy context-usage metadata", () => {
    const legacyMetadata = {
      cwd: "/tmp",
      modelLabel: "model-x",
      contextPercent: 75,
      contextWindow: 372_000,
    } as MinimalistEditorMetadata;
    const output = renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: legacyMetadata,
      uiTheme: theme(),
      config: config(),
    }).join("\n");

    expect(output).toContain("model-x");
    expect(output).not.toContain("75%");
    expect(output).not.toContain("372k");
  });

  it("uses the adaptive border callback when configured", () => {
    const lines = renderMinimalistFrame({
      width: 20,
      editorLines: ["draft"],
      inputText: "!pwd",
      metadata: { cwd: "/tmp" },
      uiTheme: theme(),
      config: config({ editorBorderColorMode: "adaptive" }),
      borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
    });
    expect(lines.join("\n")).toContain("\x1b[36m");
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });

  it("keeps adaptive borders and thinking labels on the same renderer", () => {
    const colors = {
      ...defaultConfig.colors,
      editorBorder: "error",
      editorThinkingHigh: "success",
    };
    const adaptiveConfig = config({
      colors,
      editorBorderColorMode: "adaptive",
    });
    const frame = (uiTheme: Theme, borderColor?: (text: string) => string) =>
      renderMinimalistFrame({
        width: 80,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: "", thinkingLevel: "high" },
        uiTheme,
        config: adaptiveConfig,
        borderColor,
      }).join("\n");

    // 配置了 editorThinkingHigh → 边框与标签都用配置色，优先于原生 borderColor。
    const calls: Array<{ color: string; text: string }> = [];
    const adaptive = frame(
      recordingTheme(calls),
      (text) => `\x1b[36m${text}\x1b[0m`,
    );
    expect(calls).toContainEqual({ color: "success", text: "╭" });
    expect(calls).toContainEqual({ color: "success", text: "high" });
    expect(adaptive).not.toContain("\x1b[36m");

    // 未配置 thinking 色且原生 borderColor 失败 → 回落静态边框色。
    const fallbackCalls: Array<{ color: string; text: string }> = [];
    renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: { cwd: "", thinkingLevel: "high" },
      uiTheme: recordingTheme(fallbackCalls),
      config: config({
        colors: {
          ...defaultConfig.colors,
          editorBorder: "error",
        },
        editorBorderColorMode: "adaptive",
      }),
      borderColor: () => {
        throw new Error("adaptive color failed");
      },
    });
    expect(fallbackCalls).toContainEqual({ color: "error", text: "╭" });
    expect(fallbackCalls).toContainEqual({ color: "error", text: "high" });

    // static：边框用 editorBorder，thinking 标签用 editorThinkingHigh。
    const staticCalls: Array<{ color: string; text: string }> = [];
    renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: { cwd: "", thinkingLevel: "high" },
      uiTheme: recordingTheme(staticCalls),
      config: config({ colors, editorBorderColorMode: "static" }),
      borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
    });
    expect(staticCalls).toContainEqual({ color: "error", text: "╭" });
    expect(staticCalls).toContainEqual({ color: "success", text: "high" });
  });

  it("uses the native effort border when adaptive thinking colors are unconfigured", () => {
    const output = renderMinimalistFrame({
      width: 80,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: { cwd: "", thinkingLevel: "high" },
      uiTheme: theme(),
      config: config({ editorBorderColorMode: "adaptive" }),
      borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
    }).join("\n");
    expect(output).toContain("\x1b[36m╭\x1b[0m");
    expect(output).toContain("\x1b[36mhigh\x1b[0m");
  });

  it.each([
    [{ editorThinkingMax: "#ff00ff" }, "max"],
    [{ editorThinkingXhigh: "#00ffff" }, "xhigh"],
    [{ editorThinking: "#00ff00" }, "low"],
  ] as const)(
    "uses configured adaptive thinking colors for both border and %s label",
    (colors, level) => {
      const output = renderMinimalistFrame({
        width: 80,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: "", thinkingLevel: level },
        uiTheme: theme(),
        config: config({
          colors: { ...defaultConfig.colors, ...colors },
          editorBorderColorMode: "adaptive",
        }),
      }).join("\n");
      const ansi =
        level === "max"
          ? "\u001b[38;2;255;0;255m"
          : level === "xhigh"
            ? "\u001b[38;2;0;255;255m"
            : "\u001b[38;2;0;255;0m";
      expect(output).toContain(`${ansi}╭\x1b[0m`);
      expect(output).toContain(`${ansi}${level}\x1b[0m`);
    },
  );

  it.each([undefined, "", "off"])(
    "keeps adaptive borders on the native effort fallback and omits an inactive thinking level %s",
    (thinkingLevel) => {
      const output = renderMinimalistFrame({
        width: 80,
        editorLines: ["draft"],
        inputText: "draft",
        metadata: { cwd: "", thinkingLevel },
        uiTheme: theme(),
        config: config({ editorBorderColorMode: "adaptive" }),
        borderColor: (text) => `[theme]${text}`,
      }).join("\n");
      // thinking 关闭 → 边框回落原生 borderColor，不渲染标签。
      expect(output).toContain("[theme]╭");
      expect(output).not.toContain("off");
      expect(output).not.toContain("undefined");
    },
  );

  it("colors every separator in the full top-right sequence with the resolved border color", () => {
    const top = renderMinimalistFrame({
      width: 100,
      editorLines: ["draft"],
      inputText: "draft",
      metadata: {
        cwd: "",
        costLabel: "$0.000",
        modelLabel: "gpt-5.6-terra",
        thinkingLevel: "minimal",
      },
      uiTheme: theme(),
      config: config({ editorBorderColorMode: "adaptive" }),
      borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
    })[0];

    expect(top).toContain(
      "$0.000\x1b[36m – \x1b[0mgpt-5.6-terra\x1b[36m – \x1b[0m\x1b[36mminimal\x1b[0m",
    );
    expect(top.match(/\x1b\[36m – \x1b\[0m/g)).toHaveLength(2);
    expect(top).not.toContain("\x1b[36m$0.000");
    expect(top).not.toContain("\x1b[36mgpt-5.6-terra");
  });

  it.each([
    [
      "without cost",
      { cwd: "", modelLabel: "model", thinkingLevel: "low" },
      "model\x1b[36m – \x1b[0m\x1b[36mlow\x1b[0m",
    ],
    [
      "without model",
      { cwd: "", costLabel: "$1", thinkingLevel: "high" },
      "$1\x1b[36m – \x1b[0m\x1b[36mhigh\x1b[0m",
    ],
    [
      "without thinking",
      { cwd: "", costLabel: "$2", modelLabel: "model" },
      "$2\x1b[36m – \x1b[0mmodel",
    ],
  ] satisfies Array<[string, MinimalistEditorMetadata, string]>)(
    "uses the resolved border separator %s",
    (_name, metadata, expected) => {
      const top = renderMinimalistFrame({
        width: 100,
        editorLines: ["draft"],
        inputText: "draft",
        metadata,
        uiTheme: theme(),
        config: config({ editorBorderColorMode: "adaptive" }),
        borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
      })[0];

      expect(top).toContain(expected);
      expect(top).not.toContain("[muted] – ");
    },
  );
});
