import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("the composed extension exposes /oneui without upstream management commands", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-one-ui-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { default: registerOneUi } = await import(
      "../../extensions/index.ts"
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
    expect(handlers.get("session_start")).toHaveLength(1);
    expect(handlers.get("session_shutdown")).toHaveLength(1);
    expect(handlers.get("message_update")).toHaveLength(1);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
}, 15_000);
