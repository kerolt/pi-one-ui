import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { expect, test } from "vitest";

import { ownerFor, UI_OWNERSHIP } from "../../extensions/app/ownership.ts";

test("ownership map assigns each Pi UI seam to one module", () => {
  expect(ownerFor("editor")).toBe("editor");
  expect(ownerFor("footer")).toBe("shell");
  expect(ownerFor("workingLine")).toBe("shell");
  expect(ownerFor("toolRenderer")).toBe("context");
  expect(ownerFor("diffRenderer")).toBe("context");
  expect(ownerFor("thinking")).toBe("context");
  expect(UI_OWNERSHIP).toStrictEqual({
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
      "../../extensions/index.ts",
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

    expect(commands.has("oneui")).toBeTruthy();
    expect(commands.has("zentui")).toBe(false);
    expect(commands.has("ccstyle")).toBe(false);
    expect(handlers.has("session_start")).toBeTruthy();
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
