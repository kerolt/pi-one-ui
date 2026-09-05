import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACT_FOOTER_FORMAT,
  DEFAULT_EDITOR_METADATA_FORMAT,
  defaultConfig,
  ensureConfigExists,
  FOOTER_FORMAT_VARIABLES,
  getExtensionStatusColorMode,
  getExtensionStatusPlacement,
  hasUnsupportedComponentStyle,
  mergeConfig,
  saveColorSourcesPatch,
  saveContextStylePatch,
  saveContextThresholdsPatch,
  saveEditorBorderColorMode,
  saveEditorComponentPatch,
  saveEditorModelLabel,
  saveEditorStyle,
  saveExtensionStatusColorMode,
  saveExtensionStatusDefaultPlacement,
  saveExtensionStatusPlacement,
  saveFooterComponentPatch,
  saveFooterFormatPatch,
  saveFooterSegmentsPatch,
  saveGitBranchPatch,
  saveGitCommitPatch,
  saveGitMetricsPatch,
  saveMinimalistEditorStylePatch,
  saveMinimalistPatch,
  savePathDisplayPatch,
  savePolishedEditorStylePatch,
  saveResponsiveFooterPatch,
  saveSelectorBordersComponentPatch,
  saveSeparatorPatch,
  saveStarshipFooterStylePatch,
  saveUiFeaturesPatch,
  saveUserMessagesComponentPatch,
  saveWorkingLineComponentPatch,
} from "../../extensions/app/config/shell";
import {
  colorize,
  renderChromeBorder,
  renderStyle,
  renderStyleForSource,
  renderTerminalStyle,
} from "../../extensions/shared/style";

function configTempFiles(dir: string, filename = "pi-one-ui.json"): string[] {
  return readdirSync(dir).filter(
    (name) => name.startsWith(`.${filename}.`) && name.endsWith(".tmp"),
  );
}

