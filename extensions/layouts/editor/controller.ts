import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  hasUnsupportedComponentStyle,
  type PolishedTuiConfig,
} from "../../app/config/shell.ts";
import type { RenderScheduler } from "../../app/runtime/render-scheduler.ts";
import type { SessionLifecycle } from "../../app/runtime/session-lifecycle.ts";
import type { FooterState } from "../footer/index.ts";
import {
  type AccentRailLayoutPatchDiagnostic,
  installHostAccentRailLayoutPatch,
  retainAccentRailLayoutPatchInstallation,
} from "./accent-rail-layout-patch.ts";
import {
  type EditorTransferFailureReason,
  replaceEditorComponentWithExpandedText,
} from "./editor-transfer.ts";
import {
  createEditorFactory,
  createWrappedEditorFactory,
  type EditorFactoryRuntime,
} from "./factory.ts";
import {
  type EditorFactory,
  getZentuiEditorBaseFactory,
  isOwnedEditorFactory,
  isZentuiEditorFactory,
} from "./ownership.ts";

export type EditorChangeResult = { ok: true } | { ok: false; reason: string };

export type EditorLayoutControllerContext = {
  readonly getConfig: () => PolishedTuiConfig;
  readonly saveComponent: (
    patch: Partial<PolishedTuiConfig["components"]["editor"]>,
  ) => PolishedTuiConfig;
  readonly getState: () => FooterState;
  readonly sessionLifecycle: SessionLifecycle;
  readonly render: Pick<RenderScheduler, "request">;
  readonly getThinkingLevel: () => ReturnType<ExtensionAPI["getThinkingLevel"]>;
  readonly getContextWindow: (ctx: ExtensionContext) => number | undefined;
  readonly getContextPercent: (ctx: ExtensionContext) => number | undefined;
  readonly getAgentDurationMs: () => number;
  readonly isAgentActive: () => boolean;
  readonly isAgentDurationActive: () => boolean;
  readonly subscribeAgentDuration: (listener: () => void) => () => void;
  readonly getProjectRoot: () => string | undefined;
  readonly onProjectRequirementChanged: () => void;
  readonly onModelLabelChanged: (ctx: ExtensionContext) => void;
  readonly recordLayoutDiagnostic: (
    diagnostic: AccentRailLayoutPatchDiagnostic,
    version?: string,
  ) => void;
};

type EditorInstallMode = "none" | "standalone" | "wrapper";

/**
 * Owns the Pi editor factory and all Editor-specific lifecycle state.
 */
export class EditorLayoutController {
  private readonly context: EditorLayoutControllerContext;
  private readonly ownerToken = Symbol("pi-one-ui-editor-owner");
  private activeTuiContext: ExtensionContext | undefined;
  private requestEditorRender: (() => void) | undefined;
  private editorInstalled = false;
  private editorInstallMode: EditorInstallMode = "none";
  private installedEditorFactory: EditorFactory | undefined;
  private wrappedEditorFactory: EditorFactory | undefined;
  private minimalistDecorationActive = false;
  private minimalistDurationUpdatesActive = false;
  private stopMinimalistDurationUpdates: () => void = () => {};
  private accentRailLayoutPatchCleanup: () => void = () => {};
  private accentRailLayoutPatchInstallSerial = 0;

  /**
   * Creates an Editor controller with shared runtime selectors.
   *
   * @param context Runtime services and selectors exposed to the Editor.
   */
  constructor(context: EditorLayoutControllerContext) {
    this.context = context;
  }

  /**
   * Installs the host Accent Rail patch for a new session generation.
   *
   * @param ctx Active Pi extension context.
   * @returns A promise that settles after patch retention is attempted.
   */
  async startSession(ctx: ExtensionContext): Promise<void> {
    const lifecycleGeneration =
      this.context.sessionLifecycle.currentGeneration();
    const installSerial = ++this.accentRailLayoutPatchInstallSerial;
    this.accentRailLayoutPatchCleanup();
    this.accentRailLayoutPatchCleanup = () => {};
    if (!this.isTuiContext(ctx)) return;

    const result = await retainAccentRailLayoutPatchInstallation(
      () => installHostAccentRailLayoutPatch(this.ownerToken),
      () =>
        this.context.sessionLifecycle.isCurrent(lifecycleGeneration) &&
        installSerial === this.accentRailLayoutPatchInstallSerial,
      (layoutPatch) => {
        this.accentRailLayoutPatchCleanup = layoutPatch.cleanup;
        this.context.recordLayoutDiagnostic(
          layoutPatch.diagnostic,
          layoutPatch.version,
        );
      },
    );
    if (result === "failed")
      this.context.recordLayoutDiagnostic("host-module-unavailable");
  }

