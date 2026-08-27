import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type PiUi = ExtensionContext["ui"];

export type PiUiPort = Pick<
  PiUi,
  | "custom"
  | "getEditorComponent"
  | "getToolsExpanded"
  | "notify"
  | "onTerminalInput"
  | "setEditorComponent"
  | "setFooter"
  | "setHeader"
  | "setStatus"
  | "setToolsExpanded"
  | "setWidget"
  | "setWorkingIndicator"
  | "setWorkingMessage"
  | "setWorkingVisible"
> & {
  readonly theme: PiUi["theme"];
  requestRender(force?: boolean): void;
};

/**
 * Adapts a session UI context to the narrow port consumed by surfaces.
 */
export function createPiUiPort(
  ctx: ExtensionContext,
  requestRender: (force?: boolean) => void = () => {},
): PiUiPort {
  const ui = ctx.ui;
  return {
    custom: (...args) => ui.custom(...args),
    getEditorComponent: () => ui.getEditorComponent(),
    getToolsExpanded: () => ui.getToolsExpanded(),
    notify: (...args) => ui.notify(...args),
    onTerminalInput: (handler) => ui.onTerminalInput(handler),
    setEditorComponent: (factory) => ui.setEditorComponent(factory),
    setFooter: (factory) => ui.setFooter(factory),
    setHeader: (factory) => ui.setHeader(factory),
    setStatus: (key, text) => ui.setStatus(key, text),
    setToolsExpanded: (expanded) => ui.setToolsExpanded(expanded),
    setWidget: ui.setWidget.bind(ui) as PiUiPort["setWidget"],
    setWorkingIndicator: (options) => ui.setWorkingIndicator(options),
    setWorkingMessage: (message) => ui.setWorkingMessage(message),
    setWorkingVisible: (visible) => ui.setWorkingVisible(visible),
    theme: ui.theme,
    requestRender,
  };
}
