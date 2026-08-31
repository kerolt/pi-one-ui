import { expect, test } from "vitest";
import { default as enhance } from "../../extensions/layouts/context/renderer/markdown-enhance.ts";

const transformers: Array<(md: string, ctx?: object) => string> = [];
enhance({
  registerMarkdownTransformer: (fn: (md: string, ctx?: object) => string) =>
    transformers.push(fn),
} as never);
const run = (
  md: string,
  ctx = { messageType: "assistant", isStreaming: false, availableWidth: 100 },
) => transformers.reduce((acc, fn) => fn(acc, ctx), md);

test("mermaid 方言渲染", () => {
  expect(run("```sequenceDiagram\nA->>B: hi\n```").includes("┌")).toBeTruthy();
  expect(run("```stateDiagram-v2\n[*] --> S\n```").includes("╭")).toBeTruthy();
  expect(run("```classDiagram\nclass A\n```").includes("┌")).toBeTruthy();
  expect(run("```mermaid\ngraph LR\nA --> B\n```").includes("┌")).toBeTruthy();
});

test("四反引号围栏", () => {
  expect(
    run("````mermaid\ngraph LR\nA --> B\n````").includes("┌"),
  ).toBeTruthy();
});

test("未闭合 fence 保留原文", () => {
  const out = run("```mermaid\ngraph LR\nA --> B");
  expect(out.includes("```mermaid") && out.includes("A --> B")).toBeTruthy();
});

test("图行硬换行", () => {
  const out = run("```mermaid\ngraph LR\nA --> B\n```");
  const lines = out
    .split("\n")
    .filter((l) => l.startsWith("`┌") || l.includes("┌────"));
  expect(lines.length >= 1, JSON.stringify(out.slice(0, 80))).toBeTruthy();
});

test("宽度不足框装", () => {
  const out = run("```erdiagram\nCUSTOMER ||--o{ ORDER : places\n```", {
    messageType: "assistant",
    isStreaming: false,
    availableWidth: 10,
  });
  expect(out.includes("╭")).toBeTruthy();
});

test("流式跳过", () => {
  const md = "```mermaid\ngraph LR\nA --> B\n```";
  expect(
    run(md, {
      messageType: "assistant",
      isStreaming: true,
      availableWidth: 100,
    }),
  ).toBe(md);
});

test("thinking 块不转换（与官方推荐一致）", () => {
  const md =
    "```mermaid\ngraph LR\nA --> B\n```\n\n> [!NOTE] 提示\n\n看 https://example.com";
  expect(
    run(md, {
      messageType: "assistant-thinking",
      isStreaming: false,
      availableWidth: 100,
    }),
  ).toBe(md);
});

test("流式跨行链接不产生空白 OSC 8 点击区", () => {
  const md =
    "前缀 [\n](https://example.com)\n```md\n[代码\n链接](https://code.example)\n```";
  const out = run(md, {
    messageType: "assistant",
    isStreaming: true,
    availableWidth: 100,
  });
  expect(
    out.includes("前缀 [](https://example.com)"),
    JSON.stringify(out),
  ).toBeTruthy();
  expect(
    out.includes("[代码\n链接](https://code.example)"),
    JSON.stringify(out),
  ).toBeTruthy();
});

test("admonition 转换", () => {
  expect(
    run("> [!WARNING] 磁盘不足\n> 续行\n\n正文").includes(
      "> **⚠️ WARNING** 磁盘不足 续行",
    ),
  ).toBeTruthy();
  expect(run("> [!NOTE] 提示").includes("> **💡 NOTE** 提示")).toBeTruthy();
  expect(run("> [!warning] 小心").includes("WARNING")).toBeTruthy();
  expect(run("> 普通引用").trim()).toBe("> 普通引用");
});

test("admonition 引用块后空行", () => {
  const out = run("> [!WARNING] 磁盘不足\n\n正文");
  // 提示框后至少有一个空行，防止紧接段落被合并
  expect(
    out.includes("> **⚠️ WARNING** 磁盘不足\n\n"),
    JSON.stringify(out),
  ).toBeTruthy();
});

