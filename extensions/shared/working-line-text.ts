import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";

export const MAX_WORKING_LINE_MESSAGES = 48;
export const MAX_WORKING_LINE_MESSAGE_CELLS = 43;
export const MAX_WORKING_LINE_RAW_CODE_UNITS = 4096;
export const MAX_WORKING_LINE_NORMALIZED_CODE_UNITS = 256;
export const MAX_WORKING_LINE_ENTRIES_EXAMINED = 256;

export function* segmentGraphemes(value: string): Iterable<string> {
  for (const part of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(value)) {
    yield part.segment;
  }
}

export function truncateGraphemes(
  value: string,
  maximumCells: number,
  maximumCodeUnits = Number.POSITIVE_INFINITY,
): string {
  let width = 0;
  let codeUnits = 0;
  const output: string[] = [];
  for (const grapheme of segmentGraphemes(value)) {
    const nextWidth = visibleWidth(grapheme);
    if (
      width >= maximumCells ||
      width + nextWidth > maximumCells ||
      codeUnits + grapheme.length > maximumCodeUnits
    ) {
      break;
    }
    output.push(grapheme);
    width += nextWidth;
    codeUnits += grapheme.length;
  }
  while (output.length > 0 && /^\s+$/u.test(output.at(-1) ?? "")) {
    output.pop();
  }
  return output.join("");
}

/** 配置与渲染共同使用的文本限制，保留完整 grapheme。 */
export function normalizeWorkingLineMessage(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  let bounded = value;
  if (value.length > MAX_WORKING_LINE_RAW_CODE_UNITS) {
    const graphemes = [
      ...segmentGraphemes(value.slice(0, MAX_WORKING_LINE_RAW_CODE_UNITS)),
    ];
    graphemes.pop();
    bounded = graphemes.join("");
  }
  const withoutTerminalSequences = stripVTControlCharacters(
    bounded
      .replaceAll(
        /[\u0090\u0098\u009d\u009e\u009f][\s\S]*?(?:\u0007|\u009c|\x1b\\|$)/g,
        "",
      )
      .replaceAll(/\u009b[0-?]*[ -/]*[@-~]/g, ""),
  );
  const normalized = withoutTerminalSequences
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replaceAll(
      /[\u034f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u206f]/g,
      "",
    )
    .normalize("NFC")
    .replaceAll(/\s+/gu, " ");
  const graphemes = [...segmentGraphemes(normalized)];
  while (graphemes.length > 0 && /^\s+$/u.test(graphemes[0] ?? "")) {
    graphemes.shift();
  }
  while (graphemes.length > 0 && /^\s+$/u.test(graphemes.at(-1) ?? "")) {
    graphemes.pop();
  }
  const truncated = truncateGraphemes(
    graphemes.join(""),
    MAX_WORKING_LINE_MESSAGE_CELLS,
    MAX_WORKING_LINE_NORMALIZED_CODE_UNITS,
  );
  return visibleWidth(truncated) > 0 ? truncated : "";
}

export function normalizeWorkingLineMessages(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  const examined = Math.min(values.length, MAX_WORKING_LINE_ENTRIES_EXAMINED);
  for (let index = 0; index < examined; index += 1) {
    const normalized = normalizeWorkingLineMessage(values[index]);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length === MAX_WORKING_LINE_MESSAGES) {
      break;
    }
  }
  return output;
}
