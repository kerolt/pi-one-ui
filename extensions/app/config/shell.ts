import {
  ICON_GLYPH_KEYS,
  type IconGlyphs,
  type IconMode,
  NERD_DEFAULT_ICONS,
  normalizeIconMode,
  type ResolvedIcons,
  resolveConfiguredIcons,
} from "../../shared/icons.ts";
import { isSupportedColorSpec } from "../../shared/style.ts";
import {
  normalizeUserMessages,
  type UserMessagesComponentConfig,
} from "./context.ts";
import {
  defaultEditor,
  type EditorBorderColorMode,
  type EditorComponentConfig,
  type EditorStyle,
  type MinimalistConfig,
  type MinimalistEditorStyleConfig,
  type ModelLabelSource,
  normalizeEditor,
  parseEditorBorderColorMode,
  parseEditorModelLabel,
  parseEditorStyle,
} from "./editor.ts";
import {
  type CompactFooterMaxLines,
  type ContextStyle,
  type ContextThresholds,
  defaultFooter,
  defaultFooterSegments,
  type ExtensionStatusColorMode,
  type ExtensionStatusPlacement,
  type FooterComponentConfig,
  type FooterSegmentsConfig,
  type GitBranchConfig,
  type GitCommitConfig,
  type GitMetricsConfig,
  isExtensionStatusColorMode,
  isExtensionStatusPlacement,
  normalizeFooter,
  type PathDisplayConfig,
  parseCompactFooterMaxLines,
  parseContextStyle,
  parseSeparatorStyle,
  type SeparatorStyle,
  type StarshipFooterStyleConfig,
} from "./footer.ts";
import {
  type ConfigRecord,
  configStore,
  configPath as defaultConfigPath,
  mutateConfigFile,
} from "./store.ts";
import { booleanValue, overlayKnown, recordValue } from "./values.ts";
import {
  defaultWorkingLine,
  normalizeWorkingLine,
  type WorkingLineComponentConfig,
  type WorkingLineComponentPatch,
} from "./working-line.ts";

export type { IconMode } from "../../shared/icons.ts";
export * from "./context.ts";
export * from "./editor.ts";
export * from "./footer.ts";
export * from "./working-line.ts";
export type ColorSpec = string;
export type SelectorBorderStyle = "zentui";
export type SelectorBordersComponentConfig = {
  enabled: boolean;
  style: SelectorBorderStyle;
};
export type ComponentStyleOwner =
  | "editor"
  | "userMessages"
  | "selectorBorders"
  | "footer";
export type UiFeaturesConfig = {
  editor: boolean;
  statusLine: boolean;
  viewportIndicators: boolean;
};
export type ComponentsConfig = {
  editor: EditorComponentConfig;
  userMessages: UserMessagesComponentConfig;
  workingLine: WorkingLineComponentConfig;
  selectorBorders: SelectorBordersComponentConfig;
  footer: FooterComponentConfig;
};
export type PolishedTuiColors = {
  cwd?: ColorSpec;
  sessionName: ColorSpec;
  gitBranch: ColorSpec;
  gitStatus: ColorSpec;
  contextNormal: ColorSpec;
  contextWarning: ColorSpec;
  contextError: ColorSpec;
  tokens: ColorSpec;
  cost: ColorSpec;
  separator: ColorSpec;
  runtimePrefix: ColorSpec;
  extensionStatus: ColorSpec;
  sessionDuration: ColorSpec;
  packageVersion: ColorSpec;
  gitCommit: ColorSpec;
  gitMetricsAdded: ColorSpec;
  gitMetricsDeleted: ColorSpec;
  username: ColorSpec;
  time: ColorSpec;
  os: ColorSpec;
  editorAccent?: ColorSpec;
  editorBorder?: ColorSpec;
  editorGitBranch?: ColorSpec;
  editorModel?: ColorSpec;
  editorProvider?: ColorSpec;
  editorThinking?: ColorSpec;
  editorThinkingMinimal?: ColorSpec;
  editorThinkingLow?: ColorSpec;
  editorThinkingMedium?: ColorSpec;
  editorThinkingHigh?: ColorSpec;
  editorThinkingXhigh?: ColorSpec;
  editorThinkingMax?: ColorSpec;
  workingLineLow?: ColorSpec;
  workingLineMid?: ColorSpec;
  workingLineHigh?: ColorSpec;
};
export type ZentuiConfig = {
  projectRefreshIntervalMs: number;
  icons: ResolvedIcons;
  colors: PolishedTuiColors;
  components: ComponentsConfig;
};
export type PolishedTuiConfig = ZentuiConfig;
export const configPath = defaultConfigPath;

