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

The `README.md` only needs updating for changes to the supported game list or project description. The intro text on `docs/index.md` (tagline + pitch paragraph) must match the corresponding lines in `README.md` — when one changes, update the other to match. The per-game descriptions in `README.md` must be exact copies of the first paragraph from the corresponding `docs/pages/` game page — when one changes, update the other to match.

The "Standard features" section must be identical across all game pages — when one changes, update all others to match.

The built-in help page for each game (`src/render/help.ts`) should be aligned with the corresponding `docs/pages/` game page — descriptions of the same feature should convey the same information and use consistent terminology, though exact wording may differ to suit the format.

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

- `src/models/types.ts` — shared BGA types (GameName, RawPacket, RawExtractionData, cardIndex) + re-exports Innovation types
- `src/games/innovation/types.ts` — Innovation types (Card, CardInfo, CardDatabase, enums, actions, log entries)
- `src/games/innovation/process_log.ts` — Innovation BGA packet processing
- `src/games/innovation/game_state.ts` — GameState interface (zone data), createGameState(), cardsAt()
- `src/games/innovation/game_engine.ts` — GameEngine class (state tracking + constraint propagation), extractSuspects()
- `src/games/innovation/serialization.ts` — toJSON/fromJSON serialization, SerializedGameState type
- `src/games/innovation/turn_history.ts` — Turn action types (TurnAction, ActionDetail, ActionType) and recent-turns grouping
- `src/games/innovation/render.ts` — Innovation HTML summary renderer
- `src/games/innovation/config.ts` — Innovation section layout configuration
- `src/games/innovation/display.ts` — Innovation display menu (section visibility persistence + margin updates)
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
- `src/render/help.ts` — help page content (shared)
- `src/render/icons.ts` — shared icon utilities
- `src/render/toggle.ts` — shared toggle/tooltip logic (side panel + ZIP export)
- `src/extract.ts` — content script (MAIN world)
- `src/pipeline.ts` — pure pipeline logic (processGameLog, processGameState, runPipeline) shared by background.ts and CLI scripts
- `src/background.ts` — service worker (orchestration, side panel management, live tracking)
- `scripts/game-log.ts` — CLI: raw_data.json → game_log.json
- `scripts/game-state.ts` — CLI: game_log.json → game_state.json (+ --debug snapshots)
- `sidepanel.html` — side panel HTML entry point (project root, Vite input)
- `src/sidepanel/settings.ts` — shared localStorage persistence (loadSetting/saveSetting with typed defaults)
- `src/sidepanel/` — side panel UI (game-type-aware rendering dispatch)
- `assets/bga/innovation/` — Innovation game data (card_info.json, cards/ (WebP), icons/, sprites/)
- `assets/bga/azul/tiles/` — Azul tile color SVGs
- `assets/fonts/` — bundled Google Fonts (Russo One, Barlow Condensed)
- `assets/extension/` — extension icons
- `docs/pages/data-flow.md` — data flow architecture, message protocols, connection management
