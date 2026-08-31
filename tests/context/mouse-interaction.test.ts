import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { createJiti } from "jiti";
import { expect, test } from "vitest";
import claudeCodeStyleExtension, {
  ExpandedToolIoView,
  installToolMouseInteraction,
  SHOW_MORE_LABEL,
} from "../../extensions/layouts/context/renderer/index.ts";
import {
  installToolGrouping,
  ToolGroupComponent,
} from "../../extensions/layouts/context/renderer/tool/grouping.ts";

initTheme("dark");

test("tool groups expand from their hint and collapse from any expanded group row", () => {
  const grouping = installToolGrouping(() => true);
  grouping.setTheme({
    fg: (color: string, text: string) =>
      color === "text" ? `\x1b[37m${text}\x1b[39m` : text,
  });
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  try {
    const ui = {
      theme: { fg: (_color: string, text: string) => text },
      requestRender() {},
    } as any;
    const parent = new Container() as any;
    for (const [name, id] of [
      ["read", "one"],
      ["bash", "two"],
    ] as const) {
      const component = new ToolExecutionComponent(
        name,
        id,
        {},
        {},
        undefined,
        ui,
        process.cwd(),
      ) as any;
      component.updateResult({
        content: [{ type: "text", text: "one\ntwo" }],
        isError: false,
      });
      parent.addChild(component);
    }
    const group = parent.children[0] as any;
    expect(group instanceof ToolGroupComponent).toBeTruthy();
    const tui = {
      terminal: { columns: 100, write() {} },
      children: [parent],
      previousLines: group.render(100),
      previousViewportTop: 0,
      requestRender() {},
      doRender() {
        this.previousLines = group.render(100);
      },
    };
    installToolMouseInteraction({
      mode: "tui",
      hasUI: true,
      ui: {
        setWidget(_key: string, factory: any) {
          factory?.(tui, ui.theme);
        },
        onTerminalInput(handler: typeof inputHandler) {
          inputHandler = handler;
          return () => undefined;
        },
      },
    });
    tui.doRender();
    // regular 模式不启用鼠标上报，提示文本为默认展开快捷键。
    const headerRow = tui.previousLines.findIndex((line: string) =>
      line.includes("to show more"),
    );
    expect(headerRow >= 0).toBeTruthy();
    const hintColumn = tui.previousLines[headerRow].indexOf("to show more") + 1;
    inputHandler?.(`\x1b[<32;${hintColumn};${headerRow + 1}M`);
    const hoveredHeader = group.render(100)[headerRow];
    expect(hoveredHeader).toMatch(/• \x1b\[37m[^\x1b]*to show more\x1b\[39m/);
    expect(hoveredHeader).not.toMatch(/\x1b\[37m•/);
    expect(
      inputHandler?.(`\x1b[<0;${hintColumn};${headerRow + 1}M`)?.consume,
    ).toBe(true);
    expect(group.expanded).toBe(true);

    tui.doRender();
    const bottomPaddingRow = tui.previousLines.length - 1;
    expect(tui.previousLines[bottomPaddingRow].trim()).toBe("");
    expect(inputHandler?.(`\x1b[<0;100;${bottomPaddingRow + 1}M`)).toBe(
      undefined,
    );
    expect(
      group.expanded,
      "single click on expanded group does not collapse",
    ).toBe(true);
    expect(
      inputHandler?.(`\x1b[<0;100;${bottomPaddingRow + 1}M`)?.consume,
    ).toBe(true);
    expect(group.expanded).toBe(false);
  } finally {
    installToolMouseInteraction({});
    grouping.shutdown();
  }
});

test("truncated tool summary remains clickable and highlights on hover", async () => {
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const writes: string[] = [];
  let renderRequests = 0;
  let toolRenderCalls = 0;
  const tool = {
    toolCallId: "tool-truncated",
    expanded: false,
    setExpanded(value: boolean) {
      this.expanded = value;
    },
    invalidate() {},
    render() {
      toolRenderCalls++;
      return ["✓ Agent(task)", "  └ output (23 more lines / click)"];
    },
  };
  const tui = {
    terminal: { columns: 40, write: (value: string) => writes.push(value) },
    children: [tool],
    previousLines: tool.render(),
    previousViewportTop: 0,
    handleInput() {},
    requestRender() {
      renderRequests++;
    },
    doRender() {
      this.previousLines = tool.render();
    },
  };
  installToolMouseInteraction({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, factory: any) {
        if (typeof factory === "function")
          factory(tui, { fg: (_c: string, text: string) => text });
      },
      onTerminalInput(handler: typeof inputHandler) {
        inputHandler = handler;
        return () => undefined;
      },
    },
  });
  tui.doRender();

  toolRenderCalls = 0;
  inputHandler?.("\x1b[<35;20;2M");
  await new Promise<void>((resolve) => process.nextTick(resolve));
  expect(renderRequests, "hover invalidates the summary renderer").toBe(1);
  expect(toolRenderCalls).toBe(0);

  tui.previousLines = ["ordinary transcript row"];
  inputHandler?.("\x1b[<35;20;1M");
  expect(
    toolRenderCalls,
    "input hit-testing does not render the tool tree",
  ).toBe(0);
  expect(renderRequests, "ordinary motion clears the old hover").toBe(2);

  tui.previousLines = [
    "✓ Agent(task)",
    "\x1b[31m  └ output (23 more lines / click)\x1b[0m",
  ];
  inputHandler?.("\x1b[<35;20;2M");
  expect(renderRequests, "ANSI summary hints remain hoverable").toBe(3);
  expect(inputHandler?.("\x1b[<0;5;2M")).toBe(undefined);
  expect(tool.expanded, "summary text and row padding are not clickable").toBe(
    false,
  );
  expect(inputHandler?.("\x1b[<0;30;2M")).toStrictEqual({ consume: true });
  expect(tool.expanded).toBe(true);

  installToolMouseInteraction({});
});

test("parenthesized rich diff hint highlights and expands on click", async () => {
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  let renderRequests = 0;
  const tool = {
    toolCallId: "edit-diff",
    expanded: false,
    setExpanded(value: boolean) {
      this.expanded = value;
    },
    invalidate() {},
    render() {
      return [
        "✓ Edit sample.ts",
        " … (29 more diff lines • click to show more)",
      ];
    },
  };
  const tui = {
    terminal: { columns: 80, write() {} },
    children: [tool],
    previousLines: tool.render(),
    previousViewportTop: 0,
    handleInput() {},
    requestRender() {
      renderRequests++;
    },
    doRender() {
      this.previousLines = tool.render();
    },
  };
  installToolMouseInteraction({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, factory: any) {
        if (typeof factory === "function")
          factory(tui, { fg: (_color: string, text: string) => text });
      },
      onTerminalInput(handler: typeof inputHandler) {
        inputHandler = handler;
        return () => undefined;
      },
    },
  });
  try {
    tui.doRender();
    inputHandler?.("\x1b[<35;35;2M");
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(renderRequests, "hover requests a repaint for white hint text").toBe(
      1,
    );
    expect(inputHandler?.("\x1b[<0;35;2M")).toStrictEqual({ consume: true });
    expect(tool.expanded).toBe(true);
  } finally {
    installToolMouseInteraction({});
  }
});

