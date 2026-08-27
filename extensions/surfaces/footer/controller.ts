import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  hasUnsupportedComponentStyle,
  type FooterComponentConfig,
  type PolishedTuiConfig,
} from "../../app/config/shell.ts";
import type { SessionLifecycle } from "../../app/runtime/session-lifecycle.ts";
import { buildSessionDurationLabel } from "../../shared/format.ts";
import type { LiveContextOverride } from "../../services/live-context.ts";
import type { FooterState } from "../../services/session-state.ts";
import { installFooter, installHiddenFooter } from "./footer.ts";
import { activeFooterReferences } from "./data.ts";

const ZENTUI_FOOTER_OWNER = Symbol.for("pi-zentui.footer-owner");

type FooterKind = "starship" | "hidden";

export type FooterControllerContext = {
  readonly getConfig: () => PolishedTuiConfig;
  readonly saveComponent: (
    patch: Partial<FooterComponentConfig>,
  ) => PolishedTuiConfig;
  readonly state: FooterState;
  readonly sessionLifecycle: SessionLifecycle;
  readonly refresh: () => void;
  readonly scheduleProjectRefresh: (ctx: ExtensionContext) => void;
  readonly getLiveContext: () => LiveContextOverride | undefined;
  readonly onProjectRequirementChanged: (
    ctx: ExtensionContext,
    force?: boolean,
  ) => void;
  readonly onModelLabelChanged: (ctx: ExtensionContext) => void;
};

/**
 * Owns Footer installation, ownership markers, status callbacks, and clocks.
 */
export class FooterSurfaceController {
  private readonly context: FooterControllerContext;
  private installedKind: FooterKind | undefined;
  private installedToken: symbol | undefined;
  private requestFooterRender: (() => void) | undefined;
  private getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () =>
    new Map();
  private stopSessionTimer: () => void = () => {};
  private sessionTimerRequirements = "";
  private lastDurationLabel = "";

  /**
   * Creates a Footer controller with shared state and project selectors.
   *
   * @param context Runtime services consumed by Footer installation.
   */
  constructor(context: FooterControllerContext) {
    this.context = context;
  }

  /**
   * Installs the configured Footer and starts required session data updates.
   *
   * @param ctx Active Pi extension context.
   */
  install(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" && ctx.mode !== undefined) return;
    const staleOwner = this.footerOwner(ctx);
    if (typeof staleOwner === "symbol") this.installedToken = staleOwner;
    this.reconcile(ctx);
  }

  /**
   * Applies a Footer configuration patch and reconciles its host seam.
   *
   * @param patch Footer configuration changes to persist.
   * @param ctx Active Pi extension context.
   */
  setComponent(
    patch: Partial<FooterComponentConfig>,
    ctx: ExtensionContext,
  ): void {
    const previousStyle = this.context.getConfig().components.footer.style;
    const nextConfig = this.context.saveComponent(patch);
    const styleChanged = nextConfig.components.footer.style !== previousStyle;
    if (patch.style !== undefined) this.reconcile(ctx);
    if (patch.modelLabel !== undefined) this.context.onModelLabelChanged(ctx);
    this.context.onProjectRequirementChanged(ctx, styleChanged);
    this.reconcileSessionTimer();
    this.context.refresh();
  }

  /**
   * Reconciles native, Starship, and hidden Footer ownership.
   *
   * @param ctx Active Pi extension context.
   */
  reconcile(ctx: ExtensionContext): void {
    switch (this.effectiveFooterStyle()) {
      case "starship":
        this.installStarship(ctx);
        break;
      case "hidden":
        this.installHidden(ctx);
        break;
      case "native":
        this.uninstall(ctx);
        break;
    }
    this.reconcileSessionTimer();
  }

  /**
   * Removes the owned Footer while leaving third-party ownership untouched.
   *
   * @param ctx Active Pi extension context.
   * @param forceLocalCleanup Whether shutdown should clear local bookkeeping.
   */
  uninstall(ctx: ExtensionContext, forceLocalCleanup = false): void {
    const token = this.ownsStatusLine(ctx) ? this.installedToken : undefined;
    if (!token) return;
    try {
      ctx.ui.setFooter(undefined);
    } catch {
      if (!forceLocalCleanup) return;
    }
    this.clearOwnership(ctx, token);
  }

