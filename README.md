# BGA Assistant

A Chrome extension for [Board Game Arena](https://boardgamearena.com) that keeps track of the game state so you don't have to. Turn-based games on BGA can stretch across days or weeks — by the time it's your turn, you may have forgotten what was drawn, returned, transferred, or scored several moves ago. BGA Assistant reads the game log and reconstructs the complete picture for you.

## Supported Games

### Innovation

Reads the full game log from [Innovation](https://boardgamegeek.com/boardgame/63888/innovation) tables and reconstructs the game state — deck stack order, hand contents, score piles — displayed as a visual summary in a Chrome side panel.

- Card grids: hands, scores, achievements, decks, full card lists
- Visibility toggles: None / All / Unknown (show only unaccounted cards)
- Layout toggles: Wide (one row per age) / Tall (color columns)
- Hover tooltips: card face images for base cards, names for cities
- Download: bundled zip with raw data, game log, game state, and standalone summary

## Setup

### Prerequisites

- Node.js 18+
- Chrome 128+

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

1. Navigate to a supported BGA game page in Chrome
2. Click the BGA Assistant icon in the toolbar
3. The side panel opens with a visual summary of the game state
4. Use the download button to save a zip with game data and a standalone summary

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
  background.ts              Service worker: pipeline orchestration, side panel management
  extract.ts                 Content script: BGA data extraction (MAIN world)
  sidepanel/
    sidepanel.ts             Receives data, triggers render, handles downloads
    sidepanel.css            Dark theme, card grids, tooltips
  models/
    types.ts                 Type definitions: Card, CardInfo, GameState, Action, enums
  engine/
    process_log.ts           Raw BGA packets -> structured game log
    game_state.ts            State tracking + constraint propagation
  render/
    summary.ts               GameState -> HTML string via template literals
    config.ts                Section layout config, visibility/layout defaults
    help.ts                  Help page content
assets/
  bga/innovation/
    card_info.json           Card database (210 cards: 105 base + 105 cities)
    icons/                   Resource and hex icon PNGs
    cards/                   Full card face images (for tooltips)
    sprites/                 Card sprite sheets (gitignored)
  extension/                 Extension toolbar icons
```

### Data flow
1. User clicks extension icon on a BGA game page
2. extract.ts (MAIN world) fetches game data from BGA internals
3. background.ts receives data, runs pipeline (processRawLog -> GameState)
4. background.ts opens side panel, sends results via chrome.runtime messaging
5. sidepanel.ts renders summary with download button

## Testing

Tests use vitest and cover the full pipeline: types, log processing, game state engine, rendering, and extension entry points.

```
npm test                        # Run all tests
npx vitest run --coverage       # Run with coverage report
```

## Acknowledgments

Card icons and images are from [bga-innovation](https://github.com/micahstairs/bga-innovation), Micah Stairs' BGA implementation of [Innovation](https://boardgamegeek.com/boardgame/63888/innovation) (Carl Chudyk, Asmadi Games).