test("show-more hover targets the view rendered in the current frame after compact", () => {
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const theme = {
    fg: (color: string, text: string) =>
      color === "text" ? `\x1b[97m${text}\x1b[0m` : text,
    bold: (text: string) => text,
  };
  const staleView = new ExpandedToolIoView(
    theme,
    "old\ninput",
    "old\noutput",
    false,
    1,
    1,
  );
  const currentView = new ExpandedToolIoView(
    theme,
    "current\ninput",
    "current\noutput",
    false,
    1,
    1,
  );
  const tool = {
    toolCallId: "tool-after-compact",
    expanded: true,
    state: { ccstyleIoView: staleView },
    setExpanded(value: boolean) {
      this.expanded = value;
    },
    invalidate() {},
    render() {
      return ["✓ Tool", ...currentView.render(78)];
    },
  };
  const terminalPrototype = {
    get rows() {
      return 30;
    },
    write() {},
  };
  const terminal = Object.assign(Object.create(terminalPrototype), {
    columns: 80,
  });
  Object.defineProperty(terminal, "rows", {
    configurable: true,
    get: () => 25,
  });
  const tui: any = {
    terminal,
    children: [tool],
    previousLines: [] as string[],
    previousViewportTop: 0,
    handleInput(data: string) {
      inputHandler?.(data);
    },
    requestRender() {},
    doRender() {
      this.previousLines = tool.render();
    },
  };
  const interactionCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, factory: any) {
        if (typeof factory === "function") factory(tui, theme);
      },
      onTerminalInput(handler: typeof inputHandler) {
        inputHandler = handler;
        return () => undefined;
      },
    },
  };
  installToolMouseInteraction(interactionCtx);
  // 外部替换 doRender 后重装 wrapper；compact 安装新 wrapper 时不叠加。
  const retainedRender = tui.doRender;
  tui.doRender = function (this: any, ...args: any[]) {
    return Reflect.apply(retainedRender, this, args);
  };
  installToolMouseInteraction(interactionCtx);
  try {
    tui.doRender();
    const inputHeader = tui.previousLines[1];
    const col = inputHeader.indexOf("to show more") + 1;
    tui.handleInput(`\x1b[<35;${col};2M`);
    expect(currentView.render(78)[0]).toMatch(/\x1b\[97m/);
    expect(staleView.render(78)[0]).not.toMatch(/\x1b\[97m/);
  } finally {
    installToolMouseInteraction({});
  }
});

