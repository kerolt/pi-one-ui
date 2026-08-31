import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import {
  config,
  formatConfigStatus,
  normalizeConfig,
} from "../../extensions/app/config/renderer.ts";
import {
  buildMessageSummary,
  installCompactMode,
  isCompactAssistantComponent,
  refreshCompactModeComponents,
  styleCompactThinkingText,
} from "../../extensions/layouts/context/renderer/compact-mode.ts";
import { refreshMountedContext } from "../../extensions/layouts/context/renderer/context-refresh.ts";
import claudeCodeStyleExtension from "../../extensions/layouts/context/renderer/index.ts";
import { WriteExecutionMetadataStore } from "../../extensions/layouts/context/renderer/tool/diff/write-execution.ts";
import {
  getMessageDisplayTheme,
  setMessageDisplayTheme,
} from "../../extensions/layouts/context/renderer/tool/message-display.ts";
import { toolCallSummary } from "../../extensions/layouts/context/renderer/tool/names.ts";
import {
  invalidateIoView,
  isExpandedToolIoView,
} from "../../extensions/layouts/context/renderer/tool/result.ts";
import { installCompactThinking } from "../../extensions/layouts/context/thinking/compact-thinking.ts";

initTheme("dark");

const ui = {
  theme: {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  },
  requestRender() {},
} as any;

function tool(name: string, id: string, args: any = {}) {
  return new ToolExecutionComponent(
    name,
    id,
    args,
    {},
    undefined,
    ui,
    process.cwd(),
  ) as any;
}

const renderText = (component: any, width = 120): string[] =>
  component
    .render(width)
    .map((line: string) =>
      line
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "")
        .trim(),
    )
    .filter((line: string) => line);

/** 扩展运行时样板：pi mock + tui ctx + 事件 emit。 */
function extensionRuntime() {
  const events = new Map<string, Function[]>();
  const pi: any = {
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(name: string, handler: Function) {
      const list = events.get(name) ?? [];
      list.push(handler);
      events.set(name, list);
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => [], getEntries: () => [] },
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
        italic: (text: string) => text,
        bold: (text: string) => text,
      },
      setStatus() {},
      requestRender() {},
      setWidget() {},
    },
  };
  return {
    pi,
    ctx,
    emit: async (name: string, event: any, context: any = ctx) => {
      for (const handler of events.get(name) ?? [])
        await handler(event, context);
    },
  };
}

/** 安装 compact 补丁并把全局 mode 设为 compact；restore 恢复原模式并卸载。 */
function installHooks() {
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  return {
    hooks,
    restore() {
      config.mode = previousMode;
      hooks.shutdown();
    },
  };
}

function toolCallMessage(timestamp: number, name = "bash") {
  return {
    role: "assistant",
    timestamp,
    content: [{ type: "toolCall", name, arguments: { command: "echo" } }],
  } as unknown as AssistantMessage;
}

test("buildMessageSummary: duration first, read dedup by path, counts, first-seen order, edit/write excluded", () => {
  const query = {
    getMessageThinkingDurationMs: (timestamp: number) =>
      timestamp === 1 ? 8500 : undefined,
  };
  const message = {
    timestamp: 1,
    content: [
      { type: "toolCall", id: "r1", name: "read", arguments: { path: "a.ts" } },
      { type: "toolCall", id: "r2", name: "read", arguments: { path: "a.ts" } },
      { type: "toolCall", id: "r3", name: "read", arguments: { path: "b.ts" } },
      {
        type: "toolCall",
        id: "b1",
        name: "bash",
        arguments: { command: "echo" },
      },
      { type: "toolCall", id: "e1", name: "edit", arguments: {} },
      { type: "toolCall", id: "w1", name: "write", arguments: {} },
      { type: "toolCall", id: "g1", name: "grep", arguments: { pattern: "x" } },
    ],
  };
  expect(buildMessageSummary(message, query)).toBe(
    "Ran for 9s, read×2, bash×1, grep×1",
  );
  expect(
    buildMessageSummary(message, {
      getMessageThinkingDurationMs: () => 8500,
      isMessageThinkingActive: () => true,
    }),
  ).toBe("Running... · 9s, read×2, bash×1, grep×1");
  // 显式挂钟覆盖 thinking query
  expect(buildMessageSummary(message, query, 15_000)).toBe(
    "Ran for 15s, read×2, bash×1, grep×1",
  );
  // 新 message 独立：计数不跨消息累积；无时长无工具时为空串。
  expect(buildMessageSummary({ timestamp: 2, content: [] }, query)).toBe("");
  expect(
    buildMessageSummary(
      { timestamp: 3, content: [] },
      { getMessageThinkingDurationMs: () => undefined },
    ),
  ).toBe("");
  expect(
    buildMessageSummary(
      {
        timestamp: 3,
        content: [{ type: "toolCall", name: "bash", arguments: {} }],
      },
      query,
    ),
  ).toBe("bash×1");
  // read 空路径不按路径去重（计入计数）。
  expect(
    buildMessageSummary(
      {
        timestamp: 4,
        content: [{ type: "toolCall", name: "read", arguments: {} }],
      },
      query,
    ),
  ).toBe("read×1");
  expect(
    buildMessageSummary(
      {
        timestamp: 5,
        content: [{ type: "toolCall", name: "bad\x1b]8;;https://x\x07tool" }],
      },
      query,
    ),
  ).not.toMatch(/[\x1b\x07]/);
});