  /**
   * Installs or reconciles the configured Editor for an active session.
   *
   * @param ctx Active Pi extension context.
   * @param allowStaleZentui Whether a stale predecessor may be replaced.
   * @returns The replacement result when a host factory changed.
   */
  install(
    ctx: ExtensionContext,
    allowStaleZentui = true,
  ): EditorChangeResult | undefined {
    if (!this.isTuiContext(ctx)) return;
    this.activeTuiContext = ctx;
    if (this.isEditorEnabled()) this.clearEditorOwnership();
    else this.uninstall(ctx, { allowStaleZentui });
    const result = this.reconcile(ctx, { allowStaleZentui });
    this.scheduleReconciliation(ctx);
    return result;
  }

  /**
   * Reconciles the Editor with the latest Editor component configuration.
   *
   * @param ctx Active Pi extension context.
   * @param options Ownership options for reload transitions.
   * @returns The replacement result when a host factory changed.
   */
  reconcile(
    ctx: ExtensionContext,
    options: { allowStaleZentui?: boolean } = {},
  ): EditorChangeResult | undefined {
    try {
      if (this.isEditorEnabled()) {
        const currentFactory = ctx.ui.getEditorComponent();
        if (
          isZentuiEditorFactory(currentFactory) &&
          !this.ownsFactory(currentFactory) &&
          !options.allowStaleZentui
        ) {
          this.clearEditorOwnership();
          return;
        }
        if (!this.editorInstalled || !this.ownsFactory(currentFactory))
          return this.installEditor(ctx);
      } else {
        const currentFactory = ctx.ui.getEditorComponent();
        if (this.editorInstalled || this.ownsFactory(currentFactory))
          return this.uninstall(ctx);
      }
    } catch {
      return {
        ok: false,
        reason:
          "the editor could not be reconciled safely; reload Pi to apply this change",
      };
    }
  }

  /**
   * Applies an Editor component configuration patch and reconciles the host.
   *
   * @param patch Editor configuration changes to persist.
   * @param ctx Active Pi extension context.
   * @returns Whether the runtime applied the requested replacement.
   */
  setComponent(
    patch: Partial<PolishedTuiConfig["components"]["editor"]>,
    ctx: ExtensionContext,
  ): { applied: boolean; reason?: string } {
    this.context.saveComponent(patch);
    let result: EditorChangeResult | undefined;
    if (patch.enabled !== undefined && this.isTuiContext(ctx))
      result = this.reconcile(ctx);
    if (patch.style !== undefined && patch.style !== "minimalist")
      this.setMinimalistDecorationActive(false);
    if (patch.modelLabel !== undefined) this.context.onModelLabelChanged(ctx);
    this.context.onProjectRequirementChanged();
    this.requestRender();
    return {
      applied: !result || result.ok,
      reason: result && !result.ok ? result.reason : undefined,
    };
  }

  /**
   * Reports whether the Editor currently owns the host editor factory.
   *
   * @param ctx Active Pi extension context.
   * @returns Whether the installed factory is still active and owned.
   */
  ownsActiveFactory(ctx: ExtensionContext): boolean {
    if (!this.editorInstalled || !this.installedEditorFactory) return false;
    try {
      return (
        this.ownsFactory(this.installedEditorFactory) &&
        ctx.ui.getEditorComponent() === this.installedEditorFactory
      );
    } catch {
      return false;
    }
  }

  /**
   * Reconciles the controller's local ownership with the host factory.
   *
   * @param ctx Active Pi extension context.
   */
  reconcileOwnership(ctx: ExtensionContext): void {
    this.reconcileObservedOwnership(ctx);
  }

