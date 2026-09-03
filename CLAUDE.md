Read `~/.claude/learnings/chrome-extension.md` for domain-specific patterns. When you discover new Chrome extension gotchas, API quirks, or non-obvious behaviors during this project, update that file with the new finding.

## TypeScript Conventions

This is a TypeScript Chrome extension project. Build with Vite, test with vitest.

Use explicit type annotations on function parameters and return values. Use modern union syntax (`string | null`) — not utility types where a union suffices.

Do not break long single-expression lines (template literals, chained calls, etc.) into multiple lines for formatting. Keep them on one line.

Avoid cryptic abbreviations in variable and attribute names. Use descriptive names (`playerPattern` not `pp`, `cardIndex` not `ci`).

## Workflow

Run `npm run build` after each batch of changes so the extension can be reloaded and tested in the browser.

Any plan that changes or can change logic should include documentation updates (see Documentation section below).

## Documentation

Keep the relevant page in `docs/pages/` up to date when code changes affect features, setup, or architecture.

The `README.md` only needs updating for changes to the supported game list or project description. The intro text on `docs/index.md` (tagline + pitch paragraph) must match the corresponding lines in `README.md` — when one changes, update the other to match. The per-game descriptions in `README.md` must be exact copies of the first paragraph from the corresponding `docs/pages/games/` game page — when one changes, update the other to match.

The "Standard features" section must be identical across all game pages — when one changes, update all others to match.

The built-in help page for each game (`src/render/help.ts`) should be aligned with the corresponding `docs/pages/games/` game page — descriptions of the same feature should convey the same information and use consistent terminology, though exact wording may differ to suit the format.

Keep `docs/pages/data-flow.md` up to date when code changes affect data flow, message protocols, or control flow logic. Use the `/document-data-flow` skill.

## Commands

