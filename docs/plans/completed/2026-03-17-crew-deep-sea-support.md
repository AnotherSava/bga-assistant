# Add The Crew: Mission Deep Sea Support

## Overview

Add The Crew: Mission Deep Sea as a third supported game. Track card play across missions, detect player suit voids from trick-following, incorporate sonar communication for candidate narrowing, and display a card grid, player-suit matrix, and trick history table. Support 3-5 players.

## Context

- Files involved:
  - Modify: `src/models/types.ts` — add `"thecrewdeepsea"` to GameName union
  - Modify: `src/background.ts` — add to SUPPORTED_GAMES, pipeline routing, isValidPlayerCount (3-5)
  - Modify: `src/sidepanel/sidepanel.ts` — render dispatch for crew
  - Modify: `src/render/help.ts` — help tab for crew
  - Create: `src/games/crew/types.ts` — suit/card constants and types
  - Create: `src/games/crew/process_log.ts` — raw BGA packets → structured crew log
  - Create: `src/games/crew/game_state.ts` — CrewGameState interface + createCrewGameState()
  - Create: `src/games/crew/game_engine.ts` — state mutation logic (void detection, communication constraints)
  - Create: `src/games/crew/serialization.ts` — toJSON/fromJSON serialization
  - Create: `src/games/crew/render.ts` — HTML renderer (card grid, suit matrix, trick history)
  - Create: `src/games/crew/styles.css` — crew-specific CSS styles (imported by sidepanel)
- Related patterns: Azul pipeline (process_log → game_state → render), Innovation candidate tracking
- Dependencies: none
- Sample data: `data/bgaa_757842815_1569.zip` (completed 4-player game, 39 mission attempts)

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Game overview:** The Crew: Mission Deep Sea is a cooperative trick-taking game for 3-5 players. 40 cards: 4 color suits (Pink/Blue/Green/Yellow, values 1-9 each = 36 cards) + trump suit (Submarine, values 1-4 = 4 cards). The game plays through sequential missions, each dealing fresh hands.

**BGA game slug:** `thecrewdeepsea` (from URL pattern `boardgamearena.com/1/thecrewdeepsea?table=...`).

**BGA card encoding:** `card.color` = suit (1-4 color, 5 submarine), `card.value` = value (1-9 or 1-4). Card key: `"${suit}:${value}"` string.

**BGA notification schema (relevant types):**

| Type | When | Key fields |
|------|------|-----------|
| `newHand` | Mission start | `hand[]` — observer's cards only (suit, value, pId) |
| `startNewMission` | Mission boundary | `mission` object (id, difficulty, etc.) |
| `newTrick` | Trick start | `players{}` with `no` (seat order), `nCards` per player |
| `playCard` | Card played | `card` (color, value, pId), `player_id`, `player_name` |
| `trickWin` | Trick end | `player_id`, `player_name` |
| `endComm` | Sonar communication | `card` (color, value), `comm_status`, `player_id` |
| `captain` | Mission setup | `player_name` — who holds submarine 4 |

**Player count and card distribution:** 3 players: 14/13/13 cards (one leftover after 13 tricks). 4 players: 10 each. 5 players: 8 each. Player seat order extracted from `newTrick` notification's `players[pid].no` field.

**Captain = Submarine 4:** The `captain` notification at mission start reveals which player holds the Submarine 4 card. This is free card location info — the engine should record it as a known card for that player (equivalent to a communication with no position constraint).

**Visibility model:** Only the observer's hand is visible via `newHand`. All played cards are public via `playCard`. Communication reveals specific cards via `endComm`. This is fundamentally different from Azul (all public) and closer to Innovation (partial visibility).

**State tracking — per mission, resets on each `newHand`:**

The state tracks three categories of card status:
- **Played** — cards seen in `playCard` notifications (public)
- **My hand** — observer's remaining cards (from `newHand` minus played)
- **Remaining hidden** — all 40 cards minus played minus my hand = cards in opponents' hands

**Void detection:** When a player plays a card of a different suit than the trick's lead suit, they are void in the lead suit. Submarine (trump) played on a color lead also means void in that suit. Void status is per-player per-suit, persists for the rest of the mission.

**Communication constraints (candidate narrowing):** `endComm` reveals a card and its position within the player's hand for that suit:
- `top` — highest card of this suit → player has no cards of this suit with value > communicated
- `bottom` — lowest card of this suit → player has no cards of this suit with value < communicated
- `middle` — neither highest nor lowest → player has both higher and lower cards of this suit
- `hidden` — card confirmed held, no position info (restricted communication variant)