export const defaultConfig: ZentuiConfig = {
  projectRefreshIntervalMs: 30_000,
  icons: { mode: "auto", ...NERD_DEFAULT_ICONS },
  colors: {
    sessionName: "bold green",
    gitBranch: "bold purple",
    gitStatus: "bold red",
    contextNormal: "bright-black",
    contextWarning: "bold yellow",
    contextError: "bold red",
    tokens: "bright-black",
    cost: "bold green",
    separator: "bright-black",
    runtimePrefix: "",
    extensionStatus: "bright-black",
    sessionDuration: "yellow",
    packageVersion: "208",
    gitCommit: "bold green",
    gitMetricsAdded: "bold green",
    gitMetricsDeleted: "bold red",
    username: "bold yellow",
    time: "bold yellow",
    os: "bold white",
  },
  components: {
    editor: defaultEditor,
    userMessages: normalizeUserMessages(undefined),
    workingLine: defaultWorkingLine,
    selectorBorders: { enabled: true, style: "zentui" },
    footer: defaultFooter,
  },
};

const colorKeys: readonly (keyof PolishedTuiColors)[] = [
  "cwd",
  "sessionName",
  "gitBranch",
  "gitStatus",
  "contextNormal",
  "contextWarning",
  "contextError",
  "tokens",
  "cost",
  "separator",
  "runtimePrefix",
  "extensionStatus",
  "sessionDuration",
  "packageVersion",
  "gitCommit",
  "gitMetricsAdded",
  "gitMetricsDeleted",
  "username",
  "time",
  "os",
  "editorAccent",
  "editorBorder",
  "editorGitBranch",
  "editorModel",
  "editorProvider",
  "editorThinking",
  "editorThinkingMinimal",
  "editorThinkingLow",
  "editorThinkingMedium",
  "editorThinkingHigh",
  "editorThinkingXhigh",
  "editorThinkingMax",
  "workingLineLow",
  "workingLineMid",
  "workingLineHigh",
];
const knownComponentStyleIds: Record<
  ComponentStyleOwner,
  ReadonlySet<string>
> = {
  editor: new Set(["on", "off"]),
  userMessages: new Set([
    "framed",
    "framed-copy-friendly",
    "compact",
    "labeled",
  ]),
  selectorBorders: new Set(["zentui"]),
  footer: new Set(["native", "starship", "hidden"]),
};
const retiredEditorStyleIds = new Set([
  "opencode",
  "opencode-copy-friendly",
  "accent-rail",
]);
const unsupportedComponentStyles = new WeakMap<
  ZentuiConfig,
  ReadonlySet<ComponentStyleOwner>
>();
const styleOwners = Object.keys(
  knownComponentStyleIds,
) as ComponentStyleOwner[];

function unsupportedSelectedStyleId(
  record: ConfigRecord,
  owner: ComponentStyleOwner,
): string | undefined {
  const style = recordValue(recordValue(record.components)[owner]).style;
  return typeof style === "string" &&
    style.trim() &&
    !knownComponentStyleIds[owner].has(style) &&
    !(owner === "editor" && retiredEditorStyleIds.has(style))
    ? style
    : undefined;
}

export function hasUnsupportedComponentStyle(
  config: ZentuiConfig,
  owner: ComponentStyleOwner,
): boolean {
  return unsupportedComponentStyles.get(config)?.has(owner) ?? false;
}

function resolveComponents(value: unknown): ComponentsConfig {
  const source = recordValue(value);
  const selector = recordValue(source.selectorBorders);
  return {
    editor: normalizeEditor(source.editor),
    userMessages: normalizeUserMessages(source.userMessages),
    workingLine: normalizeWorkingLine(source.workingLine),
    selectorBorders: {
      enabled: booleanValue(selector.enabled, true),
      style: "zentui",
    },
    footer: normalizeFooter(source.footer),
  };
}

