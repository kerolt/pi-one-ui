import { type ModelLabelSource, parseEditorModelLabel } from "./editor.ts";
import { booleanValue, recordValue } from "./values.ts";

export type ContextStyle = "text" | "gauge" | "text+gauge";
export type SeparatorStyle = "pipe" | "dot" | "chevron" | "none";
export type FooterStyle = "native" | "starship" | "hidden";
export type CompactFooterMaxLines = 1 | 2 | 3 | "unlimited";
export type ContextThresholds = { warning: number; error: number };
export type PathDisplayMode = "basename" | "full";
export type PathDisplayConfig = { mode: PathDisplayMode; depth: number };
export type GitBranchMaxLength = "full" | number;
export type GitBranchConfig = { maxLength: GitBranchMaxLength };
export type GitCommitConfig = {
  hashLength: number;
  onlyDetached: boolean;
  showTag: boolean;
};
export type GitMetricsConfig = {
  onlyNonzero: boolean;
  ignoreSubmodules: boolean;
};
export type ExtensionStatusPlacement = "off" | "left" | "middle" | "right";
export type ExtensionStatusColorMode = "zentui" | "original";
export type ExtensionStatusesConfig = {
  defaultPlacement: ExtensionStatusPlacement;
  placements: Record<string, ExtensionStatusPlacement>;
  colorModes: Record<string, ExtensionStatusColorMode>;
};
export type FooterSegmentsConfig = {
  cwd: boolean;
  sessionName: boolean;
  gitBranch: boolean;
  gitStatus: boolean;
  gitCounts: boolean;
  gitCommit: boolean;
  gitMetrics: boolean;
  runtime: boolean;
  modelInfo: boolean;
  context: boolean;
  tokens: boolean;
  cost: boolean;
  sessionDuration: boolean;
  username: boolean;
  time: boolean;
  os: boolean;
  packageVersion: boolean;
};
export type StarshipFooterStyleConfig = {
  format: string;
  responsive: boolean;
  compactFormat: string;
  compactMaxLines: CompactFooterMaxLines;
  separator: SeparatorStyle;
  contextStyle: ContextStyle;
  contextThresholds: ContextThresholds;
  pathDisplay: PathDisplayConfig;
  segments: FooterSegmentsConfig;
  gitBranch: GitBranchConfig;
  gitCommit: GitCommitConfig;
  gitMetrics: GitMetricsConfig;
  extensionStatuses: ExtensionStatusesConfig;
};
export type FooterComponentConfig = {
  style: FooterStyle;
  modelLabel: ModelLabelSource;
  styles: { starship: StarshipFooterStyleConfig };
};

export const DEFAULT_COMPACT_FOOTER_FORMAT =
  "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens";
export const FOOTER_FORMAT_VARIABLES = [
  "cwd",
  "session_name",
  "git_branch",
  "git_status",
  "git_state",
  "runtime",
  "model",
  "provider",
  "session_duration",
  "username",
  "os",
  "time",
  "context",
  "tokens",
  "cache_read",
  "cache_write",
  "cost",
  "subscription",
  "auto_compaction",
  "package",
  "package_version",
  "git_commit",
  "git_tag",
  "git_metrics",
  "git_added",
  "git_deleted",
  "sep",
] as const;
export const FOOTER_FORMAT_ALIASES: Record<string, string> = {
  directory: "cwd",
  branch: "git_branch",
  status: "git_status",
  state: "git_state",
  commit: "git_commit",
  tag: "git_tag",
  duration: "session_duration",
  separator: "sep",
};
export const defaultFooterSegments: FooterSegmentsConfig = {
  cwd: true,
  sessionName: true,
  gitBranch: true,
  gitStatus: true,
  gitCounts: false,
  gitCommit: false,
  gitMetrics: false,
  runtime: true,
  modelInfo: false,
  context: true,
  tokens: true,
  cost: true,
  sessionDuration: false,
  username: false,
  time: false,
  os: false,
  packageVersion: false,
};
export const defaultStarshipStyle: StarshipFooterStyleConfig = {
  format: "",
  responsive: true,
  compactFormat: DEFAULT_COMPACT_FOOTER_FORMAT,
  compactMaxLines: 2,
  separator: "pipe",
  contextStyle: "text",
  contextThresholds: { warning: 70, error: 90 },
  pathDisplay: { mode: "basename", depth: 0 },
  segments: defaultFooterSegments,
  gitBranch: { maxLength: "full" },
  gitCommit: { hashLength: 7, onlyDetached: true, showTag: true },
  gitMetrics: { onlyNonzero: true, ignoreSubmodules: false },
  extensionStatuses: {
    defaultPlacement: "right",
    placements: {},
    colorModes: {},
  },
};
export const defaultFooter: FooterComponentConfig = {
  style: "starship",
  modelLabel: "id",
  styles: { starship: defaultStarshipStyle },
};

