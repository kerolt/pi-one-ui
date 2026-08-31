import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { overlayManager } from "../../extensions/app/overlay/overlay-manager.ts";

type PanelComponent = {
  render(width: number): string[];
  handleInput(data: string): void;
};
type PanelOptions = {
  overlayOptions?: { anchor?: string };
  onHandle?: (handle: { focus: () => void }) => void;
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
});

afterAll(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

function createPanelHarness(options: {
  runtime?: Record<string, unknown>;
  onClose?: () => void;
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
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      custom(factory: (...args: unknown[]) => unknown, panelOptions: unknown) {
        received = panelOptions as PanelOptions;
        return new Promise<void>((resolve) => {
          component = factory({ requestRender() {} }, theme, {}, () => {
            operations.push("close");
            options.onClose?.();
            resolve();
          }) as PanelComponent;
          received?.onHandle?.({
            focus: () => operations.push("focus"),
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
  component.handleInput("\x1b[B");
  component.handleInput(" ");

  expect(setEditorComponent).toHaveBeenCalledWith(
    { style: "opencode-copy-friendly" },
    expect.anything(),
  );
  expect(overlayManager.hasActive()).toBe(true);
  expect(harness.operations).toStrictEqual(["apply", "focus"]);
  expect(component.render(80).join("\n")).toContain("opencode-copy-friendly");

  component.handleInput("\x1b");
  await opened;
  expect(harness.operations).toStrictEqual(["apply", "focus", "close"]);
});
