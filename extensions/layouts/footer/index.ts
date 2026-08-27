export {
  FooterLayoutController,
  type FooterControllerContext,
} from "./controller.ts";
export { activeFooterReferences } from "./data.ts";
export { installFooter, installHiddenFooter } from "./footer.ts";
export {
  collectExtensionStatusSegments,
  sanitizeExtensionStatusOriginalText,
  sanitizeExtensionStatusText,
} from "./extension-status.ts";
export {
  collectFooterFormatReferences,
  compileCompactFormat,
  parseFooterFormat,
  renderFormatSplit,
  renderFormatTokens,
} from "./footer-format.ts";
export {
  createInitialState,
  modelLabelFor,
  syncState,
} from "../../services/session-state.ts";
export type { FooterState } from "../../services/session-state.ts";
