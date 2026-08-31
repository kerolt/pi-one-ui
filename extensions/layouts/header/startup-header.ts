import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AppKeybinding, VERSION } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
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

// Official install.sh static logo. Short rows are padded to eight cells,
// and one empty row keeps the logo as tall as the tips column.
const LOGO_LINES = ["██████  ", "██  ██  ", "████  ██", "██    ██", "        "];

// Single-line hero copy replacing Pi's default startup sentence.
const HERO_PREFIX = "There are many agent harnesses, but this one is ";
const HERO_HIGHLIGHT = "yours";
const HERO_SUFFIX = ".";

// Two-column layout: five logo rows on the left and five tips rows on the right.
const TWO_COL_GAP = 2;
// Narrower viewports fall back to a vertical logo and hero layout.
const TWO_COL_MIN_WIDTH = 48;

const FALLBACK_ACCENT_RGB: Rgb = [80, 160, 255];
const LOGO_BLOCK_WIDTH = Math.max(
  ...LOGO_LINES.map((line) => [...line].length),
);
// The tips column starts after the fixed logo width and gap.
const LEFT_COLUMN_WIDTH = LOGO_BLOCK_WIDTH;

const PALETTE_STEPS = 24;
const PALETTE_MAX_DARKEN = 0.18;
const PALETTE_MAX_LIGHTEN = 0.18;
// The row gradient uses a monotonic quarter-wave to avoid oscillation on short rows.
const PALETTE_SPAN = 0.25;
// A small phase offset between rows creates a diagonal top-left to bottom-right gradient.
const LOGO_ROW_PHASE_STEP = 0.08;

/**
 * Removes terminal styling sequences before measuring visible text.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Returns the number of visible cells in a terminal string.
 */
function getVisibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

/**
 * Clamps a color channel to the byte range accepted by truecolor ANSI.
 */
function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Interpolates one color channel between two byte values.
 */
function interpolateChannel(
  start: number,
  end: number,
  factor: number,
): number {
  return Math.round(start + (end - start) * factor);
}

/**
 * Interpolates all channels between two RGB colors.
 */
function interpolateRgb(start: Rgb, end: Rgb, factor: number): Rgb {
  return [
    interpolateChannel(start[0], end[0], factor),
    interpolateChannel(start[1], end[1], factor),
    interpolateChannel(start[2], end[2], factor),
  ];
}

/**
 * Darkens an RGB color by a normalized amount.
 */
function darkenRgb(rgb: Rgb, amount: number): Rgb {
  return [
    clampByte(rgb[0] * (1 - amount)),
    clampByte(rgb[1] * (1 - amount)),
    clampByte(rgb[2] * (1 - amount)),
  ];
}

/**
 * Lightens an RGB color by a normalized amount.
 */
function lightenRgb(rgb: Rgb, amount: number): Rgb {
  return [
    clampByte(rgb[0] + (255 - rgb[0]) * amount),
    clampByte(rgb[1] + (255 - rgb[1]) * amount),
    clampByte(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

/**
 * Wraps text in a truecolor foreground sequence and a reset.
 */
function applyTruecolor(rgb: Rgb, text: string): string {
  const [red, green, blue] = rgb;
  return `\x1b[38;2;${red};${green};${blue}m${text}${ANSI_RESET}`;
}

/**
 * Parses a truecolor foreground from an ANSI sequence.
 */
function parseTruecolorAnsi(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Parses an ANSI 256-color foreground and converts it to RGB.
 */
function parseAnsi256Foreground(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;5;(\d+)/);
  if (!match) return undefined;

  return ansi256ToRgb(Number(match[1]));
}

/**
 * Parses a standard or bright ANSI foreground and converts it to RGB.
 */
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

/**
 * Resolves the first supported foreground color found in an ANSI sequence.
 */
function parseForegroundRgbFromAnsi(ansi: string): Rgb | undefined {
  return (
    parseTruecolorAnsi(ansi) ??
    parseAnsi256Foreground(ansi) ??
    parseAnsi16Foreground(ansi)
  );
}

/**
 * Resolves the theme accent color, falling back to a stable blue.
 */
function resolveAccentRgb(theme: { getFgAnsi(name: string): string }): Rgb {
  return (
    parseForegroundRgbFromAnsi(theme.getFgAnsi("accent")) ?? FALLBACK_ACCENT_RGB
  );
}

/**
 * Builds the cyclic dark-to-light palette used by the logo gradient.
 */
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

/**
 * Samples one wrapped position from an RGB palette.
 */
function sampleGradientColor(palette: Rgb[], position: number): Rgb {
  const wrappedPosition = ((position % 1) + 1) % 1;
  const scaledPosition = wrappedPosition * palette.length;
  const baseIndex = Math.floor(scaledPosition) % palette.length;
  const nextIndex = (baseIndex + 1) % palette.length;
  const factor = scaledPosition - Math.floor(scaledPosition);

  return interpolateRgb(palette[baseIndex]!, palette[nextIndex]!, factor);
}

/**
 * Applies a diagonal accent gradient to non-space characters.
 */
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
      // Use a monotonic quarter-wave within each row and phase-shift rows.
      const color = sampleGradientColor(
        palette,
        (index / span) * PALETTE_SPAN + phase,
      );
      return applyTruecolor(color, character);
    })
    .join("");
}

