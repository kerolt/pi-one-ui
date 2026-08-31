import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type CompactStyleMode,
  type Config,
  config,
  normalizeConfig,
  setConfig,
  updateConfig,
} from "../../../app/config/renderer.ts";
import { isLazyProxyTui } from "../../../tools/fullscreen-detect.ts";
import {
  GLOBAL_COMPACTION_RENDER_PATCH,
  patchRegistry,
} from "../../../tools/patch-keys.ts";
import type { CompactThinkingController } from "../thinking/compact-thinking.ts";
import {
  type CompactModeHooks,
  type CompactThinkingQuery,
  installCompactMode,
  refreshCompactModeComponents,
} from "./compact-mode.ts";
import {
  type DefaultModeHooks,
  installDefaultMode,
  installToolExpandedBackground,
} from "./default-mode.ts";
import { setHoveredToolGroup, setHoveredToolIo } from "./mouse/hover.ts";
import {
  installToolMouseInteraction,
  resetToolHoverState,
  scheduleSessionRender,
  TOOL_MOUSE_DISABLE,
  teardownToolMouseInteraction,
} from "./mouse/interaction.ts";
import { getToolMouseTui } from "./mouse/scroll.ts";
import {
  installWriteOverride,
  WriteExecutionMetadataStore,
} from "./tool/diff/index.ts";
import {
  installToolGrouping,
  type ToolGroupingHooks,
} from "./tool/grouping.ts";
import {
  installMessageDisplayRendering,
  refreshMessageDisplays,
  setMessageDisplayTheme,
} from "./tool/message-display.ts";
import { clearAllAnimations } from "./tool/result.ts";

/**
 * Claude Code Style for pi — 装配入口。
 *
 * mode=on      → default-mode（工具卡样式 + 展开背景）
 * mode=compact → compact-mode（消息折叠摘要）
 * 共用        → tool-grouping / message-display / mouse / write override
 */

let compactModeHooks: CompactModeHooks | undefined;

function refreshCurrentContext(
  ctx?: any,
  toolGrouping?: ToolGroupingHooks,
): void {
  const tui = getToolMouseTui();
  toolGrouping?.refresh(tui);
  refreshMessageDisplays(tui);
  refreshCompactModeComponents(tui);
  compactModeHooks?.refresh();
  tui?.requestRender?.(true);
  ctx?.ui?.requestRender?.(true);
}

function syncCompactMode(ctx: any): void {
  refreshCompactModeComponents(getToolMouseTui());
  compactModeHooks?.sync(ctx);
}

function applyStyleMode(
  mode: CompactStyleMode,
  ctx: any,
  toolGrouping?: ToolGroupingHooks,
): void {
  updateConfig({ mode });
  if (mode === "off") {
    // Native rendering：清 hover/click，关闭鼠标上报以恢复终端默认滚轮。
    resetToolHoverState();
    setHoveredToolGroup(null);
    setHoveredToolIo(null, null);
    // 惰性 Proxy（regular/fullscreen）不持有 reporting：regular 保终端回滚，
    // fullscreen 归官方所有，均不能在此关闭。
    const tui = getToolMouseTui();
    if (tui && !isLazyProxyTui(tui)) {
      tui.terminal?.write?.(TOOL_MOUSE_DISABLE);
    }
  } else if (mode === "compact") {
    // Enter compact mode after collecting the current context and syncing ownership.
    syncCompactMode(ctx);
  }
  // Reshape immediately and once more after the panel/custom UI unmounts and
  // the main context is mounted again.
  refreshCurrentContext(ctx, toolGrouping);
  scheduleSessionRender(() => {
    if (mode === "compact") syncCompactMode(ctx);
    refreshCurrentContext(ctx, toolGrouping);
  });
  ctx.ui.notify(`Claude Code style: ${mode}`, "info");
}

type LegacyCompactionRenderPatch = {
  enabled?: () => boolean;
};

/** Disable the pre-native compaction monkey patch left alive by /reload. */
function deactivateLegacyCompactionRendering() {
  const patch = patchRegistry.get<LegacyCompactionRenderPatch>(
    GLOBAL_COMPACTION_RENDER_PATCH,
  );
  if (patch) patch.enabled = () => false;
}

export type RendererRuntimeController = {
  setMode: (mode: CompactStyleMode, ctx: any) => void;
  updateConfig: (partial: Partial<Config>, ctx: any) => void;
};

export type RendererExtensionOptions = {
  onRuntimeController?: (controller: RendererRuntimeController) => void;
};

