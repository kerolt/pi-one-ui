import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ConfigStore,
  type ConfigStorePaths,
} from "../extensions/app/config/store.ts";

/**
 * Creates isolated canonical and legacy paths for a store test.
 */
function makePaths(): { dir: string; paths: ConfigStorePaths } {
  const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-store-"));
  return {
    dir,
    paths: {
      canonical: join(dir, "pi-one-ui.json"),
      legacyUnified: join(dir, "pi-mine-ui.json"),
      legacyShell: join(dir, "zentui.json"),
      legacyRenderer: join(dir, "claude-code-style.json"),
    },
  };
}

/**
 * Reads a JSON object from a test configuration path.
 */
function readRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * Lists temporary files that would indicate an incomplete atomic write.
 */
function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

test("ConfigStore merges legacy shell and renderer sources into one canonical file", () => {
  const { dir, paths } = makePaths();
  try {
    writeFileSync(
      paths.legacyShell,
      JSON.stringify({ components: { editor: { enabled: false } } }),
    );
    writeFileSync(
      paths.legacyRenderer,
      JSON.stringify({ mode: "compact", previewLines: 1 }),
    );

    const store = new ConfigStore(paths);
    const record = store.read();

    assert.deepEqual(record, {
      components: { editor: { enabled: false } },
      version: 1,
      renderer: { mode: "compact", previewLines: 1 },
    });
    assert.deepEqual(readRecord(paths.canonical), record);
    assert.equal(existsSync(paths.legacyShell), true);
    assert.equal(existsSync(paths.legacyRenderer), true);
    assert.deepEqual(tempFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore materializes a legacy unified file at the canonical path", () => {
  const { dir, paths } = makePaths();
  try {
    const legacy = { version: 1, components: { footer: { style: "hidden" } } };
    writeFileSync(paths.legacyUnified, `${JSON.stringify(legacy)}\n`);

    const record = new ConfigStore(paths).read();

    assert.deepEqual(record, legacy);
    assert.deepEqual(readRecord(paths.canonical), legacy);
    assert.deepEqual(readRecord(paths.legacyUnified), legacy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore updates the canonical record and notifies subscribers", () => {
  const { dir, paths } = makePaths();
  try {
    writeFileSync(paths.canonical, JSON.stringify({ keep: true }));
    const store = new ConfigStore(paths);
    const updates: Record<string, unknown>[] = [];
    const unsubscribe = store.subscribe((record) => updates.push(record));

    const updated = store.update((record) => {
      record.mode = "compact";
    });
    unsubscribe();

    assert.deepEqual(updated, { keep: true, mode: "compact" });
    assert.deepEqual(readRecord(paths.canonical), updated);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], updated);
    assert.deepEqual(tempFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore refuses a corrupt canonical file without replacing it", () => {
  const { dir, paths } = makePaths();
  try {
    const corrupt = "{ broken\n";
    writeFileSync(paths.canonical, corrupt);
    const store = new ConfigStore(paths);

    assert.throws(
      () => store.update((record) => (record.mode = "off")),
      /Unable to read pi-one-ui config.*corrupt/,
    );
    assert.equal(readFileSync(paths.canonical, "utf8"), corrupt);
    assert.deepEqual(tempFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
