Never prepend `cd` to commands — the working directory is already the project root.
Always use relative paths to project files/folders — never absolute paths (Windows `D:/...` or Unix `/d/...` style).

Always ask clarifying questions before implementing if anything is ambiguous or unclear.

## TypeScript Conventions

This is a TypeScript Chrome extension project. Build with Vite, test with vitest.

Use explicit type annotations on function parameters and return values. Use modern union syntax (`string | null`) — not utility types where a union suffices.

Do not break long single-expression lines (template literals, chained calls, etc.) into multiple lines for formatting. Keep them on one line.

Avoid cryptic abbreviations in variable and attribute names. Use descriptive names (`playerPattern` not `pp`, `cardIndex` not `ci`).

## Workflow

Run `npm run build` after each batch of changes so the extension can be reloaded and tested in the browser.

## Commands

- `npm run build` — build the extension to dist/
- `npm test` — run all tests
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run dev` — watch mode build

## Project Structure

- `src/models/types.ts` — core types (Card, CardInfo, CardDatabase, GameName, enums)
- `src/innovation/process_log.ts` — Innovation BGA packet processing
- `src/innovation/game_state.ts` — Innovation state engine
- `src/innovation/render.ts` — Innovation HTML summary renderer
- `src/innovation/config.ts` — Innovation section layout configuration
- `src/azul/process_log.ts` — Azul BGA packet processing
- `src/azul/game_state.ts` — Azul bag/discard/wall tracking
- `src/azul/render.ts` — Azul tile count table renderer
- `src/render/help.ts` — help page content (shared)
- `src/render/icons.ts` — shared icon utilities
- `src/extract.ts` — content script (MAIN world)
- `src/background.ts` — service worker (multi-game pipeline)
- `sidepanel.html` — side panel HTML entry point (project root, Vite input)
- `src/sidepanel/` — side panel UI (game-type-aware rendering dispatch)
- `assets/bga/innovation/` — Innovation game data (card_info.json, cards/, icons/, sprites/)
- `assets/bga/azul/tiles/` — Azul tile color PNGs
- `assets/extension/` — extension icons