/** 各配置领域在此组合，运行时仅使用 canonical 结构。 */
export function mergeConfig(parsed: unknown): ZentuiConfig {
  const record = recordValue(parsed);
  const icons = recordValue(record.icons);
  const colors = recordValue(record.colors);
  const interval = record.projectRefreshIntervalMs;
  const config: ZentuiConfig = {
    projectRefreshIntervalMs:
      typeof interval === "number" && Number.isFinite(interval)
        ? Math.round(interval) <= 0
          ? 0
          : Math.max(5_000, Math.round(interval))
        : 30_000,
    icons: resolveConfiguredIcons(
      normalizeIconMode(icons.mode),
      Object.fromEntries(
        ICON_GLYPH_KEYS.filter((key) => typeof icons[key] === "string").map(
          (key) => [key, icons[key]],
        ),
      ) as Partial<IconGlyphs>,
    ),
    colors: {
      ...defaultConfig.colors,
      ...Object.fromEntries(
        colorKeys
          .filter(
            (key) =>
              typeof colors[key] === "string" &&
              isSupportedColorSpec(colors[key]),
          )
          .map((key) => [key, colors[key]]),
      ),
    },
    components: resolveComponents(record.components),
  };
  const unsupported = new Set(
    styleOwners.filter(
      (owner) => unsupportedSelectedStyleId(record, owner) !== undefined,
    ),
  );
  if (unsupported.size > 0) {
    unsupportedComponentStyles.set(config, unsupported);
  }
  return config;
}

export function loadConfig(): ZentuiConfig {
  return mergeConfig(configStore.read());
}

export function getExtensionStatusPlacement(
  config: ZentuiConfig,
  key: string,
): ExtensionStatusPlacement {
  const statuses = config.components.footer.styles.starship.extensionStatuses;
  if (
    Object.hasOwn(statuses.placements, key) &&
    isExtensionStatusPlacement(statuses.placements[key])
  ) {
    return statuses.placements[key];
  }
  return isExtensionStatusPlacement(statuses.defaultPlacement)
    ? statuses.defaultPlacement
    : "right";
}

export function getExtensionStatusColorMode(
  config: ZentuiConfig,
  key: string,
): ExtensionStatusColorMode {
  const modes =
    config.components.footer.styles.starship.extensionStatuses.colorModes;
  return Object.hasOwn(modes, key) && isExtensionStatusColorMode(modes[key])
    ? modes[key]
    : "zentui";
}

/** 纯配置修改可在一次 ConfigStore.update 中组合成 Preset。 */
export function mutateComponentsRecord(
  record: ConfigRecord,
  update: (components: ComponentsConfig) => void,
  replacedStyles: readonly ComponentStyleOwner[] = [],
): void {
  const preserved = styleOwners.map(
    (owner) => [owner, unsupportedSelectedStyleId(record, owner)] as const,
  );
  const components = resolveComponents(record.components);
  update(components);
  record.version = 1;
  const merged = recordValue(
    overlayKnown(record.components, resolveComponents(components)),
  );
  for (const [owner, style] of preserved) {
    if (style !== undefined && !replacedStyles.includes(owner)) {
      recordValue(merged[owner]).style = style;
    }
  }
  record.components = merged;
}

function mutateConfig(
  path: string,
  update: (record: ConfigRecord) => void,
): ZentuiConfig {
  const mutate = (record: ConfigRecord) => {
    record.version = 1;
    update(record);
  };
  return mergeConfig(
    path === configPath
      ? configStore.update(mutate)
      : mutateConfigFile(path, mutate),
  );
}

function saveComponentsMutation(
  update: (components: ComponentsConfig) => void,
  path: string,
  replacedStyle?: ComponentStyleOwner,
): ZentuiConfig {
  return mutateConfig(path, (record) =>
    mutateComponentsRecord(
      record,
      update,
      replacedStyle ? [replacedStyle] : [],
    ),
  );
}

