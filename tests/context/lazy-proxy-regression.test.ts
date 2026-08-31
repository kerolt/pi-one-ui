import {
  AssistantMessageComponent,
  getMarkdownTheme,
  initTheme,
  type ParsedSkillBlock,
  SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { config } from "../../extensions/app/config/renderer.ts";
import { showTextPreview } from "../../extensions/features/context-inspector/index.ts";
import { installCompactMode } from "../../extensions/layouts/context/renderer/compact-mode.ts";
import claudeCodeStyleExtension, {
  ExpandedToolIoView,
  installToolMouseInteraction,
  SHOW_MORE_LABEL,
} from "../../extensions/layouts/context/renderer/index.ts";
import {
  isToolCallHovered,
  sharedToolHoverState,
} from "../../extensions/layouts/context/renderer/mouse/hover.ts";
import { WriteExecutionMetadataStore } from "../../extensions/layouts/context/renderer/tool/diff/write-execution.ts";
import { ToolGroupComponent } from "../../extensions/layouts/context/renderer/tool/grouping.ts";
import {
  getMessageDisplayTheme,
  installMessageDisplayRendering,
  setMessageDisplayTheme,
} from "../../extensions/layouts/context/renderer/tool/message-display.ts";
import {
  installCompactThinking,
  ThinkingPreviewBlock,
} from "../../extensions/layouts/context/thinking/compact-thinking.ts";

// 0.84+ 的稳定 TUI 引用会在 renderer 切换时重绑方法。插件不得捕获后回写
// doRender/render/handleInput；regular 的工具点击改为按左键输入即时捕获内存 frame。

initTheme("dark");

/** 精确模拟 Pi 0.84.1 createInteractiveTuiReference 的 renderer 重绑语义。 */
function createLazyProxy<T extends object>(getRenderer: () => T): T {
  return new Proxy({} as T, {
    get: (_target, property) => {
      const tui = getRenderer();
      const value = Reflect.get(tui, property, tui);
      if (typeof value !== "function") return value;
      let methodTui = tui;
      let method = value;
      return (...args: any[]) => {
        const currentTui = getRenderer();
        if (currentTui !== methodTui) {
          const currentMethod = Reflect.get(currentTui, property, currentTui);
          if (typeof currentMethod !== "function") {
            throw new TypeError(`not callable: ${String(property)}`);
          }
          methodTui = currentTui;
          method = currentMethod;
        }
        return Reflect.apply(method, methodTui, args);
      };
    },
    set: (_target, property, value) =>
      Reflect.set(getRenderer(), property, value),
    has: (_target, property) => Reflect.has(getRenderer(), property),
    getPrototypeOf: () => Reflect.getPrototypeOf(getRenderer()),
  });
}

function runtime() {
  const events = new Map<string, Function>();
  return {
    pi: {
      registerCommand() {},
      registerShortcut() {},
      registerTool() {},
      on(name: string, handler: Function) {
        events.set(name, handler);
      },
    },
    events,
  };
}

function theme() {
  return {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  };
}

/** 工具桩：模拟 Tool 的最小形状（resultRendererComponent 由个别用例注入）。 */
type ToolStub = {
  toolCallId: string;
  expanded: boolean;
  renderCalls: number;
  resultRendererComponent?: unknown;
  setExpanded(value: boolean): void;
  invalidate(): void;
  render(): string[];
};

function createTool(toolCallId: string): ToolStub {
  return {
    toolCallId,
    expanded: false,
    renderCalls: 0,
    setExpanded(value: boolean) {
      this.expanded = value;
    },
    invalidate() {},
    render() {
      this.renderCalls++;
      return ["✓ Bash(echo ok)", "  └ 1 line output (ctrl+o expand / click)"];
    },
  };
}

/** 官方 TuiAltScreen 的最小模型（regular/fullscreen 共用形状）。 */
type RendererStub = {
  mode: "regular" | "fullscreen";
  children: any[];
  previousViewportTop: number;
  doRenderCalls: number;
  terminal: any;
  requestRender(): void;
  render(width: number): string[];
  doRender(): void;
  handleInput(data: string): void;
};

function createRenderer(
  mode: "regular" | "fullscreen",
  children: any[],
  terminal: any,
): RendererStub {
  return {
    mode,
    children,
    previousViewportTop: 0,
    doRenderCalls: 0,
    terminal,
    requestRender() {},
    render(width: number) {
      return this.children.flatMap((child: any) => child.render(width));
    },
    doRender() {
      this.doRenderCalls++;
      this.render(80);
    },
    handleInput(_data: string) {},
  };
}

/** 带写入记录的终端 fixture：writes 收集插件写出的所有序列。 */
function createTerminalFixture() {
  const writes: string[] = [];
  const terminal = {
    columns: 80,
    rows: 24,
    write(data: string) {
      writes.push(data);
    },
  };
  return { terminal, writes };
}

function createUi(tui: any) {
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  let widget: any;
  let terminalInputCalls = 0;
  const notifications: string[] = [];
  return {
    ctx: {
      mode: "tui",
      hasUI: true,
      ui: {
        theme: theme(),
        setStatus() {},
        requestRender() {},
        setWidget(_key: string, content: any) {
          if (typeof content === "function") widget = content(tui, theme());
        },
        onTerminalInput(handler: typeof inputHandler) {
          terminalInputCalls++;
          inputHandler = handler;
          return () => {
            if (inputHandler === handler) inputHandler = undefined;
          };
        },
        notify(message: string) {
          notifications.push(message);
        },
        setFooter() {},
      },
    } as any,
    get inputHandler() {
      return inputHandler;
    },
    get widget() {
      return widget;
    },
    get terminalInputCalls() {
      return terminalInputCalls;
    },
    get notifications() {
      return notifications;
    },
  };
}

test("lazy-proxy tui: regular stands down without mouse reporting (terminal scrollback preserved)", async () => {
  const tool = createTool("tool-1");
  const { terminal, writes } = createTerminalFixture();
  let renderer = createRenderer("regular", [tool], terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  const { pi, events } = runtime();
  claudeCodeStyleExtension(pi as any, { mode: "on" });
  await events.get("session_start")?.({}, ui.ctx);

  expect(ui.terminalInputCalls).toBe(1);
  // regular lazy proxy 不启用任何 reporting：终端回滚（滚轮）必须保持原生行为。
  expect(
    !writes.some((value) => value.includes("?1000h")),
    "no click reporting in regular",
  ).toBeTruthy();
  expect(
    !writes.some((value) => value.includes("?1003h")),
    "no motion reporting in regular",
  ).toBeTruthy();

  // 不得捕获回写惰性 Proxy 方法，也不得递归。
  renderer.doRender();
  renderer.handleInput("x");
  expect(renderer.doRenderCalls).toBe(1);

  // 无 reporting：SGR 点击不会到达扩展（终端不产生），handler 对键盘/其他输入让位。
  const hintCol = tool.render()[1].indexOf("/ click") + 1;
  expect(ui.inputHandler?.(`\x1b[<0;${hintCol};2M`)).toBe(undefined);
  expect(tool.expanded).toBe(false);

  installToolMouseInteraction({});
  expect(
    !writes.some(
      (value) => value.includes("?1000l") && value.includes("?1006l"),
    ),
    "teardown does not touch terminal mouse modes it never enabled",
  ).toBeTruthy();
});

/** 官方 LayoutFrame 树的最小模型。 */
type FakeBox = {
  component: any;
  parent?: FakeBox;
  rect: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
  children: FakeBox[];
  lines?: string[];
  scrollView?: FakeScrollView;
  scrollContentLines?: string[];
};

type FakeScrollView = {
  isScrollbarVisible: boolean;
  scrollTop: number;
  isFollowingEnd: boolean;
  getContentWidth(width: number): number;
};

/** 官方 TuiAltScreen 布局树的最小模型：leaf box 是容器（documentContainer/
 * widgetContainer），工具卡与按钮在其 children 内，按行定位。 */
function fullscreenLayout(tool: any, widget: any, scrollbarVisible = false) {
  const tools = Array.isArray(tool) ? tool : [tool];
  const toolLines = tools.flatMap((t: any) => t.render(80));
  const docContainer: any = { children: tools };
  const toolBox: FakeBox = {
    component: docContainer,
    rect: { x: 0, y: 0, width: 80, height: toolLines.length },
    clip: { x: 0, y: 0, width: 80, height: 20 },
    children: [],
    lines: toolLines,
  };
  const widgetLines = widget ? widget.render(80) : [];
  const widgetContainer: any = { children: widget ? [widget] : [] };
  const widgetBox: FakeBox = {
    component: widgetContainer,
    rect: { x: 0, y: 20, width: 80, height: Math.max(1, widgetLines.length) },
    clip: { x: 0, y: 20, width: 80, height: 4 },
    children: [],
    lines: widgetLines,
  };
  const scrollBox: FakeBox = {
    component: null,
    rect: { x: 0, y: 0, width: 80, height: 20 },
    clip: { x: 0, y: 0, width: 80, height: 20 },
    children: [toolBox],
    scrollView: {
      isScrollbarVisible: scrollbarVisible,
      scrollTop: 0,
      isFollowingEnd: true,
      // 与官方一致：滚动条可见时内容宽度让出最后一列。
      getContentWidth: (width: number) =>
        scrollbarVisible ? Math.max(1, width - 1) : width,
    },
    scrollContentLines: toolBox.lines,
  };
  const dockBox: FakeBox = {
    component: null,
    rect: { x: 0, y: 20, width: 80, height: 4 },
    clip: { x: 0, y: 20, width: 80, height: 4 },
    children: [widgetBox],
  };
  return {
    root: {
      component: null,
      rect: { x: 0, y: 0, width: 80, height: 24 },
      clip: { x: 0, y: 0, width: 80, height: 24 },
      children: [scrollBox, dockBox],
    },
    primaryScrollView: scrollBox.scrollView,
  };
}

class FullscreenRenderer {
  mode = "fullscreen";
  children: any[];
  terminal: any;
  officialInputs: string[] = [];
  currentLayout: any;
  scrollBottomCalls = 0;
  renderCalls = 0;
  wheelScrollLines = 1;
  altScreenActive = true;
  mouseEnabled = true;

  constructor(tool: any, widget: any, terminal: any) {
    this.children = [tool];
    this.terminal = terminal;
    this.currentLayout = fullscreenLayout(tool, widget);
  }

  // 官方链：原型方法，实例包装后作为 original 放行目标。
  handleViewportInput(data: string) {
    this.officialInputs.push(data);
    return { consume: true };
  }

  requestRender() {
    this.renderCalls++;
  }

  render(width: number) {
    return this.children.flatMap((child: any) => child.render(width));
  }

  hasOverlay() {
    return false;
  }

  scrollToBottom() {
    this.scrollBottomCalls++;
    this.currentLayout.primaryScrollView.isFollowingEnd = true;
  }

  getPrimaryScrollView() {
    return this.currentLayout.primaryScrollView;
  }

  get isFollowingOutput() {
    return this.currentLayout.primaryScrollView.isFollowingEnd;
  }
}

test("lazy-proxy tui: fullscreen owns all-motion under a multiplexer", () => {
  const previousTmux = process.env.TMUX;
  process.env.TMUX = "test";
  const tool = createTool("tool-motion");
  const { terminal, writes } = createTerminalFixture();
  let renderer: FullscreenRenderer | RendererStub = new FullscreenRenderer(
    tool,
    null,
    terminal,
  );
  renderer.altScreenActive = false;
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    expect(
      !writes.some((value) => value.includes("?1003h")),
      "startup is not preempted",
    ).toBeTruthy();
    renderer.altScreenActive = true;
    ui.widget.render();
    expect(
      writes.some((value) => value.includes("?1003h")),
      "hover motion is enabled after startup",
    ).toBeTruthy();
    const disablesBeforeSwitch = writes.filter((value) =>
      value.includes("?1003l"),
    ).length;
    renderer = createRenderer("regular", [tool], terminal);
    ui.widget.render();
    expect(
      writes.filter((value) => value.includes("?1003l")).length,
      "fullscreen → regular releases owned motion",
    ).toBe(disablesBeforeSwitch + 1);
    installToolMouseInteraction({});
  } finally {
    installToolMouseInteraction({});
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  }
});

test("lazy-proxy tui: fullscreen tool clicks expand and official input passes through", async () => {
  // 步进数来自用户配置，测试固定为默认 3（避免受本机 claude-code-style.json 影响）。
  const previousStep = config.scrollStepLines;
  config.scrollStepLines = 3;
  const tool = createTool("tool-fullscreen");
  const { terminal, writes } = createTerminalFixture();
  let renderer = new FullscreenRenderer(tool, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  expect(
    renderer.wheelScrollLines,
    "fullscreen native wheel step is raised to 3",
  ).toBe(3);
  expect(
    !writes.some((value) => value.includes("?1000h")),
    "click reporting belongs to official",
  ).toBeTruthy();
  expect(
    writes.some((value) => value.includes("?1003h")),
    "extension reasserts hover motion after official startup",
  ).toBeTruthy();
  // collapsed 仅 hint 文本可点；同一行正文/留白必须放行官方。
  tui.handleViewportInput(`\x1b[<0;2;2M`);
  expect(tool.expanded, "tool row outside hint is not clickable").toBe(false);
  expect(renderer.officialInputs.length).toBe(1);
  renderer.officialInputs.length = 0;
  const collapsedHintCol =
    tool.render()[1].indexOf("(ctrl+o expand / click)") + 1;
  tui.handleViewportInput(`\x1b[<0;${collapsedHintCol};2M`);
  expect(tool.expanded).toBe(true);
  expect(
    renderer.officialInputs.length,
    "hint click consumed before official chain",
  ).toBe(0);
  expect(ui.widget.render()).toStrictEqual([]);

  // 展开卡单击不收起；双击折叠。
  tui.handleViewportInput(`\x1b[<0;20;2M`);
  expect(tool.expanded, "single click on expanded card does not collapse").toBe(
    true,
  );
  tui.handleViewportInput(`\x1b[<0;20;2M`);
  expect(tool.expanded).toBe(false);

  // hover：先经过 dock，再到 collapsed 工具行；dock 空缓存不得污染同一布局的工具缓存。
  renderer.officialInputs.length = 0;
  tui.handleViewportInput(`\x1b[<32;20;22M`);
  const renderCallsBefore = renderer.renderCalls;
  tui.handleViewportInput(`\x1b[<32;20;2M`);
  expect(renderer.officialInputs.length, "motion reaches official chain").toBe(
    2,
  );
  expect(
    renderer.renderCalls > renderCallsBefore,
    "hover state change triggers render",
  ).toBeTruthy();
  // 同位置再 hover：状态无变化，不重复渲染。
  tui.handleViewportInput(`\x1b[<32;20;2M`);
  expect(renderer.renderCalls, "unchanged hover skips render").toBe(
    renderCallsBefore + 1,
  );
  // hover 移出工具行：清除高亮状态。
  tui.handleViewportInput(`\x1b[<32;20;22M`);
  expect(
    renderer.renderCalls > renderCallsBefore + 1,
    "hover leave clears state",
  ).toBeTruthy();

  // 滚动后 leaf.localRow 已是文档行，不得再次叠加 scrollTop。
  const filler = {
    render: () => Array.from({ length: 50 }, (_, i) => `history ${i}`),
  };
  const scrolledLayout = fullscreenLayout([filler, tool], null);
  const scrollBox = scrolledLayout.root.children[0];
  scrollBox.scrollView!.scrollTop = 50;
  scrollBox.children[0].rect.y = -50;
  renderer.currentLayout = scrolledLayout;
  const scrolledHoverRenders = renderer.renderCalls;
  tui.handleViewportInput(`\x1b[<32;20;2M`);
  expect(
    renderer.renderCalls > scrolledHoverRenders,
    "scrolled tool hover uses document row once",
  ).toBeTruthy();

  // single-expand：展开 A 后再点 B，A 自动收起。
  const toolA = createTool("tool-a");
  const toolB = createTool("tool-b");
  const motionWritesBeforeSwitch = writes.filter((value) =>
    value.includes("?1003h"),
  ).length;
  renderer = new FullscreenRenderer([toolA, toolB], ui.widget, terminal);
  ui.widget.render(); // 官方每帧渲染 dock → 新 renderer 重装 wrapper/上报
  expect(
    writes.filter((value) => value.includes("?1003h")).length,
    "renderer switch re-enables hover motion",
  ).toBe(motionWritesBeforeSwitch + 1);
  const tui2 = createLazyProxy(() => renderer);
  renderer.currentLayout = fullscreenLayout([toolA, toolB], null);
  const toolAHintCol = toolA.render()[1].indexOf("(ctrl+o expand / click)") + 1;
  const toolBHintCol = toolB.render()[1].indexOf("(ctrl+o expand / click)") + 1;
  tui2.handleViewportInput(`\x1b[<0;${toolAHintCol};2M`);
  expect(toolA.expanded, "first hint click expands A").toBe(true);
  tui2.handleViewportInput(`\x1b[<0;${toolBHintCol};4M`);
  expect(toolA.expanded, "expanding B collapses A").toBe(false);
  expect(toolB.expanded).toBe(true);

  // 回到底部按钮：滚动离开底部后按钮可见，点击触发 scrollToBottom。
  renderer = new FullscreenRenderer(tool, ui.widget, terminal);

  // 非工具区域（dock 行）：放行官方。
  tui.handleViewportInput(`\x1b[<0;20;22M`);
  expect(
    renderer.officialInputs.length,
    "dock click reaches official chain",
  ).toBe(1);

  // 滚动条列：放行官方拖动。
  renderer.currentLayout = fullscreenLayout(tool, null, true);
  tui.handleViewportInput(`\x1b[<0;80;2M`);
  expect(
    renderer.officialInputs.length,
    "scrollbar column reaches official chain",
  ).toBe(2);

  // 含 OSC8 链接行（普通/参数化）：放行官方 URL 点击。
  for (const [toolId, linkLine] of [
    ["tool-url", `  \x1b]8;;https://x\x07link\x1b]8;;\x07`],
    ["tool-url-param", `  \x1b]8;id=42;https://x\x07link\x1b]8;;\x07`],
  ] as const) {
    renderer.currentLayout = fullscreenLayout(
      { ...createTool(toolId), render: () => ["✓ url", linkLine] },
      null,
    );
    const officialBefore: number = renderer.officialInputs.length;
    tui.handleViewportInput(`\x1b[<0;10;2M`);
    expect(
      renderer.officialInputs.length,
      `OSC8 link row reaches official chain (${toolId})`,
    ).toBe(officialBefore + 1);
  }

  // show-more：expanded 工具卡渲染截断 Input/Output 头，点击 [show more] 打开预览。
  // 真实 ANSI 主题：拆分样式（点 dim / 文字 text）后 indexOf 仍按可见文本命中。
  const ansiTheme = {
    fg: (color: string, text: string) =>
      `\x1b[${color === "text" ? "97" : color === "dim" ? "90" : "37"}m${text}\x1b[39m`,
  };
  const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
    "\n",
  );
  const ioView = new ExpandedToolIoView(
    ansiTheme,
    "arg: 1",
    longOutput,
    false,
    3,
    3,
  );
  ioView.render(80); // 触发截断状态与 show-more 头行记录
  const showMoreTool = createTool("tool-show-more");
  showMoreTool.expanded = true;
  showMoreTool.resultRendererComponent = ioView;
  showMoreTool.render = () => ioView.render(80);
  renderer = new FullscreenRenderer(showMoreTool, ui.widget, terminal);
  ui.widget.render(); // 官方每帧渲染 dock → 新 renderer 重装 wrapper
  renderer.currentLayout = fullscreenLayout(showMoreTool, null);
  const ioLines = ioView.render(80);
  const moreHeader = ioView.showMoreHeaderLineIndexes()[0];
  const moreRow = moreHeader.line;
  const moreCol =
    ioLines[moreRow]
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .indexOf(SHOW_MORE_LABEL) + 1;
  const notifiedBefore = ui.notifications.length;
  const officialBeforeShowMore = renderer.officialInputs.length;
  tui.handleViewportInput(`\x1b[<0;${moreCol};${moreRow + 1}M`);
  expect(
    ui.notifications.length > notifiedBefore,
    "show-more click opens the preview (custom unavailable → notify)",
  ).toBeTruthy();
  expect(moreHeader.section).toBe("output");
  expect(
    renderer.officialInputs.length,
    "show-more click consumed, official untouched",
  ).toBe(officialBeforeShowMore);

  // 回到底部按钮：滚动离开底部后按钮可见，点击触发 scrollToBottom。
  renderer = new FullscreenRenderer(tool, ui.widget, terminal);
  renderer.currentLayout.primaryScrollView.isFollowingEnd = false;
  renderer.currentLayout.primaryScrollView.scrollTop = 50;
  ui.widget.render(80); // renderer 切换后重新安装点击包装
  tui.handleViewportInput(`\x1b[<65;10;2M`); // wheel：同步按钮显隐
  await new Promise<void>((resolve) => process.nextTick(resolve));
  expect(
    ui.widget.render(80)[0]?.includes("↓"),
    "wheel away from bottom shows the button",
  ).toBeTruthy();
  tui.handleViewportInput(`\x1b[<0;40;21M`);
  expect(renderer.scrollBottomCalls, "button click scrolls to bottom").toBe(1);
  expect(ui.widget.render(80)).toStrictEqual([]);

  // 按钮 hover：motion 到按钮行高亮（accent → text），离开恢复。
  renderer.currentLayout.primaryScrollView.isFollowingEnd = false;
  renderer.currentLayout.primaryScrollView.scrollTop = 50;
  ui.widget.render(80);
  tui.handleViewportInput(`\x1b[<65;10;2M`); // wheel：按钮重新出现
  await new Promise<void>((resolve) => process.nextTick(resolve));
  renderer.currentLayout = fullscreenLayout(tool, ui.widget, false); // 重建布局（按钮行已可见）
  tui.handleViewportInput(`\x1b[<32;40;21M`); // motion 到按钮行
  expect(
    ui.widget.render(80)[0]?.includes("<text>[ ↓"),
    "button hover switches label to text color",
  ).toBeTruthy();
  tui.handleViewportInput(`\x1b[<32;10;21M`); // motion 移出按钮行
  expect(
    ui.widget.render(80)[0]?.includes("<accent>[ ↓"),
    "hover leave restores accent color",
  ).toBeTruthy();

  // 键盘滚动（官方 PageUp）：同样同步按钮显隐（官方消费按键，扩展监听器无法补偿）。
  renderer.currentLayout.primaryScrollView.isFollowingEnd = false;
  renderer.currentLayout.primaryScrollView.scrollTop = 30;
  ui.widget.render(80);
  tui.handleViewportInput("\x1b[5~"); // PageUp
  await new Promise<void>((resolve) => process.nextTick(resolve));
  expect(
    ui.widget.render(80)[0]?.includes("↓"),
    "PageUp away from bottom shows the button",
  ).toBeTruthy();
  ui.inputHandler?.("\x1b[8^"); // Ctrl+End 官方不消费，经 onTerminalInput 回到底部
  expect(renderer.scrollBottomCalls, "Ctrl+End scrolls to bottom").toBe(2);
  expect(ui.widget.render(80)).toStrictEqual([]);
  installToolMouseInteraction({});
  config.scrollStepLines = previousStep;
  expect(renderer.wheelScrollLines, "teardown restores native wheel step").toBe(
    1,
  );
});

test("lazy-proxy tui: fullscreen compact assistant hint toggles and hovers", () => {
  const previousMode = config.mode;
  const previousTheme = getMessageDisplayTheme();
  config.mode = "compact";
  setMessageDisplayTheme({ fg: (_color: string, text: string) => text } as any);
  const compact = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  const message = {
    role: "assistant",
    timestamp: 1,
    content: [
      { type: "text", text: "checking" },
      {
        type: "toolCall",
        id: "call-1",
        name: "bash",
        arguments: { command: "echo" },
      },
    ],
  };
  const assistant = new AssistantMessageComponent(message as any, true) as any;
  assistant.updateContent(message);
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(assistant, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    ui.widget.render();
    renderer.currentLayout = fullscreenLayout(assistant, null);
    const renderedAssistant = assistant.render(80);
    const hintRow = renderedAssistant.findIndex((line: string) =>
      line.includes("click to show more"),
    );
    const collapsedLine = renderedAssistant[hintRow] ?? "";
    const hintCol = collapsedLine.indexOf("click to show more") + 1;
    expect(hintRow >= 0 && hintCol > 0).toBeTruthy();

    const rendersBeforeHover = renderer.renderCalls;
    tui.handleViewportInput(`\x1b[<32;${hintCol};${hintRow + 1}M`);
    expect(
      renderer.renderCalls > rendersBeforeHover,
      "assistant hint hover triggers render",
    ).toBeTruthy();

    tui.handleViewportInput(`\x1b[<0;${hintCol};${hintRow + 1}M`);
    expect(assistant.expanded).toBe(true);
    renderer.currentLayout = fullscreenLayout(assistant, null);
    tui.handleViewportInput(`\x1b[<0;2;1M`);
    expect(
      assistant.expanded,
      "single click on expanded assistant does not collapse",
    ).toBe(true);
    tui.handleViewportInput(`\x1b[<0;2;1M`);
    expect(
      assistant.expanded,
      "double-click collapses the assistant card",
    ).toBe(false);
  } finally {
    installToolMouseInteraction({});
    compact.shutdown();
    config.mode = previousMode;
    setMessageDisplayTheme(previousTheme);
  }
});

test("lazy-proxy tui: fullscreen compact expanded round thinking hint expands in place", () => {
  const previousMode = config.mode;
  config.mode = "compact";
  const dirHandlers = new Map<string, Function[]>();
  const pi = {
    on(name: string, handler: Function) {
      const list = dirHandlers.get(name) ?? [];
      list.push(handler);
      dirHandlers.set(name, list);
    },
    appendEntry() {},
  } as any;
  const emit = (name: string, event: any = {}, ctx: any = {}) => {
    for (const handler of dirHandlers.get(name) ?? []) handler(event, ctx);
  };
  const thinkingCtx = {
    mode: "tui",
    sessionManager: { getBranch: () => [], getEntries: () => [] },
    ui: { theme: {}, setWidget() {}, requestRender() {} },
  };
  installCompactThinking(pi, {
    useSummaryTitlesAsThinkingTitle: false,
    previewLines: 0,
    animationIntervalMs: 30,
  });
  emit("session_start", {}, thinkingCtx);
  const compact = installCompactMode({
    writeMetadata: new WriteExecutionMetadataStore(),
  });
  const message = {
    role: "assistant",
    timestamp: 1,
    content: [
      { type: "thinking", thinking: "plan the click path" },
      {
        type: "toolCall",
        id: "b1",
        name: "bash",
        arguments: { command: "echo" },
      },
    ],
  };
  const assistant = new AssistantMessageComponent(message as any, true) as any;
  assistant.updateContent(message);
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(assistant, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    ui.widget.render();
    assistant.setExpanded(true);
    renderer.currentLayout = fullscreenLayout(assistant, null);
    const rendered = assistant.render(80);
    const hintRow = rendered.findIndex((line: string) =>
      line.includes("to show more"),
    );
    const plain = (rendered[hintRow] ?? "").replace(
      /\x1b\[[0-?]*[ -/]*[@-~]/g,
      "",
    );
    const hintCol = plain.indexOf("to show more") + 1;
    expect(
      hintRow >= 0 && hintCol > 0,
      `expected thinking hint, got: ${plain}`,
    ).toBeTruthy();

    const findThinking = (node: any): ThinkingPreviewBlock | undefined => {
      if (node instanceof ThinkingPreviewBlock) return node;
      for (const child of node?.children ?? []) {
        const hit = findThinking(child);
        if (hit) return hit;
      }
    };
    const block = findThinking(assistant);
    expect(
      block,
      "expanded round keeps the thinking block in the tree",
    ).toBeTruthy();

    tui.handleViewportInput(`\x1b[<0;${hintCol};${hintRow + 1}M`);
    expect(block!.expanded, "thinking hint click expands the preview").toBe(
      true,
    );
    expect(assistant.expanded, "round stays open").toBe(true);
    renderer.currentLayout = fullscreenLayout(assistant, null);
    const expandedRow = assistant
      .render(80)
      .findIndex((line: string) => line.includes("plan the click path"));
    expect(expandedRow >= 0, "expanded thinking body is visible").toBeTruthy();
    tui.handleViewportInput(`\x1b[<0;4;${expandedRow + 1}M`);
    tui.handleViewportInput(`\x1b[<0;4;${expandedRow + 1}M`);
    expect(block!.expanded, "double-click collapses nested thinking").toBe(
      false,
    );
    expect(assistant.expanded, "round stays open after thinking collapse").toBe(
      true,
    );
  } finally {
    installToolMouseInteraction({});
    compact.shutdown();
    emit("session_shutdown", {}, thinkingCtx);
    config.mode = previousMode;
  }
});

test("lazy-proxy tui: fullscreen hover uses scroll ancestor content width after reload", async () => {
  const wrap = (label: string) => ({
    render: (width: number) => (width === 80 ? [label] : [label, `${label}-2`]),
    invalidate() {},
  });
  const toolA = createTool("width-tool-a");
  const toolB = createTool("width-tool-b");
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(toolB, null, terminal);
  const doc: any = {
    children: [wrap("message-1"), toolA, wrap("message-2"), toolB],
  };
  const docLines = doc.children.flatMap((child: any) => child.render(79));
  const toolBox: FakeBox = {
    component: doc,
    rect: { x: 0, y: 0, width: 79, height: docLines.length },
    clip: { x: 0, y: 0, width: 79, height: 20 },
    children: [],
    lines: docLines,
  };
  const scrollBox: FakeBox = {
    component: null,
    rect: { x: 0, y: 0, width: 80, height: 20 },
    clip: { x: 0, y: 0, width: 80, height: 20 },
    children: [toolBox],
    scrollView: {
      isScrollbarVisible: true,
      scrollTop: 0,
      isFollowingEnd: true,
      getContentWidth: (width: number) => Math.max(1, width - 1),
    },
    scrollContentLines: docLines,
  };
  const root: FakeBox = {
    component: null,
    rect: { x: 0, y: 0, width: 80, height: 24 },
    clip: { x: 0, y: 0, width: 80, height: 24 },
    children: [scrollBox],
  };
  toolBox.parent = scrollBox;
  scrollBox.parent = root;
  renderer.currentLayout = { root, primaryScrollView: scrollBox.scrollView };
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  const hintCol = docLines[7].indexOf("/ click") + 1;
  const rendersBefore = renderer.renderCalls;
  tui.handleViewportInput(`\x1b[<32;${hintCol};8M`);
  expect(sharedToolHoverState().toolCallId).toBe("width-tool-b");
  expect(renderer.renderCalls).toBe(rendersBefore + 1);
  // isToolCallHovered 已移入 hover.ts（interaction.ts 不再 re-export）；
  // reload 语义不变：reset 走 interaction.ts 原生导出，状态读 globalThis 槽。
  expect(isToolCallHovered("width-tool-b")).toBe(true);
  const reloadSpecifier = `../../extensions/layouts/context/renderer/mouse/interaction.ts?reload=${Date.now()}`;
  const reloadedMouse: typeof import("../../extensions/layouts/context/renderer/mouse/interaction.ts") =
    await import(reloadSpecifier);
  reloadedMouse.resetToolHoverState();
  expect(
    isToolCallHovered("width-tool-b"),
    "hover state is shared across reloads",
  ).toBe(false);
  installToolMouseInteraction({});
});

test("lazy-proxy tui: fullscreen multitool group hover and click toggle", () => {
  const patch = {
    groups: new Set(),
    theme: { fg: (_color: string, text: string) => text },
  };
  const group = new ToolGroupComponent(patch as any);
  const first = Object.assign(createTool("group-1"), {
    toolName: "read",
    result: { isError: false },
  });
  const second = Object.assign(createTool("group-2"), {
    toolName: "bash",
    result: { isError: false },
  });
  group.addTool(first);
  group.addTool(second);
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(group, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  const hintCol = group.render(80)[1].indexOf("click to show more") + 1;
  tui.handleViewportInput(`\x1b[<32;${hintCol};2M`);
  expect((group as any).hintHovered, "group hint hover is enabled").toBe(true);
  tui.handleViewportInput(`\x1b[<32;1;2M`);
  expect((group as any).hintHovered, "moving outside hint clears hover").toBe(
    false,
  );
  tui.handleViewportInput(`\x1b[<0;${hintCol};2M`);
  expect((group as any).expanded, "group click expands all children").toBe(
    true,
  );
  tui.handleViewportInput(`\x1b[<0;${hintCol};2M`);
  expect(
    (group as any).expanded,
    "single click on expanded group does not collapse",
  ).toBe(true);
  tui.handleViewportInput(`\x1b[<0;${hintCol};2M`);
  expect((group as any).expanded, "double-click collapses all children").toBe(
    false,
  );
  installToolMouseInteraction({});
});

test("lazy-proxy tui: double-click collapses thinking after preview rebuild", () => {
  const dirHandlers = new Map<string, Function[]>();
  const pi = {
    on(name: string, handler: Function) {
      const list = dirHandlers.get(name) ?? [];
      list.push(handler);
      dirHandlers.set(name, list);
    },
    appendEntry() {},
  } as any;
  const emit = (name: string, event: any = {}, ctx: any = {}) => {
    for (const handler of dirHandlers.get(name) ?? []) handler(event, ctx);
  };
  const thinkingCtx = {
    mode: "tui",
    sessionManager: { getBranch: () => [], getEntries: () => [] },
    ui: { theme: {}, setWidget() {}, requestRender() {} },
  };
  installCompactThinking(pi, {
    useSummaryTitlesAsThinkingTitle: false,
    previewLines: 3,
    animationIntervalMs: 30,
  });
  emit("session_start", {}, thinkingCtx);
  const timestamp = 42;
  const body = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_slot: string, text: string) => text,
  } as any;
  const makeBlock = () =>
    new ThinkingPreviewBlock(
      "Thought for 1s",
      body,
      1,
      timestamp,
      (text) => text,
      theme,
    );
  const first = makeBlock();
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(first, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    const hintCol =
      (first.render(80)[0] ?? "").indexOf("click to show more") + 1;
    expect(hintCol > 0, "expected click hint").toBeTruthy();
    tui.handleViewportInput(`\x1b[<0;${hintCol};1M`);
    expect(first.expanded).toBe(true);
    renderer.currentLayout = fullscreenLayout(first, null);
    tui.handleViewportInput("\x1b[<0;2;1M");
    const rebuilt = makeBlock();
    expect(rebuilt.expanded, "rebuild keeps expanded via timestamp").toBe(true);
    renderer.currentLayout = fullscreenLayout(rebuilt, null);
    tui.handleViewportInput("\x1b[<0;2;1M");
    expect(rebuilt.expanded, "double-click uses timestamp, not instance").toBe(
      false,
    );
  } finally {
    installToolMouseInteraction({});
    emit("session_shutdown", {}, thinkingCtx);
  }
});

test("lazy-proxy tui: thinking double-click identity is per run", () => {
  const dirHandlers = new Map<string, Function[]>();
  const pi = {
    on(name: string, handler: Function) {
      const list = dirHandlers.get(name) ?? [];
      list.push(handler);
      dirHandlers.set(name, list);
    },
    appendEntry() {},
  } as any;
  const emit = (name: string, event: any = {}, ctx: any = {}) => {
    for (const handler of dirHandlers.get(name) ?? []) handler(event, ctx);
  };
  const thinkingCtx = {
    mode: "tui",
    sessionManager: { getBranch: () => [], getEntries: () => [] },
    ui: { theme: {}, setWidget() {}, requestRender() {} },
  };
  installCompactThinking(pi, {
    useSummaryTitlesAsThinkingTitle: false,
    previewLines: 3,
    animationIntervalMs: 30,
  });
  emit("session_start", {}, thinkingCtx);
  const timestamp = 99;
  const body = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_slot: string, text: string) => text,
  } as any;
  const runA = new ThinkingPreviewBlock(
    "Thought for 1s",
    body,
    1,
    timestamp,
    (text) => text,
    theme,
    0,
  );
  const runB = new ThinkingPreviewBlock(
    "Thought for 2s",
    body,
    1,
    timestamp,
    (text) => text,
    theme,
    4,
  );
  runA.setExpanded(true);
  runB.setExpanded(true);
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(runA, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    renderer.currentLayout = fullscreenLayout(runA, null);
    tui.handleViewportInput("\x1b[<0;2;1M");
    expect(runA.expanded, "first click on run A does not collapse").toBe(true);
    renderer.currentLayout = fullscreenLayout(runB, null);
    tui.handleViewportInput("\x1b[<0;2;1M");
    expect(runB.expanded, "click on run B is not a double-click of run A").toBe(
      true,
    );
    tui.handleViewportInput("\x1b[<0;2;1M");
    expect(runB.expanded, "second click on run B collapses that run").toBe(
      false,
    );
    expect(runA.expanded, "run A instance stays expanded").toBe(true);
  } finally {
    installToolMouseInteraction({});
    emit("session_shutdown", {}, thinkingCtx);
  }
});