test("expanded tool group show-more opens preview instead of collapsing the group", () => {
  const grouping = installToolGrouping(() => true);
  grouping.setTheme({
    fg: (color: string, text: string) => text,
    bold: (text: string) => text,
    bg: (_slot: string, text: string) => text,
  });
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  let previewOpened = false;
  try {
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: (_slot: string, text: string) => text,
    };
    const ui = {
      theme,
      requestRender() {},
      custom: async (factory: any) => {
        previewOpened = true;
        factory?.(
          {
            requestRender() {},
            rows: 40,
            columns: 100,
          },
          theme,
          {},
          () => {},
        );
        return undefined;
      },
      notify() {},
    } as any;
    const parent = new Container() as any;
    for (const [name, id, body] of [
      ["read", "g1", "line1\nline2\nline3\nline4\nline5\nline6"],
      ["bash", "g2", "out1\nout2\nout3\nout4\nout5\nout6"],
    ] as const) {
      const component = new ToolExecutionComponent(
        name,
        id,
        {},
        {},
        undefined,
        ui,
        process.cwd(),
      ) as any;
      component.updateResult({
        content: [{ type: "text", text: body }],
        isError: false,
      });
      parent.addChild(component);
    }
    const group = parent.children[0] as any;
    expect(group instanceof ToolGroupComponent).toBeTruthy();
    group.setExpanded(true);
    const longOut = "x\n".repeat(30);
    const ioView = new ExpandedToolIoView(
      theme,
      "a\nb\nc\nd\ne",
      longOut,
      false,
      2,
      2,
    );
    const childTool = group.children[0] as Component & {
      setExpanded: (value: boolean) => void;
      expanded: boolean;
    };
    childTool.render = (width: number) => [
      `✓ child`,
      ...ioView.render(Math.max(1, width - 2)),
    ];
    childTool.setExpanded = (value: boolean) => {
      childTool.expanded = value;
    };
    childTool.expanded = true;
    const tui = {
      terminal: { columns: 100, write() {} },
      children: [parent],
      previousLines: [] as string[],
      previousViewportTop: 0,
      requestRender() {},
      doRender() {
        this.previousLines = group.render(100);
      },
    };
    installToolMouseInteraction({
      mode: "tui",
      hasUI: true,
      ui: {
        ...ui,
        setWidget(_key: string, factory: any) {
          factory?.(tui, theme);
        },
        onTerminalInput(handler: typeof inputHandler) {
          inputHandler = handler;
          return () => undefined;
        },
      },
    });
    tui.doRender();
    const showMoreRow = tui.previousLines.findIndex(
      (line: string) =>
        line.includes("Output") && line.includes("to show more"),
    );
    expect(
      showMoreRow >= 0,
      "expanded group must paint a show-more affordance",
    ).toBeTruthy();
    const col = tui.previousLines[showMoreRow].indexOf("to show more") + 1;
    inputHandler?.(`\x1b[<35;${col};${showMoreRow + 1}M`);
    const beforeExpanded = group.expanded;
    expect(inputHandler?.(`\x1b[<0;${col};${showMoreRow + 1}M`)?.consume).toBe(
      true,
    );
    expect(group.expanded, "show-more must not collapse the group").toBe(
      beforeExpanded,
    );
    expect(previewOpened, "show-more opens the text preview").toBe(true);
  } finally {
    installToolMouseInteraction({});
    grouping.shutdown();
  }
});

