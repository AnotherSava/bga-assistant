---
layout: default
title: Development
---

[Home](..) | [Innovation](innovation) | [Azul](azul) | [Crew](crew) | [Development](development) | [Privacy](privacy)

---

## Setup

### Prerequisites

- Node.js 18+
- Chrome 141+

### Install

```
npm install
npm run build
```

### Install from source

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in the top-right corner)
3. Click "Load unpacked" and select this project's root directory
4. The BGA Assistant icon appears in the Chrome toolbar

## Data processing CLI

Two CLI scripts run the extension's pipeline stages locally for debugging, using the same artifacts saved by the ZIP download.

### game-log

Reads `raw_data.json`, auto-detects the game from the `gameName` field, runs the game-specific log processor, and writes `game_log.json` to the same directory. If the file lacks a `gameName` field (e.g. older exports), specify `--game <name>` (innovation, azul, thecrewdeepsea).

```
npm run game-log -- data/bgaa_823235522_23/raw_data.json
```

### game-state

Reads `game_log.json`, runs the engine and serialization pipeline, and writes `game_state.json` to the same directory. If the file lacks a `gameName` field, specify `--game <name>`. With `--debug`, also creates a `game_states/` subfolder with per-entry snapshots named by turn and entry index (`0001_0042.json`, `0001_0043.json`, etc.).

```
npm run game-state -- data/bgaa_823235522_23/game_log.json [--debug]
```

## Project structure

```
manifest.json                Chrome extension manifest (v3, side panel)
sidepanel.html               Side panel page shell (Vite HTML entry point)
scripts/
  game-log.ts                CLI: raw_data.json → game_log.json
  game-state.ts              CLI: game_log.json → game_state.json (+ --debug snapshots)
  package.ts                 CLI: build + create Chrome Web Store ZIP
src/
  background.ts              Service worker: orchestration, side panel management, live tracking
  pipeline.ts                Pure pipeline logic shared by background.ts and CLI scripts
  extract.ts                 Content script: BGA data extraction (MAIN world)
  sidepanel/
    sidepanel.ts             Receives data, triggers render, handles downloads
    sidepanel.css            Dark theme, font declarations, card grids, tooltips
  models/
    types.ts                 Shared BGA types (GameName, RawPacket, RawExtractionData)
  games/
    innovation/
      types.ts               Innovation types: Card, CardInfo, CardDatabase, enums, actions
      process_log.ts         Raw BGA packets -> structured Innovation game log
      game_state.ts          GameState interface (zone data), createGameState(), cardsAt()
      game_engine.ts         GameEngine class: state tracking + constraint propagation
      serialization.ts       toJSON/fromJSON serialization for side panel transport
      turn_history.ts         Turn action types and recent-turns grouping
      render.ts              GameState + GameEngine -> HTML string via template literals
      config.ts              Section layout config, visibility/layout defaults
    azul/
      process_log.ts         Raw BGA packets -> structured Azul game log
      game_state.ts          Azul bag/discard/wall tracking
      render.ts              AzulGameState -> HTML tile count table
    crew/
      types.ts               Crew types: suit constants, ALL_SUITS, CrewCard, card key helper
      process_log.ts         Raw BGA packets -> structured Crew game log
      game_state.ts          CardGuess, Trick, CrewGameState interface, createCrewGameState() factory
      game_engine.ts         processCrewState() pipeline, void detection, communication constraints, playerSuitStatus()
      serialization.ts       toJSON/fromJSON serialization for side panel transport
      render.ts              CrewGameState -> HTML card grid, suit matrix, trick history
      styles.css             Crew-specific CSS (card grid, suit colors, matrix, trick table)
  render/
    help.ts                  Help page content
    icons.ts                 Shared icon utilities
    toggle.ts                Shared toggle logic (side panel + ZIP export); tooltips are CSS-only
assets/
  bga/
    innovation/
      card_info.json         Card database (base, echoes, cities, and artifacts cards plus specials)
      icons/                 Resource and hex icon PNGs
      cards/                 Full card face images (WebP, for tooltips)
      sprites/               Card sprite sheets (gitignored)
    azul/
      tiles/                 Tile color SVGs (5 colors)
  fonts/                     Bundled web fonts (Russo One, Barlow Condensed woff2)
  extension/                 Extension toolbar icons
```

### Data flow

See [Data Flow Architecture](data-flow) for the full data flow architecture, message protocols, and connection management details.

## Testing

Tests use vitest and cover the full pipeline: types, log processing, game engine, serialization, rendering, and extension entry points.

```
npm test                        # Run all tests
npx vitest run --coverage       # Run with coverage report
```
