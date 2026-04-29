# Plan: Generalized Player Colors

## Context

The extension currently hardcodes "you = red, opponent = blue" in two places (Innovation turn-history rows, Crew player-suit matrix), via `th-me`/`th-opp` and `crew-matrix-me` CSS classes pinned to specific hex literals. This was acceptable for 2-player Innovation but breaks down for 3–5 player Azul/Crew, where each player needs their *actual* BGA-assigned color and the "you" player needs to remain distinguishable regardless of which color BGA happened to give them.

We will:
1. Capture each player's BGA-assigned color at extraction time and thread it through the pipeline.
2. Render every per-player UI element in that player's actual BGA color via CSS custom properties.
3. Highlight the observer ("you") with a subtle background tint of their own player color (decided: `rgba(<player>, 0.12)`).
4. Unify Innovation's per-player Maps onto ID-based keys (currently name-keyed) so all three games share one player model — decided: scope expanded to do this migration now.

## Source of truth for player colors

Confirmed from exploration:
- BGA exposes `gamedatas.players[<pid>].color` (bare 6-char hex, no `#`) for every game on every page load.
- Crew notification packets *also* carry `color`, but Innovation/Azul packets do not.
- Therefore the **only** universally available source is `gui.gamedatas.players[pid].color` read in `src/extract.ts`. We will read it from there for all three games and not consult notification args.

`colorHex` will be stored as the bare 6-char string (BGA-native). The `#` is added only at the CSS interpolation site.

## Critical files

- `src/models/types.ts` — add `PlayerInfo`; change `RawExtractionData.players`
- `src/extract.ts` — read `gamedatas.players[pid].color`
- `src/games/innovation/process_log.ts` — `players: Record<string, PlayerInfo>` in `GameLog`; rebuild `playerNames` locally
- `src/games/azul/process_log.ts` — same change for `AzulGameLog`
- `src/games/crew/process_log.ts` — same change for `CrewGameLog`
- `src/games/innovation/game_state.ts` — `players: PlayerInfo[]`; **migrate Maps from name-keyed to ID-keyed**; store `perspective` as the observer's player ID
- `src/games/innovation/game_engine.ts` — every Map lookup now keys by ID
- `src/games/innovation/serialization.ts` — round-trip `PlayerInfo[]` and ID-keyed Maps
- `src/games/innovation/turn_history.ts` — already uses `action.player` strings; keep as-is but verify those are IDs not names (currently names)
- `src/games/innovation/render.ts` — read player color from `PlayerInfo[]`; emit inline `style="--player-color: #<hex>"` on per-player elements; replace `th-me`/`th-opp` logic
- `src/games/azul/game_state.ts` — add `players: PlayerInfo[]`; toJSON/fromJSON
- `src/games/crew/game_state.ts` — `players: Record<string, PlayerInfo>`
- `src/games/crew/serialization.ts` — round-trip new shape
- `src/games/crew/render.ts` — emit `--player-color` per row
- `src/sidepanel/sidepanel.css` — turn-history rules consume `var(--player-color)`; observer gets `background: rgba(...,0.12)` tint
- `src/games/crew/styles.css` — matrix row rules consume `var(--player-color)`; observer row tinted
- `src/pipeline.ts` — pass new structures through
- `src/sidepanel/sidepanel.ts` — pass new structures through to renderers
- `scripts/game-log.ts`, `scripts/game-state.ts` — add a one-line shape check that throws on legacy fixtures
- `docs/pages/data-flow.md`, `docs/pages/innovation.md`, `docs/pages/crew.md`, `src/render/help.ts` — doc updates per `CLAUDE.md`

## Step-by-step

### 1. Add `PlayerInfo` type

In `src/models/types.ts`:
```ts
export interface PlayerInfo {
    id: string;
    name: string;
    colorHex: string;
    isCurrent: boolean;
}
```
Change `RawExtractionData.players` from `Record<string, string>` to `Record<string, PlayerInfo>`. Keep `currentPlayerId` field as redundant convenience.

### 2. Read color in `extract.ts`

Replace the existing player-name loop with one that builds full `PlayerInfo` records. Throw a hard error if `gui.gamedatas.players[pid].color` is missing — no defensive fallback (per `feedback_no_defensive_fallbacks.md`).

### 3. Process_log uniform changes

For each game (Innovation, Azul, Crew) in `process_log.ts`:
- Change `GameLog`/`AzulGameLog`/`CrewGameLog`'s `players` field type to `Record<string, PlayerInfo>`.
- At the top of the processor, derive a local `playerNames: Record<string, string>` from `Object.entries(rawData.players).map(([id, p]) => [id, p.name])` and use it everywhere player names are needed today.

