import type { ConfigRecord } from "./store.ts";

export function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function recordValue(value: unknown): ConfigRecord {
  return isRecord(value) ? value : {};
}

export function booleanValue(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

/** 更新已知字段，同时保留配置中其他字段及其属性名称。 */
export function overlayKnown(raw: unknown, known: unknown): unknown {
  if (known === undefined) {
    return raw;
  }
  if (!isRecord(known)) {
    return known;
  }
  const output: ConfigRecord = { ...recordValue(raw) };
  for (const [key, value] of Object.entries(known)) {
    Object.defineProperty(output, key, {
      value: overlayKnown(output[key], value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}
