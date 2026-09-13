import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CustomEditor,
  type ExtensionUIContext,
  InteractiveMode,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type EditorComponent,
  type OverlayHandle,
  type Terminal,
  TuiAltScreen,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { overlayManager } from "../../extensions/app/overlay/overlay-manager.ts";
import { SessionLifecycle } from "../../extensions/app/runtime/session-lifecycle.ts";
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
  theme as editorTheme,
  getEditorTheme,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

type PanelComponent = {
  render(width: number): string[];
  handleInput(data: string): void;
};
type PanelOptions = {
  overlayOptions?: {
    anchor?: string;
    width?: number | string;
    maxHeight?: number | string;
    margin?: unknown;
  };
  onHandle?: (handle: Pick<OverlayHandle, "focus" | "unfocus">) => void;
};
type ShowOneUiPanel =
  typeof import("../../extensions/app/panel.ts").showOneUiPanel;
type RendererConfig =
  typeof import("../../extensions/app/config/renderer.ts").config;
type ConfigStore =
  typeof import("../../extensions/app/config/store.ts").configStore;

let agentDir: string;
let previousAgentDir: string | undefined;
let rendererConfig: RendererConfig;
let setRendererConfig: (next: RendererConfig) => void;
let sharedConfigStore: ConfigStore;
let showOneUiPanel: ShowOneUiPanel;
let updateRendererConfig: (partial: Partial<RendererConfig>) => void;
let shell: typeof import("../../extensions/app/config/shell.ts");
let EditorLayoutController: typeof import("../../extensions/layouts/editor/controller.ts").EditorLayoutController;
let createInitialState: typeof import("../../extensions/services/session-state.ts").createInitialState;
let emptyGitStatus: typeof import("../../extensions/services/git-data.ts").emptyGitStatus;

beforeAll(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-one-ui-panel-test-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  initTheme("dark");
  ({ showOneUiPanel } = await import("../../extensions/app/panel.ts"));
  ({
    config: rendererConfig,
    setConfig: setRendererConfig,
    updateConfig: updateRendererConfig,
  } = await import("../../extensions/app/config/renderer.ts"));
  ({ configStore: sharedConfigStore } = await import(
    "../../extensions/app/config/store.ts"
  ));
  shell = await import("../../extensions/app/config/shell.ts");
  ({ EditorLayoutController } = await import(
    "../../extensions/layouts/editor/controller.ts"
  ));
  ({ createInitialState } = await import(
    "../../extensions/services/session-state.ts"
  ));
  ({ emptyGitStatus } = await import("../../extensions/services/git-data.ts"));
});