### 4. Innovation: migrate Maps to ID-keyed (scope-expanded per user decision)

In `src/games/innovation/game_state.ts`:
- Change `players: string[]` → `players: PlayerInfo[]` (preserve seat order).
- Change Maps `hands`, `boards`, `scores`, `revealed`, `forecast`, `displays`, `achievementRelics` from name-keyed to **ID-keyed** (`Map<string, ...>` where the string is `PlayerInfo.id`).
- Change `perspective: string` to store the observer's **ID** instead of name.
- Update `createGameState(players: PlayerInfo[], perspective: string)` accordingly.

In `src/games/innovation/game_engine.ts`:
- Every `zoneMap.get(player)` call: confirm `player` is the player ID, not name.
- Audit `extractSuspects` and any string-keyed lookups; convert to IDs.

In `src/games/innovation/turn_history.ts`:
- `TurnAction.player` and `ActionDetail.player` (strings today): confirm they will hold the player ID after this migration. Update producers in `process_log.ts` and consumers in `render.ts`.

In `src/games/innovation/serialization.ts`:
- `SerializedGameState`: serialize `players: PlayerInfo[]` and ID-keyed Maps.

In `src/games/innovation/render.ts`:
- Build a `playersById: Map<string, PlayerInfo>` once at the top of each renderer entry point.
- Per-player rendering (turn history rows, hand sections, score sections, etc.) gets `style="--player-color: #<hex>"` inline on the wrapper.

### 5. Azul: PlayerInfo plumbing only (no UI change)

In `src/games/azul/game_state.ts`:
- Add `players: PlayerInfo[]` to `AzulGameState`.
- Update `initGame()` signature, `toJSON`/`fromJSON`.
- No renderer change required — Azul's tile-count UI is not per-player today.

### 6. Crew: switch records to PlayerInfo and add color rendering

In `src/games/crew/game_state.ts`:
- `players: Record<string, string>` → `players: Record<string, PlayerInfo>`.
- `playerOrder`, `currentPlayerId`, `hands` keying remain ID-based (already correct).

In `src/games/crew/serialization.ts`:
- Round-trip `Record<string, PlayerInfo>`.

In `src/games/crew/render.ts`:
- Update `state.players[pid]` reads to `.name` where currently treated as a string.
- For each `<tr>` in the player-suit matrix and each `<th>` in the trick header, emit `style="--player-color: #<hex>"`.
- Remove the special-case `crew-matrix-me` color/bold; replace with the observer-tint rule (see step 8).

### 7. Shared helper

Add a tiny helper, exported from a new file `src/render/player.ts`:
```ts
export function playerColorAttr(player: PlayerInfo): string {
    return `style="--player-color: #${player.colorHex}"`;
}
```
Used identically by Innovation and Crew renderers. Keeps the inline-style pattern in one place.

### 8. CSS: replace hardcoded colors with `var(--player-color)` and add observer tint

The "you" affordance per user decision is **background tint** in the player's own color at low alpha.

In `src/sidepanel/sidepanel.css`:
- Replace `.turn-action.th-me { color: #f4b8b8 }` and `.turn-action.th-opp { color: #c0c0f0 }` with:
  ```css
  .turn-action { color: var(--player-color); }
  .turn-action.th-me { background: color-mix(in srgb, var(--player-color) 12%, transparent); }
  ```
  `color-mix` is supported in modern Chromium (Chrome 111+) so it's safe in the extension context. This converts the bare 6-char hex into a 12%-alpha background without us composing an `rgba()` manually.
- Strip `.turn-action.th-opp` entirely; opponent rows get their color from the base `.turn-action` rule plus the inline `--player-color`.

In `src/games/crew/styles.css`:
- Replace `.crew-matrix-me { color: #f4b8b8; font-weight: bold }` with:
  ```css
  .crew-matrix tr { color: var(--player-color); }
  .crew-matrix tr.crew-matrix-me { background: color-mix(in srgb, var(--player-color) 12%, transparent); font-weight: bold; }
  ```
- Likewise for the trick-history row headers — opponent headers already inherit `--player-color`; the observer's column/row gets the tinted background variant.

### 9. Pipeline & sidepanel pass-through

- `src/pipeline.ts`: `processGameState` Innovation branch passes `Object.values(innovationLog.players)` (now `PlayerInfo[]`) and picks `perspective` via the `isCurrent` flag, keyed by ID.
- `src/sidepanel/sidepanel.ts`: forward the `PlayerInfo[]`/`Record` to `renderSummary`/`renderTurnHistory`.

### 10. CLI scripts: reject legacy fixtures