function withConfig(
  initial: Record<string, unknown> | undefined,
  assertions: (path: string, dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
  const path = join(dir, "pi-one-ui.json");
  try {
    if (initial !== undefined)
      writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`);
    assertions(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Tests intentionally inspect arbitrary JSON fixture shapes.
function readRaw(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("canonical config resolution", () => {
  it("provides complete canonical defaults and the established palette defaults", () => {
    const config = mergeConfig({});
    expect(config.components).toEqual({
      editor: {
        style: "on",
        colorSource: "theme",
        borderColorMode: "static",
        modelLabel: "id",
        viewportIndicators: true,
        styles: {
          minimalist: {
            pathDisplay: "compact",
            showSessionName: true,
            showTimer: true,
            showCost: true,
            showGit: true,
          },
        },
      },
      userMessages: {
        enabled: true,
        style: "framed",
        colorSource: "theme",
        styles: {
          framed: {},
          "framed-copy-friendly": {},
          compact: {},
          labeled: {},
        },
      },
      workingLine: {
        enabled: false,
        turnSummary: true,
        spinner: "star-bloom",
        spinnerIntervalMs: 100,
        animateSpinnerColor: false,
        textIntervalMs: 60,
        textAnimation: "classic",
        colorSource: "theme",
        messages: {
          custom: true,
          values: [...defaultConfig.components.workingLine.messages.values],
        },
        segments: { tool: true, elapsed: true, thought: true, tokens: true },
      },
      selectorBorders: { enabled: true, style: "zentui", colorSource: "theme" },
      footer: {
        style: "starship",
        colorSource: "theme",
        modelLabel: "id",
        styles: {
          starship: {
            format: "",
            responsive: true,
            compactFormat: DEFAULT_COMPACT_FOOTER_FORMAT,
            compactMaxLines: 2,
            separator: "pipe",
            contextStyle: "text",
            contextThresholds: { warning: 70, error: 90 },
            pathDisplay: { mode: "basename", depth: 0 },
            segments: defaultConfig.footerSegments,
            gitBranch: { maxLength: "full" },
            gitCommit: { hashLength: 7, onlyDetached: true, showTag: true },
            gitMetrics: { onlyNonzero: true, ignoreSubmodules: false },
            extensionStatuses: {
              defaultPlacement: "right",
              placements: {},
              colorModes: {},
            },
          },
        },
      },
    });
    expect(config.projectRefreshIntervalMs).toBe(30_000);
    expect(config.icons.cacheHit).toBe("󰆼");
    expect(config.colors).toEqual(defaultConfig.colors);
    expect(defaultConfig.components).toEqual(config.components);
  });

  it("ignores stale fixed-editor config forms without exposing runtime fields", () => {
    const config = mergeConfig({
      fixedEditor: { enabled: true, mouseScroll: false },
      layout: {
        fixedEditor: { enabled: "yes", copyNotice: false },
        futureLayout: true,
      },
    });
    expect(config).not.toHaveProperty("fixedEditor");
    expect(config).not.toHaveProperty("layout");
  });

  it("normalizes every canonical minimalist leaf without reviving branch-only inputs", () => {
    for (const pathDisplay of ["compact", "project", "full"]) {
      expect(
        mergeConfig({
          components: { editor: { styles: { minimalist: { pathDisplay } } } },
        }).components.editor.styles.minimalist.pathDisplay,
      ).toBe(pathDisplay);
    }
    for (const pathDisplay of ["basename", "", 1, null, true]) {
      expect(
        mergeConfig({
          editorStyles: { minimalist: { pathDisplay: "full" } },
          components: { editor: { styles: { minimalist: { pathDisplay } } } },
        }).components.editor.styles.minimalist.pathDisplay,
      ).toBe("compact");
    }

    const valid = mergeConfig({
      components: {
        editor: {
          styles: {
            minimalist: {
              showSessionName: false,
              showTimer: false,
              showCost: false,
              showGit: false,
            },
          },
        },
      },
    }).components.editor.styles.minimalist;
    expect(valid).toMatchObject({
      showSessionName: false,
      showTimer: false,
      showCost: false,
      showGit: false,
    });

    const invalid = mergeConfig({
      editorStyles: {
        minimalist: {
          showSessionName: false,
          showTimer: false,
          showCost: false,
          showGit: false,
        },
      },
      components: {
        editor: {
          styles: {
            minimalist: {
              showSessionName: "yes",
              showTimer: null,
              showCost: 0,
              showGit: "no",
            },
          },
        },
      },
    }).components.editor.styles.minimalist;
    expect(invalid).toEqual(defaultConfig.components.editor.styles.minimalist);
  });

  it("ignores removed Minimalist context-usage settings", () => {
    const minimalist = mergeConfig({
      components: {
        editor: {
          styles: {
            minimalist: {
              contextFormat: "percent-total",
              contextGauge: true,
              contextThresholds: { warning: 40, error: 60 },
            },
          },
        },
      },
    }).components.editor.styles.minimalist;

    expect(minimalist).toEqual(
      defaultConfig.components.editor.styles.minimalist,
    );
    expect(minimalist).not.toHaveProperty("contextFormat");
    expect(minimalist).not.toHaveProperty("contextGauge");
    expect(minimalist).not.toHaveProperty("contextThresholds");
  });

  it("ignores branch-only editor settings and safely defaults closed style IDs", () => {
    const config = mergeConfig({
      editorStyle: "minimalist",
      editorStyles: { minimalist: { showGit: false } },
      components: {
        editor: { style: "future" },
        userMessages: { style: "future" },
        selectorBorders: { style: "future" },
        footer: { style: "future" },
      },
    });
    expect(config.components.editor.style).toBe("on");
    expect(config.components.editor.styles.minimalist.showGit).toBe(true);
    expect(config.components.userMessages.style).toBe("framed");
    expect(config.components.selectorBorders.style).toBe("zentui");
    expect(config.components.footer.style).toBe("starship");

    for (const retired of [
      "opencode",
      "opencode-copy-friendly",
      "accent-rail",
    ]) {
      const migrated = mergeConfig({
        components: { editor: { style: retired } },
      });
      expect(migrated.components.editor.style).toBe("on");
      expect(hasUnsupportedComponentStyle(migrated, "editor")).toBe(false);
    }
  });

  it("does not treat native as a User-message style", () => {
    expect(
      mergeConfig({ components: { userMessages: { style: "native" } } })
        .components.userMessages.style,
    ).toBe("framed");
  });

  it("projects the derived flat runtime view from canonical sources", () => {
    const config = mergeConfig({
      components: {
        editor: {
          enabled: false,
          style: "minimalist",
          colorSource: "terminal",
          modelLabel: "name",
          styles: {
            opencode: { copyFriendly: true, metadataFormat: "$model" },
          },
        },
        userMessages: {
          enabled: true,
          colorSource: "theme",
          styles: { framed: { copyFriendly: false } },
        },
        selectorBorders: { enabled: true, colorSource: "theme" },
        footer: {
          modelLabel: "id",
          colorSource: "terminal",
          styles: {
            starship: { contextThresholds: { warning: 40, error: 60 } },
          },
        },
      },
    });
    const starship = config.components.footer.styles.starship;
    expect(config.footerFormat).toBe(starship.format);
    expect(config.responsiveFooter).toBe(starship.responsive);
    expect(config.compactFooterFormat).toBe(starship.compactFormat);
    expect(config.compactFooterMaxLines).toBe(starship.compactMaxLines);
    expect(config.separator).toBe(starship.separator);
    expect(config.contextStyle).toBe(starship.contextStyle);
    expect(config.contextThresholds).toBe(starship.contextThresholds);
    expect(config.pathDisplay).toBe(starship.pathDisplay);
    expect(config.footerSegments).toBe(starship.segments);
    expect(config.gitBranch).toBe(starship.gitBranch);
    expect(config.gitCommit).toBe(starship.gitCommit);
    expect(config.gitMetrics).toBe(starship.gitMetrics);
    expect(config.extensionStatuses).toBe(starship.extensionStatuses);
    expect(config.features).toEqual({
      editor: false,
      statusLine: true,
      viewportIndicators: true,
    });
    expect(config.colorSources).toEqual({
      starship: "terminal",
      editor: "terminal",
      userMessages: "theme",
    });
    expect(config.editorModelLabel).toBe("name");
    expect(config.contextThresholds).toEqual({ warning: 40, error: 60 });
  });

  it("does not mutate the parsed record", () => {
    const parsed = {
      features: { editor: false },
      components: { editor: { styles: { opencode: { copyFriendly: true } } } },
    };
    const before = structuredClone(parsed);
    mergeConfig(parsed);
    expect(parsed).toEqual(before);
  });

  it("retains root parsing behavior for intervals, icons, colors, and telemetry variables", () => {
    const config = mergeConfig({
      projectRefreshIntervalMs: 100,
      icons: { mode: "ascii", cwd: "DIR" },
      colors: { gitBranch: "syntaxKeyword", editorAccent: "accent" },
    });
    expect(config.projectRefreshIntervalMs).toBe(5_000);
    expect(config.icons.cwd).toBe("DIR");
    expect(config.colors.gitBranch).toBe("syntaxKeyword");
    expect(config.colors.editorAccent).toBe("accent");
    expect(FOOTER_FORMAT_VARIABLES).toEqual(
      expect.arrayContaining([
        "cache_read",
        "cache_write",
        "subscription",
        "auto_compaction",
      ]),
    );
  });
});

describe("working-line config", () => {
  it("defaults to cloned custom message presets", () => {
    const first = mergeConfig({}).components.workingLine.messages;
    const second = mergeConfig({}).components.workingLine.messages;
    expect(first).toEqual({
      custom: true,
      values: defaultConfig.components.workingLine.messages.values,
    });
    expect(first.values).not.toBe(second.values);
    expect(first.values).not.toBe(
      defaultConfig.components.workingLine.messages.values,
    );
  });

  it("gives canonical custom presence precedence and preserves explicit empty values", () => {
    expect(
      mergeConfig({
        components: {
          workingLine: {
            messages: { custom: false, values: [] },
          },
        },
      }).components.workingLine.messages,
    ).toEqual({ custom: false, values: [] });
    expect(
      mergeConfig({
        components: {
          workingLine: { messages: { custom: "bad" } },
        },
      }).components.workingLine.messages,
    ).toEqual({
      custom: true,
      values: defaultConfig.components.workingLine.messages.values,
    });
    expect(
      mergeConfig({ components: { workingLine: { messages: { values: [] } } } })
        .components.workingLine.messages,
    ).toEqual({ custom: true, values: [] });
  });

  it.each([
    [30, 30],
    [1000, 1000],
    [29, 60],
    [1001, 60],
    [60.5, 60],
    ["60", 60],
  ] as const)(
    "normalizes canonical text speed %s to %s ms",
    (textIntervalMs, expected) => {
      expect(
        mergeConfig({ components: { workingLine: { textIntervalMs } } })
          .components.workingLine.textIntervalMs,
      ).toBe(expected);
    },
  );

  it("defaults malformed or missing Turn summary to true and preserves explicit false", () => {
    expect(mergeConfig({}).components.workingLine.turnSummary).toBe(true);
    expect(
      mergeConfig({ components: { workingLine: { turnSummary: "bad" } } })
        .components.workingLine.turnSummary,
    ).toBe(true);
    expect(
      mergeConfig({ components: { workingLine: { turnSummary: false } } })
        .components.workingLine.turnSummary,
    ).toBe(false);
  });

  it("saves Turn summary while preserving unknown config", () => {
    withConfig(
      {
        components: { workingLine: { unknown: { keep: true } } },
        topLevel: "keep",
      },
      (path) => {
        const config = saveWorkingLineComponentPatch(
          { turnSummary: false },
          path,
        );
        const raw = JSON.parse(readFileSync(path, "utf8"));
        expect(config.components.workingLine.turnSummary).toBe(false);
        expect(raw.components.workingLine.turnSummary).toBe(false);
        expect(raw.components.workingLine.unknown).toEqual({ keep: true });
        expect(raw.topLevel).toBe("keep");
      },
    );
  });

  it("parses Pulse without changing established Working-line defaults", () => {
    expect(mergeConfig({}).components.workingLine.spinner).toBe("star-bloom");
    expect(
      mergeConfig({
        components: {
          workingLine: { spinner: "pulse", spinnerIntervalMs: 180 },
        },
      }).components.workingLine,
    ).toMatchObject({
      spinner: "pulse",
      spinnerIntervalMs: 180,
      textIntervalMs: 60,
    });
  });

  it("normalizes each independent field, messages, and palette override", () => {
    const config = mergeConfig({
      components: {
        workingLine: {
          enabled: true,
          spinner: "pinwheel",
          spinnerIntervalMs: 160,
          animateSpinnerColor: true,
          textIntervalMs: 40,
          textAnimation: "kitt",
          colorSource: "terminal",
          messages: {
            custom: true,
            values: [" One ", "One", "\x1b[31mTwo\x1b[0m", "\n"],
          },
          segments: {
            tool: false,
            elapsed: true,
            thought: true,
            tokens: false,
          },
        },
      },
      colors: {
        workingLineLow: "fg:240",
        workingLineMid: "cyan",
        workingLineHigh: "bold cyan",
        editorAccent: "red",
      },
    });
    expect(config.components.workingLine).toEqual({
      enabled: true,
      turnSummary: true,
      spinner: "pinwheel",
      spinnerIntervalMs: 160,
      animateSpinnerColor: true,
      textIntervalMs: 40,
      textAnimation: "kitt",
      colorSource: "terminal",
      messages: { custom: true, values: ["One", "Two"] },
      segments: { tool: false, elapsed: true, thought: true, tokens: false },
    });
    expect(config.colors).toMatchObject({
      workingLineLow: "fg:240",
      workingLineMid: "cyan",
      workingLineHigh: "bold cyan",
      editorAccent: "red",
    });
  });

  it("falls back malformed leaves independently and enforces message caps", () => {
    const values = Array.from(
      { length: 40 },
      (_, index) => `${index}:${"界".repeat(30)}`,
    );
    const component = mergeConfig({
      components: {
        workingLine: {
          enabled: "yes",
          spinner: "future",
          spinnerIntervalMs: 29,
          animateSpinnerColor: "yes",
          textAnimation: "pulse",
          colorSource: "editor",
          messages: { custom: "bad", values },
        },
      },
      colors: { workingLineLow: "not-a-color" },
    }).components.workingLine;
    expect(component).toMatchObject({
      enabled: false,
      spinner: "star-bloom",
      spinnerIntervalMs: 100,
      animateSpinnerColor: false,
      textIntervalMs: 60,
      textAnimation: "classic",
      colorSource: "theme",
      messages: { custom: true },
      segments: { tool: true, elapsed: true, thought: true, tokens: true },
    });
    expect(component.messages.values).toHaveLength(40);
    expect(component.messages.values.every((value) => value.length > 0)).toBe(
      true,
    );
    expect(
      component.messages.values.every((value) => visibleWidth(value) <= 43),
    ).toBe(true);
  });

  it("saves nested patches, copies arrays, and preserves unknown fields", () => {
    withConfig(
      {
        unknownTop: true,
        components: {
          workingLine: {
            future: { keep: true },
            spinnerIntervalMs: 180,
            messages: { custom: true, futureMessages: true, values: ["Old"] },
          },
        },
      },
      (path) => {
        const values = [" New ", "New", "Other"];
        const saved = saveWorkingLineComponentPatch(
          {
            spinner: "braille",
            spinnerIntervalMs: 60,
            animateSpinnerColor: true,
            messages: { custom: true, values },
            segments: { elapsed: false },
          },
          path,
        );
        values[0] = "mutated";
        const raw = readRaw(path);
        expect(saved.components.workingLine).toMatchObject({
          spinner: "braille",
          spinnerIntervalMs: 60,
          animateSpinnerColor: true,
          textIntervalMs: 60,
          messages: { custom: true, values: ["New", "Other"] },
          segments: { tool: true, elapsed: false, thought: true, tokens: true },
        });
        expect(raw.unknownTop).toBe(true);
        expect(raw.components.workingLine.future).toEqual({ keep: true });
        expect(raw.components.workingLine.messages.futureMessages).toBe(true);
        expect(raw.components.workingLine.messages.values).toEqual([
          "New",
          "Other",
        ]);
        expect(raw.components.workingLine.messages.custom).toBe(true);
      },
    );
  });
});

describe("canonical snapshot persistence", () => {
  it("supports every typed component saver without discarding inactive styles", () => {
    withConfig(undefined, (path) => {
      saveMinimalistEditorStylePatch({ showGit: false }, path);
      saveUserMessagesComponentPatch(
        { enabled: false, colorSource: "terminal" },
        path,
      );
      saveSelectorBordersComponentPatch(
        { enabled: false, colorSource: "terminal" },
        path,
      );
      saveFooterComponentPatch({ style: "native", modelLabel: "name" }, path);
      saveStarshipFooterStylePatch(
        { separator: "chevron", pathDisplay: { mode: "full", depth: 2 } },
        path,
      );
      const config = mergeConfig(readRaw(path));
      expect(config.components.editor.styles.minimalist).toMatchObject({
        showGit: false,
      });
      expect(config.components.userMessages).toMatchObject({
        enabled: false,
        colorSource: "terminal",
      });
      expect(config.components.selectorBorders).toMatchObject({
        enabled: false,
        colorSource: "terminal",
      });
      expect(config.components.footer).toMatchObject({
        style: "native",
        modelLabel: "name",
      });
      expect(config.components.footer.styles.starship).toMatchObject({
        separator: "chevron",
        pathDisplay: { mode: "full", depth: 2 },
      });
    });
  });

  it("preserves stale fixed-editor keys during an unrelated explicit save", () => {
    const stale = {
      fixedEditor: { enabled: true, oldUnknown: true },
      layout: { fixedEditor: { mouseScroll: false }, futureLayout: true },
    };
    withConfig(stale, (path) => {
      saveFooterComponentPatch({ style: "hidden" }, path);
      const raw = readRaw(path);
      expect(raw.fixedEditor).toEqual(stale.fixedEditor);
      expect(raw.layout).toEqual(stale.layout);
      expect(raw.components.footer.style).toBe("hidden");
    });
  });
});

describe("canonical saver adapters", () => {
  it("materializes a complete snapshot when a canonical saver creates the file", () => {
    withConfig(undefined, (path) => {
      saveUiFeaturesPatch({ editor: false }, path);
      const raw = readRaw(path);
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(Object.keys(raw.components).sort()).toEqual([
        "editor",
        "footer",
        "selectorBorders",
        "userMessages",
        "workingLine",
      ]);
      expect(raw.components.editor.style).toBe("off");
      expect(raw.components.userMessages.enabled).toBe(false);
      expect(raw.components.selectorBorders.enabled).toBe(false);
      expect(raw).not.toHaveProperty("features");
    });
  });
});

describe("mergeConfig", () => {
  it("defaults project refresh polling to 30 seconds and Starship styles", () => {
    const config = mergeConfig({});
    expect(config.projectRefreshIntervalMs).toBe(30_000);
    expect(config.icons.cacheHit).toBe("󰆼");
    expect(config.colors.gitBranch).toBe("bold purple");
    expect(config.colors.packageVersion).toBe("208");
    expect(config.colors.gitCommit).toBe("bold green");
    expect(config.colors.gitMetricsAdded).toBe("bold green");
    expect(config.colors.gitMetricsDeleted).toBe("bold red");
    expect(config.colors.sessionName).toBe("bold green");
    expect(config.colors.contextNormal).toBe("bright-black");
    expect(config.colors.tokens).toBe("bright-black");
    expect(config.colors.extensionStatus).toBe("bright-black");
    expect(config.colors.editorAccent).toBeUndefined();
    expect(config.colors.editorBorder).toBeUndefined();
    expect(config.colorSources).toEqual({
      starship: "theme",
      editor: "theme",
      userMessages: "theme",
    });
    expect(config.features).toEqual({
      editor: true,
      statusLine: true,
      viewportIndicators: true,
    });
    expect(config.footerSegments).toEqual({
      cwd: true,
      sessionName: true,
      gitBranch: true,
      gitStatus: true,
      runtime: true,
      modelInfo: false,
      context: true,
      gitCounts: false,
      sessionDuration: false,
      username: false,
      time: false,
      os: false,
      packageVersion: false,
      gitCommit: false,
      gitMetrics: false,
      tokens: true,
      cost: true,
    });
    expect(config.extensionStatuses).toEqual({
      defaultPlacement: "right",
      placements: {},
      colorModes: {},
    });
  });

  it("registers the canonical telemetry variables without aliases", () => {
    expect(FOOTER_FORMAT_VARIABLES).toEqual(
      expect.arrayContaining([
        "cache_read",
        "cache_write",
        "subscription",
        "auto_compaction",
      ]),
    );
    expect(FOOTER_FORMAT_VARIABLES).not.toContain("experimental");
  });

  it("defaults footerFormat to empty string", () => {
    expect(mergeConfig({}).footerFormat).toBe("");
    expect(defaultConfig.footerFormat).toBe("");
  });

  it("persists responsive footer patches without replacing unrelated keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-responsive-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({
          unknown: { keep: true },
          components: {
            footer: { styles: { starship: { format: "$cwd" } } },
          },
        }),
      );
      const config = saveResponsiveFooterPatch(
        { responsiveFooter: false, compactFooterMaxLines: 3 },
        path,
      );
      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(raw.unknown).toEqual({ keep: true });
      expect(raw.components.footer.styles.starship).toMatchObject({
        format: "$cwd",
        responsive: false,
        compactMaxLines: 3,
      });
      expect(config.responsiveFooter).toBe(false);
      expect(config.compactFooterMaxLines).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts custom project refresh intervals and 0 to disable polling", () => {
    expect(
      mergeConfig({ projectRefreshIntervalMs: 60_000 })
        .projectRefreshIntervalMs,
    ).toBe(60_000);
    expect(
      mergeConfig({ projectRefreshIntervalMs: 0 }).projectRefreshIntervalMs,
    ).toBe(0);
  });

  it("clamps short project refresh intervals up to 5 seconds", () => {
    expect(
      mergeConfig({ projectRefreshIntervalMs: 100 }).projectRefreshIntervalMs,
    ).toBe(5_000);
    expect(
      mergeConfig({ projectRefreshIntervalMs: 4_999 }).projectRefreshIntervalMs,
    ).toBe(5_000);
    expect(
      mergeConfig({ projectRefreshIntervalMs: 5_000 }).projectRefreshIntervalMs,
    ).toBe(5_000);
  });

  it("ignores invalid project refresh intervals", () => {
    expect(
      mergeConfig({ projectRefreshIntervalMs: "30000" })
        .projectRefreshIntervalMs,
    ).toBe(30_000);
    expect(
      mergeConfig({ projectRefreshIntervalMs: Number.POSITIVE_INFINITY })
        .projectRefreshIntervalMs,
    ).toBe(30_000);
  });

  it("falls back to pipe for invalid separator styles", () => {
    for (const separator of ["arrow", "", 123, null, true]) {
      expect(mergeConfig({ separator }).separator).toBe("pipe");
    }
  });

  it("saves separator style without erasing unknown config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            components: {
              footer: { styles: { starship: { contextStyle: "gauge" } } },
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveSeparatorPatch("chevron", path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.separator).toBe("chevron");
      expect(raw.unknown).toBe(true);
      expect(raw.components.footer.styles.starship).toMatchObject({
        contextStyle: "gauge",
        separator: "chevron",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves minimalist patches while preserving unknown nested config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({
          unknownTop: true,
          editorStyles: {
            unknownStyle: { keep: true },
            minimalist: { unknownNested: "keep", showGit: true },
          },
        }),
      );
      const config = saveMinimalistPatch(
        {
          pathDisplay: "full",
          showSessionName: false,
          showGit: false,
        },
        path,
      );
      expect(config.editorStyles.minimalist.pathDisplay).toBe("full");
      expect(config.editorStyles.minimalist.showSessionName).toBe(false);
      expect(config.editorStyles.minimalist.showGit).toBe(false);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(raw).toMatchObject({
        unknownTop: true,
        editorStyles: {
          unknownStyle: { keep: true },
          minimalist: { unknownNested: "keep", showGit: true },
        },
      });
      expect(raw.components.editor.styles.minimalist).toMatchObject({
        pathDisplay: "full",
        showSessionName: false,
        showGit: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves editor style without erasing sibling config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({ unknown: { keep: true }, editorModelLabel: "name" }),
      );
      const on = saveEditorStyle("on", path);
      let raw = JSON.parse(readFileSync(path, "utf8"));
      expect(raw.unknown).toEqual({ keep: true });
      expect(raw.editorModelLabel).toBe("name");
      expect(raw.editorStyle).toBeUndefined();
      expect(raw.components.editor.style).toBe("on");
      expect(on.editorStyle).toBe("on");

      const off = saveEditorStyle("off", path);
      raw = JSON.parse(readFileSync(path, "utf8"));
      expect(off.editorStyle).toBe("off");
      expect(raw.unknown).toEqual({ keep: true });
      expect(raw.editorModelLabel).toBe("name");
      expect(raw.components.editor.style).toBe("off");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves editor border color mode without erasing sibling config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: { keep: true },
            components: { editor: { modelLabel: "name" } },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveEditorBorderColorMode("adaptive", path);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(raw.unknown).toEqual({ keep: true });
      expect(raw.components.editor.modelLabel).toBe("name");
      expect(raw.components.editor.borderColorMode).toBe("adaptive");
      expect(config.editorBorderColorMode).toBe("adaptive");
      expect(config.editorModelLabel).toBe("name");
      expect(configTempFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves pathDisplay patches and keeps unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            components: {
              footer: {
                styles: {
                  starship: {
                    pathDisplay: {
                      mode: "basename",
                      depth: 3,
                      futureKey: "future",
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        )}
`,
      );

      const config = savePathDisplayPatch({ mode: "full" }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.pathDisplay).toEqual({ mode: "full", depth: 3 });
      expect(raw.unknown).toBe(true);
      expect(raw.components.footer.styles.starship.pathDisplay).toEqual({
        mode: "full",
        depth: 3,
        futureKey: "future",
      });

      const depthConfig = savePathDisplayPatch({ depth: 1 }, path);
      expect(depthConfig.pathDisplay).toEqual({ mode: "full", depth: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to full for invalid git branch lengths", () => {
    for (const maxLength of [0, -1, 1.5, "10", "short", null, true]) {
      expect(mergeConfig({ gitBranch: { maxLength } }).gitBranch).toEqual({
        maxLength: "full",
      });
    }
    expect(mergeConfig({ gitBranch: 20 }).gitBranch).toEqual({
      maxLength: "full",
    });
  });

  it("saves git branch length without erasing unknown config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify({ unknown: true, gitBranch: { maxLength: 17, future: true } }, null, 2)}\n`,
      );

      const config = saveGitBranchPatch({ maxLength: 30 }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(config.gitBranch).toEqual({ maxLength: 30 });
      expect(raw.unknown).toBe(true);
      expect(raw.gitBranch).toEqual({ maxLength: 17, future: true });
      expect(raw.components.footer.styles.starship.gitBranch).toEqual({
        maxLength: 30,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults icon mode to auto and accepts nerd/ascii", () => {
    expect(mergeConfig({}).icons.mode).toBe("auto");
    expect(mergeConfig({ icons: { mode: "ascii" } }).icons.mode).toBe("ascii");
    expect(mergeConfig({ icons: { mode: "nerd" } }).icons.mode).toBe("nerd");
    expect(mergeConfig({ icons: { mode: "emoji" } }).icons.mode).toBe("auto");
    expect(mergeConfig({ icons: { mode: "ascii" } }).icons.cwd).toBe("");
    expect(
      mergeConfig({ icons: { mode: "ascii", cwd: "DIR" } }).icons.cwd,
    ).toBe("DIR");
  });

  it("accepts canonical Starship color keys", () => {
    expect(
      mergeConfig({ colors: { gitBranch: "bold purple" } }).colors.gitBranch,
    ).toBe("bold purple");
    expect(
      mergeConfig({ colors: { packageVersion: "bold green" } }).colors
        .packageVersion,
    ).toBe("bold green");
    expect(
      mergeConfig({ colors: { gitCommit: "bold yellow" } }).colors.gitCommit,
    ).toBe("bold yellow");
    expect(
      mergeConfig({ colors: { gitMetricsAdded: "green" } }).colors
        .gitMetricsAdded,
    ).toBe("green");
    expect(
      mergeConfig({ colors: { gitMetricsDeleted: "red" } }).colors
        .gitMetricsDeleted,
    ).toBe("red");
    expect(
      mergeConfig({ colors: { extensionStatus: "warning" } }).colors
        .extensionStatus,
    ).toBe("warning");
    expect(
      mergeConfig({ colors: { extensionStatus: "neon" } }).colors
        .extensionStatus,
    ).toBe(defaultConfig.colors.extensionStatus);
  });

  it("accepts optional editor and user-message chrome color overrides", () => {
    const config = mergeConfig({
      colors: {
        editorAccent: "bold purple",
        editorBorder: "#89b4fa",
        editorModel: "accent",
        editorProvider: "text",
        editorThinking: "muted",
        editorThinkingMinimal: "thinkingMinimal",
        editorThinkingLow: "thinkingLow",
        editorThinkingMedium: "thinkingMedium",
        editorThinkingHigh: "thinkingHigh",
        editorThinkingXhigh: "thinkingXhigh",
        editorThinkingMax: "thinkingMax",
      },
    });

    expect(config.colors.editorAccent).toBe("bold purple");
    expect(config.colors.editorBorder).toBe("#89b4fa");
    expect(config.colors.editorModel).toBe("accent");
    expect(config.colors.editorProvider).toBe("text");
    expect(config.colors.editorThinking).toBe("muted");
    expect(config.colors.editorThinkingMinimal).toBe("thinkingMinimal");
    expect(config.colors.editorThinkingLow).toBe("thinkingLow");
    expect(config.colors.editorThinkingMedium).toBe("thinkingMedium");
    expect(config.colors.editorThinkingHigh).toBe("thinkingHigh");
    expect(config.colors.editorThinkingXhigh).toBe("thinkingXhigh");
    expect(config.colors.editorThinkingMax).toBe("thinkingMax");
  });

  it("ignores invalid known values at runtime instead of trusting pi-one-ui.json", () => {
    const config = mergeConfig({
      projectRefreshIntervalMs: "fast",
      icons: {
        cwd: 42,
        git: "git",
        cacheHit: "CH",
      },
      colors: {
        cwd: 123,
        gitStatus: "not-a-color",
        separator: "dimmed",
        editorAccent: "neon",
        editorBorder: "also-neon",
        editorThinkingHigh: "thinkingHigh",
      },
      components: {
        editor: { colorSource: "terminal" },
        footer: { colorSource: "neon" },
      },
    });

    expect(config.projectRefreshIntervalMs).toBe(
      defaultConfig.projectRefreshIntervalMs,
    );
    expect(config.icons.cwd).toBe(defaultConfig.icons.cwd);
    expect(config.icons.git).toBe("git");
    expect(config.icons.cacheHit).toBe("CH");
    expect(config.colors.cwd).toBe(defaultConfig.colors.cwd);
    expect(config.colors.gitStatus).toBe(defaultConfig.colors.gitStatus);
    expect(config.colors.separator).toBe("dimmed");
    expect(config.colors.editorAccent).toBeUndefined();
    expect(config.colors.editorBorder).toBeUndefined();
    expect(config.colors.editorThinkingHigh).toBe("thinkingHigh");
    expect(config.colorSources).toEqual({
      starship: "theme",
      editor: "terminal",
      userMessages: "theme",
    });
  });

  it("saves color source patches without erasing unknown user config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            icons: { git: "git" },
            colors: {
              futureKey: "future",
              cwd: "bold cyan",
              gitBranch: "syntaxKeyword",
              cost: "success",
            },
            components: { editor: { colorSource: "terminal" } },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveColorSourcesPatch({ starship: "terminal" }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.colorSources).toEqual({
        starship: "terminal",
        editor: "terminal",
        userMessages: "theme",
      });
      expect(raw.unknown).toBe(true);
      expect(raw.icons.git).toBe("git");
      expect(raw.colors.cwd).toBe("bold cyan");
      expect(raw.colors.futureKey).toBe("future");
      expect(raw.colors.gitBranch).toBe("syntaxKeyword");
      expect(raw.colors.cost).toBe("success");
      expect(raw.components.footer.colorSource).toBe("terminal");
      expect(raw.components.editor.colorSource).toBe("terminal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes invalid canonical color sources while preserving unknown fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            components: {
              footer: { colorSource: "neon" },
              editor: { colorSource: "terminal" },
              userMessages: {
                colorSource: "invalid",
                futureColorSource: "terminal",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveColorSourcesPatch({ userMessages: "terminal" }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.colorSources).toEqual({
        starship: "theme",
        editor: "terminal",
        userMessages: "terminal",
      });
      expect(raw.components.footer.colorSource).toBe("theme");
      expect(raw.components.editor.colorSource).toBe("terminal");
      expect(raw.components.userMessages.colorSource).toBe("terminal");
      expect(raw.components.userMessages.futureColorSource).toBe("terminal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes only the requested settings when creating pi-one-ui.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveColorSourcesPatch({ starship: "terminal" }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.colorSources).toEqual({
        starship: "terminal",
        editor: "theme",
        userMessages: "theme",
      });
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(raw.components.footer.colorSource).toBe("terminal");
      expect(raw.components.editor.colorSource).toBe("theme");
      expect(raw.components.userMessages.colorSource).toBe("theme");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves UI feature patches without erasing unknown user config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            features: {
              editor: true,
              futureKey: "future",
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveUiFeaturesPatch(
        { statusLine: false, viewportIndicators: false },
        path,
      );
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.features).toEqual({
        editor: true,
        statusLine: false,
        viewportIndicators: false,
      });
      expect(raw.unknown).toBe(true);
      expect(raw.features).toEqual({ editor: true, futureKey: "future" });
      expect(raw.components.editor.style).toBe("on");
      expect(raw.components.editor.viewportIndicators).toBe(false);
      expect(raw.components.footer.style).toBe("native");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes only the requested UI feature setting when creating pi-one-ui.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveUiFeaturesPatch({ editor: false }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.features).toEqual({
        editor: false,
        statusLine: true,
        viewportIndicators: true,
      });
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(raw.components.editor.style).toBe("off");
      expect(raw.components.userMessages.enabled).toBe(false);
      expect(raw.components.selectorBorders.enabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves footer segment patches without erasing unknown user config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            footerSegments: {
              cwd: true,
              futureKey: "future",
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveFooterSegmentsPatch(
        { modelInfo: true, tokens: false, cost: false },
        path,
      );
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.footerSegments).toEqual({
        cwd: true,
        sessionName: true,
        gitBranch: true,
        gitStatus: true,
        runtime: true,
        modelInfo: true,
        context: true,
        gitCounts: false,
        sessionDuration: false,
        username: false,
        time: false,
        os: false,
        packageVersion: false,
        gitCommit: false,
        gitMetrics: false,
        tokens: false,
        cost: false,
      });
      expect(raw.unknown).toBe(true);
      expect(raw.footerSegments).toEqual({ cwd: true, futureKey: "future" });
      expect(raw.components.footer.styles.starship.segments).toMatchObject({
        cwd: true,
        modelInfo: true,
        tokens: false,
        cost: false,
      });
      expect(mergeConfig(raw).footerSegments.modelInfo).toBe(true);

      const disabled = saveFooterSegmentsPatch({ modelInfo: false }, path);
      const disabledRaw = JSON.parse(readFileSync(path, "utf8"));
      expect(disabled.footerSegments.modelInfo).toBe(false);
      expect(mergeConfig(disabledRaw).footerSegments.modelInfo).toBe(false);
      expect(disabledRaw.unknown).toBe(true);
      expect(disabledRaw.footerSegments).toEqual({
        cwd: true,
        futureKey: "future",
      });
      expect(
        disabledRaw.components.footer.styles.starship.segments,
      ).toMatchObject({
        modelInfo: false,
        tokens: false,
        cost: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes only the requested footer segment setting when creating pi-one-ui.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveFooterSegmentsPatch({ runtime: false }, path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.footerSegments).toEqual({
        cwd: true,
        sessionName: true,
        gitBranch: true,
        gitStatus: true,
        runtime: false,
        modelInfo: false,
        context: true,
        gitCounts: false,
        sessionDuration: false,
        username: false,
        time: false,
        os: false,
        packageVersion: false,
        gitCommit: false,
        gitMetrics: false,
        tokens: true,
        cost: true,
      });
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(raw.components.footer.styles.starship.segments.runtime).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("toggles and persists the packageVersion footer segment", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveFooterSegmentsPatch({ packageVersion: true }, path);
      expect(config.footerSegments.packageVersion).toBe(true);

      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(
        raw.components.footer.styles.starship.segments.packageVersion,
      ).toBe(true);

      const reloaded = mergeConfig(raw);
      expect(reloaded.footerSegments.packageVersion).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("toggles and persists gitCommit and gitMetrics footer segments", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveFooterSegmentsPatch(
        { gitCommit: true, gitMetrics: true },
        path,
      );
      expect(config.footerSegments.gitCommit).toBe(true);
      expect(config.footerSegments.gitMetrics).toBe(true);

      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(raw.components.footer.styles.starship.segments).toMatchObject({
        gitCommit: true,
        gitMetrics: true,
      });

      const reloaded = mergeConfig(raw);
      expect(reloaded.footerSegments.gitCommit).toBe(true);
      expect(reloaded.footerSegments.gitMetrics).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes and reads back footerFormat", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveFooterFormatPatch(
        "$cwd on $git_branch $fill $cost",
        path,
      );
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.footerFormat).toBe("$cwd on $git_branch $fill $cost");
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(raw.components.footer.styles.starship.format).toBe(
        "$cwd on $git_branch $fill $cost",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears footerFormat when saving empty string", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveFooterFormatPatch("", path);
      expect(config.footerFormat).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves extension status placement when creating pi-one-ui.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveExtensionStatusPlacement("plugin.key", "middle", path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.extensionStatuses.placements).toEqual({
        "plugin.key": "middle",
      });
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(
        raw.components.footer.styles.starship.extensionStatuses.placements,
      ).toEqual({
        "plugin.key": "middle",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves extension status color mode when creating pi-one-ui.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      const config = saveExtensionStatusColorMode(
        "plugin.key",
        "original",
        path,
      );
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.extensionStatuses.colorModes).toEqual({
        "plugin.key": "original",
      });
      expect(Object.keys(raw)).toEqual(["version", "components"]);
      expect(
        raw.components.footer.styles.starship.extensionStatuses.colorModes,
      ).toEqual({
        "plugin.key": "original",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves extension status color mode without erasing placement config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            colors: { futureKey: "future" },
            components: {
              footer: {
                styles: {
                  starship: {
                    extensionStatuses: {
                      defaultPlacement: "left",
                      futureKey: "future",
                      placements: {
                        alpha: "right",
                        invalid: "center",
                      },
                      colorModes: {
                        alpha: "zentui",
                        invalid: "muted",
                      },
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveExtensionStatusColorMode("beta", "original", path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.extensionStatuses).toEqual({
        defaultPlacement: "left",
        placements: { alpha: "right" },
        colorModes: { alpha: "zentui", beta: "original" },
      });
      expect(raw.unknown).toBe(true);
      expect(raw.colors.futureKey).toBe("future");
      const rawStatuses =
        raw.components.footer.styles.starship.extensionStatuses;
      expect(rawStatuses.futureKey).toBe("future");
      expect(rawStatuses.placements).toEqual({
        alpha: "right",
        invalid: "center",
      });
      expect(rawStatuses.colorModes).toEqual({
        alpha: "zentui",
        beta: "original",
        invalid: "muted",
      });
      expect(
        raw.components.footer.styles.starship.extensionStatuses.colorModes,
      ).toEqual({
        alpha: "zentui",
        beta: "original",
        invalid: "muted",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves extension status placement without erasing unknown user config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            unknown: true,
            colors: { futureKey: "future" },
            components: {
              footer: {
                styles: {
                  starship: {
                    extensionStatuses: {
                      defaultPlacement: "left",
                      futureKey: "future",
                      placements: {
                        alpha: "right",
                        invalid: "center",
                      },
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const config = saveExtensionStatusPlacement("beta", "off", path);
      const raw = JSON.parse(readFileSync(path, "utf8"));

      expect(config.extensionStatuses).toEqual({
        defaultPlacement: "left",
        placements: { alpha: "right", beta: "off" },
        colorModes: {},
      });
      expect(raw.unknown).toBe(true);
      expect(raw.colors.futureKey).toBe("future");
      const rawStatuses =
        raw.components.footer.styles.starship.extensionStatuses;
      expect(rawStatuses.futureKey).toBe("future");
      expect(rawStatuses.placements).toEqual({
        alpha: "right",
        beta: "off",
        invalid: "center",
      });
      expect(
        raw.components.footer.styles.starship.extensionStatuses.placements,
      ).toEqual({
        alpha: "right",
        beta: "off",
        invalid: "center",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderTerminalStyle", () => {
  it("renders Starship bold green with terminal palette ANSI codes", () => {
    expect(renderTerminalStyle("bold green", " v22.0.0")).toBe(
      "\u001b[1;32m v22.0.0\u001b[0m",
    );
  });

  it("supports 256-color, fg/bg aliases, dimmed, and Starship hex styles", () => {
    expect(renderTerminalStyle("bold 149", "C")).toBe(
      "\u001b[1;38;5;149mC\u001b[0m",
    );
    expect(renderTerminalStyle("bold fg:202", "Haxe")).toBe(
      "\u001b[1;38;5;202mHaxe\u001b[0m",
    );
    expect(renderTerminalStyle("red dimmed", "Java")).toBe(
      "\u001b[31;2mJava\u001b[0m",
    );
    expect(renderTerminalStyle("bg:blue fg:bright-green", "ok")).toBe(
      "\u001b[44;92mok\u001b[0m",
    );
    expect(renderTerminalStyle("bold #FFAFF3", "Gleam")).toBe(
      "\u001b[1;38;2;255;175;243mGleam\u001b[0m",
    );
  });
});

describe("style rendering", () => {
  const theme = {
    fg(token: string, text: string) {
      return `<${token}>${text}</${token}>`;
    },
  };

  it("uses theme tokens when provided to colorize", () => {
    expect(colorize(theme, "accent", "hello")).toBe("<accent>hello</accent>");
  });

  it("falls back to plain text for invalid theme tokens", () => {
    const throwingTheme = {
      fg(token: string, text: string) {
        if (token === "text") return `<text>${text}</text>`;
        throw new Error(`Unknown color: ${token}`);
      },
    };

    expect(colorize(throwingTheme, "doesNotExist", "hello")).toBe("hello");
    expect(renderStyle(throwingTheme, "doesNotExist", "hello")).toBe("hello");
    expect(
      renderStyleForSource(throwingTheme, "theme", "doesNotExist", "hello"),
    ).toBe("hello");
  });

  it("maps Starship modifiers to safe theme colors when the theme rejects unknown tokens", () => {
    const strictTheme = {
      fg(token: string, text: string) {
        if (!["muted", "syntaxKeyword", "text"].includes(token)) {
          throw new Error(`Unknown theme color: ${token}`);
        }
        return `<${token}>${text}</${token}>`;
      },
      bold(text: string) {
        return `<bold>${text}</bold>`;
      },
    };

    expect(renderStyleForSource(strictTheme, "theme", "dimmed", "tokens")).toBe(
      "<muted>tokens</muted>",
    );
    expect(
      renderStyleForSource(strictTheme, "theme", "bold purple", "git"),
    ).toBe("<syntaxKeyword><bold>git</bold></syntaxKeyword>");
    expect(
      renderStyleForSource(strictTheme, "theme", "unknownColor", "text"),
    ).toBe("text");
  });

  it("supports hex colors", () => {
    expect(colorize(theme, "#89b4fa", "hello")).toBe(
      "\u001b[38;2;137;180;250mhello\u001b[39m",
    );
  });

  it("supports short #rgb hex colors by expanding to rrggbb", () => {
    expect(colorize(theme, "#89b", "hello")).toBe(
      "\u001b[38;2;136;153;187mhello\u001b[39m",
    );
    expect(renderTerminalStyle("bold #89b", "x")).toBe(
      "\u001b[1;38;2;136;153;187mx\u001b[0m",
    );
  });

  it("renders Starship styles before falling back to theme tokens", () => {
    expect(renderStyle(theme, "bold purple", "git")).toBe(
      "\u001b[1;35mgit\u001b[0m",
    );
    expect(renderStyle(theme, "syntaxKeyword", "git")).toBe(
      "<syntaxKeyword>git</syntaxKeyword>",
    );
  });

  it("renders theme-source Starship colors through Pi theme tokens", () => {
    expect(renderStyleForSource(theme, "theme", "bold cyan", "cwd")).toBe(
      "<syntaxFunction>cwd</syntaxFunction>",
    );
    expect(renderStyleForSource(theme, "theme", "bold purple", "git")).toBe(
      "<syntaxKeyword>git</syntaxKeyword>",
    );
    expect(renderStyleForSource(theme, "theme", "bold red", "!")).toBe(
      "<error>!</error>",
    );
    expect(renderStyleForSource(theme, "theme", "dimmed", "tokens")).toBe(
      "<muted>tokens</muted>",
    );
    expect(renderStyleForSource(theme, "theme", "bold green", "cost")).toBe(
      "<success>cost</success>",
    );
    expect(renderStyleForSource(theme, "theme", "syntaxKeyword", "git")).toBe(
      "<syntaxKeyword>git</syntaxKeyword>",
    );
  });

  it("keeps explicit terminal styles available for terminal source", () => {
    expect(renderStyleForSource(theme, "terminal", "bold purple", "git")).toBe(
      "\u001b[1;35mgit\u001b[0m",
    );
    expect(renderStyleForSource(theme, "theme", "fg:202", "git")).toBe(
      "\u001b[38;5;202mgit\u001b[0m",
    );
  });

  it("renders theme borders with borderMuted and terminal borders with bright black", () => {
    const thinkingTheme = {
      fg(token: string, text: string) {
        return `<${token}>${text}</${token}>`;
      },
    };

    expect(
      renderChromeBorder(thinkingTheme, "theme", "bright-black", "────"),
    ).toBe("<borderMuted>────</borderMuted>");
    expect(
      renderChromeBorder(thinkingTheme, "terminal", "bright-black", "────"),
    ).toBe("\u001b[90m────\u001b[0m");
  });
});

describe("bounded settings persistence", () => {
  function withConfig(
    initial: Record<string, unknown>,
    assertions: (path: string) => void,
  ): void {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-bounded-config-"));
    const path = join(dir, "pi-one-ui.json");
    try {
      writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`);
      assertions(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("saves editorModelLabel while preserving unrelated root config", () => {
    withConfig(
      {
        components: { editor: { modelLabel: "id" } },
        unknown: { keep: true },
      },
      (path) => {
        const config = saveEditorModelLabel("name", path);
        const raw = JSON.parse(readFileSync(path, "utf8"));
        expect(config.editorModelLabel).toBe("name");
        expect(raw.unknown).toEqual({ keep: true });
        expect(raw.components.editor.modelLabel).toBe("name");
        expect(raw.components.footer.modelLabel).toBe("name");
      },
    );
  });

  it("saves git commit booleans while preserving hashLength and unknown siblings", () => {
    withConfig(
      {
        unknown: true,
        components: {
          footer: {
            styles: {
              starship: {
                gitCommit: {
                  hashLength: 12,
                  onlyDetached: true,
                  showTag: true,
                  future: "keep",
                },
              },
            },
          },
        },
      },
      (path) => {
        const config = saveGitCommitPatch(
          { onlyDetached: false, showTag: false },
          path,
        );
        const raw = JSON.parse(readFileSync(path, "utf8"));
        expect(config.gitCommit).toEqual({
          hashLength: 12,
          onlyDetached: false,
          showTag: false,
        });
        expect(raw.components.footer.styles.starship.gitCommit).toEqual({
          hashLength: 12,
          onlyDetached: false,
          showTag: false,
          future: "keep",
        });
        expect(raw.unknown).toBe(true);
      },
    );
  });

  it("saves git metrics booleans while preserving unknown siblings", () => {
    withConfig(
      {
        unknown: true,
        components: {
          footer: {
            styles: {
              starship: {
                gitMetrics: {
                  onlyNonzero: true,
                  ignoreSubmodules: false,
                  future: 1,
                },
              },
            },
          },
        },
      },
      (path) => {
        const config = saveGitMetricsPatch(
          { onlyNonzero: false, ignoreSubmodules: true },
          path,
        );
        const raw = JSON.parse(readFileSync(path, "utf8"));
        expect(config.gitMetrics).toEqual({
          onlyNonzero: false,
          ignoreSubmodules: true,
        });
        expect(raw.components.footer.styles.starship.gitMetrics).toEqual({
          onlyNonzero: false,
          ignoreSubmodules: true,
          future: 1,
        });
        expect(raw.unknown).toBe(true);
      },
    );
  });

  it("saves default extension placement while preserving keyed and unknown config", () => {
    withConfig(
      {
        unknown: true,
        components: {
          footer: {
            styles: {
              starship: {
                extensionStatuses: {
                  defaultPlacement: "right",
                  placements: { alpha: "left" },
                  colorModes: { alpha: "original" },
                  future: "keep",
                },
              },
            },
          },
        },
      },
      (path) => {
        const config = saveExtensionStatusDefaultPlacement("middle", path);
        const raw = JSON.parse(readFileSync(path, "utf8"));
        expect(config.extensionStatuses).toEqual({
          defaultPlacement: "middle",
          placements: { alpha: "left" },
          colorModes: { alpha: "original" },
        });
        const rawStatuses =
          raw.components.footer.styles.starship.extensionStatuses;
        expect(rawStatuses.future).toBe("keep");
        expect(rawStatuses.placements).toEqual({ alpha: "left" });
        expect(rawStatuses.colorModes).toEqual({ alpha: "original" });
        expect(
          raw.components.footer.styles.starship.extensionStatuses
            .defaultPlacement,
        ).toBe("middle");
        expect(raw.unknown).toBe(true);
      },
    );
  });
});

describe("startup and file safety", () => {
  it("does not create, rewrite, or materialize config at startup", () => {
    withConfig(undefined, (path) => {
      ensureConfigExists(path);
      expect(existsSync(path)).toBe(false);
    });
    withConfig({ features: { editor: false }, unknown: true }, (path) => {
      const before = readFileSync(path, "utf8");
      ensureConfigExists(path);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(readRaw(path)).not.toHaveProperty("components");
    });
  });

  it("refuses corrupt config without changing bytes or leaving a temporary file", () => {
    withConfig(undefined, (path, dir) => {
      const original = "{ invalid json\n";
      writeFileSync(path, original);
      expect(() => saveSeparatorPatch("dot", path)).toThrow(
        /Refusing to save pi-one-ui config.*corrupt/,
      );
      expect(readFileSync(path, "utf8")).toBe(original);
      expect(configTempFiles(dir)).toEqual([]);
    });
  });

  it("creates a missing config atomically and returns the re-merged file", () => {
    withConfig(undefined, (path, dir) => {
      const config = saveFooterFormatPatch("$cwd", path);
      const raw = readRaw(path);
      expect(raw.components.footer.styles.starship.format).toBe("$cwd");
      expect(raw).not.toHaveProperty("fixedEditor");
      expect(raw).not.toHaveProperty("layout.fixedEditor");
      expect(config).toEqual(mergeConfig(raw));
      expect(configTempFiles(dir)).toEqual([]);
    });
  });

  it("preserves destination mode during atomic replacement", () => {
    withConfig({ separator: "pipe" }, (path, dir) => {
      chmodSync(path, 0o600);
      saveSeparatorPatch("dot", path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readRaw(path).components.footer.styles.starship.separator).toBe(
        "dot",
      );
      expect(configTempFiles(dir)).toEqual([]);
    });
  });

  it("updates a symlink target atomically without replacing the symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-symlink-config-"));
    const targetDir = join(dir, "target");
    const targetPath = join(targetDir, "actual.json");
    const linkPath = join(dir, "pi-one-ui.json");
    try {
      mkdirSync(targetDir);
      writeFileSync(
        targetPath,
        `${JSON.stringify({ unknown: true }, null, 2)}\n`,
      );
      chmodSync(targetPath, 0o600);
      symlinkSync(targetPath, linkPath);
      const originalLink = readlinkSync(linkPath);
      const config = saveSeparatorPatch("chevron", linkPath);
      const raw = readRaw(targetPath);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe(originalLink);
      expect(raw.unknown).toBe(true);
      expect(raw.components.footer.styles.starship.separator).toBe("chevron");
      expect(config).toEqual(mergeConfig(raw));
      expect(statSync(targetPath).mode & 0o777).toBe(0o600);
      expect(configTempFiles(targetDir, "actual.json")).toEqual([]);
      expect(configTempFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a dangling symlink without changing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-dangling-config-"));
    const targetDir = join(dir, "target");
    const missingTarget = join(targetDir, "missing.json");
    const linkPath = join(dir, "pi-one-ui.json");
    try {
      mkdirSync(targetDir);
      symlinkSync(missingTarget, linkPath);
      const originalLink = readlinkSync(linkPath);
      expect(() => saveSeparatorPatch("dot", linkPath)).toThrow(
        /Refusing to save pi-one-ui config/,
      );
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe(originalLink);
      expect(existsSync(missingTarget)).toBe(false);
      expect(configTempFiles(targetDir, "missing.json")).toEqual([]);
      expect(configTempFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the destination and leaves no temp file when serialization input is invalid", () => {
    withConfig({ unknown: true }, (path, dir) => {
      const original = readFileSync(path, "utf8");
      expect(() =>
        saveContextThresholdsPatch({ warning: 1n as never }, path),
      ).toThrow();
      expect(readFileSync(path, "utf8")).toBe(original);
      expect(configTempFiles(dir)).toEqual([]);
    });
  });
});

describe("Opencode and Footer canonical config", () => {
  it("saves Footer styles while preserving unknown canonical data", () => {
    withConfig(
      {
        components: {
          footer: {
            future: "keep",
            styles: {
              starship: { format: "$cwd", future: "keep" },
              future: { keep: true },
            },
          },
        },
      },
      (path) => {
        saveFooterComponentPatch({ style: "hidden" }, path);
        const raw = readRaw(path);
        expect(raw.components.footer.style).toBe("hidden");
        expect(raw.components.footer.future).toBe("keep");
        expect(raw.components.footer.styles.starship).toMatchObject({
          format: "$cwd",
          future: "keep",
        });
        expect(raw.components.footer.styles.future).toEqual({ keep: true });
      },
    );
  });

  it("maps grouped Footer settings to canonical styles", () => {
    withConfig({ components: { footer: { style: "hidden" } } }, (path) => {
      expect(
        saveUiFeaturesPatch({ statusLine: true }, path).components.footer.style,
      ).toBe("starship");
      expect(
        saveUiFeaturesPatch({ statusLine: false }, path).components.footer
          .style,
      ).toBe("native");
    });
  });

  it("ignores inherited extension-status overrides and validates runtime mutations", () => {
    const config = structuredClone(defaultConfig);
    const statuses = config.components.footer.styles.starship.extensionStatuses;
    statuses.placements = Object.create({ constructor: "left" }) as Record<
      string,
      (typeof statuses.placements)[string]
    >;
    statuses.colorModes = Object.create({ constructor: "original" }) as Record<
      string,
      (typeof statuses.colorModes)[string]
    >;
    expect(getExtensionStatusPlacement(config, "constructor")).toBe("right");
    expect(getExtensionStatusColorMode(config, "constructor")).toBe("zentui");

    Object.defineProperty(statuses.placements, "constructor", {
      value: "left",
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(statuses.colorModes, "constructor", {
      value: "original",
      enumerable: true,
      configurable: true,
    });
    expect(getExtensionStatusPlacement(config, "constructor")).toBe("left");
    expect(getExtensionStatusColorMode(config, "constructor")).toBe("original");

    (statuses as unknown as { defaultPlacement: string }).defaultPlacement =
      "center";
    (statuses.placements as unknown as Record<string, string>).alpha =
      "explode";
    (statuses.colorModes as unknown as Record<string, string>).alpha =
      "rainbow";
    expect(getExtensionStatusPlacement(config, "missing")).toBe("right");
    expect(getExtensionStatusPlacement(config, "alpha")).toBe("right");
    expect(getExtensionStatusColorMode(config, "alpha")).toBe("zentui");
  });

  it("marks only explicit non-empty unknown canonical component styles", () => {
    const future = mergeConfig({
      components: {
        editor: { style: "future-editor" },
        userMessages: { style: "future-messages" },
        selectorBorders: { style: "future-selectors" },
        footer: { style: "future-footer" },
      },
    });
    for (const owner of [
      "editor",
      "userMessages",
      "selectorBorders",
      "footer",
    ] as const) {
      expect(hasUnsupportedComponentStyle(future, owner)).toBe(true);
    }

    for (const style of [undefined, "", "   ", null, false, {}, []]) {
      const ordinary = mergeConfig({ components: { editor: { style } } });
      expect(hasUnsupportedComponentStyle(ordinary, "editor")).toBe(false);
    }
    expect(
      hasUnsupportedComponentStyle(
        mergeConfig({ components: { editor: { style: "polished" } } }),
        "editor",
      ),
    ).toBe(true);
  });
});
