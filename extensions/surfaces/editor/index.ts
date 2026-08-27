export {
  EditorSurfaceController,
  type EditorChangeResult,
  type EditorSurfaceControllerContext,
} from "./controller.ts";
export {
  installHostAccentRailLayoutPatch,
  markAccentRailLayoutEditor,
  retainAccentRailLayoutPatchInstallation,
  type AccentRailLayoutPatchDiagnostic,
} from "./accent-rail-layout-patch.ts";
export {
  replaceEditorComponentWithExpandedText,
  type EditorTransferFailureReason,
} from "./editor-transfer.ts";
export { PolishedEditor, WrappedPolishedEditor } from "./ui.ts";
