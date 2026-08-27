import {
  FOOTER_FORMAT_ALIASES,
  type ZentuiConfig,
} from "../../app/config/shell.ts";
import {
  collectFooterFormatReferences,
  parseFooterFormat,
} from "./footer-format.ts";

/**
 * Returns the footer data dependencies referenced by the active formats.
 *
 * @param config Current normalized plugin configuration.
 * @returns Names of project, session, runtime, and clock data dependencies.
 */
export function activeFooterReferences(config: ZentuiConfig): Set<string> {
  const starship = config.components.footer.styles.starship;
  const references = starship.format
    ? collectFooterFormatReferences(
        parseFooterFormat(starship.format),
        FOOTER_FORMAT_ALIASES,
      )
    : new Set<string>([
        ...(starship.segments.sessionName ? ["session_name"] : []),
        ...(starship.segments.runtime ? ["runtime"] : []),
        ...(starship.segments.gitCommit ? ["git_commit"] : []),
        ...(starship.segments.gitMetrics ? ["git_metrics"] : []),
        ...(starship.segments.packageVersion ? ["package"] : []),
        ...(starship.segments.sessionDuration ? ["session_duration"] : []),
        ...(starship.segments.time ? ["time"] : []),
      ]);
  if (starship.responsive) {
    for (const name of collectFooterFormatReferences(
      parseFooterFormat(starship.compactFormat),
      FOOTER_FORMAT_ALIASES,
    )) {
      references.add(name);
    }
  }
  return references;
}
