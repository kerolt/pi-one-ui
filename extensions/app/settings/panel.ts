import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createSettingsPanel } from "../../layouts/overlay/settings-panel.ts";
import { ConfigApplicationError } from "../config/store.ts";
import {
  type OverlayManager,
  overlayManager,
} from "../overlay/overlay-manager.ts";
import { SettingsController, settingsSnapshot } from "./controller.ts";

export type SettingsPanelController = Pick<
  SettingsController,
  "snapshot" | "update"
>;
type PanelDependencies = {
  settings?: SettingsPanelController;
  overlays?: OverlayManager;
};
const openPanels = new WeakMap<OverlayManager, object>();

/** 命令负责配置提交和通知，OverlayManager 负责窗口与 Editor 焦点。 */
export async function showOneUiPanel(
  ctx: ExtensionCommandContext,
  dependencies: PanelDependencies = {},
): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui.custom !== "function") {
    ctx.ui.notify("/oneui requires TUI mode", "warning");
    return;
  }
  const overlays = dependencies.overlays ?? overlayManager;
  if (openPanels.has(overlays) && overlays.hasActive()) {
    ctx.ui.notify("/oneui panel is already open", "info");
    return;
  }
  const settings = dependencies.settings ?? new SettingsController();
  let snapshot = settings.snapshot();
  const token = {};
  openPanels.set(overlays, token);
  try {
    await overlays.open(
      ctx,
      (tui, theme, _keybindings, done) =>
        createSettingsPanel(tui, theme, () => done(undefined), {
          snapshot: () => snapshot,
          change(id, value) {
            const apply = () => {
              snapshot = settings.update(id, value);
              ctx.ui.notify(
                `${id}: ${value} saved; live preview updated when supported.`,
                "info",
              );
            };
            if (
              id === "editorStyle" ||
              id === "editorBorderColorMode" ||
              id.startsWith("preset:")
            ) {
              overlays.updateEditor(apply);
            } else {
              apply();
            }
          },
          onError(error) {
            if (error instanceof ConfigApplicationError) {
              snapshot = settingsSnapshot(error.record);
              ctx.ui.notify(error.message, "error");
            } else {
              ctx.ui.notify(
                `Could not update /oneui setting: ${error instanceof Error ? error.message : String(error)}`,
                "error",
              );
            }
          },
        }),
      { overlayOptions: snapshot.panel, preserveEditorFocus: true },
    );
  } finally {
    if (openPanels.get(overlays) === token) {
      openPanels.delete(overlays);
    }
  }
}
