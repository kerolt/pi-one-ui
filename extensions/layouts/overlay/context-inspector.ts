import {
  type ExtensionCommandContext,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  type OverlayManager,
  overlayManager,
} from "../../app/overlay/overlay-manager.ts";
import { padLine } from "../../tools/format.ts";
import { mouseBaseButton, parseSgrMousePacket } from "../../tools/sgr-mouse.ts";

export type ContextPart = {
  label: string;
  tokens: number;
  color:
    | "accent"
    | "success"
    | "warning"
    | "customMessageLabel"
    | "muted"
    | "dim"
    | "error";
};
export type ContextPreviewKey =
  | "systemPrompt"
  | "memoryFiles"
  | "skills"
  | "tools"
  | "toolResults"
  | "contextFiles";
export type ContextInspectorData = {
  parts: ContextPart[];
  used: number;
  contextWindow: number;
  previews: Record<ContextPreviewKey, string>;
};
export type DialogBounds = { left: number; top: number; width: number };
type Hitbox = { row: number; startCol: number; endCol: number };

export function escCloseHitbox(bounds: DialogBounds): Hitbox {
  return {
    row: bounds.top + 2,
    startCol: bounds.left + bounds.width - 5,
    endCol: bounds.left + bounds.width - 1,
  };
}
export function hasActiveTextPreview(): boolean {
  return overlayManager.hasActive();
}
export function formatTokens(tokens: number): string {
  return tokens < 1_000
    ? String(tokens)
    : tokens < 100_000
      ? `${(tokens / 1_000).toFixed(1)}k`
      : `${Math.round(tokens / 1_000)}k`;
}
function normalizePreviewText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
function ensureFullscreenMouseMotion(tui: TUI): void {
  if (tui.mode === "fullscreen") {
    tui.terminal.write("\x1b[?1003h\x1b[?1006h");
  }
}
function contains(
  hitbox: Hitbox | undefined,
  row: number,
  col: number,
): boolean {
  return Boolean(
    hitbox &&
      row === hitbox.row &&
      col >= hitbox.startCol &&
      col <= hitbox.endCol,
  );
}

