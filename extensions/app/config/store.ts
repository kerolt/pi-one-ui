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
};

/** Returns the canonical configuration location for an agent directory. */
export function configPaths(agentDir = getAgentDir()): ConfigStorePaths {
  return {
    canonical: join(agentDir, "pi-one-ui.json"),
  };
}

export const defaultConfigPaths = configPaths();
export const configPath = defaultConfigPaths.canonical;

export type ConfigFileState =
  | { kind: "missing"; record: ConfigRecord; writePath: string }
  | { kind: "valid"; record: ConfigRecord; writePath: string; mode: number }
  | { kind: "corrupt"; error: unknown };

/**
 * Extracts a Node filesystem error code without depending on an error class.
 */
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

/**
 * Reads one config file, resolving symlink targets without replacing the link.
 */
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

/**
 * Writes JSON through a temporary file and atomic rename.
 */
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

/**
 * Builds a stable read error while preserving the underlying failure detail.
 */
function configReadError(path: string, error: unknown): Error {
  const detail = error instanceof Error ? ` (${error.message})` : "";
  return new Error(
    `Unable to read pi-one-ui config because ${path} is corrupt or unreadable${detail}`,
  );
}

/**
 * Builds the safety error used when a config write is unsafe.
 */
function configWriteError(path: string, label: string, error: unknown): Error {
  const detail = error instanceof Error ? ` (${error.message})` : "";
  return new Error(
    `Refusing to save ${label} config because ${path} is corrupt or unreadable; fix or remove it first.${detail}`,
  );
}

/** Reads the raw canonical record used by every configuration domain. */
export function readUnifiedConfigRecord(
  paths: ConfigStorePaths = defaultConfigPaths,
): ConfigRecord {
  const state = readConfigFileState(paths.canonical);
  if (state.kind === "missing") return {};
  if (state.kind === "corrupt")
    throw configReadError(paths.canonical, state.error);
  return state.record;
}

/**
 * Mutates one explicitly selected file while preserving its safety semantics.
 */
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
 * selectors; this module owns canonical persistence.
 */
export class ConfigStore {
  readonly paths: ConfigStorePaths;
  private readonly listeners = new Set<ConfigStoreListener>();

  /** Creates a store for the canonical path. */
  constructor(paths: ConfigStorePaths = defaultConfigPaths) {
    this.paths = paths;
  }

  /** Reads the current canonical raw configuration record. */
  read(): ConfigRecord {
    return readUnifiedConfigRecord(this.paths);
  }

  /**
   * Mutates and atomically persists the active raw configuration record.
   */
  update(mutate: (record: ConfigRecord) => void): ConfigRecord {
    const state = readConfigFileState(this.paths.canonical);
    if (state.kind === "corrupt")
      throw configReadError(this.paths.canonical, state.error);

    mutate(state.record);
    writeConfigAtomically(
      state.writePath,
      state.record,
      state.kind === "valid" ? state.mode : undefined,
    );
    for (const listener of this.listeners) listener(state.record);
    return state.record;
  }

  /**
   * Subscribes to successful updates and returns an idempotent unsubscribe function.
   */
  subscribe(listener: ConfigStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const configStore = new ConfigStore();
