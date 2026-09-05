import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import { config } from "../../extensions/app/config/renderer.ts";
import { installToolGrouping } from "../../extensions/layouts/context/renderer/tool/grouping.ts";
import { installToggleRenderCache } from "../../extensions/layouts/context/renderer/tool/toggle-render-cache.ts";

initTheme("dark");

const ui = {
  theme: {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  },
  requestRender() {},
} as any;

function installHooks() {
  const previousMode = config.mode;
  config.mode = "on";
  const hooks = installToggleRenderCache();
  return {
    hooks,
    restore() {
      config.mode = previousMode;
      hooks.shutdown();
    },
  };
}

function renderText(component: any, width = 100): string {
  const plain = (component.render(width) as string[])
    .map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""))
    .join("\n");
  return plain;
}

const BIG_OUTPUT = Array.from(
  { length: 50 },
  (_, i) => `line-${i}: ${"y".repeat(40)} ${i}`,
).join("\n");

function resultOf(text: string) {
  return { content: [{ type: "text", text }], isError: false };
}

test("same result round-trips between expanded/collapsed without rebuilding", () => {
  const { hooks, restore } = installHooks();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let callCalls = 0;
    let resultCalls = 0;
    // 实例遮蔽构造时的 renderer，只统计"重建时 renderer 被调用的次数"。
    t.getCallRenderer = () => {
      callCalls++;
      return (_args: unknown, _theme: unknown, _ctx: unknown) =>
        new Text("call", 0, 0);
    };
    t.getResultRenderer = () => {
      resultCalls++;
      return (_result: unknown, options: any, _theme: unknown, _ctx: unknown) =>
        new Text(
          options?.expanded ? "result-expanded" : "result-collapsed",
          0,
          0,
        );
    };

    expect(t.hasRendererDefinition()).toBe(true);

    // 首次 build：collapsed 槽（renderer 各调用 1 次）。
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(callCalls).toBe(1);
    expect(resultCalls).toBe(1);
    expect(renderText(t)).toContain("result-collapsed");

    // 首次 build：expanded 槽。之后 toggle 全部命中缓存。
    t.setExpanded(true);
    expect(callCalls).toBe(2);
    expect(resultCalls).toBe(2);
    expect(renderText(t)).toContain("result-expanded");

    // 折叠 → 展开 → 折叠：零重建。
    t.setExpanded(false);
    t.setExpanded(true);
    t.setExpanded(false);
    expect(callCalls).toBe(2);
    expect(resultCalls).toBe(2);
    expect(renderText(t)).toContain("result-collapsed");

    // 重复 updateDisplay：args/result 引用未变时跳过重建；变化时重建（保守）。
    const sameArgs = { command: "ls" };
    const argsBefore = t.args;
    t.updateArgs(sameArgs);
    expect(callCalls).toBe(3);
    expect(resultCalls).toBe(3);
    expect(t.args).not.toBe(argsBefore);
    // 同引用重复调用 → 零重建。
    t.updateArgs(sameArgs);
    t.updateArgs(sameArgs);
    expect(callCalls).toBe(3);
    expect(resultCalls).toBe(3);

    // result 变化 → 指纹失效 → 重建（仍然只作用于当前槽）。
    t.setExpanded(false);
    t.updateResult(resultOf("new output"));
    expect(callCalls).toBe(4);
    expect(resultCalls).toBe(4);
    expect(renderText(t)).toContain("result-collapsed");
    t.setExpanded(true);
    expect(callCalls).toBe(5);
    expect(resultCalls).toBe(5);
  } finally {
    restore();
  }
});

