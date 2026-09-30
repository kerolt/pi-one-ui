import { withBuiltInRenderers } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/renderers/index.js";

/**
 * Pi 0.99 起 ToolExecutionComponent 不再自行查找内置 renderer，改由调用方
 * 通过 withBuiltInRenderers 把内置 renderer 合并进定义后传入构造器（见
 * interactive-mode 的 getRegisteredToolDefinition）。测试按同样契约取定义，
 * 让工具卡走真实渲染路径；非内置工具名返回 undefined，保持无 renderer 分支。
 */
export function builtInToolDefinition(toolName: string): any {
  return withBuiltInRenderers(toolName, undefined);
}