/**
 * Centers a fixed-width block within the available viewport.
 */
function createCenteredBlockLine(
  text: string,
  width: number,
  blockWidth: number,
): string {
  const leftPadding = Math.max(0, Math.floor((width - blockWidth) / 2));
  return `${" ".repeat(leftPadding)}${text}`;
}

/**
 * Centers styled parts while measuring their unstyled representation.
 */
function createCenteredStyledLine(parts: StyledPart[], width: number): string {
  const rawText = parts.map((part) => part.raw).join("");
  const leftPadding = Math.max(
    0,
    Math.floor((width - [...rawText].length) / 2),
  );
  const styledText = parts.map((part) => part.styled).join("");
  return `${" ".repeat(leftPadding)}${styledText}`;
}

/**
 * Truncates a rendered line without allowing ANSI escapes to affect width.
 */
function fitLineToWidth(line: string, width: number): string {
  if (getVisibleLength(line) <= width) {
    return line;
  }

  return stripAnsi(line).slice(0, width);
}

/**
 * Renders all logo rows at the requested width and gradient phase.
 */
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

// The right column mirrors Pi's startup hints and reads active keybindings.

/**
 * Normalizes one keybinding part for the current operating system.
 */
function formatKeyPart(part: string): string {
  // Match Pi's keybinding hints: macOS displays alt as option.
  return process.platform === "darwin" && part.toLowerCase() === "alt"
    ? "option"
    : part;
}

/**
 * Formats a slash- or plus-separated keybinding for display.
 */
function formatKeyText(key: string): string {
  return key
    .split("/")
    .map((part) => part.split("+").map(formatKeyPart).join("+"))
    .join("/");
}

/**
 * Resolves the configured display text for one application keybinding.
 */
function keyText(keybinding: AppKeybinding): string {
  const keys = getKeybindings().getKeys(keybinding);
  return keys.length === 0 ? "" : formatKeyText(keys.join("/"));
}

/**
 * Renders the native startup hints shown beside the logo.
 */
function renderNativeLines(theme: {
  fg(name: string, text: string): string;
  bold(text: string): string;
}): string[] {
  // Match Pi's header palette: dim keys, muted descriptions and separators.
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
    // Replace the native "Pi can explain..." row with the hero sentence.
    renderHeroParts(theme)
      .map((part) => part.styled)
      .join(""),
  ];
}

/**
 * Builds the styled hero sentence and its raw-width counterparts.
 */
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

/**
 * Renders the responsive startup header for one viewport width.
 *
 * @param width Available terminal width in cells.
 * @param theme Theme functions used for styling and accent discovery.
 * @returns Header rows that fit the requested layout.
 */
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
    // Narrow fallback: vertically stack the centered logo and hero.
    const logoLines = renderLogoLines(width, palette);
    const heroLine = createCenteredStyledLine(renderHeroParts(theme), width);
    return ["", ...logoLines, "", heroLine, ""].map((line) =>
      fitLineToWidth(line, width),
    );
  }

  // Wide layout: place the equal-height logo and native tips columns side by side.
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
 * Applies the configured startup header or restores Pi's native header.
 *
 * @param ctx Active extension context supplied by Pi.
 */
export function applyStartupHeader(ctx: any): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setHeader !== "function") return;
  if (!config.showStartupHeader) {
    // Restore Pi's built-in logo, key hints and onboarding content.
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

/**
 * Registers the Header layout lifecycle with the Pi extension host.
 */
export default function registerHeaderLayout(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    applyStartupHeader(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader(undefined);
  });
}
