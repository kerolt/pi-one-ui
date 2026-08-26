import { VERSION, type AppKeybinding } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { config } from "../../app/config/renderer.ts";
import { ansi16ToRgb, ansi256ToRgb } from "../../tools/ansi-color.ts";
type Rgb = [number, number, number];
type StyledPart = {
  raw: string;
  styled: string;
};

const ANSI_RESET = "\x1b[0m";
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

// 官方 install.sh 静态 logo（4 行原样，短行补尾随空格统一到 8 列）+ 底部空行补到 5 行，
// 与右侧 tips 行数等高；着色保持现状（accent 渐变）
const LOGO_LINES = ["██████  ", "██  ██  ", "████  ██", "██    ██", "        "];

// hero 文案（单行，替换原生 header 的 "Pi can explain..." 默认位置）
const HERO_PREFIX = "There are many agent harnesses, but this one is ";
const HERO_HIGHLIGHT = "yours";
const HERO_SUFFIX = ".";

// 左右双栏布局：左侧 logo(5 行)，右侧原生提示(5 行)
const TWO_COL_GAP = 2;
// 窄于该宽度回退为垂直堆叠（logo + hero）
const TWO_COL_MIN_WIDTH = 48;

const FALLBACK_ACCENT_RGB: Rgb = [80, 160, 255];
const LOGO_BLOCK_WIDTH = Math.max(
  ...LOGO_LINES.map((line) => [...line].length),
);
// 左栏宽度 = logo 宽，右侧栏从该宽度后开始
const LEFT_COLUMN_WIDTH = LOGO_BLOCK_WIDTH;

const PALETTE_STEPS = 24;
const PALETTE_MAX_DARKEN = 0.18;
const PALETTE_MAX_LIGHTEN = 0.18;
// 行内渐变波长：1/4 全波长（暗→亮单调，避免小字符数行内来回跳变）
const PALETTE_SPAN = 0.25;
// 行间相位偏移：小步累加 → 整体左上暗→右下亮的对角渐变
const LOGO_ROW_PHASE_STEP = 0.08;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function getVisibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function interpolateChannel(
  start: number,
  end: number,
  factor: number,
): number {
  return Math.round(start + (end - start) * factor);
}

function interpolateRgb(start: Rgb, end: Rgb, factor: number): Rgb {
  return [
    interpolateChannel(start[0], end[0], factor),
    interpolateChannel(start[1], end[1], factor),
    interpolateChannel(start[2], end[2], factor),
  ];
}

function darkenRgb(rgb: Rgb, amount: number): Rgb {
  return [
    clampByte(rgb[0] * (1 - amount)),
    clampByte(rgb[1] * (1 - amount)),
    clampByte(rgb[2] * (1 - amount)),
  ];
}

