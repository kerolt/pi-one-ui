import assert from "node:assert/strict";
import test from "node:test";

import {
  renderScrollButton,
  resetScrollButtonState,
  scheduleScrollButtonSync,
  setToolMouseTui,
} from "../extensions/layouts/context/renderer/mouse/scroll.ts";

/** 伪造官方 fullscreen 惰性 Proxy TUI：requestRender 每次 get 返回新函数。 */
function lazyFullscreenTui() {
  let renders = 0;
  const tui: any = {
    mode: "fullscreen",
    isFollowingOutput: false, // 不在 transcript 底部 → 按钮应显示
    previousLines: [],
    get requestRender() {
      return () => {
        renders++;
      };
    },
  };
  return { tui, count: () => renders };
}

function fakeTheme() {
  return { fg: (_c: string, t: string) => t };
}

// SGR 滚轮包（code 65 = 向下滚动），不依赖键绑定表，纯字符串解析即可命中。
const WHEEL_DOWN_INPUT = "\x1b[<65;1;1M";

// 滚动按钮状态机：调度后立即 teardown（/reload 中途）不得残留渲染或状态，
// 重新 install 后调度必须恢复正常。
test("scroll button: schedule → immediate teardown → reinstall stays safe", async () => {
  const { tui, count } = lazyFullscreenTui();

  // 1. 调度后立即 teardown（模拟 reload 中途打断）
  setToolMouseTui(tui);
  scheduleScrollButtonSync(tui, WHEEL_DOWN_INPUT);
  resetScrollButtonState();
  setToolMouseTui(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(count(), 0, "teardown 后待执行回调不得触发渲染");
  assert.deepEqual(
    renderScrollButton(80, fakeTheme()),
    [],
    "teardown 后按钮不得显示",
  );

  // 2. 重新 install 后调度恢复正常
  setToolMouseTui(tui);
  scheduleScrollButtonSync(tui, WHEEL_DOWN_INPUT);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(count() >= 1, "reinstall 后滚动导航应触发按钮渲染");
  const lines = renderScrollButton(80, fakeTheme());
  assert.ok(
    lines.some((line) => line.includes("Back to bottom")),
    "不在底部时按钮应可见",
  );

  // 3. 清理
  resetScrollButtonState();
  setToolMouseTui(null);
});