test("lazy-proxy tui: fullscreen skill hint click expands like other cards", () => {
  const previousMode = config.mode;
  config.mode = "on";
  const dispose = installMessageDisplayRendering();
  setMessageDisplayTheme({ fg: (_color: string, text: string) => text } as any);
  const skill = new SkillInvocationMessageComponent(
    {
      name: "ponytail",
      content: "**lazy** content",
      userMessage: null,
    } as unknown as ParsedSkillBlock,
    getMarkdownTheme(),
  );
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(skill, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  try {
    installToolMouseInteraction(ui.ctx);
    const heading = skill.render(80)[0] ?? "";
    const plain = heading.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const hintCol = plain.indexOf("to show more") + 1;
    expect(hintCol > 0, `expected show-more hint, got: ${plain}`).toBeTruthy();
    tui.handleViewportInput(`\x1b[<32;${hintCol};1M`);
    expect((skill as any).hintHovered, "skill hint hover is enabled").toBe(
      true,
    );
    tui.handleViewportInput(`\x1b[<32;1;1M`);
    expect((skill as any).hintHovered, "moving outside hint clears hover").toBe(
      false,
    );
    tui.handleViewportInput(`\x1b[<0;${hintCol};1M`);
    expect((skill as any).expanded, "skill hint click expands").toBe(true);
    renderer.currentLayout = fullscreenLayout(skill, null);
    tui.handleViewportInput(`\x1b[<0;2;1M`);
    expect(
      (skill as any).expanded,
      "single click on expanded skill does not collapse",
    ).toBe(true);
    tui.handleViewportInput(`\x1b[<0;2;1M`);
    expect((skill as any).expanded, "double-click collapses skill").toBe(false);
  } finally {
    installToolMouseInteraction({});
    dispose();
    config.mode = previousMode;
  }
});

test("lazy-proxy tui: fullscreen expanded group child show-more hover highlights the header", () => {
  const patch = {
    groups: new Set(),
    theme: { fg: (_color: string, text: string) => text },
  };
  const group = new ToolGroupComponent(patch as any);
  const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
    "\n",
  );
  // 真实 ANSI 主题：拆分后的 show-more 样式（点 dim / 文字 text）可被命中逻辑识别。
  const ansiTheme = {
    fg: (color: string, text: string) =>
      `\x1b[${color === "text" ? "97" : color === "dim" ? "90" : "37"}m${text}\x1b[39m`,
  };
  const ioView = new ExpandedToolIoView(ansiTheme, "", longOutput, false, 2, 2);
  const child = Object.assign(createTool("group-child"), {
    toolName: "read",
    result: { isError: false },
    resultRendererComponent: ioView,
    render: (width: number) => ioView.render(width),
  });
  group.addTool(child);
  group.addTool(
    Object.assign(createTool("group-sibling"), {
      toolName: "bash",
      result: { isError: false },
    }),
  );
  group.setExpanded(true);

  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(group, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);
  try {
    const stripAnsi = (line: string) =>
      line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const lines = group.render(80);
    const row = lines.findIndex(
      (line, index) =>
        index > 1 &&
        stripAnsi(line).includes("Output") &&
        stripAnsi(line).includes(SHOW_MORE_LABEL),
    );
    expect(
      row > 1,
      "grouped child renders an Output show-more header",
    ).toBeTruthy();
    const col = stripAnsi(lines[row]).indexOf(SHOW_MORE_LABEL) + 1;
    const before = lines[row];

    tui.handleViewportInput(`\x1b[<32;${col};${row + 1}M`);

    const after = group.render(80)[row];
    expect(after).not.toBe(before);
    expect(after).toMatch(
      /\x1b\[90m •\x1b\[39m\x1b\[97m click to show more\x1b\[39m/,
    );

    tui.handleViewportInput(`\x1b[<0;${col};${row + 1}M`);
    expect(ui.notifications.length, "child show-more click opens preview").toBe(
      1,
    );
    expect(group.expanded, "show-more click keeps the group expanded").toBe(
      true,
    );
    const bodyRow = group
      .render(80)
      .findIndex((line) => line.includes("line 0"));
    expect(bodyRow > row).toBeTruthy();
    tui.handleViewportInput(`\x1b[<0;10;${bodyRow + 1}M`);
    expect(
      group.expanded,
      "single click on expanded group body does not collapse",
    ).toBe(true);
    tui.handleViewportInput(`\x1b[<0;10;${bodyRow + 1}M`);
    expect(group.expanded, "double-click collapses the whole group").toBe(
      false,
    );
  } finally {
    installToolMouseInteraction({});
  }
});

test("lazy-proxy tui: fullscreen hover ignores non-IO result renderer components", () => {
  const tool = createTool("tool-foreign-renderer");
  tool.expanded = true;
  tool.resultRendererComponent = { render: () => ["third-party result"] };
  const { terminal } = createTerminalFixture();
  const renderer = new FullscreenRenderer(tool, null, terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  expect(() => tui.handleViewportInput(`\x1b[<32;20;2M`)).not.toThrow();
  expect(
    renderer.officialInputs.length,
    "motion still reaches official chain",
  ).toBe(1);
  installToolMouseInteraction({});
});

test("lazy-proxy tui: fullscreen text preview receives mouse before official selection", async () => {
  const tool = createTool("tool-overlay");
  const terminal = { columns: 80, rows: 24, write() {} };
  const renderer = new FullscreenRenderer(tool, null, terminal);
  renderer.hasOverlay = () => true;
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  let component: any;
  const preview = showTextPreview(
    {
      ui: {
        custom: async (factory: any) =>
          await new Promise<void>((resolve) => {
            component = factory(tui, theme(), null, resolve);
          }),
      },
    } as any,
    "Output",
    "hello",
  );
  const result = tui.handleViewportInput(`\x1b[<0;67;4M`);
  expect(
    result,
    "preview mouse continues to the focused custom component",
  ).toBe(undefined);
  expect(
    renderer.officialInputs.length,
    "official selection does not consume preview mouse",
  ).toBe(0);
  component.handleInput("\x1b");
  await preview;
  installToolMouseInteraction({});
});

test("lazy-proxy tui: renderer replacement preserves fullscreen mouse ownership", () => {
  const tool = createTool("tool-switch");
  const { terminal, writes } = createTerminalFixture();
  // 交替持有官方全屏 renderer 与 regular/fullscreen 桩，验证切换不泄漏 mouse 状态。
  let renderer: FullscreenRenderer | RendererStub = new FullscreenRenderer(
    tool,
    null,
    terminal,
  );
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  expect(
    !writes.some((value) => value.includes("?1000h")),
    "initial fullscreen is untouched",
  ).toBeTruthy();
  const hintCol = tool.render()[1].indexOf("/ click") + 1;
  expect(ui.inputHandler?.(`\x1b[<0;${hintCol};2M`)).toBe(undefined);
  expect(tool.expanded).toBe(false);
  expect(ui.widget.render()).toStrictEqual([]);

  // fullscreen → regular：渲染层/上报均让位，插件不写任何 mouse reporting。
  renderer = createRenderer("regular", [tool], terminal);
  ui.widget.render();
  expect(
    !writes.some((value) => value.includes("?1000h")),
    "regular never enables reporting",
  ).toBeTruthy();

  // regular → fullscreen：官方先启用点击模式，插件只补 hover 所需的 1003。
  renderer = createRenderer("fullscreen", [tool], terminal);
  writes.push("OFFICIAL:\x1b[?1000h\x1b[?1002h\x1b[?1006h");
  const writesBeforeFullscreenRender = writes.length;
  ui.widget.render();
  expect(writes.length).toBe(writesBeforeFullscreenRender + 1);
  expect(writes.at(-1) ?? "").toMatch(/\?1003h/);

  // fullscreen stop 后切回 regular：官方关闭其模式；插件仍不写上报，保持终端原生回滚。
  writes.push("OFFICIAL:\x1b[?1006l\x1b[?1002l\x1b[?1000l");
  renderer = createRenderer("regular", [tool], terminal);
  ui.widget.render();
  expect(
    !writes.some(
      (value) => value.includes("?1000h") && !value.startsWith("OFFICIAL"),
    ),
    "back to regular stays reporting-free",
  ).toBeTruthy();

  // 当前 fullscreen teardown 不能误关官方 mouse mode。
  renderer = createRenderer("fullscreen", [tool], terminal);
  ui.widget.render();
  const writesBeforeTeardown = writes.length;
  installToolMouseInteraction({});
  const teardownWrites = writes.slice(writesBeforeTeardown);
  expect(
    !teardownWrites.some(
      (value) => value.includes("?1000l") || value.includes("?1006l"),
    ),
    "teardown keeps official click reporting",
  ).toBeTruthy();
});

test("lazy-proxy frame capture rolls back partial render wrappers on failure", () => {
  const first = createTool("tool-first");
  const originalRender = first.render;
  let reads = 0;
  const hostile = {
    toolCallId: "tool-hostile",
    expanded: false,
    setExpanded() {},
    invalidate() {},
    get render() {
      reads++;
      if (reads > 1) throw new Error("render getter failed");
      return () => ["✓ hostile", "  └ 1 line output (ctrl+o expand / click)"];
    },
  };
  const { terminal } = createTerminalFixture();
  let renderer = createRenderer("regular", [first, hostile], terminal);
  const tui = createLazyProxy(() => renderer);
  const ui = createUi(tui);
  installToolMouseInteraction(ui.ctx);

  expect(ui.inputHandler?.("\x1b[<0;20;2M")).toBe(undefined);
  expect(
    first.render,
    "earlier component render is restored after failure",
  ).toBe(originalRender);
  expect(
    first.render().every((line) => !line.includes("\x1b_cc:")),
  ).toBeTruthy();
  installToolMouseInteraction({});
});
