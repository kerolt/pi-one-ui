import { expect, test } from "vitest";
import effortCommand from "../../extensions/features/effort-command.ts";

type RegisteredCommand = {
  description?: string;
  getArgumentCompletions?: (
    prefix: string,
  ) => Array<{ value: string; label: string }> | null;
  handler: (args: string, ctx: never) => Promise<void>;
};

type Notification = { message: string; level?: string };

/**
 * Builds a minimal ExtensionAPI double: captures the registered command and
 * simulates the active thinking level, including models that clamp requests.
 */
function createPiDouble(options?: { clampTo?: string }) {
  const commands = new Map<string, RegisteredCommand>();
  let thinkingLevel = "medium";
  const pi = {
    registerCommand(name: string, options: RegisteredCommand) {
      commands.set(name, options);
    },
    getThinkingLevel: () => thinkingLevel,
    setThinkingLevel(level: string) {
      // 模拟不支持高档位的模型：请求被钳制到 clampTo。
      thinkingLevel = options?.clampTo ?? level;
    },
  };
  return { commands, pi, level: () => thinkingLevel };
}

/** Builds a command ctx double with optional interactive select support. */
function createCtxDouble(selectAnswer?: string) {
  const notifications: Notification[] = [];
  const selectTitles: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      async select(title: string, _options: string[]) {
        selectTitles.push(title);
        return selectAnswer;
      },
    },
  };
  return { ctx, notifications, selectTitles };
}

function registered(pi: {
  commands: Map<string, RegisteredCommand>;
}): RegisteredCommand {
  const command = pi.commands.get("effort");
  if (!command) {
    throw new Error("/effort command was not registered");
  }
  return command;
}

test("effort command registers /effort with prefix-based completions", () => {
  const { commands, pi } = createPiDouble();
  effortCommand(pi as never);

  const command = registered({ commands });
  // 补全按前缀过滤；无匹配时返回 null 以让出默认补全。
  expect(command.getArgumentCompletions?.("h")).toStrictEqual([
    { value: "high", label: "high" },
  ]);
  expect(command.getArgumentCompletions?.("")).toHaveLength(7);
  expect(command.getArgumentCompletions?.("zzz")).toBeNull();
});

test("effort command applies a valid level argument directly", async () => {
  const { commands, pi, level } = createPiDouble();
  effortCommand(pi as never);
  const { ctx, notifications, selectTitles } = createCtxDouble();

  await registered({ commands }).handler(" High ", ctx as never);

  // 参数 trim + 小写归一化后生效，不经过交互选择。
  expect(level()).toBe("high");
  expect(selectTitles).toStrictEqual([]);
  expect(notifications).toStrictEqual([
    { message: "Thinking effort: high", level: "info" },
  ]);
});

test("effort command rejects an unknown level without changing state", async () => {
  const { commands, pi, level } = createPiDouble();
  effortCommand(pi as never);
  const { ctx, notifications } = createCtxDouble();

  await registered({ commands }).handler("extreme", ctx as never);

  expect(level()).toBe("medium");
  expect(notifications).toHaveLength(1);
  expect(notifications[0]?.level).toBe("error");
  expect(notifications[0]?.message).toContain("Unknown effort");
});

test("effort command without arguments opens a picker showing the current level", async () => {
  const { commands, pi, level } = createPiDouble();
  effortCommand(pi as never);
  const { ctx, notifications, selectTitles } = createCtxDouble("max");

  await registered({ commands }).handler("", ctx as never);

  expect(selectTitles).toStrictEqual(["Thinking effort (current: medium)"]);
  expect(level()).toBe("max");
  expect(notifications).toStrictEqual([
    { message: "Thinking effort: max", level: "info" },
  ]);
});

test("effort command without arguments and without UI does nothing", async () => {
  const { commands, pi, level } = createPiDouble();
  effortCommand(pi as never);
  const { ctx, notifications, selectTitles } = createCtxDouble();
  const headlessCtx = { ...ctx, hasUI: false };

  await registered({ commands }).handler("", headlessCtx as never);

  // headless 场景不得触发 select，也不得更改档位。
  expect(selectTitles).toStrictEqual([]);
  expect(level()).toBe("medium");
  expect(notifications).toStrictEqual([]);
});

test("effort command warns when the active model clamps the requested level", async () => {
  const { commands, pi, level } = createPiDouble({ clampTo: "high" });
  effortCommand(pi as never);
  const { ctx, notifications } = createCtxDouble();

  await registered({ commands }).handler("max", ctx as never);

  expect(level()).toBe("high");
  expect(notifications).toStrictEqual([
    { message: "Requested max; active model applied high", level: "warning" },
  ]);
});
