# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Rename the `/oneui` settings section from `Context` to `Transcript`. Names that refer to the model context window are unchanged: the `/context` command, the Context Inspector, the Footer `context` segment with `contextStyle` and `contextThresholds`, and the `context*` color keys. No configuration key, command, or stored value changes.

### Fixed

- Show the complete command on an expanded tool card while the tool call is still running. Ctrl+O and mouse expansion now wrap the full input against the viewport width instead of clipping it to `renderer.toolInputNameLength`, so long bash commands stay readable during execution; embedded line breaks in multi-line commands are preserved. Collapsed cards and settled cards keep the truncated title line, and settled cards still list the full input in the expanded `Input` section.

## [0.9.0] - 2026-10-02

### Changed

- Restyle Pi's built-in fullscreen end-of-transcript indicator with the pi-one-ui button look: `[ ↓ Back to bottom · <shortcut> ]` in accent color, switching to the text color while hovered. The shortcut text follows the actual `tui.altScreen.bottom` binding. Display conditions, centering, click-to-scroll, and the keyboard shortcut stay on Pi's native mechanism.

### Removed

- Remove `renderer.scrollStepLines`. Wheel stepping is controlled by Pi's own `fullscreenWheelScrollLines` setting; the removed wiring assigned a `tui.wheelScrollLines` property that Pi's TUI does not expose, so the configured value never reached the wheel accelerator. A `scrollStepLines` key left in an existing config file is ignored and preserved on save.
- Remove the fullscreen "Back to bottom" button and its `Ctrl+End` binding. The button duplicated Pi's built-in end-of-transcript indicator (present since Pi 0.99); use the official `End` shortcut and indicator instead.

### Migration

- Wheel stepping is now controlled by Pi's own `fullscreenWheelScrollLines` setting in `~/.pi/agent/settings.json` (an integer such as `3`, or `"auto"`). A leftover `renderer.scrollStepLines` key in the pi-one-ui config is ignored and preserved on save.
- The fullscreen "Back to bottom" button and its `Ctrl+End` binding are gone. Use the official `End` shortcut and the restyled end-of-transcript indicator instead.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.9.0`. Fully exit and restart Pi after updating the package.

### Release verification

- Release source: [`bd915d1`](https://github.com/kerolt/pi-one-ui/commit/bd915d1376486a2aa6c21626f645893e99e29791). [CI](https://github.com/kerolt/pi-one-ui/actions/runs/36949089996) and [Publish](https://github.com/kerolt/pi-one-ui/actions/runs/36949089612) completed successfully; local `npm run verify` passed 1,190 tests across 69 files, and `npm run pack:check` confirmed 124 package files.
- npm `latest` resolves to `0.9.0`, published `2026-10-02T01:05:39.420Z` with `gitHead` `bd915d1376486a2aa6c21626f645893e99e29791`, package SHA-1 `c354b2f6eafb4e2fe00c915ec43925d0304918dc`, integrity `sha512-uipQsMexnSRrB/7fNPNotgsjsHuHMRwLKtgRrp9EmmfoPaYJhtkrMZ+CPkBiXlHqt63sDfHVgcSvp/5rvA5GvQ==`, and a published provenance statement (SLSA v1).
- Real Pi fullscreen TUI probes were not run for this release (no TTY), so terminal, theme, and reload combinations still require manual verification.

## [0.8.0] - 2026-09-30

### Changed

- Require Pi `>= 0.99.0`: the Editor reads a theme's `cwd`, `editorModel`, and `editorBorder` keys from the palette shape Pi exposes since 0.99, and development, tests, and type checking target that version.
- Simplify color configuration: `colors.*` now accepts Pi official theme tokens defined in a theme file's `colors` field and explicit terminal colors; bare terminal color names are rejected, so write `fg:purple`, `fg:red`, a hex value, or a 256-color index for fixed terminal colors. Pi-one-ui custom keys such as `cwd`, `editorModel`, and `editorBorder` are documented as extensions that the shipped themes define. The reference is updated in both Chinese and English README.
- Rename the remaining persisted `zentui` values: `components.selectorBorders.style` is now `one-ui`, extension status `colorModes` are `themed` / `original`, and the working-line turn summary entry type is `one-ui-turn-summary`.

### Fixed

- Read Editor theme tokens from the palette field exposed by the running Pi version. Pi 0.99 renamed the theme palette map from `fgColors` to `fgAnsi` and added a resolved `colors` record, so the Editor model label, cwd label, and static border now pick up a theme's `editorModel` / `cwd` / `editorBorder` colors instead of falling back to `syntaxKeyword` / `syntaxFunction` / `borderMuted`.

### Migration

- Install Pi `>= 0.99.0` before updating this package. Earlier Pi releases keep working only through the previous package version.
- Replace bare terminal color names in `colors.*` with an explicit form: `purple` becomes `fg:purple`, `red` becomes `fg:red`, and fixed colors can also use hex or a 256-color index. Values that no longer validate are dropped at load and fall back to the built-in default, and the file itself is not rewritten.
- No manual edit is required for the renamed `zentui` values. The next configuration save rewrites `selectorBorders.style` and extension status color modes to the new names, and turn summaries written by older versions continue to render from history.
- After updating the package, fully exit and restart Pi instead of running `/reload`: the cross-reload patch coordination keys were renamed, so an in-place reload would leave the previous instance's marks unrecognized until the process restarts.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.8.0`.

