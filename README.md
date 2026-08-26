# pi-one-ui

`pi-one-ui` 是一个单一 Pi 插件包，将两个 UI 扩展合并为一个可自定义的源码仓库：

- **Zentui**：Editor、User message、Working line、Selector border、Footer
- **CC Style**：Tool renderer、Rich diff、Thinking、Compact transcript、鼠标交互和辅助功能

安装后只需要启用这个包，不需要再单独安装 `pi-zentui` 或 `pi-cc-extensions`。

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

`/oneui` 是唯一的公开管理命令，执行后直接打开融合后的交互面板。面板按 `Tab` / `Shift+Tab` 切换 Shell、Renderer、Features、Presets 分区。Shell 分区会显示 Editor 和 User Message 的实时样式预览；修改会立即写入统一配置，活动会话支持的样式也会自动重绘。

```text
~/.pi/agent/pi-one-ui.json
```

面板中的详细配置仍可直接编辑 JSON，以便开发自定义字段。

## 配置结构

Zentui 的配置保留在 JSON 根级，CC Style 的配置放在 `renderer` 下：

```json
{
  "version": 1,
  "components": {
    "editor": { "enabled": true, "style": "accent-rail" },
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

完整字段可参考上游快照：

- `vendor/pi-zentui/docs/configuration.md`
- `vendor/pi-cc-extensions/README.md`

Working line 的 owner 固定为 Zentui，因此默认关闭 CC Style 的 `enableWorkingMessage`，避免两个扩展争抢 Pi 的无 key working row。

## 来源与目录结构

本项目基于以下上游项目进行融合开发：

- `pi-zentui`：提供 Shell chrome、Editor、Footer、Working line 等能力
- `pi-cc-extensions`：提供 Tool renderer、Diff、Thinking 和 Transcript 能力

上游源码快照保存在 `vendor/` 中，仅用于追踪和同步。`extensions/` 按 `pi-one-ui` 的产品能力组织，不保留上游项目的目录结构：

```text
extensions/
  index.ts                 # 唯一公开入口和 /oneui 命令
  app/                     # 统一配置、面板、预设和应用装配
  shell/                  # Editor、Footer、Working line 等终端外壳能力
  transcript/             # Tool、Diff、Thinking 和消息渲染
  features/               # Context、Session reference、Agent summary 等功能
  tools/                  # Patch、ANSI、组件树和其他底层能力
vendor/                    # 上游只读参考快照和版本记录
```

公共入口只有 `/oneui`。Shell 和 Transcript 的内部 owner 由应用装配层统一管理，避免不同模块争抢同一个 Pi UI 接缝。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run pack:check
```

`npm test` 会同时运行：

- `node:test`：Transcript、工具渲染和融合入口测试
- `Vitest`：Shell 及其生命周期、布局和配置测试

测试文件按产品能力命名为 `tests/shell-*`、`tests/transcript-*` 和 `tests/one-ui-*`。

本地启动：

```bash
npm run pi:dev
```

上游快照版本记录在 `ARCHITECTURE.md`。更新上游时，先在 `vendor/` 中获取新快照，再将对应源码同步到 `extensions/`，不要直接修改 vendor 参考目录。