test("expanded/collapsed slots keep their own content across toggles", () => {
  const { hooks, restore } = installHooks();
  try {
    const t = new ToolExecutionComponent(
      "read",
      "r1",
      { path: "/tmp/x" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let expandedText = "";
    let collapsedText = "";
    t.getResultRenderer = () => {
      return (
        _result: unknown,
        options: any,
        _theme: unknown,
        _ctx: unknown,
      ) => {
        if (options?.expanded) {
          expandedText = "expanded-card";
          return new Text(expandedText, 0, 0);
        }
        collapsedText = "collapsed-line";
        return new Text(collapsedText, 0, 0);
      };
    };
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(renderText(t)).toContain("collapsed-line");
    t.setExpanded(true);
    expect(renderText(t)).toContain("expanded-card");
    // 来回切换后内容仍是各自槽的（不是最后一个构建的组件）。
    t.setExpanded(false);
    expect(renderText(t)).toContain("collapsed-line");
    t.setExpanded(true);
    expect(renderText(t)).toContain("expanded-card");
  } finally {
    restore();
  }
});

test("off mode bypasses the cache and rebuilds every time", () => {
  const previousMode = config.mode;
  const hooks = installToggleRenderCache();
  try {
    config.mode = "off";
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let resultCalls = 0;
    t.getResultRenderer = () => {
      resultCalls++;
      return () => new Text("result", 0, 0);
    };
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(resultCalls).toBe(1);
    t.setExpanded(true);
    expect(resultCalls).toBe(2);
    t.setExpanded(false);
    expect(resultCalls).toBe(3);
  } finally {
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("fallback branch (no renderer definition) stays correct and skips same-state rebuilds", () => {
  const { hooks, restore } = installHooks();
  try {
    // 非内置工具名 → 无 renderer 定义 → contentText fallback 分支。
    const t = new ToolExecutionComponent(
      "my_custom_tool",
      "c1",
      { arg: 1 },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    expect(t.hasRendererDefinition()).toBe(false);
    const setTextCalls = { count: 0 };
    const originalSetText = t.contentText.setText.bind(t.contentText);
    t.contentText.setText = (text: string) => {
      setTextCalls.count++;
      return originalSetText(text);
    };

    const result = resultOf(BIG_OUTPUT);
    t.updateResult(result);
    expect(setTextCalls.count).toBe(1);
    expect(renderText(t)).toContain("line-0");

    // 同槽重复 updateDisplay（同 result 引用）跳过重建，不重复 setText。
    t.updateResult(result);
    expect(setTextCalls.count).toBe(1);

    // 切槽（例如展开）：fallback 无组件级装载，走原生重建，行为与改造前一致。
    t.setExpanded(true);
    expect(setTextCalls.count).toBe(2);
    expect(renderText(t)).toContain("line-49");
    // 再切回折叠：重建（fallback 槽无组件可装载）。
    t.setExpanded(false);
    expect(setTextCalls.count).toBe(3);
  } finally {
    restore();
  }
});

test("coexists with tool grouping (on mode) and keeps group expand cheap", () => {
  const previousMode = config.mode;
  config.mode = "on";
  const grouping = installToolGrouping(() => config.mode === "on");
  const hooks = installToggleRenderCache();
  try {
    const { Container: ContainerClass } = { ContainerClass: Container };
    void ContainerClass;
    const chat = new Container() as any;
    const t1 = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    t1.updateResult(resultOf(BIG_OUTPUT));
    const t2 = new ToolExecutionComponent(
      "bash",
      "b2",
      { command: "pwd" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    t2.updateResult(resultOf("short"));
    chat.addChild(t1);
    chat.addChild(t2);
    const group = chat.children[0] as any;
    expect(group?.constructor?.name).toBe("ToolGroupComponent");

    // group 展开 → 子工具 setExpanded → updateDisplay（缓存的切换路径）。
    group.setExpanded(true);
    expect(t1.expanded).toBe(true);
    expect(renderText(t1)).toContain("line-0");
    group.setExpanded(false);
    expect(t1.expanded).toBe(false);
    // 再次展开渲染正常，无异常（重建缓存路径不破坏 group 渲染）。
    group.setExpanded(true);
    expect(renderText(t1)).toContain("line-0");
  } finally {
    hooks.shutdown();
    grouping.shutdown();
    config.mode = previousMode;
  }
});

test("dispose restores the prototype method and clears caches", () => {
  const previousMode = config.mode;
  config.mode = "on";
  const prototype = ToolExecutionComponent.prototype as any;
  const originalUpdateDisplay = prototype.updateDisplay;
  const hooks = installToggleRenderCache();
  expect(prototype.updateDisplay).not.toBe(originalUpdateDisplay);
  const t = new ToolExecutionComponent(
    "bash",
    "b1",
    { command: "ls" },
    {},
    undefined,
    ui,
    process.cwd(),
  ) as any;
  let resultCalls = 0;
  t.getResultRenderer = () => {
    resultCalls++;
    return () => new Text("result", 0, 0);
  };
  t.updateResult(resultOf(BIG_OUTPUT));
  hooks.shutdown();
  expect(prototype.updateDisplay).toBe(originalUpdateDisplay);
  // shutdown 后不再拦截：再次 updateDisplay 走原生重建。
  const before = resultCalls;
  t.updateResult(resultOf(BIG_OUTPUT));
  expect(resultCalls).toBe(before + 1);
  config.mode = previousMode;
});

test("reinstall replaces the previous patch without breaking the chain", () => {
  const previousMode = config.mode;
  config.mode = "on";
  const prototype = ToolExecutionComponent.prototype as any;
  const hooks1 = installToggleRenderCache();
  const hooks2 = installToggleRenderCache();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(renderText(t)).toContain("line-49");
    // 旧 hooks 的 shutdown 不再影响新链。
    hooks1.shutdown();
    t.setExpanded(true);
    expect(renderText(t)).toContain("line-49");
    hooks2.shutdown();
  } finally {
    config.mode = previousMode;
  }
});

test("theme change invalidates the cache through setTheme", () => {
  const { hooks, restore } = installHooks();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let resultCalls = 0;
    t.getResultRenderer = () => {
      resultCalls++;
      return () => new Text("result", 0, 0);
    };
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(resultCalls).toBe(1);
    // 主题对象变化 → setTheme → 指纹失效 → 下次 updateDisplay 重建。
    hooks.setTheme({ fg: () => "x" });
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(resultCalls).toBe(2);
  } finally {
    restore();
  }
});
test("coexists with compact mode (tools keep updating and toggling)", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installToggleRenderCache();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let resultCalls = 0;
    t.getResultRenderer = () => {
      resultCalls++;
      return (_result: unknown, options: any, _theme: unknown, _ctx: unknown) =>
        new Text(options?.expanded ? "c-expanded" : "c-collapsed", 0, 0);
    };
    t.updateResult(resultOf(BIG_OUTPUT));
    expect(resultCalls).toBe(1);
    // compact 模式下同样享受同槽跳过与跨 toggle 复用。
    t.setExpanded(true);
    expect(resultCalls).toBe(2);
    t.setExpanded(false);
    t.setExpanded(true);
    t.setExpanded(false);
    expect(resultCalls).toBe(2);
    expect(renderText(t)).toContain("c-collapsed");
    // 结果更新后重建，渲染仍正常。
    t.updateResult(resultOf("updated"));
    expect(resultCalls).toBe(3);
  } finally {
    hooks.shutdown();
    config.mode = previousMode;
  }
});

test("pending streaming expand toggles without failing animation scheduling", () => {
  const { hooks, restore } = installHooks();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "ls" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    let resultCalls = 0;
    t.getResultRenderer = () => {
      resultCalls++;
      return (_result: unknown, options: any, _theme: unknown, _ctx: unknown) =>
        new Text(options?.expanded ? "p-expanded" : "p-collapsed", 0, 0);
    };
    // 流式 delta：isPartial=true 的 result。
    t.updateResult(
      { content: [{ type: "text", text: "partial stream" }], isError: false },
      true,
    );
    expect(resultCalls).toBe(1);
    // 流式中展开 → 切槽 + 动画调度（不抛错、渲染正常）。
    t.setExpanded(true);
    expect(resultCalls).toBe(2);
    expect(renderText(t)).toContain("p-expanded");
    t.setExpanded(false);
    expect(resultCalls).toBe(2);
    // 新的流式 delta → 重建当前槽。
    t.updateResult(
      { content: [{ type: "text", text: "more stream" }], isError: false },
      true,
    );
    expect(resultCalls).toBe(3);
    expect(renderText(t)).toContain("p-collapsed");
  } finally {
    restore();
  }
});

test("expanded/collapsed slots keep independent renderer instances (no cross-slot pollution)", () => {
  const { hooks, restore } = installHooks();
  try {
    const t = new ToolExecutionComponent(
      "bash",
      "b1",
      { command: "x" },
      {},
      undefined,
      ui,
      process.cwd(),
    ) as any;
    t.updateResult(resultOf(BIG_OUTPUT));
    // 真实 bash renderer：renderResult 通过 lastComponent 复用组件实例。
    // 缓存必须保证两个槽各自持有独立实例，否则后建槽会把另一槽内容覆盖。
    t.setExpanded(true);
    const expandedLn = t.resultRendererComponent;
    t.setExpanded(false);
    const collapsedLn = t.resultRendererComponent;
    expect(collapsedLn).not.toBe(expandedLn);
    t.setExpanded(true);
    expect(t.resultRendererComponent).toBe(expandedLn);
    // 展开内容保持全文 Text（渲染后建立行缓存），折叠内容保持预览渲染闭包。
    t.render(100);
    expect(expandedLn.children[0]?.constructor?.name).toBe("Text");
    expect(expandedLn.children[0]?.cachedWidth).toBeDefined();
    expect(collapsedLn.children[0]?.render).toBeTypeOf("function");
    expect(collapsedLn.children[0]?.constructor?.name).not.toBe("Text");
  } finally {
    restore();
  }
});