### Release verification

- Release source: [`e178ac3`](https://github.com/kerolt/pi-one-ui/commit/e178ac3cdef113ea3991996ea711e5be859aef2b). [CI](https://github.com/kerolt/pi-one-ui/actions/runs/36699814167) and [Publish](https://github.com/kerolt/pi-one-ui/actions/runs/36699814519) completed successfully; local and CI `npm run verify` passed 1,190 tests across 70 files, and `npm run pack:check` confirmed 124 package files.
- npm `latest` resolves to `0.8.0`, published `2026-09-30T10:04:37.491Z` with `gitHead` `e178ac3cdef113ea3991996ea711e5be859aef2b`, package SHA-1 `cf0b057b31feb86fd5e6b8a9de968977b660b526`, integrity `sha512-q39+leDnJf2iSF09OUDbPrRVfrLW1Q+olLIRuhB0uU/6UISnKzHXUyVgzC6mFd2D8spzzDQSPS4LtkxnSoMttw==`, and a published provenance statement (Sigstore log index [3016341299](https://search.sigstore.dev/?logIndex=3016341299)).
- Real Pi regular/fullscreen TUI probes were not run for this release, so terminal, theme, reload, and third-party Editor combinations still require manual verification.

## [0.7.2] - 2026-09-28

### Changed

- The Editor completion dropdown now paints the selected row with the editor frame color, so the selection follows the same static/adaptive thinking-level chain as the frame border while unselected rows keep Pi's native styling.

### Fixed

- Keep the pending tool loading animation alive during long-running commands: the updateDisplay render cache now rebuilds pending tool rows so each animation tick re-enters the renderer, preventing the spinner from freezing while a command is still executing.

### Migration

- No configuration migration is required. Existing canonical v1 files and command names remain supported.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.7.2`. Fully exit and restart Pi after updating the package.

### Release verification

- Release source: [`67ebac4`](https://github.com/kerolt/pi-one-ui/commit/67ebac41e1aeaaab51e11257de17134fb40ab63e). [CI](https://github.com/kerolt/pi-one-ui/actions/runs/36365224155) and [Publish](https://github.com/kerolt/pi-one-ui/actions/runs/36365227223) completed successfully; local and CI `npm run verify` passed 1,185 tests across 70 files, and `npm run pack:check` confirmed 124 package files.
- Real Pi regular/fullscreen TUI probes passed, covering settings, Context Inspector, Editor input and focus, presets, reload, session tree, compaction, session replacement, input listeners, and third-party Editor ownership. User-specific terminal, theme, and extension combinations still require manual verification.
- At publication, npm `latest` resolved to `0.7.2` with the matching release `gitHead` and package SHA-1 `730dc4a0e4713e26cef4ea3b0c83c122f8b83bc6`; the downloaded package file list and contents matched the release commit. The [provenance statement](https://registry.npmjs.org/-/npm/v1/attestations/pi-one-ui@0.7.2) was published at [Sigstore log index 2981051472](https://search.sigstore.dev/?logIndex=2981051472).

## [0.7.1] - 2026-09-21

### Changed

- Centralize component composition, settings application, and session lifecycle management in app, with settings and Context Inspector views owned by Overlay Layout.
- Apply presets with one canonical configuration write and update every affected Layout. Component settings, including Header visibility, apply through their owning Layout; Feature registration switches still require `/reload`.
- Report corrupt or unreadable configuration files during loading, and distinguish a failed save from a saved configuration that could not be applied to the UI.
- Coalesce shared Layout redraw requests while preserving forced redraws and session ownership.

### Fixed

- Close managed overlays and input listeners during session replacement, and prevent Context Inspector from reopening a preview's parent window in an ended session.

### Migration

- No configuration migration is required. Existing canonical v1 files and command names remain supported.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.7.1`. Fully exit and restart Pi after updating the package.

### Release verification

- Release source: [`e4451a2`](https://github.com/kerolt/pi-one-ui/commit/e4451a244838550f0914469bd8ff5ddbaebc1f8f). [CI](https://github.com/kerolt/pi-one-ui/actions/runs/35567977181) and [Publish](https://github.com/kerolt/pi-one-ui/actions/runs/35567977360) completed successfully; local and CI `npm run verify` passed 1,176 tests across 69 files, and `npm run pack:check` confirmed 124 package files.
- Real Pi regular/fullscreen TUI probes passed, covering settings, Context Inspector, Editor input and focus, presets, reload, session tree, compaction, session replacement, input listeners, and third-party Editor ownership. User-specific terminal, theme, and extension combinations still require manual verification.
- At publication, npm `latest` resolved to `0.7.1` with the matching release `gitHead` and package SHA-1 `0252f3b21190f56170a96ff8c3a2a1e8df74874f`. The [provenance statement](https://registry.npmjs.org/-/npm/v1/attestations/pi-one-ui@0.7.1) was published at [Sigstore log index 2905054424](https://search.sigstore.dev/?logIndex=2905054424).

## [0.7.0] - 2026-09-13

### Added

- Added `components.editor.styles.minimalist.showCwd` to independently show or hide the Editor's working-directory label, including the `/oneui` preview. It defaults to `true`, so existing configurations need no migration. Setting it to `false` preserves `pathDisplay` and leaves Git metadata and Footer directory settings unchanged; edit the JSON configuration and run `/reload` to apply it.

### Fixed

- Restore keyboard focus to the visible Editor after `/oneui` replaces an editor while changing its settings, including native-to-custom transitions, third-party wrappers, and replacement rollback. Closing the panel no longer sends subsequent typing to the detached previous editor in regular or fullscreen mode; existing overlays and later editor owners retain focus.

### Migration

- No configuration migration is required. Existing configurations keep showing the Editor directory; set `components.editor.styles.minimalist.showCwd` to `false` only if you want to hide it. Footer directory settings remain independent.
- For an unpinned npm installation, run `pi update npm:pi-one-ui`; for an existing version pin, run `pi install npm:pi-one-ui@0.7.0`. Fully exit and restart Pi after updating the package. Subsequent JSON configuration edits can be applied with `/reload`.

### Release verification

- Release source: [`10ac3de`](https://github.com/kerolt/pi-one-ui/commit/10ac3dea3f0ac804fef94cbeea937c6f1ae0d347). [CI](https://github.com/kerolt/pi-one-ui/actions/runs/34740987283) and [Publish](https://github.com/kerolt/pi-one-ui/actions/runs/34741047850) completed successfully; `npm run verify` passed 1,165 tests and `npm run pack:check` confirmed 121 package files.
- At publication, npm `latest` resolved to `0.7.0` with the matching release `gitHead` and [provenance metadata](https://registry.npmjs.org/-/npm/v1/attestations/pi-one-ui@0.7.0). The provenance statement was published at [Sigstore log index 2814335389](https://search.sigstore.dev/?logIndex=2814335389).

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

[Unreleased]: https://github.com/kerolt/pi-one-ui/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/kerolt/pi-one-ui/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kerolt/pi-one-ui/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/kerolt/pi-one-ui/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/kerolt/pi-one-ui/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/kerolt/pi-one-ui/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kerolt/pi-one-ui/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kerolt/pi-one-ui/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/kerolt/pi-one-ui/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kerolt/pi-one-ui/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kerolt/pi-one-ui/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kerolt/pi-one-ui/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kerolt/pi-one-ui/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kerolt/pi-one-ui/compare/v0.2.1...v0.2.2
