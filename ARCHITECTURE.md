# pi-one-ui 架构勘察

> 当前阶段：已完成第一阶段融合实现，`extensions/` 是可安装的单插件源码；`vendor/` 仍保留为只读上游参考快照。

## 源码来源

| 目录 | 上游项目 | 当前快照 |
|---|---|---|
| `vendor/pi-zentui` | `https://github.com/lmilojevicc/pi-zentui` | `pi-zentui` `0.21.0`，commit `5341b38` |
| `vendor/pi-cc-extensions` | `https://github.com/minuque/pi-cc-extensions` | npm 包 `0.8.67` 对应仓库浅克隆快照，commit `dba37e5` |

两个目录目前作为只读参考源码保留，不应直接在 `node_modules` 中修改上游实现。

## Zentui 模块分层

入口：`vendor/pi-zentui/extensions/zentui/index.ts`

`index.ts` 是运行时编排层，读取 `~/.pi/agent/zentui.json`，然后按配置安装或卸载各个 UI 能力。

| 模块 | 职责 | Pi 接入点 |
|---|---|---|
| `config.ts` | 配置 schema、默认值、规范化、持久化 | `zentui.json` |
| `settings-command.ts` | `/zentui` 配置面板 | `pi.registerCommand("zentui")` |
| `ui.ts` | Editor 包装器和 Opencode/Minimalist 渲染 | `ctx.ui.setEditorComponent()` |
| `accent-rail-editor.ts` | 左侧 rail、输入内容、补全菜单布局 | Editor 渲染函数 |
| `minimalist-editor.ts` | Minimalist Editor 布局 | Editor 渲染函数 |
| `user-message.ts` | 安装/卸载 UserMessage prototype patch | `UserMessageComponent.prototype.render` |
| `user-message-styles.ts` | Framed、Compact、Labeled 等纯渲染策略 | 被 `user-message.ts` 调用 |
| `footer.ts` | Native/Starship/Hidden Footer | `ctx.ui.setFooter()` |
| `footer-format.ts` | Footer 模板解析和变量渲染 | Footer 实现内部 |
| `working-line.ts` | Working line、spinner、turn summary | working UI / entry renderer |
| `selector-border.ts` | 选择器边框 | TUI selector patch |
| `extension-status.ts` | 收集其他插件的 `setStatus` 状态 | Footer 状态区 |
| `state.ts`、`git.ts`、`runtime.ts`、`project-state.ts` | Footer 和 Editor 的运行时数据 | 被多个渲染器读取 |
| `prototype-patch-registry.ts` | prototype patch 的注册、恢复、冲突保护 | User Message 等 patch |

### Zentui Editor 的关键机制

Zentui 不是修改 Pi 原始 Editor 的 CSS，而是用 `ctx.ui.setEditorComponent()` 替换或包装 Editor factory：

```text
Pi 原始 Editor factory
        │
        ├─ 无其他 Editor：Zentui 创建 PolishedEditor
        └─ 已有 Editor：Zentui 创建 WrappedPolishedEditor
```

### Zentui User Message 的关键机制

`user-message.ts` 对 `UserMessageComponent.prototype.render` 安装可恢复的 patch：

```text
原始 UserMessage.render
        │
        └─ Zentui patch
             ├─ 提取 Markdown 文本
             ├─ sanitize 终端控制序列
             ├─ renderUserMessageStyle()
             └─ 添加 OSC 133 prompt zone 标记
```

真正的样式分派在 `user-message-styles.ts`：

```ts
switch (config.components.userMessages.style) {
  case "framed": ...
  case "framed-copy-friendly": ...
  case "compact": ...
  case "labeled": ...
}
```

## pi-cc-extensions 模块分层

入口：`vendor/pi-cc-extensions/extensions/index.ts`

入口文件按三类启动能力：

```text
shell chrome
  ├─ aliases
  ├─ flush-docked-bash
  ├─ startup-header
  └─ working-message（可配置）

features
  ├─ agent-summary
  ├─ context
  ├─ session-reference
  ├─ subagent-autocomplete
  └─ compact-thinking

renderer
  ├─ claudeCodeStyle
  └─ markdownEnhance
```

