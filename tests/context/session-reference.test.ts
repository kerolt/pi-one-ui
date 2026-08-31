import { Buffer } from "node:buffer";
import { expect, test } from "vitest";
import {
  buildReferenceContent,
  extractSessionReferenceIds,
  SESSION_REFERENCE_CUSTOM_TYPE,
  sessionTitle,
  truncateUtf8,
} from "../../extensions/features/session-reference/session.ts";

const info = {
  id: "019f78f7-526e-78ac-afa5-ff6d5e06beb8",
  cwd: "/repo",
  firstMessage: "  Refactor\n\tthe auth module  ",
  messageCount: 2,
  modified: new Date("2025-01-02T03:04:05.000Z"),
};

test("extractSessionReferenceIds finds boundary-delimited references and deduplicates them", () => {
  expect(
    extractSessionReferenceIds(
      "Use @session:abc-123 and\n@session:def_456.v2, then @session:abc-123. Ignore x@session:nope.",
    ),
  ).toStrictEqual(["abc-123", "def_456.v2"]);
});

test("extractSessionReferenceIds accepts bracketed names and keeps legacy ids working", () => {
  expect(
    extractSessionReferenceIds(
      "Review @session:[Release plan] and @session:[T-42] plus legacy @session:abc-123",
    ),
  ).toStrictEqual(["Release plan", "T-42", "abc-123"]);
});

test("sessionTitle normalizes and truncates display text", () => {
  expect(sessionTitle(info)).toBe("Refactor the auth module");
  expect(sessionTitle({ ...info, name: "Named session" })).toBe(
    "Named session",
  );
  expect(sessionTitle({ ...info, name: "123456789" }, 6)).toBe("12345…");
});

test("truncateUtf8 enforces byte limits for multibyte content", () => {
  const result = truncateUtf8("你".repeat(1_000), 100);
  expect(Buffer.byteLength(result, "utf8") <= 100).toBeTruthy();
  expect(result).toMatch(/truncated/);
});

test("buildReferenceContent formats active context and drops nested references", () => {
  const content = buildReferenceContent([
    {
      info,
      messages: [
        { role: "user", content: "Implement it" },
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
        {
          role: "custom",
          customType: SESSION_REFERENCE_CUSTOM_TYPE,
          content: "nested prior reference",
        },
      ],
    },
  ]);

  expect(content).toMatch(/Referenced Pi sessions/);
  expect(content).toMatch(/User: Implement it/);
  expect(content).toMatch(/Assistant: Done/);
  expect(content).not.toMatch(/nested prior reference/);
});

test("buildReferenceContent enforces incremental session and total byte limits", () => {
  const messages = Array.from({ length: 1_000 }, (_, index) => ({
    role: "user",
    content: `${index}: ${"x".repeat(1_000)}`,
  }));
  const content = buildReferenceContent([{ info, messages }], {
    maxMessageBytes: 400,
    maxSessionBytes: 2_000,
    maxTotalBytes: 1_000,
  });
  expect(Buffer.byteLength(content, "utf8") <= 1_000).toBeTruthy();
  expect(content).toMatch(/truncated/);
});
