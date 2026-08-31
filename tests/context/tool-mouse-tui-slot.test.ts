import { expect, test } from "vitest";
import { setHoveredToolCallId } from "../../extensions/layouts/context/renderer/mouse/hover.ts";
import * as interaction from "../../extensions/layouts/context/renderer/mouse/interaction.ts";
import {
  getToolMouseTui,
  setToolMouseTui,
} from "../../extensions/layouts/context/renderer/mouse/scroll.ts";

// jiti 转译下经 re-export 链读取的模块级 let 是初始值快照；跨模块必须走 getter。
test("toolMouseTui getter reads the global slot written by setter", () => {
  const tui = { mode: "regular" };
  try {
    setToolMouseTui(tui);
    expect(getToolMouseTui()).toBe(tui);
  } finally {
    setToolMouseTui(null);
  }
  expect(getToolMouseTui()).toBe(null);
});

test("hoveredToolCallId 随 setter 保持 live，且 interaction 仍 re-export 旧符号", () => {
  expect(typeof interaction.toolMouseTui).toBe("object");
  expect(typeof interaction.isToolCallHovered).toBe("function");
  expect(typeof interaction.setHoveredToolGroup).toBe("function");
  expect(typeof interaction.setHoveredToolIo).toBe("function");
  try {
    setHoveredToolCallId("tool-1");
    expect(interaction.hoveredToolCallId).toBe("tool-1");
  } finally {
    setHoveredToolCallId(null);
  }
  expect(interaction.hoveredToolCallId).toBe(null);
});
