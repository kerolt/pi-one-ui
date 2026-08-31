export type { FooterState } from "../../services/session-state.ts";
export {
  createInitialState,
  modelLabelFor,
  syncState,
} from "../../services/session-state.ts";
export {
  type FooterControllerContext,
  FooterLayoutController,
} from "./controller.ts";
export { activeFooterReferences } from "./data.ts";
export {
  collectExtensionStatusSegments,
  sanitizeExtensionStatusOriginalText,
  sanitizeExtensionStatusText,
} from "./extension-status.ts";
export { installFooter, installHiddenFooter } from "./footer.ts";
export {
  collectFooterFormatReferences,
  compileCompactFormat,
  parseFooterFormat,
  renderFormatSplit,
  renderFormatTokens,
} from "./footer-format.ts";
