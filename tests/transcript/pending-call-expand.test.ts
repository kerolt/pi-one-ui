import {
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import { config } from "../../extensions/app/config/renderer.ts";
import { installDefaultMode } from "../../extensions/layouts/transcript/renderer/default-mode.ts";
import { WriteExecutionMetadataStore } from "../../extensions/layouts/transcript/renderer/tool/diff/index.ts";
import {
  installToolGrouping,
  ToolGroupComponent,
} from "../../extensions/layouts/transcript/renderer/tool/grouping.ts";
import { toolCallSummary } from "../../extensions/layouts/transcript/renderer/tool/names.ts";

initTheme("dark");

const ui = {
  theme: {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  },
  requestRender() {},
} as any;

const LONG_COMMAND =
  "npm run build --filter=web --output-dir=dist --minify --sourcemap --target=es2022 --no-cache";

function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderLines(component: any, width = 100): string[] {
  return (component.render(width) as string[]).map(stripAnsi);
}

function visibleLines(component: any, width = 100): string[] {
  return renderLines(component, width).filter((line) => line.trim());
}

function install() {
  const previousMode = config.mode;
  config.mode = "on";
  const hooks = installDefaultMode(new WriteExecutionMetadataStore());
  return {
    restore() {
      config.mode = previousMode;
      hooks.shutdown();
    },
  };
}

function pendingBash(command: string, id = "pending-bash"): any {
  const component = new ToolExecutionComponent(
    "bash",
    id,
    { command },
    {},
    undefined,
    ui,
    process.cwd(),
  ) as any;
  component.markExecutionStarted();
  return component;
}

test("toolCallSummary keeps the full input and line breaks for fullInput", () => {
  const long = "x".repeat(config.toolInputNameLength + 50);
  expect(toolCallSummary("bash", { command: long }).main).toContain("…");
  expect(
    toolCallSummary("bash", { command: long }, { fullInput: true }).main,
  ).toBe(`Bash ${long}`);
  expect(
    toolCallSummary("bash", { command: "a\nb" }, { fullInput: true }).main,
  ).toBe("Bash a\nb");
});

test("collapsed pending command keeps the single truncated title line", () => {
  const { restore } = install();
  try {
    const lines = visibleLines(pendingBash(LONG_COMMAND));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Bash npm run build");
    expect(lines[0]).toContain("…");
    expect(lines[0]).not.toContain(LONG_COMMAND);
  } finally {
    restore();
  }
});

test("expanded pending card shows the complete command across wrapped lines", () => {
  const { restore } = install();
  try {
    const component = pendingBash(LONG_COMMAND);
    component.setExpanded(true);
    component.updateResult({ content: [], isError: false }, true);
    const lines = visibleLines(component);
    expect(lines[0]).toContain("Bash npm run build");
    expect(lines.at(-1)).toContain("↳ Pending…");
    const title = lines.slice(0, -1);
    expect(title.length).toBeGreaterThan(1);
    const flattened = title.join(" ").replace(/\s+/g, " ");
    expect(flattened).toContain(LONG_COMMAND);
    expect(title.join("\n")).not.toContain("…");
    // 续行对齐命令起始列：图标列 + 空格
    expect(title[1].startsWith("  ")).toBe(true);
  } finally {
    restore();
  }
});

test("expanded pending card preserves embedded command line breaks", () => {
  const { restore } = install();
  try {
    const component = pendingBash("echo one\necho two", "multiline-bash");
    component.setExpanded(true);
    const lines = visibleLines(component);
    expect(lines[0]).toContain("echo one");
    expect(lines[1]?.trim()).toBe("echo two");
  } finally {
    restore();
  }
});

test("expanded settled card keeps the truncated title and shows full input", () => {
  const { restore } = install();
  try {
    const component = pendingBash(LONG_COMMAND, "settled-bash");
    component.setExpanded(true);
    component.updateResult({
      content: [{ type: "text", text: "done" }],
      isError: false,
    });
    const lines = visibleLines(component);
    const title = lines[0];
    expect(title).toContain("…");
    expect(title).not.toContain(LONG_COMMAND);
    const body = lines.join("\n");
    expect(body).toContain("npm run build --filter=web");
    expect(body).toContain("--target=es2022 --no-cache");
  } finally {
    restore();
  }
});

test("expanded group card shows the complete command of its pending child", () => {
  const previousMode = config.mode;
  config.mode = "on";
  const defaultHooks = installDefaultMode(new WriteExecutionMetadataStore());
  const grouping = installToolGrouping(() => true);
  grouping.setTheme({ fg: (_color, text) => text, bg: (_color, text) => text });
  try {
    const parent = new Container() as any;
    parent.addChild(pendingBash("echo first", "group-first"));
    parent.addChild(pendingBash(LONG_COMMAND, "group-second"));
    const group = parent.children[0] as ToolGroupComponent;
    expect(group).toBeInstanceOf(ToolGroupComponent);
    group.setExpanded(true);
    const lines = (group.render(100) as string[])
      .map(stripAnsi)
      .filter((line) => line.trim());
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain(LONG_COMMAND);
  } finally {
    config.mode = previousMode;
    grouping.shutdown();
    defaultHooks.shutdown();
  }
});
