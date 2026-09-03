# pi-one-ui

[![npm version](https://img.shields.io/npm/v/pi-one-ui?style=flat-square)](https://www.npmjs.com/package/pi-one-ui)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/kerolt/pi-one-ui?style=flat-square)](./LICENSE)

[简体中文](./README.md) | English

`pi-one-ui` is a unified TUI extension package for [Pi](https://pi.dev). It started as an effort to build a simple and polished terminal interface by combining, at the source level:

- the terminal shell capabilities of [pi-zentui](https://github.com/lmilojevicc/pi-zentui)
- the conversation rendering and productivity features of [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions)

The result is a single installable and configurable Pi package that continues to evolve through module refactoring, tighter ownership, and independent improvements.

## Features

### Unified interface layout

`pi-one-ui` organizes the Pi interface into the following layouts:

```text
Header → Context → WorkingLine → Editor → Footer
```

- **Header**: startup information, logo, and shortcut hints.
- **Context**: the conversation area, including user messages, assistant messages, thinking, tools, diffs, Markdown, and summaries.
- **WorkingLine**: working state, spinner, token/thought/elapsed information, live output rate, and turn summaries.
- **Editor**: input editor, completion, metadata, and the Opencode and Minimalist styles.
- **Footer**: current directory, Git, runtime, token, cost, and extension status information.
- **Overlay**: temporary interfaces such as the settings panel and Context Inspector, managed by a shared OverlayManager.

### Built-in functionality

| Feature | Description | Entry point |
| --- | --- | --- |
| Unified settings panel | Organizes settings by Header, Context, WorkingLine, Editor, Footer, and Features | `/oneui` |
| Context Inspector | Shows context usage and previews the system prompt, memory, skills, tools, and messages | `/context` |
| Session reference | Searches previous Pi sessions or SubAgents and injects their useful context | `@` completion |
| Subagent autocomplete | Completes SubAgent names and delegation hints | `@` completion |
| Tool / Diff renderer | Provides unified rendering for tool calls, results, collapsed content, and Edit/Write diffs | Automatic |
| Subagent live renderer | Preserves pi-subagents' dedicated progress cards and keeps them out of generic tool groups | Automatic |
| Markdown enhancement | Adds Mermaid, admonitions, URL linking, and related rendering improvements | Automatic |
| Built-in themes | Provides CC Dark and CC Light themes | `/theme` |
| Compatibility aliases | Optionally provides common command aliases | `/clear`, `/exit` |

## Quick start

### Requirements

- Node.js `>=22.19.0`
- Pi and related runtime packages `>=0.84.0`

### Install from npm

```bash
pi install npm:pi-one-ui
```

### Install from GitHub

```bash
pi install git:github.com/kerolt/pi-one-ui
```

After installation, reload extensions in Pi:

```text
/reload
```

Then open the unified settings panel:

```text
/oneui
```

## Configuration

The configuration file is located at:

```text
~/.pi/agent/pi-one-ui.json
```

Using the `/oneui` settings panel is recommended. The panel uses a top-centered layout, stays open while Editor enablement or style changes are applied, restores focus after Editor replacement, and restores the effective list value when persistence fails. The current configuration uses the v1 structure, for example:

```json
{
  "version": 1,
  "components": {
    "editor": {
      "enabled": true,
      "style": "opencode"
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    },
    "workingLine": {
      "enabled": true
    },
    "footer": {
      "style": "starship"
    }
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto"
  }
}
```

The Editor now supports only the `opencode` and `minimalist` styles. `minimalist` no longer duplicates context-usage information; context percentage, token totals, thresholds, gauges, and related presentation are configured through Footer. Existing configurations that select the removed `opencode-copy-friendly` or `accent-rail` styles safely fall back to the default `opencode`, and their old nested style settings are ignored.

The WorkingLine token segment appends live output throughput, such as `⚡12 tok/s`, after a model response has run for at least 500ms. Throughput is calculated independently for the current response and resets on the next `turn_start`; disabling the token segment hides it as well.

Available layout and renderer options may change between versions, so prefer configuring them through `/oneui`.

### Canonical configuration policy

`pi-one-ui` reads and writes only:

```text
~/.pi/agent/pi-one-ui.json
```

It does not automatically read, merge, or migrate historical configuration files, and it does not parse legacy flat fields or old style identifiers. If the file does not exist, runtime defaults are used in memory. The file is created only after the first settings change through `/oneui`. All persisted changes use the current v1 `components` and `renderer` structure.

## Upstream origins and project evolution

`pi-one-ui` originally combined source from the following open-source projects. Many thanks to their maintainers and contributors for providing the initial foundation.

| Upstream project | Capabilities incorporated into `pi-one-ui` | Reference baseline |
| --- | --- | --- |
| [pi-zentui](https://github.com/lmilojevicc/pi-zentui) | Starship-style Footer, Opencode-style Editor, layouts, and shell capabilities | v0.21.0, commit `5341b38` |
| [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) | Claude Code-style Context renderer, Tool/Diff rendering, Context Inspector, and references | v0.8.67, commit `dba37e5` |

Production code lives in `extensions/`. The project has since unified its entry point, configuration storage, lifecycle, layout ownership, overlays, and input routing. The current implementation is no longer equivalent to either upstream project and does not automatically track upstream changes.

The upstream projects provided the original foundation. Continued development focuses on turning these capabilities into one coherent product with clear seams and sustainable maintenance.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed module boundaries, event flow, and ownership conventions.

## Local development

### Clone the repository

```bash
git clone https://github.com/kerolt/pi-one-ui.git
cd pi-one-ui
npm install
```

Node.js `>=22.19.0` is required. If multiple Node.js versions are installed, switch to a compatible version first.

### Run in development mode

Start Pi directly with the current source:

```bash
npm run pi:dev
```

This is equivalent to:

```bash
pi --no-extensions -e ./extensions/index.ts
```

You can also install the current package as a local link:

```bash
npm run pi:install-local
```

After changing the source, run the following command in Pi:

```text
/reload
```

### Development commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run format` | Format source, tests, and configuration files |
| `npm run check` | Check formatting and import organization |
| `npm run fix` | Fix formatting and organize imports |
| `npm run typecheck` | Run TypeScript type checking |
| `npm test` | Run all tests with Vitest |
| `npm run pack:check` | Preview the npm package contents |
| `npm run verify` | Run Biome checks, type checking, and all tests |

Before submitting changes, run at least:

```bash
npm run verify
npm run pack:check
```

### Test organization

All tests run through Vitest and are organized into domain directories:

- `tests/config/`: canonical configuration, storage, and compatibility boundaries.
- `tests/context/`: Context content, tools, diffs, thinking, and mouse interaction.
- `tests/header/`, `tests/working-line/`, `tests/editor/`, and `tests/footer/`: Layout behavior and lifecycle coverage.
- `tests/runtime/`, `tests/overlay/`, and `tests/integration/`: runtime infrastructure, overlays, and the composed entry point.
- `tests/services/`: Git, runtime, project, session, and telemetry data.
- `tests/shell/`: remaining layout lifecycle glue and standalone compatibility.
- `tests/support/` and `tests/fixtures/`: shared test helpers and fixtures.

Changes involving the TUI lifecycle should specifically cover reloads, session tree rebuilds, compaction, regular/fullscreen TUI modes, headless mode, overlays, and third-party patch ownership.

## Releases

User-visible changes and upgrade notes are maintained in [CHANGELOG.md](./CHANGELOG.md). Changes under development belong in `Unreleased` and are moved to a versioned section only during a release.

The project uses GitHub Actions for continuous integration and npm publishing:

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs complete verification for pull requests and pushes to `main`.
- [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) publishes to npm when a `v*.*.*` tag is pushed.

To publish a new version:

```bash
# Ensure main is checked out and up to date
git switch main
git pull --ff-only origin main

# Run release checks
npm ci
npm run verify
npm run pack:check

# Select the SemVer increment
npm version patch   # Backward-compatible fixes, for example 0.2.1 -> 0.2.2
# npm version minor # New features or breaking changes while the project is on 0.x
# npm version major # Breaking changes after a stable 1.x release

# Push the release commit and tag
git push origin main --follow-tags
```

After the tag is pushed, the publish workflow verifies that the tag matches `package.json`, runs the full verification suite again, and publishes the public package through npm Trusted Publishing with provenance. Published npm versions cannot be overwritten, so never reuse an existing version or tag.

## Contributing

GitHub issues and contributions are welcome. When submitting changes:

1. Keep each commit focused on one primary purpose.
2. Use a concise Conventional Commit message, for example `fix: prevent settings panel freeze after editor toggle`.
3. Add or update tests for behavioral changes.
4. Run `npm run verify` and `npm run pack:check` before submitting.

## License

This project is released under the [MIT License](./LICENSE).