afterAll(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

function createPanelHarness(options: {
  runtime?: Record<string, unknown>;
  onClose?: () => void;
  tui?: TuiMainScreen | TuiAltScreen;
  ui?: Partial<ExtensionUIContext>;
}) {
  let component: PanelComponent | undefined;
  let received: PanelOptions | undefined;
  const operations: string[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: { getSessionName: () => "" },
    ui: {
      ...options.ui,
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      custom(factory: (...args: unknown[]) => unknown, panelOptions: unknown) {
        received = panelOptions as PanelOptions;
        return new Promise<void>((resolve) => {
          component = factory(
            options.tui ?? { requestRender() {} },
            theme,
            {},
            () => {
              operations.push("close");
              options.tui?.hideOverlay();
              options.onClose?.();
              resolve();
            },
          ) as PanelComponent;
          const handle = options.tui?.showOverlay(component as Component);
          received?.onHandle?.({
            focus: () => {
              operations.push("focus");
              handle?.focus();
            },
            unfocus: (unfocusOptions) => handle?.unfocus(unfocusOptions),
          });
        });
      },
    },
  };
  const open = () =>
    showOneUiPanel(ctx as never, {
      runtime: options.runtime as never,
    });
  return {
    component: () => {
      if (!component) throw new Error("Panel component was not created");
      return component;
    },
    ctx,
    notifications,
    open,
    operations,
    options: () => received,
  };
}

function goToEditor(component: PanelComponent): void {
  for (let index = 0; index < 3; index += 1) component.handleInput("\t");
}

function nextContextMode(mode: RendererConfig["mode"]): RendererConfig["mode"] {
  return mode === "on" ? "compact" : mode === "compact" ? "off" : "on";
}

test("/oneui settings are top-anchored and rendered with a border", async () => {
  const harness = createPanelHarness({});
  const opened = harness.open();

  expect(harness.options()?.overlayOptions?.anchor).toBe("top-center");
  const rows = harness.component().render(40);
  expect(rows[0] ?? "").toMatch(/^╭─+╮$/);
  expect(rows.at(-1) ?? "").toMatch(/^╰─+╯$/);
  expect(rows.every((row) => visibleWidth(row) === 40)).toBe(true);

  harness.component().handleInput("\x1b");
  await opened;
  expect(harness.operations).toStrictEqual(["close"]);
});

test("/oneui reads the overlay placement from pi-one-ui.json", async () => {
  sharedConfigStore.update((record) => {
    record.panel = {
      anchor: "bottom-right",
      width: "60%",
      maxHeight: 40,
      margin: 2,
    };
  });

  try {
    const harness = createPanelHarness({});
    const opened = harness.open();

    // 面板打开时实时读取配置，无需 /reload。
    expect(harness.options()?.overlayOptions).toStrictEqual({
      anchor: "bottom-right",
      width: "60%",
      maxHeight: 40,
      margin: 2,
    });

    harness.component().handleInput("\x1b");
    await opened;
  } finally {
    sharedConfigStore.update((record) => {
      delete record.panel;
    });
  }

  // 配置移除后回落到默认的顶部锚点。
  const fallback = createPanelHarness({});
  const reopened = fallback.open();
  expect(fallback.options()?.overlayOptions?.anchor).toBe("top-center");
  fallback.component().handleInput("\x1b");
  await reopened;
});

test("renderer config commits to memory only after persistence succeeds", () => {
  const snapshot = {
    ...rendererConfig,
    excludeRenderers: [...rendererConfig.excludeRenderers],
  };
  const update = vi
    .spyOn(sharedConfigStore, "update")
    .mockImplementation(() => {
      throw new Error("disk offline");
    });

  try {
    expect(() =>
      updateRendererConfig({ mode: nextContextMode(snapshot.mode) }),
    ).toThrow("disk offline");
    expect(rendererConfig).toStrictEqual(snapshot);
  } finally {
    update.mockRestore();
    setRendererConfig(snapshot);
  }
});

test("/oneui leaves the effective value unchanged when persistence fails", async () => {
  const setUserMessagesComponent = vi.fn(() => {
    throw new Error("config is corrupt");
  });
  const harness = createPanelHarness({
    runtime: { setUserMessagesComponent },
  });
  const opened = harness.open();
  const component = harness.component();

  component.handleInput("\t");
  component.handleInput(" ");
  component.handleInput(" ");

  expect(setUserMessagesComponent).toHaveBeenNthCalledWith(
    1,
    { enabled: false },
    expect.anything(),
  );
  expect(setUserMessagesComponent).toHaveBeenNthCalledWith(
    2,
    { enabled: false },
    expect.anything(),
  );
  expect(harness.notifications).toStrictEqual([
    {
      message: "Could not update /oneui setting: config is corrupt",
      level: "error",
    },
    {
      message: "Could not update /oneui setting: config is corrupt",
      level: "error",
    },
  ]);

  component.handleInput("\x1b");
  await opened;
});

test("/oneui rebuilds a failed Context row from the effective config", async () => {
  const snapshot = {
    ...rendererConfig,
    excludeRenderers: [...rendererConfig.excludeRenderers],
  };
  const expectedDiffViewMode =
    snapshot.diffViewMode === "auto"
      ? "split"
      : snapshot.diffViewMode === "split"
        ? "unified"
        : "auto";
  const update = vi
    .spyOn(sharedConfigStore, "update")
    .mockImplementation(() => {
      throw new Error("disk offline");
    });
  const updateContextConfig = vi.fn((patch: Partial<RendererConfig>) =>
    updateRendererConfig(patch),
  );
  const harness = createPanelHarness({
    runtime: { updateContextConfig },
  });
  const opened = harness.open();
  const component = harness.component();

  try {
    component.handleInput("\t");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput(" ");
    component.handleInput(" ");

    expect(updateContextConfig).toHaveBeenNthCalledWith(
      1,
      { diffViewMode: expectedDiffViewMode },
      expect.anything(),
    );
    expect(updateContextConfig).toHaveBeenNthCalledWith(
      2,
      { diffViewMode: expectedDiffViewMode },
      expect.anything(),
    );
    expect(rendererConfig).toStrictEqual(snapshot);
    expect(harness.notifications).toHaveLength(2);
    expect(
      harness.notifications.every(
        ({ message, level }) =>
          level === "error" &&
          message === "Could not update /oneui setting: disk offline",
      ),
    ).toBe(true);
  } finally {
    component.handleInput("\x1b");
    await opened;
    update.mockRestore();
    setRendererConfig(snapshot);
  }
});

test("/oneui keeps the panel open and refocuses after an Editor style change", async () => {
  const setEditorComponent = vi.fn(() => {
    harness.operations.push("apply");
    return { applied: true };
  });
  const harness = createPanelHarness({
    runtime: { setEditorComponent },
  });
  const opened = harness.open();
  const component = harness.component();

  goToEditor(component);
  // Editor 部分第一项即样式开关（on/off），空格直接切换。
  component.handleInput(" ");

  expect(setEditorComponent).toHaveBeenCalledWith(
    { style: "off" },
    expect.anything(),
  );
  expect(overlayManager.hasActive()).toBe(true);
  expect(harness.operations).toStrictEqual(["apply", "focus"]);
  expect(component.render(80).join("\n")).toContain("Border color");

  component.handleInput("\x1b");
  await opened;
  expect(harness.operations).toStrictEqual(["apply", "focus", "close"]);
});

type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
type PiEditorHost = {
  ui: TuiMainScreen | TuiAltScreen;
  editor: EditorComponent;
  defaultEditor: CustomEditor;
  editorContainer: Container;
  editorComponentFactory?: EditorFactory;
  keybindings: KeybindingsManager;
  disposeActiveSelector(): void;
};

/** Uses Pi's real editor replacement and TUI focus stack without starting a terminal. */
function createLiveEditorPanelHarness(
  mode: "regular" | "fullscreen",
  style: "on" | "off",
) {
  shell.saveEditorComponentPatch({ style });
  const terminal = {
    columns: 100,
    rows: 40,
    hideCursor() {},
    write() {},
  } as Terminal;
  const tui =
    mode === "regular"
      ? new TuiMainScreen(terminal)
      : new TuiAltScreen(terminal);
  const keybindings = new KeybindingsManager();
  const defaultEditor = new CustomEditor(tui, getEditorTheme(), keybindings);
  defaultEditor.setText("draft ");
  const editorContainer = new Container();
  editorContainer.addChild(defaultEditor);
  tui.addChild(editorContainer);
  tui.setFocus(defaultEditor);
  const host: PiEditorHost = {
    ui: tui,
    editor: defaultEditor,
    defaultEditor,
    editorContainer,
    keybindings,
    disposeActiveSelector() {},
  };
  // Exercise the installed Pi behavior rather than duplicating its focus restoration.
  const replaceEditor = (
    InteractiveMode.prototype as unknown as {
      setCustomEditorComponent: (
        this: PiEditorHost,
        factory: EditorFactory,
      ) => void;
    }
  ).setCustomEditorComponent.bind(host);
  const lifecycle = new SessionLifecycle();
  lifecycle.start();
  const state = createInitialState(emptyGitStatus());
  const controller = new EditorLayoutController({
    getConfig: shell.loadConfig,
    saveComponent: shell.saveEditorComponentPatch,
    getState: () => state,
    sessionLifecycle: lifecycle,
    render: { request: () => tui.requestRender() },
    getThinkingLevel: () => "off",
    getAgentDurationMs: () => 0,
    isAgentActive: () => false,
    isAgentDurationActive: () => false,
    subscribeAgentDuration: () => () => {},
    getProjectRoot: () => undefined,
    onProjectRequirementChanged() {},
    onModelLabelChanged() {},
  });
  const harness = createPanelHarness({
    tui,
    ui: {
      theme: editorTheme,
      getEditorComponent: () => host.editorComponentFactory,
      setEditorComponent: replaceEditor,
      getEditorText: () =>
        host.editor.getExpandedText?.() ?? host.editor.getText(),
      setEditorText: (text) => host.editor.setText(text),
    },
    runtime: {
      setEditorComponent: (
        patch: Parameters<typeof controller.setComponent>[0],
      ) => controller.setComponent(patch, harness.ctx as never),
    },
  });
  controller.install(harness.ctx as never);
  return {
    ...harness,
    tui,
    host,
    replaceEditor,
    dispose: () => controller.cleanup(harness.ctx as never),
  };
}

test.each(["regular", "fullscreen"] as const)(
  "/oneui restores visible Editor input after native-to-custom replacement in %s mode",
  async (mode) => {
    const harness = createLiveEditorPanelHarness(mode, "off");
    const previous = harness.host.editor;
    const opened = harness.open();
    try {
      goToEditor(harness.component());
      harness.component().handleInput(" ");
      expect(harness.host.editor).not.toBe(previous);
      expect(harness.tui.getFocusedComponent()).toBe(harness.component());
      // Further in-place changes must retain the new Editor as the return target.
      harness.component().handleInput(" ");
      harness.component().handleInput(" ");
      harness.component().handleInput("\x1b[B");
      harness.component().handleInput(" ");
    } finally {
      harness.component().handleInput("\x1b");
      await opened;
    }
    try {
      expect(harness.tui.getFocusedComponent() === harness.host.editor).toBe(
        true,
      );
      harness.tui.getFocusedComponent()?.handleInput?.("visible");
      expect(harness.host.editor.getText()).toBe("draft visible");
      expect(harness.host.editorContainer.render(100).join("\n")).toContain(
        "draft visible",
      );
      expect(previous.getText()).toBe("draft ");
      expect(overlayManager.hasActive()).toBe(false);
      // Reopening without a change must not reuse a prior panel's focus snapshot.
      const reopened = harness.open();
      harness.component().handleInput("\x1b");
      await reopened;
      expect(harness.tui.getFocusedComponent()).toBe(harness.host.editor);
    } finally {
      harness.dispose();
    }
  },
);

test.each(["regular", "fullscreen"] as const)(
  "/oneui preserves Editor identity across owned style toggles in %s mode",
  async (mode) => {
    const harness = createLiveEditorPanelHarness(mode, "on");
    const previous = harness.host.editor;
    const opened = harness.open();
    try {
      goToEditor(harness.component());
      harness.component().handleInput(" ");
      harness.component().handleInput(" ");
    } finally {
      harness.component().handleInput("\x1b");
      await opened;
    }
    try {
      expect(harness.host.editor).toBe(previous);
      expect(harness.tui.getFocusedComponent()).toBe(previous);
      harness.tui.getFocusedComponent()?.handleInput?.("visible");
      expect(harness.host.editorContainer.render(100).join("\n")).toContain(
        "draft visible",
      );
    } finally {
      harness.dispose();
    }
  },
);

test.each(["success", "rollback"] as const)(
  "/oneui restores the current third-party Editor after a replacement %s",
  async (outcome) => {
    const harness = createLiveEditorPanelHarness("regular", "off");
    const thirdPartyFactory: EditorFactory = (tui, theme, keybindings) =>
      new CustomEditor(tui, theme, keybindings);
    harness.replaceEditor(thirdPartyFactory);
    const previous = harness.host.editor;
    const replace = vi.spyOn(harness.ctx.ui, "setEditorComponent");
    if (outcome === "rollback") {
      replace.mockImplementationOnce((factory) => {
        harness.replaceEditor(factory);
        throw new Error("replacement failed after mounting");
      });
    }
    const opened = harness.open();
    try {
      goToEditor(harness.component());
      harness.component().handleInput(" ");
    } finally {
      harness.component().handleInput("\x1b");
      await opened;
      replace.mockRestore();
    }
    try {
      expect(harness.host.editor).not.toBe(previous);
      if (outcome === "rollback") {
        expect(harness.host.editorComponentFactory).toBe(thirdPartyFactory);
      }
      expect(harness.tui.getFocusedComponent() === harness.host.editor).toBe(
        true,
      );
      harness.tui.getFocusedComponent()?.handleInput?.("visible");
      expect(harness.host.editorContainer.render(100).join("\n")).toContain(
        "draft visible",
      );
    } finally {
      harness.dispose();
    }
  },
);

test("/oneui does not steal focus from another overlay on close", async () => {
  const harness = createLiveEditorPanelHarness("regular", "off");
  const other: Component = { render: () => ["Other overlay"], invalidate() {} };
  const otherHandle = harness.tui.showOverlay(other);
  const opened = harness.open();
  try {
    goToEditor(harness.component());
    harness.component().handleInput(" ");
  } finally {
    harness.component().handleInput("\x1b");
    await opened;
  }
  try {
    expect(harness.tui.getFocusedComponent()).toBe(other);
  } finally {
    otherHandle.hide();
    harness.dispose();
  }
});

test("/oneui leaves a later Editor owner's focus untouched", async () => {
  const harness = createLiveEditorPanelHarness("regular", "off");
  const opened = harness.open();
  try {
    goToEditor(harness.component());
    harness.component().handleInput(" ");
    harness.replaceEditor(
      (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
    );
  } finally {
    harness.component().handleInput("\x1b");
    await opened;
  }
  try {
    expect(harness.tui.getFocusedComponent()).toBe(harness.host.editor);
  } finally {
    harness.dispose();
  }
});