function lightenRgb(rgb: Rgb, amount: number): Rgb {
  return [
    clampByte(rgb[0] + (255 - rgb[0]) * amount),
    clampByte(rgb[1] + (255 - rgb[1]) * amount),
    clampByte(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

function applyTruecolor(rgb: Rgb, text: string): string {
  const [red, green, blue] = rgb;
  return `\x1b[38;2;${red};${green};${blue}m${text}${ANSI_RESET}`;
}

function parseTruecolorAnsi(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseAnsi256Foreground(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;5;(\d+)/);
  if (!match) return undefined;

  return ansi256ToRgb(Number(match[1]));
}

function parseAnsi16Foreground(ansi: string): Rgb | undefined {
  const normalMatch = ansi.match(/(?:\[|;)(3[0-7])(?:;|m)/);
  if (normalMatch) {
    return ansi16ToRgb(Number(normalMatch[1]) - 30);
  }

  const brightMatch = ansi.match(/(?:\[|;)(9[0-7])(?:;|m)/);
  if (brightMatch) {
    return ansi16ToRgb(Number(brightMatch[1]) - 90 + 8);
  }

  return undefined;
}

function parseForegroundRgbFromAnsi(ansi: string): Rgb | undefined {
  return (
    parseTruecolorAnsi(ansi) ??
    parseAnsi256Foreground(ansi) ??
    parseAnsi16Foreground(ansi)
  );
}

function resolveAccentRgb(theme: { getFgAnsi(name: string): string }): Rgb {
  return (
    parseForegroundRgbFromAnsi(theme.getFgAnsi("accent")) ?? FALLBACK_ACCENT_RGB
  );
}

function buildAccentPalette(accent: Rgb): Rgb[] {
  return Array.from({ length: PALETTE_STEPS }, (_, index) => {
    const progress = index / PALETTE_STEPS;
    const wave = -Math.cos(progress * Math.PI * 2);

    if (wave < 0) {
      return darkenRgb(accent, PALETTE_MAX_DARKEN * -wave);
    }

    return lightenRgb(accent, PALETTE_MAX_LIGHTEN * wave);
  });
}

function sampleGradientColor(palette: Rgb[], position: number): Rgb {
  const wrappedPosition = ((position % 1) + 1) % 1;
  const scaledPosition = wrappedPosition * palette.length;
  const baseIndex = Math.floor(scaledPosition) % palette.length;
  const nextIndex = (baseIndex + 1) % palette.length;
  const factor = scaledPosition - Math.floor(scaledPosition);

  return interpolateRgb(palette[baseIndex]!, palette[nextIndex]!, factor);
}

function renderGradientText(
  text: string,
  palette: Rgb[],
  phase: number,
): string {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);

  return characters
    .map((character, index) => {
      if (character === " ") return character;
      // 行内单调暗→亮（1/4 波长），行间相位偏移 → 对角渐变
      const color = sampleGradientColor(
        palette,
        (index / span) * PALETTE_SPAN + phase,
      );
      return applyTruecolor(color, character);
    })
    .join("");
}

function createCenteredBlockLine(
  text: string,
  width: number,
  blockWidth: number,
): string {
  const leftPadding = Math.max(0, Math.floor((width - blockWidth) / 2));
  return `${" ".repeat(leftPadding)}${text}`;
}

function createCenteredStyledLine(parts: StyledPart[], width: number): string {
  const rawText = parts.map((part) => part.raw).join("");
  const leftPadding = Math.max(
    0,
    Math.floor((width - [...rawText].length) / 2),
  );
  const styledText = parts.map((part) => part.styled).join("");
  return `${" ".repeat(leftPadding)}${styledText}`;
}

function fitLineToWidth(line: string, width: number): string {
  if (getVisibleLength(line) <= width) {
    return line;
  }

  return stripAnsi(line).slice(0, width);
}

function renderLogoLines(width: number, palette: Rgb[]): string[] {
  return LOGO_LINES.map((line, rowIndex) => {
    const phasedLine = renderGradientText(
      line,
      palette,
      rowIndex * LOGO_ROW_PHASE_STEP,
    );
    return createCenteredBlockLine(phasedLine, width, LOGO_BLOCK_WIDTH);
  });
}

// ---- 右侧：原生默认 header 文本（对齐 pi 内置 startup header，按键文本随用户 keybindings 动态渲染） ----

function formatKeyPart(part: string): string {
  // 与 pi 内置 keybinding-hints 一致：macOS 上 alt 显示为 option
  return process.platform === "darwin" && part.toLowerCase() === "alt"
    ? "option"
    : part;
}

function formatKeyText(key: string): string {
  return key
    .split("/")
    .map((part) => part.split("+").map(formatKeyPart).join("+"))
    .join("/");
}

function keyText(keybinding: AppKeybinding): string {
  const keys = getKeybindings().getKeys(keybinding);
  return keys.length === 0 ? "" : formatKeyText(keys.join("/"));
}

function renderNativeLines(theme: {
  fg(name: string, text: string): string;
  bold(text: string): string;
}): string[] {
  // 颜色方案照抄 pi 内置 header：按键 dim、描述 muted、分隔符 muted、版本 dim
  const hint = (keybinding: AppKeybinding, description: string) =>
    theme.fg("dim", keyText(keybinding)) + theme.fg("muted", ` ${description}`);
  const rawHint = (key: string, description: string) =>
    theme.fg("dim", formatKeyText(key)) + theme.fg("muted", ` ${description}`);

  const logo =
    theme.bold(theme.fg("accent", "pi")) + theme.fg("dim", ` v${VERSION}`);
  const compact = [
    hint("app.interrupt", "interrupt"),
    rawHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
    rawHint("/", "commands"),
    rawHint("!", "bash"),
    hint("app.tools.expand", "more"),
  ].join(theme.fg("muted", " · "));

  return [
    logo,
    compact,
    theme.fg(
      "dim",
      `Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
    ),
    "",
    // hero 文案替换原生 "Pi can explain..." 行位置
    renderHeroParts(theme)
      .map((part) => part.styled)
      .join(""),
  ];
}

function renderHeroParts(theme: {
  fg(name: string, text: string): string;
  bold(text: string): string;
}): StyledPart[] {
  return [
    { raw: HERO_PREFIX, styled: theme.fg("accent", HERO_PREFIX) },
    {
      raw: HERO_HIGHLIGHT,
      styled: theme.bold(theme.fg("mdLink", HERO_HIGHLIGHT)),
    },
    { raw: HERO_SUFFIX, styled: theme.fg("accent", HERO_SUFFIX) },
  ];
}

export function renderHeaderLines(
  width: number,
  theme: {
    getFgAnsi(name: string): string;
    fg(name: string, text: string): string;
    bold(text: string): string;
  },
): string[] {
  const accentRgb = resolveAccentRgb(theme);
  const palette = buildAccentPalette(accentRgb);

  if (width < TWO_COL_MIN_WIDTH) {
    // 窄屏回退：logo + hero 单行垂直堆叠居中
    const logoLines = renderLogoLines(width, palette);
    const heroLine = createCenteredStyledLine(renderHeroParts(theme), width);
    return ["", ...logoLines, "", heroLine, ""].map((line) =>
      fitLineToWidth(line, width),
    );
  }

  // 双栏：左官方 logo(5 行) 右原生提示(5 行)，同高并排，gap 分隔不交叉
  const leftLines = renderLogoLines(LEFT_COLUMN_WIDTH, palette);
  const rightLines = renderNativeLines(theme);
  const rightWidth = width - LEFT_COLUMN_WIDTH - TWO_COL_GAP;
  const padTop = Math.floor((rightLines.length - leftLines.length) / 2);
  const paddedLeft = [
    ...Array.from({ length: padTop }, () => ""),
    ...leftLines,
    ...Array.from(
      { length: rightLines.length - leftLines.length - padTop },
      () => "",
    ),
  ];

  return paddedLeft.map(
    (line, index) =>
      `${line}${" ".repeat(TWO_COL_GAP)}${fitLineToWidth(rightLines[index] ?? "", rightWidth)}`,
  );
}

/**
 * 按配置应用启动头：on → 自定义 header；off → 恢复官方默认 header。
 * 导出供 /ccstyle 面板在切换开关时实时重应用。
 */
export function applyStartupHeader(ctx: any): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setHeader !== "function") return;
  if (!config.showStartupHeader) {
    // 恢复官方内置 header（logo + 快捷键提示 + onboarding）。
    ctx.ui.setHeader(undefined);
    return;
  }
  ctx.ui.setHeader((_tui: unknown, theme: any) => ({
    render(width: number): string[] {
      return renderHeaderLines(width, theme);
    },
    invalidate() {},
  }));
}

export default function piStartupHeader(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    applyStartupHeader(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader(undefined);
  });
}
