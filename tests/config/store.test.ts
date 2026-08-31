import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ConfigStore,
  type ConfigStorePaths,
} from "../../extensions/app/config/store.ts";

/** Creates an isolated canonical path for a store test. */
function makePaths(): { dir: string; paths: ConfigStorePaths } {
  const dir = mkdtempSync(join(tmpdir(), "pi-one-ui-config-store-"));
  return {
    dir,
    paths: {
      canonical: join(dir, "pi-one-ui.json"),
    },
  };
}

/** Reads a JSON object from a test configuration path. */
function readRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Lists temporary files that would indicate an incomplete atomic write. */
function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

test("ConfigStore returns defaults without materializing a missing canonical file", () => {
  const { dir, paths } = makePaths();
  try {
    const record = new ConfigStore(paths).read();

    expect(record).toStrictEqual({});
    expect(existsSync(paths.canonical)).toBe(false);
    expect(tempFiles(dir)).toStrictEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore ignores historical config filenames", () => {
  const { dir, paths } = makePaths();
  try {
    writeFileSync(join(dir, "pi-mine-ui.json"), JSON.stringify({ old: true }));
    writeFileSync(join(dir, "zentui.json"), JSON.stringify({ old: true }));
    writeFileSync(
      join(dir, "claude-code-style.json"),
      JSON.stringify({ old: true }),
    );

    const record = new ConfigStore(paths).read();

    expect(record).toStrictEqual({});
    expect(existsSync(paths.canonical)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ConfigStore updates the canonical record and notifies subscribers", () => {
  const { dir, paths } = makePaths();
  try {
    writeFileSync(paths.canonical, JSON.stringify({ version: 1, keep: true }));
    const store = new ConfigStore(paths);
    const updates: Record<string, unknown>[] = [];
    const unsubscribe = store.subscribe((record) => updates.push(record));

    const updated = store.update((record) => {
      record.mode = "compact";
    });
    unsubscribe();

    expect(updated).toStrictEqual({ version: 1, keep: true, mode: "compact" });
    expect(readRecord(paths.canonical)).toStrictEqual(updated);
    expect(updates.length).toBe(1);
    expect(updates[0]).toStrictEqual(updated);
    expect(tempFiles(dir)).toStrictEqual([]);
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

    expect(() => store.update((record) => (record.mode = "off"))).toThrow(
      /Unable to read pi-one-ui config.*corrupt/,
    );
    expect(readFileSync(paths.canonical, "utf8")).toBe(corrupt);
    expect(tempFiles(dir)).toStrictEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
