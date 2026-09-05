import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  defaultConfig,
  type EditorStyle,
  type PolishedTuiConfig,
} from "../../extensions/app/config/shell";
import {
  PolishedEditor,
  renderWithAutocompleteCapture,
  WrappedPolishedEditor,
} from "../../extensions/layouts/editor/ui";

function theme(): Theme {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    strikethrough: (text: string) => text,
    inverse: (text: string) => text,
  } as Theme;
}

type EditorOptions = Partial<PolishedTuiConfig["features"]> & {
  style?: EditorStyle;
  completionMenu?: "native" | "palette";
};

function config(
  options: EditorOptions = {},
  editorBorderColorMode: PolishedTuiConfig["editorBorderColorMode"] = "static",
): PolishedTuiConfig {
  return {
    ...defaultConfig,
    components: {
      ...defaultConfig.components,
      editor: {
        ...defaultConfig.components.editor,
        style: options.style ?? defaultConfig.components.editor.style,
        borderColorMode: editorBorderColorMode,
        viewportIndicators:
          options.viewportIndicators ??
          defaultConfig.components.editor.viewportIndicators,
        styles: {
          ...defaultConfig.components.editor.styles,
          opencode: {
            ...defaultConfig.components.editor.styles.opencode,
            ...(options.completionMenu
              ? { completionMenu: options.completionMenu }
              : {}),
          },
        },
      },
    },
    features: {
      ...defaultConfig.features,
      ...(options.editor === undefined ? {} : { editor: options.editor }),
      ...(options.statusLine === undefined
        ? {}
        : { statusLine: options.statusLine }),
      ...(options.viewportIndicators === undefined
        ? {}
        : { viewportIndicators: options.viewportIndicators }),
    },
  };
}

function withEditorStyle(
  base: PolishedTuiConfig,
  style: PolishedTuiConfig["components"]["editor"]["style"],
): PolishedTuiConfig {
  return {
    ...base,
    components: {
      ...base.components,
      editor: { ...base.components.editor, style },
    },
  };
}

function nativeBorder(
  width: number,
  direction: "above" | "below",
  count?: number,
  ansi = false,
): string {
  const plain = count
    ? `─── ${direction === "above" ? "↑" : "↓"} ${count} more ${"─".repeat(
        Math.max(0, width - `─── ↑ ${count} more `.length),
      )}`
    : "─".repeat(width);
  return ansi ? `\x1b[90m${plain}\x1b[0m` : plain;
}

function baseEditor(options: {
  above?: number;
  below?: number;
  ansi?: boolean;
  malformedTop?: string;
  autocomplete?: string[];
}) {
  const autocomplete = options.autocomplete ?? [];
  const autocompleteList = {
    filteredItems: autocomplete.map((value) => ({ value })),
    selectedIndex: 0,
    maxVisible: Math.max(1, autocomplete.length),
    render: (_width?: number) => autocomplete,
  };
  return {
    render(width: number) {
      return [
        options.malformedTop ??
          nativeBorder(width, "above", options.above, options.ansi),
        "typed text",
        nativeBorder(width, "below", options.below, options.ansi),
        ...(autocomplete.length > 0 ? autocompleteList.render(width) : []),
      ];
    },
    invalidate() {},
    handleInput() {},
    getText: () => "typed text",
    setText() {},
    isShowingAutocomplete: () => autocomplete.length > 0,
    autocompleteList,
  };
}

function wrapped(
  base: ReturnType<typeof baseEditor> | WrappedPolishedEditor,
  features: EditorOptions = {},
  editorBorderColorMode: PolishedTuiConfig["editorBorderColorMode"] = "static",
): WrappedPolishedEditor {
  return new WrappedPolishedEditor(
    base as never,
    theme(),
    () => config(features, editorBorderColorMode),
    () => ({ modelLabel: "model", providerLabel: "provider" }),
    () => "off",
  );
}

