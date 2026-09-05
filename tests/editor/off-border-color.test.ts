import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  defaultConfig,
  mergeConfig,
  type PolishedTuiConfig,
} from "../../extensions/app/config/shell.ts";
import {
  offEditorBorderColor,
  WrappedPolishedEditor,
} from "../../extensions/layouts/editor/ui.ts";

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

function config(
  overrides: {
    style?: "on" | "off";
    colorSource?: "theme" | "terminal";
    editorBorder?: string;
  } = {},
): PolishedTuiConfig {
  const merged = mergeConfig({
    components: {
      editor: {
        style: overrides.style ?? defaultConfig.components.editor.style,
        colorSource:
          overrides.colorSource ?? defaultConfig.components.editor.colorSource,
      },
    },
    colors: overrides.editorBorder
      ? { editorBorder: overrides.editorBorder }
      : {},
  });
  return merged;
}

function baseEditor(borderColor?: (text: string) => string) {
  return {
    render: (width: number) => [
      "─".repeat(width),
      "native editor",
      "─".repeat(width),
    ],
    invalidate() {},
    handleInput() {},
    getText: () => "",
    setText() {},
    borderColor,
  };
}

describe("offEditorBorderColor", () => {
  it("returns undefined for the on style", () => {
    expect(
      offEditorBorderColor(config({ style: "on" }), theme()),
    ).toBeUndefined();
  });

  it("returns undefined for off without an explicit editorBorder", () => {
    expect(
      offEditorBorderColor(config({ style: "off" }), theme()),
    ).toBeUndefined();
  });

  it("renders an explicit editorBorder through the theme source", () => {
    const calls: Array<{ color: string; text: string }> = [];
    const recording = {
      ...theme(),
      fg(color: string, text: string) {
        calls.push({ color, text });
        return text;
      },
    } as Theme;
    const renderBorder = offEditorBorderColor(
      config({ style: "off", editorBorder: "accent" }),
      recording,
    );
    expect(renderBorder).toBeTypeOf("function");
    renderBorder?.("╭");
    expect(calls).toContainEqual({ color: "accent", text: "╭" });
  });

  it("renders an explicit editorBorder through the terminal source", () => {
    const renderBorder = offEditorBorderColor(
      config({ style: "off", colorSource: "terminal", editorBorder: "red" }),
      theme(),
    );
    expect(renderBorder).toBeTypeOf("function");
    expect(renderBorder?.("╭")).toContain("\x1b[31m");
  });
});

describe("off-mode border override on the wrapped editor", () => {
  it("applies the configured border color on render and re-applies it after a native overwrite", () => {
    const originalBorder = (text: string) => text;
    let editor = new WrappedPolishedEditor(
      baseEditor(),
      theme(),
      () => config({ style: "off", editorBorder: "accent" }),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    );
    const themeCalls: Array<{ color: string; text: string }> = [];
    const recording = {
      ...theme(),
      fg(color: string, text: string) {
        themeCalls.push({ color, text });
        return text;
      },
    } as Theme;
    editor = new WrappedPolishedEditor(
      baseEditor(originalBorder),
      recording,
      () => config({ style: "off", editorBorder: "accent" }),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    );
    editor.render(80);
    // off + 配置后，render 已将实例 borderColor 替换为主题 accent 渲染函数。
    expect(editor.borderColor).not.toBe(originalBorder);
    // 模拟 Pi 原生 effort 切换重设 borderColor 后，下一次 render 重新覆盖。
    editor.borderColor = originalBorder;
    editor.render(80);
    expect(editor.borderColor).not.toBe(originalBorder);
  });

  it("keeps the native border when off has no explicit editorBorder", () => {
    const originalBorder = (text: string) => text;
    const editor = new WrappedPolishedEditor(
      baseEditor(originalBorder),
      theme(),
      () => config({ style: "off" }),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    );
    editor.render(80);
    expect(editor.borderColor).toBe(originalBorder);
  });

  it("keeps the native border untouched in on mode", () => {
    const originalBorder = (text: string) => text;
    const editor = new WrappedPolishedEditor(
      baseEditor(originalBorder),
      theme(),
      () => config({ style: "on" }),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "on",
      () => ({ cwd: "/tmp" }),
    );
    editor.render(80);
    expect(editor.borderColor).toBe(originalBorder);
  });
});
