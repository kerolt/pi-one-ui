# pi-one-ui

[![npm version](https://img.shields.io/npm/v/pi-one-ui?style=flat-square)](https://www.npmjs.com/package/pi-one-ui)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/kerolt/pi-one-ui?style=flat-square)](./LICENSE)

简体中文 | [English](./README.en.md)

`pi-one-ui` 是面向 [Pi](https://pi.dev) 的统一 TUI 扩展包，旨在打造简洁、美观且高效的终端交互界面。项目最初通过源码级融合，将：

- [pi-zentui](https://github.com/lmilojevicc/pi-zentui) 的终端外壳与布局能力
- [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) 的对话内容渲染及生产力功能

整合为开箱即用、统一可配置的单一扩展包，并在此基础上持续进行模块重构、职责收敛和体验优化。

## 特性

### 统一的界面布局

`pi-one-ui` 将 Pi 的交互界面划分为以下布局层级：

```text
Header → Context → WorkingLine → Editor → Footer
```

- **Header**：启动信息、Logo 和快捷键提示。
- **Context**：对话内容区，包含用户消息、Assistant 消息、Thinking 思考过程、Tool 执行、Diff 对比、Markdown 及回合摘要。
- **WorkingLine**：工作状态指示、Spinner、Token/思考时长统计、实时吞吐速率及回合摘要。
- **Editor**：输入编辑器、补全建议、元数据展示及 Minimalist 极简样式（支持一键切换 Pi 原生）。
- **Footer**：工作目录、Git 状态、运行时信息、Token/费用统计及扩展状态等。
- **Overlay**：设置面板、Context Inspector 等临时浮层，统一由 OverlayManager 调度管理。

### 内置功能

| 功能                  | 说明                                                                   | 入口              |
| --------------------- | ---------------------------------------------------------------------- | ----------------- |
| 统一设置面板          | 集中管理 Header、Context、WorkingLine、Editor、Footer 等组件及功能设置   | `/oneui`          |
| Context Inspector     | 查看上下文占用，并预览 System prompt、Memory、Skills、Tools 及消息内容 | `/context`        |
| Session reference     | 搜索并引用注入历史 Pi 会话或 Subagent 的有效上下文                     | `@` 补全          |
| Subagent autocomplete | 提供 Subagent 名称补全与委派提示                                       | `@` 补全          |
| Tool / Diff renderer  | 工具调用、执行结果、折叠内容与 Edit/Write Diff 的统一美化渲染          | 自动生效          |
| Subagent live renderer | 保留 subagents 专用进度卡片，避免混入通用工具分组                    | 自动生效          |
| Markdown enhancement  | 支持 Mermaid 图表、提示框与 URL 链接化等增强渲染                       | 自动生效          |
| Built-in themes       | 内置 CC Dark 和 CC Light 主题                                          | `/theme`          |
| Compatibility aliases | 可选提供常用命令别名                                                   | `/clear`、`/exit` |
| Effort command        | 交互式或直接切换当前模型的 Thinking 思考档位                          | `/effort`         |

## 快速开始

### 环境要求

- Node.js `>=22.19.0`
- Pi 及其相关运行时包 `>=0.84.0`

### 从 npm 安装

```bash
pi install npm:pi-one-ui
```

### 从 GitHub 安装

```bash
pi install git:github.com/kerolt/pi-one-ui
```

安装完成后，在 Pi 中重新加载扩展：

```text
/reload
```

然后使用统一入口打开设置：

```text
/oneui
```

### 升级到 0.7.0

本次新增 Editor 工作目录显示开关，并修复修改 Editor 配置后关闭 `/oneui` 导致输入不可见的问题。现有配置无需迁移，工作目录仍默认显示。

未固定版本的 npm 安装可执行：

```bash
pi update npm:pi-one-ui
```

若安装时固定了版本，执行 `pi install npm:pi-one-ui@0.7.0` 更新版本指定。更新安装包后，完整退出并重启 Pi。

如需隐藏 Editor 目录，设置 `components.editor.styles.minimalist.showCwd: false`；Footer 中的目录显示独立配置。完整示例见 [配置指南](./docs/configuration.md#隐藏-editor-目录在-footer-左侧显示)。

## 配置

### 配置方式

`pi-one-ui` 统一使用 Canonical v1 格式的配置文件：

```text
~/.pi/agent/pi-one-ui.json
```

提供两种配置途径：

1. **交互式设置面板（推荐）**：在 Pi 会话中运行 `/oneui`，即可调整常用组件开关、样式和边框模式。组件设置保存后即时应用；Features 开关在 `/reload` 后应用。Preset 一次保存全部相关设置并更新对应组件。
2. **手动编辑配置文件**：高级用户可直接编辑 JSON 配置文件以启用更多细粒度选项。修改保存后，在 Pi 中执行 `/reload` 即可生效。文件不存在时将直接使用内置默认值。

配置文件损坏或无法读取时会报告错误。保存失败时保持当前设置；保存成功但组件应用失败时，面板会明确提示应用失败。

### 基础配置示例

以下为一个典型的 v1 配置文件结构：

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "static"
    },
    "footer": {
      "style": "starship"
    },
    "workingLine": {
      "enabled": true
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    }
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto"
  },
  "panel": {
    "anchor": "top-center",
    "width": "85%",
    "maxHeight": "90%",
    "margin": { "top": 6, "right": 1, "bottom": 1, "left": 1 }
  }
}
```

### 深度配置与文档指引

各项组件开关、模板变量与颜色字段的完整规范拆分收录于独立文档中，便于按需查阅：

- **组件开关与排版定制**：详见 [Editor 与 Footer 配置指南 (docs/configuration.md)](./docs/configuration.md)
  - **Editor**：支持 `style`（`on` 极简装饰 / `off` 原生）、`borderColorMode`（固定色 / 思考档位自适应）、`modelLabel` 及 Minimalist 装饰细节（目录显示与格式、会话名、耗时、费用、Git 状态等）。`components.editor.styles.minimalist.showCwd`（0.7.0 起，默认 `true`）可单独隐藏工作目录，不影响 Footer；`pathDisplay` 继续控制目录格式。
  - **Footer**：支持 Starship 风格排版，提供丰富的模板变量（`$cwd`、`$git_branch`、`$tokens`、`$cost` 等），支持通过 `format` 自定义或通过 `segments` 控制各段开关，并可自由配置上下文占用率的展示形式（gauge / text）。
  - **WorkingLine**：内置实时输出速率检测（单次响应持续 >=500ms 自动追加如 `⚡12 tok/s`，按回合独立重置）。
- **设置面板（`/oneui`）定制**：通过顶层 `panel` 字段控制浮层位置与尺寸，全部字段可省略（缺省值见上文示例）。
  - `anchor`：锚点，支持 `center`、`top-left`、`top-right`、`bottom-left`、`bottom-right`、`top-center`、`bottom-center`、`left-center`、`right-center`。
  - `width` / `maxHeight`：列数 / 行数，或 `"85%"` 形式的百分比字符串。
  - `margin`：距终端边缘的外边距，可以是四边统一数字，也可以是按 `top`/`right`/`bottom`/`left` 分别配置的对象。
  - 修改保存后下次打开 `/oneui` 即生效，无需 `/reload`。
- **颜色体系与主题定制**：详见 [Editor 颜色配置说明 (docs/editor-colors.md)](./docs/editor-colors.md)
  - 所有颜色统一按 Theme 语义解释，优先解析为当前主题语义 Token（随主题自动切换），ANSI 色名自动映射为语义色（如 `red` 对应 `error`）；如需固定色彩，可直接指定 Hex、256 色索引或 `fg:`/`bg:` 前缀。
  - 支持完整的 Thinking 思考档位（Low 至 Max）自适应边框与标签分级配色。
- **历史版本迁移**：旧版升级带来的字段收敛（如 `opencode` 样式统一合并入 `minimalist`、`colorSource` 双模式移除等）参见 [docs/configuration.md 变更与迁移节](./docs/configuration.md#6-变更与迁移)。

## 上游来源与项目演进

`pi-one-ui` 最初以两个开源项目的源码为基础进行整合。由衷感谢两个上游项目及其贡献者的出色工作：

| 上游项目                                                        | 融入 `pi-one-ui` 的主要能力                                                | 参照 Baseline              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| [pi-zentui](https://github.com/lmilojevicc/pi-zentui)           | Starship 风格 Footer、Editor 基础布局与 Shell 交互能力                      | v0.21.0，commit `5341b38` |
| [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) | Claude Code 风格 Context 渲染器、Tool/Diff 视图、Context Inspector 与会话引用 | v0.8.67，commit `dba37e5` |

融合后的生产代码位于 `extensions/`。`pi-one-ui` 在原始实现之上完成了入口统一、配置存储规范化、生命周期治理、Layout Ownership 收敛、Overlay 统一调度与输入路由解耦，并持续独立演进。当前实现已完全独立于上游，不依赖也不自动同步上游分支。

更详细的模块边界、事件流与 Ownership 约定参见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 本地开发

### 获取源码

```bash
git clone https://github.com/kerolt/pi-one-ui.git
cd pi-one-ui
npm install
```

项目要求 Node.js `>=22.19.0`。如果本机安装了多个 Node.js 版本，请先切换到满足要求的版本。

### 开发模式运行

直接使用当前源码启动 Pi：

```bash
npm run pi:dev
```

该命令等价于：

```bash
pi --no-extensions -e ./extensions/index.ts
```

也可以将当前 package 以本地链接方式安装：

```bash
npm run pi:install-local
```

修改代码后，在 Pi 中执行：

```text
/reload
```

### 常用开发命令

| 命令                   | 用途                               |
| ---------------------- | ---------------------------------- |
| `npm install`          | 安装依赖                           |
| `npm run format`       | 格式化源码、测试和配置文件         |
| `npm run check`        | 检查格式和 import organization     |
| `npm run fix`          | 修复格式并整理 imports             |
| `npm run typecheck`    | 执行 TypeScript 类型检查           |
| `npm test`             | 使用 Vitest 运行全部测试           |
| `npm run pack:check`   | 预览 npm 实际打包内容              |
| `npm run verify`       | 执行 Biome check、类型检查和全部测试 |

提交修改前建议至少运行：

```bash
npm run verify
npm run pack:check
```

### 源码职责

- `extensions/app/runtime/`：装配、共享事件、session 生命周期、渲染调度和 patch 管理。
- `extensions/app/config/`：配置类型、规范化和统一存储。
- `extensions/app/settings/`：设置操作、Preset 与 `/oneui` 打开流程。
- `extensions/app/overlay/`：Overlay 生命周期、焦点协作和输入路由。
- `extensions/layouts/`：组件行为与渲染；设置面板、Context Inspector 和 Selector 视图位于 `layouts/overlay/`。
- `extensions/features/`、`extensions/services/`：功能实现与共享数据，由 app 统一组织。

模块约束和真实 Pi TUI 验证命令见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

### 测试组织

所有测试统一由 Vitest 执行，并按照功能领域组织在子目录中：

- `tests/config/`：canonical 配置、存储和兼容性边界。
- `tests/context/`：Context 内容区、Tool、Diff、Thinking 和鼠标交互。
- `tests/header/`、`tests/working-line/`、`tests/editor/`、`tests/footer/`：各 Layout 的行为和生命周期。
- `tests/runtime/`、`tests/overlay/`、`tests/integration/`：运行时基础设施、Overlay 和组合入口。
- `tests/services/`：Git、runtime、project、session 和 telemetry。
- `tests/shell/`：剩余布局生命周期 glue 和 standalone compatibility。
- `tests/support/`、`tests/fixtures/`：共享测试工具和 fixtures。

涉及 TUI 生命周期的修改，应特别覆盖 reload、session tree rebuild、compact、regular/fullscreen TUI、headless mode、overlay 和第三方 patch ownership 等场景。

## 发布

用户可见变更和升级说明统一记录在 [CHANGELOG.md](./CHANGELOG.md)。开发中的变更先写入 `Unreleased`，正式发版时再归档到对应版本。

项目使用 GitHub Actions 进行持续集成和 npm 发布：

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)：在 Pull Request 和 `main` 分支提交时执行完整验证。
- [`.github/workflows/publish.yml`](./.github/workflows/publish.yml)：推送符合 `v*.*.*` 格式的 tag 时发布 npm 包。

发布新版本时：

```bash
# 确认位于 main，并同步远程代码
git switch main
git pull --ff-only origin main

# 发布前检查
npm ci
npm run verify
npm run pack:check

# 按 SemVer 升级版本
npm version patch   # 向后兼容的修复，例如 0.2.1 -> 0.2.2
# npm version minor # 0.x 阶段的新功能或破坏性变更
# npm version major # 进入稳定 1.x 后的破坏性变更

# 推送版本 commit 和 tag
git push origin main --follow-tags
```

推送 tag 后，发布 workflow 会校验 tag 版本与 `package.json` 版本一致，重新执行验证，并通过 npm Trusted Publishing 发布带 provenance 的公开包。已发布的 npm 版本不可覆盖，因此不要重复使用已经发布过的版本号或 tag。

## 贡献

欢迎通过 GitHub Issues 报告问题或提出改进建议。提交代码时建议：

1. 保持每个 commit 只包含一个主要目的。
2. 使用简洁的 Conventional Commit message，例如 `fix: prevent settings panel freeze after editor toggle`。
3. 为行为修改补充或更新测试。
4. 提交前运行 `npm run verify` 和 `npm run pack:check`。

## 许可证

本项目基于 [MIT License](./LICENSE) 发布。