  /**
   * Reports whether the Editor requires project metadata refreshes.
   *
   * @returns Whether a project selector is currently visible.
   */
  needsProjectRefresh(): boolean {
    const editor = this.context.getConfig().components.editor;
    const minimalist = editor.styles.minimalist;
    return (
      this.isEditorEnabled() &&
      Boolean(
        this.activeTuiContext && this.ownsActiveFactory(this.activeTuiContext),
      ) &&
      editor.style === "minimalist" &&
      (minimalist.showGit || minimalist.pathDisplay === "project")
    );
  }

  /**
   * Marks the Editor decoration timer as active or inactive.
   *
   * @param active Whether the mounted Editor requested timer decoration.
   */
  setMinimalistDecorationActive(active: boolean): void {
    this.minimalistDecorationActive =
      this.context.sessionLifecycle.isCurrent() &&
      active &&
      Boolean(
        this.activeTuiContext && this.ownsActiveFactory(this.activeTuiContext),
      );
    this.reconcileAgentTimer();
    this.context.onProjectRequirementChanged();
  }

  /**
   * Updates whether an agent turn is currently active.
   *
   * @param active Whether the agent is running.
   */
  setAgentRunActive(active: boolean): void {
    this.reconcileAgentTimer();
    if (this.context.isAgentActive() !== active)
      this.context.onProjectRequirementChanged();
  }

  /**
   * Stops Editor duration decoration and clears its session-local state.
   */
  resetAgentTimer(): void {
    this.stopMinimalistDurationUpdates();
    this.stopMinimalistDurationUpdates = () => {};
    this.minimalistDurationUpdatesActive = false;
    this.minimalistDecorationActive = false;
  }

  /**
   * Reconciles timer decoration after a style or lifecycle update.
   */
  reconcileTimers(): void {
    this.reconcileAgentTimer();
  }

  /**
   * Removes the Editor and restores the retained third-party factory.
   *
   * @param ctx Active Pi extension context.
   * @param options Ownership options for stale reload cleanup.
   * @returns Whether restoration succeeded.
   */
  uninstall(
    ctx: ExtensionContext,
    options: { allowStaleZentui?: boolean } = {},
  ): EditorChangeResult {
    let currentFactory: EditorFactory | undefined;
    try {
      currentFactory = ctx.ui.getEditorComponent();
    } catch {
      return {
        ok: false,
        reason:
          "the current editor factory could not be observed safely; reload Pi to apply this change",
      };
    }
    if (!currentFactory || !isZentuiEditorFactory(currentFactory)) {
      this.clearEditorOwnership();
      return { ok: true };
    }
    if (!this.ownsFactory(currentFactory) && !options.allowStaleZentui) {
      this.clearEditorOwnership();
      return { ok: true };
    }
    const result = this.replace(
      ctx,
      getZentuiEditorBaseFactory(currentFactory) ??
        (this.editorInstallMode === "wrapper"
          ? this.wrappedEditorFactory
          : undefined),
    );
    if (!result.ok) return result;
    this.clearEditorOwnership();
    return { ok: true };
  }

  /**
   * Cleans Editor ownership, timers, deferred reconciliation and host patches.
   *
   * @param ctx Active Pi extension context, when available.
   */
  cleanup(ctx?: ExtensionContext): void {
    this.resetAgentTimer();
    this.context.sessionLifecycle.shutdown();
    if (ctx && this.isTuiContext(ctx)) {
      try {
        const currentFactory = ctx.ui.getEditorComponent();
        if (currentFactory && this.ownsFactory(currentFactory)) {
          this.replace(
            ctx,
            getZentuiEditorBaseFactory(currentFactory) ??
              (this.editorInstallMode === "wrapper"
                ? this.wrappedEditorFactory
                : undefined),
          );
        }
      } catch {
        // Continue cleanup even when Pi cannot expose the current factory.
      }
    }
    this.clearEditorOwnership();
    ++this.accentRailLayoutPatchInstallSerial;
    this.accentRailLayoutPatchCleanup();
    this.accentRailLayoutPatchCleanup = () => {};
    this.activeTuiContext = undefined;
  }

