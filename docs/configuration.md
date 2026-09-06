# Editor 与 Footer 配置指南

> 适用版本：pi-one-ui >= 0.6.0。颜色相关的完整字段清单、取值语法与自定义方式见 [editor-colors.md](./editor-colors.md)。

本文介绍 Editor 与 Footer 两个组件的可配置项：每个开关的作用、取值、默认值，以及完整配置示例。

## 1. 配置入口

配置只读写 `~/.pi/agent/pi-one-ui.json`（canonical v1 结构），不会读取或迁移历史配置文件。

- **推荐用 `/oneui` 面板**：面板只提供少数高频开关（Editor 的 style / Border color、Footer 的 style 等），修改后立即持久化并生效。
- **手写配置文件**：其余选项都写在 JSON 里，改完执行 `/reload` 生效（或重启 Pi）。

文件损坏（如 JSON 尾逗号）时配置会整体回退到内置默认值，不报错也不崩溃；修正 JSON 后 `/reload` 即恢复。

## 2. Editor 配置

### 2.1 组件级开关（`components.editor`）

| 字段 | 取值 | 默认 | 作用 |
|---|---|---|---|
| `style` | `on` / `off` | `on` | `on` 启用 Minimalist 装饰，`off` 恢复 Pi 原生编辑器 |
| `borderColorMode` | `static` / `adaptive` | `static` | `static` 固定边框色，`adaptive` 边框随 thinking 档位变化（见 2.3） |
| `modelLabel` | `id` / `name` | `id` | 顶栏模型名显示模型 id 还是 name |
| `viewportIndicators` | `true` / `false` | `true` | 边框上显示 ↑/↓ 未读消息计数 |

### 2.2 Minimalist 装饰开关（`components.editor.styles.minimalist`）

| 字段 | 默认 | 作用 |
|---|---|---|
| `pathDisplay` | `compact` | 路径显示模式：`compact` 只显示当前目录名，`project` 显示项目根加相对路径，`full` 显示完整路径 |
| `showSessionName` | `true` | 左上角显示会话名 |
| `showTimer` | `true` | 显示 Agent 运行时长 |
| `showCost` | `true` | 右上角显示 token 花费 |
| `showGit` | `true` | 底部显示分支、dirty 标记与 ahead/behind 计数 |

