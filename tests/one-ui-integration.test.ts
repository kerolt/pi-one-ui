import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createJiti } from "jiti";

import { ownerFor, UI_OWNERSHIP } from "../extensions/app/ownership.ts";

test("ownership map assigns each Pi UI seam to one module", () => {
  assert.equal(ownerFor("editor"), "editor");
  assert.equal(ownerFor("footer"), "shell");
  assert.equal(ownerFor("workingLine"), "shell");
  assert.equal(ownerFor("toolRenderer"), "context");
  assert.equal(ownerFor("diffRenderer"), "context");
  assert.equal(ownerFor("thinking"), "context");
  assert.deepEqual(UI_OWNERSHIP, {
    editor: "editor",
    userMessage: "context",
    footer: "shell",
    workingLine: "shell",
    selector: "overlay",
    toolRenderer: "context",
    diffRenderer: "context",
    thinking: "context",
    agentSummary: "context",
  });
});

test("the composed extension exposes /oneui without upstream management commands", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-one-ui-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { default: registerOneUi } = await createJiti(import.meta.url).import(
      "../extensions/index.ts",
    );
    const commands = new Map<string, unknown>();
    const handlers = new Map<string, unknown[]>();
    const pi = {
      registerCommand(name: string, options: unknown) {
        commands.set(name, options);
      },
      registerEntryRenderer() {},
      registerMarkdownTransformer() {},
      registerMessageRenderer() {},
      getThinkingLevel() {
        return "off";
      },
      getAllTools() {
        return [];
      },
      appendEntry() {},
      on(name: string, handler: unknown) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
      events: {
        on() {
          return () => {};
        },
      },
    };

    registerOneUi(pi as never);

    assert.ok(commands.has("oneui"));
    assert.equal(commands.has("zentui"), false);
    assert.equal(commands.has("ccstyle"), false);
    assert.ok(handlers.has("session_start"));
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("/oneui settings are top-anchored and rendered with a border", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-one-ui-panel-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    initTheme("dark");
    const { showOneUiPanel } = await createJiti(import.meta.url).import(
      "../extensions/app/panel.ts",
    );
    let component:
      | { render(width: number): string[]; handleInput(data: string): void }
      | undefined;
    let options:
      | {
          overlayOptions?: { anchor?: string };
          onHandle?: (handle: { focus: () => void }) => void;
        }
      | undefined;
    const operations: string[] = [];
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    await showOneUiPanel(
      {
        mode: "tui",
        hasUI: true,
        ui: {
          notify() {},
          custom(factory: (...args: unknown[]) => unknown, received: unknown) {
            options = received as typeof options;
            component = factory({ requestRender() {} }, theme, {}, () =>
              operations.push("close"),
            ) as typeof component;
            options.onHandle?.({
              focus: () => operations.push("focus"),
            });
            return Promise.resolve();
          },
        },
      },
      {
        runtime: {
          setEditorComponent() {
            operations.push("apply");
            return { applied: true };
          },
        } as never,
      },
    );

    assert.equal(options?.overlayOptions?.anchor, "top-center");
    assert.ok(component);
    const rows = component.render(40);
    assert.match(rows[0] ?? "", /^╭─+╮$/);
    assert.match(rows.at(-1) ?? "", /^╰─+╯$/);
    assert.ok(rows.every((row) => visibleWidth(row) === 40));

    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput(" ");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(operations, ["apply", "focus"]);

    component.handleInput("\x1b");
    assert.deepEqual(operations, ["apply", "focus", "close"]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
