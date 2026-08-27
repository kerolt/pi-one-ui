import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showOneUiPanel, type TuiPanelRuntime } from "../panel.ts";
import {
  createPiExtensionPort,
  type PiExtensionPort,
} from "../host/pi-extension-port.ts";
import { createPiUiPort, type PiUiPort } from "../host/pi-ui-port.ts";
import { SurfaceRegistry } from "../ownership/surface-registry.ts";
import registerHeaderSurface from "../../surfaces/header/index.ts";
import { EventCoordinator } from "./event-coordinator.ts";
import { RenderScheduler } from "./render-scheduler.ts";
import { RuntimeStateStore } from "./runtime-state.ts";
import registerSurfaceLifecycle, {
  type SurfaceRuntimeOptions,
  type SurfaceRuntimeController,
} from "./surface-lifecycle.ts";
import type { EditorSurfaceController } from "../../surfaces/editor/controller.ts";
import type { WorkingLineSurfaceController } from "../../surfaces/working-line/controller.ts";
import registerContext, {
  type ContextExtensionOptions,
  type ContextRuntimeController,
} from "../../surfaces/context/index.ts";

export type TuiRuntimeContext = {
  readonly extensions: PiExtensionPort;
  readonly state: RuntimeStateStore;
  readonly render: RenderScheduler;
  readonly surfaces: SurfaceRegistry;
  readonly ui: () => PiUiPort | undefined;
};

/**
 * The single composition root for the plugin. Remaining compatibility glue
 * is mounted behind this seam while Surface ownership is finalized.
 */
export class TuiRuntime {
  private readonly pi: ExtensionAPI;
  readonly extensions: PiExtensionPort;
  readonly state = new RuntimeStateStore();
  readonly surfaces = new SurfaceRegistry();

  private readonly coordinator: EventCoordinator;
  private readonly renderScheduler: RenderScheduler;
  private activeUi: PiUiPort | undefined;
  private installed = false;
  private surfaceController: SurfaceRuntimeController | undefined;
  private editorController: EditorSurfaceController | undefined;
  private workingLineController: WorkingLineSurfaceController | undefined;
  private contextController: ContextRuntimeController | undefined;

  /**
   * Creates the runtime services and coordinates session lifecycle ownership.
   */
  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.extensions = createPiExtensionPort(pi);
    this.renderScheduler = new RenderScheduler((force) =>
      this.activeUi?.requestRender(force),
    );
    this.coordinator = new EventCoordinator({
      on: (event, handler) =>
        this.extensions.on(event as never, handler as never),
    });
  }

  /**
   * Returns the shared render scheduler used by installed surfaces.
   */
  get render(): RenderScheduler {
    return this.renderScheduler;
  }

  /**
   * Returns the active session UI port, when a TUI session is mounted.
   */
  ui(): PiUiPort | undefined {
    return this.activeUi;
  }

  /**
   * Exposes the narrow runtime contract consumed by the settings panel.
   *
   * @returns Surface-independent panel operations.
   */
  private panelRuntime(): TuiPanelRuntime {
    return {
      setEditorComponent: (patch, ctx) =>
        this.editorController?.setComponent(patch, ctx) ?? { applied: false },
      setUserMessagesComponent: (patch, ctx) =>
        this.contextController?.setUserMessagesComponent(patch, ctx),
      setWorkingLineComponent: (patch, ctx) =>
        this.surfaceController?.setWorkingLineComponent(patch, ctx) ?? {
          applied: false,
          reason: "WorkingLine runtime is not available",
        },
      setFooterComponent: (patch, ctx) =>
        this.surfaceController?.setFooterComponent(patch, ctx),
      setContextMode: (mode, ctx) => this.contextController?.setMode(mode, ctx),
      updateContextConfig: (patch, ctx) =>
        this.contextController?.updateConfig(patch, ctx),
    };
  }

  /**
   * Installs the runtime once and mounts remaining surface lifecycle glue.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    const surfaceOptions: SurfaceRuntimeOptions = {
      manageEditorLifecycle: false,
      eventCoordinator: this.coordinator,
      ownTurnSummary: false,
      onRuntimeController: (controller) => {
        this.surfaceController = controller;
      },
      onEditorController: (controller) => {
        this.editorController = controller;
      },
      onWorkingLineController: (controller) => {
        this.workingLineController = controller;
      },
    };
    const contextOptions: ContextExtensionOptions = {
      onRuntimeController: (controller) => {
        this.contextController = controller;
      },
    };

    // This glue remains only for User Message, Selector, and other
    // compatibility hooks that have not yet moved to their final surfaces.
    registerSurfaceLifecycle(this.pi, surfaceOptions);
    registerHeaderSurface(this.pi);
    registerContext(this.pi, contextOptions);
    this.coordinator.on("session_start", async (_event, ctx) => {
      this.state.start(ctx.mode);
      if (ctx.mode === "tui" && ctx.hasUI) {
        // Pi exposes redraw through concrete TUI components; surfaces will
        // connect that callback when they migrate behind this runtime.
        this.activeUi = createPiUiPort(ctx);
      }
      await this.editorController?.startSession(ctx);
      this.editorController?.install(ctx, true);
      this.workingLineController?.startSession(ctx);
    });
    this.coordinator.on("session_shutdown", (_event, ctx) => {
      this.workingLineController?.dispose(ctx);
      this.activeUi = undefined;
      this.state.shutdown();
    });
    this.coordinator.install();

    this.extensions.registerCommand("oneui", {
      description: "Open pi-one-ui settings",
      handler: async (_args, ctx) => {
        await showOneUiPanel(ctx, { runtime: this.panelRuntime() });
      },
    });
  }
}

/**
 * Creates a single TUI runtime for the plugin composition root.
 */
export function createTuiRuntime(pi: ExtensionAPI): TuiRuntime {
  return new TuiRuntime(pi);
}