/** Markdown 预览的滚动、鼠标命中与视觉状态完全属于视图。 */
export async function showTextPreview(
  ctx: Pick<ExtensionCommandContext, "ui">,
  title: string,
  rawContent: string,
  overlays: OverlayManager = overlayManager,
): Promise<void> {
  const content = normalizePreviewText(rawContent);
  await overlays.open(
    ctx,
    (tui, theme, _keybindings, done) => {
      ensureFullscreenMouseMotion(tui);
      let scrollOffset = 0;
      let pageSize = 1;
      let totalLines = 1;
      let escHovered = false;
      let escHitbox: Hitbox | undefined;
      let scrollbarHitbox:
        | {
            col: number;
            startRow: number;
            endRow: number;
            thumbStart: number;
            thumbSize: number;
            maxOffset: number;
          }
        | undefined;
      let scrollbarDragOffset: number | null = null;
      const markdown = new Markdown(content, 0, 0, getMarkdownTheme());
      const scrollTo = (offset: number): void => {
        const next = Math.max(
          0,
          Math.min(offset, Math.max(0, totalLines - pageSize)),
        );
        if (next !== scrollOffset) {
          scrollOffset = next;
          tui.requestRender();
        }
      };
      const dragScrollbarTo = (row: number): void => {
        if (!scrollbarHitbox || scrollbarDragOffset === null) {
          return;
        }
        const trackSize = scrollbarHitbox.endRow - scrollbarHitbox.startRow + 1;
        const maxThumbStart = Math.max(
          0,
          trackSize - scrollbarHitbox.thumbSize,
        );
        const start = Math.max(
          0,
          Math.min(
            row - scrollbarHitbox.startRow - scrollbarDragOffset,
            maxThumbStart,
          ),
        );
        scrollTo(
          maxThumbStart > 0
            ? Math.round((start / maxThumbStart) * scrollbarHitbox.maxOffset)
            : 0,
        );
      };
      return {
        invalidate() {
          markdown.invalidate();
        },
        handleInput(data: string) {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            done(undefined);
            return;
          }
          if (matchesKey(data, Key.up)) {
            scrollTo(scrollOffset - 1);
          } else if (matchesKey(data, Key.down)) {
            scrollTo(scrollOffset + 1);
          } else if (matchesKey(data, "pageUp")) {
            scrollTo(scrollOffset - pageSize);
          } else if (matchesKey(data, "pageDown")) {
            scrollTo(scrollOffset + pageSize);
          } else if (matchesKey(data, Key.home)) {
            scrollTo(0);
          } else if (matchesKey(data, Key.end)) {
            scrollTo(totalLines - pageSize);
          } else {
            const mouse = parseSgrMousePacket(data);
            if (!mouse) {
              return;
            }
            if (mouse.final === "m") {
              scrollbarDragOffset = null;
              return;
            }
            const overEsc = contains(escHitbox, mouse.row, mouse.col);
            if (overEsc !== escHovered) {
              escHovered = overEsc;
              tui.requestRender();
            }
            const button = mouseBaseButton(mouse.code);
            const motion = (mouse.code & 32) !== 0;
            if (button === 0 && !motion) {
              if (overEsc) {
                done(undefined);
                return;
              }
              if (
                scrollbarHitbox &&
                mouse.col === scrollbarHitbox.col &&
                mouse.row >= scrollbarHitbox.startRow &&
                mouse.row <= scrollbarHitbox.endRow
              ) {
                const row = mouse.row - scrollbarHitbox.startRow;
                const inThumb =
                  row >= scrollbarHitbox.thumbStart &&
                  row < scrollbarHitbox.thumbStart + scrollbarHitbox.thumbSize;
                scrollbarDragOffset = inThumb
                  ? row - scrollbarHitbox.thumbStart
                  : Math.floor(scrollbarHitbox.thumbSize / 2);
                dragScrollbarTo(mouse.row);
                return;
              }
            }
            if (motion && scrollbarDragOffset !== null) {
              dragScrollbarTo(mouse.row);
            } else if (button === 64) {
              scrollTo(scrollOffset - 3);
            } else if (button === 65) {
              scrollTo(scrollOffset + 3);
            }
          }
        },
        render(width: number) {
          const inner = Math.max(1, width - 2);
          const escWidth = visibleWidth("[esc]");
          const bodyInner = Math.max(1, inner - 1);
          const terminalHeight = Math.max(1, tui.terminal.rows);
          const availableHeight = Math.max(1, terminalHeight - 4);
          const viewportHeight = Math.min(
            30,
            Math.max(1, Math.floor(terminalHeight * 0.8)),
            availableHeight,
          );
          pageSize = Math.max(1, viewportHeight - 6);
          const wrapped = markdown.render(Math.max(1, bodyInner - 1));
          totalLines = wrapped.length;
          scrollOffset = Math.min(
            scrollOffset,
            Math.max(0, totalLines - pageSize),
          );
          const overlayTop =
            2 + Math.floor((availableHeight - viewportHeight) / 2);
          const overlayLeft = Math.floor(
            (Math.max(1, tui.terminal.columns) - width) / 2,
          );
          escHitbox = escCloseHitbox({
            left: overlayLeft,
            top: overlayTop,
            width,
          });
          const visible = wrapped.slice(scrollOffset, scrollOffset + pageSize);
          const border = (text: string) => theme.fg("border", text);
          const scrollable = totalLines > pageSize;
          const thumbSize = scrollable
            ? Math.max(1, Math.floor((pageSize * pageSize) / totalLines))
            : 0;
          const maxOffset = Math.max(0, totalLines - pageSize);
          const thumbStart =
            scrollable && maxOffset > 0
              ? Math.round((scrollOffset / maxOffset) * (pageSize - thumbSize))
              : 0;
          scrollbarHitbox = scrollable
            ? {
                col: overlayLeft + width - 1,
                startRow: overlayTop + 4,
                endRow: overlayTop + 3 + pageSize,
                thumbStart,
                thumbSize,
                maxOffset,
              }
            : undefined;
          const bodyRows = Array.from({ length: pageSize }, (_, row) => {
            const inThumb = row >= thumbStart && row < thumbStart + thumbSize;
            const scrollbar = scrollable
              ? theme.fg(
                  inThumb ? "accent" : "borderMuted",
                  inThumb ? "█" : "│",
                )
              : " ";
            return `${border("│")}${padLine(` ${visible[row] ?? ""}`, bodyInner)}${scrollbar}${border("│")}`;
          });
          const status = `${totalLines === 0 ? 0 : scrollOffset + 1}-${Math.min(totalLines, scrollOffset + pageSize)} / ${totalLines} lines · ↑↓ PgUp/PgDn Home/End · [esc] close`;
          return [
            border(`╭${"─".repeat(inner)}╮`),
            `${border("│")}${padLine(` ${theme.bold(theme.fg("accent", title))}`, inner - escWidth)}${theme.fg(escHovered ? "text" : "muted", "[esc]")}${border("│")}`,
            `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
            ...bodyRows,
            `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
            `${border("│")}${padLine(theme.fg("dim", ` ${status}`), inner)}${border("│")}`,
            border(`╰${"─".repeat(inner)}╯`),
          ];
        },
      };
    },
    {
      overlayOptions: {
        anchor: "center",
        width: "85%",
        minWidth: 50,
        maxHeight: "80%",
        margin: 2,
      },
    },
  );
}

