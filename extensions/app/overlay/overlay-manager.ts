import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  Component,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@earendil-works/pi-tui";

export type OverlayTask<T> = () => Promise<T>;
export type OverlayFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T | undefined) => void,
) =>
  | (Component & { dispose?(): void })
  | Promise<Component & { dispose?(): void }>;
export type ManagedOverlayOptions = {
  overlayOptions?: OverlayOptions | (() => OverlayOptions);
  preserveEditorFocus?: boolean;
  onHandle?: (handle: OverlayHandle) => void;
};
type FocusTui = TUI & {
  getFocusedComponent?: () => Component | null;
  isOverlayFocused?: () => boolean;
};

/** 配置更新可能替换 Editor；只恢复本面板仍然拥有的返回目标。 */
class EditorFocusCoordinator {
  private readonly originalFocus: Component | null | undefined;
  private editorFocus:
    | {
        component: Component;
        factory: ReturnType<ExtensionUIContext["getEditorComponent"]>;
      }
    | undefined;
  handle: OverlayHandle | undefined;

  constructor(
    private readonly tui: FocusTui,
    private readonly ui: ExtensionUIContext,
    private readonly active: () => boolean,
  ) {
    this.originalFocus = tui.getFocusedComponent?.();
  }

  change(action: () => void): void {
    if (this.originalFocus !== undefined) {
      this.handle?.unfocus({
        target: this.editorFocus?.component ?? this.originalFocus,
      });
    }
    const previous = this.tui.getFocusedComponent?.();
    try {
      action();
    } finally {
      const next = this.tui.getFocusedComponent?.();
      if (next && next !== previous && !this.tui.isOverlayFocused?.()) {
        this.editorFocus = {
          component: next,
          factory: this.ui.getEditorComponent(),
        };
      }
      if (this.active()) {
        this.handle?.focus();
      }
    }
  }

  close(done: () => void): void {
    done();
    if (
      !this.active() ||
      !this.editorFocus ||
      this.tui.hasOverlay() ||
      this.tui.getFocusedComponent?.() !== this.originalFocus ||
      this.ui.getEditorComponent() !== this.editorFocus.factory
    ) {
      return;
    }
    this.tui.setFocus(this.editorFocus.component);
    this.tui.requestRender();
  }
}

/** 管理本扩展的 Overlay、取消操作和跨组件焦点协作。 */
export class OverlayManager {
  private session = {};
  private active = true;
  private readonly tasks = new Set<object>();
  private readonly closers = new Map<object, () => void>();
  private readonly editorFocus = new Map<object, EditorFocusCoordinator>();

  async run<T>(task: OverlayTask<T>): Promise<T> {
    const token = {};
    this.tasks.add(token);
    try {
      return await task();
    } finally {
      this.tasks.delete(token);
    }
  }

  async open<T = void>(
    ctx: Pick<ExtensionContext, "ui">,
    factory: OverlayFactory<T>,
    options: ManagedOverlayOptions = {},
  ): Promise<T | undefined> {
    if (!this.active) {
      return undefined;
    }
    const token = {};
    this.tasks.add(token);
    let focus: EditorFocusCoordinator | undefined;
    try {
      return await ctx.ui.custom<T | undefined>(
        (tui, theme, keybindings, done) => {
          if (options.preserveEditorFocus) {
            focus = new EditorFocusCoordinator(tui, ctx.ui, () =>
              this.tasks.has(token),
            );
            this.editorFocus.set(token, focus);
          }
          let closed = false;
          const complete = (result: T | undefined): void => {
            if (closed) {
              return;
            }
            closed = true;
            if (focus) {
              focus.close(() => done(result));
            } else {
              done(result);
            }
          };
          this.closers.set(token, () => complete(undefined));
          return factory(tui, theme, keybindings, complete);
        },
        {
          overlay: true,
          overlayOptions: options.overlayOptions,
          onHandle: (handle) => {
            if (focus) {
              focus.handle = handle;
            }
            options.onHandle?.(handle);
          },
        },
      );
    } finally {
      this.tasks.delete(token);
      this.closers.delete(token);
      this.editorFocus.delete(token);
    }
  }

  updateEditor(action: () => void): void {
    const focus = [...this.editorFocus.values()].at(-1);
    if (focus) {
      focus.change(action);
    } else {
      action();
    }
  }

  sessionGuard(): () => boolean {
    const session = this.session;
    return () => this.active && this.session === session;
  }

  startSession(): void {
    this.reset();
    this.active = true;
  }

  reset(): void {
    this.active = false;
    this.session = {};
    this.tasks.clear();
    for (const close of [...this.closers.values()]) {
      close();
    }
    this.closers.clear();
    this.editorFocus.clear();
  }

  hasActive(): boolean {
    return this.tasks.size > 0;
  }

  depth(): number {
    return this.tasks.size;
  }
}

export const overlayManager = new OverlayManager();
