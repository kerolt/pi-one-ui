import {
  AssistantMessageComponent,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Spacer,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { toolLoadingIcon } from "../../../../tools/tool-loading-icon.ts";
import { isToolTuiFullscreen, showMoreHintText } from "./show-more-hint.ts";
import {
  stripAnsi,
  stripBackgroundAnsi,
  stripLeadingStatusIcon,
} from "../../../../tools/ansi-text.ts";
import { walkComponentTree } from "../../../../tools/component-tree.ts";
import { humanizeToolLabel, toolCallSummary } from "./names.ts";
import {
  captureIoViewMarkers,
  getActiveIoViewFrame,
  isExpandedToolIoView,
  replayIoViewMarkers,
  type CapturedIoViewMarker,
  type ExpandedToolIoView,
  type ToolIoSection,
} from "./result.ts";
import {
  patchRegistry,
  TOOL_GROUPING_GENERATION_KEY as GENERATION_KEY,
  TOOL_GROUPING_PARENT_KEY as PARENT_KEY,
  TOOL_GROUPING_PATCH_KEY as PATCH_KEY,
} from "../../../../tools/patch-keys.ts";

const NON_GROUPABLE = new Set(["edit", "write", "apply_patch"]);

type Patch = {
  owner: object;
  active: boolean;
  prototype: any;
  original: { addChild: Function; removeChild: Function; clear: Function };
  installed: { addChild: Function; removeChild: Function; clear: Function };
  groups: Set<ToolGroupComponent>;
  enabled: () => boolean;
  generation: number;
  lastEnabled: boolean;
  theme?: any;
};

function toolName(tool: any): string {
  return String(tool?.toolName ?? tool?.toolDefinition?.name ?? "tool");
}

function isGroupable(value: unknown): boolean {
  return (
    value instanceof ToolExecutionComponent &&
    !NON_GROUPABLE.has(toolName(value))
  );
}

function isIgnorable(value: unknown): boolean {
  if (value instanceof Spacer) return true;
  if (!(value instanceof AssistantMessageComponent)) return false;
  const children = (value as any).contentContainer?.children;
  return Array.isArray(children) && children.length === 0;
}

function previousSibling(
  children: any[],
  start: number,
): { child: any; index: number } | undefined {
  let skipped = 0;
  for (let index = start; index >= 0; index--) {
    const child = children[index];
    if (isIgnorable(child) && skipped < 3) {
      skipped++;
      continue;
    }
    return { child, index };
  }
  return undefined;
}

type ToolStatus = "pending" | "success" | "error";

function status(tool: any): ToolStatus {
  if (tool?.result?.isError) return "error";
  if (tool?.isPartial === true || (tool?.executionStarted && !tool?.result))
    return "pending";
  return tool?.result ? "success" : "pending";
}

function statusIcon(value: ToolStatus): string {
  if (value === "success") return "✓";
  if (value === "error") return "✗";
  return toolLoadingIcon();
}

function visibleLines(lines: string[]): string[] {
  return lines.filter((line) => stripAnsi(line).trim());
}

function stripLeadingSpaces(line: string, count: number): string {
  let offset = 0;
  let removed = 0;
  let ansi = "";
  while (offset < line.length) {
    const control = line.slice(offset).match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0];
    if (control) {
      ansi += control;
      offset += control.length;
      continue;
    }
    if (removed < count && line[offset] === " ") {
      removed++;
      offset++;
      continue;
    }
    break;
  }
  return ansi + line.slice(offset);
}

/** 生成一行铺满 width 的 slot 背景行；bgAnsiOverride 可替换背景 ANSI（用于提亮等）。 */
export function paddedBackgroundRow(
  theme: any,
  slot: string,
  content: string,
  width: number,
  bgAnsiOverride?: string,
): string {
  const innerWidth = Math.max(0, width - 2);
  const clipped = truncateToWidth(stripBackgroundAnsi(content), innerWidth, "");
  const row = ` ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} `;
  const bgAnsi =
    bgAnsiOverride ||
    (typeof theme?.bg === "function"
      ? theme.getBgAnsi?.(slot) ||
        theme.bg(slot, "").match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0] ||
        ""
      : "");
  const stable = bgAnsi
    ? row.replace(/\x1b\[(?:0)?m/g, (reset) => reset + bgAnsi)
    : row;
  if (!bgAnsi)
    return typeof theme?.bg === "function" ? theme.bg(slot, stable) : row;
  return `${bgAnsi}${stable}\x1b[49m`;
}