const previewLabels = [
  ["systemPrompt", "System prompt", "System Prompt"],
  ["memoryFiles", "Memory", "Memory Files"],
  ["skills", "Skills", "Skills"],
  ["tools", "Tools definition", "Tools definition"],
  ["toolResults", "Tool results", "Tool Results"],
  ["contextFiles", "Context", "Context"],
] as const;

export async function showContextInspector(
  ctx: ExtensionCommandContext,
  data: ContextInspectorData,
  overlays: OverlayManager = overlayManager,
): Promise<void> {
  const { parts, used, contextWindow } = data;
  const previews = previewLabels
    .filter(([, label]) => parts.some((part) => part.label === label))
    .map(([key, label, title]) => ({
      key,
      label,
      title,
      content: normalizePreviewText(data.previews[key]),
    }));
  let selectedIndex = 0;
  const isCurrent = overlays.sessionGuard();
  while (isCurrent()) {
    const action = await overlays.open<ContextPreviewKey>(
      ctx,
      (tui, theme, _keybindings, done) => {
        ensureFullscreenMouseMotion(tui);
        let previewHitboxes: Array<Hitbox & { key: ContextPreviewKey }> = [];
        let escHitbox: Hitbox | undefined;
        let escHovered = false;
        let hoveredKey: ContextPreviewKey | undefined;
        return {
          invalidate() {},
          handleInput(input: string) {
            if (
              matchesKey(input, Key.escape) ||
              matchesKey(input, Key.ctrl("c"))
            ) {
              done(undefined);
              return;
            }
            if (
              previews.length > 0 &&
              (matchesKey(input, Key.up) || matchesKey(input, Key.down))
            ) {
              selectedIndex =
                (selectedIndex +
                  (matchesKey(input, Key.up) ? -1 : 1) +
                  previews.length) %
                previews.length;
              tui.requestRender();
              return;
            }
            if (matchesKey(input, Key.enter)) {
              done(previews[selectedIndex]?.key);
              return;
            }
            const mouse = parseSgrMousePacket(input);
            if (!mouse || mouse.final !== "M") {
              return;
            }
            const overEsc = contains(escHitbox, mouse.row, mouse.col);
            const hitbox = previewHitboxes.find((candidate) =>
              contains(candidate, mouse.row, mouse.col),
            );
            if ((mouse.code & 32) !== 0) {
              if (overEsc !== escHovered || hitbox?.key !== hoveredKey) {
                escHovered = overEsc;
                hoveredKey = hitbox?.key;
                tui.requestRender();
              }
              return;
            }
            if (mouseBaseButton(mouse.code) !== 0) {
              return;
            }
            if (overEsc) {
              done(undefined);
            } else if (hitbox) {
              selectedIndex = Math.max(
                0,
                previews.findIndex((preview) => preview.key === hitbox.key),
              );
              done(hitbox.key);
            }
          },
          render(width: number) {
            const inner = Math.max(1, width - 2);
            const percent =
              contextWindow > 0 ? (used / contextWindow) * 100 : 0;
            const title = theme.bold(theme.fg("accent", "Context Usage"));
            const subtitle = `${formatTokens(used)} / ${formatTokens(contextWindow)} tokens (${percent.toFixed(1)}%)`;
            const barWidth = Math.max(1, Math.min(60, inner - 2));
            let remaining = barWidth;
            const segments = parts
              .map((part, index) => {
                const cells =
                  index === parts.length - 1
                    ? remaining
                    : Math.min(
                        remaining,
                        Math.round(
                          (part.tokens / Math.max(1, contextWindow)) * barWidth,
                        ),
                      );
                remaining -= cells;
                return theme.fg(part.color, "█".repeat(Math.max(0, cells)));
              })
              .join("");
            const labelWidth = Math.min(
              24,
              Math.max(...parts.map((part) => part.label.length)),
            );
            const rows = parts.map((part) => {
              const pct =
                contextWindow > 0 ? (part.tokens / contextWindow) * 100 : 0;
              const selected = part.label === previews[selectedIndex]?.label;
              const hovered =
                part.label ===
                previews.find((preview) => preview.key === hoveredKey)?.label;
              const amount = `${formatTokens(part.tokens).padStart(7)}  ${pct.toFixed(1).padStart(5)}%`;
              const row = padLine(
                `${selected ? "› " : "  "}${theme.fg(part.color, "■")} ${part.label.padEnd(labelWidth)} ${amount}`,
                inner,
              );
              return selected
                ? theme.bg("selectedBg", row)
                : hovered
                  ? theme.bg("customMessageBg", row)
                  : row;
            });
            const border = (text: string) => theme.fg("border", text);
            const lines = [
              border(`╭${"─".repeat(inner)}╮`),
              `${border("│")}${padLine(` ${title}  ${theme.fg("muted", subtitle)}`, inner - visibleWidth("[esc]"))}${theme.fg(escHovered ? "text" : "muted", "[esc]")}${border("│")}`,
              `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
              `${border("│")}${padLine(` ${segments}`, inner)}${border("│")}`,
              `${border("│")}${" ".repeat(inner)}${border("│")}`,
              ...rows.map((row) => `${border("│")}${row}${border("│")}`),
              `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
              `${border("│")}${padLine(theme.fg("dim", " ↑↓ select · Click / Enter to preview · [esc] close"), inner)}${border("│")}`,
              border(`╰${"─".repeat(inner)}╯`),
            ];
            const height = Math.max(1, tui.terminal.rows);
            const visibleHeight = Math.min(
              lines.length,
              Math.max(1, Math.floor(height * 0.9)),
              Math.max(1, height - 2),
            );
            const top =
              1 + Math.floor((Math.max(1, height - 2) - visibleHeight) / 2);
            const left = Math.floor(
              (Math.max(1, tui.terminal.columns) - width) / 2,
            );
            escHitbox = escCloseHitbox({ left, top, width });
            previewHitboxes = previews.flatMap((preview) => {
              const index = parts.findIndex(
                (part) => part.label === preview.label,
              );
              const line = 5 + index;
              return index >= 0 && line < visibleHeight
                ? [
                    {
                      key: preview.key,
                      row: top + line + 1,
                      startCol: left + 1,
                      endCol: left + width,
                    },
                  ]
                : [];
            });
            return lines;
          },
        };
      },
      {
        overlayOptions: {
          anchor: "center",
          width: 64,
          minWidth: 44,
          maxHeight: "90%",
          margin: 1,
        },
      },
    );
    if (!action) {
      return;
    }
    const preview = previews.find((entry) => entry.key === action);
    if (preview) {
      await showTextPreview(ctx, preview.title, preview.content, overlays);
    }
  }
}
