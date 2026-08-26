import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import { UI_OWNERSHIP, ownerFor } from "../extensions/app/ownership.ts";

test("ownership map assigns each Pi UI seam to one module", () => {
  assert.equal(ownerFor("editor"), "shell");
  assert.equal(ownerFor("footer"), "shell");
  assert.equal(ownerFor("workingLine"), "shell");
  assert.equal(ownerFor("toolRenderer"), "transcript");
  assert.equal(ownerFor("diffRenderer"), "transcript");
  assert.equal(ownerFor("thinking"), "transcript");
  assert.deepEqual(UI_OWNERSHIP, {
    editor: "shell",
    userMessage: "shell",
    footer: "shell",
    workingLine: "shell",
    selector: "shell",
    toolRenderer: "transcript",
    diffRenderer: "transcript",
    thinking: "transcript",
    agentSummary: "features",
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
