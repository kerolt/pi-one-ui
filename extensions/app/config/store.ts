import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ConfigRecord = Record<string, unknown>;

export type ConfigStorePaths = {
  canonical: string;
  legacyUnified: string;
  legacyShell: string;
  legacyRenderer: string;
};

export function configPaths(agentDir = getAgentDir()): ConfigStorePaths {
  return {
    canonical: join(agentDir, "pi-one-ui.json"),
    legacyUnified: join(agentDir, "pi-mine-ui.json"),
    legacyShell: join(agentDir, "zentui.json"),
    legacyRenderer: join(agentDir, "claude-code-style.json"),
  };
}

export const defaultConfigPaths = configPaths();
export const configPath = defaultConfigPaths.canonical;

export type ConfigFileState =
  | { kind: "missing"; record: ConfigRecord; writePath: string }
  | { kind: "valid"; record: ConfigRecord; writePath: string; mode: number }
  | { kind: "corrupt"; error: unknown };

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

export function readConfigFileState(path: string): ConfigFileState {
  let writePath = path;
  try {
    const pathStat = lstatSync(path);
    if (pathStat.isSymbolicLink()) writePath = realpathSync(path);
    const targetStat = statSync(writePath);
    const parsed = JSON.parse(readFileSync(writePath, "utf8"));
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? {
          kind: "valid",
          record: parsed as ConfigRecord,
          writePath,
          mode: targetStat.mode & 0o7777,
        }
      : {
          kind: "corrupt",
          error: new Error("top-level value must be a JSON object"),
        };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      try {
        lstatSync(path);
      } catch (pathError) {
        if (errorCode(pathError) === "ENOENT")
          return { kind: "missing", record: {}, writePath: path };
      }
    }
    return { kind: "corrupt", error };
  }
}

export function writeConfigAtomically(
  path: string,
  record: ConfigRecord,
  mode?: number,
): void {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let file: number | undefined;
  try {
    file = openSync(tempPath, "wx", mode ?? 0o666);
    if (mode !== undefined) fchmodSync(file, mode);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(file);
    closeSync(file);
    file = undefined;
    renameSync(tempPath, path);
  } catch (error) {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {}
    }
    try {
      unlinkSync(tempPath);
    } catch (cleanupError) {
      if (errorCode(cleanupError) !== "ENOENT") {
        // Preserve the persistence failure; the best-effort cleanup error is secondary.
      }
    }
    throw error;
  }
}

function configReadError(path: string, error: unknown): Error {
  const detail = error instanceof Error ? ` (${error.message})` : "";
  return new Error(
    `Unable to read pi-one-ui config because ${path} is corrupt or unreadable${detail}`,
  );
}

function configWriteError(path: string, label: string, error: unknown): Error {
  const detail = error instanceof Error ? ` (${error.message})` : "";
  return new Error(
    `Refusing to save ${label} config because ${path} is corrupt or unreadable; fix or remove it first.${detail}`,
  );
}

type SelectedConfig = {
  record: ConfigRecord;
  writePath: string;
  mode?: number;
  materialize: boolean;
};

function optionalConfig(
  path: string,
): { record: ConfigRecord; writePath: string; mode: number } | undefined {
  const state = readConfigFileState(path);
  if (state.kind === "missing") return undefined;
  if (state.kind === "corrupt") throw configReadError(path, state.error);
  return state;
}

function selectUnifiedConfig(paths: ConfigStorePaths): SelectedConfig {
  const canonical = optionalConfig(paths.canonical);
  if (canonical) return { ...canonical, materialize: false };

  const legacyUnified = optionalConfig(paths.legacyUnified);
  if (legacyUnified)
    return {
      ...legacyUnified,
      writePath: paths.canonical,
      materialize: true,
    };

  const shell = optionalConfig(paths.legacyShell);
  const renderer = optionalConfig(paths.legacyRenderer);
  if (!shell && !renderer) {
    return {
      record: {},
      writePath: paths.canonical,
      materialize: false,
    };
  }

  return {
    record: {
      ...(shell?.record ?? {}),
      version: 1,
      renderer: renderer?.record ?? {},
    },
    writePath: paths.canonical,
    mode: shell?.mode ?? renderer?.mode,
    materialize: true,
  };
}

/**
 * Read the one raw unified record used by all configuration domains.
 * Legacy sources are best-effort materialized through the same atomic writer;
 * the in-memory record remains usable if the agent directory is read-only.
 */
export function readUnifiedConfigRecord(
  paths: ConfigStorePaths = defaultConfigPaths,
): ConfigRecord {
  const selected = selectUnifiedConfig(paths);
  if (selected.materialize) {
    try {
      writeConfigAtomically(selected.writePath, selected.record, selected.mode);
    } catch {
      // Keep using the selected legacy record in memory when migration cannot be written.
    }
  }
  return selected.record;
}

/** Mutate one explicitly selected file while preserving its existing safety semantics. */
export function mutateConfigFile(
  path: string,
  mutate: (record: ConfigRecord) => void,
  label = "pi-one-ui",
): ConfigRecord {
  const state = readConfigFileState(path);
  if (state.kind === "corrupt")
    throw configWriteError(path, label, state.error);

  mutate(state.record);
  writeConfigAtomically(
    state.writePath,
    state.record,
    state.kind === "valid" ? state.mode : undefined,
  );
  return state.record;
}

export type ConfigStoreListener = (record: ConfigRecord) => void;

/**
 * Process-wide raw configuration store. Domain config modules own parsing and
 * selectors; this module owns source selection, migration and persistence.
 */
export class ConfigStore {
  readonly paths: ConfigStorePaths;
  private readonly listeners = new Set<ConfigStoreListener>();

  constructor(paths: ConfigStorePaths = defaultConfigPaths) {
    this.paths = paths;
  }

  read(): ConfigRecord {
    return readUnifiedConfigRecord(this.paths);
  }

  update(mutate: (record: ConfigRecord) => void): ConfigRecord {
    const selected = selectUnifiedConfig(this.paths);
    mutate(selected.record);
    writeConfigAtomically(selected.writePath, selected.record, selected.mode);
    for (const listener of this.listeners) listener(selected.record);
    return selected.record;
  }

  subscribe(listener: ConfigStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const configStore = new ConfigStore();