关闭简洁模式的示例：

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "styles": {
        "minimalist": {
          "pathDisplay": "project",
          "showSessionName": false,
          "showTimer": false,
          "showCost": false,
          "showGit": true
        }
      }
    }
  }
}
```

### 2.3 边框颜色

- `static`：边框用 `colors.editorBorder`（未配置回退主题 `editorBorder` token → 默认 `borderMuted`）。
- `adaptive`：边框优先级为 `colors.editorThinking*`（按当前档位逐级查找，`editorThinking` 兜底）→ Pi 原生 effort 边框 → 默认；thinking 标签跟随边框色。
- `style: "off"` 时只有显式配置 `colors.editorBorder` 才会覆盖原生边框，否则保持 Pi 原生 effort/主题变色。

示例：自适应边框分档

```json
{
  "version": 1,
  "components": { "editor": { "borderColorMode": "adaptive" } },
  "colors": {
    "editorThinkingLow": "green",
    "editorThinkingMedium": "cyan",
    "editorThinkingHigh": "#facc15",
    "editorThinkingXhigh": "bright-red"
  }
}
```

### 2.4 Editor 颜色字段

Editor 专属颜色：`cwd`、`editorAccent`（rail 竖条）、`editorBorder`、`editorGitBranch`、`editorModel`、`editorProvider`、`editorThinking` 与 `editorThinkingMinimal/Low/Medium/High/Xhigh/Max`。取值按 theme 语义（主题 token / hex / 256 索引 / `fg:`/`bg:`），详见 [editor-colors.md](./editor-colors.md)。

## 3. Footer 配置

### 3.1 组件级开关（`components.footer`）

| 字段 | 取值 | 默认 | 作用 |
|---|---|---|---|
| `style` | `starship` / `native` / `hidden` | `starship` | `starship` 自定义排版；`native` Pi 原生；`hidden` 隐藏 |
| `modelLabel` | `id` / `name` | `id` | 模型段显示 id 还是 name |

### 3.2 Starship 排版（`components.footer.styles.starship`）

| 字段 | 默认 | 作用 |
|---|---|---|
| `format` | `""` | 自定义模板；空字符串表示按 `segments` 开关渲染 |
| `responsive` | `true` | 窄屏时切换到 `compactFormat` |
| `compactFormat` | `$cwd$wrap(in $session_name)...` | 窄屏排版模板 |
| `compactMaxLines` | `2` | 窄屏最大行数：`1`/`2`/`3`/`unlimited` |
| `separator` | `pipe` | 段分隔符：`pipe` / `dot` / `chevron` / `none` |
| `contextStyle` | `text` | 上下文占用样式：`text` / `gauge` / `text+gauge` |
| `contextThresholds` | `{ warning: 70, error: 90 }` | 上下文占用告警/错误百分比阈值 |
| `pathDisplay` | `{ mode: "basename", depth: 0 }` | 路径显示模式与保留深度 |
| `gitBranch.maxLength` | `full` | 分支名最大长度（`full` 或数字） |
| `gitCommit` | `{ hashLength: 7, onlyDetached: true, showTag: true }` | commit 段细节 |
| `gitMetrics` | `{ onlyNonzero: true, ignoreSubmodules: false }` | git 指标段细节 |
| `extensionStatuses` | 见 3.4 | 扩展状态段 |

### 3.3 `segments` 段开关

未使用 `format`（或 format 未包含某变量）时，由 `segments` 决定显示哪些段，全部默认值如下：

| 段 | 默认 | 段 | 默认 |
|---|---|---|---|
| `cwd` | 开 | `sessionName` | 开 |
| `gitBranch` | 开 | `gitStatus` | 开 |
| `gitCounts` | 关 | `gitCommit` | 关 |
| `gitMetrics` | 关 | `runtime` | 开 |
| `modelInfo` | 关 | `context` | 开 |
| `tokens` | 开 | `cost` | 开 |
| `sessionDuration` | 关 | `username` | 关 |
| `time` | 关 | `os` | 关 |
| `packageVersion` | 关 | | |

### 3.4 `format` 模板变量

`format` 支持以下变量，写法为 `$name` 或 `${name}`：

`cwd`、`session_name`、`git_branch`、`git_status`、`git_state`、`runtime`、`model`、`provider`、`session_duration`、`username`、`os`、`time`、`context`、`tokens`、`cache_read`、`cache_write`、`cost`、`subscription`、`auto_compaction`、`package`、`package_version`、`git_commit`、`git_tag`、`git_metrics`，以及 `wrap(...)` 包裹与 `wrap_sep` 分隔符。

自定义模板示例：

```json
{
  "version": 1,
  "components": {
    "footer": {
      "style": "starship",
      "styles": {
        "starship": {
          "format": "$cwd$wrap(on $git_branch) $git_status $tokens $cost",
          "contextStyle": "gauge",
          "contextThresholds": { "warning": 60, "error": 85 }
        }
      }
    }
  }
}
```

### 3.5 `extensionStatuses`

扩展状态段（如 subagent 运行中状态的显示）：

| 字段 | 作用 |
|---|---|
| `defaultPlacement` | 默认位置：`off` / `left` / `middle` / `right` |
| `placements` | 按扩展名覆盖位置 |
| `colorModes` | 按扩展名设置颜色模式（`zentui` / `original`） |

### 3.6 Footer 颜色字段

Footer 共用颜色：`sessionName`、`gitBranch`、`gitStatus`、`contextNormal/Warning/Error`、`tokens`、`cost`、`separator`、`runtimePrefix`、`extensionStatus`、`sessionDuration`、`packageVersion`、`gitCommit`、`gitMetricsAdded/Deleted`、`username`、`time`、`os`。取值语法与 Editor 相同（主题 token / hex / 256 索引 / `fg:`/`bg:`），详见 [editor-colors.md](./editor-colors.md)。

## 4. 综合示例

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "adaptive",
      "modelLabel": "name",
      "styles": {
        "minimalist": {
          "pathDisplay": "project",
          "showSessionName": true,
          "showTimer": true,
          "showCost": false,
          "showGit": true
        }
      }
    },
    "footer": {
      "style": "starship",
      "modelLabel": "id",
      "styles": {
        "starship": {
          "format": "$cwd$wrap(on $git_branch) $git_status $tokens $cost",
          "separator": "dot",
          "contextStyle": "gauge",
          "segments": {
            "sessionName": false,
            "gitCounts": true
          }
        }
      }
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    },
    "workingLine": {
      "enabled": true
    }
  },
  "colors": {
    "editorBorder": "accent",
    "editorThinkingHigh": "thinkingHigh",
    "cwd": "muted",
    "gitBranch": "bold syntaxKeyword",
    "cost": "bold success"
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto"
  }
}
```

## 5. 常见场景速查

| 目标 | 做法 |
|---|---|
| 只要 Editor，不要额外标签 | `showSessionName`/`showTimer`/`showCost`/`showGit` 按需关掉 |
| 恢复原生编辑器 | `editor.style: "off"`（显式配 `editorBorder` 可只覆盖边框色） |
| 边框随思考档位变色 | `editor.borderColorMode: "adaptive"` + `editorThinking*` |
| 自定义 footer 排版 | `footer.styles.starship.format` 写模板 |
| 隐藏 footer | `footer.style: "hidden"` |
| 固定颜色 | 颜色字段写 hex / 256 索引 / `fg:`/`bg:` |
| 跟随主题 | 颜色字段写主题 token（`accent`、`syntaxKeyword` 等） |

## 6. 变更与迁移

- 0.6.0 起 `colorSource`（`theme`/`terminal`）已移除：旧字段在读取时直接忽略，不主动改写文件；`colors.*` 统一按 theme 语义解释（ANSI 色名映射到语义 token，如 `red`→`error`）。
- 0.5.0 起 Editor 只用 `minimalist` 一种样式：旧 `enabled: false` 迁移为 `style: "off"`，旧 `opencode`/`minimalist` 迁移为 `style: "on"`，`styles.opencode` 与 `opencode-copy-friendly`、`accent-rail` 失效。