test("代码块内 admonition 不转换", () => {
  const out = run("```md\n> [!NOTE] 示例\n```\n\n> [!NOTE] 块外");
  expect(out.includes("> [!NOTE] 示例")).toBeTruthy();
  expect(out.includes("> **💡 NOTE** 块外")).toBeTruthy();
});

test("admonition 内容 | 保留", () => {
  const out = run("> [!NOTE] 参数 a|b 说明");
  expect(out.includes("a|b"), JSON.stringify(out)).toBeTruthy();
});

test("嵌套提示框不互相吞并", () => {
  const out = run("> [!NOTE] 甲\n> [!WARNING] 乙");
  expect(
    out.includes("> **💡 NOTE** 甲") && out.includes("> **⚠️ WARNING** 乙"),
  ).toBeTruthy();
});

test("裸 URL 转换", () => {
  const out = run("访问 https://example.com/path 看看。");
  expect(
    out.includes("[https://example.com/path](https://example.com/path)"),
  ).toBeTruthy();
});

test("中文标点截断", () => {
  const out = run("看 https://example.com/a，和 https://b.com/x. 结束");
  expect(
    out.includes("[https://example.com/a](https://example.com/a)，"),
  ).toBeTruthy();
  expect(out.includes("[https://b.com/x](https://b.com/x)")).toBeTruthy();
});

test("行内代码与 <url> 不动", () => {
  const out = run(
    "用 `https://code.com/x` 和 <https://auto.com> 和 https://plain.com",
  );
  expect(out.includes("`https://code.com/x`")).toBeTruthy();
  expect(!out.includes("[https://code.com/x]")).toBeTruthy();
  expect(out.includes("<https://auto.com>")).toBeTruthy();
  expect(out.includes("[https://plain.com](https://plain.com)")).toBeTruthy();
});

test("已有链接/图片保护", () => {
  const out = run(
    "链接 [点我](https://example.com) 图片 ![图](https://img.com/a.png)",
  );
  expect(out.includes("[点我](https://example.com)")).toBeTruthy();
  expect(out.includes("![图](https://img.com/a.png)")).toBeTruthy();
});

test("含括号 URL 保留（括号平衡）", () => {
  const out = run("见 https://en.wikipedia.org/wiki/A_(B) 结束");
  expect(
    out.includes(
      "[https://en.wikipedia.org/wiki/A_(B)](https://en.wikipedia.org/wiki/A_(B))",
    ),
    JSON.stringify(out),
  ).toBeTruthy();
});

test("尾部 ] 与不成对 ) 截掉（避免无效链接）", () => {
  // 列表项 [url] 的闭合方括号不能吞进链接
  const out = run("列表 [https://example.com/a] 项");
  expect(
    out.includes("[[https://example.com/a](https://example.com/a) 项"),
    JSON.stringify(out),
  ).toBeTruthy();
  // 尾部不成对 ) 截掉
  const out2 = run("尾括号 https://example.com/x)");
  expect(
    out2.includes("[https://example.com/x](https://example.com/x)"),
    JSON.stringify(out2),
  ).toBeTruthy();
});

test("全角括号不吞进 URL", () => {
  const out = run("全角（https://example.com/a）");
  expect(
    out.includes("（[https://example.com/a](https://example.com/a)）"),
    JSON.stringify(out),
  ).toBeTruthy();
});

test("IPv6 URL 保留方括号", () => {
  const out = run("IPv6 https://[::1]:8080/x 保留");
  expect(
    out.includes("[https://[::1]:8080/x](https://[::1]:8080/x)"),
    JSON.stringify(out),
  ).toBeTruthy();
});

test("代码块内 URL 不动", () => {
  const out = run(
    '```js\nconst u = "https://code.com/x";\n```\n外链 https://outside.com',
  );
  expect(!out.includes("[https://code.com/x]")).toBeTruthy();
  expect(
    out.includes("[https://outside.com](https://outside.com)"),
  ).toBeTruthy();
});

test("圈数字转半角括号（Nerd Font 字形缺陷规避）", () => {
  expect(run("方案②引入，共⑩项")).toBe("方案(2)引入，共(10)项");
  expect(run("① ② ⑳").includes("(1) (2) (20)")).toBeTruthy();
});
