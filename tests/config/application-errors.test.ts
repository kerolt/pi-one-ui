import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  mergeConfig,
  saveEditorComponentPatch,
  saveStarshipFooterStylePatch,
} from "../../extensions/app/config/shell.ts";
import {
  ConfigApplicationError,
  ConfigStore,
} from "../../extensions/app/config/store.ts";
import {
  SettingsController,
  type SettingsSnapshot,
} from "../../extensions/app/settings/controller.ts";

test("A subscriber I/O error reports a committed configuration and still notifies other subscribers", () => {
  const directory = mkdtempSync(join(tmpdir(), "one-ui-apply-error-"));
  const path = join(directory, "pi-one-ui.json");
  const store = new ConfigStore({ canonical: path });
  const settings = new SettingsController(store);
  const snapshots: SettingsSnapshot[] = [];
  try {
    store.subscribe(() => {
      readFileSync(join(directory, "unavailable-resource"));
    });
    settings.subscribe((snapshot) => snapshots.push(snapshot));
    expect(() => settings.update("footerStyle", "hidden")).toThrow(
      ConfigApplicationError,
    );
    expect(mergeConfig(store.read()).components.footer.style).toBe("hidden");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].shell.components.footer.style).toBe("hidden");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Undefined patch fields preserve explicit canonical values", () => {
  const directory = mkdtempSync(join(tmpdir(), "one-ui-partial-config-"));
  const path = join(directory, "pi-one-ui.json");
  try {
    saveEditorComponentPatch({ borderColorMode: "adaptive" }, path);
    saveStarshipFooterStylePatch(
      { separator: "dot", pathDisplay: { depth: 3 } },
      path,
    );
    const config = saveEditorComponentPatch(
      { borderColorMode: undefined },
      path,
    );
    const footer = saveStarshipFooterStylePatch(
      { separator: undefined, pathDisplay: { depth: undefined } },
      path,
    );
    expect(config.components.editor.borderColorMode).toBe("adaptive");
    expect(footer.components.footer.styles.starship.separator).toBe("dot");
    expect(footer.components.footer.styles.starship.pathDisplay.depth).toBe(3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
