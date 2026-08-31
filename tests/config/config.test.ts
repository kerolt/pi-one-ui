import { expect, test } from "vitest";
import { normalizeConfig } from "../../extensions/app/config/renderer.ts";

test("renderer config keeps the unified package defaults", () => {
  const config = normalizeConfig({});
  expect(config.mode).toBe("on");
  expect(config.diffViewMode).toBe("auto");
});

test("renderer config ignores removed legacy field aliases", () => {
  const config = normalizeConfig({
    enabled: false,
    diffCollapsedLines: 12,
  });
  expect(config.mode).toBe("on");
  expect(config.editDiffCollapsedLines).toBe(24);
});
