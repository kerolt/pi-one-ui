import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import {
  installToolGrouping,
  ToolGroupComponent,
} from "../../extensions/layouts/context/renderer/tool/grouping.ts";
import {
  ExpandedToolIoView,
  type IoViewFrameState,
  setActiveIoViewFrame,
} from "../../extensions/layouts/context/renderer/tool/result.ts";

initTheme("dark");
const ui = {
  theme: { fg: (_color: string, text: string) => text },
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

function started(name: string, id: string, args: any = {}) {
  const component = tool(name, id, args);
  component.markExecutionStarted();
  return component;
}

test("restored tools still render as running with the braille loader", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    parent.addChild(tool("read", "read-stale"));
    parent.addChild(tool("bash", "bash-stale"));
    const group = parent.children[0] as ToolGroupComponent;
    const rendered = group
      .render(100)
      .map((line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))
      .filter((line: string) => line.trim());
    expect(rendered[0]).toMatch(/2 running/);
    expect(
      rendered.some((line: string) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)),
    ).toBeTruthy();
    expect(rendered.join("\n")).not.toMatch(/queued/);
  } finally {
    hooks.shutdown();
  }
});

test("mixed tools group across three empty separators while edit/write and content break groups", () => {
  let enabled = true;
  const hooks = installToolGrouping(() => enabled);
  try {
    const parent = new Container() as any;
    const read = started("read", "read");
    const bash = started("bash", "bash");
    const grep = started("grep", "grep");
    parent.addChild(read);
    parent.addChild(new Spacer(1));
    parent.addChild(new Spacer(1));
    parent.addChild(new Spacer(1));
    parent.addChild(bash);
    parent.addChild(grep);
    expect(parent.children[0] instanceof ToolGroupComponent).toBeTruthy();
    const renderedGroup = parent.children[0].render(100);
    expect(
      renderedGroup.at(-1)?.trim(),
      "group does not add a trailing blank row",
    ).not.toBe("");
    const collapsed = renderedGroup
      .map((line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))
      .filter((line: string) => line.trim());
    expect(collapsed[0]).toMatch(
      /^ ● Multiple Tools: 3 running .*read, bash, grep.*click to show more/,
    );
    expect(collapsed.filter((line: string) => line.trim()).length).toBe(4);
    expect(collapsed[1]).toMatch(/^ ├ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read /);
    expect(collapsed[2]).toMatch(/^ ├ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash /);
    expect(collapsed[3]).toMatch(/^ └ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Grep /);
    bash.updateResult({ content: [], isError: false });
    grep.updateResult({ content: [], isError: true });
    expect(
      parent.children[0].render(100).find((line: string) => line.trim())!,
    ).toMatch(/1 running.*1 done.*1 failed/);
    const group = parent.children[0] as ToolGroupComponent;
    group.setExpanded(true);
    const expanded = group
      .render(100)
      .map((line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))
      .join("\n");
    expect(expanded, "expanded tool titles have one separator").not.toMatch(
      /[├└] ● {2}/,
    );
    group.setExpanded(false);

    parent.addChild(tool("edit", "edit"));
    parent.addChild(tool("read", "after-edit"));
    expect(
      parent.children.filter(
        (child: any) => child instanceof ToolGroupComponent,
      ).length,
    ).toBe(1);
    parent.addChild(tool("write", "write"));
    const assistant = new AssistantMessageComponent(
      {
        role: "assistant",
        content: [{ type: "text", text: "boundary" }],
      } as unknown as AssistantMessage,
      true,
    );
    parent.addChild(assistant);
    parent.addChild(tool("bash", "after-content"));
    expect(parent.children.at(-1).toolCallId).toBe("after-content");
  } finally {
    hooks.shutdown();
  }
});

test("modern subagent renderers remain outside generic tool groups", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    parent.addChild(tool("read", "before-read"));
    parent.addChild(tool("bash", "before-bash"));
    const subagent = tool("subagent", "dedicated-subagent");
    parent.addChild(subagent);
    parent.addChild(tool("grep", "after-grep"));
    parent.addChild(tool("find", "after-find"));

    expect(parent.children).toHaveLength(3);
    expect(parent.children[0] instanceof ToolGroupComponent).toBe(true);
    expect(parent.children[1]).toBe(subagent);
    expect(parent.children[2] instanceof ToolGroupComponent).toBe(true);
  } finally {
    hooks.shutdown();
  }
});

