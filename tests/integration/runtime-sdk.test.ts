import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionError,
  SessionManager,
  SettingsManager,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test } from "vitest";
import { EventCoordinator } from "../../extensions/app/runtime/event-coordinator.ts";

let directory: string;
let agentDir: string;
let cwd: string;
let previousAgentDir: string | undefined;
let previousOffline: string | undefined;
let registerOneUi: typeof import("../../extensions/index.ts").default;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "one-ui-sdk-"));
  agentDir = join(directory, "agent");
  cwd = join(directory, "project");
  await mkdir(agentDir);
  await mkdir(cwd);
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  await writeFile(
    join(agentDir, "pi-one-ui.json"),
    JSON.stringify({ version: 1, projectRefreshIntervalMs: 0 }),
  );
  ({ default: registerOneUi } = await import("../../extensions/index.ts"));
});

afterAll(async () => {
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  if (previousOffline === undefined) {
    delete process.env.PI_OFFLINE;
  } else {
    process.env.PI_OFFLINE = previousOffline;
  }
  await rm(directory, { recursive: true, force: true });
});

test.each(["print", "json"] as const)(
  "The production entry survives SDK reload, tree navigation and session replacement in %s mode",
  async (mode) => {
    const errors: ExtensionError[] = [];
    const originalRender = UserMessageComponent.prototype.render;
    const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
      const services = await createAgentSessionServices({
        cwd: options.cwd,
        agentDir,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
        }),
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          extensionFactories: [{ name: "pi-one-ui", factory: registerOneUi }],
        },
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
      });
      expect(result.extensionsResult.errors).toEqual([]);
      const extension = result.extensionsResult.extensions[0];
      expect(extension.handlers.get("session_start")).toHaveLength(1);
      expect(extension.handlers.get("session_shutdown")).toHaveLength(1);
      expect(extension.handlers.get("message_update")).toHaveLength(1);
      return { ...result, services, diagnostics: services.diagnostics };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir,
      sessionManager: SessionManager.inMemory(cwd),
    });
    runtime.setRebindSession((session) =>
      session.bindExtensions({ mode, onError: (error) => errors.push(error) }),
    );
    try {
      await runtime.session.bindExtensions({
        mode,
        onError: (error) => errors.push(error),
      });
      expect(runtime.session.extensionRunner.getCommand("oneui")).toBeDefined();
      expect(
        runtime.session.extensionRunner.getCommand("context"),
      ).toBeDefined();
      await runtime.session.prompt("/oneui");
      await runtime.session.reload();
      const manager = runtime.session.sessionManager;
      const first = manager.appendMessage({
        role: "user",
        content: "First branch entry",
        timestamp: Date.now(),
      });
      manager.appendMessage({
        role: "user",
        content: "Second branch entry",
        timestamp: Date.now(),
      });
      await runtime.session.navigateTree(first, { summarize: false });
      const compacted = manager.appendCompaction(
        "First branch entry",
        first,
        5,
      );
      const compactionEntry = manager.getEntry(compacted);
      expect(compactionEntry?.type).toBe("compaction");
      if (compactionEntry?.type !== "compaction") {
        throw new Error("Compaction entry was not persisted");
      }
      await runtime.session.extensionRunner.emit({
        type: "session_compact",
        compactionEntry,
        fromExtension: true,
        reason: "manual",
        willRetry: false,
      });
      const previousSession = runtime.session;
      await runtime.newSession();
      expect(runtime.session).not.toBe(previousSession);
      await runtime.session.prompt("/oneui");
      expect(UserMessageComponent.prototype.render).toBe(originalRender);
    } finally {
      await runtime.dispose();
    }
    expect(errors).toEqual([]);
    expect(UserMessageComponent.prototype.render).toBe(originalRender);
  },
  30_000,
);

test("EventCoordinator preserves asynchronous message replacements in the native Pi pipeline", async () => {
  const seen: unknown[] = [];
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: "coordinator",
          factory(pi) {
            const coordinator = new EventCoordinator({
              on: (event, handler) => pi.on(event as never, handler as never),
            });
            coordinator.on("message_end", async (event) => {
              if (event.message.role === "user") {
                return { message: { ...event.message, content: "first" } };
              }
            });
            coordinator.on("message_end", (event) => {
              if (event.message.role === "user") {
                return {
                  message: {
                    ...event.message,
                    content: `${event.message.content} second`,
                  },
                };
              }
            });
            coordinator.install();
            pi.on("message_end", (event) => {
              seen.push(event.message.content);
            });
          },
        },
      ],
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
  });
  try {
    await session.bindExtensions({ mode: "print" });
    const result = await session.extensionRunner.emitMessageEnd({
      type: "message_end",
      message: {
        role: "user",
        content: "input",
        timestamp: Date.now(),
      },
    });
    expect(result).toMatchObject({ role: "user", content: "first second" });
    expect(seen).toEqual(["first second"]);
  } finally {
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
  }
});
