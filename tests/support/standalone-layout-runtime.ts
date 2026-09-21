import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
  EditorStyle,
  FooterStyle,
} from "../../extensions/app/config/shell.ts";
import { createLayoutRuntime } from "../../extensions/app/runtime/tui-runtime.ts";

export { activeFooterReferences } from "../../extensions/layouts/footer/data.ts";

/** 组件测试使用生产装配和同一个 SettingsController。 */
export default function registerLayoutRuntime(pi: ExtensionAPI) {
  const runtime = createLayoutRuntime(pi);
  return {
    ...runtime,
    editorController: {
      setComponent: (patch: { style: EditorStyle }, _ctx: ExtensionContext) =>
        runtime.settings.update("editorStyle", patch.style),
    },
    footerController: {
      setComponent: (patch: { style: FooterStyle }, _ctx: ExtensionContext) =>
        runtime.settings.update("footerStyle", patch.style),
    },
  };
}
