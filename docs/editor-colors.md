# Editor 颜色配置说明

> 适用版本：pi-one-ui >= 0.6.0。0.6.0 起移除了 `colorSource`（`theme`/`terminal`）双模式概念，颜色统一按 theme 语义渲染；`colors.*` 是唯一自定义入口，支持主题 token 与固定终端色写法。0.5.x 及更早版本的说明以 0.5.x 文档为准。

本文说明 Editor 组件的颜色体系：颜色从哪里配置、配置值如何解释、支持的颜色值语法、未配置时的回退链，以及如何自定义修改。

## 1. 配置入口

配置只读写 `~/.pi/agent/pi-one-ui.json`（canonical v1 结构），不会读取或迁移历史配置文件。

两种修改方式：

1. **推荐使用 `/oneui` 设置面板**：面板中 Editor 部分提供 `style` 与 `Border color` 两个开关，选择后立即持久化并生效，面板保持打开。
2. **直接编辑文件**：改完执行 `/reload` 生效（或重启 Pi）。

配置文件结构示例：

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "static"
    }
  },
  "colors": {
    "editorBorder": "accent",
    "editorModel": "syntaxKeyword",
    "cwd": "muted"
  }
}
```

相关字段含义：

| 字段 | 取值 | 作用 |
|---|---|---|
| `components.editor.style` | `on` / `off` | `on` 启用 Minimalist 装饰，`off` 恢复 Pi 原生编辑器 |
| `components.editor.borderColorMode` | `static` / `adaptive` | `static` 固定一种边框色，`adaptive` 边框优先用分档配置、未配置时随 thinking 档位变化（见第 4 节） |
| `colors.*` | 颜色样式串 | Editor 各元素的具体颜色（见第 2 节） |

历史配置中的 `colorSource` 字段（`theme`/`terminal`）在 0.6.0 已移除：读取时直接忽略，文件内容不会被主动改写，不影响其他配置生效。

## 2. Editor 相关颜色字段清单

所有颜色都写在 `colors` 对象里。Editor 用到的字段分两类：

### 2.1 编辑器专属字段（可选，未配置时走回退链）

| 字段 | 作用 | 未配置时的回退 |
|---|---|---|
| `cwd` | 右下角当前目录标签 | 主题 `cwd` token → 原生默认（bold + 主题 `syntaxFunction` 语义色） |
| `editorBorder` | 边框颜色（`static` 模式） | 主题 `editorBorder` token → 原生默认（主题 `borderMuted` 语义色） |
| `editorModel` | 模型名标签（Minimalist 帧内） | 主题 `editorModel` token → 原生默认（主题 `syntaxKeyword` 语义色） |
| `editorProvider` | metadata 模板 `$provider` | 统一回落主题 `text` |
| `editorGitBranch` | 分支名标签 | 主题 `bold syntaxKeyword` |
| `editorAccent` | Rail 竖条与左侧强调 | 主题 `accent` |
| `editorThinking` | thinking 标签通用色 | 主题 `warning` |
| `editorThinkingMinimal` / `Low` / `Medium` / `High` / `Xhigh` / `Max` | thinking 分档颜色，优先于 `editorThinking`；adaptive 模式下同时作用于边框 | 同 `editorThinking` |

### 2.2 共用字段（有内置默认值）

这些字段同时服务于 Footer 等组件，默认值定义在 `defaultConfig.colors`，删掉会回到默认值而非回退链：

| 字段 | 默认值 | Editor 中的用途 |
|---|---|---|
| `sessionName` | `bold green` | 会话名标签 |
| `sessionDuration` | `yellow` | Agent 运行时长（showTimer 开启时） |
| `cost` | `bold green` | token 费用标签 |
| `gitStatus` | `bold red` | Git 状态符号 |

### 2.3 不受 colors 配置影响的元素

- metadata 模板里的 `$session_name`：固定使用主题 `border` token。
- 分支 ahead/behind 的 `↑` / `↓` 计数：固定使用主题 `success` / `error`。

## 3. 配置值如何解释（theme 语义）

所有 `colors.*` 值统一按 theme 语义解释，规则是**主题 token 优先，固定终端色为辅**：

1. **显式终端 token 直接输出固定色**：hex（`#ff0000`）、0-255 数字（`208`）、`fg:`/`bg:` 前缀（`fg:202`、`bg:#bf5700`）不经过主题，渲染为固定终端色。
2. **其余按主题 token 解析**：`accent`、`syntaxKeyword`、`thinkingHigh` 等主题 token 经当前主题调色板上色（支持 vars 引用），换主题自动换色。
3. **ANSI 色名映射到语义 token**：`red`→`error`、`green`→`success`、`yellow`→`warning`、`blue`/`cyan`→`syntaxFunction`、`purple`→`syntaxKeyword`、`black`→`muted`、`white`→`text`。所以写 `"red"` 得到的是主题错误色而非终端红色。
4. **修饰符**：`bold`、`dim`（`dimmed`）、`italic`、`underline` 可与其他 token 组合，如 `"bold accent"`、`"underline bg:#1b1922"`。
5. **不映射不报错**：写了不存在的 token，配置会通过 `isSupportedColorSpec` 校验失败而被丢弃，等价于未配置，走回退链。

