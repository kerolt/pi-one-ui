import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  hasUnsupportedComponentStyle,
  type PolishedTuiConfig,
} from "../config/shell.ts";
import { installSelectorBorderStyle } from "./selector-border.ts";

/**
 * Provides the shared configuration and host state consumed by selector styling.
 */
export type SelectorControllerContext = {
  readonly getConfig: () => PolishedTuiConfig;
};

/**
 * Owns selector border patch installation and restoration for the Overlay layer.
 */
export class SelectorController {
  private readonly context: SelectorControllerContext;
  private activeTheme: Theme | undefined;
  private cleanupPatch: () => void = () => {};
  private installed = false;

  /**
   * Creates a selector controller backed by the canonical configuration.
   *
   * @param context Configuration selector used by the patch.
   */
  constructor(context: SelectorControllerContext) {
    this.context = context;
  }

  /**
   * Starts selector ownership for an interactive TUI session.
   *
   * @param ctx Active Pi extension context.
   */
  startSession(ctx: ExtensionContext): void {
    if (!this.isTuiContext(ctx)) return;
    this.activeTheme = ctx.ui.theme;
    this.reconcile();
  }

  /**
   * Reconciles selector border ownership with the latest configuration.
   */
  reconcile(): void {
    const config = this.context.getConfig();
    const enabled =
      config.components.selectorBorders.enabled &&
      config.components.selectorBorders.style === "zentui" &&
      !hasUnsupportedComponentStyle(config, "selectorBorders");
    if (enabled) this.install();
    else this.uninstall();
  }

  /**
   * Restores selector prototypes and clears session-local state.
   */
  cleanup(): void {
    this.uninstall();
    this.activeTheme = undefined;
  }

  /**
   * Installs the selector prototype patch once.
   */
  private install(): void {
    if (this.installed || !this.activeTheme) return;
    try {
      this.cleanupPatch = installSelectorBorderStyle(
        () => this.activeTheme,
        this.context.getConfig,
      );
      this.installed = true;
    } catch {
      this.cleanupPatch = () => {};
      this.installed = false;
    }
  }

  /**
   * Removes the selector prototype patch when owned by this controller.
   */
  private uninstall(): void {
    try {
      this.cleanupPatch();
    } finally {
      this.cleanupPatch = () => {};
      this.installed = false;
    }
  }

  /**
   * Reports whether a context exposes an interactive TUI.
   *
   * @param ctx Candidate Pi extension context.
   * @returns Whether selector styling may be installed.
   */
  private isTuiContext(ctx: ExtensionContext): boolean {
    const mode = (ctx as ExtensionContext & { mode?: string }).mode;
    return ctx.hasUI && (mode === undefined || mode === "tui");
  }
}
