# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Reduced the Editor to the single `minimalist` style with an `on`/`off` switch: `off` restores Pi's native editor, and the retired `opencode` style is removed (`enabled` merges into `style`, legacy values migrate automatically).
- Added `/oneui` panel settings for the Editor component: style (`on`/`off`), color source (`theme`/`terminal`), and border color mode (`static`/`adaptive`), each with an inline description.
- In `off` mode, an explicitly configured `colors.editorBorder` is applied to the native editor border through `colorSource` (theme tokens or fixed terminal colors); without it the native effort/theme coloring is preserved.

### Performance

- Cached `ToolExecutionComponent` render widgets across expand/collapse toggles: repeated Ctrl+O toggles and identical result updates now skip the full native rebuild, cutting batch expansion of many tools (e.g. 30 × 1000-line outputs) from ~130ms to under 0.2ms while keeping expanded and collapsed render slots independent.

### Migration

- `components.editor.enabled: false` becomes `components.editor.style: "off"`; `style: "opencode"`/`"minimalist"` become `"on"`. The `styles.opencode` block and `opencode-copy-friendly`/`accent-rail` selections are ignored.

### Fixed

- Toggling the Editor style between `on`/`off` no longer replaces the editor factory: the existing instance (and Pi's overlay focus target) stays valid, so the `/oneui` panel restores keyboard focus to the input editor after closing.
- Unconfigured `cwd`, model-label, and static border colors now prefer the theme's `cwd`/`editorModel`/`editorBorder` tokens (which may reference `vars` variables or hex), falling back to Pi's native defaults when the theme does not define them.

## [0.4.0] - 2026-09-03

### Changed

- Simplified Editor styling to the `opencode` and `minimalist` options; removed Minimalist context-usage metadata in favor of Footer's more complete context configuration.
- Added response-local live output throughput to the WorkingLine token segment after a bounded sampling window.

### Removed

- Removed the `opencode-copy-friendly` and `accent-rail` Editor styles, including Accent Rail layout patching and style-specific settings.
- Removed the inherited upstream image from pi-one-ui's package-gallery metadata.

### Migration

- Existing `opencode-copy-friendly` or `accent-rail` selections fall back to `opencode`; remove obsolete nested settings for those styles when convenient.
- Configure context percentage, token totals, thresholds, and gauges through Footer instead of Minimalist Editor settings.

## [0.3.1] - 2026-08-31

### Changed

- Unified the test suite on Vitest and reorganized tests into domain-oriented directories.

### Fixed

- Keep `/oneui` open and focused during in-place Editor changes, restore effective values after persistence failures, and position the panel closer to the top.
- Reduced global tool expansion latency and preserved pi-subagents' dedicated live progress renderer instead of wrapping and grouping it as a generic tool.

## [0.3.0] - 2026-08-30

### Added

- Added a maintained English README with bidirectional language navigation.

### Changed

- Use `~/.pi/agent/pi-one-ui.json` as the only configuration source.
- Persist settings with the canonical v1 `components` and `renderer` structure.

### Removed

- Removed automatic loading and migration of `pi-mine-ui.json`, `zentui.json`, and `claude-code-style.json`.
- Removed legacy flat configuration fields, old style identifiers, and WorkingLine aliases.
- Removed the legacy `enableWorkingMessage` renderer option.

### Migration

- Before upgrading, recreate or translate supported settings into the canonical `components` and `renderer` structure in `~/.pi/agent/pi-one-ui.json`.
- Use `/oneui` to write settings in the canonical format, then run `/reload`.

## [0.2.2] - 2026-08-29

### Fixed

- Reduced rendering lag when expanding settled tool groups by reusing cached child output.

[Unreleased]: https://github.com/kerolt/pi-one-ui/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kerolt/pi-one-ui/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kerolt/pi-one-ui/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kerolt/pi-one-ui/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kerolt/pi-one-ui/compare/v0.2.1...v0.2.2
