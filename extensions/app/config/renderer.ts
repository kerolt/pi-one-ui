import type { CompactThinkingConfig } from "../../features/compact-thinking.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CompactStyleMode = "on" | "compact" | "off";

// ── diff 显示配置：作为配置 schema 的一部分由 config 层拥有 ──
// renderer（diff）从 config 导入并 re-export，避免 config → renderer 的反向依赖。

export type DiffViewMode = "auto" | "split" | "unified";
export type DiffIndicatorMode = "bars" | "classic" | "none";

export interface ToolDisplayConfig {
  diffViewMode: DiffViewMode;
  diffIndicatorMode: DiffIndicatorMode;
  diffSplitMinWidth: number;
  editDiffCollapsedLines: number;
  /** Write-only collapsed body lines. 0 = `↳ created • click to show more`. */
  writeDiffCollapsedLines: number;
  diffWordWrap: boolean;
  expandedPreviewMaxLines: number;
}

export const DEFAULT_TOOL_DISPLAY_CONFIG: ToolDisplayConfig = {
  diffViewMode: "auto",
  diffIndicatorMode: "bars",
  diffSplitMinWidth: 120,
  /** Collapsed edit/diff body: ~half a typical terminal after chrome. */
  editDiffCollapsedLines: 24,
  /**
   * Write create/overwrite collapsed body.
   * 0 = `↳ created • click to show more` (stats stay on the title).
   */
  writeDiffCollapsedLines: 0,
  diffWordWrap: true,
  /**
   * Expanded tool/diff body cap. 40 ≈ one screen of content after title,
   * Input section, editor, and status — keeps the TUI compact.
   * Raise via /ccstyle → Diff → Expanded max lines when reviewing large dumps.
   */
  expandedPreviewMaxLines: 40,
};

export type Config = {
  mode: CompactStyleMode;
  excludeRenderers: string[];
  diffViewMode: DiffViewMode;
  diffIndicatorMode: DiffIndicatorMode;
  diffSplitMinWidth: number;
  editDiffCollapsedLines: number;
  writeDiffCollapsedLines: number;
  diffWordWrap: boolean;
  expandedPreviewMaxLines: number;
  toolInputNameLength: number;
  useSummaryTitlesAsThinkingTitle: boolean;
  previewLines: number;
  animationIntervalMs: number;
  dimThinkingText: boolean;
  showStartupHeader: boolean;
  scrollStepLines: number;
  enableSessionReference: boolean;
  enableSubagentAutocomplete: boolean;
  enableContextCommand: boolean;
  enableAgentSummary: boolean;
  enableWorkingMessage: boolean;
  enableAliases: boolean;
};

const AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "pi-one-ui.json");
const LEGACY_UNIFIED_CONFIG_PATH = join(AGENT_DIR, "pi-mine-ui.json");
const LEGACY_CONFIG_PATH = join(AGENT_DIR, "claude-code-style.json");
const LEGACY_ZENTUI_CONFIG_PATH = join(AGENT_DIR, "zentui.json");

type ConfigRecord = Record<string, unknown>;

function readJson(path: string): ConfigRecord | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as ConfigRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep the two upstream configuration schemas under one portable file. Zentui
 * owns the root fields; the CC renderer owns `renderer`. Existing installations
 * are imported once without deleting their legacy files.
 */
function readUnifiedConfig(): ConfigRecord {
  const current = readJson(CONFIG_PATH) ?? readJson(LEGACY_UNIFIED_CONFIG_PATH);
  if (current) {
    if (!existsSync(CONFIG_PATH)) {
      try {
        writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
      } catch {
        // Keep using the legacy file in memory if migration cannot be written.
      }
    }
    return current;
  }

  const shell = readJson(LEGACY_ZENTUI_CONFIG_PATH) ?? {};
  const renderer = readJson(LEGACY_CONFIG_PATH);
  if (!renderer && Object.keys(shell).length === 0) return {};

  const migrated = { ...shell, version: 1, renderer: renderer ?? {} };
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2));
  } catch {
    // A read-only agent directory still uses the migrated in-memory value.
  }
  return migrated;
}

function rendererConfigFrom(record: ConfigRecord): ConfigRecord {
  const renderer = record.renderer;
  return renderer && typeof renderer === "object" && !Array.isArray(renderer)
    ? (renderer as ConfigRecord)
    : record;
}