test("config normalize keeps canonical renderer modes and defaults", () => {
  expect(normalizeConfig({ mode: "compact" }).mode).toBe("compact");
  expect(normalizeConfig({ mode: "off" }).mode).toBe("off");
  expect(normalizeConfig({}).mode).toBe("on");
  expect(normalizeConfig({ enabled: false }).mode).toBe("on");
  expect(normalizeConfig({ mode: "legacy" }).mode).toBe("on");
  expect(normalizeConfig({}).writeDiffCollapsedLines).toBe(0);
  expect(
    normalizeConfig({ writeDiffCollapsedLines: 0 }).writeDiffCollapsedLines,
  ).toBe(0);
  expect(normalizeConfig({}).dimThinkingText).toBe(false);
  expect(normalizeConfig({ dimThinkingText: true }).dimThinkingText).toBe(true);
  expect(formatConfigStatus(normalizeConfig({}))).toMatch(/thinkingDim=off/);
  expect(normalizeConfig({}).toolInputNameLength).toBe(100);
  expect(normalizeConfig({ toolInputNameLength: 40 }).toolInputNameLength).toBe(
    40,
  );
  expect(formatConfigStatus(normalizeConfig({}))).toMatch(/toolInputName=100/);
});

test("tool input name length clips single and grouped summaries", () => {
  const previous = config.toolInputNameLength;
  const path = `src/${"a".repeat(80)}.ts`;
  const clipped = `${path.slice(0, 19)}…`;
  try {
    config.toolInputNameLength = 20;
    expect(toolCallSummary("read", { path }).main).toBe(`Read ${clipped}`);
    expect(
      toolCallSummary("read", { path }, { variant: "grouping" }).main,
    ).toBe(`Read ${clipped}`);
  } finally {
    config.toolInputNameLength = previous;
  }
});

test("dim thinking text uses the dim token without mutating the theme", () => {
  const theme = { fg: (color: string, text: string) => `<${color}>${text}` };
  const previous = config.dimThinkingText;
  try {
    config.dimThinkingText = false;
    expect(styleCompactThinkingText("hi", theme as any)).toBe(
      "<thinkingText>hi",
    );
    config.dimThinkingText = true;
    expect(styleCompactThinkingText("hi", theme as any)).toBe("<dim>hi");
  } finally {
    config.dimThinkingText = previous;
  }
});

test("compact collapses tool-calling assistant to one line; native render outside compact", () => {
  const { restore } = installHooks();
  try {
    const msg = toolCallMessage(1);
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    const collapsed = renderText(assistant);
    expect(
      collapsed.length,
      "tool-calling assistant collapses to a single line",
    ).toBe(1);
    expect(collapsed[0]).toMatch(/^Running\.\.\.(?: · \d+ms)?, bash×1/);
    expect(collapsed[0]).toMatch(/click to show more/);
    const narrow = assistant.render(30);
    expect(narrow[0], "compact summary keeps one leading blank row").toBe("");
    expect(
      narrow.filter((line: string) => line.trim()).length,
      "compact summary never wraps",
    ).toBe(1);
    expect(
      narrow.every((line: string) => visibleWidth(line) <= 30),
    ).toBeTruthy();

    // 普通工具折叠时不显示独立行（摘要行已统计）。
    const read = tool("read", "r1", { path: "a.ts" });
    read.updateResult({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    expect(renderText(read)).toStrictEqual([]);

    // 无 toolCall 的 final assistant 走原生渲染。
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "task done" }],
    } as unknown as AssistantMessage;
    const final = new AssistantMessageComponent(finalMessage, true) as any;
    final.updateContent(finalMessage);
    expect(renderText(final).join("\n")).toMatch(/task done/);

    // 切 on：assistant 与 tool 都走原生。
    config.mode = "on";
    assistant.updateContent(msg);
    expect(
      !renderText(assistant).some((line) => /Running\.\.\., bash×1/.test(line)),
    ).toBeTruthy();
    expect(
      renderText(read).length > 0,
      "tool renders natively in on mode",
    ).toBeTruthy();

    // 切 off：同样原生。
    config.mode = "off";
    assistant.updateContent(msg);
    expect(
      !renderText(assistant).some((line) => /Running\.\.\., bash×1/.test(line)),
    ).toBeTruthy();
    expect(
      renderText(read).length > 0,
      "tool renders natively in off mode",
    ).toBeTruthy();
  } finally {
    restore();
  }
});

