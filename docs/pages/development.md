---
layout: default
title: Development
nav_order: 4
has_children: true
---

## Setup

### Prerequisites

- Node.js 24+
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

Reads `raw_data.json`, auto-detects the game from the `gameName` field, runs the game-specific log processor, and writes `game_log.json` to the same directory. If the file lacks a `gameName` field (e.g. older exports), specify `--game <name>` (innovation, azul, thecrewdeepsea, nucleum).

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
  migrate-fixture.ts         One-shot migration for legacy fixture player maps
src/
  background.ts              Service worker: orchestration, side panel management, live tracking
  pipeline.ts                Pure pipeline logic shared by background.ts and CLI scripts
  extract.ts                 Content script: BGA data extraction (MAIN world)
  time-tracking.ts           Play-time tracker: sessions, table classification, CSV export/import
  sidepanel/
    sidepanel.ts             Receives data, triggers render, handles downloads
    sidepanel.css            Dark theme, font declarations, card grids, tooltips
    settings.ts              localStorage persistence: loadSetting/saveSetting with typed defaults
    turn_history_settings.ts Settings shared by every game that shows a turn history
    inpage_settings.ts       chrome.storage.local settings for what is changed on BGA's own page
    global_menu.ts           The help page's eye menu: settings that apply to every BGA table
  models/
    types.ts                 Shared BGA types (GameName, RawPacket, RawExtractionData)
  engine/
    constraint.ts            Game-agnostic constraint propagation kernel (shared by Crew and Innovation)
    turn_history.ts          Game-agnostic TurnAction shape and recent-turns grouping
  games/
    innovation/
      types.ts               Innovation types: Card, CardInfo, CardDatabase, enums, actions
      process_log.ts         Raw BGA packets -> structured Innovation game log
      game_state.ts          GameState interface (zone data), createGameState(), cardsAt()
      game_engine.ts         GameEngine class: state tracking + constraint propagation
      serialization.ts       toJSON/fromJSON serialization for side panel transport
      turn_history.ts        Innovation action types over the shared turn-history kernel
      render.ts              GameState + GameEngine -> HTML string via template literals
      config.ts              Section layout config, visibility/layout defaults
      display.ts             Innovation display menu: sections, in-page log, cards, police line
      compact_header.ts      In-page surface: BGA's three header rows folded into one (every game)
      compact_header.css     The one-row layout those DOM moves make possible
      sticky_panels.ts       In-page surface: the pinned right column (every game)
      sticky_panels.css      The sticky rules for both modes, and the panels' backdrop
      simplified_cards.ts    In-page surface: the panel's compact card on BGA's own table
      simplified_cards.css   That card's interior at panel scale, and the opponent-hand slot
      action_tint.ts         In-page surface: hazard stripes while you must act out of turn
      action_tint.css        The stripes and their animation
      mini_card.css          The panel's compact card, shared by panel, ZIP export and table
      card_tip.css           Card tooltip geometry, shared by panel, in-page log and table
    azul/
      process_log.ts         Raw BGA packets -> structured Azul game log
      game_state.ts          Azul bag/discard/wall tracking
      render.ts              AzulGameState -> HTML tile count table
      display.ts             Azul display menu (shimmer toggle)
      styles.css             Azul-specific CSS (tile table, shimmer animation)
    crew/
      types.ts               Crew types: suit constants, ALL_SUITS, CrewCard, card key helper
      process_log.ts         Raw BGA packets -> structured Crew game log
      game_state.ts          CardGuess, Trick, CrewGameState interface, createCrewGameState() factory
      game_engine.ts         processCrewState() pipeline, void detection, communication constraints, playerSuitStatus()
      serialization.ts       toJSON/fromJSON serialization for side panel transport
      render.ts              CrewGameState -> HTML card grid, suit matrix, trick history
      styles.css             Crew-specific CSS (card grid, suit colors, matrix, trick table)
    nucleum/
      types.ts               Nucleum city names and turn-history action detail types
      process_log.ts         Raw BGA packets -> structured Nucleum game log
      game_state.ts          NucleumGameState (the turn history) + toJSON/fromJSON
      game_engine.ts         Log entries -> turn actions: grouping, undo rewinds, railway links
      render.ts              NucleumGameState -> HTML turn history
      display.ts             Nucleum display menu (player names, in-page log)
      styles.css             Nucleum-specific CSS (history list, out-of-turn actor)
      player_panels.ts       In-page surface: BGA's player panels folded onto one line
      player_panels.css      The fold, every rule scoped under the mount's class
  render/
    help.ts                  Help page content
    icons.ts                 Shared icon utilities
    player.ts                Shared player-color helper: inline --player-color from a PlayerInfo
    toggle.ts                Shared toggle logic (side panel + ZIP export); tooltips are CSS-only
    turn_history_rows.ts     Turn-history rows for every game and both surfaces
    turn_history.css         Row appearance, shared by the panel and the in-page log
    inpage_log.ts            Mount function for the turn history in BGA's log column
    inpage_log.css           In-page-only delta over the shared row styles
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
docs/
  screenshots/
    screenshots.json         Screenshot manifest: what each frame shows and its replacement policy
    capture/
      lib/render.ts          Renders a shot's subject to standalone HTML from a committed fixture
      lib/shoot.py           Headless Chromium capture (Playwright), framed to a uniform margin
      fixtures/              Game logs the captures render, committed so a shot is reproducible
      <id>.sh                One script per screenshot, named for its manifest entry
```

### Documentation screenshots

The shots in `docs/pages/` that show the side panel are captured by script rather than by hand —
`bash docs/screenshots/capture/<id>.sh` rebuilds one. Each drives the panel's own renderers against a
committed fixture, so a capture needs no BGA session, no live table and no login, and reruns
identically on any machine. `docs/screenshots/screenshots.json` records what every frame shows and
whether it may be replaced automatically; the shots of BGA's own page are marked `never`, since only
a real table can produce them.

### Data flow

See [Data Flow Architecture](data-flow) for the full data flow architecture, message protocols, and connection management details.

## Testing

Tests use vitest and cover the full pipeline: types, log processing, game engine, serialization, rendering, and extension entry points.

```
npm test                        # Run all tests
npx vitest run --coverage       # Run with coverage report
```

## Release

`.github/workflows/build.yml` runs on every push to `main` and on every PR — it lints, tests, packages, and uploads the zip as an Actions artifact (30-day retention). When a `v*` tag is pushed, it additionally creates a GitHub Release with the zip attached.

To cut a new release, run the project-local `/release` skill. It bumps `manifest.json` + `package.json`, commits and pushes, drafts release notes from commits since the last tag for review, pushes the `vX.Y.Z` tag, monitors the workflow run, and updates the release notes once the zip is published. The tag must match `manifest.json` exactly — CI fails fast otherwise.

Then run the `/publish-chrome-extension` skill. It downloads the release zip, compares the new package against the version the store already holds (the Web Store API reports it as `crxVersion`), uploads it, and submits it for review. Anything on the dashboard's Privacy practices or Store listing tabs — permission justifications, single purpose, store description — has to be edited there by hand: the API can neither read nor write it, so the repo deliberately keeps no copy of it.

Local builds via `npm run package` still work for testing, but the CI build is the canonical artifact for Web Store uploads.