| 模块 | 职责 |
|---|---|
| `extensions/config/config.ts` | `claude-code-style.json` schema、默认值、读取和规范化 |
| `extensions/config/panel.ts` | `/ccstyle` 配置面板 |
| `extensions/renderer/index.ts` | Claude Code 风格渲染总入口和 renderer owner 管理 |
| `extensions/renderer/default-mode.ts` | 默认模式下的 Tool renderer patch |
| `extensions/renderer/compact-mode.ts` | compact 模式下的消息/工具布局 |
| `extensions/renderer/tool/` | Tool title、input、result、group、diff 等具体渲染 |
| `extensions/renderer/mouse/` | hover、点击、滚动、鼠标交互 |
| `extensions/feature/compact-thinking.ts` | Thinking block 的折叠、动画、标题 |
| `extensions/feature/agent-summary/` | Agent summary entry renderer |
| `extensions/feature/context.ts` | `/context` 上下文检查 |
| `extensions/feature/reference/` | Session/Subagent 引用和 autocomplete |
| `extensions/feature/shell/` | `/clear`、`/exit`、startup header、working message |
| `extensions/utils/patch-keys.ts` | prototype patch 的原始方法和 owner 标记 |
| `extensions/utils/component-tree.ts` | TUI component tree 操作 |
| `tests/` | renderer、patch、交互和回归测试 |

CC Style 的主体是对 Pi TUI 消息组件和工具组件安装 renderer/prototype patch；它不提供 Zentui 那样完整的 Editor/Footer owner。

## 两者的冲突和互补

| Pi UI 接缝 | Zentui | CC Style | 融合建议 |
|---|---|---|---|
| Editor factory | 主要 owner | 基本不负责 | 采用 Zentui 实现 |
| User Message render | 主要 owner | 非主要 owner | 采用 Zentui 实现 |
| Footer | `ctx.ui.setFooter()` | 主要通过 status/working message 间接影响 | 只保留 Zentui Footer |
| Working line | `working-line.ts` | `working-message.ts` | 只能选择一个 owner |
| Tool renderer | 非主要 owner | 核心能力 | 采用 CC Style 实现 |
| Diff renderer | 非主要 owner | 核心能力 | 采用 CC Style 实现 |
| Thinking renderer | 有 working/thought 相关显示 | 核心能力 | 采用 CC Style 实现，统一配置 |
| Agent summary | 有 turn summary entry | 有 agent summary entry | 需要确认 entry type，避免重复注册 |
| Selector border | Zentui | 非主要 owner | 采用 Zentui 实现 |
| Extension status | Footer 中展示 status | 可写入 status | 统一由 Zentui Footer 消费 |
| 配置命令 | `/zentui` | `/ccstyle` | 融合后提供一个统一命令 |
| 主题 | Zentui 使用 Pi theme | 提供 `cc-dark` / `cc-light` | 第一阶段保留主题资源，后续统一主题命名 |

当前本机配置已经采取了部分互补策略：

```json
// claude-code-style.json
auto.enableWorkingMessage = false

// zentui.json
components.workingLine.enabled = true
```

因此当前应由 Zentui 管理 Working line，由 CC Style 管理 Tool/Diff/Thinking/Agent Summary。

## 建议的融合边界

新插件（`pi-one-ui`）不应一开始复制所有代码，而应先建立一个统一配置层：

```text
unified-ui.json
        │
        ├─ editor / userMessages / footer / workingLine
        │       └─ 映射到 Zentui 配置或内部实现
        │
        └─ renderer / diff / thinking / agentSummary
                └─ 映射到 CC Style 配置或内部实现
```

插件对外只提供一个统一 interface：

```text
/oneui
```

并由 `app/ownership.ts` 和应用装配层决定 Pi 的每个 UI 接缝只有一个 owner。

## 当前实现

根目录现在就是一个可安装的 Pi package：

```text
package.json
└── pi.extensions → ./extensions/index.ts

extensions/index.ts
├── shell/index.ts       # Shell chrome owner
└── transcript/index.ts  # Transcript/tool renderer owner
```

`extensions/index.ts` 是 composition root，只负责创建 Shell、Transcript 和 `/oneui` 的装配关系；具体实现分别位于 `shell/`、`transcript/`、`features/` 和 `tools/`。

统一配置保存到 `~/.pi/agent/pi-one-ui.json`：Shell 配置保留在 JSON 根级，Transcript 配置放在 `renderer` 下。启动时会迁移旧的 unified 配置，以及 `zentui.json` 和 `claude-code-style.json`，并保留旧文件作为备份。

Working line 的 owner 固定为 Shell，Transcript 默认不启用额外的 working message，避免两个模块争抢 Pi 的 unkeyed working row。

## 后续建议

1. 在本机 Pi TUI 中用 `/oneui` 验证面板导航、预览和实时更新。
2. 为 unified config 增加 schema/version migration 测试，并把上游回归测试逐步迁入 `tests/`。
3. 继续把 Shell 和 Transcript 的高级 JSON 字段逐步加入融合面板。
4. 更新上游时先刷新 `vendor/` 快照，再按产品能力选择性同步到 `extensions/`；不要直接修改 vendor 参考目录。

已完成验证：根包 `typecheck`、统一配置测试和 `npm pack --dry-run` 通过；两个 vendor 仓库没有被修改。
