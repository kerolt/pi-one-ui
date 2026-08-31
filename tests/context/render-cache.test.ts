import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import {
  ExpandedToolIoView,
  ExpandedToolResultText,
  formatToolInputArgs,
  SHOW_MORE_LABEL,
} from "../../extensions/layouts/context/renderer/index.ts";
import { textFromResult } from "../../extensions/layouts/context/renderer/tool/result.ts";

function expectedExpandedLines(
  text: string,
  prefix: string,
  width: number,
): string[] {
  const normalized = text.replace(/\t/g, "   ").replace(/\n+$/, "");
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  return wrapTextWithAnsi(normalized, contentWidth).map((line) =>
    truncateToWidth(prefix + line, width, ""),
  );
}

test("ExpandedToolResultText preserves lines while caching one width", () => {
  const text = "\x1b[31mfirst\tline with enough content to wrap\nsecond\n\n";
  const prefix = "\x1b[31m  │ \x1b[0m";
  const component = new ExpandedToolResultText(text, prefix);

  const wide = component.render(24);
  expect(wide).toStrictEqual(expectedExpandedLines(text, prefix, 24));
  expect(component.render(24)).toBe(wide);

  const narrow = component.render(12);
  expect(narrow).toStrictEqual(expectedExpandedLines(text, prefix, 12));
  expect(narrow).not.toBe(wide);

  const wideAgain = component.render(24);
  expect(wideAgain).toStrictEqual(expectedExpandedLines(text, prefix, 24));
  expect(wideAgain, "only the most recent width is cached").not.toBe(wide);

  component.invalidate();
  const afterInvalidate = component.render(24);
  expect(afterInvalidate).toStrictEqual(
    expectedExpandedLines(text, prefix, 24),
  );
  expect(afterInvalidate).not.toBe(wideAgain);

  const changedText = "updated\tcontent\n";
  component.setText(changedText);
  expect(component.render(24)).toStrictEqual(
    expectedExpandedLines(changedText, prefix, 24),
  );
});

test("formatToolInputArgs pretty-prints object fields and multiline values", () => {
  expect(formatToolInputArgs(null)).toBe("");
  expect(formatToolInputArgs({ path: "a.ts", limit: 10 })).toBe(
    "path: a.ts\nlimit: 10",
  );
  expect(formatToolInputArgs({ command: "echo hi\necho bye" })).toBe(
    "command:\n  echo hi\n  echo bye",
  );
  expect(formatToolInputArgs({ nested: { a: 1 } })).toMatch(/nested:/);
});

test("collapsed result text does not inspect unused custom details", () => {
  let detailsReads = 0;
  const result = {
    content: [{ type: "text", text: "visible summary" }],
  } as {
    content: Array<{ type: string; text: string }>;
    details?: unknown;
  };
  Object.defineProperty(result, "details", {
    get() {
      detailsReads++;
      return { messages: Array.from({ length: 5000 }, () => "hidden") };
    },
  });

  expect(textFromResult(result, false)).toBe("visible summary");
  expect(detailsReads).toBe(0);
  expect(textFromResult(result, true)).toContain("Details:");
  expect(detailsReads).toBe(1);
});

test("expanded result details bound large arrays before sanitizing", () => {
  const text = textFromResult(
    {
      content: [],
      details: {
        messages: Array.from({ length: 5000 }, (_, index) => ({
          index,
          content: `message-${index}`,
        })),
      },
    },
    true,
  );

  expect(text).toMatch(/\.\.\. \d+ more items/);
  expect(text).not.toContain("message-4999");
  expect(text.length).toBeLessThanOrEqual(16_384);
});

test("expanded result details bound wide objects without invoking getters", () => {
  let getterReads = 0;
  const details: Record<string, unknown> = {};
  Object.defineProperty(details, "computed", {
    enumerable: true,
    get() {
      getterReads++;
      return "should not run";
    },
  });
  for (let index = 0; index < 5000; index++) {
    details[`property-${index}`] = `value-${index}`;
  }

  const text = textFromResult({ content: [], details }, true);

  expect(getterReads).toBe(0);
  expect(text).toContain("[Getter]");
  expect(text).toContain("... more properties");
  expect(text).not.toContain("property-4999");
  expect(text.length).toBeLessThanOrEqual(16_384);
});