test("expanded native cards align nested trees through interleaved ANSI padding", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    const read = started("read", "read");
    const bash = started("bash", "bash");
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;
    hooks.setTheme({
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) =>
        `\x1b[48;2;10;20;30m${text}\x1b[49m`,
      getBgAnsi: () => "\x1b[48;2;10;20;30m",
    });
    group.setExpanded(true);
    read.render = (width: number) => {
      expect(width, "native card uses the full padded panel width").toBe(98);
      return [
        "\x1b[48;2;20;20;20m ✓ Read sample.ts\x1b[0m",
        "\x1b[48;2;20;20;20m \x1b[39m├ Input\x1b[0m",
        "\x1b[48;2;20;20;20m \x1b[39m│ path: sample.ts\x1b[0m",
        "\x1b[48;2;20;20;20m \x1b[39m└ Output\x1b[0m",
        "\x1b[48;2;20;20;20m \x1b[39m  ok\x1b[0m",
      ];
    };
    const rendered = group.render(100);
    const stripAnsi = (line: string) =>
      line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const inputLine =
      rendered.find((line: string) => stripAnsi(line).includes("Input")) ?? "";
    const backgroundIndex = inputLine.indexOf("\x1b[48;");
    expect(
      backgroundIndex,
      "expanded panel background covers the full row",
    ).toBe(0);
    expect(
      stripAnsi(rendered[2]),
      "panel starts directly with the loading tool",
    ).toMatch(/^ ├ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read/);
    expect(
      stripAnsi(rendered.at(-1) ?? "").length,
      "bottom padding covers the full width",
    ).toBe(100);
    const expanded = rendered.map(stripAnsi).join("\n");
    expect(expanded, "expanded branch matches collapsed position").toMatch(
      /^ ├ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read sample\.ts\s*$/m,
    );
    expect(expanded, "nested tree aligns with the status dot").toMatch(
      /^ │ ├ Input\s*$/m,
    );
    expect(expanded).toMatch(/^ │ │ path: sample\.ts\s*$/m);
    expect(expanded, "output content retains its relative indent").toMatch(
      /^ │   ok\s*$/m,
    );
  } finally {
    hooks.shutdown();
  }
});

test("external task, skill, and plan tools keep reference summaries in groups", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    parent.addChild(tool("TaskCreate", "task", { subject: "Fix tests" }));
    parent.addChild(tool("Skill", "skill", { name: "deploy" }));
    parent.addChild(tool("EnterPlanMode", "plan"));
    const rendered = parent.children[0].render(160).join("\n");
    expect(rendered).toMatch(/Task Create Fix tests/);
    expect(rendered).toMatch(/Skill deploy/);
    expect(rendered).toMatch(/Enter Plan Mode enable read-only planning/);

    const agentParent = new Container() as any;
    const agent = tool("Agent", "agent", { description: "再次测试 tool 调用" });
    const result = tool("get_subagent_result", "result", {
      agent_id: "6a559462-95d0-40b",
    });
    agent.updateResult({ content: [], isError: false });
    result.updateResult({ content: [], isError: false });
    agentParent.addChild(agent);
    agentParent.addChild(result);
    const agentLines = agentParent.children[0]
      .render(160)
      .map((line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))
      .filter((line: string) => line.trim());
    expect(agentLines[0]).toMatch(
      /^ ● Multiple Tools: 2 done • Agent, get_subagent_result • click to show more$/,
    );
    expect(agentLines[1]).toBe(" ├ ✓ Agent 再次测试 tool 调用");
    expect(agentLines[2]).toBe(" └ ✓ Get Subagent Result 6a559462-95d0-40b");
  } finally {
    hooks.shutdown();
  }
});

test("group status and tool labels use the injected active theme", () => {
  const hooks = installToolGrouping(() => true);
  hooks.setTheme({
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  });
  try {
    const parent = new Container() as any;
    const read = tool("read", "themed-read");
    const bash = tool("bash", "themed-bash");
    read.updateResult({ content: [], isError: false });
    bash.updateResult({ content: [], isError: false });
    parent.addChild(read);
    parent.addChild(bash);
    const rendered = parent.children[0].render(200).join("\n");
    expect(rendered, "group header stays a status dot").toMatch(
      /<success>●<\/success>/,
    );
    expect(rendered, "children use checks").toMatch(
      /<dim>[├└]<\/dim> <success>✓<\/success>/,
    );
    expect(rendered).toMatch(/<success>2<\/success> done/);
    expect(rendered).toMatch(/<toolTitle>Read /);
    expect(rendered).toMatch(/<toolTitle>Bash /);

    const group = parent.children[0] as ToolGroupComponent;
    group.setHintHovered(true);
    const hovered = group.render(200).join("\n");
    expect(
      hovered,
      "hover highlights text without highlighting the dot",
    ).toMatch(/<dim>•<\/dim> <text>click to show more<\/text>/);
    expect(hovered).not.toMatch(/<text>•/);
    group.setExpanded(true);
    const expanded = group.render(200).join("\n");
    expect(
      expanded.match(/✓/g)?.length,
      "expanded children keep one check each",
    ).toBe(2);
  } finally {
    hooks.shutdown();
  }
});