All four statuses confirm the player holds the communicated card. Communication info is used for deduction logic but not displayed as a separate section in the UI.

**Player-suit status derivation (for the matrix):**
- `X` (void) — player played off-suit when that suit was led
- `!` (has cards) — positive evidence: player communicated a card of that suit (not yet played), OR they are the only non-void player and remaining hidden cards of that suit still exist
- `?` (unknown) — default, no definitive information

**Rendering — three sections:**

**Section 1: Card grid (9 rows × 5 columns).** Rows = values 1-9, columns = suits (Pink, Blue, Green, Yellow, Submarine). Submarine column: only rows 1-4 populated, rows 5-9 cells are empty/absent. Each cell displays one card as: value number (top half) + suit icon (bottom half), colored by suit. Three visual states:
- **Played** — dimmed/grayed out
- **My hand** — bright with highlighted border
- **Remaining hidden** — normal colored card (in some opponent's hand)

**Section 2: Player-suit matrix.** Row per player (all players including observer), column per suit. Each cell shows `X`, `?`, or `!`. The observer's row is trivially derived from their remaining hand (has cards of that suit → `!`, no cards → `X`).

**Section 3: Trick history table.** Columns = players (in seat order), rows = trick numbers (1-N). Each cell shows the card played (colored by suit, value displayed). Lead card: highlighted (e.g., underlined or background tint). Winning card: bold. Current trick (live tracking): partial row with cards played so far, empty cells for pending players.

**Suit colors (CSS):**
- Pink (1): `#ff6699` border / `#5c1a2a` background
- Blue (2): `#4488cc` border / `#1a2a5c` background
- Green (3): `#44aa44` border / `#1a4c1a` background
- Yellow (4): `#ddaa00` border / `#4c4a1a` background
- Submarine (5): `#888888` border / `#333` background (gray, matches trump neutrality)

**Suit icons (inline SVG, color-blind accessibility):** Simple geometric shapes matching the game's symbols: Pink = inverted triangle, Blue = circle, Green = diamond, Yellow = square, Submarine = submarine silhouette. Inlined as SVG constants (same pattern as Innovation's eye icons).

**Card cell layout:** Each card cell uses a small CSS grid with value number on top (large font) and suit icon below (small SVG). Dimensions approximately 30×42px per cell, similar density to Innovation's card elements.

**No defensive fallbacks:** Do not design fallback values that mask invalid data. Trust input correctness — let invalid values surface as visible `null` or runtime errors.

**Module naming:** BGA slug is `thecrewdeepsea` (used in GameName union and URL routing). Source module directory is `src/games/crew/` (short form for code organization, consistent with `src/games/azul/` being shorter than `azulfromplanb`).

**Module structure (mirroring Innovation):** Separate concerns into distinct files:
- `game_state.ts` — pure data: `CrewGameState` interface, `createCrewGameState()` factory
- `game_engine.ts` — mutation logic: replay log entries, void detection, communication constraint tracking, `playerSuitStatus()` derivation
- `serialization.ts` — `toJSON()` / `fromJSON()` for sidepanel JSON roundtrip
This follows Innovation's split of `game_state.ts` (data) / `game_engine.ts` (logic) / `serialization.ts`.

**CSS isolation:** Crew-specific styles live in `src/games/crew/styles.css` rather than appending to the shared `src/sidepanel/sidepanel.css`. The sidepanel entry point imports it (Vite bundles all CSS imports). This keeps game-specific styles co-located with game code, matching the per-game module structure.

## Implementation Steps

### Task 1: Add game routing and types

**Files:**
- Modify: `src/models/types.ts` — add `"thecrewdeepsea"` to GameName
- Modify: `src/background.ts` — add to SUPPORTED_GAMES, isValidPlayerCount, runPipeline stub
- Create: `src/games/crew/types.ts` — suit constants, card type, card key helper
- Modify: `src/__tests__/background.test.ts`

- [x] Add `"thecrewdeepsea"` to the `GameName` union type in `src/models/types.ts`
- [x] Create `src/games/crew/types.ts` with suit constants (`PINK = 1, BLUE = 2, GREEN = 3, YELLOW = 4, SUBMARINE = 5`), `CrewCard` interface (`{ suit: number; value: number }`), `cardKey(suit, value)` helper returning `"${suit}:${value}"`, total card count constants, `SUIT_VALUES` map (suits 1-4 → values 1-9, suit 5 → values 1-4)
- [x] Add `"thecrewdeepsea"` to `SUPPORTED_GAMES` array in `src/background.ts`
- [x] Update `isValidPlayerCount` to accept 3-5 for `"thecrewdeepsea"`
- [x] Add a `runPipeline` branch for `"thecrewdeepsea"` that throws `Error("Crew pipeline not yet implemented")` as a placeholder
- [x] Add an overload signature for `runPipeline` with `gameName: "thecrewdeepsea"`
- [x] Update tests: `classifyNavigation` with crew URLs, `isValidPlayerCount` for 3-5 players, `shouldAutoClose` with crew tables
- [x] Run project test suite — must pass before next task