function toolSummary(tool: any): { main: string; detail: string } {
  return toolCallSummary(toolName(tool), tool?.args ?? {}, {
    variant: "grouping",
  });
}

function toolNameList(tools: any[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools)
    counts.set(toolName(tool), (counts.get(toolName(tool)) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => `${name}${count > 1 ? `×${count}` : ""}`)
    .join(", ");
}

let nextGroupId = 1;

type SettledGroupCache = {
  width: number;
  expanded: boolean;
  hover: boolean;
  theme: unknown;
  fullscreen: boolean;
  children: readonly unknown[];
  args: unknown[];
  results: unknown[];
  statuses: ToolStatus[];
  callComponents: unknown[];
  resultComponents: unknown[];
  ioViews: Array<ExpandedToolIoView | undefined>;
  ioHoveredSections: Array<ToolIoSection | null | undefined>;
  ioRevisions: Array<number | undefined>;
  capturedIoFrame: boolean;
  lines: string[];
  ioMarkers: CapturedIoViewMarker[];
};

type SettledGroupCacheSlots = {
  collapsed?: SettledGroupCache;
  expanded?: SettledGroupCache;
};

type SettledExpandedChildCache = {
  width: number;
  theme: unknown;
  fullscreen: boolean;
  index: number;
  total: number;
  args: unknown;
  result: unknown;
  status: ToolStatus;
  expanded: boolean;
  callComponent: unknown;
  resultComponent: unknown;
  ioView: ExpandedToolIoView | undefined;
  ioHoveredSection: ToolIoSection | null | undefined;
  ioRevision: number | undefined;
  capturedIoFrame: boolean;
  lines: string[];
  ioMarkers: CapturedIoViewMarker[];
};

function toolIoView(tool: any): ExpandedToolIoView | undefined {
  for (const candidate of [
    tool?.rendererState?.ccstyleIoView,
    tool?.state?.ccstyleIoView,
    tool?.resultRendererComponent,
  ]) {
    if (isExpandedToolIoView(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function ioHoveredSection(
  view: ExpandedToolIoView | undefined,
): ToolIoSection | null | undefined {
  return view?.getHoveredSection();
}

function ioRenderRevision(
  view: ExpandedToolIoView | undefined,
): number | undefined {
  return view?.getRenderRevision();
}

export class ToolGroupComponent extends Container {
  readonly toolCallId = `ccstyle-tool-group-${nextGroupId++}`;
  readonly toolName = "Tool group";
  private _expanded = false;
  /** 分组是否展开（只读；测试与外部读状态用）。 */
  get expanded(): boolean {
    return this._expanded;
  }
  private hintHovered = false;
  private readonly patch: Patch;
  /** 已完成分组按折叠/展开槽位跨帧缓存；pending 走子工具级缓存。 */
  private settledCaches: SettledGroupCacheSlots = {};
  private settledExpandedChildCaches = new WeakMap<
    object,
    SettledExpandedChildCache
  >();

  constructor(patch: Patch) {
    super();
    this.patch = patch;
    patch.groups.add(this);
  }

  addTool(tool: any): void {
    this.clearAllCaches();
    this.children.push(tool);
    tool[PARENT_KEY] = this;
  }

  releaseTools(): any[] {
    this.clearAllCaches();
    const tools = [...this.children];
    this.children.length = 0;
    this.patch.groups.delete(this);
    return tools;
  }

  removeTool(tool: any): void {
    this.clearAllCaches();
    const index = this.children.indexOf(tool);
    if (index >= 0) this.children.splice(index, 1);
    if (tool?.[PARENT_KEY] === this) delete tool[PARENT_KEY];
  }

  setExpanded(expanded: boolean): void {
    this._expanded = expanded;
    for (const tool of this.children)
      (
        tool as Component & { setExpanded?: (expanded: boolean) => void }
      ).setExpanded?.(expanded);
  }

  setHintHovered(hovered: boolean): void {
    if (this.hintHovered !== hovered) {
      this.clearSettledCaches();
    }
    this.hintHovered = hovered;
  }

  /**
   * 展开时按局部行定位内部组件（null = 行属于 group 自身：空行/头行/尾行）。
   * 行数计算与 render 保持一致：宽度 width-2 + 空行过滤。
   */
  childAtRow(
    localRow: number,
    width: number,
  ): { component: any; row: number } | null {
    if (!this._expanded || localRow < 2) return null;
    let offset = 2;
    for (const tool of this.children) {
      let lines: string[] = [];
      try {
        const rendered = tool.render?.(Math.max(1, width - 2));
        if (Array.isArray(rendered))
          lines = visibleLines(rendered.map((line) => String(line)));
      } catch {
        lines = [];
      }
      const lineCount = Math.max(1, lines.length);
      if (localRow < offset + lineCount) {
        return { component: tool, row: localRow - offset };
      }
      offset += lineCount;
    }
    return null;
  }

  invalidate(): void {
    this.clearAllCaches();
    for (const tool of this.children) tool.invalidate?.();
  }

  private clearSettledCaches(): void {
    this.settledCaches = {};
  }

  private clearAllCaches(): void {
    this.clearSettledCaches();
    this.settledExpandedChildCaches = new WeakMap();
  }

  private settledCacheHit(width: number): string[] | undefined {
    const slot = this._expanded ? "expanded" : "collapsed";
    const cache = this.settledCaches[slot];
    if (!cache) {
      return;
    }
    if (
      cache.width !== width ||
      cache.expanded !== this._expanded ||
      cache.hover !== this.hintHovered ||
      cache.theme !== this.patch.theme ||
      cache.fullscreen !== isToolTuiFullscreen() ||
      (getActiveIoViewFrame() !== null &&
        !cache.capturedIoFrame &&
        cache.ioViews.some(Boolean))
    ) {
      return;
    }
    const tools = this.children as any[];
    if (cache.children.length !== tools.length) {
      return;
    }
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const ioView = toolIoView(tool);
      const toolStatus = status(tool);
      if (
        cache.children[i] !== tool ||
        cache.args[i] !== tool?.args ||
        cache.results[i] !== tool?.result ||
        cache.statuses[i] !== toolStatus ||
        cache.callComponents[i] !== tool?.callRendererComponent ||
        cache.resultComponents[i] !== tool?.resultRendererComponent ||
        cache.ioViews[i] !== ioView ||
        cache.ioHoveredSections[i] !== ioHoveredSection(ioView) ||
        cache.ioRevisions[i] !== ioRenderRevision(ioView) ||
        toolStatus === "pending"
      ) {
        return;
      }
    }
    return replayIoViewMarkers(cache.lines, cache.ioMarkers);
  }

  private storeSettledCache(width: number, lines: string[]): void {
    const tools = this.children as any[];
    const ioViews = tools.map(toolIoView);
    const captured = captureIoViewMarkers(lines);
    const cache: SettledGroupCache = {
      width,
      expanded: this._expanded,
      hover: this.hintHovered,
      theme: this.patch.theme,
      fullscreen: isToolTuiFullscreen(),
      children: [...tools],
      args: tools.map((tool) => tool?.args),
      results: tools.map((tool) => tool?.result),
      statuses: tools.map(status),
      callComponents: tools.map((tool) => tool?.callRendererComponent),
      resultComponents: tools.map((tool) => tool?.resultRendererComponent),
      ioViews,
      ioHoveredSections: ioViews.map(ioHoveredSection),
      ioRevisions: ioViews.map(ioRenderRevision),
      capturedIoFrame: getActiveIoViewFrame() !== null,
      lines: captured.lines,
      ioMarkers: captured.markers,
    };
    this.settledCaches[this._expanded ? "expanded" : "collapsed"] = cache;
  }

  private settledExpandedChildCacheHit(
    tool: any,
    index: number,
    total: number,
    width: number,
  ): string[] | undefined {
    const cache = this.settledExpandedChildCaches.get(tool);
    if (!cache) {
      return;
    }
    const toolStatus = status(tool);
    const ioView = toolIoView(tool);
    if (
      toolStatus === "pending" ||
      cache.width !== width ||
      cache.theme !== this.patch.theme ||
      cache.fullscreen !== isToolTuiFullscreen() ||
      cache.index !== index ||
      cache.total !== total ||
      cache.args !== tool?.args ||
      cache.result !== tool?.result ||
      cache.status !== toolStatus ||
      cache.expanded !== (tool?.expanded === true) ||
      cache.callComponent !== tool?.callRendererComponent ||
      cache.resultComponent !== tool?.resultRendererComponent ||
      cache.ioView !== ioView ||
      cache.ioHoveredSection !== ioHoveredSection(ioView) ||
      cache.ioRevision !== ioRenderRevision(ioView) ||
      (getActiveIoViewFrame() !== null &&
        !cache.capturedIoFrame &&
        ioView !== undefined)
    ) {
      return;
    }
    return replayIoViewMarkers(cache.lines, cache.ioMarkers);
  }

  private storeSettledExpandedChildCache(
    tool: any,
    index: number,
    total: number,
    width: number,
    lines: string[],
  ): void {
    const ioView = toolIoView(tool);
    const captured = captureIoViewMarkers(lines);
    this.settledExpandedChildCaches.set(tool, {
      width,
      theme: this.patch.theme,
      fullscreen: isToolTuiFullscreen(),
      index,
      total,
      args: tool?.args,
      result: tool?.result,
      status: status(tool),
      expanded: tool?.expanded === true,
      callComponent: tool?.callRendererComponent,
      resultComponent: tool?.resultRendererComponent,
      ioView,
      ioHoveredSection: ioHoveredSection(ioView),
      ioRevision: ioRenderRevision(ioView),
      capturedIoFrame: getActiveIoViewFrame() !== null,
      lines: captured.lines,
      ioMarkers: captured.markers,
    });
  }

  private renderExpandedChildBlock(
    tool: any,
    index: number,
    total: number,
    width: number,
    theme: any,
    fg: (color: string, text: string) => string,
  ): string[] {
    const cached = this.settledExpandedChildCacheHit(tool, index, total, width);
    if (cached) {
      return cached;
    }

    const toolStatus = status(tool);
    const color = toolStatus === "pending" ? "accent" : toolStatus;
    const branch = index === total - 1 ? "└" : "├";
    const continuation = index === total - 1 ? "  " : "│ ";
    const rendered = visibleLines(tool.render(Math.max(1, width - 2)));
    if (rendered.length) {
      rendered[0] = stripLeadingStatusIcon(rendered[0])
        .replace(/^ +/, "")
        .replace(/^((?:\x1b\[[0-?]*[ -/]*[@-~])*) +/, "$1");
    }
    const childLines = rendered.length ? rendered : [toolSummary(tool).main];
    const backgroundSlot = "userMessageBg";
    const lines = childLines.map((line, lineIndex) => {
      const content = lineIndex === 0 ? line : stripLeadingSpaces(line, 1);
      const prefix =
        lineIndex === 0
          ? `${fg("dim", branch)} ${fg(color, statusIcon(toolStatus))} `
          : fg("dim", continuation);
      return paddedBackgroundRow(
        theme,
        backgroundSlot,
        prefix + content,
        width,
      );
    });
    if (toolStatus !== "pending") {
      this.storeSettledExpandedChildCache(tool, index, total, width, lines);
    }
    return lines;
  }

  render(width: number): string[] {
    const cached = this.settledCacheHit(width);
    if (cached) {
      return cached;
    }
    const theme = this.patch.theme;
    const fg = (color: string, text: string) =>
      theme?.fg?.(color, text) ?? text;
    const counts = { pending: 0, success: 0, error: 0 };
    for (const tool of this.children) counts[status(tool)]++;
    const countText = (["pending", "success", "error"] as const)
      .filter((key) => counts[key])
      .map((key) => {
        const label =
          key === "pending" ? "running" : key === "success" ? "done" : "failed";
        const color = key === "pending" ? "accent" : key;
        return `${fg(color, String(counts[key]))} ${label}`;
      })
      .join(` ${fg("dim", "•")} `);
    const names = new Set(this.children.map(toolName));
    const label =
      names.size === 1
        ? humanizeToolLabel(toolName(this.children[0]))
        : "Multiple Tools";
    const overall: ToolStatus = counts.error
      ? "error"
      : counts.pending
        ? "pending"
        : "success";
    const overallColor = overall === "pending" ? "accent" : overall;
    const nameList =
      names.size > 1 ? ` ${fg("dim", `• ${toolNameList(this.children)}`)}` : "";
    // 圆点保持 dim；hover 只高亮可点击文字。
    const hint = `${fg("dim", "•")} ${fg(this.hintHovered ? "text" : "dim", showMoreHintText())}`;
    const lines = [
      "",
      truncateToWidth(
        ` ${fg(overallColor, "●")} ${label}: ${countText}${nameList} ${hint}`,
        width,
        "…",
      ),
    ];
    const total = this.children.length;
    for (let index = 0; index < total; index++) {
      const tool = this.children[index];
      if (this._expanded) {
        lines.push(
          ...this.renderExpandedChildBlock(
            tool,
            index,
            total,
            width,
            theme,
            fg,
          ),
        );
        continue;
      }
      const toolStatus = status(tool);
      const color = toolStatus === "pending" ? "accent" : toolStatus;
      const branch = index === total - 1 ? "└" : "├";
      const summary = toolSummary(tool);
      lines.push(
        truncateToWidth(
          ` ${fg("dim", branch)} ${fg(color, statusIcon(toolStatus))} ${fg("toolTitle", summary.main)}${fg("dim", summary.detail)}`,
          width,
          "…",
        ),
      );
    }
    if (this._expanded) {
      lines.push(paddedBackgroundRow(theme, "userMessageBg", "", width));
    }
    if (counts.pending === 0) {
      this.storeSettledCache(width, lines);
    }
    return lines;
  }
}

function ungroup(patch: Patch): void {
  for (const group of [...patch.groups]) {
    const parent = (group as any)[PARENT_KEY];
    const children = parent?.children;
    if (!Array.isArray(children)) {
      patch.groups.delete(group);
      continue;
    }
    const index = children.indexOf(group);
    if (index < 0) {
      patch.groups.delete(group);
      continue;
    }
    const tools = group.releaseTools();
    for (const tool of tools) tool[PARENT_KEY] = parent;
    children.splice(index, 1, ...tools);
  }
}

function normalizeGroup(patch: Patch, group: ToolGroupComponent): void {
  if (group.children.length > 1) return;
  const parent = (group as any)[PARENT_KEY];
  const index = parent?.children?.indexOf(group) ?? -1;
  const tools = group.releaseTools();
  delete (group as any)[PARENT_KEY];
  if (index < 0) {
    for (const tool of tools) delete tool[PARENT_KEY];
    return;
  }
  if (tools.length === 1) {
    tools[0][PARENT_KEY] = parent;
    parent.children.splice(index, 1, tools[0]);
  } else {
    parent.children.splice(index, 1);
  }
}

function maybeGroup(patch: Patch, parent: any, component: any): void {
  if (
    !patch.active ||
    !patch.enabled() ||
    parent instanceof ToolGroupComponent ||
    !isGroupable(component)
  )
    return;
  component[GENERATION_KEY] = patch.generation;
  const children = parent?.children;
  if (!Array.isArray(children)) return;
  const index = children.indexOf(component);
  const prior = previousSibling(children, index - 1);
  if (!prior) return;
  if (
    prior.child instanceof ToolGroupComponent &&
    (prior.child as any).patch === patch
  ) {
    children.splice(index, 1);
    prior.child.addTool(component);
    return;
  }
  if (
    !isGroupable(prior.child) ||
    prior.child[GENERATION_KEY] !== patch.generation
  )
    return;
  const group = new ToolGroupComponent(patch);
  group.addTool(prior.child);
  group.addTool(component);
  (group as any)[PARENT_KEY] = parent;
  children[prior.index] = group;
  children.splice(index, 1);
}

/** /reload 不会重新 addChild；扫描当前 mounted roots，把已有工具重新送入同一分组规则。 */
function regroup(patch: Patch, root: any): void {
  if (!patch.active || !patch.enabled() || !root) return;
  walkComponentTree(root, (value: any) => {
    // 分组卡与可分组工具是分组边界：不继续下钻（与原有遍历过滤一致）。
    if (value instanceof ToolGroupComponent || isGroupable(value)) return false;
    const children = value.children;
    if (Array.isArray(children)) {
      for (const child of [...children]) {
        if (child && typeof child === "object") child[PARENT_KEY] = value;
        maybeGroup(patch, value, child);
      }
    }
  });
}

export type ToolGroupingHooks = {
  setTheme(theme: any): void;
  refresh(root?: any): void;
  shutdown(): void;
};

export function installToolGrouping(
  getEnabled: () => boolean,
): ToolGroupingHooks {
  const prototype = Container.prototype as any;
  const previous = patchRegistry.get<Patch>(PATCH_KEY);
  if (previous) {
    previous.active = false;
    previous.enabled = () => false;
    ungroup(previous);
  }
  const original = {
    addChild:
      previous && prototype.addChild === previous.installed.addChild
        ? previous.original.addChild
        : prototype.addChild,
    removeChild:
      previous && prototype.removeChild === previous.installed.removeChild
        ? previous.original.removeChild
        : prototype.removeChild,
    clear:
      previous && prototype.clear === previous.installed.clear
        ? previous.original.clear
        : prototype.clear,
  };
  const patch: Patch = {
    owner: {},
    active: true,
    prototype,
    original,
    installed: undefined as any,
    groups: new Set(),
    enabled: getEnabled,
    generation: 0,
    lastEnabled: getEnabled(),
  };
  patch.installed = {
    addChild: function (this: any, component: any) {
      const result = patch.original.addChild.call(this, component);
      if (component && typeof component === "object")
        component[PARENT_KEY] = this;
      maybeGroup(patch, this, component);
      return result;
    },
    removeChild: function (this: any, component: any) {
      const group = component?.[PARENT_KEY];
      if (
        group instanceof ToolGroupComponent &&
        (group as any)[PARENT_KEY] === this
      ) {
        group.removeTool(component);
        normalizeGroup(patch, group);
        return;
      }
      const result = patch.original.removeChild.call(this, component);
      if (component?.[PARENT_KEY] === this) delete component[PARENT_KEY];
      if (this instanceof ToolGroupComponent) normalizeGroup(patch, this);
      if (component instanceof ToolGroupComponent) {
        for (const tool of component.releaseTools()) delete tool[PARENT_KEY];
      }
      return result;
    },
    clear: function (this: any) {
      for (const child of [...(this.children ?? [])]) {
        if (child instanceof ToolGroupComponent) {
          for (const tool of child.releaseTools()) delete tool[PARENT_KEY];
        }
        if (child?.[PARENT_KEY] === this) delete child[PARENT_KEY];
      }
      if (this instanceof ToolGroupComponent) patch.groups.delete(this);
      return patch.original.clear.call(this);
    },
  };
  prototype.addChild = patch.installed.addChild;
  prototype.removeChild = patch.installed.removeChild;
  prototype.clear = patch.installed.clear;
  patchRegistry.install(PATCH_KEY, patch);
  return {
    setTheme(theme: any) {
      patch.theme = theme;
    },
    refresh(root?: any) {
      const enabled = patch.enabled();
      if (enabled !== patch.lastEnabled) {
        patch.lastEnabled = enabled;
        if (enabled) patch.generation++;
      }
      if (enabled) regroup(patch, root);
      else ungroup(patch);
    },
    shutdown() {
      if (!patch.active) return;
      patch.active = false;
      patch.enabled = () => false;
      ungroup(patch);
      if (prototype.addChild === patch.installed.addChild)
        prototype.addChild = patch.original.addChild;
      if (prototype.removeChild === patch.installed.removeChild)
        prototype.removeChild = patch.original.removeChild;
      if (prototype.clear === patch.installed.clear)
        prototype.clear = patch.original.clear;
    },
  };
}
