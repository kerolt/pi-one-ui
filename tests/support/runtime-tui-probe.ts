import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  type CreateAgentSessionRuntimeFactory,
  CustomEditor,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionError,
  InteractiveMode,
  SessionManager,
  SettingsManager,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type {
  EditorComponent,
  TuiAltScreen,
  TuiMainScreen,
} from "@earendil-works/pi-tui";

const tuiMode = process.argv[2];
assert(tuiMode === "regular" || tuiMode === "fullscreen");
assert(process.stdin.isTTY, "Run this probe in a terminal or PTY");
const directory = await mkdtemp(join(tmpdir(), "one-ui-tui-"));
const agentDir = join(directory, "agent");
const cwd = join(directory, "project");
await mkdir(agentDir);
await mkdir(cwd);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
await writeFile(
  join(agentDir, "pi-one-ui.json"),
  JSON.stringify({
    version: 1,
    projectRefreshIntervalMs: 0,
    components: { editor: { style: "off" } },
  }),
);
const { default: registerOneUi } = await import("../../extensions/index.ts");
const { SettingsController } = await import(
  "../../extensions/app/settings/controller.ts"
);
const settings = new SettingsController();
const errors: ExtensionError[] = [];
const originalUserRender = UserMessageComponent.prototype.render;

const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory({
      quietStartup: true,
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{ name: "pi-one-ui", factory: registerOneUi }],
    },
  });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager: options.sessionManager,
    sessionStartEvent: options.sessionStartEvent,
  });
  assert.deepEqual(result.extensionsResult.errors, []);
  result.session.extensionRunner.onError((error) => errors.push(error));
  return { ...result, services, diagnostics: services.diagnostics };
};
const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager: SessionManager.inMemory(cwd),
});
const mode = new InteractiveMode(runtime, { tuiMode });
const tui = Reflect.get(mode, "ui") as TuiMainScreen | TuiAltScreen;
const editor = () => Reflect.get(mode, "editor") as EditorComponent;
const listenerCount = () =>
  (Reflect.get(mode, "extensionTerminalInputSubscriptions") as Set<unknown>)
    .size;
const openCommand = (name: string) => {
  const runner = runtime.session.extensionRunner;
  const command = runner.getCommand(name);
  assert(command, `Missing command ${name}`);
  return command.handler("", runner.createCommandContext());
};
const input = (data: string): void => {
  const component = tui.getFocusedComponent();
  assert(component?.handleInput, "Focused component must accept input");
  component.handleInput(data);
};

try {
  await mode.init();
  assert.equal(listenerCount(), 1);
  runtime.session.extensionRunner.getUIContext().setEditorText("draft ");
  const previousEditor = editor();
  const panel = openCommand("oneui");
  await nextTurn();
  assert(tui.hasOverlay());
  for (let index = 0; index < 3; index += 1) {
    input("\t");
  }
  input(" ");
  assert.notEqual(editor(), previousEditor);
  assert(tui.isOverlayFocused());
  input("\x1b");
  await panel;
  assert.equal(tui.getFocusedComponent(), editor());
  input("visible");
  assert.equal(editor().getText(), "draft visible");
  assert(editor().render(100).join("\n").includes("draft visible"));

  const context = openCommand("context");
  await nextTurn();
  assert(tui.hasOverlay());
  input("\r");
  await nextTurn();
  assert(tui.hasOverlay());
  input("\x1b");
  await nextTurn();
  assert(tui.hasOverlay());
  input("\x1b");
  await context;
  assert.equal(tui.getFocusedComponent(), editor());

  settings.update("preset:native", "apply");
  assert.equal(settings.snapshot().shell.components.footer.style, "native");
  settings.update("preset:balanced", "apply");
  assert.equal(settings.snapshot().shell.components.footer.style, "starship");
  assert.equal(editor().getText(), "draft visible");

  await runtime.session.extensionRunner.createCommandContext().reload();
  await nextTurn();
  assert.equal(listenerCount(), 1);
  runtime.session.extensionRunner.onError((error) => errors.push(error));
  const manager = runtime.session.sessionManager;
  const first = manager.appendMessage({
    role: "user",
    content: "First branch entry",
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: "user",
    content: "Second branch entry",
    timestamp: Date.now(),
  });
  await runtime.session.navigateTree(first, { summarize: false });
  await nextTurn();
  assert.equal(listenerCount(), 1);
  const compacted = manager.appendCompaction("First branch entry", first, 5);
  const compactionEntry = manager.getEntry(compacted);
  assert(compactionEntry?.type === "compaction");
  await runtime.session.extensionRunner.emit({
    type: "session_compact",
    compactionEntry,
    fromExtension: true,
    reason: "manual",
    willRetry: false,
  });
  await nextTurn();
  assert.equal(listenerCount(), 1);

  const ui = runtime.session.extensionRunner.getUIContext();
  const thirdParty = (
    host: Parameters<NonNullable<ReturnType<typeof ui.getEditorComponent>>>[0],
    theme: Parameters<NonNullable<ReturnType<typeof ui.getEditorComponent>>>[1],
    keybindings: Parameters<
      NonNullable<ReturnType<typeof ui.getEditorComponent>>
    >[2],
  ) => new CustomEditor(host, theme, keybindings);
  ui.setEditorComponent(thirdParty);
  settings.update("footerStyle", "hidden");
  assert.equal(ui.getEditorComponent(), thirdParty);

  const pendingContext = openCommand("context");
  await nextTurn();
  input("\r");
  await nextTurn();
  assert(tui.hasOverlay());
  await runtime.newSession();
  await pendingContext;
  await nextTurn();
  assert(!tui.hasOverlay());
  assert.equal(listenerCount(), 1);
  const reopened = openCommand("oneui");
  await nextTurn();
  input("\x1b");
  await reopened;
  assert.equal(tui.getFocusedComponent(), editor());
  assert.deepEqual(errors, []);
} finally {
  await runtime.dispose();
  mode.stop();
  await rm(directory, { recursive: true, force: true });
}
assert.equal(UserMessageComponent.prototype.render, originalUserRender);
assert.equal(listenerCount(), 0);
assert.deepEqual(errors, []);
console.log(`ONEUI_TUI_OK ${tuiMode}`);
