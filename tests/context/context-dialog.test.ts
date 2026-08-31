// escCloseHitbox 的契约：
// [esc] 按钮位于弹框标题行（box 第 2 行）右端，5 列宽；
// bounds 为 0-based 的弹框起点（left/top）+ 宽度。

import {
  formatSkillsForPrompt,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  capParts,
  collectContextBreakdown,
  escCloseHitbox,
  hasActiveTextPreview,
  resolveUsedTokens,
  showTextPreview,
} from "../../extensions/features/context-inspector/index.ts";

initTheme("dark");

test("context breakdown separates tools, results, and conversation without inflating estimates", () => {
  const ctx = {
    getSystemPromptOptions: () => ({
      cwd: "/repo",
      selectedTools: ["read"],
      toolSnippets: { read: "Read files" },
      contextFiles: [{ path: "AGENTS.md", content: "cccc" }],
      skills: [
        { name: "ok", description: "desc", filePath: "/v" },
        {
          name: "hidden",
          description: "x".repeat(100),
          filePath: "/hidden",
          disableModelInvocation: true,
        },
      ],
    }),
    getSystemPrompt: () => "s".repeat(200),
    sessionManager: {
      buildContextEntries: () => [
        {
          type: "message",
          message: { role: "user", content: "uuuuuuuu", timestamp: 0 },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "aaaa" },
              {
                type: "toolCall",
                id: "1",
                name: "read",
                arguments: { path: "a" },
              },
            ],
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "1",
            toolName: "read",
            content: "rrrrrrrr",
            timestamp: 0,
          },
        },
        { type: "compaction", summary: "ssss" },
      ],
    },
  } as any;
  const tools = [
    {
      name: "read",
      description: "Read a file",
      parameters: { type: "object" },
      promptGuidelines: [],
      sourceInfo: {},
    },
  ] as any;

  const breakdown = collectContextBreakdown(ctx, tools);
  const parts = breakdown.parts;
  expect(parts.map(({ label, color }) => [label, color])).toStrictEqual([
    ["System prompt", "accent"],
    ["Memory", "error"],
    ["Skills", "warning"],
    ["Tools definition", "success"],
    ["Tool results", "customMessageLabel"],
    ["Context", "warning"],
  ]);
  expect(parts.find((part) => part.label === "System prompt")?.tokens).toBe(50);
  expect(parts.find((part) => part.label === "Memory")?.tokens).toBe(0);
  expect(parts.find((part) => part.label === "Skills")?.tokens).toBe(0);
  expect(breakdown.previews.memoryFiles).toMatch(/## AGENTS\.md/);
  expect(breakdown.previews.memoryFiles).toMatch(/cccc/);
  expect(breakdown.previews.skills).toMatch(/<name>ok<\/name>/);
  expect(breakdown.previews.skills).not.toMatch(/hidden/);
  expect(parts.find((part) => part.label === "Tool results")?.tokens).toBe(2);
  expect(parts.find((part) => part.label === "Context")?.tokens).toBe(8);
  expect(breakdown.previews.systemPrompt).toBe("s".repeat(200));
  expect(breakdown.previews.tools).toMatch(/Definition: read/);
  expect(breakdown.previews.tools).toMatch(/"parameters"/);
  expect(breakdown.previews.tools).not.toMatch(/Call: read/);
  expect(breakdown.previews.toolResults).toMatch(/Result: read/);
  expect(breakdown.previews.toolResults).toMatch(/rrrrrrrr/);
  expect(breakdown.previews.contextFiles).toMatch(/uuuuuuuu/);
  expect(breakdown.previews.contextFiles).toMatch(/aaaa/);
  expect(breakdown.previews.contextFiles).toMatch(/Assistant tool call: read/);
  expect(breakdown.previews.contextFiles).toMatch(/"path": "a"/);
  expect(breakdown.previews.contextFiles).toMatch(/Compaction/);

  const fitted = capParts(
    parts,
    parts.reduce((sum, part) => sum + part.tokens, 0) + 10,
  );
  expect(
    fitted,
    "estimates are not inflated to fill provider usage",
  ).toStrictEqual(parts);
  const fixedTokens = parts
    .slice(0, 4)
    .reduce((sum, part) => sum + part.tokens, 0);
  const capped = capParts(parts, fixedTokens + 5, 4);
  expect(
    capped.slice(0, 4),
    "system prompt, memory, skills and tools definition stay stable",
  ).toStrictEqual(parts.slice(0, 4));
  expect(capped.reduce((sum, part) => sum + part.tokens, 0)).toBe(
    fixedTokens + 5,
  );
  const finalParts = [
    ...fitted,
    { label: "Other", tokens: 10, color: "muted" },
    { label: "Free space", tokens: 100, color: "dim" },
  ];
  expect(new Set(finalParts.map((part) => part.color)).size).toBe(7);
});

