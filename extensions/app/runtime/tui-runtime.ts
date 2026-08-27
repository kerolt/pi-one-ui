import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showOneUiPanel } from "../panel.ts";
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
import registerShell, {
  type ShellExtensionOptions,
  type ShellRuntimeController,
} from "../../shell/index.ts";
import registerContext, {
  type TranscriptExtensionOptions,
  type TranscriptRuntimeController,
} from "../../transcript/index.ts";

export type TuiRuntimeContext = {
  readonly extensions: PiExtensionPort;
  readonly state: RuntimeStateStore;
  readonly render: RenderScheduler;
  readonly surfaces: SurfaceRegistry;
  readonly ui: () => PiUiPort | undefined;
};

/**
 * The single composition root for the plugin. Legacy Shell/Transcript
 * implementations are still mounted behind this seam during migration.
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
  private shellController: ShellRuntimeController | undefined;
  private contextController: TranscriptRuntimeController | undefined;

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
    this.coordinator.on("session_start", (_event, ctx) => {
      this.state.start(ctx.mode);
      if (ctx.mode === "tui" && ctx.hasUI) {
        // Pi exposes redraw through concrete TUI components; surfaces will
        // connect that callback when they migrate behind this runtime.
        this.activeUi = createPiUiPort(ctx);
      }
    });
    this.coordinator.on("session_shutdown", () => {
      this.activeUi = undefined;
      this.state.shutdown();
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
   * Installs the runtime once and mounts legacy adapters behind its seam.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    const shellOptions: ShellExtensionOptions = {
      registerCommand: false,
      onRuntimeController: (controller) => {
        this.shellController = controller;
      },
    };
    const contextOptions: TranscriptExtensionOptions = {
      onRuntimeController: (controller) => {
        this.contextController = controller;
      },
    };

    // These are compatibility adapters for the first migration stage. Future
    // stages replace them with Header/Context/WorkingLine/Editor/Footer surfaces.
    registerShell(this.pi, shellOptions);
    registerHeaderSurface(this.pi);
    registerContext(this.pi, contextOptions);
    this.coordinator.install();

    this.extensions.registerCommand("oneui", {
      description: "Open pi-one-ui settings",
      handler: async (_args, ctx) => {
        await showOneUiPanel(ctx, {
          shell: this.shellController,
          renderer: this.contextController,
        });
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
