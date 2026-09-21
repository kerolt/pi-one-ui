import { booleanValue, recordValue } from "./values.ts";

export type UserMessageStyle =
  | "framed"
  | "framed-copy-friendly"
  | "compact"
  | "labeled";
export type FramedUserMessageStyleConfig = Record<string, never>;
export type FramedCopyFriendlyUserMessageStyleConfig = Record<string, never>;
export type CompactUserMessageStyleConfig = Record<string, never>;
export type LabeledUserMessageStyleConfig = Record<string, never>;
export type UserMessagesComponentConfig = {
  enabled: boolean;
  style: UserMessageStyle;
  styles: {
    framed: FramedUserMessageStyleConfig;
    "framed-copy-friendly": FramedCopyFriendlyUserMessageStyleConfig;
    compact: CompactUserMessageStyleConfig;
    labeled: LabeledUserMessageStyleConfig;
  };
};

export function normalizeUserMessages(
  value: unknown,
): UserMessagesComponentConfig {
  const source = recordValue(value);
  return {
    enabled: booleanValue(source.enabled, true),
    style:
      source.style === "framed-copy-friendly" ||
      source.style === "compact" ||
      source.style === "labeled"
        ? source.style
        : "framed",
    styles: {
      framed: {},
      "framed-copy-friendly": {},
      compact: {},
      labeled: {},
    },
  };
}
