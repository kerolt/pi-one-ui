import {
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  getMarkdownTheme,
  initTheme,
  type ParsedSkillBlock,
  SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  config,
  DEFAULT_CONFIG,
  normalizeConfig,
  setConfig,
} from "../../extensions/app/config/renderer.ts";
import {
  installMessageDisplayRendering,
  refreshMessageDisplays,
  setMessageDisplayTheme,
} from "../../extensions/layouts/context/renderer/tool/message-display.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

initTheme("dark");

function fakeTheme() {
  return { fg: (_color: string, text: string) => text };
}

type CompactionSummaryMessageProps = ConstructorParameters<
  typeof CompactionSummaryMessageComponent
>[0];
type BranchSummaryMessageProps = ConstructorParameters<
  typeof BranchSummaryMessageComponent
>[0];

function makeSkillBlock(
  name = "ponytail",
  content = "**lazy** content\n\n- rule 1",
) {
  return new SkillInvocationMessageComponent(
    { name, content, userMessage: null } as unknown as ParsedSkillBlock,
    getMarkdownTheme(),
  );
}

function makeCompaction(summary = "summarized history", tokensBefore = 12345) {
  return new CompactionSummaryMessageComponent(
    { summary, tokensBefore } as unknown as CompactionSummaryMessageProps,
    getMarkdownTheme(),
  );
}

function makeBranch(summary = "branch work") {
  return new BranchSummaryMessageComponent(
    { summary } as unknown as BranchSummaryMessageProps,
    getMarkdownTheme(),
  );
}

test("message-display: ccstyle on 时三个组件渲染为工具调用风格", () => {
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "on" }));
  const dispose = installMessageDisplayRendering();
  setMessageDisplayTheme(fakeTheme());

  // skill 块：collapsed ● Skill <name>，无原生 [skill] 标签
  const skill = makeSkillBlock();
  const skillCollapsed = stripAnsi(skill.render(120).join("\n"));
  expect(skillCollapsed).toMatch(/✓ Skill ponytail/);
  expect(skillCollapsed).toMatch(/to show more/);
  expect(skillCollapsed).not.toMatch(/\[skill\]/);
  // 与单 tool 一致：Box paddingY 置 0，折叠行无上下空行
  expect(skill.render(120).length, "折叠行不应有上下空行").toBe(1);
  // expanded：标题行 + markdown 正文，背景与 tool 展开卡相同
  const backgroundSlots: string[] = [];
  setMessageDisplayTheme({
    fg: (_color: string, text: string) => text,
    bg(slot: string, text: string) {
      backgroundSlots.push(slot);
      return text;
    },
  } as any);
  skill.setExpanded(true);
  const skillExpanded = stripAnsi(skill.render(120).join("\n"));
  expect(skillExpanded).toMatch(/✓ Skill ponytail/);
  expect(skillExpanded).toMatch(/lazy/);
  expect(backgroundSlots.includes("userMessageBg")).toBeTruthy();
  expect(skill.render(120).length > 3, "展开卡应有上下内边距").toBeTruthy();
  skill.setExpanded(false);
  expect(skill.render(120).length, "收起后恢复单行").toBe(1);
  setMessageDisplayTheme(fakeTheme());

  // 压缩摘要：collapsed ● Compacted from N tokens
  const compaction = makeCompaction();
  const compactionCollapsed = stripAnsi(compaction.render(120).join("\n"));
  expect(compactionCollapsed).toMatch(/✓ Compacted from 12,345 tokens/);
  expect(compactionCollapsed).not.toMatch(/\[compaction\]/);
  expect(compaction.render(120).length, "折叠行不应有上下空行").toBe(1);
  compaction.setExpanded(true);
  const compactionExpanded = stripAnsi(compaction.render(120).join("\n"));
  expect(compactionExpanded).toMatch(/summarized history/);

  // 分支摘要：collapsed ● Branch summary
  const branch = makeBranch();
  const branchCollapsed = stripAnsi(branch.render(120).join("\n"));
  expect(branchCollapsed).toMatch(/✓ Branch summary/);
  expect(branchCollapsed).not.toMatch(/\[branch\]/);
  expect(branch.render(120).length, "折叠行不应有上下空行").toBe(1);
  branch.setExpanded(true);
  expect(stripAnsi(branch.render(120).join("\n"))).toMatch(/branch work/);

  dispose();
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "off" }));
});

test("message-display: mode off 或 dispose 后回退原生渲染", () => {
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "on" }));
  const dispose = installMessageDisplayRendering();
  setMessageDisplayTheme(fakeTheme());
  const skill = makeSkillBlock();
  const compaction = makeCompaction();
  expect(stripAnsi(skill.render(120).join("\n"))).not.toMatch(/\[skill\]/);
  expect(stripAnsi(compaction.render(120).join("\n"))).not.toMatch(
    /\[compaction\]/,
  );

  // mode=off：恢复原生标签
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "off" }));
  skill.invalidate();
  compaction.invalidate();
  expect(stripAnsi(skill.render(120).join("\n"))).toMatch(/\[skill\]/);
  expect(stripAnsi(compaction.render(120).join("\n"))).toMatch(
    /\[compaction\]/,
  );
  // 原生 Box paddingY=1 恢复：重新出现上下空行
  expect(skill.render(120).length, "原生渲染恢复上下内边距").toBe(3);

  // dispose 后同样回退
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "on" }));
  skill.invalidate();
  compaction.invalidate();
  expect(stripAnsi(skill.render(120).join("\n"))).not.toMatch(/\[skill\]/);
  dispose();
  skill.invalidate();
  compaction.invalidate();
  expect(stripAnsi(skill.render(120).join("\n"))).toMatch(/\[skill\]/);
  expect(stripAnsi(compaction.render(120).join("\n"))).toMatch(
    /\[compaction\]/,
  );
});

test("message-display: refreshMessageDisplays 遍历并刷新已挂载组件", () => {
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "off" }));
  const dispose = installMessageDisplayRendering();
  setMessageDisplayTheme(fakeTheme());
  const components = [makeSkillBlock(), makeCompaction(), makeBranch()];
  let invalidated = 0;
  for (const component of components) {
    component.invalidate = () => {
      invalidated++;
      (component as unknown as { updateDisplay(): void }).updateDisplay();
    };
  }
  const root = {
    children: [{ children: components }],
    getMountedRoots: () => [],
  };
  refreshMessageDisplays(root);
  expect(invalidated).toBe(3);
  dispose();
  setConfig(normalizeConfig({ ...DEFAULT_CONFIG, mode: "on" }));
});
