# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-09-13

### Added

- Added `components.editor.styles.minimalist.showCwd` to independently show or hide the Editor's working-directory label, including the `/oneui` preview. It defaults to `true`, so existing configurations need no migration. Setting it to `false` preserves `pathDisplay` and leaves Git metadata and Footer directory settings unchanged; edit the JSON configuration and run `/reload` to apply it.

### Fixed

- Restore keyboard focus to the visible Editor after `/oneui` replaces an editor while changing its settings, including native-to-custom transitions, third-party wrappers, and replacement rollback. Closing the panel no longer sends subsequent typing to the detached previous editor in regular or fullscreen mode; existing overlays and later editor owners retain focus.

### Migration

- No configuration migration is required. Existing configurations keep showing the Editor directory; set `components.editor.styles.minimalist.showCwd` to `false` only if you want to hide it. Footer directory settings remain independent.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.7.0`. Fully exit and restart Pi after updating the package. Subsequent JSON configuration edits can be applied with `/reload`.

## [0.6.1] - 2026-09-06

### Added

- Built-in `/effort` command for selecting the thinking effort level (interactive picker, argument autocomplete, and model-clamping feedback), gated by `renderer.enableEffortCommand` (default `true`) and toggleable from the `/oneui` Features section. Replaces the need for a standalone local effort extension — remove any self-installed `/effort` extension to avoid duplicate command registration.
- The `/oneui` settings panel overlay placement is now configurable via the optional top-level `panel` key in `pi-one-ui.json` (`anchor`, `width`, `maxHeight`, `margin`), replacing the previously hardcoded `top-center`/`85%`/`90%` layout. Invalid values fall back to the defaults, and edits apply the next time the panel opens.

## [0.6.0] - 2026-09-05

### Removed

- Removed the `colorSource` (`theme`/`terminal`) concept from the Editor, user messages, WorkingLine, selector borders, and Footer. Colors are now always rendered with theme semantics: configured `colors.*` values resolve as theme tokens (ANSI names such as `red` map to semantic tokens like `error`), while hex, 256-color indexes, and `fg:`/`bg:` prefixes still render fixed terminal colors.
- Removed the terminal-only adaptive border ladder and the Color source setting from `/oneui`.

### Changed

- Adaptive Editor borders now prefer the per-level `colors.editorThinking*` configuration, then Pi's native effort coloring, then the default border; thinking labels keep following the border in adaptive mode.

### Migration

- Existing `colorSource` fields in `~/.pi/agent/pi-one-ui.json` are ignored at load time and not rewritten. Configurations that relied on `terminal` fixed colors should move those `colors.*` values to hex, a 256-color index, or an `fg:`/`bg:` prefix; ANSI color names now resolve to theme semantic tokens. See [docs/editor-colors.md](./docs/editor-colors.md) for the full color field reference.

## [0.5.1] - 2026-09-05

### Changed

- Refined the `cc-dark` theme: `thinkingLow` uses cyan, `thinkingXhigh` yellow, and `thinkingMax` orange for a clearer effort-level hierarchy; `cwd` and `editorModel` labels switch from blue to the muted token for calmer status text.

## [0.5.0] - 2026-09-05

### Changed

- Reduced the Editor to the single `minimalist` style with an `on`/`off` switch: `off` restores Pi's native editor, and the retired `opencode` style is removed (`enabled` merges into `style`, legacy values migrate automatically).
- Added `/oneui` panel settings for the Editor component: style (`on`/`off`), color source (`theme`/`terminal`), and border color mode (`static`/`adaptive`), each with an inline description.
- In `off` mode, an explicitly configured `colors.editorBorder` is applied to the native editor border through `colorSource` (theme tokens or fixed terminal colors); without it the native effort/theme coloring is preserved.

### Performance

- Cached `ToolExecutionComponent` render widgets across expand/collapse toggles: repeated Ctrl+O toggles and identical result updates now skip the full native rebuild, cutting batch expansion of many tools (e.g. 30 × 1000-line outputs) from ~130ms to under 0.2ms while keeping expanded and collapsed render slots independent.

### Removed

- Removed the `opencode` Editor style along with its polished renderer, completion-menu module, and `styles.opencode` configuration; the `enabled` field is gone.

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

[Unreleased]: https://github.com/kerolt/pi-one-ui/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/kerolt/pi-one-ui/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kerolt/pi-one-ui/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kerolt/pi-one-ui/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/kerolt/pi-one-ui/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kerolt/pi-one-ui/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kerolt/pi-one-ui/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kerolt/pi-one-ui/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kerolt/pi-one-ui/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kerolt/pi-one-ui/compare/v0.2.1...v0.2.2
