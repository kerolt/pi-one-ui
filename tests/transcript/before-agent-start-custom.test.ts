import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test } from "vitest";
import sessionReferenceExtension from "../../extensions/features/session-reference/index.ts";
import agentAutocompleteExtension from "../../extensions/features/subagent-autocomplete.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakePi(): { pi: ExtensionAPI; handlers: Map<string, Handler[]> } {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    events: { on: () => () => {} },
    registerMessageRenderer() {},
  };
  return { pi: pi as unknown as ExtensionAPI, handlers };
}

// pi >= 1.2 also fires before_agent_start for runs started by pi.sendMessage(..., { triggerTurn: true }).
// Those events carry the starting message and no prompt.
const customStart = {
  type: "before_agent_start",
  messageType: "custom",
  message: {
    role: "custom",
    customType: "wake",
    content: "done",
    display: true,
  },
  systemPrompt: "base",
};
const ctx = { sessionManager: { getSessionId: () => "s1" } };

let home: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.PI_CODING_AGENT_DIR;
  home = mkdtempSync(join(tmpdir(), "pi-one-ui-bas-"));
  mkdirSync(join(home, ".pi", "agent", "agents"), { recursive: true });
  writeFileSync(
    join(home, ".pi", "agent", "agents", "coder.md"),
    "---\ndisplay_name: Coder\n---\nWrite code.\n",
  );
  process.env.PI_CODING_AGENT_DIR = home;
});
afterEach(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(home, { recursive: true, force: true });
});

test("agent mentions: a custom-message run without a prompt is ignored", async () => {
  const { pi, handlers } = fakePi();
  agentAutocompleteExtension(pi);
  const [handler] = handlers.get("before_agent_start") ?? [];
  await expect(handler!(customStart, ctx)).resolves.toBeUndefined();
  const result = (await handler!(
    { ...customStart, messageType: "user", prompt: "ask @coder to fix it" },
    ctx,
  )) as { systemPrompt?: string };
  expect(result.systemPrompt).toContain('"coder" (Coder)');
});

test("session references: a custom-message run without a prompt is ignored", async () => {
  const { pi, handlers } = fakePi();
  sessionReferenceExtension(pi);
  const [handler] = handlers.get("before_agent_start") ?? [];
  await expect(handler!(customStart, ctx)).resolves.toBeUndefined();
});