function standalone(style: EditorStyle = "opencode"): PolishedEditor {
  const editor = new PolishedEditor(
    { requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
    { borderColor: (text: string) => text, selectList: {} } as never,
    {} as never,
    theme(),
    () => config({ style }),
    () => ({ modelLabel: "model", providerLabel: "provider" }),
    () => "off",
  );
  editor.setText("typed text");
  return editor;
}

const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type SemanticBorderState = (typeof thinkingLevels)[number] | "shell";

const semanticBorderCodes: Record<SemanticBorderState, number> = {
  off: 30,
  minimal: 31,
  low: 32,
  medium: 33,
  high: 34,
  xhigh: 35,
  max: 37,
  shell: 36,
};

function semanticTheme(): Theme {
  const base = theme();
  return {
    ...base,
    getThinkingBorderColor(level) {
      const code =
        semanticBorderCodes[level as (typeof thinkingLevels)[number]] ?? 37;
      return (text: string) => `\x1b[${code}m${text}\x1b[0m`;
    },
    getBashModeBorderColor() {
      return (text: string) =>
        `\x1b[${semanticBorderCodes.shell}m${text}\x1b[0m`;
    },
  } as Theme;
}

describe("adaptive editor border colors", () => {
  it("keeps static wrapped-editor rendering independent of Pi's callback", () => {
    const editor = wrapped(baseEditor({ above: 2, below: 3 }));
    editor.borderColor = (text) => `\x1b[35m${text}\x1b[0m`;

    const lines = editor.render(80);
    expect(lines[0]).not.toContain("\x1b[35m");
    expect(lines.at(-1)).not.toContain("\x1b[35m");
    expect(lines[0]).toContain("↑ 2 more");
    expect(lines.at(-1)).toContain("↓ 3 more");
  });

  it.each(["standalone", "wrapped"] as const)(
    "follows Pi thinking and shell callback transitions in the %s editor path",
    (editorKind) => {
      const piTheme = semanticTheme();
      let thinkingLevel: (typeof thinkingLevels)[number] = "off";
      const editor =
        editorKind === "standalone"
          ? new PolishedEditor(
              { requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
              { borderColor: (text: string) => text, selectList: {} } as never,
              {} as never,
              piTheme,
              () => config({}, "adaptive"),
              () => ({ modelLabel: "model", providerLabel: "provider" }),
              () => thinkingLevel,
            )
          : new WrappedPolishedEditor(
              baseEditor({ above: 2, below: 3 }) as never,
              piTheme,
              () => config({}, "adaptive"),
              () => ({ modelLabel: "model", providerLabel: "provider" }),
              () => thinkingLevel,
            );
      if (editorKind === "standalone") editor.setText("draft");

      const transitions: SemanticBorderState[] = [
        ...thinkingLevels,
        "shell",
        "xhigh",
        "off",
      ];
      for (const state of transitions) {
        if (state === "shell") {
          editor.borderColor = piTheme.getBashModeBorderColor();
        } else {
          thinkingLevel = state;
          editor.borderColor = piTheme.getThinkingBorderColor(state);
        }

        const lines = editor.render(80);
        const expectedCode = semanticBorderCodes[state];
        for (const border of [lines[0] ?? "", lines.at(-1) ?? ""]) {
          expect(border).toMatch(new RegExp(`^\\x1b\\[${expectedCode}m`));
          for (const code of Object.values(semanticBorderCodes)) {
            if (code !== expectedCode)
              expect(border).not.toContain(`\x1b[${code}m`);
          }
        }
        expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
      }
    },
  );
});

describe("editor viewport indicators", () => {
  it.each([
    [7, undefined, "↑ 7 more", undefined],
    [undefined, 11, undefined, "↓ 11 more"],
    [7, 11, "↑ 7 more", "↓ 11 more"],
  ] as const)(
    "preserves top and bottom native counts (above=%s, below=%s)",
    (above, below, topText, bottomText) => {
      const lines = wrapped(baseEditor({ above, below, ansi: true })).render(
        80,
      );
      if (topText) expect(lines[0]).toContain(topText);
      else expect(lines[0]).not.toContain("more");
      if (bottomText) expect(lines.at(-1)).toContain(bottomText);
      else expect(lines.at(-1)).not.toContain("more");
    },
  );

  it.each(["opencode"] as const)(
    "fails open from the same render when a third-party %s editor rewrites captured autocomplete rows",
    (style) => {
      for (const mutation of ["replace", "reorder"] as const) {
        const suggestions = ["→ original-one", "  original-two"];
        const base = baseEditor({ autocomplete: suggestions });
        const nativeRender = base.render.bind(base);
        const widths: number[] = [];
        let lastOutput: string[] = [];
        base.render = (width: number) => {
          widths.push(width);
          const rendered = nativeRender(width);
          const editorRows = rendered.slice(0, -suggestions.length);
          const autocompleteRows = rendered.slice(-suggestions.length);
          const mutatedRows =
            mutation === "replace"
              ? ["replacement-one", "replacement-two"]
              : [...autocompleteRows].reverse();
          lastOutput = [...editorRows, ...mutatedRows];
          return lastOutput;
        };

        const lines = wrapped(base, { style }).render(40);
        expect(lines).toEqual(lastOutput);
        expect(widths).toHaveLength(1);
        expect(widths[0]).toBeLessThan(40);
        expect(lines.join("\n")).not.toContain("↑↓ Navigate");
        expect(lines.some((line) => line.startsWith("▎"))).toBe(false);
      }
    },
  );

  it.each(["opencode"] as const)(
    "preserves same-render %s rows when autocomplete ownership changes during rendering",
    (style) => {
      const suggestions = ["→ original-one", "  original-two"];
      const base = baseEditor({ autocomplete: suggestions });
      const nativeRender = base.render.bind(base);
      const replacement = vi.fn(() => ["replacement"]);
      const widths: number[] = [];
      let sameRenderRows: string[] = [];
      base.render = (width: number) => {
        widths.push(width);
        sameRenderRows = nativeRender(width);
        base.autocompleteList.render = replacement;
        return sameRenderRows;
      };

      const lines = wrapped(base, { style }).render(40);
      expect(lines).toEqual(sameRenderRows);
      expect(widths).toHaveLength(1);
      expect(replacement).not.toHaveBeenCalled();
      expect(base.autocompleteList.render).toBe(replacement);
      expect(lines.join("\n")).not.toContain("↑↓ Navigate");
      expect(lines.some((line) => line.startsWith("▎"))).toBe(false);
    },
  );

  it.each(["opencode"] as const)(
    "keeps exact no-autocomplete output in %s",
    (style) => {
      const ordinary = baseEditor({ below: 2 });
      const guarded = baseEditor({ below: 2 });
      guarded.autocompleteList.render = () => {
        throw new Error("must not inspect an inactive menu");
      };
      expect(wrapped(guarded, { style }).render(80)).toEqual(
        wrapped(ordinary, { style }).render(80),
      );
    },
  );

  it.each(["opencode"] as const)(
    "keeps standalone %s autocomplete to one render when ownership changes",
    (style) => {
      const editor = standalone(style);
      const replacement = vi.fn(() => ["replacement"]);
      let calls = 0;
      const autocompleteList = {
        filteredItems: [{ value: "original" }],
        selectedIndex: 0,
        maxVisible: 1,
        render() {
          calls += 1;
          autocompleteList.render = replacement;
          return ["→ original"];
        },
      };
      Object.assign(editor as unknown as Record<string, unknown>, {
        autocompleteState: {},
        autocompleteList,
      });

      const lines = editor.render(80);
      expect(calls).toBe(1);
      expect(replacement).not.toHaveBeenCalled();
      expect(autocompleteList.render).toBe(replacement);
      expect(lines.some((line) => line.includes("→ original"))).toBe(true);
      expect(lines.join("\n")).not.toContain("↑↓ Navigate");
      expect(lines.some((line) => line.startsWith("▎"))).toBe(false);
    },
  );

  it.each([
    "── ↑ 7 more ─────────",
    "─── ↓ 7 more ─────────",
    "─── ↑ 07 more ─────────",
    "prefix ─── ↑ 7 more ─────────",
    "[muted]─── ↑ 7 more ─────────[/muted]",
  ])("fails open for an unknown top border form: %s", (malformedTop) => {
    const lines = wrapped(baseEditor({ below: 2, malformedTop })).render(80);
    expect(lines[0]).toBe(malformedTop);
    expect(lines).toContain("typed text");
    expect(lines.at(-1)).toContain("↓ 2 more");
  });

  it("preserves every row from a minimal public-contract third-party editor", () => {
    let text = "draft";
    const inputs: string[] = [];
    const base = {
      render: () => ["third-party header", text, "third-party help"],
      invalidate() {},
      handleInput(data: string) {
        inputs.push(data);
        text += data;
      },
      getText: () => text,
      setText(next: string) {
        text = next;
      },
    };
    const editor = wrapped(base as never);

    expect(editor.render(80)).toEqual([
      "third-party header",
      "draft",
      "third-party help",
    ]);
    editor.handleInput("!");
    expect(editor.getText()).toBe("draft!");
    expect(inputs).toEqual(["!"]);
  });

  it("preserves autocomplete rows when Pi-private inspection fields are absent", () => {
    const base = {
      render: (width: number) => [
        nativeBorder(width, "above"),
        "typed text",
        nativeBorder(width, "below"),
        "suggestion-one",
        "suggestion-two",
      ],
      invalidate() {},
      handleInput() {},
      getText: () => "typed text",
      setText() {},
    };

    const lines = wrapped(base as never).render(80);
    expect(lines).toContain("typed text");
    expect(lines).toContain("suggestion-one");
    expect(lines).toContain("suggestion-two");
    expect(lines).toHaveLength(5);
  });

  it.each(["visibility method", "autocomplete getter", "autocomplete render"])(
    "returns base rows when %s throws",
    (failure) => {
      const rendered = ["header", "typed text", "suggestion"];
      const base: Record<string, unknown> = {
        render: () => rendered,
        invalidate() {},
        handleInput() {},
        getText: () => "typed text",
        setText() {},
      };
      if (failure === "visibility method") {
        base.isShowingAutocomplete = () => {
          throw new Error("visibility failed");
        };
      } else {
        base.isShowingAutocomplete = () => true;
        if (failure === "autocomplete getter") {
          Object.defineProperty(base, "autocompleteList", {
            get() {
              throw new Error("getter failed");
            },
          });
        } else {
          base.autocompleteList = {
            render() {
              throw new Error("render failed");
            },
          };
        }
      }

      expect(wrapped(base as never).render(80)).toEqual(rendered);
    },
  );

  it("rejects in-place mutation of an otherwise provenance-owned rendered array", () => {
    const rendered = wrapped(baseEditor({ above: 2, below: 3 })).render(80);
    rendered[1] = "changed-row";
    rendered.splice(2, 0, "added-row");
    const base = {
      render: () => rendered,
      invalidate() {},
      handleInput() {},
      getText: () => "typed text",
      setText() {},
    };

    const lines = wrapped(base as never).render(80);
    expect(lines).toEqual(rendered);
    expect(lines).toContain("changed-row");
    expect(lines).toContain("added-row");
  });

  it("only exposes optional editor methods implemented by the base", () => {
    const withoutCapabilities = wrapped({
      render: () => ["plain"],
      invalidate() {},
      handleInput() {},
      getText: () => "",
      setText() {},
    } as never);
    for (const method of [
      "addToHistory",
      "insertTextAtCursor",
      "setAutocompleteProvider",
      "setPaddingX",
      "setAutocompleteMaxVisible",
    ]) {
      expect(method in withoutCapabilities).toBe(false);
    }

    const calls: string[] = [];
    const withCapabilities = wrapped({
      render: () => ["plain"],
      invalidate() {},
      handleInput() {},
      getText: () => "",
      setText() {},
      addToHistory: () => calls.push("history"),
      insertTextAtCursor: () => calls.push("insert"),
      setAutocompleteProvider: () => calls.push("autocomplete"),
      setPaddingX: () => calls.push("padding"),
      setAutocompleteMaxVisible: () => calls.push("max-visible"),
    } as never);
    withCapabilities.addToHistory?.("history");
    withCapabilities.insertTextAtCursor?.("insert");
    withCapabilities.setAutocompleteProvider?.({} as never);
    withCapabilities.setPaddingX?.(1);
    withCapabilities.setAutocompleteMaxVisible?.(5);
    expect(calls).toEqual([
      "history",
      "insert",
      "autocomplete",
      "padding",
      "max-visible",
    ]);
  });
});

describe("same-render autocomplete capture", () => {
  function source(render: (width: number) => string[]) {
    return {
      isShowingAutocomplete: () => true,
      autocompleteList: {
        filteredItems: [{ value: "one" }],
        selectedIndex: 0,
        maxVisible: 1,
        render,
      },
    };
  }

  it("restores the exact predecessor after descriptor flags mutate", () => {
    const predecessor = vi.fn(() => ["one"]);
    const autocomplete = source(predecessor);
    const original = Object.getOwnPropertyDescriptor(
      autocomplete.autocompleteList,
      "render",
    );
    const result = renderWithAutocompleteCapture(autocomplete as never, () => {
      const rows = autocomplete.autocompleteList.render(20);
      const wrapper = autocomplete.autocompleteList.render;
      Object.defineProperty(autocomplete.autocompleteList, "render", {
        value: wrapper,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      return rows;
    });
    expect(result.capture?.compatible).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(autocomplete.autocompleteList, "render"),
    ).toEqual(original);
    expect(predecessor).toHaveBeenCalledTimes(1);
  });

  it("preserves a synchronous third-party replacement and suppresses metadata", () => {
    const autocomplete = source(vi.fn(() => ["one"]));
    const replacement = vi.fn(() => ["replacement"]);
    const result = renderWithAutocompleteCapture(autocomplete as never, () => {
      const rows = autocomplete.autocompleteList.render(20);
      autocomplete.autocompleteList.render = replacement;
      return rows;
    });
    expect(result.capture?.compatible).toBe(false);
    expect(autocomplete.autocompleteList.render).toBe(replacement);
  });

  it("restores through a cleanup descriptor trap when the wrapper is still owned", () => {
    const predecessor = vi.fn(() => ["one"]);
    const target = source(predecessor).autocompleteList;
    let descriptorReads = 0;
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(current, property) {
        descriptorReads++;
        if (descriptorReads === 2) throw new Error("descriptor trap");
        return Reflect.getOwnPropertyDescriptor(current, property);
      },
    });
    const result = renderWithAutocompleteCapture(
      { isShowingAutocomplete: () => true, autocompleteList: proxy } as never,
      () => proxy.render(20),
    );
    expect(result.capture?.compatible).toBe(false);
    expect(target.render).toBe(predecessor);
    expect(predecessor).toHaveBeenCalledTimes(1);
  });

  it.each(["opencode"] as const)(
    "fails open from one %s render when inherited-renderer cleanup is rejected",
    (style) => {
      const predecessor = vi.fn((_width: number) => ["→ original"]);
      const target = Object.assign(
        Object.create({ render: predecessor }) as {
          render: (width: number) => string[];
          filteredItems: Array<{ value: string }>;
          selectedIndex: number;
          maxVisible: number;
        },
        {
          filteredItems: [{ value: "original" }],
          selectedIndex: 0,
          maxVisible: 1,
        },
      );
      const autocompleteList = new Proxy(target, {
        deleteProperty: () => false,
      });
      let renderCalls = 0;
      let sameRenderRows: string[] = [];
      const base = {
        render(width: number) {
          renderCalls++;
          sameRenderRows = [
            nativeBorder(width, "above"),
            "typed text",
            nativeBorder(width, "below"),
            ...autocompleteList.render(width),
          ];
          return sameRenderRows;
        },
        invalidate() {},
        handleInput() {},
        getText: () => "typed text",
        setText() {},
        isShowingAutocomplete: () => true,
        autocompleteList,
      };

      const lines = wrapped(base as never, { style }).render(40);
      expect(lines).toEqual(sameRenderRows);
      expect(renderCalls).toBe(1);
      expect(predecessor).toHaveBeenCalledTimes(1);
      expect(Object.hasOwn(target, "render")).toBe(true);
      expect(lines.join("\n")).not.toContain("↑↓ Navigate");
      expect(lines.some((line) => line.startsWith("▎"))).toBe(false);
    },
  );

  it("restores after throwing and supports nested capture without extra renders", () => {
    const predecessor = vi.fn(() => ["one"]);
    const autocomplete = source(predecessor);
    const original = autocomplete.autocompleteList.render;
    expect(() =>
      renderWithAutocompleteCapture(autocomplete as never, () => {
        autocomplete.autocompleteList.render(20);
        throw new Error("render failed");
      }),
    ).toThrow("render failed");
    expect(autocomplete.autocompleteList.render).toBe(original);

    predecessor.mockClear();
    const outer = renderWithAutocompleteCapture(autocomplete as never, () =>
      renderWithAutocompleteCapture(autocomplete as never, () =>
        autocomplete.autocompleteList.render(20),
      ),
    );
    expect(predecessor).toHaveBeenCalledTimes(1);
    expect(outer.capture).toMatchObject({ compatible: true, called: 1 });
    expect(outer.value.capture).toMatchObject({ compatible: true, called: 1 });
    expect(autocomplete.autocompleteList.render).toBe(original);
  });
});

describe("minimalist editor integration", () => {
  it("places native viewport counts at the far left before minimalist metadata", () => {
    const editor = new WrappedPolishedEditor(
      baseEditor({ above: 7, below: 11 }) as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({
        cwd: "/tmp/project",
        branch: "main",
        ahead: 2,
        behind: 1,
        agentDurationMs: 5000,
      }),
    );

    const lines = editor.render(80);
    expect(lines[0]).toMatch(/^╭─ ↑ 7 more · 5s/);
    expect(lines.at(-1)).toMatch(/^╰─ ↓ 11 more · main ↑2 ↓1/);
  });

  it("honors the shared viewport indicator toggle in minimalist mode", () => {
    const editor = new WrappedPolishedEditor(
      baseEditor({ above: 7, below: 11 }) as never,
      theme(),
      () =>
        withEditorStyle(config({ viewportIndicators: false }), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp/project" }),
    );

    expect(editor.render(80).join("\n")).not.toContain("more");
  });

  it("keeps known autocomplete rows inside the minimalist frame", () => {
    const base = baseEditor({ below: 5, autocomplete: ["one", "two"] });
    const editor = new WrappedPolishedEditor(
      base as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    );
    const lines = editor.render(40);
    expect(lines.some((line) => /^├─+┤$/.test(line))).toBe(true);
    expect(lines.findIndex((line) => line.includes("one"))).toBeGreaterThan(
      lines.findIndex((line) => line.startsWith("├")),
    );
    expect(lines.findIndex((line) => line.includes("one"))).toBeLessThan(
      lines.length - 1,
    );
    expect(lines.at(-1)).toContain("↓ 5 more");
    expect(lines.at(-1)).toMatch(/^╰.*╯$/);
  });

  it("fails open from the reduced same-render rows for unknown third-party output", () => {
    const widths: number[] = [];
    const decoration = vi.fn();
    const base = {
      render(width: number) {
        widths.push(width);
        return [`header-${width}`, "body", `help-${width}`];
      },
      invalidate() {},
      handleInput() {},
      getText: () => "body",
      setText() {},
    };
    const editor = new WrappedPolishedEditor(
      base as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
      decoration,
    );
    expect(editor.render(40)).toEqual(["header-36", "body", "help-36"]);
    expect(widths).toEqual([36]);
    expect(decoration).toHaveBeenLastCalledWith(false);
  });

  it("rejects mutated module-owned polished provenance in minimalist mode", () => {
    const owned = wrapped(baseEditor({ above: 2, below: 3 })).render(36);
    owned[1] = "mutated-row";
    const base = {
      render: () => owned,
      invalidate() {},
      handleInput() {},
      getText: () => "typed text",
      setText() {},
    };
    const decoration = vi.fn();
    const editor = new WrappedPolishedEditor(
      base as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
      decoration,
    );

    expect(editor.render(40)).toEqual(owned);
    expect(decoration).toHaveBeenLastCalledWith(false);
  });

  it("falls back at four columns and decorates after resizing to five", () => {
    const widths: number[] = [];
    const decoration = vi.fn();
    const base = baseEditor({});
    const renderBase = base.render.bind(base);
    base.render = (width: number) => {
      widths.push(width);
      return renderBase(width);
    };
    const editor = new WrappedPolishedEditor(
      base as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
      decoration,
    );

    const narrow = editor.render(4);
    expect(narrow[0]).not.toContain("╭");
    expect(narrow.every((line) => visibleWidth(line) <= 4)).toBe(true);
    const decorated = editor.render(5);
    expect(decorated[0]).toMatch(/^╭.*╮$/);
    expect(decorated.every((line) => visibleWidth(line) <= 5)).toBe(true);
    expect(widths).toEqual([4, 1]);
    expect(decoration.mock.calls.map(([active]) => active)).toEqual([
      false,
      true,
    ]);
  });

  it("preserves empty, multiline, blank, and inverse-video editor rows", () => {
    const inverseCursor = "\x1b[7m \x1b[0m";
    const base = {
      render: (width: number) => [
        nativeBorder(width, "above"),
        "",
        inverseCursor,
        "second line",
        nativeBorder(width, "below"),
      ],
      invalidate() {},
      handleInput() {},
      getText: () => "\nsecond line",
      setText() {},
    };
    const editor = new WrappedPolishedEditor(
      base as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    );
    const lines = editor.render(40);
    expect(lines[1]).toMatch(/^│\s+│$/);
    expect(lines.join("\n")).toContain(inverseCursor);
    expect(lines.join("\n")).toContain("second line");

    const empty = new WrappedPolishedEditor(
      {
        render: (width: number) => [
          nativeBorder(width, "above"),
          nativeBorder(width, "below"),
        ],
        invalidate() {},
        handleInput() {},
        getText: () => "",
        setText() {},
      } as never,
      theme(),
      () => withEditorStyle(config(), "minimalist"),
      () => ({ modelLabel: "model", providerLabel: "provider" }),
      () => "off",
      () => ({ cwd: "/tmp" }),
    ).render(40);
    expect(empty).toHaveLength(2);
    expect(empty[0]).toMatch(/^╭.*╮$/);
    expect(empty[1]).toMatch(/^╰.*╯$/);
  });
});
