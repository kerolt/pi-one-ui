import { expect, test } from "vitest";
import {
  expandShortcutText,
  isToolTuiFullscreen,
  setToolTuiFullscreen,
  showMoreHintText,
} from "../../extensions/layouts/context/renderer/tool/show-more-hint.ts";

test("show-more hint follows the TUI mode", () => {
  setToolTuiFullscreen(true);
  expect(isToolTuiFullscreen()).toBe(true);
  expect(showMoreHintText()).toBe("click to show more");

  // regular（保留原生 scrollback、不启用鼠标上报）：提示默认展开快捷键。
  setToolTuiFullscreen(false);
  expect(isToolTuiFullscreen()).toBe(false);
  expect(showMoreHintText()).toBe(`${expandShortcutText()} to show more`);
  expect(showMoreHintText()).toMatch(/^ctrl\+o to show more$/);

  // 未安装（纯渲染/测试）时按 fullscreen 处理，保持既有行为。
  setToolTuiFullscreen(undefined as any);
  expect(showMoreHintText()).toBe("click to show more");
});
