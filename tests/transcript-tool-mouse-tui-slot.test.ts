import assert from "node:assert/strict";
import test from "node:test";
import { setHoveredToolCallId } from "../extensions/transcript/renderer/mouse/hover.ts";
import * as interaction from "../extensions/transcript/renderer/mouse/interaction.ts";
import {
  getToolMouseTui,
  setToolMouseTui,
} from "../extensions/transcript/renderer/mouse/scroll.ts";

// jiti 转译下经 re-export 链读取的模块级 let 是初始值快照；跨模块必须走 getter。
test("toolMouseTui getter reads the global slot written by setter", () => {
  const tui = { mode: "regular" };
  try {
    setToolMouseTui(tui);
    assert.equal(getToolMouseTui(), tui);
  } finally {
    setToolMouseTui(null);
  }
  assert.equal(getToolMouseTui(), null);
});

test("hoveredToolCallId 随 setter 保持 live，且 interaction 仍 re-export 旧符号", () => {
  assert.equal(typeof interaction.toolMouseTui, "object");
  assert.equal(typeof interaction.isToolCallHovered, "function");
  assert.equal(typeof interaction.setHoveredToolGroup, "function");
  assert.equal(typeof interaction.setHoveredToolIo, "function");
  try {
    setHoveredToolCallId("tool-1");
    assert.equal(interaction.hoveredToolCallId, "tool-1");
  } finally {
    setHoveredToolCallId(null);
  }
  assert.equal(interaction.hoveredToolCallId, null);
});