export const DIFF_VIEW_MODES: DiffViewMode[] = ["auto", "split", "unified"];
export const DIFF_INDICATOR_MODES: DiffIndicatorMode[] = [
  "bars",
  "classic",
  "none",
];
export const DIFF_SPLIT_MIN_WIDTH_VALUES = [
  "80",
  "100",
  "120",
  "140",
  "160",
  "180",
];
export const DIFF_COLLAPSED_LINES_VALUES = [
  "12",
  "24",
  "36",
  "48",
  "80",
  "120",
];
/** Write collapsed presets. 0 = stats only (`+N -0` + expand hint). */
export const WRITE_DIFF_COLLAPSED_LINES_VALUES = [
  "0",
  "4",
  "8",
  "12",
  "24",
  "36",
];
/** Presets for expanded body height — keep low options first so cycling stays TUI-friendly. */
export const EXPANDED_PREVIEW_MAX_LINES_VALUES = [
  "40",
  "60",
  "80",
  "120",
  "200",
  "500",
  "2000",
];
/** 工具摘要里 path/command 等输入的折叠字符数。 */
export const TOOL_INPUT_NAME_LENGTH_VALUES = [
  "40",
  "60",
  "80",
  "100",
  "120",
  "160",
];
export const THINKING_PREVIEW_LINES_VALUES = ["0", "1", "3", "5", "10"];
export const THINKING_ANIMATION_INTERVAL_VALUES = [
  "40",
  "60",
  "90",
  "120",
  "180",
];
/** fullscreen 滚轮步进行数预设。 */
export const SCROLL_STEP_LINES_VALUES = ["1", "2", "3", "5", "10"];
/** Tools commonly toggled in excludeRenderers via the settings panel. */
export const EXCLUDE_RENDERER_CANDIDATES = [
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "webfetch",
  "wait",
];

