# pi-one-ui

`pi-one-ui` 是一个统一的 Pi TUI 插件包，将 Zentui 的终端外壳能力与 Claude Code 风格的对话内容渲染合并到一个插件中。

## 安装

```bash
pi install /path/to/pi-one-ui
# 或安装远程仓库
pi install git:github.com/<your-account>/pi-one-ui
```

安装后执行 `/reload`。

## 统一入口

```text
/oneui
```

`/oneui` 是唯一的公开管理命令。设置面板按照 TUI 的视觉 Surface 划分：

```text
Header → Context → WorkingLine → Editor → Footer → Features → Presets
```

其中：

- **Header**：启动信息、Logo、快捷键提示。
- **Context**：对话内容区，包含 User Message、Assistant Message、Thinking、Tool、Diff、Summary 和鼠标交互。
- **WorkingLine**：Pi 的工作状态行、spinner、token/thought/elapsed 信息。
- **Editor**：输入编辑器、completion、metadata、Accent Rail 和 Minimalist 样式。
- **Footer**：目录、Git、runtime、token、cost、extension status 等信息。
- **Features**：Context Inspector、Session Reference、Subagent Autocomplete、Aliases 等行为能力。
- **Overlay**：设置面板和 Context Inspector 等临时浮层由统一 OverlayManager 跟踪。

## 配置

配置文件：

```text
~/.pi/agent/pi-one-ui.json
```

当前仍兼容 v1 配置结构：

```json
{
  "version": 1,
  "components": {
    "editor": { "enabled": true, "style": "opencode" },
    "userMessages": { "enabled": true, "style": "framed" },
    "workingLine": { "enabled": true },
    "footer": { "style": "starship" }
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto",
    "enableWorkingMessage": false
  }
}
```

所有读写已经经过统一 ConfigStore；旧的 `zentui.json`、`claude-code-style.json` 和 `pi-mine-ui.json` 会被兼容读取并保留。`enableWorkingMessage` 仍可被旧配置读取，但统一插件不会注册第二套 working-message 实现，WorkingLine 的唯一 owner 是本插件的 WorkingLine surface。

## 源码结构

```text
extensions/
  index.ts                         # 唯一插件入口，创建 TuiRuntime
  app/
    runtime/                       # TuiRuntime、surface lifecycle、state、事件和调度
    host/                          # Pi API 的窄化 host ports
    config/                        # ConfigStore 与配置领域解析
    ownership/                     # Surface ownership
    overlay/                       # OverlayManager、InputRouter、selector
    commands/                      # /oneui and settings panel previews
  surfaces/
    header/                        # Header surface
    context/                       # 原 Transcript：对话内容区
      message/                     # User Message
      thinking/                    # Thinking
      renderer/                    # Tool、Diff、Markdown、Mouse
      summary/                     # Agent summary
    working-line/                  # WorkingLine 与 interaction summary
    editor/                        # Editor 及其样式实现
    footer/                        # Footer 及其布局/format/status
  features/
    aliases.ts
    context-inspector/             # /context，不是 Context 对话区
    flush-docked-bash.ts
    legacy/                        # standalone compatibility implementation
    session-reference/
    subagent-autocomplete.ts
  services/                       # Git、runtime、package、project、session 数据
  shared/                         # ANSI、format、style、icons 等共享实现
  tools/                          # 底层组件树、patch 和 terminal helpers
vendor/                           # 只读上游参考快照
```

`TuiRuntime` 是统一 composition root。Editor、WorkingLine 和 Footer 已分别由 Surface controller 管理；`surface-lifecycle.ts` 仅保留尚未迁移的 User Message、Selector 和共享生命周期 glue，且不作为公开架构边界。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run pack:check
```

完整检查：

```bash
npm run verify
```

测试按领域划分：

- `tests/context-*`：Context 内容区、Tool、Diff、Thinking 和鼠标行为。
- `tests/working-line-*`：WorkingLine 和 turn summary。
- `tests/editor-*`：Editor、completion、metadata、transfer 和 Accent Rail。
- `tests/footer-*`：Footer、Footer format/layout/status。
- `tests/services-*`：Git、runtime、project、session 和 telemetry。
- `tests/shell-*`：standalone compatibility tests for the remaining surface lifecycle glue。

本地启动：

```bash
npm run pi:dev
```

上游快照保存在 `vendor/`，仅用于追踪和同步。不要直接修改 `vendor/` 或 `node_modules/`。
