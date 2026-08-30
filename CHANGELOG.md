# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kerolt/pi-one-ui/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kerolt/pi-one-ui/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kerolt/pi-one-ui/compare/v0.2.1...v0.2.2