test("consecutive tool-call messages accumulate into one round until the next visible assistant text", () => {
  const previousMode = config.mode;
  const previousTheme = getMessageDisplayTheme();
  config.mode = "compact";
  const durations = new Map([
    [1, 400],
    [2, 500],
    [3, 600],
    [4, 3000],
  ]);
  let activeTimestamp: number | undefined;
  let animationFrame = 0;
  const hooks = installCompactMode({
    query: {
      getMessageThinkingDurationMs: (timestamp) => durations.get(timestamp),
      isMessageThinkingActive: (timestamp) => timestamp === activeTimestamp,
      getThinkingAnimationFrame: () => animationFrame,
    },
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    const message1 = {
      role: "assistant",
      timestamp: 1,
      content: [
        { type: "thinking", thinking: "first" },
        {
          type: "toolCall",
          id: "b1",
          name: "bash",
          arguments: { command: "one" },
        },
      ],
    };
    const message2 = {
      role: "assistant",
      timestamp: 2,
      content: [
        { type: "thinking", thinking: "second" },
        {
          type: "toolCall",
          id: "f1",
          name: "fffind",
          arguments: { pattern: "x" },
        },
      ],
    };
    const message3 = {
      role: "assistant",
      timestamp: 3,
      content: [
        { type: "thinking", thinking: "third" },
        {
          type: "toolCall",
          id: "r1",
          name: "read",
          arguments: { path: "a.ts" },
        },
        {
          type: "toolCall",
          id: "r2",
          name: "read",
          arguments: { path: "a.ts" },
        },
        {
          type: "toolCall",
          id: "b2",
          name: "bash",
          arguments: { command: "two" },
        },
      ],
    };
    const assistant1 = new AssistantMessageComponent(
      message1 as any,
      true,
    ) as any;
    assistant1.updateContent(message1);
    activeTimestamp = 2;
    const message2Thinking = {
      role: "assistant",
      timestamp: 2,
      content: [{ type: "thinking", thinking: "second" }],
    };
    const assistant2 = new AssistantMessageComponent(
      message2Thinking as any,
      true,
    ) as any;
    assistant2.updateContent(message2Thinking as any);
    expect(renderText(assistant1).join("\n")).toMatch(
      /^Running\.\.\. · 900ms, bash×1/,
    );
    expect(renderText(assistant1).join("\n")).not.toMatch(/Ran for/);
    animationFrame = 1;
    expect(renderText(assistant1).join("\n")).toMatch(
      /^Running\.\.\. · 900ms, bash×1/,
    );

    activeTimestamp = undefined;
    assistant2.updateContent(message2);
    const assistant3 = new AssistantMessageComponent(
      message3 as any,
      true,
    ) as any;
    assistant3.updateContent(message3);

    expect(renderText(assistant2)).toStrictEqual([]);
    expect(renderText(assistant3)).toStrictEqual([]);
    expect(renderText(assistant1).join("\n")).toMatch(
      /^Running\.\.\. · 2s, bash×2, fffind×1, read×1/,
    );

    const bash = tool("bash", "b1", { command: "one" });
    const longOutput = Array.from(
      { length: 500 },
      (_, index) => `tool output ${index}`,
    ).join("\n");
    bash.updateResult({
      content: [{ type: "text", text: longOutput }],
      isError: false,
    });
    bash.setExpanded(true);
    expect(
      bash.expanded,
      "precondition: child can be expanded before its round",
    ).toBe(true);
    const edit = tool("edit", "e1", { path: "a.ts" });
    edit.updateResult({ content: [], isError: false });
    const backgroundSlots: string[] = [];
    const cardTheme = Object.assign(Object.create(previousTheme ?? null), {
      fg: previousTheme?.fg ?? ((_color: string, text: string) => text),
      bg(slot: string, text: string) {
        backgroundSlots.push(slot);
        return text;
      },
    });
    setMessageDisplayTheme(cardTheme);
    assistant1.setExpanded(true);
    expect(bash.expanded, "round children default to collapsed").toBe(false);
    bash.setExpanded(true);
    expect(
      bash.expanded,
      "global expansion cannot recursively expand round children",
    ).toBe(false);
    expect(edit.expanded, "edit/write keep independent expansion state").toBe(
      false,
    );
    const cardLines = assistant1.render(80);
    expect(renderText(assistant1).join("\n")).toMatch(/495 earlier lines/);
    expect(
      cardLines.length < 30,
      "collapsed children cap long output inside the round card",
    ).toBeTruthy();
    expect(cardLines[0], "expanded round keeps the normal card spacer").toBe(
      "",
    );
    expect(
      cardLines.slice(1).every((line: string) => visibleWidth(line) === 80),
      "expanded round is wrapped by one width-safe tool card",
    ).toBeTruthy();
    expect([...new Set(backgroundSlots)]).toStrictEqual(["userMessageBg"]);
    setMessageDisplayTheme(previousTheme);
    expect(
      renderText(bash),
      "round tools render only inside the summary card",
    ).toStrictEqual([]);
    assistant1.setExpanded(false);
    expect(
      bash.expanded,
      "collapsing the round keeps its children collapsed",
    ).toBe(false);

    const finalMessage = {
      role: "assistant",
      timestamp: 4,
      content: [
        { type: "thinking", thinking: "final thought" },
        { type: "text", text: "final answer" },
      ],
    };
    activeTimestamp = 4;
    const finalThinking = {
      role: "assistant",
      timestamp: 4,
      content: [{ type: "thinking", thinking: "final thought" }],
    };
    const final = new AssistantMessageComponent(
      finalThinking as any,
      true,
    ) as any;
    final.updateContent(finalThinking as any);
    expect(renderText(assistant1).join("\n")).toMatch(
      /^Running\.\.\. · 5s, bash×2/,
    );

    activeTimestamp = undefined;
    final.updateContent(finalMessage);
    expect(renderText(assistant1).join("\n")).toMatch(/^Ran for 5s, bash×2/);
    expect(renderText(final).join("\n")).toMatch(/final answer/);
    expect(renderText(final).join("\n")).not.toMatch(/Thought|final thought/);

    const nextMessage = {
      role: "assistant",
      timestamp: 5,
      content: [
        { type: "text", text: "next round" },
        {
          type: "toolCall",
          id: "g1",
          name: "grep",
          arguments: { pattern: "x" },
        },
      ],
    };
    const next = new AssistantMessageComponent(nextMessage as any, true) as any;
    next.updateContent(nextMessage);
    const nextLines = renderText(next).join("\n");
    expect(nextLines).toMatch(/next round/);
    expect(nextLines).toMatch(/Running\.\.\.(?: · \d+ms)?, grep×1/);
    expect(nextLines).not.toMatch(/bash×2/);
    expect(renderText(assistant1).join("\n")).toMatch(/^Ran for 5s, bash×2/);
  } finally {
    setMessageDisplayTheme(previousTheme);
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("expanded running round keeps thinking and tools in transcript order", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-compact-order-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const previousMode = config.mode;
  config.mode = "compact";
  const { pi, ctx, emit } = extensionRuntime();
  installCompactThinking(pi, {
    useSummaryTitlesAsThinkingTitle: false,
    previewLines: 3,
    animationIntervalMs: 30,
  });
  emit("session_start", {}, ctx);
  const hooks = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    const message1 = {
      role: "assistant",
      timestamp: 1,
      content: [
        { type: "thinking", thinking: "plan-one" },
        {
          type: "toolCall",
          id: "b1",
          name: "bash",
          arguments: { command: "echo-one" },
        },
      ],
    };
    const message2 = {
      role: "assistant",
      timestamp: 2,
      content: [
        { type: "thinking", thinking: "plan-two" },
        {
          type: "toolCall",
          id: "g1",
          name: "grep",
          arguments: { pattern: "needle" },
        },
      ],
    };
    const assistant1 = new AssistantMessageComponent(
      message1 as any,
      true,
    ) as any;
    assistant1.updateContent(message1);
    const assistant2 = new AssistantMessageComponent(
      message2 as any,
      true,
    ) as any;
    assistant2.updateContent(message2);
    const bash = tool("bash", "b1", { command: "echo-one" });
    bash.updateResult({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    const grep = tool("grep", "g1", { pattern: "needle" });
    grep.updateResult({
      content: [{ type: "text", text: "hit" }],
      isError: false,
    });
    assistant1.setExpanded(true);
    const text = renderText(assistant1).join("\n");
    const planOne = text.indexOf("plan-one");
    const echoOne = text.indexOf("echo-one");
    const planTwo = text.indexOf("plan-two");
    const needle = text.indexOf("needle");
    expect(
      planOne >= 0 && echoOne >= 0 && planTwo >= 0 && needle >= 0,
      text,
    ).toBeTruthy();
    expect(
      planOne < echoOne,
      `thinking 1 must precede its tool, got: ${text}`,
    ).toBeTruthy();
    expect(
      echoOne < planTwo,
      `tool 1 must precede thinking 2, got: ${text}`,
    ).toBeTruthy();
    expect(
      planTwo < needle,
      `thinking 2 must precede its tool, got: ${text}`,
    ).toBeTruthy();
  } finally {
    hooks.shutdown();
    config.mode = previousMode;
    emit("session_shutdown", {}, ctx);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Running duration recomputes on each render via round wall clock", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installCompactMode({
    query: {
      getMessageThinkingDurationMs: () => undefined,
      isMessageThinkingActive: () => false,
      getThinkingAnimationFrame: () => 0,
    },
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const msg = {
      role: "assistant",
      timestamp: 1,
      content: [
        {
          type: "toolCall",
          id: "b1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
    } as unknown as AssistantMessage;
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    expect(renderText(assistant).join("\n")).toMatch(/Running\.\.\./);

    now += 1100;
    expect(renderText(assistant).join("\n")).toMatch(
      /Running\.\.\. · [1-9]\d*s, bash×1/,
    );
  } finally {
    Date.now = realNow;
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("compact folds Agent/Task tools always; no pending outer flash", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installCompactMode({
    query: {
      getMessageThinkingDurationMs: () => 1000,
      isMessageThinkingActive: () => false,
    },
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    const msg = {
      role: "assistant",
      timestamp: 1,
      content: [
        {
          type: "toolCall",
          id: "b1",
          name: "bash",
          arguments: { command: "ls" },
        },
        {
          type: "toolCall",
          id: "a1",
          name: "Agent",
          arguments: { description: "review" },
        },
        {
          type: "toolCall",
          id: "t1",
          name: "TaskCreate",
          arguments: { subject: "fix" },
        },
        {
          type: "toolCall",
          id: "e1",
          name: "TaskExecute",
          arguments: { task_ids: ["1"] },
        },
      ],
    } as unknown as AssistantMessage;
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    const bash = tool("bash", "b1", { command: "ls" });
    const agent = tool("Agent", "a1", { description: "review" });
    const task = tool("TaskCreate", "t1", { subject: "fix" });
    const exec = tool("TaskExecute", "e1", { task_ids: ["1"] });

    // pending 即折叠：禁止先外置再收回（会抖）
    expect(renderText(bash)).toStrictEqual([]);
    expect(renderText(agent), "pending Agent folds").toStrictEqual([]);
    expect(renderText(task), "pending TaskCreate folds").toStrictEqual([]);
    expect(renderText(exec), "pending TaskExecute folds").toStrictEqual([]);
    expect(renderText(assistant).join("\n")).toMatch(/Agent×1/);
    expect(renderText(assistant).join("\n")).toMatch(/TaskCreate×1/);
    expect(renderText(assistant).join("\n")).toMatch(/TaskExecute×1/);

    // 完成后仍折叠进摘要
    agent.updateResult({
      content: [{ type: "text", text: "done" }],
      isError: false,
    });
    task.updateResult({
      content: [{ type: "text", text: "Task #1 created successfully: fix" }],
      isError: false,
    });
    exec.updateResult({
      content: [{ type: "text", text: "Launched 1 agent(s)" }],
      isError: false,
    });
    expect(renderText(agent)).toStrictEqual([]);
    expect(renderText(task)).toStrictEqual([]);
    expect(renderText(exec)).toStrictEqual([]);

    // background Agent tool 卡也折叠；live 面板不走此路径
    const bg = tool("Agent", "a2", {
      description: "bg",
      run_in_background: true,
    });
    bg.updateResult({
      content: [
        {
          type: "text",
          text: "Agent started in background.\nAgent ID: abc-123",
        },
      ],
      isError: false,
    });
    expect(renderText(bg), "background Agent tool card folds").toStrictEqual(
      [],
    );
  } finally {
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("compact layouts abort outside folded tools", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installCompactMode({
    query: {
      getMessageThinkingDurationMs: () => 2000,
      isMessageThinkingActive: () => false,
    },
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    const msg = {
      role: "assistant",
      timestamp: 1,
      stopReason: "aborted",
      errorMessage: "Operation aborted",
      content: [
        {
          type: "toolCall",
          id: "b1",
          name: "bash",
          arguments: { command: "sleep" },
        },
      ],
    } as unknown as AssistantMessage;
    const assistant = new AssistantMessageComponent(msg, true) as any;
    const bash = tool("bash", "b1", { command: "sleep" });
    bash.updateResult({
      content: [{ type: "text", text: "Operation aborted" }],
      isError: true,
    });
    assistant.updateContent(msg);

    const lines = renderText(assistant);
    expect(
      lines.some(
        (line) => /Ran for |Running\.\.\./.test(line) && /bash×1/.test(line),
      ),
      `summary present, got: ${JSON.stringify(lines)}`,
    ).toBeTruthy();
    expect(
      lines.some((line) => line === "Operation aborted"),
      `abort must be outermost, got: ${JSON.stringify(lines)}`,
    ).toBeTruthy();
    expect(renderText(bash), "aborted tool stays folded").toStrictEqual([]);

    // length / error 同样外露
    const lenMsg = {
      ...msg,
      stopReason: "length",
      errorMessage: undefined,
    };
    assistant.updateContent(lenMsg as any);
    expect(
      renderText(assistant).some((line) =>
        /truncated before completion/.test(line),
      ),
    ).toBeTruthy();
  } finally {
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("compact edit/write keeps the stats header and inherits on-mode diff limits", () => {
  const metadata = new WriteExecutionMetadataStore();
  const previousMode = config.mode;
  const previousTheme = getMessageDisplayTheme();
  const previousWriteCollapsed = config.writeDiffCollapsedLines;
  config.mode = "compact";
  const hooks = installCompactMode({ writeMetadata: metadata });
  try {
    const edit = tool("edit", "e1", { path: "a.ts" });
    edit.updateResult({
      content: [],
      details: {
        diff: "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
      isError: false,
    });
    expect(
      edit.render(120)[0],
      "compact file rows keep one leading blank row",
    ).toBe("");
    const collapsedRich = edit.resultRendererComponent;
    edit.render(120);
    expect(
      edit.resultRendererComponent,
      "collapsed rich diff is reused across frames",
    ).toBe(collapsedRich);
    const collapsed = renderText(edit).join("\n");
    expect(collapsed).toMatch(/edit a\.ts \(\+1 -1\)/);
    expect(
      collapsed,
      "collapsed compact edit inherits the on-mode preview",
    ).toMatch(/old/);
    expect(collapsed).toMatch(/new/);
    expect(collapsed).not.toMatch(/Input|Output|Details:/);

    setMessageDisplayTheme({
      fg: (color: string, text: string) =>
        color === "success" || color === "error"
          ? `<${color}>${text}</${color}>`
          : text,
    } as any);
    const coloredStats = edit.render(120).join("\n");
    expect(coloredStats).toMatch(/<success>\+1<\/success>/);
    expect(coloredStats).toMatch(/<error>-1<\/error>/);
    setMessageDisplayTheme(previousTheme);

    // expanded：保留标题/统计行，并复用 mode=on 的 rich diff 和展开卡背景。
    const backgroundSlots: string[] = [];
    const cardTheme = Object.assign(Object.create(previousTheme ?? null), {
      fg: previousTheme?.fg ?? ((_color: string, text: string) => text),
      bg(slot: string, text: string) {
        backgroundSlots.push(slot);
        return text;
      },
    });
    setMessageDisplayTheme(cardTheme);
    edit.expanded = true;
    edit.render(120);
    const expandedRich = edit.resultRendererComponent;
    expect(expandedRich, "expanded bakes a separate rich diff").not.toBe(
      collapsedRich,
    );
    edit.render(120);
    expect(edit.resultRendererComponent, "expanded rich diff is reused").toBe(
      expandedRich,
    );
    const expandedRaw = edit.render(120);
    expect(
      expandedRaw[0],
      "expanded edit keeps the gap from previous tool",
    ).toBe("");
    const titlePlain =
      expandedRaw
        .map((line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))
        .find((line: string) => line.includes("edit a.ts")) ?? "";
    expect(titlePlain, "expanded title uses Box pad only").toMatch(
      /^ ✓ edit a\.ts/,
    );
    const expanded = renderText(edit).join("\n");
    expect(expanded).toMatch(/edit a\.ts \(\+1 -1\)/);
    expect(expanded).toMatch(/old/);
    expect(expanded).toMatch(/new/);
    expect(expanded).not.toMatch(/Input|Output|Details:/);
    expect(backgroundSlots.includes("userMessageBg")).toBeTruthy();
    setMessageDisplayTheme(previousTheme);

    // edit 缺 diff 时统计未知，不能伪报 (+0 -0)。
    const unknownEdit = tool("edit", "e2", { path: "unknown.ts" });
    unknownEdit.updateResult({
      content: [{ type: "text", text: "fallback output" }],
      isError: false,
    });
    expect(renderText(unknownEdit).join("\n")).not.toMatch(/\(\+\d+ -\d+\)/);
    unknownEdit.expanded = true;
    const unknownEditExpanded = renderText(unknownEdit).join("\n");
    expect(isExpandedToolIoView(unknownEdit.resultRendererComponent)).toBe(
      true,
    );
    expect(unknownEditExpanded).toMatch(/Input/);
    expect(unknownEditExpanded).toMatch(/Output/);
    expect(unknownEditExpanded).toMatch(/fallback output/);
    expect(
      () => invalidateIoView(unknownEdit.resultRendererComponent),
      "fallback IO hover keeps ToolExecutionComponent.invalidate bound",
    ).not.toThrow();

    // write 无变更成功：标题仍显示 (+0 -0)。
    const write = tool("write", "w1", { path: "b.ts", content: "" });
    metadata.set("w1", { fileExistedBeforeWrite: true, previousContent: "" });
    write.updateResult({ content: [], isError: false });
    expect(renderText(write).join("\n")).toMatch(/write b\.ts \(\+0 -0\)/);

    // write 折叠预览跟 mode=on 共用 writeDiffCollapsedLines。
    const longWriteContent = Array.from(
      { length: 40 },
      (_, index) => `const value${index} = ${index}`,
    ).join("\n");
    const longWrite = tool("write", "w-limit", {
      path: "long.ts",
      content: longWriteContent,
    });
    metadata.set("w-limit", { fileExistedBeforeWrite: false });
    longWrite.updateResult({ content: [], isError: false });
    config.writeDiffCollapsedLines = 0;
    const statsOnly = renderText(longWrite).join("\n");
    expect(statsOnly).toMatch(/write long\.ts \(\+40 -0\)/);
    expect(statsOnly).toMatch(/created/);
    expect(statsOnly).toMatch(/more/);
    expect(statsOnly).not.toMatch(/const value10 = 10/);
    config.writeDiffCollapsedLines = 4;
    const preview = renderText(longWrite).join("\n");
    expect(preview).toMatch(/const value0 = 0/);
    expect(preview).not.toMatch(/const value10 = 10/);
    config.writeDiffCollapsedLines = previousWriteCollapsed;

    // 元数据缺失时不能把覆盖写入伪装成新文件。
    const unknownWrite = tool("write", "w2", {
      path: "unknown.ts",
      content: "line",
    });
    unknownWrite.updateResult({
      content: [{ type: "text", text: "write fallback" }],
      isError: false,
    });
    expect(renderText(unknownWrite).join("\n")).not.toMatch(/\(\+\d+ -\d+\)/);
    unknownWrite.expanded = true;
    const unknownWriteExpanded = renderText(unknownWrite).join("\n");
    expect(isExpandedToolIoView(unknownWrite.resultRendererComponent)).toBe(
      true,
    );
    expect(unknownWriteExpanded).toMatch(/Input/);
    expect(unknownWriteExpanded).toMatch(/Output/);

    // 大文件超过精确统计预算时省略数字，不显示误导性的全量替换统计。
    const oldLines = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const newLines = oldLines.replace("line 250", "changed");
    const largeWrite = tool("write", "w3", {
      path: "large.ts",
      content: newLines,
    });
    metadata.set("w3", {
      fileExistedBeforeWrite: true,
      previousContent: oldLines,
    });
    largeWrite.updateResult({ content: [], isError: false });
    expect(renderText(largeWrite).join("\n")).not.toMatch(/\(\+\d+ -\d+\)/);

    // compact 路径、Input 和 Output 都不能保留终端控制序列。
    const unsafeWrite = tool("write", "w4", {
      path: "safe.ts\x1b]8;;https://evil\x07link\x1b]8;;\x07",
      content: "\x1b[31mcontent",
    });
    metadata.set("w4", { fileExistedBeforeWrite: false });
    unsafeWrite.updateResult({
      content: [{ type: "text", text: "\x1b]0;owned\x07done" }],
      isError: false,
    });
    unsafeWrite.expanded = true;
    expect(unsafeWrite.render(120).join("\n")).not.toMatch(
      /\x1b\]|\x1b\[31m|\x07/,
    );

    // write 展开同样走 rich diff；无变更时显示默认结果，不回退 Input/Output。
    write.expanded = true;
    const writeExpanded = renderText(write).join("\n");
    expect(writeExpanded).toMatch(/write b\.ts \(\+0 -0\)/);
    expect(writeExpanded).not.toMatch(/Input|Output|Details:/);
  } finally {
    setMessageDisplayTheme(previousTheme);
    config.mode = previousMode;
    config.writeDiffCollapsedLines = previousWriteCollapsed;
    hooks.shutdown();
  }
});

test("sync collects mounted resume components before applying global expansion", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const msg = toolCallMessage(7);
  const assistant = new AssistantMessageComponent(msg, true) as any;
  const hooks = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    refreshCompactModeComponents({ children: [assistant] });
    hooks.sync({ ui: { getToolsExpanded: () => true } });
    expect(assistant.expanded).toBe(true);
    expect(typeof assistant.setExpanded).toBe("function");
  } finally {
    config.mode = previousMode;
    hooks.shutdown();
  }
});

test("shutdown restores prototypes; reload replaces the patch without recursion", () => {
  const assistantPrototype = AssistantMessageComponent.prototype as any;
  const toolPrototype = ToolExecutionComponent.prototype as any;
  const originalUpdateContent = assistantPrototype.updateContent;
  const originalRender = toolPrototype.render;
  const originalUpdateDisplay = toolPrototype.updateDisplay;
  const previousMode = config.mode;
  config.mode = "compact";
  const first = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  try {
    expect(assistantPrototype.updateContent).not.toBe(originalUpdateContent);
    const firstPatch = assistantPrototype.updateContent;
    const msg = toolCallMessage(9);
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    const firstSetter = assistant.setExpanded;
    expect(typeof firstSetter).toBe("function");

    const second = installCompactMode({
      writeMetadata: new WriteExecutionMetadataStore(),
    });
    const secondPatch = assistantPrototype.updateContent;
    expect(secondPatch, "reload installs a fresh patch").not.toBe(firstPatch);
    expect(secondPatch).not.toBe(originalUpdateContent);
    expect(
      assistant.setExpanded,
      "reload detaches the previous instance patch",
    ).toBe(undefined);

    // 现有 transcript 组件由新补丁重新接管，且不递归到旧 round 闭包。
    assistant.updateContent(msg);
    expect(renderText(assistant).length).toBe(1);
    expect(typeof assistant.setExpanded).toBe("function");
    expect(assistant.setExpanded).not.toBe(firstSetter);
    expect(isCompactAssistantComponent(assistant)).toBe(true);

    first.shutdown();
    expect(
      assistantPrototype.updateContent,
      "stale shutdown keeps the new patch",
    ).toBe(secondPatch);
    second.shutdown();
    expect(assistantPrototype.updateContent).toBe(originalUpdateContent);
    expect(toolPrototype.render).toBe(originalRender);
    expect(toolPrototype.updateDisplay).toBe(originalUpdateDisplay);
  } finally {
    config.mode = previousMode;
    if (assistantPrototype.updateContent !== originalUpdateContent) {
      assistantPrototype.updateContent = originalUpdateContent;
    }
    if (toolPrototype.render !== originalRender)
      toolPrototype.render = originalRender;
    if (toolPrototype.updateDisplay !== originalUpdateDisplay) {
      toolPrototype.updateDisplay = originalUpdateDisplay;
    }
  }
});

test("isCompactAssistantComponent gates on compact mode; setExpanded no-ops outside", () => {
  const { restore } = installHooks();
  try {
    const msg = toolCallMessage(1);
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    expect(isCompactAssistantComponent(assistant)).toBe(true);

    let updates = 0;
    const originalUpdate = assistant.updateContent.bind(assistant);
    assistant.updateContent = (message: any) => {
      updates++;
      return originalUpdate(message);
    };

    // compact 下 setExpanded 更新整轮展开状态。
    assistant.setExpanded(true);
    expect(assistant.expanded).toBe(true);

    // 切 on：识别失效，setExpanded 只保持原生字段不触发重绘。
    config.mode = "on";
    expect(isCompactAssistantComponent(assistant)).toBe(false);
    const before = updates;
    const expandedBefore = assistant.expanded;
    assistant.setExpanded(false);
    expect(updates, "setExpanded is a no-op outside compact mode").toBe(before);
    expect(assistant.expanded).toBe(expandedBefore);
    expect(typeof assistant.setExpanded).toBe("undefined");

    // on 模式新实例不装 setExpanded（不产生 compact 标记）。
    const fresh = new AssistantMessageComponent(msg, true) as any;
    fresh.updateContent(msg);
    expect(typeof fresh.setExpanded).toBe("undefined");
    expect(isCompactAssistantComponent(fresh)).toBe(false);
  } finally {
    restore();
  }
});

test("unknown assistant wrappers keep ownership without creating a recursion cycle", () => {
  const prototype = AssistantMessageComponent.prototype as any;
  const original = prototype.updateContent;
  const previousMode = config.mode;
  config.mode = "compact";
  const hooks = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  const compactPatch = prototype.updateContent;
  const external = function (this: any, message: any) {
    return compactPatch.call(this, message);
  };
  prototype.updateContent = external;
  try {
    hooks.assertOwnership();
    expect(prototype.updateContent).toBe(external);
    const msg = toolCallMessage(11);
    const assistant = new AssistantMessageComponent(msg, true) as any;
    assistant.updateContent(msg);
    expect(renderText(assistant).length).toBe(1);
  } finally {
    hooks.shutdown();
    prototype.updateContent = original;
    config.mode = previousMode;
  }
});

test("refreshMountedContext asserts compact ownership before redraw (resume without new messages)", async () => {
  // resume 场景：renderer 先装 compact 补丁，compact-thinking 后装（外层）。
  // 无新消息 → message_update 的重新认领不触发 → 链序反。
  // refreshMountedContext 必须先断言链序再重绘，round 摘要才含工具统计。
  const dir = mkdtempSync(join(tmpdir(), "pi-compact-resume-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const previousMode = config.mode;
  config.mode = "compact";
  const { pi, ctx, emit } = extensionRuntime();
  try {
    claudeCodeStyleExtension(pi, { mode: "compact" });
    installCompactThinking(pi, {
      useSummaryTitlesAsThinkingTitle: false,
      previewLines: 0,
      animationIntervalMs: 30,
    });
    await emit("session_start", {}, ctx);
    // 不等 renderer 的 setTimeout(syncCompactMode)：模拟无新消息的 resume。
    const msg = toolCallMessage(Date.now());
    const component = new AssistantMessageComponent(msg, true) as any;
    const tui = { getMountedRoots: () => [component] } as any;
    refreshMountedContext(tui);
    const lines = renderText(component);
    expect(
      lines.some((line) => /bash×1/.test(line)),
      `round summary must include tool counts, got: ${JSON.stringify(lines)}`,
    ).toBeTruthy();
  } finally {
    config.mode = previousMode;
    await emit("session_shutdown", {}, ctx);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session_start and session_tree keep the compact patch outermost over compact-thinking", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-compact-mode-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const previousMode = config.mode;
  config.mode = "compact";
  const { pi, ctx, emit } = extensionRuntime();
  const assistantPrototype = AssistantMessageComponent.prototype as any;
  const toolPrototype = ToolExecutionComponent.prototype as any;
  const originalUpdateContent = assistantPrototype.updateContent;
  const originalToolUpdateDisplay = toolPrototype.updateDisplay;
  try {
    claudeCodeStyleExtension(pi, { mode: "compact" });
    installCompactThinking(pi, {
      useSummaryTitlesAsThinkingTitle: false,
      previewLines: 0,
      animationIntervalMs: 30,
    });
    await emit("session_start", {}, ctx);
    // renderer 的 session_start 先于 compact-thinking 执行；延迟 sync 重新认领。
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const msg = toolCallMessage(Date.now());
    const component = new AssistantMessageComponent(msg, true) as any;
    component.updateContent(msg);
    const lines = renderText(component);
    expect(
      lines.length,
      "compact summary stays outermost over the thinking patch",
    ).toBe(1);
    expect(lines[0]).toMatch(/bash×1/);

    // session_tree 后 resume 历史仍由 compact 补丁外层持有。
    await emit("session_tree", {}, ctx);
    const nextMessage = {
      ...toolCallMessage(Date.now() + 1),
      content: [
        { type: "text", text: "next" },
        { type: "toolCall", name: "bash", arguments: { command: "echo" } },
      ],
    };
    const afterTree = new AssistantMessageComponent(
      nextMessage as any,
      true,
    ) as any;
    afterTree.updateContent(nextMessage);
    expect(renderText(afterTree).join("\n")).toMatch(/bash×1/);

    // shutdown 恢复原生原型。
    await emit("session_shutdown", {}, ctx);
    expect(assistantPrototype.updateContent).toBe(originalUpdateContent);
    expect(toolPrototype.updateDisplay).toBe(originalToolUpdateDisplay);
  } finally {
    config.mode = previousMode;
    await emit("session_shutdown", {}, ctx);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isStreaming survives the compact + compact-thinking patch chain (mermaid flicker regression)", async () => {
  const previousMode = config.mode;
  const { pi, ctx, emit } = extensionRuntime();
  const assistantPrototype = AssistantMessageComponent.prototype as any;
  const originalUpdateContent = assistantPrototype.updateContent;
  try {
    config.mode = "on";
    claudeCodeStyleExtension(pi, { mode: "on" });
    installCompactThinking(pi, {
      useSummaryTitlesAsThinkingTitle: false,
      previewLines: 0,
      animationIntervalMs: 30,
    });
    // 真实链序：compact-thinking 先装，compact-mode 在其外层再装。
    await emit("session_start", {}, ctx);

    const seen: boolean[] = [];
    const component = new AssistantMessageComponent(
      undefined,
      false,
      undefined,
      undefined,
      1,
      [
        (markdown: string, tctx: any) => {
          seen.push(tctx.isStreaming);
          return markdown;
        },
      ],
    );
    const message = {
      role: "assistant",
      timestamp: Date.now(),
      content: [{ type: "text", text: "hello" }],
    } as unknown as AssistantMessage;

    component.updateContent(message, true);
    component.render(120);
    component.updateContent(message, false);
    component.render(120);

    expect(
      seen,
      `transformer must see streaming then final: ${JSON.stringify(seen)}`,
    ).toStrictEqual([true, false]);
  } finally {
    config.mode = previousMode;
    await emit("session_shutdown", {}, ctx);
    assistantPrototype.updateContent = originalUpdateContent;
  }
});
