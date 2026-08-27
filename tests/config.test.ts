import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig } from "../extensions/app/config/renderer.ts";

test("renderer config keeps the unified package defaults", () => {
  const config = normalizeConfig({});
  assert.equal(config.mode, "on");
  assert.equal(config.enableWorkingMessage, false);
  assert.equal(config.diffViewMode, "auto");
});

test("renderer config still accepts legacy enabled migration", () => {
  assert.equal(normalizeConfig({ enabled: false }).mode, "off");
  assert.equal(normalizeConfig({ enabled: true }).mode, "on");
});

test("renderer config preserves the current working-message opt-in", () => {
  assert.equal(
    normalizeConfig({ enableWorkingMessage: true }).enableWorkingMessage,
    true,
  );
  assert.equal(
    normalizeConfig({ enableWorkingMessage: false }).enableWorkingMessage,
    false,
  );
});
