import type {
  OverlayAnchor,
  OverlayMargin,
  SizeValue,
} from "@earendil-works/pi-tui";
import { configStore } from "./store.ts";

/**
 * Overlay placement for the /oneui settings panel. Mirrors the Pi
 * `OverlayOptions` subset the panel supports; persisted under the
 * top-level `panel` key in `pi-one-ui.json`.
 */
export type PanelOverlayConfig = {
  anchor: OverlayAnchor;
  width: SizeValue;
  maxHeight: SizeValue;
  margin: OverlayMargin | number;
};

/** Defaults preserve the historically hardcoded /oneui panel placement. */
export const DEFAULT_PANEL_OVERLAY: PanelOverlayConfig = {
  anchor: "top-center",
  width: "85%",
  maxHeight: "90%",
  margin: { top: 6, right: 1, bottom: 1, left: 1 },
};

const PANEL_ANCHORS: readonly OverlayAnchor[] = [
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
  "left-center",
  "right-center",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAnchor(value: unknown): OverlayAnchor {
  return PANEL_ANCHORS.some((anchor) => anchor === value)
    ? (value as OverlayAnchor)
    : DEFAULT_PANEL_OVERLAY.anchor;
}

/** Accepts a positive column/row count or a "N%" string within 0..100. */
function parseSizeValue(value: unknown, fallback: SizeValue): SizeValue {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(value.trim());
    if (match) {
      const percent = Number(match[1]);
      if (percent > 0 && percent <= 100) {
        return value.trim() as SizeValue;
      }
    }
  }
  return fallback;
}

function parseMarginEdge(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Accepts one non-negative integer for all edges or a per-edge object. */
function parseMargin(value: unknown): OverlayMargin | number {
  const fallback = DEFAULT_PANEL_OVERLAY.margin;
  if (typeof value === "number") {
    return parseMarginEdge(value) ?? fallback;
  }
  if (!isRecord(value)) {
    return fallback;
  }
  const defaults = isRecord(fallback) ? (fallback as OverlayMargin) : {};
  const margin: OverlayMargin = {};
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    margin[edge] = parseMarginEdge(value[edge]) ?? defaults[edge];
  }
  return margin;
}

/**
 * Normalizes the raw `panel` config section, replacing invalid fields with
 * defaults so a broken entry never blocks the /oneui panel from opening.
 */
export function normalizePanelOverlay(input: unknown): PanelOverlayConfig {
  const source = isRecord(input) ? input : {};
  return {
    anchor: parseAnchor(source.anchor),
    width: parseSizeValue(source.width, DEFAULT_PANEL_OVERLAY.width),
    maxHeight: parseSizeValue(
      source.maxHeight,
      DEFAULT_PANEL_OVERLAY.maxHeight,
    ),
    margin: parseMargin(source.margin),
  };
}

/**
 * Loads the panel overlay placement from the shared store. Read fresh on
 * every /oneui open so JSON edits apply without `/reload`.
 */
export function loadPanelOverlayConfig(): PanelOverlayConfig {
  try {
    return normalizePanelOverlay(configStore.read().panel);
  } catch {
    return normalizePanelOverlay(undefined);
  }
}
