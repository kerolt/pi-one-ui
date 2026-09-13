import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { normalizeConfig } from "../../extensions/app/config/renderer.ts";
import {
  defaultConfig,
  mergeConfig,
  saveEditorComponentPatch,
  saveMinimalistEditorStylePatch,
} from "../../extensions/app/config/shell.ts";
import { ConfigStore } from "../../extensions/app/config/store.ts";

test("renderer config keeps the unified package defaults", () => {
  const config = normalizeConfig({});
  expect(config.mode).toBe("on");
  expect(config.diffViewMode).toBe("auto");
  expect(config.enableEffortCommand).toBe(true);
});

test("renderer config ignores removed legacy field aliases", () => {
  const config = normalizeConfig({
    enabled: false,
    diffCollapsedLines: 12,
  });
  expect(config.mode).toBe("on");
  expect(config.editDiffCollapsedLines).toBe(24);
});

test("Editor keeps the working directory visible by default", () => {
  expect(defaultConfig.components.editor.styles.minimalist.showCwd).toBe(true);
  expect(mergeConfig({}).components.editor.styles.minimalist.showCwd).toBe(
    true,
  );
});

test.each([true, false])(
  "Editor accepts showCwd=%s independently of Footer",
  (showCwd) => {
    const config = mergeConfig({
      components: {
        editor: { styles: { minimalist: { showCwd, pathDisplay: "full" } } },
        footer: { styles: { starship: { segments: { cwd: true } } } },
      },
    });
    expect(config.components.editor.styles.minimalist).toMatchObject({
      showCwd,
      pathDisplay: "full",
      showGit: true,
    });
    expect(config.components.footer.styles.starship.segments.cwd).toBe(true);
  },
);

test.each([
  ["missing", undefined],
  ["null", null],
  ["string", "false"],
  ["number", 0],
  ["array", []],
  ["object", {}],
] as const)(
  "Editor falls back to a visible directory for a %s showCwd value",
  (_label, showCwd) => {
    const config = mergeConfig({
      components: {
        editor: { styles: { minimalist: { showCwd, pathDisplay: "project" } } },
      },
    });
    // Invalid values must not hide the path or reset its existing display format.
    expect(config.components.editor.styles.minimalist).toMatchObject({
      showCwd: true,
      pathDisplay: "project",
    });
  },
);

test("Editor persists showCwd without resetting path format or sibling settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-editor-config-"));
  const path = join(dir, "pi-one-ui.json");
  const store = new ConfigStore({ canonical: path });
  const initial = {
    version: 1,
    keep: "user setting",
    components: {
      editor: {
        styles: {
          minimalist: {
            pathDisplay: "project",
            showGit: false,
            futureSetting: "keep",
          },
        },
      },
      footer: { styles: { starship: { segments: { cwd: true } } } },
    },
  };
  try {
    writeFileSync(path, JSON.stringify(initial));
    const saved = saveMinimalistEditorStylePatch({ showCwd: false }, path);
    expect(saved.components.editor.styles.minimalist.showCwd).toBe(false);
    expect(store.read()).toMatchObject({
      ...initial,
      components: {
        ...initial.components,
        editor: {
          styles: {
            minimalist: {
              ...initial.components.editor.styles.minimalist,
              showCwd: false,
            },
          },
        },
      },
    });

    // Other Editor changes must preserve the persisted visibility choice on reload.
    saveEditorComponentPatch({ borderColorMode: "adaptive" }, path);
    saveMinimalistEditorStylePatch({ pathDisplay: "full" }, path);
    const reloaded = mergeConfig(store.read());
    expect(reloaded.components.editor.styles.minimalist).toMatchObject({
      showCwd: false,
      pathDisplay: "full",
      showGit: false,
    });
    expect(reloaded.components.footer).toEqual(
      mergeConfig(initial).components.footer,
    );

    // Showing the directory again retains the last selected path format.
    saveMinimalistEditorStylePatch({ showCwd: true }, path);
    expect(
      mergeConfig(store.read()).components.editor.styles.minimalist,
    ).toMatchObject({
      showCwd: true,
      pathDisplay: "full",
      showGit: false,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