  /**
   * Stops Footer timers and clears host ownership during session shutdown.
   *
   * @param ctx Active Pi extension context, when available.
   */
  cleanup(ctx?: ExtensionContext): void {
    this.stopSessionTimer();
    if (ctx && this.isTuiContext(ctx)) this.uninstall(ctx, true);
    this.installedKind = undefined;
    this.installedToken = undefined;
    this.requestFooterRender = undefined;
    this.getActiveExtensionStatuses = () => new Map();
  }

  /**
   * Reconciles the session timer after a Footer configuration update.
   */
  reconcileSessionTimer(): void {
    const references = this.installedFooterReferences();
    const needsTime = references.has("time");
    const needsDuration = references.has("session_duration");
    const requirements =
      needsTime || needsDuration ? `${needsTime}:${needsDuration}` : "";
    if (
      !this.context.sessionLifecycle.isCurrent() ||
      this.installedKind !== "starship" ||
      !requirements
    ) {
      this.stopSessionTimer();
      this.sessionTimerRequirements = "";
      this.lastDurationLabel = "";
      return;
    }
    if (requirements === this.sessionTimerRequirements) return;
    this.stopSessionTimer();
    this.sessionTimerRequirements = requirements;
    this.lastDurationLabel = "";
    const timer = setInterval(() => {
      if (!this.context.sessionLifecycle.isCurrent()) return;
      if (needsTime) {
        this.context.refresh();
        return;
      }
      const label = this.context.state.sessionStartEpoch
        ? buildSessionDurationLabel(this.context.state.sessionStartEpoch)
        : "";
      if (label === this.lastDurationLabel) return;
      this.lastDurationLabel = label;
      this.context.refresh();
    }, 1000);
    this.stopSessionTimer = () => {
      clearInterval(timer);
      this.sessionTimerRequirements = "";
      this.stopSessionTimer = () => {};
    };
  }

  /**
   * Returns whether the owned Starship Footer needs project data.
   *
   * @returns Whether project refreshes are required.
   */
  needsProjectRefresh(): boolean {
    return (
      this.installedKind === "starship" && this.installedToken !== undefined
    );
  }

  /**
   * Returns the active extension status getter supplied by the Footer.
   *
   * @returns Read-only extension status map.
   */
  getExtensionStatuses(): ReadonlyMap<string, string> {
    return this.getActiveExtensionStatuses();
  }

  /**
   * Returns the format data dependencies of the owned Footer.
   *
   * @returns Active Footer dependency names.
   */
  installedFooterReferences(): Set<string> {
    return this.installedKind === "starship" && this.installedToken
      ? activeFooterReferences(this.context.getConfig())
      : new Set<string>();
  }

  /**
   * Requests a redraw from the mounted Footer component.
   */
  requestRender(): void {
    this.requestFooterRender?.();
  }

  /**
   * Reports whether a context is an interactive TUI context.
   *
   * @param ctx Candidate Pi extension context.
   * @returns Whether Footer host APIs are available.
   */
  private isTuiContext(ctx: ExtensionContext): boolean {
    return ctx.hasUI && (ctx.mode === undefined || ctx.mode === "tui");
  }

  /**
   * Returns the currently marked Footer owner on Pi's UI object.
   *
   * @param ctx Active Pi extension context.
   * @returns Existing owner token, when marked.
   */
  private footerOwner(ctx: ExtensionContext): unknown {
    return (ctx.ui as unknown as Record<PropertyKey, unknown>)[
      ZENTUI_FOOTER_OWNER
    ];
  }

  /**
   * Tests whether this controller still owns the host Footer marker.
   *
   * @param ctx Active Pi extension context.
   * @returns Whether the local owner token remains installed.
   */
  private ownsStatusLine(ctx: ExtensionContext): boolean {
    return (
      this.installedToken !== undefined &&
      this.footerOwner(ctx) === this.installedToken
    );
  }

  /**
   * Writes or removes the host Footer ownership marker.
   *
   * @param ctx Active Pi extension context.
   * @param token Owner token, or undefined to remove it.
   */
  private setOwnership(ctx: ExtensionContext, token: symbol | undefined): void {
    const ui = ctx.ui as unknown as Record<PropertyKey, unknown>;
    try {
      if (token) ui[ZENTUI_FOOTER_OWNER] = token;
      else delete ui[ZENTUI_FOOTER_OWNER];
    } catch {
      // Failure to mark ownership prevents destructive native restoration.
    }
  }

