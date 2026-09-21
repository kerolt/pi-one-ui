import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ConfigStore } from "../../extensions/app/config/store.ts";
import {
  SettingsController,
  type SettingsSnapshot,
} from "../../extensions/app/settings/controller.ts";

function settings() {
  const directory = mkdtempSync(join(tmpdir(), "one-ui-settings-"));
  const path = join(directory, "pi-one-ui.json");
  const store = new ConfigStore({ canonical: path });
  return {
    path,
    store,
    controller: new SettingsController(store),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test.each(["balanced", "compact", "native"])(
  "Preset %s publishes one complete configuration",
  (preset) => {
    const fixture = settings();
    try {
      fixture.store.update((record) => {
        record.keep = { user: true };
        record.components = {
          editor: { styles: { minimalist: { showCwd: false } } },
          footer: { styles: { starship: { format: "$cwd" } } },
        };
        record.renderer = { previewLines: 10, future: "keep" };
      });
      const updates: SettingsSnapshot[] = [];
      const unsubscribe = fixture.controller.subscribe((snapshot) =>
        updates.push(snapshot),
      );
      fixture.controller.update(`preset:${preset}`, "apply");
      unsubscribe();
      expect(updates).toHaveLength(1);
      const snapshot = fixture.controller.snapshot();
      expect(updates[0]).toEqual(snapshot);
      const enabled = preset !== "native";
      expect(snapshot.shell.components.editor.style).toBe(
        enabled ? "on" : "off",
      );
      expect(snapshot.shell.components.userMessages.enabled).toBe(enabled);
      expect(snapshot.shell.components.workingLine.enabled).toBe(enabled);
      expect(snapshot.shell.components.footer.style).toBe(
        enabled ? "starship" : "native",
      );
      expect(snapshot.renderer.mode).toBe(
        preset === "compact" ? "compact" : enabled ? "on" : "off",
      );
      expect(snapshot.shell.components.editor.styles.minimalist.showCwd).toBe(
        false,
      );
      expect(snapshot.shell.components.footer.styles.starship.format).toBe(
        "$cwd",
      );
      expect(snapshot.renderer.previewLines).toBe(10);
      expect(fixture.store.read()).toMatchObject({
        keep: { user: true },
        renderer: { future: "keep" },
      });
    } finally {
      fixture.dispose();
    }
  },
);

test("Invalid settings preserve the file and publish no update", () => {
  const fixture = settings();
  try {
    fixture.controller.update("editorStyle", "on");
    const before = readFileSync(fixture.path, "utf8");
    const updates: SettingsSnapshot[] = [];
    fixture.controller.subscribe((snapshot) => updates.push(snapshot));
    expect(() => fixture.controller.update("editorStyle", "invalid")).toThrow(
      "Invalid setting value",
    );
    expect(() => fixture.controller.update("unknown", "on")).toThrow(
      "Unknown setting",
    );
    expect(readFileSync(fixture.path, "utf8")).toBe(before);
    expect(updates).toEqual([]);
  } finally {
    fixture.dispose();
  }
});

test("Unreadable JSON prevents a settings update without publishing", () => {
  const fixture = settings();
  try {
    writeFileSync(fixture.path, "{ invalid\n");
    const updates: SettingsSnapshot[] = [];
    fixture.controller.subscribe((snapshot) => updates.push(snapshot));
    expect(() => fixture.controller.update("footerStyle", "hidden")).toThrow(
      /corrupt/,
    );
    expect(readFileSync(fixture.path, "utf8")).toBe("{ invalid\n");
    expect(updates).toEqual([]);
  } finally {
    fixture.dispose();
  }
});

test("Component and renderer settings preserve sibling values", () => {
  const fixture = settings();
  try {
    fixture.controller.update("editorStyle", "off");
    fixture.controller.update("editorBorderColorMode", "adaptive");
    fixture.controller.update("workingLineSpinner", "pulse");
    fixture.controller.update("userMessagesStyle", "compact");
    fixture.controller.update("diffViewMode", "split");
    fixture.controller.update("thinkingPreviewLines", "10");
    fixture.controller.update("enableAliases", "off");
    expect(fixture.controller.snapshot()).toMatchObject({
      shell: {
        components: {
          editor: { style: "off", borderColorMode: "adaptive" },
          workingLine: { spinner: "pulse" },
          userMessages: { style: "compact" },
        },
      },
      renderer: {
        diffViewMode: "split",
        previewLines: 10,
        enableAliases: false,
      },
    });
  } finally {
    fixture.dispose();
  }
});