test("native mode hits the visible identical tool, not the offscreen duplicate", () => {
  let expanded: string | null = null;
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const createTool = (id: string) => ({
    toolCallId: id,
    expanded: false,
    setExpanded(value: boolean) {
      this.expanded = value;
      if (value) expanded = id;
    },
    invalidate() {},
    render: () => ["✓ Bash(same)", "  └ same output (1 more line / click)"],
  });
  const offscreen = createTool("native-offscreen");
  const visible = createTool("native-visible");
  const tui = {
    terminal: { columns: 80, rows: 4, write() {} },
    children: [offscreen, visible],
    previousLines: [] as string[],
    previousViewportTop: 0,
    handleInput() {},
    requestRender() {},
    render(width: number) {
      return this.children.flatMap((child: any) => child.render(width));
    },
    doRender() {
      this.previousLines = this.render(80);
      // Native TUI keeps the full buffer; viewport top selects the on-screen window.
      this.previousViewportTop = 2;
    },
  };
  installToolMouseInteraction({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, factory: any) {
        factory?.(tui, { fg: (_c: string, text: string) => text });
      },
      onTerminalInput(handler: typeof inputHandler) {
        inputHandler = handler;
        return () => undefined;
      },
    },
  });
  try {
    tui.doRender();
    // Screen row 2 = buffer index 3 (visible tool hint): 3 - 2 + 1 = 2.
    const hintCol = tui.previousLines[3].indexOf("/ click") + 1;
    expect(inputHandler?.(`\x1b[<0;${hintCol};2M`)).toStrictEqual({
      consume: true,
    });
    expect(expanded).toBe("native-visible");
    expect(offscreen.expanded).toBe(false);
  } finally {
    installToolMouseInteraction({});
  }
});

