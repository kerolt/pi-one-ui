import { expect, test } from "vitest";
import {
  DEFAULT_PANEL_OVERLAY,
  normalizePanelOverlay,
} from "../../extensions/app/config/panel.ts";

test("panel overlay falls back to defaults for missing or non-object input", () => {
  // 缺失、null、数组等异常输入都不得阻断面板打开。
  expect(normalizePanelOverlay(undefined)).toStrictEqual(DEFAULT_PANEL_OVERLAY);
  expect(normalizePanelOverlay(null)).toStrictEqual(DEFAULT_PANEL_OVERLAY);
  expect(normalizePanelOverlay([])).toStrictEqual(DEFAULT_PANEL_OVERLAY);
  expect(normalizePanelOverlay({})).toStrictEqual(DEFAULT_PANEL_OVERLAY);
});

test("panel overlay preserves a fully specified placement", () => {
  const overlay = normalizePanelOverlay({
    anchor: "bottom-right",
    width: 120,
    maxHeight: "50%",
    margin: { top: 2, right: 3, bottom: 4, left: 5 },
  });

  expect(overlay).toStrictEqual({
    anchor: "bottom-right",
    width: 120,
    maxHeight: "50%",
    margin: { top: 2, right: 3, bottom: 4, left: 5 },
  });
});

test("panel overlay rejects unknown anchors", () => {
  expect(normalizePanelOverlay({ anchor: "middle" }).anchor).toBe("top-center");
  expect(normalizePanelOverlay({ anchor: 7 }).anchor).toBe("top-center");
  // 9 个 Pi 锚点全部可用。
  expect(normalizePanelOverlay({ anchor: "left-center" }).anchor).toBe(
    "left-center",
  );
});

test("panel overlay validates width and maxHeight as positive sizes", () => {
  const overlay = normalizePanelOverlay({ width: "70%", maxHeight: 30 });
  expect(overlay.width).toBe("70%");
  expect(overlay.maxHeight).toBe(30);

  // 超出 0..100 的百分比、非正数与非法字符串都回落到默认值。
  const invalid = normalizePanelOverlay({
    width: "150%",
    maxHeight: "abc",
  });
  expect(invalid.width).toBe(DEFAULT_PANEL_OVERLAY.width);
  expect(invalid.maxHeight).toBe(DEFAULT_PANEL_OVERLAY.maxHeight);
  expect(normalizePanelOverlay({ width: 0 }).width).toBe(
    DEFAULT_PANEL_OVERLAY.width,
  );
  expect(normalizePanelOverlay({ width: -10 }).width).toBe(
    DEFAULT_PANEL_OVERLAY.width,
  );
});

test("panel overlay accepts a single margin number for all edges", () => {
  expect(normalizePanelOverlay({ margin: 4 }).margin).toBe(4);
  // 负数与浮点 margin 非法，回落到默认 margin 对象。
  expect(normalizePanelOverlay({ margin: -1 }).margin).toStrictEqual(
    DEFAULT_PANEL_OVERLAY.margin,
  );
  expect(normalizePanelOverlay({ margin: 1.5 }).margin).toStrictEqual(
    DEFAULT_PANEL_OVERLAY.margin,
  );
});

test("panel overlay merges a partial margin object with defaults per edge", () => {
  const overlay = normalizePanelOverlay({ margin: { top: 10 } });
  expect(overlay.margin).toStrictEqual({
    top: 10,
    right: 1,
    bottom: 1,
    left: 1,
  });

  // 单边的非法值只回落该边，不影响其他已配置边。
  const mixed = normalizePanelOverlay({
    margin: { top: -3, right: 8 },
  });
  expect(mixed.margin).toStrictEqual({
    top: 6,
    right: 8,
    bottom: 1,
    left: 1,
  });
});
