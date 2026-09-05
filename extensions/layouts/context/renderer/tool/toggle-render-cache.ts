/**
 * 工具卡 updateDisplay 跨 toggle 重建缓存（on/compact 共用，off 关闭）。
 *
 * 原生 ToolExecutionComponent.updateDisplay 每次调用都会 clear 后重新调用
 * call/result renderer 生成全新组件，新组件内部行缓存为空，导致折叠/展开
 * 切换（Ctrl+O、group.setExpanded、鼠标点击）每次都要重新 wrap 输出全文，
 * 大输出下可达数百毫秒同步阻塞。
 *
 * 这里按工具实例缓存（collapsed/expanded 两槽）的渲染指纹：内容指纹
 * （args/result/isPartial/executionStarted/argsComplete/showImages/mode/theme）
 * 未变化时跳过原生全量重建；容器内当前槽位与目标槽位不同时，把目标槽构建
 * 时缓存的 call/result 组件重新装入对应壳容器（selfRenderContainer /
 * contentBox / contentText）并恢复派生字段，实现零重建的来回切换。
 *
 * 失效面：result/args 等输入变化（指纹比较）、模式切换（mode 入指纹）、
 * 主题或配置变化（setTheme / clear 由装配层在既有回调中驱动）。
 * fallback 分支（contentText，无 renderer 定义的工具）不做组件级切换，
 * 切槽时退化为原生重建，与现状一致。
 */
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { config } from "../../../../app/config/renderer.ts";
import {
  patchRegistry,
  TOGGLE_RENDER_CACHE_PATCH,
} from "../../../../tools/patch-keys.ts";
import { scheduleAnimation } from "./result.ts";

type RenderSlot = {
  /** 输入指纹（args/result/isPartial 等，不含 expanded）。 */
  inputFingerprint: unknown[];
  /** 构建时的派生组件引用（call/result），用于同槽外部污染检测。 */
  components: [unknown, unknown];
  hideComponent: boolean;
  /** 构建时实际挂载的壳载体：box / self / text / null（未挂候选容器）。 */
  shell: "box" | "self" | "text" | null;
  callComponent: unknown;
  resultComponent: unknown;
  /** rendererState 中 ccstyle 渲染层的指针快照（切槽重装时恢复）。 */
  stateSnapshot: [unknown, unknown, unknown];
};

type ComponentCache = {
  expanded?: RenderSlot;
  collapsed?: RenderSlot;
  /** 容器当前装着的槽位（重建/装载后更新）。 */
  current?: "expanded" | "collapsed";
};

let componentCaches = new WeakMap<object, ComponentCache>();

type ToggleRenderCachePatch = {
  active: boolean;
  prototype: any;
  installed: () => void;
  original: () => void;
  theme: unknown;
};

export type ToggleRenderCacheHooks = {
  setTheme(theme: unknown): void;
  /** 配置/主题等外部状态变化后丢弃全部缓存（下次 updateDisplay 重建）。 */
  clear(): void;
  shutdown(): void;
};

/** 渲染输入指纹：不含 expanded（由槽位区分），不含组件引用。 */
function fingerprintOf(
  component: any,
  patch: ToggleRenderCachePatch,
): unknown[] {
  return [
    component.args,
    component.result,
    component.isPartial === true,
    component.executionStarted === true,
    component.argsComplete === true,
    component.showImages === true,
    config.mode,
    patch.theme,
  ];
}

function componentsOf(component: any): [unknown, unknown] {
  return [component.callRendererComponent, component.resultRendererComponent];
}

