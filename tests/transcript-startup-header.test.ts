import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { renderHeaderLines } from "../extensions/features/shell/startup-header.ts";

// 模拟 pi 运行时：注册 app.* 键绑定（默认与 pi 内置一致）
setKeybindings(
  new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.interrupt": { defaultKeys: "escape" },
    "app.clear": { defaultKeys: "ctrl+c" },
    "app.exit": { defaultKeys: "ctrl+d" },
    "app.tools.expand": { defaultKeys: "ctrl+o" },
  } as never),
);

// 无 ANSI 的 mock 主题：宽度即可见宽度，便于断言布局
const theme = {
  getFgAnsi: () => "",
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
const visibleWidth = (line: string) => [...stripAnsi(line)].length;

const HERO_TEXT = "There are many agent harnesses, but this one is yours.";

test("双栏：logo 与 tips 并排，右栏从固定列开始", () => {
  const lines = renderHeaderLines(120, theme);
  assert.equal(lines.length, 5);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 120, "所有行不超宽");
  }
  assert.ok(lines[0]!.includes(`pi v${VERSION}`));
  assert.ok(lines[4]!.includes(HERO_TEXT));
  assert.ok(
    !lines.some((line) => line.includes("Pi can explain its own features")),
  );
  assert.equal(stripAnsi(lines[0]!).indexOf("pi v"), 10);
  assert.equal(visibleWidth(lines[0]!.slice(0, 8)), 8);
});

test("窄屏回退：垂直堆叠 logo + hero 单行", () => {
  const lines = renderHeaderLines(40, theme);
  assert.equal(lines.length, 9); // 空+5 logo(官方 4 行+空行)+空+hero+空
  assert.ok(lines.every((line) => visibleWidth(line) <= 40));
  assert.ok(!lines.some((line) => line.includes("Press ctrl+o")));
});

test("右栏按键文本来自 keybinding 动态渲染", () => {
  const lines = renderHeaderLines(120, theme);
  assert.ok(lines.some((line) => line.includes("escape interrupt")));
  assert.ok(lines.some((line) => line.includes("ctrl+o more")));
  assert.ok(
    lines.some((line) =>
      line.includes("Press ctrl+o to show full startup help"),
    ),
  );
});
