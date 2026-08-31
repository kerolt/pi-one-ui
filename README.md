# pi-one-ui

[![npm version](https://img.shields.io/npm/v/pi-one-ui?style=flat-square)](https://www.npmjs.com/package/pi-one-ui)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/kerolt/pi-one-ui?style=flat-square)](./LICENSE)

简体中文 | [English](./README.en.md)

`pi-one-ui` 是一个面向 [Pi](https://pi.dev) 的统一 TUI 扩展包。项目的初衷是希望打造一个简单美观的 TUI 界面，最初通过源码级融合，将：

- [pi-zentui](https://github.com/lmilojevicc/pi-zentui)`pi-zentui` 的终端外壳能力
- [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) 的对话内容渲染及生产力功能

整合到同一个可安装、可配置的 Pi package 中，并在此基础上持续进行模块重构、职责收敛和独立优化。

## 特性

### 统一的界面布局

`pi-one-ui` 将 Pi 的交互界面划分为以下布局：

```text
Header → Context → WorkingLine → Editor → Footer
```

- **Header**：启动信息、Logo 和快捷键提示。
- **Context**：对话内容区，包含用户消息、Assistant 消息、Thinking、Tool、Diff、Markdown 和 Summary。
- **WorkingLine**：工作状态、spinner、token/thought/elapsed 信息和回合摘要。
- **Editor**：输入编辑器、completion、metadata、Accent Rail 和 Minimalist 样式。
- **Footer**：目录、Git、runtime、token、cost 和扩展状态等信息。
- **Overlay**：设置面板、Context Inspector 等临时浮层由统一的 OverlayManager 管理。

### 内置功能

| 功能                  | 说明                                                                   | 入口              |
| --------------------- | ---------------------------------------------------------------------- | ----------------- |
| 统一设置面板          | 按 Header、Context、WorkingLine、Editor、Footer 和 Features 组织设置   | `/oneui`          |
| Context Inspector     | 查看上下文占用，并预览 System prompt、Memory、Skills、Tools 和消息内容 | `/context`        |
| Session reference     | 搜索并注入历史 Pi session 或 SubAgent 的有效上下文                     | `@` 补全          |
| Subagent autocomplete | 提供 SubAgent 名称补全和委派提示                                       | `@` 补全          |
| Tool / Diff renderer  | 工具调用、结果、折叠内容和 Edit/Write diff 的统一展示                  | 自动生效          |
| Markdown enhancement  | 支持 Mermaid、提示框和 URL 链接化等增强渲染                            | 自动生效          |
| Built-in themes       | 提供 CC Dark 和 CC Light 主题                                          | `/theme`          |
| Compatibility aliases | 可选提供常用命令别名                                                   | `/clear`、`/exit` |

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

## 配置

配置文件位于：

```text
~/.pi/agent/pi-one-ui.json
```

推荐通过 `/oneui` 设置面板修改配置。当前配置仍使用 v1 结构，例如：

```json
{
  "version": 1,
  "components": {
    "editor": {
      "enabled": true,
      "style": "opencode"
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    },
    "workingLine": {
      "enabled": true
    },
    "footer": {
      "style": "starship"
    }
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto"
  }
}
```

不同布局和渲染器的可用选项会随版本变化，建议优先使用 `/oneui` 面板进行配置。

### Canonical 配置约定

`pi-one-ui` 只读取和写入：

```text
~/.pi/agent/pi-one-ui.json
```

不会自动读取、合并或迁移其他历史配置文件，也不会解析旧版扁平字段和旧 style 名称。配置文件不存在时，运行时直接使用内置默认值；首次通过 `/oneui` 修改设置时才创建文件。所有持久化修改统一写入当前 v1 的 `components` 和 `renderer` 结构。

## 上游来源与项目演进

`pi-one-ui` 以以下两个开源项目的源码为初始基础，并对它们进行源码级融合。在此再次感谢两个上游项目及其贡献者，他们为 `pi-one-ui` 提供了最初的实现基础。

| 上游项目                                                        | 融入 `pi-one-ui` 的主要能力                                                | 参照baseline              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| [pi-zentui](https://github.com/lmilojevicc/pi-zentui)           | Starship 风格 Footer、Opencode 风格 Editor、布局和 shell 能力              | v0.21.0，commit `5341b38` |
| [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) | Claude Code 风格 Context renderer、Tool/Diff、Context Inspector 和引用功能 | v0.8.67，commit `dba37e5` |

融合后的生产代码位于 `extensions/`。项目已经在原始实现之上统一入口、配置存储、生命周期、Layout ownership、Overlay 和输入路由，并会继续独立演进；当前实现不再等同于任一上游项目，也不会自动跟随上游同步。

感谢两个上游项目及其贡献者。它们为 `pi-one-ui` 提供了最初的实现基础，而本项目后续的工作重点是将这些能力收敛为一个边界清晰、可持续维护的统一产品。

更详细的模块边界、事件流和 ownership 约定参见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

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
| `npm test`             | 运行全部测试                       |
| `npm run test:node`    | 运行 Node.js test runner 测试      |
| `npm run test:vitest`  | 运行 Vitest 测试                   |
| `npm run pack:check`   | 预览 npm 实际打包内容              |
| `npm run verify`       | 执行 Biome check、类型检查和全部测试 |

提交修改前建议至少运行：

```bash
npm run verify
npm run pack:check
```

### 测试组织

测试按照功能领域划分：

- `tests/context-*`：Context 内容区、Tool、Diff、Thinking 和鼠标交互。
- `tests/working-line-*`：WorkingLine 和 turn summary。
- `tests/editor-*`：Editor、completion、metadata、transfer 和 Accent Rail。
- `tests/footer-*`：Footer、Footer format/layout/status。
- `tests/services-*`：Git、runtime、project、session 和 telemetry。
- `tests/shell-*`：剩余布局生命周期 glue 和 standalone compatibility。

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