### Task 2: Implement crew log processing

**Files:**
- Create: `src/games/crew/process_log.ts`
- Create: `src/games/crew/__tests__/process_log.test.ts`

- [x] Define log entry discriminated union types: `MissionStartEntry` (missionId, missionNumber), `HandDealtEntry` (cards: CrewCard[]), `CaptainEntry` (playerId — holds Submarine 4), `TrickStartEntry`, `CardPlayedEntry` (playerId, card), `TrickWonEntry` (winnerId), `CommunicationEntry` (playerId, card, position: "top" | "bottom" | "middle" | "hidden")
- [x] Define `CrewGameLog` interface: `players: Record<string, string>`, `playerOrder: string[]` (seat-ordered IDs), `currentPlayerId: string`, `log: CrewLogEntry[]`
- [x] Implement `processCrewLog(rawData: RawExtractionData): CrewGameLog`
- [x] Parse `startNewMission` → `MissionStartEntry`
- [x] Parse `newHand` → `HandDealtEntry` (extract suit/value from hand array)
- [x] Parse `captain` → `CaptainEntry` (extract player_id — this player holds Submarine 4)
- [x] Parse `newTrick` → `TrickStartEntry` (extract player order from `players[pid].no` on first occurrence)
- [x] Parse `playCard` → `CardPlayedEntry`
- [x] Parse `trickWin` → `TrickWonEntry`
- [x] Parse `endComm` → `CommunicationEntry` (card + comm_status + player_id)
- [x] Extract `currentPlayerId` from rawData
- [x] Create test fixture: extract last-mission packets from sample ZIP into a minimal JSON fixture file
- [x] Write tests: full log processing, mission boundary detection, player order extraction, captain parsing, communication parsing
- [x] Run project test suite — must pass before next task

### Task 3: Implement crew game state, engine, and serialization

**Files:**
- Create: `src/games/crew/game_state.ts` — data types + factory
- Create: `src/games/crew/game_engine.ts` — state mutation logic
- Create: `src/games/crew/serialization.ts` — JSON roundtrip
- Create: `src/games/crew/__tests__/game_engine.test.ts`
- Create: `src/games/crew/__tests__/serialization.test.ts`

- [x] Define `CompletedTrick` type: `{ cards: { playerId: string; card: CrewCard }[]; leadSuit: number; winnerId: string }`
- [x] Define `CrewGameState` interface in `game_state.ts`: `players`, `playerOrder`, `currentPlayerId`, `missionNumber`, `myHand: Set<string>` (card keys), `played: Set<string>`, `playerVoids: Record<string, Set<number>>`, `knownCards: Record<string, Set<string>>` (playerId → card keys confirmed held), `communications: { playerId: string; card: CrewCard; position: string }[]`, `completedTricks: CompletedTrick[]`, `currentTrick: { leadSuit: number | null; cards: { playerId: string; card: CrewCard }[] }`
- [x] Implement `createCrewGameState(players, playerOrder, currentPlayerId)` factory in `game_state.ts`
- [x] Implement `processCrewState(log: CrewGameLog): CrewGameState` in `game_engine.ts` — replay log entries for the **last mission only** (find last `MissionStartEntry` / `HandDealtEntry`, process from there):
  - `HandDealtEntry` → populate `myHand`
  - `CaptainEntry` → add Submarine 4 (`cardKey(5, 4)`) to `knownCards` for captain's player ID
  - `TrickStartEntry` → reset `currentTrick`
  - `CardPlayedEntry` → add to `played`, remove from `myHand` if mine, remove from `knownCards` if tracked, add to `currentTrick.cards`, set `leadSuit` from first card, detect void (card suit ≠ lead suit → add to `playerVoids`)
  - `TrickWonEntry` → move `currentTrick` to `completedTricks`, reset current trick
  - `CommunicationEntry` → store in `communications`, add card to `knownCards` for that player
- [x] Implement `playerSuitStatus(state: CrewGameState): Record<string, Record<number, "X" | "!" | "?">>` in `game_engine.ts` — derive matrix from voids, known cards, and remaining cards:
  - `X` if player is void in suit
  - For observer: `!` if myHand contains cards of that suit, `X` otherwise
  - `!` if player has known cards of that suit (from communication or captain) that haven't been played
  - `!` if remaining hidden cards of a suit exist and only one non-void player remains for that suit
  - `?` otherwise
