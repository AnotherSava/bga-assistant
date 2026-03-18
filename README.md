# BGA Assistant

A Chrome extension for [Board Game Arena](https://boardgamearena.com) that keeps track of the game state so you don't have to. Turn-based games on BGA can stretch across days or weeks — by the time it's your turn, you may have forgotten what was drawn, returned, transferred, or scored several moves ago. BGA Assistant reads the game log and reconstructs the complete picture for you.

## Supported Games

### Innovation

Reads the full game log from [Innovation](https://boardgamegeek.com/boardgame/63888/innovation) 2-player tables and reconstructs the game state — deck stack order, hand contents, score piles — displayed as a visual summary in a Chrome side panel. Supports the base game and the Echoes of the Past and Cities of Destiny expansions.

- Live tracking: while the side panel is open, the display automatically updates when the game progresses — a green status dot appears in the status bar
- Auto-update: while the side panel is open, switching to another supported game tab automatically extracts and displays its state
- Status bar: shows the table number and live tracking indicator
- Card grids: hands, scores, deck, full card list, achievements
- Set toggle: switch between Base, Echoes, and Cities card sets for deck and card list
- Filter toggle: All / Unknown (show only unaccounted cards)
- Layout toggle: Wide (one row per age) / Tall (color columns)
- Turn history: compact chronological display of recent actions (meld, draw, dogma, endorse, achieve, promote) with card name tooltips; compound actions (e.g. meld → promote → dogma) render as indented sub-action lines
- Section selector: eye button to show/hide entire sections (including turn history visibility)
- Hover tooltips: card face images with full card details on hover
- Auto-hide: three-mode toggle controlling side panel behavior — Never (always open), Leaving BGA (closes on non-BGA tabs), Leaving tables (closes when navigating away from supported game tables)
- Keyboard shortcut: configurable via `chrome://extensions/shortcuts` to toggle the side panel open/closed
- Lit icon: the toolbar icon glows when the active tab has a supported game table open
- Per-game zoom: zoom level is saved independently for each game and the help page; the top bar stays at native size
- Persistent settings: all toggle states, section visibility, and pin mode are saved across sessions
- Download: bundled zip with raw data, game log, game state, and standalone summary

### Azul

Tracks the tile bag and discard pile (box lid) for [Azul](https://boardgamegeek.com/boardgame/230802/azul) tables with 2-4 players. Displays remaining tile counts per color in a compact table so you always know what's left to draw.

- Bag and box tracking: shows how many tiles of each color remain in the bag and the box lid (discard pile)
- Refill detection: annotates when the bag was refilled from the box mid-round
- Live tracking: counts update automatically as moves are made
- All standard features: auto-hide, lit icon, auto-update on tab switch

### The Crew: Mission Deep Sea

Tracks card play across missions for [The Crew: Mission Deep Sea](https://boardgamegeek.com/boardgame/324856/the-crew-mission-deep-sea) tables with 3-5 players. Displays a card grid showing which cards are played, in your hand, or hidden in opponents' hands, a player-suit matrix for void and holding detection, and a trick history table.

- Card grid: 40-card overview (4 color suits + submarine trump) with visual states for played (dimmed), in hand (highlighted), and remaining hidden cards
- Void detection: automatically detects when a player is void in a suit from trick-following behavior
- Communication tracking: integrates sonar communication data to narrow down card locations
- Player-suit matrix: shows X (void), ! (confirmed cards), or ? (unknown) per player per suit
- Trick history: chronological table of all tricks with lead and winner highlights
- Per-mission state: automatically resets tracking on each new mission
- Live tracking: updates as cards are played
- All standard features: auto-hide, lit icon, auto-update on tab switch

## Setup

### Prerequisites

- Node.js 18+
- Chrome 141+

### Install

```
npm install
npm run build
```

### Load Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in the top-right corner)
3. Click "Load unpacked" and select this project's root directory
4. The BGA Assistant icon appears in the Chrome toolbar

## Usage

1. Navigate to a supported BGA game page in Chrome — the toolbar icon brightens up to indicate a supported game is detected
2. Click the BGA Assistant icon in the toolbar (or use a keyboard shortcut if configured)
3. The side panel opens with a visual summary of the game state
4. While viewing a game, the side panel automatically updates when the game progresses — a green dot in the status bar indicates active tracking
5. Switching to another supported game tab automatically updates the display
6. Use the auto-hide button in the side panel to choose when the panel closes — never, when leaving BGA, or when leaving game tables
7. Use the download button to save a zip with game data and a standalone summary

## Development

```
npm run dev          # Watch mode (rebuilds on changes)
npm test             # Run tests
npm run test:watch   # Watch mode tests
npm run lint         # TypeScript type checking
```

## Architecture

```
manifest.json                Chrome extension manifest (v3, side panel)
sidepanel.html               Side panel page shell (Vite HTML entry point)
src/
  background.ts              Service worker: pipeline orchestration, side panel management, live tracking
  extract.ts                 Content script: BGA data extraction (MAIN world)
  sidepanel/
    sidepanel.ts             Receives data, triggers render, handles downloads
    sidepanel.css            Dark theme, card grids, tooltips
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
    toggle.ts                Shared toggle/tooltip logic (side panel + ZIP export)
assets/
  bga/
    innovation/
      card_info.json         Card database (315 cards: 105 base + 105 echoes + 105 cities)
      icons/                 Resource and hex icon PNGs
      cards/                 Full card face images (for tooltips)
      sprites/               Card sprite sheets (gitignored)
    azul/
      tiles/                 Tile color PNGs (5 colors)
  extension/                 Extension toolbar icons
```

### Data flow
1. User clicks extension icon on a BGA game page
2. extract.ts (MAIN world) fetches game data from BGA internals
3. background.ts receives data, identifies the game, and runs the appropriate pipeline (Innovation, Azul, or Crew)
4. background.ts opens side panel and pushes results directly via chrome.runtime messaging (push-only, no request/response round trips)
5. sidepanel.ts receives pushed results, dispatches to the game-specific renderer and displays the summary
6. A MutationObserver watcher is injected to monitor the game log DOM for changes
7. When new log entries appear, the watcher notifies the background (debounced + rate-limited with deferred catch-up)
8. The background re-runs the extraction pipeline and pushes updated results to the side panel

For unsupported BGA games, the same flow runs but skips pipeline processing — the side panel shows the help page with the download button enabled (ZIP contains raw data only).

## Testing

Tests use vitest and cover the full pipeline: types, log processing, game engine, serialization, rendering, and extension entry points.

```
npm test                        # Run all tests
npx vitest run --coverage       # Run with coverage report
```

## Acknowledgments

Card icons and images are from [bga-innovation](https://github.com/micahstairs/bga-innovation), Micah Stairs' BGA implementation of [Innovation](https://boardgamegeek.com/boardgame/63888/innovation) (Carl Chudyk, Asmadi Games). Tile sprites are from BGA's implementation of [Azul](https://boardgamegeek.com/boardgame/230802/azul) (Michael Kiesling, Plan B Games).