test("outer removeChild removes grouped tools, dissolves singletons, and clear forgets groups", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    const read = tool("read", "read");
    const bash = tool("bash", "bash");
    const grep = tool("grep", "grep");
    parent.addChild(read);
    parent.addChild(bash);
    parent.addChild(grep);
    const group = parent.children[0] as ToolGroupComponent;
    expect(group instanceof ToolGroupComponent).toBeTruthy();
    expect(group.render(100).find((line: string) => line.trim())!).toMatch(
      /click to show more/,
    );

    parent.removeChild(bash);
    expect(group.children).toStrictEqual([read, grep]);
    parent.removeChild(read);
    expect(
      parent.children,
      "one remaining tool is automatically ungrouped",
    ).toStrictEqual([grep]);
    parent.removeChild(grep);
    expect(parent.children).toStrictEqual([]);

    parent.addChild(tool("read", "new-read"));
    parent.addChild(tool("bash", "new-bash"));
    expect(parent.children[0] instanceof ToolGroupComponent).toBeTruthy();
    parent.clear();
    expect(parent.children).toStrictEqual([]);
    hooks.refresh();
  } finally {
    hooks.shutdown();
  }
});

test("off refresh ungroups, reload rescans existing tools, and stale shutdown preserves ownership", () => {
  const prototype = Container.prototype as any;
  const originalAdd = prototype.addChild;
  let mode: "on" | "off" = "on";
  const first = installToolGrouping(() => mode === "on");
  const parent = new Container() as any;
  parent.addChild(tool("read", "one"));
  parent.addChild(tool("bash", "two"));
  expect(parent.children[0] instanceof ToolGroupComponent).toBeTruthy();
  mode = "off";
  first.refresh();
  expect(
    parent.children.some((child: any) => child instanceof ToolGroupComponent),
  ).toBe(false);

  mode = "on";
  first.refresh();
  parent.addChild(tool("grep", "three"));
  expect(
    parent.children.some((child: any) => child instanceof ToolGroupComponent),
  ).toBe(false);
  parent.addChild(tool("read", "four"));
  expect(parent.children.at(-1) instanceof ToolGroupComponent).toBeTruthy();

  const firstWrapper = prototype.addChild;
  const second = installToolGrouping(() => true);
  expect(prototype.addChild).not.toBe(firstWrapper);
  expect(
    parent.children.some((child: any) => child instanceof ToolGroupComponent),
    "replacement install first releases old-module groups",
  ).toBe(false);
  second.refresh({ getMountedRoots: () => [parent] });
  expect(
    parent.children[0] instanceof ToolGroupComponent,
    "reload regroups mounted transcript",
  ).toBeTruthy();
  expect(parent.children[0].children.length).toBe(4);
  first.shutdown();
  const secondWrapper = prototype.addChild;
  expect(prototype.addChild, "stale shutdown preserves the new owner").toBe(
    secondWrapper,
  );
  second.shutdown();
  expect(prototype.addChild).toBe(originalAdd);
});

test("pending group rendering does not schedule recursive child invalidation", async () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    const read = started("read", "timer-read");
    const bash = started("bash", "timer-bash");
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;
    let settledSiblingInvalidations = 0;
    read.updateResult({ content: [], isError: false });
    read.invalidate = () => {
      settledSiblingInvalidations++;
    };

    expect(group.render(120).join("\n")).toMatch(/1 running.*1 done/);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(
      settledSiblingInvalidations,
      "group animation must not invalidate settled siblings",
    ).toBe(0);
  } finally {
    hooks.shutdown();
  }
});

