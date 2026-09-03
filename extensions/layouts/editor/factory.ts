import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "../../app/config/shell.ts";
import { type FooterState, modelLabelFor } from "../footer/index.ts";
import {
  type EditorFactory,
  markEditorFactory,
  markWrappedEditorFactory,
  type ZentuiEditorFactory,
} from "./ownership.ts";
import { PolishedEditor, WrappedPolishedEditor } from "./ui.ts";

export type EditorFactoryRuntime = {
  readonly ownerToken: symbol;
  readonly sessionTheme: Theme;
  readonly getConfig: () => PolishedTuiConfig;
  readonly getState: () => FooterState;
  readonly getThinkingLevel: () => ReturnType<ExtensionAPI["getThinkingLevel"]>;
  readonly getAgentDurationMs: () => number;
  readonly isAgentActive: () => boolean;
  readonly getProjectRoot: () => string | undefined;
  readonly onRender: (requestRender: () => void) => void;
  readonly onDecorationActive: (active: boolean) => void;
};

/**
 * Creates the native polished Editor factory for one Pi session.
 *
 * @param ctx Active Pi extension context.
 * @param runtime Runtime selectors and lifecycle callbacks used by the Editor.
 * @returns An owned Editor factory.
 */
export function createEditorFactory(
  ctx: ExtensionContext,
  runtime: EditorFactoryRuntime,
): ZentuiEditorFactory {
  const factory = ((
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) => {
    runtime.onRender(() => tui.requestRender());
    return new PolishedEditor(
      tui,
      theme,
      keybindings,
      runtime.sessionTheme,
      runtime.getConfig,
      () => editorMetadata(ctx, runtime),
      runtime.getThinkingLevel,
      () => editorDecoration(ctx, runtime),
      runtime.onDecorationActive,
    );
  }) as ZentuiEditorFactory;
  return markEditorFactory(factory, runtime.ownerToken);
}

/**
 * Creates an Editor factory that decorates a third-party editor.
 *
 * @param ctx Active Pi extension context.
 * @param baseFactory Third-party factory retained for restoration.
 * @param runtime Runtime selectors and lifecycle callbacks used by the Editor.
 * @returns An owned wrapper factory.
 */
export function createWrappedEditorFactory(
  ctx: ExtensionContext,
  baseFactory: EditorFactory,
  runtime: EditorFactoryRuntime,
): ZentuiEditorFactory {
  const factory = ((
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) => {
    runtime.onRender(() => tui.requestRender());
    return new WrappedPolishedEditor(
      baseFactory(tui, theme, keybindings),
      runtime.sessionTheme,
      runtime.getConfig,
      () => editorMetadata(ctx, runtime),
      runtime.getThinkingLevel,
      () => editorDecoration(ctx, runtime),
      runtime.onDecorationActive,
    );
  }) as ZentuiEditorFactory;
  return markWrappedEditorFactory(factory, baseFactory, runtime.ownerToken);
}

/**
 * Selects the model and session metadata shown by the Editor.
 *
 * @param ctx Active Pi extension context.
 * @param runtime Runtime selectors for shared state.
 * @returns Current Editor metadata.
 */
function editorMetadata(ctx: ExtensionContext, runtime: EditorFactoryRuntime) {
  const state = runtime.getState();
  const config = runtime.getConfig();
  return {
    modelLabel: modelLabelFor(state, config.components.editor.modelLabel),
    modelId: state.modelId,
    modelName: state.modelName,
    providerLabel: state.providerLabel,
    sessionName: ctx.sessionManager.getSessionName() ?? "",
  };
}

/**
 * Selects the dynamic project and usage metadata shown by the Editor.
 *
 * @param ctx Active Pi extension context.
 * @param runtime Runtime selectors for shared state and timers.
 * @returns Current Editor decoration data.
 */
function editorDecoration(
  ctx: ExtensionContext,
  runtime: EditorFactoryRuntime,
) {
  const state = runtime.getState();
  const config = runtime.getConfig();
  return {
    cwd: ctx.cwd,
    projectRoot: runtime.getProjectRoot(),
    branch: state.branch,
    dirty: state.dirty,
    ahead: state.ahead,
    behind: state.behind,
    costLabel: state.costLabel,
    modelLabel: modelLabelFor(state, config.components.editor.modelLabel),
    thinkingLevel: runtime.getThinkingLevel(),
    sessionName: ctx.sessionManager.getSessionName() ?? "",
    agentDurationMs: runtime.getAgentDurationMs(),
    agentActive: runtime.isAgentActive(),
  };
}