test("ExpandedToolIoView labels Input and Output sections", () => {
  const styled: Array<[string, string]> = [];
  const theme = {
    fg(color: string, text: string) {
      styled.push([color, text]);
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
  const view = new ExpandedToolIoView(
    theme,
    "path: src/a.ts",
    "line one\nline two",
    false,
    4000,
  );
  const lines = view
    .render(60)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  expect(lines.some((line) => /^ ├ Input/.test(line))).toBeTruthy();
  expect(lines.some((line) => /^ └ Output/.test(line))).toBeTruthy();
  expect(lines.some((line) => line.includes("path: src/a.ts"))).toBeTruthy();
  expect(
    styled.some(([color, text]) => color === "muted" && text === "src/a.ts"),
  ).toBeTruthy();
  expect(
    !styled.some(([color, text]) => color === "text" && text === "src/a.ts"),
  ).toBeTruthy();
  expect(lines.some((line) => line.includes("line one"))).toBeTruthy();
  expect(lines.some((line) => line.includes("line two"))).toBeTruthy();
  expect(
    lines
      .filter((line) => line.includes("line one") || line.includes("line two"))
      .every((line) => !line.includes("│")),
    "output body stops the inner tree rail",
  ).toBeTruthy();
  // Tree rail between sections.
  expect(lines.some((line) => line.trim() === "│")).toBeTruthy();
  // Short bodies stay fully visible — no show-more affordance.
  expect(!lines.some((line) => line.includes(SHOW_MORE_LABEL))).toBeTruthy();

  // Reuse path updates content without changing identity.
  view.setContent("path: b.ts", "only", false, 4000);
  const updated = view
    .render(60)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  expect(updated.some((line) => line.includes("path: b.ts"))).toBeTruthy();
  expect(updated.some((line) => line.includes("only"))).toBeTruthy();
  expect(!updated.some((line) => line.includes("line one"))).toBeTruthy();
});

test("ExpandedToolIoView wraps Input/Output at 80% of the viewport", () => {
  const theme = {
    fg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
  const body = "x".repeat(79);
  const view = new ExpandedToolIoView(
    theme,
    `command: ${body}`,
    body,
    false,
    1,
    1,
  );
  const lines = view.render(100);
  expect(lines.every((line) => visibleWidth(line) <= 80)).toBeTruthy();
  expect(
    lines.find((line) => line.includes("Input"))?.includes(SHOW_MORE_LABEL),
  ).toBeTruthy();
  expect(
    lines.find((line) => line.includes("Output"))?.includes(SHOW_MORE_LABEL),
  ).toBeTruthy();
});

test("ExpandedToolIoView shows click to show more when Input/Output exceed the line cap", () => {
  const theme = {
    fg(color: string, text: string) {
      if (color === "text") return `\x1b[37m${text}\x1b[39m`;
      if (color === "dim") return `\x1b[90m${text}\x1b[39m`;
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
  const longOutput = Array.from({ length: 20 }, (_, i) => `out line ${i}`).join(
    "\n",
  );
  const longInput = Array.from(
    { length: 20 },
    (_, i) => `field${i}: value${i}`,
  ).join("\n");
  const view = new ExpandedToolIoView(
    theme,
    longInput,
    longOutput,
    false,
    5,
    5,
  );
  const rawLines = view.render(80);
  const lines = rawLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const inputHeader = lines.find((line) => line.includes("Input"));
  const outputHeader = lines.find((line) => line.includes("Output"));
  expect(
    inputHeader?.includes(SHOW_MORE_LABEL),
    "Input header shows show more",
  ).toBeTruthy();
  expect(
    outputHeader?.includes(SHOW_MORE_LABEL),
    "Output header shows show more",
  ).toBeTruthy();
  expect(view.matchShowMoreLine(inputHeader!)).toBe("input");
  expect(view.matchShowMoreLine(outputHeader!)).toBe("output");
  expect(
    lines.some(
      (line) => /\+15 more lines/.test(line) || /\+\d+ more lines/.test(line),
    ),
  ).toBeTruthy();
  view.setHoveredSection("input");
  const hoveredInput = view.render(80).find((line) => line.includes("Input"));
  const hoveredOutput = view.render(80).find((line) => line.includes("Output"));
  expect(
    hoveredInput?.includes(
      `\x1b[90m •\x1b[39m\x1b[37m click to show more\x1b[39m`,
    ),
    "hover keeps the bullet dim and highlights only the text",
  ).toBeTruthy();
  expect(
    hoveredOutput?.includes(
      `\x1b[90m •\x1b[39m\x1b[90m click to show more\x1b[39m`,
    ),
  ).toBeTruthy();
});

test("ExpandedToolIoView records exact show-more header rows, not body text", () => {
  const theme = {
    fg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  };
  // Body text that would false-positive a whole-buffer Input/show-more scan.
  const decoy = `note Input ${SHOW_MORE_LABEL}\n${Array.from({ length: 12 }, (_, i) => `out ${i}`).join("\n")}`;
  const view = new ExpandedToolIoView(theme, "", decoy, false, 3, 3);
  const lines = view.render(80);
  const headers = view.showMoreHeaderLineIndexes();
  expect(headers).toStrictEqual([{ section: "output", line: 0 }]);
  const decoyRow = lines.findIndex(
    (line, index) =>
      index > 0 && line.includes("Input") && line.includes(SHOW_MORE_LABEL),
  );
  expect(decoyRow > 0, "body still paints the decoy text").toBeTruthy();
  expect(!headers.some((h) => h.line === decoyRow)).toBeTruthy();
});