test("pending groups bypass full caching while settled expanded groups reuse it", () => {
  const hooks = installToolGrouping(() => true);
  try {
    const parent = new Container() as any;
    const read = started("read", "live-read");
    const bash = started("bash", "live-bash");
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;

    const pending = group.render(120);
    expect(
      group.render(120),
      "pending spinner output is not memoized",
    ).not.toBe(pending);

    read.updateResult({ content: [], isError: false });
    bash.updateResult({ content: [], isError: false });
    group.setExpanded(true);
    const expanded = group.render(120);
    expect(group.render(120), "settled expanded output is memoized").toBe(
      expanded,
    );
  } finally {
    hooks.shutdown();
  }
});

test("pending expanded groups reuse settled child blocks", () => {
  const hooks = installToolGrouping(() => true);
  hooks.setTheme({
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
  });
  try {
    const parent = new Container() as any;
    const read = tool("read", "child-cache-read");
    const bash = tool("bash", "child-cache-bash");
    const grep = started("grep", "child-cache-grep");
    read.updateResult({ content: [], isError: false });
    bash.updateResult({ content: [], isError: false });
    parent.addChild(read);
    parent.addChild(bash);
    parent.addChild(grep);
    const group = parent.children[0] as ToolGroupComponent;
    group.setExpanded(true);

    const renders = { read: 0, bash: 0, grep: 0 };
    read.render = () => {
      renders.read++;
      return ["✓ Read done"];
    };
    bash.render = () => {
      renders.bash++;
      return ["✓ Bash done"];
    };
    grep.render = () => {
      renders.grep++;
      return ["⠋ Grep running"];
    };

    group.render(100);
    expect(renders).toStrictEqual({ read: 1, bash: 1, grep: 1 });
    group.render(100);
    expect(
      renders,
      "only the pending child renders on the next animation frame",
    ).toStrictEqual({ read: 1, bash: 1, grep: 2 });

    grep.updateResult({ content: [], isError: false });
    group.render(100);
    expect(renders).toStrictEqual({ read: 1, bash: 1, grep: 3 });
    group.render(100);
    expect(
      renders,
      "pending to settled transition enters the full expanded cache",
    ).toStrictEqual({ read: 1, bash: 1, grep: 3 });
  } finally {
    hooks.shutdown();
  }
});

test("settled expanded cache replays fresh fullscreen IO markers", () => {
  const hooks = installToolGrouping(() => true);
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  hooks.setTheme(theme);
  const frame = (): IoViewFrameState => ({
    viewIds: new Map(),
    idToView: new Map(),
    nextId: 0,
  });
  try {
    const parent = new Container() as any;
    const read = tool("read", "marker-read");
    const bash = tool("bash", "marker-bash");
    read.updateResult({ content: [], isError: false });
    bash.updateResult({ content: [], isError: false });
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;
    group.setExpanded(true);

    const view = new ExpandedToolIoView(
      theme,
      "path: sample.ts\nline: 2",
      "one\ntwo\nthree",
      false,
      1,
      1,
      true,
    );
    read.rendererState.ccstyleIoView = view;
    read.resultRendererComponent = view;
    read.render = (width: number) => view.render(width);
    bash.render = () => ["✓ Bash done"];

    const uninstrumented = group.render(100);
    expect(uninstrumented.join("\n")).not.toMatch(/\x1b_cc:v/);

    const firstFrame = frame();
    setActiveIoViewFrame(firstFrame);
    const first = group.render(100);
    setActiveIoViewFrame(null);
    expect(firstFrame.idToView.get(0)).toBe(view);
    expect(first.join("\n")).toMatch(/\x1b_cc:v0:[io]\x07/);

    const secondFrame = frame();
    setActiveIoViewFrame(secondFrame);
    const replayed = group.render(100);
    setActiveIoViewFrame(null);
    expect(secondFrame.idToView.get(0)).toBe(view);
    expect(replayed.join("\n")).toMatch(/\x1b_cc:v0:[io]\x07/);
    expect(
      replayed,
      "frame-local markers are attached to a fresh paint copy",
    ).not.toBe(first);
  } finally {
    setActiveIoViewFrame(null);
    hooks.shutdown();
  }
});