export default function (
  pi: ExtensionAPI,
  configOverride?: Partial<Config>,
  compactThinking?: CompactThinkingController,
  options: RendererExtensionOptions = {},
) {
  // 可选 override：集成测试不依赖用户全局配置。
  if (configOverride)
    setConfig(normalizeConfig({ ...config, ...configOverride }));
  const writeExecutionMetadata = new WriteExecutionMetadataStore();
  const mouseOwner = {};
  let installation:
    | {
        defaultMode: DefaultModeHooks;
        toolGrouping: ToolGroupingHooks;
        compactMode: CompactModeHooks;
        disposeMessageDisplay: () => void;
        disposeToolExpandedBackground: () => void;
      }
    | undefined;

  const ensureTuiInstallation = (ctx: any) => {
    if (ctx?.mode !== "tui" || !ctx?.hasUI) return undefined;
    // 渲染层（工具样式/分组）是原型与组件级 patch，fullscreen 官方布局
    // 同样渲染这些组件，因此两种模式都安装。
    if (installation) return installation;
    const defaultMode = installDefaultMode(writeExecutionMetadata);
    const toolGrouping = installToolGrouping(() => config.mode === "on");
    const compactMode = installCompactMode({
      query: compactThinking as CompactThinkingQuery | undefined,
      writeMetadata: writeExecutionMetadata,
    });
    compactModeHooks = compactMode;
    const disposeMessageDisplay = installMessageDisplayRendering();
    // 展开背景必须在 compact-mode 之后装，shutdown 时先于 compact 释放。
    const disposeToolExpandedBackground = installToolExpandedBackground();
    deactivateLegacyCompactionRendering();
    installation = {
      defaultMode,
      toolGrouping,
      compactMode,
      disposeMessageDisplay,
      disposeToolExpandedBackground,
    };
    return installation;
  };

  options.onRuntimeController?.({
    setMode: (mode, ctx) =>
      applyStyleMode(mode, ctx, installation?.toolGrouping),
    updateConfig: (partial, ctx) => {
      updateConfig(partial);
      refreshCurrentContext(ctx, installation?.toolGrouping);
    },
  });

  pi.on("message_update", async (event) => {
    // compact-thinking 在 session_start 时于 compact 补丁之上再装一层；
    // 扩展事件先于 interactive-mode 的 updateContent 派发，此处先重新认领。
    if (config.mode === "compact" && event.message?.role === "assistant") {
      compactModeHooks?.assertOwnership();
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (config.mode !== "compact") return;
    // Agent 等工具收尾后延迟刷新，让 compact-thinking 先落最终态。
    const toolCallId: string | undefined = event?.toolCallId;
    setTimeout(() => {
      compactModeHooks?.refreshToolCallMessage(toolCallId);
    }, 0);
  });

  pi.on("session_start", async (event, ctx) => {
    // 延迟到 session_start 注册 write override：加载阶段 getAllTools 不可用且其他扩展
    // 尚未注册工具，无法检测外部 write 所有者（如 pi-spark），直接注册会与对方撞名。
    // session_start 时所有扩展已加载完毕，installWriteOverride 内部会检测并让位。
    installWriteOverride(pi, writeExecutionMetadata);
    const hooks = ensureTuiInstallation(ctx);
    // 鼠标交互独立于渲染层：fullscreen 渲染层让位（hooks undefined）但
    // 工具点击/回到底部适配仍需安装；保持在渲染层安装之后以维持原顺序。
    if (ctx?.mode === "tui" && ctx?.hasUI)
      installToolMouseInteraction(ctx, mouseOwner);
    if (!hooks) return;
    hooks.toolGrouping.setTheme(ctx.ui.theme);
    setMessageDisplayTheme(ctx.ui.theme);
    ctx.ui.setStatus("ccstyle", undefined);
    // Collect the resumed context before syncing compact patches and expansion state.
    syncCompactMode(ctx);
    // compact-thinking 的 session_start 处理在本 handler 之后执行（在其之上再装
    // 一层 updateContent）；延迟再同步一次，保证 compact 补丁最终位于外层。
    setTimeout(() => syncCompactMode(ctx), 0);
    scheduleSessionRender(() => hooks.toolGrouping.refresh(getToolMouseTui()));
  });

  pi.on("session_compact", async (event, ctx) => {
    const hooks = ensureTuiInstallation(ctx);
    // Compaction rebuilds the context without session_start. Rebind after
    // other TUI extensions may have replaced the root input dispatcher.
    if (ctx?.mode === "tui" && ctx?.hasUI)
      installToolMouseInteraction(ctx, mouseOwner);
    if (!hooks) return;
    hooks.toolGrouping.setTheme(ctx.ui.theme);
    setMessageDisplayTheme(ctx.ui.theme);
    syncCompactMode(ctx);
    scheduleSessionRender(() => {
      syncCompactMode(ctx);
      hooks.toolGrouping.refresh(getToolMouseTui());
    });
  });

  pi.on("session_tree", async (event, ctx) => {
    // 会话树重建后在当前帧和下一帧各同步一次，替换旧组件引用。
    if (ctx?.mode !== "tui" || !ctx?.hasUI) return;
    syncCompactMode(ctx);
    scheduleSessionRender(() => syncCompactMode(ctx));
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    installation?.toolGrouping.setTheme(ctx.ui.theme);
  });

  pi.on("session_shutdown", async () => {
    writeExecutionMetadata.clear();
    // 鼠标交互独立于渲染层：fullscreen 下 installation 为 undefined，
    // 但 onTerminalInput 监听与 handleViewportInput 包装仍需释放。
    teardownToolMouseInteraction(mouseOwner);
    const current = installation;
    if (!current || !current.defaultMode.isOwner()) return;
    current.defaultMode.shutdown();
    current.toolGrouping.shutdown();
    current.disposeToolExpandedBackground();
    current.compactMode.shutdown();
    compactModeHooks = undefined;
    current.disposeMessageDisplay();
    deactivateLegacyCompactionRendering();
    clearAllAnimations();
    installation = undefined;
  });
}

// ---- 对外导出：入口/测试实际消费的符号 ----
export { getCompactThinkingConfig } from "../../../app/config/renderer.ts";
export {
  humanizeMcpToolName,
  isMcpToolDefinition,
  preservesOriginalRenderer,
  shouldRenderRichDiff,
} from "./default-mode.ts";
export { installToolMouseInteraction } from "./mouse/interaction.ts";
export {
  ExpandedToolIoView,
  ExpandedToolResultText,
  formatToolInputArgs,
  SHOW_MORE_LABEL,
} from "./tool/result.ts";
