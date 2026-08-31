import { expect, test } from "vitest";
import { shouldHighlightCodeBlock } from "../../extensions/layouts/context/renderer/tool/diff/diff-renderer.ts";
import {
  MAX_HL_CHARS,
  ShikiHighlightCache,
} from "../../extensions/layouts/context/renderer/tool/diff/shiki-highlight.ts";
import { sanitizeToolResultText } from "../../extensions/tools/tool-result-sanitize.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("Shiki cache deduplicates pending work, caches success, and isolates themes", async () => {
  let loads = 0;
  let highlights = 0;
  const cache = new ShikiHighlightCache(async () => {
    loads++;
    return async (code, _lang, theme) => {
      highlights++;
      return `${theme}:${code}`;
    };
  });
  let invalidations = 0;
  expect(
    cache.get(
      "const x = 1",
      "ts",
      "github-dark",
      ["fallback"],
      () => invalidations++,
    ),
  ).toBe(undefined);
  expect(
    cache.get(
      "const x = 1",
      "ts",
      "github-dark",
      ["fallback"],
      () => invalidations++,
    ),
  ).toBe(undefined);
  await settle();
  expect(loads).toBe(1);
  expect(highlights).toBe(1);
  expect(
    cache.get("const x = 1", "ts", "github-dark", ["fallback"]),
  ).toStrictEqual(["github-dark:const x = 1"]);
  expect(
    invalidations,
    "every component awaiting the shared block repaints",
  ).toBe(2);
  expect(cache.get("const x = 1", "ts", "github-light", ["fallback"])).toBe(
    undefined,
  );
  await settle();
  expect(highlights).toBe(2);
});

test("terminal controls are removed before source highlighting", () => {
  expect(
    sanitizeToolResultText(
      "safe\x1b]52;c;SGVsbG8=\x07mid\x1bP1;2|payload\x1b\\end\x1b[31m",
    ),
  ).toBe("safemidend");
  expect(
    sanitizeToolResultText(
      "a\x9d52;c;C1_OSC\x9cb\x90C1_DCS\x9cc\x1b]52;c;ESC_OSC\x9cd\x1bPESC_DCS\x9ce",
    ),
  ).toBe("abcde");
});

test("Shiki failures degrade without caching, retry, and oversized blocks are skipped", async () => {
  let attempts = 0;
  const cache = new ShikiHighlightCache(async () => async (code) => {
    attempts++;
    if (attempts === 1) throw new Error("temporary");
    return `ok:${code}`;
  });
  expect(cache.get("x", "ts", "github-dark", ["x"])).toBe(undefined);
  await settle();
  expect(
    cache.get("x", "ts", "github-dark", ["x"]),
    "failed work is retryable",
  ).toBe(undefined);
  await settle();
  expect(cache.get("x", "ts", "github-dark", ["x"])).toStrictEqual(["ok:x"]);
  expect(attempts).toBe(2);
  const oversized = "x".repeat(MAX_HL_CHARS + 1);
  expect(cache.get(oversized, "ts", "github-dark", ["fallback"])).toBe(
    undefined,
  );
  expect(shouldHighlightCodeBlock("x".repeat(MAX_HL_CHARS))).toBe(true);
  expect(
    shouldHighlightCodeBlock(oversized),
    "sync highlighting is also skipped",
  ).toBe(false);
  await settle();
  expect(attempts).toBe(2);
});
