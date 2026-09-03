# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Simplified Editor styling to the `opencode` and `minimalist` options; removed Minimalist context-usage metadata in favor of Footer's more complete context configuration.
- Added response-local live output throughput to the WorkingLine token segment after a bounded sampling window.

### Removed

- Removed the `opencode-copy-friendly` and `accent-rail` Editor styles, including Accent Rail layout patching and style-specific settings.

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

[Unreleased]: https://github.com/kerolt/pi-one-ui/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/kerolt/pi-one-ui/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kerolt/pi-one-ui/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kerolt/pi-one-ui/compare/v0.2.1...v0.2.2