In `scripts/game-log.ts` and `scripts/game-state.ts`, add at the top of fixture load:
```ts
const first = Object.values(rawData.players)[0];
if (typeof first === "string") throw new Error("Fixture uses legacy players shape; regenerate via fresh extraction or run the migration script.");
```

### 11. Fixture migration

Hand-patch existing JSON fixtures via a one-shot script (kept under `scripts/` and gitignored if not run regularly):
- For each fixture, rewrite `players` from `{id: name}` to `{id: {id, name, colorHex: <synth>, isCurrent: <id===currentPlayerId>}}`.
- Synthesize plausible `colorHex` values from the BGA palette: `ff0000`, `0000ff`, `008000`, `ffa500`, `aa00aa` cycled by index. Note this in a fixture-data README.

### 12. Tests

Update existing tests:
- `src/games/innovation/__tests__/render.test.ts`: replace assertions on `th-me`/`th-opp` with assertions on `--player-color` inline style; assert observer row carries `th-me` (now meaning "tinted background"), opponent rows do not.
- `src/games/innovation/__tests__/process_log.test.ts`: update `players` shape assertions.
- `src/games/innovation/__tests__/game_state.test.ts` (and any Map-keyed tests): update lookups to use IDs.
- `src/games/crew/__tests__/render.test.ts`: assert each `<tr>` in the matrix carries a distinct `--player-color`; observer `<tr>` carries `crew-matrix-me`.
- `src/games/azul/__tests__/process_log.test.ts`: update `players` shape.

Add new tests:
- `src/__tests__/extract.test.ts` (or extend existing): mock `gui.gamedatas.players[pid].color`; assert `PlayerInfo` shape including `colorHex` and `isCurrent`.
- `src/__tests__/render_player.test.ts`: unit-test the `playerColorAttr` helper.
- A 4-player Crew render smoke test asserting four distinct hex values appear inline, one per row.

### 13. Documentation

Per `CLAUDE.md` (plans that change logic must update docs):
- `docs/pages/data-flow.md`: update the "Content script" responsibilities (line ~32) to mention reading BGA player colors; update the `RawExtractionData` shape sketch (line ~118). Use the `/document-data-flow` skill.
- `docs/pages/innovation.md`: update the "Turn history" section — `you:`/`opp:` short labels are replaced by colored, BGA-named rows; observer is tinted.
- `docs/pages/crew.md`: update matrix and trick-history descriptions — opponents are color-coded by BGA assignment; observer is tinted.
- `docs/pages/azul.md`: no user-visible change; skip unless a player-related line exists.
- `README.md`: only if the per-game blurbs mention "red/blue" (a quick grep should confirm — they don't).
- `src/render/help.ts`: align in-extension help text for Innovation and Crew.

### 14. Migration order

1. Steps 1–2 (PlayerInfo type + extract.ts) — unlocks everything; nothing else needs to read the new field yet.
2. Step 6 (Crew) — pilot the CSS-variable + observer-tint pattern in the cleanest existing 3-5p UI.
3. Step 4 (Innovation) — bigger scope because of the ID-keyed Map migration; benefits from the pattern proven in Crew.
4. Step 5 (Azul) — type plumbing only; defer until last.
5. Steps 10–11 (CLI + fixtures) and 12–13 (tests + docs) — interleaved per game.

## Verification

After each game's migration:
1. `npm run lint` — must pass with zero `any`.
2. `npm test` — must pass all updated tests.
3. `npm run build` — produce `dist/`.
4. Reload the unpacked extension in Chrome and visit:
   - A live Crew 3p+ table — confirm three/four distinct row colors in the player-suit matrix and trick header; observer row has tinted background.
   - A live Innovation 2p table — confirm per-action turn-history row tinted by the actual BGA color; observer row gets background tint regardless of color.
   - A live Azul 3p+ table — confirm no UI regressions; no per-player UI yet.
5. ZIP-export from the side panel; reload the export — confirm colors round-trip.

## Critical reusable utilities

- New: `playerColorAttr(player: PlayerInfo)` in `src/render/player.ts` — single source of truth for the inline `--player-color` style.
- Reuse: existing `escapeHtml` in render utilities; existing `loadSetting`/`saveSetting` in `src/sidepanel/settings.ts` (no settings change here, but listed for awareness).
- Reuse: `playerOrder`/`currentPlayerId` plumbing already correct in Crew — model the Innovation migration on Crew's pattern.

## Out of scope

- Refactoring the Innovation Map keying *back* to names later — this plan migrates them once to IDs, full stop.
- Changing tile-color rendering in Azul or card-color (`b-blue`, `b-red`, etc.) classes in Innovation — those are game mechanics, not player colors, and remain hardcoded by design.
- Adding settings UI to override the observer-tint behavior — out of scope; tint is fixed at 12%.