一句话总结：**跟随主题写主题 token，固定颜色写 hex/数字/`fg:`/`bg:`**。

## 4. 边框与 thinking 档位

边框行为由 `borderColorMode` 决定：

### static（固定色）

边框使用 `colors.editorBorder`（未配置时的回退见第 2 节）。thinking 档位不影响边框，但 thinking 标签仍按第 2 节规则着色。

### adaptive（随档位变化）

边框优先级（三级链）：

```text
colors.editorThinking*（按当前档位逐级查找，editorThinking 兜底）
  → Pi 原生 effort 边框（主题 thinking token）
  → 默认（主题 border 或 borderMuted 语义色）
```

thinking 标签在 adaptive 模式下跟随边框色。`colors.editorThinking*` 在 adaptive 模式下对所有人生效，示例：

```json
{
  "components": { "editor": { "borderColorMode": "adaptive" } },
  "colors": {
    "editorThinkingLow": "green",
    "editorThinkingMedium": "cyan",
    "editorThinkingHigh": "yellow",
    "editorThinkingXhigh": "bright-red",
    "editorThinkingMax": "bold red"
  }
}
```

## 5. style 开关：on 与 off

- `style: "on"`：Minimalist 装饰生效，边框与标签颜色按第 2~4 节规则。
- `style: "off"`：恢复 Pi 原生编辑器。仅当**显式配置**了 `colors.editorBorder` 时，边框按 theme 语义解释并覆盖原生边框；未配置则完全不动 Pi 原生 effort/主题变色。

## 6. 完整配置示例

### 6.1 跟随主题

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "static"
    }
  },
  "colors": {
    "cwd": "muted",
    "editorBorder": "accent",
    "editorModel": "syntaxKeyword",
    "editorGitBranch": "bold syntaxKeyword",
    "editorThinking": "warning",
    "editorThinkingHigh": "thinkingHigh"
  }
}
```

### 6.2 固定终端色

需要不随主题变化的固定色时，用 hex、256 色索引或 `fg:`/`bg:` 前缀：

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "adaptive"
    }
  },
  "colors": {
    "cwd": "bold cyan",
    "editorBorder": "#5e9cff",
    "editorModel": "bold purple",
    "editorGitBranch": "bold blue",
    "editorThinkingHigh": "#facc15",
    "editorThinkingXhigh": "#fb7185"
  }
}
```

注意：`"bold cyan"`、`"bold purple"` 这类 ANSI 色名在 theme 语义下映射为语义 token（cyan→syntaxFunction、purple→syntaxKeyword），会跟随主题；想彻底固定请用 hex 或 256 索引。

### 6.3 off 模式只覆盖边框

```json
{
  "version": 1,
  "components": { "editor": { "style": "off" } },
  "colors": { "editorBorder": "borderAccent" }
}
```

## 7. 自定义修改建议

1. **从 `/oneui` 面板起步**：先用面板确认 `style` / `borderColorMode` 的实际效果，再手写 `colors.*` 精调。
2. **跟随主题**：优先写主题 token（`accent`、`syntaxKeyword`、`warning` 等），不要写死具体色值，这样换主题观感仍然协调。
3. **要固定色**：写 hex / 256 色索引 / `fg:`/`bg:` 前缀，效果不随主题变化；避免用 ANSI 色名（会被映射为语义色）。
4. **利用默认回退**：多数字段不配置也有合理的默认观感；不需要的字段直接删除即可，不必刻意填空值。
5. **修改后验证**：文件直改后执行 `/reload`；面板修改即时生效。改完检查几个场景：不同 thinking 档位（`/thinking` 调整）、bash 模式（`!` 前缀）、宽窄终端下边框是否正常。

## 8. 排查要点

- **配置值被忽略**：多半是样式串含非法 token 未通过 `isSupportedColorSpec`，值被丢弃后走回退链。对照第 3 节语法检查拼写（如 `bright-black` 而非 `brightblack`）。
- **颜色跟随主题而不是固定色**：你写的多半是 ANSI 色名或主题 token。要用固定色请改 hex 或 256 索引。
- **adaptive 边框不随档位变化**：确认 `colors.editorThinking*` 覆盖了常用档位；未配置时自适应边框来自 Pi 原生 effort 边框（主题 thinking token），自定义需要改主题的 `thinkingLow`~`thinkingMax` token。
- **off 模式边框没被覆盖**：`style: "off"` 只有显式配置 `colors.editorBorder` 才会覆盖原生边框，空值等于不覆盖。
- **旧配置带 `colorSource`**：0.6.0 起直接忽略，无需清理；若想整理文件可手动删除该字段。