export function saveEditorComponentPatch(
  patch: Partial<
    Pick<
      EditorComponentConfig,
      "style" | "borderColorMode" | "modelLabel" | "viewportIndicators"
    >
  >,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation(
    (components) => {
      components.editor = overlayKnown(
        components.editor,
        patch,
      ) as EditorComponentConfig;
    },
    path,
    patch.style !== undefined ? "editor" : undefined,
  );
}
export function saveMinimalistEditorStylePatch(
  patch: Partial<MinimalistEditorStyleConfig>,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    components.editor.styles.minimalist = overlayKnown(
      components.editor.styles.minimalist,
      patch,
    ) as MinimalistEditorStyleConfig;
  }, path);
}
export function saveUserMessagesComponentPatch(
  patch: Partial<Pick<UserMessagesComponentConfig, "enabled" | "style">>,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation(
    (components) => {
      components.userMessages = overlayKnown(
        components.userMessages,
        patch,
      ) as UserMessagesComponentConfig;
    },
    path,
    patch.style !== undefined ? "userMessages" : undefined,
  );
}
export function saveWorkingLineComponentPatch(
  patch: WorkingLineComponentPatch,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    components.workingLine = overlayKnown(
      components.workingLine,
      patch,
    ) as WorkingLineComponentConfig;
  }, path);
}
export function saveSelectorBordersComponentPatch(
  patch: Partial<SelectorBordersComponentConfig>,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation(
    (components) => {
      components.selectorBorders = overlayKnown(
        components.selectorBorders,
        patch,
      ) as SelectorBordersComponentConfig;
    },
    path,
    patch.style !== undefined ? "selectorBorders" : undefined,
  );
}
export function saveFooterComponentPatch(
  patch: Partial<Pick<FooterComponentConfig, "style" | "modelLabel">>,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation(
    (components) => {
      components.footer = overlayKnown(
        components.footer,
        patch,
      ) as FooterComponentConfig;
    },
    path,
    patch.style !== undefined ? "footer" : undefined,
  );
}
export type StarshipFooterStylePatch = Partial<
  Omit<
    StarshipFooterStyleConfig,
    | "contextThresholds"
    | "pathDisplay"
    | "segments"
    | "gitBranch"
    | "gitCommit"
    | "gitMetrics"
  >
> & {
  contextThresholds?: Partial<ContextThresholds>;
  pathDisplay?: Partial<PathDisplayConfig>;
  segments?: Partial<FooterSegmentsConfig>;
  gitBranch?: Partial<GitBranchConfig>;
  gitCommit?: Partial<GitCommitConfig>;
  gitMetrics?: Partial<GitMetricsConfig>;
};