  /**
   * Starts or stops the Editor's one-second duration decoration subscription.
   */
  private reconcileAgentTimer(): void {
    const ctx = this.activeTuiContext;
    const config = this.context.getConfig().components.editor;
    const needed = Boolean(
      ctx &&
        this.context.sessionLifecycle.isCurrent() &&
        this.context.isAgentActive() &&
        this.context.isAgentDurationActive() &&
        this.minimalistDecorationActive &&
        this.isEditorEnabled() &&
        this.ownsActiveFactory(ctx) &&
        config.style === "minimalist" &&
        config.styles.minimalist.showTimer,
    );
    if (!needed) {
      this.stopMinimalistDurationUpdates();
      this.stopMinimalistDurationUpdates = () => {};
      this.minimalistDurationUpdatesActive = false;
      return;
    }
    if (this.minimalistDurationUpdatesActive) return;
    this.minimalistDurationUpdatesActive = true;
    this.stopMinimalistDurationUpdates = this.context.subscribeAgentDuration(
      () => {
        if (this.activeTuiContext)
          this.reconcileObservedOwnership(this.activeTuiContext);
        this.reconcileAgentTimer();
        if (this.minimalistDurationUpdatesActive) this.requestRender();
      },
    );
  }

  /**
   * Reports whether a context can safely install the Editor layout.
   *
   * @param ctx Candidate Pi extension context.
   * @returns Whether the context is an interactive TUI context.
   */
  private isTuiContext(ctx: ExtensionContext): boolean {
    try {
      const mode = (ctx as ExtensionContext & { mode?: string }).mode;
      return ctx.hasUI && (mode === undefined || mode === "tui");
    } catch {
      return false;
    }
  }

  /**
   * Returns whether the configured Editor style can be installed.
   *
   * @returns Whether the Editor is enabled and supported.
   */
  private isEditorEnabled(): boolean {
    const editor = this.context.getConfig().components.editor;
    return (
      editor.enabled &&
      !hasUnsupportedComponentStyle(this.context.getConfig(), "editor")
    );
  }

  /**
   * Tests whether a factory belongs to this controller.
   *
   * @param factory Candidate host factory.
   * @returns Whether this controller owns the factory.
   */
  private ownsFactory(factory: EditorFactory | undefined): boolean {
    return isOwnedEditorFactory(factory, this.ownerToken);
  }

  /**
   * Records the currently installed owned factory.
   *
   * @param factory Factory created by this controller.
   */
  private trackFactory(factory: EditorFactory): void {
    const baseFactory = getZentuiEditorBaseFactory(factory);
    this.wrappedEditorFactory = baseFactory;
    this.installedEditorFactory = factory;
    this.editorInstallMode = baseFactory ? "wrapper" : "standalone";
    this.editorInstalled = true;
  }

  /**
   * Clears local factory ownership and decoration callbacks.
   */
  private clearEditorOwnership(): void {
    this.setMinimalistDecorationActive(false);
    this.requestEditorRender = undefined;
    this.wrappedEditorFactory = undefined;
    this.installedEditorFactory = undefined;
    this.editorInstallMode = "none";
    this.editorInstalled = false;
  }

  /**
   * Replaces the host Editor factory while preserving expanded text.
   *
   * @param ctx Active Pi extension context.
   * @param factory Replacement factory, or undefined for native restoration.
   * @returns A normalized replacement result.
   */
  private replace(
    ctx: ExtensionContext,
    factory: EditorFactory | undefined,
  ): EditorChangeResult {
    const result = replaceEditorComponentWithExpandedText(ctx.ui, factory);
    return result.ok
      ? result
      : { ok: false, reason: editorTransferFailureMessage(result.reason) };
  }

  /**
   * Installs a native or third-party-wrapping Editor factory.
   *
   * @param ctx Active Pi extension context.
   * @returns A normalized replacement result.
   */
  private installEditor(ctx: ExtensionContext): EditorChangeResult {
    const currentFactory = ctx.ui.getEditorComponent();
    if (currentFactory && currentFactory === this.installedEditorFactory) {
      this.editorInstalled = true;
      return { ok: true };
    }
    const baseFactory =
      getZentuiEditorBaseFactory(currentFactory) ??
      (currentFactory && !isZentuiEditorFactory(currentFactory)
        ? currentFactory
        : undefined);
    const runtime = this.factoryRuntime(ctx);
    const nextFactory = baseFactory
      ? createWrappedEditorFactory(ctx, baseFactory, runtime)
      : createEditorFactory(ctx, runtime);
    const result = this.replace(ctx, nextFactory);
    if (!result.ok) return result;
    this.trackFactory(nextFactory);
    return { ok: true };
  }