export const DEFAULT_CONFIG: Config = {
  mode: "on",
  excludeRenderers: [],
  diffViewMode: DEFAULT_TOOL_DISPLAY_CONFIG.diffViewMode,
  diffIndicatorMode: DEFAULT_TOOL_DISPLAY_CONFIG.diffIndicatorMode,
  diffSplitMinWidth: DEFAULT_TOOL_DISPLAY_CONFIG.diffSplitMinWidth,
  editDiffCollapsedLines: DEFAULT_TOOL_DISPLAY_CONFIG.editDiffCollapsedLines,
  writeDiffCollapsedLines: DEFAULT_TOOL_DISPLAY_CONFIG.writeDiffCollapsedLines,
  diffWordWrap: DEFAULT_TOOL_DISPLAY_CONFIG.diffWordWrap,
  expandedPreviewMaxLines: DEFAULT_TOOL_DISPLAY_CONFIG.expandedPreviewMaxLines,
  toolInputNameLength: 100,
  useSummaryTitlesAsThinkingTitle: true,
  previewLines: 3,
  animationIntervalMs: 90,
  dimThinkingText: false,
  showStartupHeader: true,
  scrollStepLines: 3,
  enableSessionReference: true,
  enableSubagentAutocomplete: true,
  enableContextCommand: true,
  enableAgentSummary: true,
  // Zentui is the sole owner of Pi's unkeyed working row in pi-one-ui.
  enableWorkingMessage: false,
  enableAliases: true,
};

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function pickPositiveInt(
  value: unknown,
  fallback: number,
  min = 1,
  max = 100_000,
): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function pickPositiveNumber(
  value: unknown,
  fallback: number,
  min = 1,
): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export function normalizeConfig(input: unknown): Config {
  const source = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const mode = source.mode;
  // 旧 `enabled: boolean` 配置迁移；compact 已恢复为受支持模式，不再回退 on。
  const migratedMode: CompactStyleMode =
    mode === "on" || mode === "compact" || mode === "off"
      ? mode
      : typeof source.enabled === "boolean"
        ? source.enabled
          ? "on"
          : "off"
        : "on";
  const excludeRenderers = Array.isArray(source.excludeRenderers)
    ? [
        ...new Set(
          source.excludeRenderers.filter(
            (name): name is string =>
              typeof name === "string" && name.length > 0,
          ),
        ),
      ]
    : [];
  return {
    mode: migratedMode,
    excludeRenderers,
    diffViewMode: pickEnum(
      source.diffViewMode,
      DIFF_VIEW_MODES,
      DEFAULT_CONFIG.diffViewMode,
    ),
    diffIndicatorMode: pickEnum(
      source.diffIndicatorMode,
      DIFF_INDICATOR_MODES,
      DEFAULT_CONFIG.diffIndicatorMode,
    ),
    diffSplitMinWidth: pickPositiveInt(
      source.diffSplitMinWidth,
      DEFAULT_CONFIG.diffSplitMinWidth,
      40,
      300,
    ),
    editDiffCollapsedLines: pickPositiveInt(
      source.editDiffCollapsedLines ?? source.diffCollapsedLines,
      DEFAULT_CONFIG.editDiffCollapsedLines,
      1,
      500,
    ),
    writeDiffCollapsedLines: pickPositiveInt(
      source.writeDiffCollapsedLines,
      DEFAULT_CONFIG.writeDiffCollapsedLines,
      0,
      500,
    ),
    diffWordWrap: source.diffWordWrap !== false,
    expandedPreviewMaxLines: pickPositiveInt(
      source.expandedPreviewMaxLines,
      DEFAULT_CONFIG.expandedPreviewMaxLines,
      10,
      50_000,
    ),
    toolInputNameLength: pickPositiveInt(
      source.toolInputNameLength,
      DEFAULT_CONFIG.toolInputNameLength,
      8,
      500,
    ),
    useSummaryTitlesAsThinkingTitle:
      source.useSummaryTitlesAsThinkingTitle !== false,
    previewLines: pickPositiveInt(
      source.previewLines,
      DEFAULT_CONFIG.previewLines,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    animationIntervalMs: pickPositiveNumber(
      source.animationIntervalMs,
      DEFAULT_CONFIG.animationIntervalMs,
    ),
    dimThinkingText: source.dimThinkingText === true,
    showStartupHeader: source.showStartupHeader !== false,
    scrollStepLines: pickPositiveInt(
      source.scrollStepLines,
      DEFAULT_CONFIG.scrollStepLines,
      1,
      50,
    ),
    enableSessionReference: source.enableSessionReference !== false,
    enableSubagentAutocomplete: source.enableSubagentAutocomplete !== false,
    enableContextCommand: source.enableContextCommand !== false,
    enableAgentSummary: source.enableAgentSummary !== false,
    enableWorkingMessage: source.enableWorkingMessage === true,
    enableAliases: source.enableAliases !== false,
  };
}

export function getCompactThinkingConfig(
  source: Config = config,
): CompactThinkingConfig {
  return {
    useSummaryTitlesAsThinkingTitle: source.useSummaryTitlesAsThinkingTitle,
    previewLines: source.previewLines,
    animationIntervalMs: source.animationIntervalMs,
  };
}

export function getToolDisplayConfig(
  source: Config = config,
): ToolDisplayConfig {
  return {
    diffViewMode: source.diffViewMode,
    diffIndicatorMode: source.diffIndicatorMode,
    diffSplitMinWidth: source.diffSplitMinWidth,
    editDiffCollapsedLines: source.editDiffCollapsedLines,
    writeDiffCollapsedLines: source.writeDiffCollapsedLines,
    diffWordWrap: source.diffWordWrap,
    expandedPreviewMaxLines: source.expandedPreviewMaxLines,
  };
}

export function formatExcludeRenderers(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

export function formatConfigStatus(source: Config = config): string {
  return [
    `mode=${source.mode}`,
    `exclude=[${source.excludeRenderers.join(", ") || "none"}]`,
    `diffView=${source.diffViewMode}`,
    `diffIndicator=${source.diffIndicatorMode}`,
    `diffSplitMin=${source.diffSplitMinWidth}`,
    `editCollapsed=${source.editDiffCollapsedLines}`,
    `writeCollapsed=${source.writeDiffCollapsedLines}`,
    `diffWordWrap=${source.diffWordWrap ? "on" : "off"}`,
    `expandedMax=${source.expandedPreviewMaxLines}`,
    `toolInputName=${source.toolInputNameLength}`,
    `thinkingTitle=${source.useSummaryTitlesAsThinkingTitle ? "summary" : "default"}`,
    `thinkingPreview=${source.previewLines}`,
    `thinkingAnimation=${source.animationIntervalMs}ms`,
    `thinkingDim=${source.dimThinkingText ? "on" : "off"}`,
    `startupHeader=${source.showStartupHeader ? "on" : "off"}`,
    `scrollStep=${source.scrollStepLines}`,
    `sessionRef=${source.enableSessionReference ? "on" : "off"}`,
    `subagentAuto=${source.enableSubagentAutocomplete ? "on" : "off"}`,
    `context=${source.enableContextCommand ? "on" : "off"}`,
    `agentSummary=${source.enableAgentSummary ? "on" : "off"}`,
    `workingMsg=${source.enableWorkingMessage ? "on" : "off"}`,
    `aliases=${source.enableAliases ? "on" : "off"}`,
  ].join(" · ");
}

/** 进程内唯一的活动配置对象。读取直接用 `config.xxx`；写入必须走 `updateConfig`。 */
export const config: Config = loadConfig();

function loadConfig(): Config {
  try {
    const unified = readUnifiedConfig();
    return normalizeConfig(rendererConfigFrom(unified));
  } catch {
    // Ignore bad config and fall back to defaults.
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig() {
  const unified = readUnifiedConfig();
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ ...unified, version: 1, renderer: config }, null, 2),
  );
}

/** 运行时配置写入的唯一入口：合并 + 规范化 + 持久化。 */
export function updateConfig(partial: Partial<Config>): void {
  Object.assign(config, normalizeConfig({ ...config, ...partial }));
  saveConfig();
}

/** 整体替换配置（default export 的 configOverride 注入路径；就地覆盖，不持久化）。 */
export function setConfig(next: Config): void {
  Object.assign(config, next);
}
