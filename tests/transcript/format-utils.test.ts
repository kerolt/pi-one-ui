import { expect, test } from "vitest";
import { oneLine } from "../../extensions/tools/format.ts";

test("oneLine: 默认 max=96，超长截断加省略号", () => {
  const long = "x".repeat(120);
  const out = oneLine(long);
  expect(out.length).toBe(96);
  expect(out.endsWith("…")).toBe(true);
  expect(out).toBe(`${"x".repeat(95)}…`);
});

test("oneLine: 显式 max 覆盖默认；空白折叠为单行", () => {
  expect(oneLine("a\n\tb  c", 10)).toBe("a b c");
  expect(oneLine("hello world", 8)).toBe("hello w…");
  expect(oneLine(null)).toBe("");
  expect(oneLine(undefined)).toBe("");
});

test("oneLine: sanitize 上限 4096，避免扫超大输入", () => {
  // 超过 4096 的前缀被截断后再折叠；结果长度仍受 max 约束
  const huge = `${"y".repeat(5000)}\nmore`;
  const out = oneLine(huge, 20);
  expect(out.length).toBe(20);
  expect(out.startsWith("y")).toBe(true);
});
