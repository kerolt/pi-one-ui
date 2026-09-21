# pi-one-ui Architecture

## 1. 产品与源码范围

`pi-one-ui` 是一个 Pi TUI 扩展包。生产代码位于 `extensions/`，`vendor/` 保留只读的上游参考，`node_modules/` 为依赖目录。

- `app/`：统一组织组件、Feature 和 Service，管理配置、共享生命周期和跨组件协作。
- `layouts/`：实现组件行为、渲染、局部状态及自身资源释放。
- `features/`：实现命令、补全、上下文收集等功能。
- `services/`：提供 Git、项目、session、runtime 和 telemetry 数据。
- `shared/`、`tools/`：提供共享格式化、文本处理及兼容性工具。

## 2. 界面职责

- Header：启动信息与提示，拥有 `ctx.ui.setHeader()`。
- Context：用户消息、Assistant、Thinking、Tool、Diff、Markdown 和摘要的内容渲染。
- WorkingLine：工作状态、耗时、统计及对应的 Pi working row。
- Editor：编辑器工厂、装饰、输入内容转移及 Editor 自身 ownership。
- Footer：Footer 工厂、内容、状态数据展示及 Footer 自身 ownership。
- Overlay Layout：设置面板、Context Inspector、文本预览和 Selector 的视觉实现。

Layout 只操作自己负责的 Pi UI 接口。跨组件共享数据通过 app 连接；Git、session 和 telemetry 计算继续由 Service 提供。

## 3. App 目录

### `app/runtime/`

- `tui-runtime.ts`：产品装配入口，创建 Layout、Feature、Service 及管理对象。
- `event-coordinator.ts`：共享事件注册、处理顺序和事件结果传递。
- `session-lifecycle.ts`：session generation、延迟任务及失效检查。
- `render-scheduler.ts`：合并同一个 Pi TUI 的刷新请求，保留强制刷新要求。
- `prototype-patch-registry.ts`：prototype patch 的安装、ownership 检查和恢复。
- `flush-docked-bash.ts`：session 所需的 Pi dock 行为适配。

`extensions/index.ts` 创建并安装 `TuiRuntime`。`createLayoutRuntime()` 是该入口实际使用的组件装配函数，组件集成测试直接使用它。

### `app/config/`

- `store.ts`：canonical 路径、JSON 读取、文件状态检查、原子写入和更新通知。
- `editor.ts`、`footer.ts`、`context.ts`、`working-line.ts`：对应配置的类型、默认值与规范化。
- `shell.ts`：组合各组件的 canonical 配置，并提供组件配置修改操作。
- `renderer.ts`：Context 渲染配置及现有 `renderer` 字段内的功能开关。
- `panel.ts`：面板位置和尺寸。
- `values.ts`：配置对象的共享处理。

运行时组件配置使用 `components.editor`、`components.footer` 等 canonical 路径。

### `app/settings/`

- `controller.ts`：设置项校验、修改提交、配置快照及修改意图通知。
- `presets.ts`：在同一配置记录中应用 Preset。
- `panel.ts`：`/oneui` 的打开流程、配置提交和通知。

设置面板通过 `snapshot()` 与 `update()` 获取数据和提交修改。Layout 的 `applyConfig()` 只应用已提交的配置。

### `app/overlay/`

- `overlay-manager.ts`：打开和关闭 Overlay，管理活动状态、session 取消和 Editor 焦点协作。
- `input-router.ts`：输入路由的优先级与 Pi terminal listener 的配对注册和移除。

`TuiRuntime` 为每个运行时创建独立的 `OverlayManager` 和 `InputRouter`，并提供给使用它们的功能和组件。

## 4. 生命周期与事件

共享生命周期事件通过 `EventCoordinator` 向 Pi 注册，每种共享事件有一个 host listener。组件和 Feature 的处理按注册顺序执行，同步处理保持同步；异步处理完成后继续后续处理。

`message_end` 保留消息替换语义，并要求替换后的 role 保持一致。具有独立结果语义的专用 hook 继续使用 Pi 接口；renderer 专用 hook 的具体行为保留在对应 Layout。

session 开始时，app 启用资源管理对象、开始 generation、订阅配置并安装组件。session 结束时：

1. 关闭 Overlay 并移除输入监听。
2. 结束 generation，取消延迟任务和配置订阅。
3. 释放组件、Service 和 session patch。
4. 清除刷新入口及剩余 session 状态。

Layout 可以检查 generation 和安排受管理的任务。整个 session 的 `start()`、`shutdown()` 由 app 调用。

## 5. 配置提交

唯一持久化文件为 `~/.pi/agent/pi-one-ui.json`，继续使用 canonical v1，包括 `version`、`projectRefreshIntervalMs`、`icons`、`colors`、`components`、`renderer` 和 `panel`。

一次设置修改的处理顺序为：校验输入、修改配置记录、原子写入、发布配置、由对应 Layout 应用变化并请求刷新。Preset 在一次写入中修改全部相关组件。未知的配置字段和未修改的选项继续保留。

- 文件不存在时使用默认配置，不创建文件。
- 文件损坏或无法读取时报告读取错误。
- 保存失败时不发布更新。
- 保存成功后应用失败时，`ConfigApplicationError` 携带已提交的记录，并区分保存结果和界面应用结果。
- Header 与组件设置即时应用；需要重新注册的 Feature 开关在 `/reload` 后应用。

## 6. 渲染与 Overlay

组件工厂将 Pi 提供的实际 TUI 刷新回调注册到共享 `RenderScheduler`。app 的跨组件刷新统一经过该调度器；组件自己的输入交互和专用 renderer 刷新仍由组件处理。

Scheduler 合并同一轮请求。session 结束后移除刷新入口，并使已排队的请求失效。

`layouts/overlay/` 提供窗口内容，`OverlayManager.open()` 调用 Pi 的 Overlay 接口。窗口关闭与异常路径都释放活动记录。session 取消使已有窗口循环失效，Context Inspector 的预览关闭后不会在旧 session 中重新打开窗口。

设置面板修改 Editor 时，OverlayManager 跟踪实际替换后的 Editor。关闭面板只修正仍由该面板拥有的返回目标，保留其他 Overlay 和后续 Editor owner 的焦点。

## 7. Ownership 与清理

- 装配代码为每个视觉职责创建一个 canonical owner。
- Layout 的实际 owner token 保留在对应的 Editor、Footer 或 renderer 实现中。
- prototype patch 只恢复自身仍然安装的方法；第三方后续安装的方法保持有效。
- cleanup 必须幂等，并检查 session 或安装实例的 ownership。
- 输入 route 与 host listener 必须共同释放。
- app 通过 Layout 的公开操作协调行为，视觉逻辑保持在 Layout 内。

## 8. 验证

相关领域测试通过后执行：

```bash
npm run format
npm run check
npm run typecheck
npm test
npm run verify
npm run pack:check
```

`tests/integration/runtime-sdk.test.ts` 使用真实 Pi SDK 加载生产入口，覆盖 headless、reload、session tree 和 session replacement。

可在真实终端或 PTY 中运行实际 Pi TUI 验证：

```bash
node --experimental-transform-types tests/support/runtime-tui-probe.ts regular
node --experimental-transform-types tests/support/runtime-tui-probe.ts fullscreen
```

该程序使用临时配置和实际 Pi 组件，验证设置面板、Context Inspector、Editor 输入与焦点、Preset、reload、session tree、session replacement、输入监听和第三方 Editor。验证不发送模型请求。

Runtime/TUI 修改还需覆盖 compact、第三方 prototype patch、旧 generation 的异步任务和异常清理。
