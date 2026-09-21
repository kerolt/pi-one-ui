import { normalizeWorkingLineMessages } from "../../shared/working-line-text.ts";
import { booleanValue, recordValue } from "./values.ts";
import { PI_WORKING_LINE_MESSAGES } from "./working-line-messages.ts";

export type WorkingLineSpinner =
  | "braille"
  | "star-bloom"
  | "pinwheel"
  | "claude-inspired"
  | "pulse";
export type WorkingLineTextAnimation = "classic" | "kitt" | "disabled";
export type WorkingLineMessagesConfig = { custom: boolean; values: string[] };
export type WorkingLineSegmentsConfig = {
  tool: boolean;
  elapsed: boolean;
  thought: boolean;
  tokens: boolean;
};
export type WorkingLineComponentConfig = {
  enabled: boolean;
  turnSummary: boolean;
  spinner: WorkingLineSpinner;
  spinnerIntervalMs: number;
  animateSpinnerColor: boolean;
  textIntervalMs: number;
  textAnimation: WorkingLineTextAnimation;
  messages: WorkingLineMessagesConfig;
  segments: WorkingLineSegmentsConfig;
};
export type WorkingLineComponentPatch = Partial<
  Omit<WorkingLineComponentConfig, "messages" | "segments">
> & {
  messages?: Partial<WorkingLineMessagesConfig>;
  segments?: Partial<WorkingLineSegmentsConfig>;
};
export const DEFAULT_WORKING_LINE_SPINNER_INTERVAL_MS = 100;
export const DEFAULT_WORKING_LINE_TEXT_INTERVAL_MS = 60;
export const MIN_WORKING_LINE_INTERVAL_MS = 30;
export const MAX_WORKING_LINE_INTERVAL_MS = 1000;
export const defaultWorkingLine: WorkingLineComponentConfig = {
  enabled: false,
  turnSummary: true,
  spinner: "star-bloom",
  spinnerIntervalMs: DEFAULT_WORKING_LINE_SPINNER_INTERVAL_MS,
  animateSpinnerColor: false,
  textIntervalMs: DEFAULT_WORKING_LINE_TEXT_INTERVAL_MS,
  textAnimation: "classic",
  messages: { custom: true, values: [...PI_WORKING_LINE_MESSAGES] },
  segments: { tool: true, elapsed: true, thought: true, tokens: true },
};
export function isValidWorkingLineIntervalMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_WORKING_LINE_INTERVAL_MS &&
    value <= MAX_WORKING_LINE_INTERVAL_MS
  );
}

export function normalizeWorkingLine(
  value: unknown,
): WorkingLineComponentConfig {
  const source = recordValue(value);
  const messages = recordValue(source.messages);
  const segments = recordValue(source.segments);
  return {
    enabled: booleanValue(source.enabled, false),
    turnSummary: booleanValue(source.turnSummary, true),
    spinner:
      source.spinner === "braille" ||
      source.spinner === "pinwheel" ||
      source.spinner === "claude-inspired" ||
      source.spinner === "pulse"
        ? source.spinner
        : "star-bloom",
    spinnerIntervalMs: isValidWorkingLineIntervalMs(source.spinnerIntervalMs)
      ? source.spinnerIntervalMs
      : DEFAULT_WORKING_LINE_SPINNER_INTERVAL_MS,
    animateSpinnerColor: booleanValue(source.animateSpinnerColor, false),
    textIntervalMs: isValidWorkingLineIntervalMs(source.textIntervalMs)
      ? source.textIntervalMs
      : DEFAULT_WORKING_LINE_TEXT_INTERVAL_MS,
    textAnimation:
      source.textAnimation === "kitt" || source.textAnimation === "disabled"
        ? source.textAnimation
        : "classic",
    messages: {
      custom: booleanValue(messages.custom, true),
      values: Object.hasOwn(messages, "values")
        ? normalizeWorkingLineMessages(messages.values)
        : [...PI_WORKING_LINE_MESSAGES],
    },
    segments: {
      tool: booleanValue(segments.tool, true),
      elapsed: booleanValue(segments.elapsed, true),
      thought: booleanValue(segments.thought, true),
      tokens: booleanValue(segments.tokens, true),
    },
  };
}
