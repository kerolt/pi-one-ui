import { initTheme } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  AgentRunSummary,
  type AgentSummaryData,
  bindAgentSummary,
  classifyTool,
  formatDuration,
  summaryLine,
  summaryMarkdown,
} from "../../extensions/layouts/context/summary/core.ts";
import agentSummaryFeature, {
  AGENT_SUMMARY_ENTRY_TYPE,
} from "../../extensions/layouts/context/summary/index.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

test("classifyTool：bash/read/edit/write/other", () => {
  expect(classifyTool("bash")).toBe("bash");
  expect(classifyTool("powershell")).toBe("bash");
  expect(classifyTool("read")).toBe("read");
  expect(classifyTool("edit")).toBe("edit");
  expect(classifyTool("write")).toBe("write");
  expect(classifyTool("grep")).toBe("other");
  // MCP 风格名不是精确工具名：归 other
  expect(classifyTool("mcp__server__read")).toBe("other");
});

test("AgentRunSummary：bash/powershell 计数；read/edit/write 按路径去重；other 计数", () => {
  const summary = new AgentRunSummary(1_000);
  summary.recordToolStart("bash", { command: "npm test" });
  summary.recordToolStart("powershell", { command: "Get-ChildItem" });
  summary.recordToolStart("bash", { command: "ls" });
  summary.recordToolStart("read", { path: "a.ts" });
  summary.recordToolStart("read", { path: "a.ts" }); // 去重
  summary.recordToolStart("read", { path: "b.ts" });
  summary.recordToolStart("edit", { file_path: "c.ts" }); // file_path 别名
  summary.recordToolStart("write", { path: "d.ts" });
  summary.recordToolStart("write", { path: "d.ts" }); // 去重
  summary.recordToolStart("grep", { pattern: "x" });
  summary.recordToolResult(true);
  summary.recordToolResult(false);

  expect(summary.toolCount).toBe(10);
  const data = summary.snapshot(61_000);
  expect(data).toStrictEqual({
    commands: 3,
    reads: 2,
    edits: 1,
    writes: 1,
    others: 1,
    failed: 1,
    durationMs: 60_000,
  } satisfies AgentSummaryData);
});

test("formatDuration 边界", () => {
  expect(formatDuration(0)).toBe("");
  expect(formatDuration(999)).toBe("");
  expect(formatDuration(1_000)).toBe("1s");
  expect(formatDuration(62_000)).toBe("1m 2s");
  expect(formatDuration(3_721_000)).toBe("1h 2m 1s");
});

test("summaryLine：bash→read→edit→write→other 顺序", () => {
  const data: AgentSummaryData = {
    commands: 4,
    reads: 3,
    edits: 2,
    writes: 1,
    others: 1,
    failed: 1,
    durationMs: 61_000,
  };
  expect(summaryLine(data)).toBe(
    "Ran 4 commands, read 3 files, edited 2 files, wrote 1 file, 1 other tool, 1 failed · 1m 1s",
  );
  expect(
    summaryLine({
      commands: 0,
      reads: 1,
      edits: 0,
      writes: 0,
      others: 0,
      failed: 0,
      durationMs: 500,
    }),
  ).toBe("Read 1 file");
  expect(
    summaryLine({
      commands: 0,
      reads: 0,
      edits: 0,
      writes: 0,
      others: 0,
      failed: 0,
      durationMs: 10_000,
    }),
  ).toBe("");
});

test("summaryMarkdown 整体加粗 / box 引用块", () => {
  const data: AgentSummaryData = {
    commands: 3,
    reads: 2,
    edits: 1,
    writes: 1,
    others: 0,
    failed: 0,
    durationMs: 42_000,
  };
  expect(summaryMarkdown(data)).toBe(
    "**Ran 3 commands, read 2 files, edited 1 file, wrote 1 file · 42s**",
  );
  expect(summaryMarkdown(data, true)).toBe(
    "> *Ran 3 commands, read 2 files, edited 1 file, wrote 1 file · 42s*",
  );
  expect(
    summaryMarkdown({ ...data, commands: 0, reads: 0, edits: 0, writes: 0 }),
  ).toBe("");
});

test("bindAgentSummary 事件绑定：agent_start 重置、agent_end 回调", async () => {
  const handlers = new Map<string, Function>();
  const fakePi = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
  } as any;

  const calls: AgentSummaryData[] = [];
  bindAgentSummary(fakePi, (data) => calls.push(data));

  await handlers.get("agent_start")!();
  await handlers.get("tool_execution_start")!({
    toolName: "read",
    args: { path: "a.ts" },
  });
  await handlers.get("tool_execution_end")!({ isError: false });
  await handlers.get("agent_end")!();
  expect(calls.length).toBe(0); // toolCount < 2

  await handlers.get("tool_execution_start")!({
    toolName: "bash",
    args: { command: "ls" },
  });
  await handlers.get("tool_execution_end")!({ isError: true });
  await handlers.get("agent_end")!();
  expect(calls.length).toBe(1);
  expect(calls[0].commands).toBe(1);
  expect(calls[0].failed).toBe(1);
  expect(calls[0].reads).toBe(1);

  await handlers.get("agent_start")!();
  await handlers.get("tool_execution_start")!({ toolName: "bash", args: {} });
  await handlers.get("tool_execution_end")!({ isError: false });
  await handlers.get("tool_execution_start")!({ toolName: "grep", args: {} });
  await handlers.get("tool_execution_end")!({ isError: false });
  await handlers.get("agent_end")!();
  expect(calls.length).toBe(2);
  expect(calls[1]).toStrictEqual({
    commands: 1,
    reads: 0,
    edits: 0,
    writes: 0,
    others: 1,
    failed: 0,
    durationMs: calls[1].durationMs,
  });
});

test("agent-summary 注册 renderer，agent_end 输出引用块", async () => {
  initTheme("dark");
  const renderers = new Map<string, Function>();
  const appended: unknown[] = [];
  const events = new Map<string, Function>();
  const fakePi = {
    on: (event: string, handler: Function) => events.set(event, handler),
    registerEntryRenderer: (type: string, renderer: Function) =>
      renderers.set(type, renderer),
    appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
  } as any;

  agentSummaryFeature(fakePi);
  expect(renderers.has(AGENT_SUMMARY_ENTRY_TYPE)).toBeTruthy();

  await events.get("agent_start")!();
  await events.get("tool_execution_start")!({
    toolName: "read",
    args: { path: "a.ts" },
  });
  await events.get("tool_execution_end")!({ isError: false });
  await events.get("tool_execution_start")!({
    toolName: "bash",
    args: { command: "ls" },
  });
  await events.get("tool_execution_end")!({ isError: false });
  await events.get("agent_end")!();

  expect(appended.length).toBe(1);
  const renderer = renderers.get(AGENT_SUMMARY_ENTRY_TYPE)!;
  const component = renderer(
    { data: (appended[0] as any).data },
    { expanded: false },
    {
      getFgAnsi: (color: string) =>
        color === "success" ? "\x1b[32m" : "\x1b[31m",
    },
  );
  const plain = stripAnsi(
    (component as any).render(120).map(String).join("\n"),
  );
  expect(plain).not.toMatch(/[┌├└]/);
  expect(plain).not.toMatch(/TIP/);
  expect(plain).toMatch(/Ran 1 command, read 1 file/);
  expect(
    renderer(
      {
        data: {
          commands: 0,
          reads: 0,
          edits: 0,
          writes: 0,
          others: 0,
          failed: 0,
          durationMs: 0,
        },
      },
      { expanded: false },
      { getFgAnsi: () => "" },
    ),
  ).toBe(undefined);
});