test("native mode hits offset columns after parent layout prefix", async () => {
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  let renderRequests = 0;
  const PREFIX = "    ";
  const toolLines = [
    "✓ Bash(echo ok)",
    "  └ 1 line output (ctrl+o expand / click)",
  ];
  const tool = {
    toolCallId: "prefixed-tool",
    expanded: false,
    setExpanded(value: boolean) {
      this.expanded = value;
    },
    invalidate() {},
    render: () => toolLines.slice(),
  };
  const tui = {
    terminal: { columns: 80, rows: 10, write() {} },
    children: [tool],
    previousLines: [] as string[],
    previousViewportTop: 0,
    handleInput() {},
    requestRender() {
      renderRequests++;
    },
    render() {
      // Parent layout adds a visible indent after the tool paints its own lines.
      return this.children.flatMap((child: any) =>
        child.render().map((line: string) => PREFIX + line),
      );
    },
    doRender() {
      this.previousLines = this.render();
    },
  };
  installToolMouseInteraction({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, factory: any) {
        factory?.(tui, { fg: (_c: string, text: string) => text });
      },
      onTerminalInput(handler: typeof inputHandler) {
        inputHandler = handler;
        return () => undefined;
      },
    },
  });
  try {
    tui.doRender();
    const finalHint = tui.previousLines[1];
    expect(finalHint).toBe(PREFIX + toolLines[1]);
    expect(finalHint).not.toMatch(/\x1b_cc:t/);
    expect(
      tui.previousLines.every((line) => !/\x1b_cc:t/.test(line)),
    ).toBeTruthy();

    const oldCol = toolLines[1].indexOf("(ctrl+o expand / click)") + 1;
    const offsetCol = finalHint.indexOf("(ctrl+o expand / click)") + 1;
    expect(oldCol).not.toBe(offsetCol);

    // Pre-prefix columns must miss; only the final painted columns hit.
    expect(inputHandler?.(`\x1b[<35;${oldCol};2M`)).toBe(undefined);
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(renderRequests, "old columns do not hover the offset hint").toBe(0);
    expect(tool.expanded).toBe(false);
    expect(inputHandler?.(`\x1b[<0;${oldCol};2M`)).toBe(undefined);
    expect(tool.expanded).toBe(false);

    inputHandler?.(`\x1b[<35;${offsetCol};2M`);
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(renderRequests, "offset columns hover the final painted hint").toBe(
      1,
    );
    expect(inputHandler?.(`\x1b[<0;${offsetCol};2M`)).toStrictEqual({
      consume: true,
    });
    expect(tool.expanded).toBe(true);
  } finally {
    installToolMouseInteraction({});
  }
});

test("expanded group identical show-more labels open their own content", () => {
  const grouping = installToolGrouping(() => true);
  grouping.setTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    bg: (_slot: string, text: string) => text,
  });
  let inputHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const opened: string[] = [];
  try {
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: (_slot: string, text: string) => text,
    };
    const ui = {
      theme,
      requestRender() {},
      notify() {},
      async custom(factory: any) {
        const host = {
          requestRender() {},
          terminal: { rows: 40, columns: 100 },
        };
        const view = factory?.(host, theme, {}, () => {});
        if (view && typeof view.render === "function") {
          opened.push(view.render(100).join("\n"));
        }
        return undefined;
      },
    } as any;
    const parent = new Container() as any;
    // Three tools so A/B share the same branch prefix (not the last-child └).
    for (const [name, id] of [
      ["read", "dup-a"],
      ["bash", "dup-b"],
      ["grep", "dup-c"],
    ] as const) {
      const component = new ToolExecutionComponent(
        name,
        id,
        {},
        {},
        undefined,
        ui,
        process.cwd(),
      ) as any;
      component.updateResult({
        content: [{ type: "text", text: "placeholder" }],
        isError: false,
      });
      parent.addChild(component);
    }
    const group = parent.children[0] as any;
    expect(group instanceof ToolGroupComponent).toBeTruthy();
    group.setExpanded(true);

    const longOut = (tag: string) => `${tag}\n${"line\n".repeat(20)}`;
    const viewA = new ExpandedToolIoView(
      theme,
      "",
      longOut("UNIQUE_A_CONTENT"),
      false,
      2,
      2,
    );
    const viewB = new ExpandedToolIoView(
      theme,
      "",
      longOut("UNIQUE_B_CONTENT"),
      false,
      2,
      2,
    );
    const childA = group.children[0] as Component & { expanded: boolean };
    const childB = group.children[1] as Component & { expanded: boolean };
    const childC = group.children[2] as Component & { expanded: boolean };
    childA.expanded = true;
    childB.expanded = true;
    childC.expanded = true;
    childA.render = (width: number) => [
      `✓ child A`,
      ...viewA.render(Math.max(1, width - 2)),
    ];
    childB.render = (width: number) => [
      `✓ child B`,
      ...viewB.render(Math.max(1, width - 2)),
    ];
    childC.render = () => ["✓ child C", "  └ short"];

    const tui = {
      terminal: { columns: 100, write() {} },
      children: [parent],
      previousLines: [] as string[],
      previousViewportTop: 0,
      requestRender() {},
      doRender() {
        this.previousLines = group.render(100);
      },
    };
    installToolMouseInteraction({
      mode: "tui",
      hasUI: true,
      ui: {
        ...ui,
        setWidget(_key: string, factory: any) {
          factory?.(tui, theme);
        },
        onTerminalInput(handler: typeof inputHandler) {
          inputHandler = handler;
          return () => undefined;
        },
      },
    });
    tui.doRender();
    expect(
      tui.previousLines.every((line) => !/\x1b_cc:[tv]/.test(line)),
      "markers must not leak into previousLines",
    ).toBeTruthy();
    const showMoreRows = tui.previousLines
      .map((line, index) =>
        line.includes("Output") && line.includes("to show more") ? index : -1,
      )
      .filter((index) => index >= 0);
    expect(
      showMoreRows.length >= 2,
      "need two identical show-more headers",
    ).toBeTruthy();
    const plainLabels = showMoreRows.map((row) =>
      tui.previousLines[row]
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(plainLabels[0], "labels must be text-identical").toBe(
      plainLabels[1],
    );

    const secondRow = showMoreRows[1];
    const col = tui.previousLines[secondRow].indexOf("to show more") + 1;
    expect(inputHandler?.(`\x1b[<0;${col};${secondRow + 1}M`)?.consume).toBe(
      true,
    );
    expect(
      opened.some((text) => text.includes("UNIQUE_B_CONTENT")),
      `second show-more must open second body, got ${JSON.stringify(opened)}`,
    ).toBeTruthy();
    expect(
      !opened.some((text) => text.includes("UNIQUE_A_CONTENT")),
      "second show-more must not open first body",
    ).toBeTruthy();
  } finally {
    installToolMouseInteraction({});
    grouping.shutdown();
  }
});