test("pending child cache refreshes IO hover and frame markers", () => {
  const hooks = installToolGrouping(() => true);
  const theme = {
    fg: (color: string, text: string) =>
      color === "text" ? `<text>${text}</text>` : text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  hooks.setTheme(theme);
  const frame = (): IoViewFrameState => ({
    viewIds: new Map(),
    idToView: new Map(),
    nextId: 0,
  });
  try {
    const parent = new Container() as any;
    const read = tool("read", "pending-marker-read");
    const bash = started("bash", "pending-marker-bash");
    read.updateResult({ content: [], isError: false });
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;
    group.setExpanded(true);

    const view = new ExpandedToolIoView(
      theme,
      "path: sample.ts\nline: 2",
      "one\ntwo\nthree",
      false,
      1,
      1,
      true,
    );
    let settledRenders = 0;
    read.rendererState.ccstyleIoView = view;
    read.resultRendererComponent = view;
    read.render = (width: number) => {
      settledRenders++;
      return view.render(width);
    };
    bash.render = () => ["⠋ Bash running"];

    group.render(100);
    expect(settledRenders).toBe(1);

    const firstFrame = frame();
    setActiveIoViewFrame(firstFrame);
    group.render(100);
    setActiveIoViewFrame(null);
    expect(
      settledRenders,
      "entering an instrumented frame refreshes a markerless child cache",
    ).toBe(2);

    const secondFrame = frame();
    setActiveIoViewFrame(secondFrame);
    const replayed = group.render(100);
    setActiveIoViewFrame(null);
    expect(settledRenders, "settled child block is reused").toBe(2);
    expect(secondFrame.idToView.get(0)).toBe(view);
    expect(replayed.join("\n")).toMatch(/\x1b_cc:v0:[io]\x07/);

    view.setHoveredSection("input");
    const hoveredFrame = frame();
    setActiveIoViewFrame(hoveredFrame);
    const hovered = group.render(100);
    setActiveIoViewFrame(null);
    expect(settledRenders, "IO hover invalidates the child block").toBe(3);
    expect(hovered.join("\n")).toMatch(/<text> click to show more<\/text>/);
    expect(hoveredFrame.idToView.get(0)).toBe(view);
  } finally {
    setActiveIoViewFrame(null);
    hooks.shutdown();
  }
});

test("settled collapsed groups reuse the last render until inputs change", () => {
  const hooks = installToolGrouping(() => true);
  hooks.setTheme({ fg: (_color: string, text: string) => text });
  try {
    const parent = new Container() as any;
    const read = tool("read", "cached-read", { path: "a.ts" });
    const bash = tool("bash", "cached-bash", { command: "ls" });
    read.updateResult({ content: [], isError: false });
    bash.updateResult({ content: [], isError: false });
    parent.addChild(read);
    parent.addChild(bash);
    const group = parent.children[0] as ToolGroupComponent;

    const first = group.render(120);
    expect(
      group.render(120),
      "identical settled frame reuses the cached lines",
    ).toBe(first);
    group.invalidate();
    const invalidated = group.render(120);
    expect(invalidated, "invalidation clears settled output").not.toBe(first);
    expect(group.render(120), "new output is memoized").toBe(invalidated);

    const wider = group.render(160);
    expect(wider).not.toBe(first);
    expect(wider.find((line: string) => line.trim())!).toMatch(/2 done/);

    group.setHintHovered(true);
    const hovered = group.render(160);
    expect(hovered).not.toBe(wider);
    expect(group.render(160)).toBe(hovered);

    hooks.setTheme({
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    });
    const themed = group.render(160);
    expect(themed).not.toBe(hovered);
    expect(themed.join("\n")).toMatch(/<success>2<\/success> done/);

    bash.updateResult({ content: [], isError: true });
    const failed = group.render(160);
    expect(failed).not.toBe(themed);
    expect(failed.join("\n")).toMatch(/<success>1<\/success> done/);
    expect(failed.join("\n")).toMatch(/<error>1<\/error> failed/);

    group.setExpanded(true);
    const expanded = group.render(160);
    expect(expanded).not.toBe(failed);
    expect(group.render(160), "expanded output is memoized").toBe(expanded);
    group.setExpanded(false);
    const collapsed = group.render(160);
    expect(
      collapsed,
      "collapsed and expanded cache slots survive toggles",
    ).toBe(failed);
    expect(group.render(160), "collapsed output remains memoized").toBe(
      collapsed,
    );

    parent.addChild(started("grep", "cached-grep", { pattern: "todo" }));
    const grown = group.render(160);
    expect(grown).not.toBe(collapsed);
    expect(grown.join("\n")).toMatch(/running/);
    expect(grown.join("\n")).toMatch(/<success>1<\/success> done/);
    expect(grown.join("\n")).toMatch(/<error>1<\/error> failed/);
  } finally {
    hooks.shutdown();
  }
});
