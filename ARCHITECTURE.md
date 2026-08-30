# pi-one-ui Architecture

## 1. Product boundary

`pi-one-ui` is one installable Pi extension package and one TUI product. It is not a permanent runtime bridge between two upstream extensions.

The two upstream projects remain read-only references:

| Directory | Upstream | Snapshot |
|---|---|---|
| `vendor/pi-zentui` | `pi-zentui` | `0.21.0`, commit `5341b38` |
| `vendor/pi-cc-extensions` | `pi-cc-extensions` | `0.8.67`, commit `dba37e5` |

Only `extensions/` is production source. Do not modify `vendor/` or `node_modules/`.

## 2. Screen model

Pi's interactive screen is organized as a scroll document plus a dock:

```text
TuiRuntime
└── Main Screen
    ├── Scroll Document
    │   ├── Header
    │   └── Context
    │       ├── User Message
    │       ├── Assistant Message
    │       ├── Thinking
    │       ├── Tool
    │       ├── Diff
    │       └── Summary
    │
    └── Dock
        ├── Pending messages / status
        ├── WorkingLine
        ├── Editor
        └── Footer

    Overlay stack
```

`Context` is the renamed Transcript layout. It means the conversation content area, not the `/context` command. The command is named **Context Inspector** in the feature layer.

## 3. Runtime architecture

There is one composition root:

```text
extensions/index.ts
└── app/runtime/tui-runtime.ts
    ├── ConfigStore
    ├── RuntimeStateStore
    ├── EventCoordinator
    ├── RenderScheduler
    ├── LayoutRegistry
    ├── Header layout
    ├── Context layout
    ├── WorkingLine layout
    ├── Editor layout
    ├── Footer layout
    ├── OverlayManager / InputRouter
    └── non-visual Features
```

`TuiRuntime` mounts the Layout controllers, services, and shared lifecycle effects directly. Standalone compatibility wiring is test-only and is not part of the product runtime.

### Event flow

```text
Pi lifecycle event
       ↓
EventCoordinator
       ↓
Runtime/session state and feature effects
       ↓
Layout selectors
       ↓
RenderScheduler
       ↓
Pi TUI redraw
```

A Layout should not independently register a second handler for every shared lifecycle event. EventCoordinator owns shared lifecycle registration; specialized renderer hooks may remain local to the renderer that owns them.

## 4. Layout ownership

| Layout / seam | Canonical owner | Pi seam |
|---|---|---|
| Header | Header | `ctx.ui.setHeader()` |
| Conversation content | Context | message/entry renderers and context patches |
| User Message | Context | `UserMessageComponent.prototype.render` |
| Tool/Diff/Thinking | Context | tool/message component patches |
| Agent Summary | Context | custom entry renderer and append effect |
| WorkingLine | WorkingLine | working indicator/message plus summary entry |
| Editor | Editor | `ctx.ui.setEditorComponent()` |
| Footer | Footer | `ctx.ui.setFooter()` and status data |
| Overlay | OverlayManager | `ctx.ui.custom({ overlay: true })` |
| Raw input | InputRouter | `ctx.ui.onTerminalInput()` and fullscreen adapter |
| Selector styling | Overlay/selector implementation | selector patch |

Features contribute commands, autocomplete, data or entry effects. They do not claim the visual seam owned by a Layout.

## 5. Source layout

```text
extensions/
├── index.ts
├── app/
│   ├── runtime/                 # TuiRuntime, state, event and render coordination
│   ├── host/                    # Narrow Pi extension/UI ports and capabilities
│   ├── config/                  # ConfigStore and domain projections
│   ├── ownership/               # Layout and patch ownership
│   ├── overlay/                 # Overlay activity, selector and input routing
│   ├── commands/                # /oneui and settings panel previews
│   └── panel.ts                 # /oneui settings UI
├── layouts/
│   ├── header/                  # Startup Header
│   ├── context/                # Conversation content area
│   │   ├── message/
│   │   ├── thinking/
│   │   ├── renderer/
│   │   └── summary/
│   ├── working-line/            # WorkingLine and interaction summary
│   ├── editor/                  # Editor implementation and styles
│   └── footer/                  # Footer rendering and layout
├── features/
│   ├── aliases.ts
│   ├── context-inspector/       # /context command and token breakdown
│   ├── flush-docked-bash.ts
│   ├── legacy/                  # Standalone compatibility implementations
│   ├── session-reference/
│   └── subagent-autocomplete.ts
├── services/                    # Project, Git, runtime, package and session data
├── shared/                      # Format, style and icon implementations
└── tools/                       # Low-level compatibility helpers
```

## 6. Configuration

`extensions/app/config/store.ts` owns:

- the canonical `pi-one-ui.json` path;
- JSON file validation;
- atomic writes;
- symlink target handling;
- file mode preservation;
- update subscriptions.

The persisted v1 schema has one canonical shape:

```text
pi-one-ui.json
├── version
├── projectRefreshIntervalMs
├── icons
├── colors
├── components
└── renderer
```

No historical filenames, flat configuration fields or old style identifiers are accepted as configuration inputs. Future schema changes must remain centralized in ConfigStore and the config domain modules, not in individual Layout implementations.

## 7. Ownership and runtime safety rules

1. One Pi UI seam has one canonical owner in the unified runtime.
2. Standalone compatibility tests may keep an old adapter owner behind an explicit option; unified runtime options must delegate to the canonical Layout.
3. Prototype patches must record their owner and restore only when the installed method is still theirs.
4. `dispose()` must be idempotent and generation-aware.
5. Overlay activity must be balanced in `finally` paths.
6. Raw input routes must be removed together with their host listener.
7. `pi-one-ui.json` is the only persisted configuration source; writes use the shared store.
8. Layout implementation files may be internally large, but their public interface should remain small and deep.

## 8. Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Use `npm run verify` for the complete local gate. Runtime changes must additionally cover reload, session tree rebuild, compaction, regular/fullscreen TUI, headless mode, third-party patch ownership, overlays and input routing.
