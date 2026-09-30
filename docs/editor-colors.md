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

- **Pi 官方支持的颜色 token**：主题文件 `colors` 字段里自带的那些，用户写这些字段时会被主题调色板上色（切主题自动换色），例如 `syntaxKeyword`、`borderMuted`、`thinkingMax` 等。
- **pi-one-ui 自定义的扩展颜色键**：`cwd`、`editorModel`、`editorBorder` 等，主题文件 `colors` 里可以写这些键来自定义 pi-one-ui 的 UI 样式；主题里不写时，组件回落到 Pi 官方 theme token（原生默认）。

### 2.1 编辑器专属字段（可选，未配置时走回退链）

| 字段 | 作用 | 未配置时的回退 |
|---|---|---|
| `cwd` ① | 右下角当前目录标签 | 主题文件 `colors` 中的同名扩展键 → 原生默认（bold + 主题 `syntaxFunction` 语义色） |
| `editorBorder` ① | 编辑器外框与补全下拉选中项颜色（`static` 模式） | 主题文件 `colors` 中的同名扩展键 → 原生默认（主题 `borderMuted` 语义色） |
| `editorModel` ① | 模型名标签（Minimalist 帧内） | 主题文件 `colors` 中的同名扩展键 → 原生默认（主题 `syntaxKeyword` 语义色） |
| `editorProvider` | metadata 模板 `$provider` | 统一回落主题 `text` |
| `editorGitBranch` | 分支名标签 | 主题 `bold syntaxKeyword` |
| `editorAccent` | Rail 竖条与左侧强调 | 主题 `accent` |
| `editorThinking` | thinking 标签通用色 | 主题 `warning` |
| `editorThinkingMinimal` / `Low` / `Medium` / `High` / `Xhigh` / `Max` | thinking 分档颜色，优先于 `editorThinking`；adaptive 模式下同时作用于边框与补全下拉选中项 | 同 `editorThinking` |

带 ① 标记的 `cwd`、`editorBorder`、`editorModel` 是 pi-one-ui 自定义的扩展颜色键，主题文件 `colors` 中存在时才生效；主题文件未写这些键时，组件直接回退到 Pi 官方 theme token（fallback）。表中其他字段（`editorProvider`、`editorGitBranch`、`editorAccent`、`editorThinking*`）以及第 2.2 节共用字段的默认值都是 Pi 官方 theme token；用户改写后要写 Pi 官方 theme token 或显式终端色，详见第 3 节。

### 2.2 共用字段（有内置默认值）

这些字段同时服务于 Footer 等组件，默认值定义在 `defaultConfig.colors`，删掉会回到默认值而非回退链：

| 字段 | 默认值 | Editor 中的用途 |
|---|---|---|
| `sessionName` | `bold success` | 会话名标签 |
| `sessionDuration` | `warning` | Agent 运行时长（showTimer 开启时） |
| `cost` | `bold success` | token 费用标签 |
| `gitStatus` | `bold error` | Git 状态符号 |
| `contextNormal` | `muted` | 上下文百分比正常档 |
| `contextWarning` | `bold warning` | 上下文百分比警告档 |
| `contextError` | `bold error` | 上下文百分比错误档 |
| `tokens` | `muted` | token 数量 |
| `packageVersion` | `208` | 依赖版本号 |
| `gitBranch` | `bold syntaxKeyword` | 分支名 |
| `gitCommit` | `bold success` | Git 哈希 |
| `gitMetricsAdded` | `bold success` | 新增行 |
| `gitMetricsDeleted` | `bold error` | 删除行 |
| `runtimePrefix` | 未设置 | runtime / 语言标签前缀 |
| `extensionStatus` | `muted` | 其他扩展状态 |
| `username` | `bold warning` | 用户名 |
| `time` | `bold warning` | 时间 |
| `os` | `bold text` | 操作系统 |

### 2.3 不受 colors 配置影响的元素

- metadata 模板里的 `$session_name`：固定使用主题 `border` token。
- 分支 ahead/behind 的 `↑` / `↓` 计数：固定使用主题 `success` / `error`。

## 3. 配置值如何解释

所有 `colors.*` 值统一按 theme 语义解释，规则是**官方 theme token + 显式终端色**。写入 `colors.*` 的官方 theme token 会随主题切换自动换色；`cwd`、`editorModel`、`editorBorder` 是 pi-one-ui 为 Editor 添加的自定义扩展键，主题里不写时回落到原生默认（Pi 官方 theme token）。

规则如下：

1. **显式终端色不经过主题**：使用以下形式渲染为固定终端色，主题切换不影响结果。
   - hex：`#ff0000`、`#f0a`。
   - 256 色索引：`208`。
   - 终端色名搭配前缀：`fg:purple`、`fg:red`、`bg:cyan` 等；裸 `purple`、`red`、`blue` 不属于配置语法。
   - 修饰符：`bold`、`italic`、`underline`，可加写 `dim` / `dimmed`，例如 `"bold fg:purple"`。
