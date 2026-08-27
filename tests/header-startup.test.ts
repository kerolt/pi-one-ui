import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { renderHeaderLines } from "../extensions/layouts/header/startup-header.ts";

// Simulate the Pi runtime by registering app.* keybindings.
setKeybindings(
  new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.interrupt": { defaultKeys: "escape" },
    "app.clear": { defaultKeys: "ctrl+c" },
    "app.exit": { defaultKeys: "ctrl+d" },
    "app.tools.expand": { defaultKeys: "ctrl+o" },
  } as never),
);

// Use a plain theme so visible width matches string length in assertions.
const theme = {
  getFgAnsi: () => "",
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

/**
 * Removes the limited ANSI styling emitted by the test theme.
 */
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

/**
 * Counts visible characters for the plain test theme.
 */
const visibleWidth = (line: string) => [...stripAnsi(line)].length;

const HERO_TEXT = "There are many agent harnesses, but this one is yours.";

test("two-column header keeps the tips column at a fixed offset", () => {
  const lines = renderHeaderLines(120, theme);
  assert.equal(lines.length, 5);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 120, "every row fits the viewport");
  }
  assert.ok(lines[0]!.includes(`pi v${VERSION}`));
  assert.ok(lines[4]!.includes(HERO_TEXT));
  assert.ok(
    !lines.some((line) => line.includes("Pi can explain its own features")),
  );
  assert.equal(stripAnsi(lines[0]!).indexOf("pi v"), 10);
  assert.equal(visibleWidth(lines[0]!.slice(0, 8)), 8);
});

test("narrow header stacks the logo and hero line", () => {
  const lines = renderHeaderLines(40, theme);
  assert.equal(lines.length, 9); // Empty row, five logo rows, hero, and padding.
  assert.ok(lines.every((line) => visibleWidth(line) <= 40));
  assert.ok(!lines.some((line) => line.includes("Press ctrl+o")));
});

test("header tips use the active keybindings", () => {
  const lines = renderHeaderLines(120, theme);
  assert.ok(lines.some((line) => line.includes("escape interrupt")));
  assert.ok(lines.some((line) => line.includes("ctrl+o more")));
  assert.ok(
    lines.some((line) =>
      line.includes("Press ctrl+o to show full startup help"),
    ),
  );
});
