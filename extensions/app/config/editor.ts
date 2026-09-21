import { booleanValue, recordValue } from "./values.ts";

export type ModelLabelSource = "id" | "name";
export type EditorStyle = "on" | "off";
export type EditorBorderColorMode = "static" | "adaptive";
export type MinimalistPathDisplayMode = "compact" | "project" | "full";
export type MinimalistEditorStyleConfig = {
  pathDisplay: MinimalistPathDisplayMode;
  showCwd: boolean;
  showSessionName: boolean;
  showTimer: boolean;
  showCost: boolean;
  showGit: boolean;
};
export type MinimalistConfig = MinimalistEditorStyleConfig;
export type EditorStylesConfig = { minimalist: MinimalistEditorStyleConfig };
export type EditorComponentConfig = {
  style: EditorStyle;
  borderColorMode: EditorBorderColorMode;
  modelLabel: ModelLabelSource;
  viewportIndicators: boolean;
  styles: EditorStylesConfig;
};

export const DEFAULT_EDITOR_METADATA_FORMAT = "$model  $provider(  $thinking)";
export const defaultMinimalistStyle: MinimalistEditorStyleConfig = {
  pathDisplay: "compact",
  showCwd: true,
  showSessionName: true,
  showTimer: true,
  showCost: true,
  showGit: true,
};
export const defaultEditor: EditorComponentConfig = {
  style: "on",
  borderColorMode: "static",
  modelLabel: "id",
  viewportIndicators: true,
  styles: { minimalist: defaultMinimalistStyle },
};

export function parseEditorModelLabel(value: unknown): ModelLabelSource {
  return value === "name" ? "name" : "id";
}

export function parseEditorStyle(value: unknown): EditorStyle {
  return value === "off" ? "off" : "on";
}

export function parseEditorBorderColorMode(
  value: unknown,
): EditorBorderColorMode {
  return value === "adaptive" ? "adaptive" : "static";
}

/** 配置规范化仅生成 canonical 字段。 */
export function normalizeEditor(value: unknown): EditorComponentConfig {
  const editor = recordValue(value);
  const minimalist = recordValue(recordValue(editor.styles).minimalist);
  return {
    style: editor.enabled === false ? "off" : parseEditorStyle(editor.style),
    borderColorMode: parseEditorBorderColorMode(editor.borderColorMode),
    modelLabel: parseEditorModelLabel(editor.modelLabel),
    viewportIndicators: booleanValue(editor.viewportIndicators, true),
    styles: {
      minimalist: {
        pathDisplay:
          minimalist.pathDisplay === "project" ||
          minimalist.pathDisplay === "full"
            ? minimalist.pathDisplay
            : "compact",
        showCwd: booleanValue(minimalist.showCwd, true),
        showSessionName: booleanValue(minimalist.showSessionName, true),
        showTimer: booleanValue(minimalist.showTimer, true),
        showCost: booleanValue(minimalist.showCost, true),
        showGit: booleanValue(minimalist.showGit, true),
      },
    },
  };
}