export function isSeparatorStyle(value: unknown): value is SeparatorStyle {
  return (
    value === "pipe" ||
    value === "dot" ||
    value === "chevron" ||
    value === "none"
  );
}
export function parseSeparatorStyle(value: unknown): SeparatorStyle {
  return isSeparatorStyle(value) ? value : "pipe";
}
export function parseContextStyle(value: unknown): ContextStyle {
  return value === "gauge" || value === "text+gauge" ? value : "text";
}
export function parseCompactFooterMaxLines(
  value: unknown,
): CompactFooterMaxLines {
  return value === 1 || value === 2 || value === 3 || value === "unlimited"
    ? value
    : 2;
}
export function isExtensionStatusPlacement(
  value: unknown,
): value is ExtensionStatusPlacement {
  return (
    value === "off" ||
    value === "left" ||
    value === "middle" ||
    value === "right"
  );
}
export function isExtensionStatusColorMode(
  value: unknown,
): value is ExtensionStatusColorMode {
  return value === "zentui" || value === "original";
}

function thresholds(value: unknown): ContextThresholds {
  const source = recordValue(value);
  const percent = (input: unknown, defaultValue: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.max(0, Math.min(100, Math.round(input)))
      : defaultValue;
  const warning = percent(source.warning, 70);
  const error = percent(source.error, 90);
  return { warning: Math.min(warning, error), error: Math.max(warning, error) };
}

/** 每个 Footer 字段独立规范化，返回完整的 canonical 配置。 */
export function normalizeFooter(value: unknown): FooterComponentConfig {
  const footer = recordValue(value);
  const source = recordValue(recordValue(footer.styles).starship);
  const path = recordValue(source.pathDisplay);
  const branch = recordValue(source.gitBranch);
  const commit = recordValue(source.gitCommit);
  const metrics = recordValue(source.gitMetrics);
  const statuses = recordValue(source.extensionStatuses);
  const segments = recordValue(source.segments);
  const hashLength =
    typeof commit.hashLength === "number"
      ? commit.hashLength
      : Number(commit.hashLength);
  return {
    style:
      footer.style === "native" || footer.style === "hidden"
        ? footer.style
        : "starship",
    modelLabel: parseEditorModelLabel(footer.modelLabel),
    styles: {
      starship: {
        format: typeof source.format === "string" ? source.format : "",
        responsive: booleanValue(source.responsive, true),
        compactFormat:
          typeof source.compactFormat === "string" &&
          source.compactFormat.length > 0
            ? source.compactFormat
            : DEFAULT_COMPACT_FOOTER_FORMAT,
        compactMaxLines: parseCompactFooterMaxLines(source.compactMaxLines),
        separator: parseSeparatorStyle(source.separator),
        contextStyle: parseContextStyle(source.contextStyle),
        contextThresholds: thresholds(source.contextThresholds),
        pathDisplay: {
          mode: path.mode === "full" ? "full" : "basename",
          depth:
            typeof path.depth === "number" &&
            Number.isFinite(path.depth) &&
            path.depth >= 0
              ? Math.min(5, Math.floor(path.depth))
              : 0,
        },
        segments: Object.fromEntries(
          Object.entries(defaultFooterSegments).map(([key, enabled]) => [
            key,
            booleanValue(segments[key], enabled),
          ]),
        ) as FooterSegmentsConfig,
        gitBranch: {
          maxLength:
            typeof branch.maxLength === "number" &&
            Number.isInteger(branch.maxLength) &&
            branch.maxLength > 0
              ? branch.maxLength
              : "full",
        },
        gitCommit: {
          hashLength: Number.isFinite(hashLength)
            ? Math.min(40, Math.max(4, Math.round(hashLength)))
            : 7,
          onlyDetached: booleanValue(commit.onlyDetached, true),
          showTag: booleanValue(commit.showTag, true),
        },
        gitMetrics: {
          onlyNonzero: booleanValue(metrics.onlyNonzero, true),
          ignoreSubmodules: booleanValue(metrics.ignoreSubmodules, false),
        },
        extensionStatuses: {
          defaultPlacement: isExtensionStatusPlacement(
            statuses.defaultPlacement,
          )
            ? statuses.defaultPlacement
            : "right",
          placements: Object.fromEntries(
            Object.entries(recordValue(statuses.placements)).filter(
              (entry): entry is [string, ExtensionStatusPlacement] =>
                isExtensionStatusPlacement(entry[1]),
            ),
          ),
          colorModes: Object.fromEntries(
            Object.entries(recordValue(statuses.colorModes)).filter(
              (entry): entry is [string, ExtensionStatusColorMode] =>
                isExtensionStatusColorMode(entry[1]),
            ),
          ),
        },
      },
    },
  };
}