  /**
   * Clears local Footer state after the host has released an owned Footer.
   *
   * @param ctx Active Pi extension context.
   * @param token Owner token being released.
   */
  private clearOwnership(ctx: ExtensionContext, token: symbol): void {
    if (this.installedToken !== token) return;
    this.installedKind = undefined;
    this.installedToken = undefined;
    if (this.footerOwner(ctx) === token) this.setOwnership(ctx, undefined);
    this.requestFooterRender = undefined;
    this.getActiveExtensionStatuses = () => new Map();
    this.stopSessionTimer();
    if (this.context.sessionLifecycle.isCurrent())
      this.context.onProjectRequirementChanged(ctx, true);
  }

  /**
   * Installs the Starship Footer with transactional local bookkeeping.
   *
   * @param ctx Active Pi extension context.
   */
  private installStarship(ctx: ExtensionContext): void {
    if (this.installedKind === "starship" && this.ownsStatusLine(ctx)) return;
    const token = Symbol("pi-one-ui-starship-footer");
    const previous = this.snapshotBookkeeping(ctx);
    try {
      installFooter(ctx, this.context.state, this.context.getConfig, {
        setRequestRender: (requestRender) => {
          this.requestFooterRender = requestRender;
        },
        scheduleProjectRefresh: (refreshContext) =>
          this.context.scheduleProjectRefresh(refreshContext),
        setExtensionStatusesGetter: (getter) => {
          this.getActiveExtensionStatuses = getter ?? (() => new Map());
        },
        getLiveContext: () => this.context.getLiveContext(),
        onDispose: () => this.clearOwnership(ctx, token),
      });
      this.installedKind = "starship";
      this.installedToken = token;
      this.setOwnership(ctx, token);
      this.context.refresh();
    } catch {
      this.restoreFailedInstallation(ctx, token, previous);
    }
  }

  /**
   * Installs the hidden Footer while retaining ownership cleanup semantics.
   *
   * @param ctx Active Pi extension context.
   */
  private installHidden(ctx: ExtensionContext): void {
    if (this.installedKind === "hidden" && this.ownsStatusLine(ctx)) return;
    const token = Symbol("pi-one-ui-hidden-footer");
    const previous = this.snapshotBookkeeping(ctx);
    try {
      installHiddenFooter(ctx, () => this.clearOwnership(ctx, token));
      this.installedKind = "hidden";
      this.installedToken = token;
      this.setOwnership(ctx, token);
      this.requestFooterRender = undefined;
      this.getActiveExtensionStatuses = () => new Map();
      this.stopSessionTimer();
    } catch {
      this.restoreFailedInstallation(ctx, token, previous);
    }
  }

  /**
   * Snapshots callbacks needed to retain a live Footer after a failed swap.
   *
   * @param ctx Active Pi extension context.
   * @returns Previous Footer bookkeeping.
   */
  private snapshotBookkeeping(ctx: ExtensionContext) {
    return {
      token: this.ownsStatusLine(ctx) ? this.installedToken : undefined,
      requestRender: this.requestFooterRender,
      getExtensionStatuses: this.getActiveExtensionStatuses,
    };
  }

  /**
   * Restores predecessor callbacks after a non-transactional Footer failure.
   *
   * @param ctx Active Pi extension context.
   * @param token Failed replacement token.
   * @param previous Predecessor bookkeeping snapshot.
   */
  private restoreFailedInstallation(
    ctx: ExtensionContext,
    token: symbol,
    previous: ReturnType<FooterSurfaceController["snapshotBookkeeping"]>,
  ): void {
    if (
      previous.token !== undefined &&
      this.installedToken === previous.token &&
      this.footerOwner(ctx) === previous.token
    ) {
      this.requestFooterRender = previous.requestRender;
      this.getActiveExtensionStatuses = previous.getExtensionStatuses;
      return;
    }
    this.clearOwnership(ctx, token);
  }

  /**
   * Resolves the configured Footer style with unsupported-style fallback.
   *
   * @returns Effective Footer style.
   */
  private effectiveFooterStyle(): PolishedTuiConfig["components"]["footer"]["style"] {
    return hasUnsupportedComponentStyle(this.context.getConfig(), "footer")
      ? "native"
      : this.context.getConfig().components.footer.style;
  }
}
