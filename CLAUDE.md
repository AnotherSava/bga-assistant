Never prepend `cd` to commands — the working directory is already the project root.
Always use relative paths to project files/folders — never absolute paths (Windows `D:/...` or Unix `/d/...` style).

Always ask clarifying questions before implementing if anything is ambiguous or unclear.

Exclude `node_modules/` from all file and content search patterns — it clogs results with false positives.

## TypeScript Conventions

This is a TypeScript Chrome extension project. Build with Vite, test with vitest.

Use explicit type annotations on function parameters and return values. Use modern union syntax (`string | null`) — not utility types where a union suffices.

Do not break long single-expression lines (template literals, chained calls, etc.) into multiple lines for formatting. Keep them on one line.

Avoid cryptic abbreviations in variable and attribute names. Use descriptive names (`playerPattern` not `pp`, `cardIndex` not `ci`).

Do not add defensive fallbacks that mask invalid data (e.g. `?? "?"`, `?? 0`). Trust that inputs are correct and let invalid values surface naturally — a visible `null` in output or a runtime error is better than silently producing plausible-looking wrong output.

## Workflow

Run `npm run build` after each batch of changes so the extension can be reloaded and tested in the browser.

Keep `README.md` in the project root up to date when code changes affect project structure, features, or usage.

## Commands

- `npm run build` — build the extension to dist/
- `npm test` — run all tests
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run dev` — watch mode build

## Project Structure

- `src/models/types.ts` — shared BGA types (GameName, RawPacket, RawExtractionData, cardIndex) + re-exports Innovation types
- `src/games/innovation/types.ts` — Innovation types (Card, CardInfo, CardDatabase, enums, actions, log entries)
- `src/games/innovation/process_log.ts` — Innovation BGA packet processing
- `src/games/innovation/game_state.ts` — Innovation state engine
- `src/games/innovation/turn_history.ts` — Turn action types (TurnAction, ActionType) and recent-turns grouping
- `src/games/innovation/render.ts` — Innovation HTML summary renderer
- `src/games/innovation/config.ts` — Innovation section layout configuration
- `src/games/azul/process_log.ts` — Azul BGA packet processing
- `src/games/azul/game_state.ts` — Azul bag/discard/wall tracking
- `src/games/azul/render.ts` — Azul tile count table renderer
- `src/render/help.ts` — help page content (shared)
- `src/render/icons.ts` — shared icon utilities
- `src/render/toggle.ts` — shared toggle/tooltip logic (side panel + ZIP export)
- `src/extract.ts` — content script (MAIN world)
- `src/background.ts` — service worker (multi-game pipeline)
- `sidepanel.html` — side panel HTML entry point (project root, Vite input)
- `src/sidepanel/` — side panel UI (game-type-aware rendering dispatch)
- `assets/bga/innovation/` — Innovation game data (card_info.json, cards/, icons/, sprites/)
- `assets/bga/azul/tiles/` — Azul tile color PNGs
- `assets/extension/` — extension icons
