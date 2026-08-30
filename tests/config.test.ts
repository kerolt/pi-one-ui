import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig } from "../extensions/app/config/renderer.ts";

test("renderer config keeps the unified package defaults", () => {
  const config = normalizeConfig({});
  assert.equal(config.mode, "on");
  assert.equal(config.diffViewMode, "auto");
});

test("renderer config ignores removed legacy field aliases", () => {
  const config = normalizeConfig({
    enabled: false,
    diffCollapsedLines: 12,
  });
  assert.equal(config.mode, "on");
  assert.equal(config.editDiffCollapsedLines, 24);
});