2. **官方 theme token 随主题变化**：Pi 官方主题文件 `colors` 的键（如 `accent`、`syntaxKeyword`、`thinkingMax` 等）写入 `colors.*` 后会被主题调色板上色，切主题自动换色。
   - 通用：`accent`、`border`、`borderMuted`、`success`、`error`、`warning`、`muted`、`dim`、`text`。
   - 思考与命令行：`thinkingText`、`thinkingOff`、`thinkingMinimal`、`thinkingLow`、`thinkingMedium`、`thinkingHigh`、`thinkingXhigh`、`thinkingMax`、`bashMode`。
   - 编辑器/消息底色和装饰：`selectedBg`、`scrollbarTrack`、`scrollbarThumb`、`userMessageText`、`customMessageText`、`customMessageLabel`、`toolTitle`、`toolOutput`。
   - Markdown与高亮：`mdHeading`、`mdLink`、`mdLinkUrl`、`mdCode`、`mdCodeBlock`、`mdCodeBlockBorder`、`mdQuote`、`mdQuoteBorder`、`mdHr`、`mdListBullet`、`toolDiffAdded`、`toolDiffRemoved`、`toolDiffContext`、`syntaxComment`、`syntaxKeyword`、`syntaxFunction`、`syntaxVariable`、`syntaxString`、`syntaxNumber`、`syntaxType`、`syntaxOperator`、`syntaxPunctuation`。
   - 主题 background 键如果写进 `colors.*`，会被 `theme.fg()` 解析，例如 `selectedBg` 可以当作代码块/选中区的颜色用。
3. **扩展颜色键可以被主题额外覆盖**：`cwd`、`editorModel`、`editorBorder` 等是 pi-one-ui 自定义的扩展键；主题文件 `colors` 中可以选写这些键来自定义 pi-one-ui 的 UI 样式，主题未定义时再回落到第 2 节的原生默认（官方 theme token）。自定义主题位于 `~/.pi/agent/themes/*.json`，自带主题位于 `themes/*.json`。

一句话总结：**跟随主题写官方 theme token，固定颜色写 hex/数字/`fg:`/`bg:`；终端色名必须带前缀；扩展颜色键中可额外覆盖 `cwd`、`editorModel`、`editorBorder`。**

## 4. 边框与 thinking 档位

编辑器外框、adaptive 模式下的 thinking 标签和补全下拉的选中项共用同一条颜色链。`borderColorMode` 决定这条链的行为：

### static（固定色）

边框与补全下拉选中项使用 `colors.editorBorder`（未配置时的回退见第 2 节）。thinking 档位不影响边框，但 thinking 标签仍按第 2 节规则着色。

### adaptive（随档位变化）

边框优先级（三级链）：

```text
colors.editorThinking*（按当前档位逐级查找，editorThinking 兜底）
  → Pi 原生 effort 边框（主题 thinking token）
  → 默认（主题 border 或 borderMuted 语义色）
```

thinking 标签与补全下拉选中项在 adaptive 模式下跟随边框色。`colors.editorThinking*` 在 adaptive 模式下对所有人生效，示例：

```json
{
  "components": { "editor": { "borderColorMode": "adaptive" } },
  "colors": {
    "editorThinkingLow": "fg:cyan",
    "editorThinkingMedium": "fg:purple",
    "editorThinkingHigh": "fg:yellow",
    "editorThinkingXhigh": "fg:bright-red",
    "editorThinkingMax": "bold dimmed fg:purple"
  }
}
```

## 5. style 开关：on 与 off

- `style: "on"`：Minimalist 装饰生效，边框与标签颜色按第 2~4 节规则。
- `style: "off"`：恢复 Pi 原生编辑器。仅当**显式配置**了 `colors.editorBorder` 时，边框按 theme 语义解释并覆盖原生边框；未配置则完全不动 Pi 原生 effort/主题变色。补全下拉选中项保持 Pi 原生选中色。

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
    "cwd": "bold fg:cyan",
    "editorBorder": "#5e9cff",
    "editorModel": "bold fg:purple",
    "editorGitBranch": "bold fg:blue",
    "editorThinkingHigh": "#facc15",
    "editorThinkingXhigh": "#fb7185"
  }
}
```

注意：固定终端色必须写成 `"bold fg:cyan"`、`"bold fg:purple"` 这类形式；主题 token 请写 `"bold accent"`、`"bold syntaxKeyword"`。

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
2. **跟随主题**：只写 Pi 官方主题 token（`accent`、`syntaxKeyword`、`warning` 等），这样换主题会一起变化。
3. **要固定色**：写 hex / 256 色索引 / `fg:`/`bg:` 前缀；终端色名必须带 `fg:` 或 `bg:` 前缀。
4. **利用默认回退**：多数字段不配置也有合理的默认观感；不需要的字段直接删除即可，不必刻意填空值。
5. **修改后验证**：文件直改后执行 `/reload`；面板修改即时生效。改完检查几个场景：不同 thinking 档位（`/thinking` 调整）、bash 模式（`!` 前缀）、宽窄终端下边框是否正常。

## 8. 排查要点

- **配置值被忽略**：多半是样式串含非法 token 未通过 `isSupportedColorSpec`，值被丢弃后走回退链。对照第 3 节语法检查拼写（如 `bright-black` 而非 `brightblack`）。
- **颜色值没有生效**：检查是否写了裸 ANSI 色名，例如 `purple`、`red`、`blue`。配置中应使用官方主题 token，或写成 `fg:purple`、`fg:red`、hex、256 色索引。
- **adaptive 边框不随档位变化**：确认 `colors.editorThinking*` 覆盖了常用档位；未配置时自适应边框来自 Pi 原生 effort 边框（主题 thinking token），自定义需要改主题的 `thinkingLow`~`thinkingMax` token。
- **off 模式边框没被覆盖**：`style: "off"` 只有显式配置 `colors.editorBorder` 才会覆盖原生边框，空值等于不覆盖。
- **旧配置带 `colorSource`**：0.6.0 起直接忽略，无需清理；若想整理文件可手动删除该字段。