test("context breakdown attributes embedded memory and skills once", () => {
  const memory = "cccc";
  const skills = [{ name: "ok", description: "desc", filePath: "/v" }];
  const skillsText = formatSkillsForPrompt(skills as any).trim();
  const systemPrompt = `base\n<project_instructions>\n${memory}\n</project_instructions>\n${skillsText}`;
  const ctx = {
    getSystemPromptOptions: () => ({
      cwd: "/repo",
      selectedTools: [],
      contextFiles: [{ path: "AGENTS.md", content: memory }],
      skills,
    }),
    getSystemPrompt: () => systemPrompt,
    sessionManager: { buildContextEntries: () => [] },
  } as any;

  const breakdown = collectContextBreakdown(ctx, []);
  const systemTokens =
    breakdown.parts.find((part) => part.label === "System prompt")?.tokens ??
    -1;
  const memoryTokens =
    breakdown.parts.find((part) => part.label === "Memory")?.tokens ?? -1;
  const skillsTokens =
    breakdown.parts.find((part) => part.label === "Skills")?.tokens ?? -1;
  expect(memoryTokens).toBe(Math.ceil(memory.length / 4));
  expect(skillsTokens).toBe(Math.ceil(skillsText.length / 4));
  expect(systemTokens + memoryTokens + skillsTokens).toBe(
    Math.ceil(systemPrompt.length / 4),
  );
  expect(systemTokens < Math.ceil(systemPrompt.length / 4)).toBeTruthy();
});

test("resolveUsedTokens rejects inconsistent or implausibly small provider usage", () => {
  expect(resolveUsedTokens({ tokens: 1, percent: 7 }, 20_000, 272_000)).toBe(
    19_040,
  );
  expect(
    resolveUsedTokens({ tokens: 19_000, percent: 7 }, 20_000, 272_000),
  ).toBe(19_000);
  expect(
    resolveUsedTokens({ tokens: 1, percent: 1 / 2_720 }, 20_000, 272_000),
  ).toBe(20_000);
  expect(
    resolveUsedTokens({ tokens: null, percent: null }, 20_000, 272_000),
  ).toBe(20_000);
});

test("capParts never produces negative tokens when estimates exceed usage", () => {
  const parts = Array.from({ length: 8 }, (_, index) => ({
    label: String(index),
    tokens: 1,
    color: "dim" as const,
  }));
  const fitted = capParts(parts, 5);
  expect(fitted.reduce((sum, part) => sum + part.tokens, 0)).toBe(5);
  expect(fitted.every((part) => part.tokens >= 0)).toBeTruthy();
});

test("escCloseHitbox sits 5 columns wide at the title row's right edge", () => {
  expect(escCloseHitbox({ left: 8, top: 1, width: 64 })).toStrictEqual({
    row: 3,
    startCol: 67,
    endCol: 71,
  });
  expect(escCloseHitbox({ left: 1, top: 1, width: 38 })).toStrictEqual({
    row: 3,
    startCol: 34,
    endCol: 38,
  });
  expect(escCloseHitbox({ left: 20, top: 6, width: 50 })).toStrictEqual({
    row: 8,
    startCol: 65,
    endCol: 69,
  });
});

/** showTextPreview 自定义 UI 的最小 harness：捕获 component，theme 可注入，可选挂载回调。 */
/** showTextPreview 自定义 UI 的最小 harness：捕获 component（挂载后实时可读），theme 可注入，可选挂载回调。 */
function textPreviewHarness(
  theme: any = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  },
  onMount?: (component: any) => void,
): any {
  let component: any;
  return {
    custom: async (factory: any) =>
      await new Promise<void>((resolve) => {
        component = factory(
          { terminal: { columns: 80, rows: 24 }, requestRender() {} },
          theme,
          null,
          resolve,
        );
        onMount?.(component);
      }),
    get component() {
      return component;
    },
  };
}

test("showTextPreview highlights and closes from the [esc] mouse hitbox", async () => {
  let escColor = "";
  const ui = textPreviewHarness(
    {
      fg: (color: string, text: string) => {
        if (text === "[esc]") escColor = color;
        return text;
      },
      bold: (text: string) => text,
    },
    (c) => c.render(64),
  );
  const preview = showTextPreview({ ui } as any, "Output", "hello");
  expect(hasActiveTextPreview()).toBe(true);
  expect(escColor).toBe("muted");
  // 80×24、64 列居中、margin 2 → [esc] 命中 row=4, col=67..71。
  ui.component.handleInput(`\x1b[<35;67;4M`);
  ui.component.render(64);
  expect(escColor, "[esc] hover switches to text color").toBe("text");
  ui.component.handleInput(`\x1b[<0;67;4M`);
  await preview;
  expect(hasActiveTextPreview()).toBe(false);
});

test("showTextPreview scrollbar supports press and drag", async () => {
  const ui = textPreviewHarness();
  const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  const preview = showTextPreview({ ui } as any, "Output", content);
  const initial = ui.component.render(64).join("\n");
  expect(initial).toMatch(/1-13 \/ 100 lines/);
  // scrollbar col=71，body track row=6..18；从顶部 thumb 拖到底部。
  ui.component.handleInput(`\x1b[<0;71;6M`);
  ui.component.handleInput(`\x1b[<32;71;18M`);
  ui.component.handleInput(`\x1b[<0;71;18m`);
  const dragged = ui.component.render(64).join("\n");
  expect(dragged).toMatch(/88-100 \/ 100 lines/);
  ui.component.handleInput("\x1b");
  await preview;
});