test("ccstyle mode off restores native mouse input: no hover/click, wheel still scrolls", async () => {
  const inputListeners = new Set<
    (data: string) => { consume?: boolean } | undefined
  >();
  const terminalWrites: string[] = [];
  let renderRequests = 0;
  let expandedToolId: string | null = null;
  const contentBox = {
    render() {
      return ["  └ expanded card body"];
    },
  };
  const tool = {
    toolCallId: "tool-1",
    expanded: false,
    contentBox,
    children: [contentBox],
    setExpanded(value: boolean) {
      this.expanded = value;
      if (value) expandedToolId = "tool-1";
      else expandedToolId = null;
    },
    invalidate() {},
    render() {
      return this.expanded
        ? ["✓ Bash(echo ok)", ...this.contentBox.render()]
        : ["✓ Bash(echo ok)", "  └ 1 line output (ctrl+o expand / click)"];
    },
  };
  const terminal = {
    columns: 80,
    rows: 24,
    write(data: string) {
      terminalWrites.push(data);
    },
  };
  const tui = {
    terminal,
    children: [tool],
    previousLines: [] as string[],
    previousViewportTop: 0,
    focusedComponent: null as { handleInput(data: string): void } | null,
    requestRender() {
      renderRequests++;
    },
    render(width: number) {
      return this.children.flatMap((child: any) => child.render(width));
    },
    doRender() {
      this.previousLines = this.render(80);
    },
    handleInput(data: string) {
      for (const listener of inputListeners) {
        if (listener(data)?.consume) return;
      }
      this.focusedComponent?.handleInput?.(data);
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify() {},
      setStatus() {},
      setWidget(_key: string, factory: any) {
        factory?.(tui, { fg: (_color: string, text: string) => text });
      },
      onTerminalInput(
        handler: (data: string) => { consume?: boolean } | undefined,
      ) {
        inputListeners.add(handler);
        return () => inputListeners.delete(handler);
      },
    },
  };
  const events = new Map<string, Function>();
  let runtimeController:
    | { setMode: (mode: "on" | "compact" | "off", ctx: any) => void }
    | undefined;
  const pi = {
    registerShortcut() {},
    registerEntryRenderer() {},
    on(name: string, handler: Function) {
      events.set(name, handler);
    },
  };
  try {
    claudeCodeStyleExtension(pi as any, undefined, undefined, {
      onRuntimeController(controller: typeof runtimeController) {
        runtimeController = controller;
      },
    });
    expect(runtimeController).toBeTruthy();
    // Renderer mode writes the user's real config; back it up and restore it.
    const configPath = join(homedir(), ".pi", "agent", "pi-one-ui.json");
    const savedConfig = existsSync(configPath)
      ? readFileSync(configPath, "utf8")
      : null;
    try {
      await events.get("session_start")?.({}, ctx);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      tui.doRender();

      const hintLine = tui.previousLines.find((line: string) =>
        line.includes("/ click"),
      );
      expect(hintLine).toBeTruthy();
      const row = tui.previousLines.indexOf(hintLine) + 1;
      const col = hintLine.indexOf("/ click") + 1;

      // Baseline in on mode: click expands (frame rebuilds), double-click collapses,
      // hover repaints.
      tui.handleInput(`\x1b[<0;${col};${row}M`);
      expect(expandedToolId).toBe("tool-1");
      tui.doRender();
      tui.handleInput(`\x1b[<0;${col};${row}M`);
      expect(
        expandedToolId,
        "single click on expanded card does not collapse",
      ).toBe("tool-1");
      tui.handleInput(`\x1b[<0;${col};${row}M`);
      expect(expandedToolId).toBe(null);
      tui.doRender();
      const rendersBeforeHover = renderRequests;
      tui.handleInput(`\x1b[<35;${col};${row}M`);
      expect(
        renderRequests > rendersBeforeHover,
        "hover repaints in on mode",
      ).toBeTruthy();

      // off mode: hover/click go native, motion reporting stops.
      runtimeController?.setMode("off", ctx);
      expect(
        terminalWrites.includes("\x1b[?1006l\x1b[?1003l\x1b[?1000l"),
        "off mode fully disables mouse reporting so terminal scrollback wheel scrolling resumes",
      ).toBeTruthy();
      const rendersAfterOff = renderRequests;
      tui.handleInput(`\x1b[<35;${col};${row}M`);
      expect(renderRequests, "off mode: hover has no effect").toBe(
        rendersAfterOff,
      );
      tui.handleInput(`\x1b[<0;${col};${row}M`);
      expect(expandedToolId, "off mode: tool click does not expand").toBe(null);
      expect(tool.expanded, "off mode: tool stays collapsed").toBe(false);
      let editorInputs = 0;
      tui.focusedComponent = {
        handleInput(data: string) {
          if (data === "\x1b[<65;20;3M") editorInputs++;
        },
      };
      tui.handleInput("\x1b[<65;20;3M");
      expect(
        editorInputs,
        "off mode: wheel passes through to native scrolling",
      ).toBe(1);
      // No motion re-enable on subsequent paints while off.
      terminalWrites.length = 0;
      tui.doRender();
      expect(
        !terminalWrites.some((write) => write.includes("?1003h")),
        "off mode: paints do not re-enable motion",
      ).toBeTruthy();

      // Back to on: click affordances return.
      runtimeController?.setMode("on", ctx);
      tui.handleInput(`\x1b[<0;${col};${row}M`);
      expect(expandedToolId, "on mode: tool click expands again").toBe(
        "tool-1",
      );
    } finally {
      if (savedConfig === null) rmSync(configPath, { force: true });
      else writeFileSync(configPath, savedConfig);
    }
  } finally {
    installToolMouseInteraction({});
  }
});
