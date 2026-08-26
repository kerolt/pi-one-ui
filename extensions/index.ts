import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showOneUiPanel } from "./app/panel.ts";
import registerShell, {
  type ShellExtensionOptions,
  type ShellRuntimeController,
} from "./shell/index.ts";
import registerTranscript, {
  type TranscriptExtensionOptions,
  type TranscriptRuntimeController,
} from "./transcript/index.ts";

type Controllers = {
  shell?: ShellRuntimeController;
  renderer?: TranscriptRuntimeController;
};

function registerOneUiCommand(
  pi: ExtensionAPI,
  controllers: Controllers,
): void {
  pi.registerCommand("oneui", {
    description: "Open pi-one-ui settings",
    handler: async (_args, ctx) => {
      await showOneUiPanel(ctx, controllers);
    },
  });
}

export default function (pi: ExtensionAPI): void {
  let shellController: ShellRuntimeController | undefined;
  let rendererController: TranscriptRuntimeController | undefined;
  const shellOptions: ShellExtensionOptions = {
    registerCommand: false,
    onRuntimeController: (controller) => {
      shellController = controller;
    },
  };
  const rendererOptions: TranscriptExtensionOptions = {
    onRuntimeController: (controller) => {
      rendererController = controller;
    },
  };

  // One package, one management command. The internal owners remain explicit:
  // Shell owns the terminal chrome; transcript owns tool and message rendering.
  registerShell(pi, shellOptions);
  registerTranscript(pi, rendererOptions);
  registerOneUiCommand(pi, {
    shell: shellController,
    renderer: rendererController,
  });
}