  /**
   * Builds the narrow selector set consumed by Editor factories.
   *
   * @param ctx Active Pi extension context.
   * @returns Factory selectors and callbacks.
   */
  private factoryRuntime(ctx: ExtensionContext): EditorFactoryRuntime {
    return {
      ownerToken: this.ownerToken,
      sessionTheme: ctx.ui.theme,
      getConfig: this.context.getConfig,
      getState: this.context.getState,
      getThinkingLevel: this.context.getThinkingLevel,
      getContextWindow: this.context.getContextWindow,
      getContextPercent: this.context.getContextPercent,
      getAgentDurationMs: this.context.getAgentDurationMs,
      isAgentActive: this.context.isAgentActive,
      getProjectRoot: this.context.getProjectRoot,
      onRender: (requestRender) => {
        this.requestEditorRender = requestRender;
      },
      onDecorationActive: (active) =>
        this.setMinimalistDecorationActive(active),
      isAccentRailActive: () =>
        this.context.sessionLifecycle.isCurrent() &&
        this.ownsActiveFactory(ctx) &&
        this.isEditorEnabled() &&
        this.context.getConfig().components.editor.style === "accent-rail",
    };
  }

  /**
   * Reconciles ownership after Pi or another extension replaces the factory.
   *
   * @param ctx Active Pi extension context.
   */
  private reconcileObservedOwnership(ctx: ExtensionContext): void {
    let currentFactory: EditorFactory | undefined;
    try {
      currentFactory = ctx.ui.getEditorComponent();
    } catch {
      return;
    }
    if (currentFactory && this.ownsFactory(currentFactory)) {
      this.trackFactory(currentFactory);
      return;
    }
    this.clearEditorOwnership();
    this.context.onProjectRequirementChanged();
  }

  /**
   * Defers one ownership check until the host has finished mounting its UI.
   *
   * @param ctx Active Pi extension context.
   */
  private scheduleReconciliation(ctx: ExtensionContext): void {
    this.context.sessionLifecycle.defer(() => {
      if (!this.isEditorEnabled()) return;
      try {
        const currentFactory = ctx.ui.getEditorComponent();
        if (currentFactory === this.installedEditorFactory) {
          this.context.onProjectRequirementChanged();
          return;
        }
      } catch {
        this.scheduleReconciliation(ctx);
        return;
      }
      this.reconcileObservedOwnership(ctx);
      this.context.onProjectRequirementChanged();
      this.requestRender();
    });
  }

  /**
   * Requests both the mounted editor redraw and the shared runtime redraw.
   */
  requestRender(): void {
    this.requestEditorRender?.();
    this.context.render.request();
  }
}

/**
 * Converts a transfer failure into a user-facing Editor transition message.
 *
 * @param reason Failure reported by the expanded-text transfer helper.
 * @returns Stable message suitable for settings notifications.
 */
function editorTransferFailureMessage(
  reason: EditorTransferFailureReason,
): string {
  switch (reason) {
    case "unsupported-transfer-api":
      return "this Pi version cannot safely transfer expanded editor text; reload Pi to apply this change";
    case "editor-factory-snapshot-failed":
      return "the current editor factory could not be read safely; reload Pi to apply this change";
    case "editor-text-snapshot-failed":
      return "expanded editor text could not be read safely; reload Pi to apply this change";
    case "editor-text-preparation-failed":
      return "expanded editor text could not be prepared safely; reload Pi to apply this change";
    case "editor-replacement-failed-with-rollback":
      return "the editor replacement failed; the previous factory was reapplied, but editor instance identity is not guaranteed";
    case "editor-replacement-rollback-failed":
      return "the editor replacement and previous-factory rollback both failed; reload Pi before editing";
  }
}