- `npm run build` — build the extension to dist/
- `npm test` — run all tests
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run dev` — watch mode build
- `npm run game-log -- <raw_data.json> [--game <name>]` — process raw data into game log
- `npm run game-state -- <game_log.json> [--debug] [--game <name>]` — process game log into game state (--debug writes per-entry snapshots to game_states/)
- `npm run package` — build and create Chrome Web Store ZIP (bga-assistant-{version}.zip)

## Project Structure

- `src/models/types.ts` — shared BGA types (GameName, RawPacket, RawExtractionData, PlayerInfo, cardIndex) + re-exports Innovation types
- `src/engine/constraint.ts` — game-agnostic constraint propagation kernel (naked-single, hidden-single per-placeholder, opt-in hidden-single per-container and naked N-tuples); shared by Crew and Innovation
- `src/engine/turn_history.ts` — game-agnostic `TurnAction<TDetail>` shape and `recentTurns()` half-turn windowing; shared by Innovation and Nucleum
- `src/games/innovation/types.ts` — Innovation types (Card, CardInfo, CardDatabase, enums, actions, log entries)
- `src/games/innovation/process_log.ts` — Innovation BGA packet processing
- `src/games/innovation/game_state.ts` — GameState interface (zone data), createGameState(), cardsAt()
- `src/games/innovation/game_engine.ts` — GameEngine class (state tracking + constraint propagation), extractSuspects()
- `src/games/innovation/serialization.ts` — toJSON/fromJSON serialization, SerializedGameState type
- `src/games/innovation/turn_history.ts` — Innovation action types (ActionDetail, ActionType) over the shared turn-history kernel
- `src/games/innovation/render.ts` — Innovation HTML summary renderer
- `src/games/innovation/config.ts` — Innovation section layout configuration
- `src/games/innovation/display.ts` — Innovation display menu (section visibility, "Show player names" toggle, in-page log toggles, simplified-card toggle with its size slider, echo-text and opponents'-hands options, police-line toggle with its movement slider, margin updates)
- `src/games/innovation/compact_header.ts` — compact table header mount for every BGA game (ISOLATED-world, self-contained; moves BGA's status bar into the topbar, placeholders for restore, shortens known over-long prompts per game)
- `src/games/innovation/compact_header.css` — one-row header layout (collapses BGA's status bar and hides the two redundant board buttons)
- `src/games/innovation/sticky_panels.ts` — pinned right column for every BGA game (ISOLATED-world, self-contained; measures the frozen bar and the panel stack, publishes them as custom properties, copies the page backdrop)
- `src/games/innovation/sticky_panels.css` — the sticky rules for both modes (whole column while the turn history is up, player panels alone otherwise) and the panels' backdrop
- `src/games/innovation/simplified_cards.ts` — simplified table cards (MAIN-world, self-contained; patches Innovation's layout constants, marks each pile's top card from `zone.items`, rewrites card names from `gameui.cards`) + opponent-hand knowledge push (replaces each opponent-hand zone's `itemIdToCoordsGrid` to resize it, draws the panel's card into each face-down card)
- `src/games/innovation/simplified_cards.css` — the compact card's two layouts (top card / covered card), scaled from `--bgaa-card-scale`, plus the resource-icon swap (BGA's framed sprite tiles replaced by the extension's flat frame-removed PNGs, via the `__BGAA_ICONS__` URL placeholder)
- `src/games/innovation/mini_card.css` — the panel's compact card, shared by the side panel, the ZIP export and the opponents' hands on BGA's table (every rule scoped under `.bgaa-cards`, which must outweigh BGA's own single-class `.card` rule)
- `src/games/innovation/card_tip.css` — card tooltip geometry shared by the side panel, the in-page log and the simplified cards' opponent hands
- `src/games/innovation/action_tint.ts` — police-line highlight (MAIN-world, self-contained; polls `gameui` for the live turn owner, marks the root while the viewer must act during another player's turn, publishes the stripe scroll as custom properties)
- `src/games/innovation/action_tint.css` — the diagonal amber hazard stripes across BGA's top bar and their animation
- `src/games/azul/process_log.ts` — Azul BGA packet processing
- `src/games/azul/game_state.ts` — Azul bag/discard/wall tracking
- `src/games/azul/render.ts` — Azul tile count table renderer
- `src/games/azul/display.ts` — Azul display menu (shimmer toggle with persistence)
- `src/games/azul/styles.css` — Azul-specific CSS styles (tile table, shimmer animation)
- `src/games/crew/types.ts` — Crew types (suit constants, ALL_SUITS, CrewCard, card key helper, SUIT_VALUES)
- `src/games/crew/process_log.ts` — Crew BGA packet processing (missions, tricks, communications)
- `src/games/crew/game_state.ts` — CardGuess candidate model, Trick interface, CrewGameState interface, createCrewGameState() factory
- `src/games/crew/game_engine.ts` — Crew game engine (candidate narrowing, suit tracking, constraint propagation)
- `src/games/crew/serialization.ts` — toJSON/fromJSON serialization for Crew game state
- `src/games/crew/render.ts` — Crew HTML renderer (card grid, suit matrix, trick history)
- `src/games/crew/styles.css` — Crew-specific CSS styles
- `src/games/nucleum/types.ts` — Nucleum city names and turn-history action detail types
- `src/games/nucleum/process_log.ts` — Nucleum BGA packet processing (turn boundaries + chosen actions; consequences dropped)
- `src/games/nucleum/game_state.ts` — NucleumGameState (the turn history), factory, toJSON/fromJSON
- `src/games/nucleum/game_engine.ts` — log entries to turn actions: turn grouping, undo rewinds, railway link naming
- `src/games/nucleum/render.ts` — Nucleum HTML renderer (turn history as the panel's whole summary)
- `src/games/nucleum/display.ts` — Nucleum display menu (show player names, show in BGA game log)
- `src/games/nucleum/styles.css` — Nucleum panel styles (history list, out-of-turn actor)
- `src/games/nucleum/player_panels.ts` — compact player panels on BGA's table (ISOLATED-world, self-contained; carries the root class its stylesheet hangs off, and holds the Nucleum-board check)
- `src/games/nucleum/player_panels.css` — the five resource counters folded onto one line via `zoom` (never per-icon sizing, which mis-crops the pixel-positioned network sprite), worker reserve dropped, every icon filling the same box so all five stand at one height, achievement star and fulfilled-contract card redrawn as inline `data:` SVGs without BGA's black disc and gold ring, first player marked by a corner wedge (a real element, inserted by `player_panels.ts` so it can carry a tooltip) instead of BGA's "1" disc, beginner notice dropped
- `src/render/turn_history_rows.ts` — turn-history row renderer for every game and both surfaces; games supply a detail formatter
- `src/render/turn_history.css` — turn-history row appearance shared by both surfaces
- `src/render/inpage_log.ts` — in-page game log mount for every game with a turn history (ISOLATED-world, self-contained; keyed row reconcile, popover tooltips, BGA log hiding)
- `src/render/inpage_log.css` — in-page-only delta (popover reveal, BGA log hiding, container box)
- `src/render/help.ts` — help page content (shared)
- `src/render/icons.ts` — shared icon utilities
- `src/render/player.ts` — shared player-color rendering helper (`playerColorAttr` emits inline `--player-color` style from a PlayerInfo)
- `src/render/toggle.ts` — shared toggle logic (side panel + ZIP export); tooltips are CSS-only via anchor positioning
- `src/time-tracking.ts` — game table play-time tracker (session types, URL parser, SessionTracker class — real-time mode + tournament/arena classification, BGA localStorage sync, CSV export/import, session/table deletion, read-time stray-glance merging)
- `src/extract.ts` — content script (MAIN world)
- `src/pipeline.ts` — pure pipeline logic (processGameLog, processGameState, runPipeline) shared by background.ts and CLI scripts
- `src/background.ts` — service worker (orchestration, side panel management, live tracking, time tracking integration)
- `scripts/game-log.ts` — CLI: raw_data.json → game_log.json
- `scripts/game-state.ts` — CLI: game_log.json → game_state.json (+ --debug snapshots)
- `scripts/migrate-fixture.ts` — one-shot migration for legacy `players: {id: name}` fixtures → `Record<string, PlayerInfo>`
- `sidepanel.html` — side panel HTML entry point (project root, Vite input)
- `src/sidepanel/settings.ts` — shared localStorage persistence (loadSetting/saveSetting with typed defaults)
- `src/sidepanel/turn_history_settings.ts` — settings shared by every game that shows a turn history (show-player-names, mirrored into the in-page store)
- `src/sidepanel/global_menu.ts` — the help page's eye menu (settings that apply to every BGA table, not one game)
- `src/sidepanel/inpage_settings.ts` — settings for what the extension changes on BGA's own page (in-page log, compact header, pinned panels, simplified cards with their opponents'-hands sub-option) in `chrome.storage.local` (shared by the side panel and the service worker, which has no localStorage)
- `src/sidepanel/` — side panel UI (game-type-aware rendering dispatch)
- `assets/bga/innovation/` — Innovation game data (card_info.json, cards/ (WebP), icons/, sprites/)
- `assets/bga/azul/tiles/` — Azul tile color SVGs
- `assets/fonts/` — bundled Google Fonts (Russo One, Barlow Condensed)
- `assets/extension/` — extension icons
- `docs/pages/data-flow.md` — data flow architecture, message protocols, connection management
- `docs/screenshots/screenshots.json` — screenshot manifest (what each frame shows, its replacement policy, how it was captured)
- `docs/screenshots/capture/` — documentation screenshot capture: `lib/render.ts` drives the panel's own renderers against a committed fixture into standalone HTML, `lib/shoot.py` shoots it headless, one `<id>.sh` per frame; needs no BGA session
- `docs/screenshots/capture/lib/key.py` — lifts BGA's wood background off a hand-taken table shot: masks the panels by geometry (not colour — fill and wood are ~28 levels of blue apart), insets a pixel past the antialiased band, strokes the outline rather than the canvas. Step one; `border.py` is step two
