import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type PiExtensionPort = Pick<
  ExtensionAPI,
  | "appendEntry"
  | "on"
  | "registerCommand"
  | "registerEntryRenderer"
  | "registerMarkdownTransformer"
  | "registerMessageRenderer"
>;

/**
 * Binds the host extension API once so modules do not pass the raw object around.
 */
export function createPiExtensionPort(pi: ExtensionAPI): PiExtensionPort {
  return {
    appendEntry: pi.appendEntry.bind(pi),
    on: pi.on.bind(pi) as PiExtensionPort["on"],
    registerCommand: pi.registerCommand.bind(pi),
    registerEntryRenderer: pi.registerEntryRenderer.bind(pi),
    registerMarkdownTransformer: pi.registerMarkdownTransformer.bind(pi),
    registerMessageRenderer: pi.registerMessageRenderer.bind(pi),
  };
}
