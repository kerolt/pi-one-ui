# pi-one-ui

[![npm version](https://img.shields.io/npm/v/pi-one-ui?style=flat-square)](https://www.npmjs.com/package/pi-one-ui)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/kerolt/pi-one-ui?style=flat-square)](./LICENSE)

[简体中文](./README.md) | English

`pi-one-ui` is a unified TUI extension package for [Pi](https://pi.dev), designed to deliver a clean, beautiful, and efficient terminal experience. It originated as a source-level combination of:

- the terminal shell and layout capabilities of [pi-zentui](https://github.com/lmilojevicc/pi-zentui)
- the conversation rendering and productivity features of [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions)

The result is a single installable and configurable Pi package that continues to evolve through architectural refactoring, strict boundary ownership, and ongoing optimization.

## Features

### Unified interface layout

`pi-one-ui` organizes the Pi interface into a clean hierarchy:

```text
Header → Context → WorkingLine → Editor → Footer
```

- **Header**: Startup information, logo, and shortcut hints.
- **Context**: Conversation content area, including user messages, assistant messages, thinking blocks, tool calls, diffs, Markdown, and turn summaries.
- **WorkingLine**: Working state indicator, spinner, token/thought/elapsed statistics, live output throughput, and turn summaries.
- **Editor**: Input editor, completion menu, metadata display, and the Minimalist style (with effortless toggle to Pi native).
- **Footer**: Current directory, Git status, runtime info, token/cost tracking, and extension statuses.
- **Overlay**: Temporary views such as the settings panel and Context Inspector, managed centrally by OverlayManager.

### Built-in functionality

| Feature                | Description                                                                                 | Entry point       |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------- |
| Unified settings panel | Centrally manages settings for Header, Context, WorkingLine, Editor, Footer, and Features    | `/oneui`          |
| Context Inspector      | Shows context usage and previews system prompt, memory, skills, tools, and message contents | `/context`        |
| Session reference      | Searches previous Pi sessions or subagents and injects their relevant context               | `@` completion    |
| Subagent autocomplete  | Provides subagent name completion and delegation hints                                      | `@` completion    |
| Tool / Diff renderer   | Unified rendering for tool executions, results, collapsible blocks, and Edit/Write diffs   | Automatic         |
| Subagent live renderer | Preserves subagents' dedicated progress cards without grouping them into generic tool calls | Automatic         |
| Markdown enhancement   | Adds Mermaid diagrams, admonitions, clickable URL linking, and rendering improvements       | Automatic         |
| Built-in themes        | Includes CC Dark and CC Light themes                                                        | `/theme`          |
| Compatibility aliases  | Optionally provides common command aliases                                                  | `/clear`, `/exit` |
| Effort command         | Interactively or directly switch the active model's thinking effort level                   | `/effort`         |

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

### Configuration methods

`pi-one-ui` uses a single canonical v1 configuration file:

```text
~/.pi/agent/pi-one-ui.json
```

You can configure the extension in two ways:

1. **Interactive settings panel (recommended)**: Run `/oneui` in Pi to adjust common component toggles, styles, and border modes via a visual menu. Changes take effect immediately and are persisted automatically.
2. **Direct JSON editing**: Advanced users can edit the JSON configuration file directly for finer-grained control. After saving edits, run `/reload` in Pi to apply changes. When the file does not exist, safe runtime defaults are used in memory.

### Basic configuration example

Below is a typical v1 configuration structure:

```json
{
  "version": 1,
  "components": {
    "editor": {
      "style": "on",
      "borderColorMode": "static"
    },
    "footer": {
      "style": "starship"
    },
    "workingLine": {
      "enabled": true
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    }
  },
  "renderer": {
    "mode": "on",
    "diffViewMode": "auto"
  },
  "panel": {
    "anchor": "top-center",
    "width": "85%",
    "maxHeight": "90%",
    "margin": { "top": 6, "right": 1, "bottom": 1, "left": 1 }
  }
}
```

### Advanced configuration & documentation guide

To keep the configuration section clean and focused, in-depth options, template variables, and color references are organized in dedicated documentation:

- **Component options & layout customization**: see [Editor & Footer Configuration Guide (docs/configuration.md)](./docs/configuration.md)
  - **Editor**: Configure `style` (`on` for Minimalist decoration / `off` for Pi native), `borderColorMode` (`static` or `adaptive` to thinking effort), `modelLabel`, and granular Minimalist displays (directory visibility and format, session name, timer, cost, Git status, etc.). `components.editor.styles.minimalist.showCwd` (Unreleased, default `true`) can hide the directory independently of the Footer; `pathDisplay` continues to select its format.
  - **Footer**: Starship-style layout powered by format templates (`$cwd`, `$git_branch`, `$tokens`, `$cost`, etc.), individual `segments` toggles, customizable separators, and context-usage indicators (gauge or text).
  - **WorkingLine**: Built-in live output throughput tracking (appends e.g. `⚡12 tok/s` when a model response runs for at least 500ms, reset per turn).
- **Settings panel (`/oneui`) customization**: the optional top-level `panel` section controls the overlay placement and size (all fields default to the values shown in the example above).
  - `anchor`: one of `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center`, `bottom-center`, `left-center`, `right-center`.
  - `width` / `maxHeight`: absolute column/row counts, or percentage strings like `"85%"`.
  - `margin`: distance from the terminal edges — either a single number for all sides, or an object with per-edge `top`/`right`/`bottom`/`left` values.
  - Saved changes apply the next time `/oneui` opens; no `/reload` needed.
- **Color system & theme customization**: see [Editor Colors Reference (docs/editor-colors.md)](./docs/editor-colors.md)
  - All colors resolve through unified theme semantics. Configured `colors.*` values resolve as theme tokens (adapting automatically across themes), while ANSI names map to semantic tokens (e.g. `red` to `error`). Fixed terminal colors can be specified using hex codes, 256-color indexes, or `fg:`/`bg:` prefixes.
  - Full support for adaptive thinking-effort border colors (from Low to Max) and labels.
- **Migration from legacy versions**: Field cleanups from 0.5.x/0.6.0 (such as merging `opencode` into `minimalist`, or removing `colorSource`) are covered in [docs/configuration.md: Changes and Migration](./docs/configuration.md#6-变更与迁移).

## Upstream origins and project evolution

`pi-one-ui` was originally built upon source code from two open-source projects. We express our sincere appreciation to both upstream projects and their contributors:

| Upstream project                                                | Capabilities incorporated into `pi-one-ui`                                                 | Reference baseline        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| [pi-zentui](https://github.com/lmilojevicc/pi-zentui)           | Starship-style Footer, Editor layouts, and shell interaction capabilities                  | v0.21.0, commit `5341b38` |
| [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) | Claude Code-style Context renderer, Tool/Diff rendering, Context Inspector, and references | v0.8.67, commit `dba37e5` |

Production code lives in `extensions/`. `pi-one-ui` has unified the composition entry point, configuration storage, lifecycle management, layout ownership, overlay orchestration, and input routing. The project now evolves independently and no longer tracks upstream changes directly.

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

| Command              | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `npm install`        | Install dependencies                           |
| `npm run format`     | Format source, tests, and configuration files  |
| `npm run check`      | Check formatting and import organization       |
| `npm run fix`        | Fix formatting and organize imports            |
| `npm run typecheck`  | Run TypeScript type checking                   |
| `npm test`           | Run all tests with Vitest                      |
| `npm run pack:check` | Preview the npm package contents               |
| `npm run verify`     | Run Biome checks, type checking, and all tests |

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