export function saveStarshipFooterStylePatch(
  patch: StarshipFooterStylePatch,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    components.footer.styles.starship = overlayKnown(
      components.footer.styles.starship,
      patch,
    ) as StarshipFooterStyleConfig;
  }, path);
}
export function saveUiFeaturesPatch(
  patch: Partial<UiFeaturesConfig>,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation(
    (components) => {
      if (typeof patch.editor === "boolean") {
        components.editor.style = patch.editor ? "on" : "off";
        components.userMessages.enabled = patch.editor;
        components.selectorBorders.enabled = patch.editor;
      }
      if (typeof patch.statusLine === "boolean") {
        components.footer.style = patch.statusLine ? "starship" : "native";
      }
      if (typeof patch.viewportIndicators === "boolean") {
        components.editor.viewportIndicators = patch.viewportIndicators;
      }
    },
    path,
    typeof patch.statusLine === "boolean" ? "footer" : undefined,
  );
}
export function saveFooterSegmentsPatch(
  patch: Partial<FooterSegmentsConfig>,
  path = configPath,
): ZentuiConfig {
  const segments = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) =>
        Object.hasOwn(defaultFooterSegments, key) && typeof value === "boolean",
    ),
  ) as FooterSegmentsConfig;
  return saveStarshipFooterStylePatch({ segments }, path);
}
export function saveFooterFormatPatch(
  value: string,
  path = configPath,
): ZentuiConfig {
  return saveStarshipFooterStylePatch(
    { format: typeof value === "string" ? value : "" },
    path,
  );
}
export function saveResponsiveFooterPatch(
  patch: {
    responsiveFooter?: boolean;
    compactFooterFormat?: string;
    compactFooterMaxLines?: CompactFooterMaxLines;
  },
  path = configPath,
): ZentuiConfig {
  const canonical: Partial<StarshipFooterStyleConfig> = {};
  if (typeof patch.responsiveFooter === "boolean") {
    canonical.responsive = patch.responsiveFooter;
  }
  if (typeof patch.compactFooterFormat === "string") {
    canonical.compactFormat = patch.compactFooterFormat;
  }
  if (patch.compactFooterMaxLines !== undefined) {
    canonical.compactMaxLines = parseCompactFooterMaxLines(
      patch.compactFooterMaxLines,
    );
  }
  return saveStarshipFooterStylePatch(canonical, path);
}
export function saveIconsModePatch(
  mode: IconMode,
  path = configPath,
): ZentuiConfig {
  return mutateConfig(path, (record) => {
    record.icons = {
      ...recordValue(record.icons),
      mode: normalizeIconMode(mode),
    };
  });
}
export function saveContextStylePatch(
  style: ContextStyle,
  path = configPath,
): ZentuiConfig {
  return saveStarshipFooterStylePatch(
    { contextStyle: parseContextStyle(style) },
    path,
  );
}
export function saveSeparatorPatch(
  separator: SeparatorStyle,
  path = configPath,
): ZentuiConfig {
  return saveStarshipFooterStylePatch(
    { separator: parseSeparatorStyle(separator) },
    path,
  );
}
export function saveContextThresholdsPatch(
  patch: Partial<ContextThresholds>,
  path = configPath,
): ZentuiConfig {
  if (typeof patch.warning === "bigint" || typeof patch.error === "bigint") {
    throw new TypeError("Context thresholds must be JSON-serializable numbers");
  }
  return saveStarshipFooterStylePatch({ contextThresholds: patch }, path);
}
export function savePathDisplayPatch(
  patch: Partial<PathDisplayConfig>,
  path = configPath,
): ZentuiConfig {
  return saveStarshipFooterStylePatch({ pathDisplay: patch }, path);
}
export function saveGitBranchPatch(
  patch: Partial<GitBranchConfig>,
  path = configPath,
): ZentuiConfig {
  return saveStarshipFooterStylePatch({ gitBranch: patch }, path);
}
export function saveEditorModelLabel(
  value: ModelLabelSource,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    components.editor.modelLabel = parseEditorModelLabel(value);
    components.footer.modelLabel = parseEditorModelLabel(value);
  }, path);
}
export function saveEditorStyle(
  value: EditorStyle,
  path = configPath,
): ZentuiConfig {
  return saveEditorComponentPatch({ style: parseEditorStyle(value) }, path);
}
export function saveMinimalistPatch(
  patch: Partial<MinimalistConfig>,
  path = configPath,
): ZentuiConfig {
  return saveMinimalistEditorStylePatch(patch, path);
}
export function saveEditorBorderColorMode(
  value: EditorBorderColorMode,
  path = configPath,
): ZentuiConfig {
  return saveEditorComponentPatch(
    { borderColorMode: parseEditorBorderColorMode(value) },
    path,
  );
}
export function saveGitCommitPatch(
  patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
  path = configPath,
): ZentuiConfig {
  const valid = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) =>
        (key === "onlyDetached" || key === "showTag") &&
        typeof value === "boolean",
    ),
  );
  return saveStarshipFooterStylePatch({ gitCommit: valid }, path);
}
export function saveGitMetricsPatch(
  patch: Partial<GitMetricsConfig>,
  path = configPath,
): ZentuiConfig {
  const valid = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) =>
        (key === "onlyNonzero" || key === "ignoreSubmodules") &&
        typeof value === "boolean",
    ),
  );
  return saveStarshipFooterStylePatch({ gitMetrics: valid }, path);
}
export function saveExtensionStatusDefaultPlacement(
  placement: ExtensionStatusPlacement,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    components.footer.styles.starship.extensionStatuses.defaultPlacement =
      isExtensionStatusPlacement(placement) ? placement : "right";
  }, path);
}
export function saveExtensionStatusPlacement(
  key: string,
  placement: ExtensionStatusPlacement,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    Object.defineProperty(
      components.footer.styles.starship.extensionStatuses.placements,
      key,
      {
        value: placement,
        enumerable: true,
        configurable: true,
        writable: true,
      },
    );
  }, path);
}
export function saveExtensionStatusColorMode(
  key: string,
  colorMode: ExtensionStatusColorMode,
  path = configPath,
): ZentuiConfig {
  return saveComponentsMutation((components) => {
    Object.defineProperty(
      components.footer.styles.starship.extensionStatuses.colorModes,
      key,
      {
        value: colorMode,
        enumerable: true,
        configurable: true,
        writable: true,
      },
    );
  }, path);
}
