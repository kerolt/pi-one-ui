import { config } from "../../../../app/config/renderer.ts";
import { isLazyProxyTui } from "../../../../tools/fullscreen-detect.ts";
import {
  patchRegistry,
  TOOL_MOUSE_TUI_SLOT,
} from "../../../../tools/patch-keys.ts";

/**
 * 当前安装的 tui 宿主。由 mouse-interaction 经 setToolMouseTui 维护；
 * 跨模块一律经绑定/setter 访问。
 *
 * 状态镜像到 globalThis（Symbol 槽）：jiti 转译下经 re-export 链读取的
 * 模块级 let 绑定是初始值快照（死绑定，实测恒 null），函数调用才是活引用。
 * 跨模块读取一律用 getToolMouseTui()，避免拿到加载时的快照。
 */
patchRegistry.ensure(TOOL_MOUSE_TUI_SLOT, () => null);
export let toolMouseTui: any = null;
export function getToolMouseTui(): any {
  return patchRegistry.get(TOOL_MOUSE_TUI_SLOT);
}
export function setToolMouseTui(tui: any): void {
  toolMouseTui = tui;
  patchRegistry.install(TOOL_MOUSE_TUI_SLOT, tui);
}

// 交互开关只取决于配置模式：原实现按 isLazyProxyTui(toolMouseTui) 分两分支，
// 两分支恒真（0.84+ 惰性 Proxy 下判定不再影响开关），折叠为单条件。
export function toolMouseInteractionActive(): boolean {
  return config.mode !== "off";
}

/** 惰性 Proxy 官方 fullscreen（TuiAltScreen）判定。 */
export function fullscreenLazyTui(tui: any): boolean {
  return isLazyProxyTui(tui) && tui.mode === "fullscreen";
}
