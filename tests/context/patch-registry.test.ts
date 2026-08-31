import { expect, test } from "vitest";

import {
  PatchRegistry,
  patchRegistry,
} from "../../extensions/tools/patch-keys.ts";

test("dispose only deletes when still owned; ensure initializes once", () => {
  const registry = new PatchRegistry({});
  const key = Symbol("dispose");
  const stale = { id: "stale" };
  const current = { id: "current" };

  registry.install(key, stale);
  registry.install(key, current);
  expect(registry.dispose(key, stale)).toBe(false);
  expect(registry.get(key)).toBe(current);
  expect(registry.dispose(key, current)).toBe(true);
  expect(registry.get(key)).toBe(undefined);

  const ensureKey = Symbol("ensure");
  let inits = 0;
  const first = registry.ensure(ensureKey, () => {
    inits++;
    return { value: inits };
  });
  expect(registry.ensure(ensureKey, () => ({ value: 99 }))).toBe(first);
  expect(inits).toBe(1);
});

test("singleton storage is globalThis", () => {
  const key = Symbol.for("pi.ccstyle.test.patch-registry");
  try {
    patchRegistry.install(key, { tag: "via-registry" });
    expect((globalThis as Record<PropertyKey, { tag: string }>)[key].tag).toBe(
      "via-registry",
    );
    (globalThis as Record<PropertyKey, unknown>)[key] = {
      tag: "via-globalThis",
    };
    expect(patchRegistry.get<{ tag: string }>(key)?.tag).toBe("via-globalThis");
  } finally {
    patchRegistry.delete(key);
  }
});