function sameComponents(
  left: [unknown, unknown],
  right: [unknown, unknown],
): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function sameFingerprint(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/** 从 children 中识别当前挂载的候选壳（无副作用，不调用 getRenderShell）。 */
function mountedShell(component: any): "box" | "self" | "text" | null {
  const children = Array.isArray(component?.children) ? component.children : [];
  for (const child of children) {
    if (child === component.contentBox) return "box";
    if (child === component.selfRenderContainer) return "self";
    if (child === component.contentText) return "text";
  }
  return null;
}

function shellContainer(
  component: any,
  shell: "box" | "self" | "text" | null,
): any {
  if (shell === "box") return component.contentBox;
  if (shell === "self") return component.selfRenderContainer;
  if (shell === "text") return component.contentText;
  return null;
}

/** 与 default-mode 的 syncToolShell 同款：把目标壳换入 children，排除其余候选。 */
function syncShell(component: any, shell: "box" | "self" | "text"): void {
  const target = shellContainer(component, shell);
  if (!target || !Array.isArray(component.children)) return;
  const candidates = new Set(
    [
      component.contentText,
      component.contentBox,
      component.selfRenderContainer,
    ].filter(Boolean),
  );
  const indexes = component.children
    .map((child: any, index: number) => (candidates.has(child) ? index : -1))
    .filter((index: number) => index >= 0);
  const targetIndex = indexes[0];
  if (targetIndex === undefined) return;
  component.children[targetIndex] = target;
  for (const index of indexes.sort(
    (left: number, right: number) => right - left,
  )) {
    if (index !== targetIndex) component.children.splice(index, 1);
  }
}

function stateSnapshotOf(component: any): [unknown, unknown, unknown] {
  const state = component?.rendererState;
  return [
    state?.ccstyleIoView,
    state?.ccstyleExpandedIoView,
    state?.ccstyleToolVisualState,
  ];
}

function restoreStateSnapshot(
  component: any,
  slotKey: "expanded" | "collapsed",
  snapshot: [unknown, unknown, unknown],
): void {
  if (
    component?.rendererState === undefined &&
    snapshot.every((v) => v === undefined)
  ) {
    return;
  }
  const state = (component.rendererState ??= {});
  // ioView/visualState 每槽构建时都会写入，按槽恢复；
  // expandedIoView 是跨槽保留指针（折叠 renderer 不清），只在展开槽恢复。
  state.ccstyleIoView = snapshot[0];
  state.ccstyleToolVisualState = snapshot[1];
  if (slotKey === "expanded") state.ccstyleExpandedIoView = snapshot[2];
}

/**
 * 把缓存槽的 call/result 组件装回目标壳容器并恢复派生字段。
 * 同时恢复 ccstyle 渲染层的 rendererState 指针快照（ioView / expandedIoView /
 * visualState），补齐切槽跳过 renderer 调用导致的状态缺失；pending 展开时
 * 重新调度加载动画。text fallback 槽（无容器装载语义）返回 false，调用方
 * 退化为重建。
 */
function mountSlot(
  component: any,
  slotKey: "expanded" | "collapsed",
  slot: RenderSlot,
): boolean {
  if (!slot.shell || slot.shell === "text") return false;
  const container = shellContainer(component, slot.shell);
  if (!container || typeof container.clear !== "function") return false;
  syncShell(component, slot.shell);
  container.clear();
  if (slot.callComponent !== undefined)
    container.addChild(slot.callComponent as any);
  if (slot.resultComponent !== undefined)
    container.addChild(slot.resultComponent as any);
  component.callRendererComponent = slot.callComponent;
  component.resultRendererComponent = slot.resultComponent;
  component.hideComponent = slot.hideComponent;
  restoreStateSnapshot(component, slotKey, slot.stateSnapshot);
  if (slot.resultComponent !== undefined) {
    // pending（流式）且已展开：恢复加载动画调度（默认 renderResult 的副作用）。
    if (component.isPartial === true || component.executionStarted === true) {
      try {
        scheduleAnimation(component);
      } catch {
        // 动画调度失败不影响装载结果。
      }
    }
  }
  return true;
}

export function installToggleRenderCache(): ToggleRenderCacheHooks {
  const previous = patchRegistry.get<ToggleRenderCachePatch>(
    TOGGLE_RENDER_CACHE_PATCH,
  );
  // /reload 残留的旧补丁先停用，链上以本次安装为准。
  if (previous) previous.active = false;
  const prototype = ToolExecutionComponent.prototype as any;
  const original = prototype.updateDisplay;
  const patch: ToggleRenderCachePatch = {
    active: true,
    prototype,
    installed: undefined as any,
    original,
    theme: undefined,
  };

  patch.installed = function (this: any) {
    if (!patch.active || config.mode === "off") {
      return patch.original.call(this);
    }
    const self = this;
    if (
      !self ||
      typeof self.expanded !== "boolean" ||
      typeof self.hideComponent !== "boolean"
    ) {
      return patch.original.call(this);
    }
    const slotKey: "expanded" | "collapsed" = self.expanded
      ? "expanded"
      : "collapsed";
    const fingerprint = fingerprintOf(self, patch);
    const componentsNow = componentsOf(self);
    let entry = componentCaches.get(self);
    const slot = entry?.[slotKey];

    const rebuild = () => {
      entry ??= {};
      componentCaches.set(self, entry);
      // 防止 renderer 复用另一槽的组件实例：pi 的 renderResult 通过
      // context.lastComponent（= resultRendererComponent 字段）复用组件，
      // 跨槽复用会把另一槽缓存的内容覆盖污染（如 bash 的 rebuildln 重建
      // children）。重置字段强制新建，保证两槽各自持有独立实例。
      const otherKey: "expanded" | "collapsed" =
        slotKey === "expanded" ? "collapsed" : "expanded";
      const other = entry[otherKey];
      if (other && other.shell !== "text") {
        if (self.callRendererComponent === other.callComponent) {
          self.callRendererComponent = undefined;
        }
        if (self.resultRendererComponent === other.resultComponent) {
          self.resultRendererComponent = undefined;
        }
      }
      patch.original.call(this);
      // 输入指纹取重建后的状态快照；组件引用由重建产物决定。
      const shell = mountedShell(self);
      const built: RenderSlot = {
        inputFingerprint: fingerprintOf(self, patch),
        components: componentsOf(self),
        hideComponent: self.hideComponent === true,
        shell,
        callComponent:
          shell === "text"
            ? undefined
            : (self.callRendererComponent ?? undefined),
        resultComponent:
          shell === "text"
            ? undefined
            : (self.resultRendererComponent ?? undefined),
        stateSnapshot: stateSnapshotOf(self),
      };
      entry[slotKey] = built;
      entry.current = slotKey;
    };

    const inputsMatch =
      slot && sameFingerprint(slot.inputFingerprint, fingerprint);
    if (inputsMatch && entry) {
      if (entry.current === slotKey) {
        if (sameComponents(slot.components, componentsNow)) {
          // 容器内容仍是该槽，无重建必要；仅恢复可能被外部改写的派生字段。
          self.hideComponent = slot.hideComponent;
          return;
        }
        // 外部（第三方 renderer、测试）替换了派生组件：走重建刷新。
        rebuild();
        return;
      }
      if (!mountSlot(self, slotKey, slot)) {
        // text fallback 或防御性失败：退化为原生重建。
        rebuild();
        return;
      }
      entry.current = slotKey;
      return;
    }
    rebuild();
  };

  prototype.updateDisplay = patch.installed;
  patchRegistry.install(TOGGLE_RENDER_CACHE_PATCH, patch);

  return {
    setTheme(theme: unknown) {
      patch.theme = theme;
    },
    clear() {
      componentCaches = new WeakMap();
    },
    shutdown() {
      if (!patch.active) return;
      patch.active = false;
      if (prototype.updateDisplay === patch.installed) {
        prototype.updateDisplay = patch.original;
      }
      patchRegistry.dispose(TOGGLE_RENDER_CACHE_PATCH, patch);
      componentCaches = new WeakMap();
    },
  };
}