- [x] Implement `toJSON(state)` / `fromJSON(json)` in `serialization.ts` (Sets → arrays for JSON roundtrip)
- [x] Write tests in `game_engine.test.ts`: initial state after hand dealt, captain card tracking, void detection from off-suit play, communication status tracking, player-suit status derivation (X/!/? cases), multi-trick state progression
- [x] Write tests in `serialization.test.ts`: roundtrip fidelity (Sets, maps, nested structures)
- [x] Run project test suite — must pass before next task

### Task 4: Implement crew renderer

**Files:**
- Create: `src/games/crew/render.ts`
- Create: `src/games/crew/styles.css` — crew-specific CSS (card grid, suit matrix, trick history)
- Modify: `src/sidepanel/sidepanel.ts` — add `import "../games/crew/styles.css"` (Vite CSS bundling)
- Create: `src/games/crew/__tests__/render.test.ts`

- [x] Define inline SVG constants for 5 suit icons (pink triangle, blue circle, green diamond, yellow square, submarine silhouette)
- [x] Define suit color CSS classes: `crew-pink`, `crew-blue`, `crew-green`, `crew-yellow`, `crew-sub`
- [x] Implement `renderCrewSummary(state: CrewGameState): string` returning full HTML with three sections:
- [x] **Card grid section:** 9×5 table (or CSS grid). Row per value (1-9), column per suit (1-5). Each cell renders a card element with value number + suit icon. CSS classes for state: `crew-played` (dimmed), `crew-myhand` (highlighted), `crew-hidden` (normal). Submarine column cells for values 5-9 are empty.
- [x] **Player-suit matrix section:** table with player rows × suit columns. Call `playerSuitStatus()` to fill cells with `X` / `?` / `!`. Style: `X` in red/muted, `!` in green/bright, `?` in gray.
- [x] **Trick history section:** table with player columns (seat order) × trick rows. Each cell shows the card played (colored, value displayed). CSS class `crew-lead` on the cell of the player who led (first card in trick). CSS class `crew-winner` on the winning player's cell (bold). Current trick: partial row for in-progress trick.
- [x] Implement `renderCrewFullPage(state, tableId, css)` for standalone HTML download
- [x] Create `src/games/crew/styles.css` with all crew-specific styles: card grid cells, suit colors (background/border/text triples), played/myhand/hidden states, matrix X/!/? styling, trick table with lead/winner highlights
- [x] Add CSS import to sidepanel entry point so Vite bundles it
- [x] Write tests: HTML structure validation, card state rendering, matrix content, trick table structure
- [x] Run project test suite — must pass before next task

### Task 5: Wire crew pipeline end-to-end

**Files:**
- Modify: `src/background.ts` — replace runPipeline stub with real crew pipeline
- Modify: `src/sidepanel/sidepanel.ts` — render dispatch, zoom context, feature visibility
- Modify: `src/render/help.ts` — add crew help tab
- Modify: `src/__tests__/background.test.ts`

- [x] Replace the placeholder `throw` in `runPipeline` with: `processCrewLog()` → `processCrewState()` → `crewToJSON()` → return `PipelineResults`
- [x] Add `"thecrewdeepsea"` variant to the `PipelineResults` discriminated union type
- [x] Wire side panel: when `gameName === "thecrewdeepsea"`, call `crewFromJSON()` → `renderCrewSummary()`, hide Innovation-specific features (section selector, turn history), show download button
- [x] Add crew zoom context via `switchZoomContext("thecrewdeepsea")`
- [x] Add crew help tab content to `src/render/help.ts`
- [x] Write end-to-end pipeline test with crew fixture data
- [x] Run project test suite — must pass before next task

### Task 6: Verify acceptance criteria

- [x] Manual test: open a Crew table, side panel shows card grid with correct states
- [x] Manual test: player-suit matrix shows X for detected voids, ! for confirmed holds
- [x] Manual test: trick history table displays correctly with lead/winner highlights
- [x] Manual test: state resets properly on new mission
- [x] Manual test: live tracking updates correctly as cards are played
- [x] Manual test: works with the sample 4-player game data
- [x] Manual test: Innovation and Azul tables still work correctly
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`

### Task 7: Update documentation

- [x] Update README.md with Crew support
- [x] Update CLAUDE.md project structure section with crew files
- [x] Move this plan to `docs/plans/completed/`
