# Game table time tracking

## Overview

Track how long the user spends with BGA game table pages open and in focus. Each session records a game ID, table ID, and from/to timestamps. This covers all games on BGA, not only the ones the extension supports with dedicated trackers. Data persists across extension reinstalls via BGA page-origin localStorage, with a JSON export as a manual backup.

## Context

- Files involved:
  - Create: `src/time-tracking.ts` — session tracker, types, chrome.storage.local helpers
  - Modify: `manifest.json` — add `"storage"` permission
  - Modify: `src/background.ts` — instantiate tracker, hook into tab/window events, add tab close listener
  - Modify: `sidepanel.html` — add export button
  - Modify: `src/sidepanel/sidepanel.ts` — wire export button, trigger BGA-sync on load
- Related patterns: `classifyNavigation()` in background.ts already parses BGA game URLs; `loadSetting`/`saveSetting` in settings.ts for localStorage patterns; `chrome.scripting.executeScript` with `world: "MAIN"` used by extraction
- Dependencies: `"storage"` permission added to manifest

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Storage architecture — two tiers.** `chrome.storage.local` is the primary durable store, written on every session end. BGA page-origin localStorage is a cross-reinstall backup synced opportunistically when any BGA page is visited. On fresh install, the first BGA visit restores data from page-origin storage into `chrome.storage.local`. A JSON export button provides a manual safety net.

**Session lifecycle — fire-and-forget.** Pending sessions live only in the service worker's memory. On session end (tab switch, tab close, window blur, navigation away), the completed record is written to `chrome.storage.local` and the in-memory state is cleared. On SW restart or browser crash, any in-progress session is silently lost — we do not attempt recovery because an unclosed session has no reliable `to` timestamp.

**Compact internal format.** Each session is stored as a 4-element tuple `[gameId, tableId, from, to]` (all numbers). A separate small `gameId → gameName` map is maintained alongside, updated when new games are encountered. Game names appear only in the exported JSON, not in session records.

**URL parsing — game ID extraction.** BGA game table URLs follow `boardgamearena.com/<gameId>/<gameSlug>?table=<tableId>`. The existing `BGA_URL_PATTERN` regex matches this but does not capture the numeric game ID. A new `parseGameTableUrl()` function will capture all three parts (gameId, gameSlug, tableId) for any game, independent of the supported-games list.

**Event coverage.** The tracker receives a "focus changed" signal from background.ts's existing listeners:

| Event | What happens |
|---|---|
| `tabs.onActivated` | Switched to a different tab — end old session, maybe start new |
| `tabs.onUpdated` (url change) | SPA navigation or page load — same tab changed URL |
| `tabs.onRemoved` | Tab closed — end session if it was the tracked tab |
| `windows.onFocusChanged` | Window focus — end old, start new if BGA game tab |
| `windows.onFocusChanged(NONE)` | All Chrome windows lost focus — end session |

**SW idle kill.** If Chrome kills the service worker during an idle period on a game tab, that session is lost. This is acceptable — the side panel port keeps the SW alive during active use, and idle-tab sessions have low information value. No `chrome.alarms` heartbeat.

**Sync merge strategy.** Both stores hold a flat array of session tuples. On sync, the two arrays are unioned and deduplicated by `from` timestamp (each session has a unique start time, since only one tab can be focused at once). The merged result is written back to both stores.

**Storage key names.** `chrome.storage.local` key: `bgaa_time_sessions` (session array) and `bgaa_time_games` (gameId→name map). BGA page localStorage key: `bgaa_time_sessions` (combined sessions + game map object).

## Implementation Steps

### Task 1: URL parser and data types

**Files:**
- Create: `src/time-tracking.ts`

- [ ] Define `TimeSession` type as `[gameId: number, tableId: number, from: number, to: number]`
- [ ] Define `GameMap` type as `Record<number, string>` (gameId → gameName)
- [ ] Define storage key constants (`STORAGE_KEY_SESSIONS`, `STORAGE_KEY_GAMES`, `BGA_STORAGE_KEY`)
- [ ] Implement `parseGameTableUrl(url: string): { gameId: number, gameName: string, tableId: number } | null` — extract all three parts from any BGA game table URL using the existing URL shape
- [ ] Write tests for `parseGameTableUrl`: valid game URLs, missing table param, non-BGA URLs, subdomain URLs, edge cases
- [ ] Run project test suite — must pass before next task

### Task 2: Session tracker and chrome.storage.local persistence

**Files:**
- Modify: `src/time-tracking.ts`
- Modify: `manifest.json`

- [ ] Add `"storage"` to `permissions` in manifest.json
- [ ] Implement `SessionTracker` class:
  - In-memory `activeSession: { gameId, tableId, from } | null`
  - `handleFocusChange(url: string | null)`: if URL is a game table, start session (end previous first); if not, end session. Writes completed session to `chrome.storage.local` and updates the game map
  - `readSessions(): Promise<TimeSession[]>` — read from `chrome.storage.local`
  - Internal `writeSessions(sessions: TimeSession[]): Promise<void>` — write to `chrome.storage.local`
  - `handleFocusChange` is the only public mutation method — background.ts calls it from every relevant event
- [ ] Write tests: session start/end lifecycle, rapid tab switching, same-table re-focus (no duplicate), game map population, SW restart (no pending session = no orphan)
- [ ] Run project test suite — must pass before next task

### Task 3: Integrate tracker into background.ts

**Files:**
- Modify: `src/background.ts`

- [ ] Import and instantiate `SessionTracker` at module level
- [ ] In `tabs.onActivated` handler: after existing logic, call `tracker.handleFocusChange(tab.url)` with the resolved tab URL
- [ ] In `tabs.onUpdated` handler: on URL changes for the active tab, call `tracker.handleFocusChange(changeInfo.url ?? tab.url)`
- [ ] Add `chrome.tabs.onRemoved` listener: if the removed tab was the active session's tab, call `tracker.handleFocusChange(null)`
- [ ] In `windows.onFocusChanged` handler: call `tracker.handleFocusChange(tab.url)` after resolving the active tab; for `WINDOW_ID_NONE`, call `tracker.handleFocusChange(null)`
- [ ] Write/update tests: mock chrome events → verify tracker receives correct URLs, verify session records are written on tab switch, tab close, window blur
- [ ] Run project test suite — must pass before next task

### Task 4: BGA page localStorage sync

**Files:**
- Modify: `src/time-tracking.ts`
- Modify: `src/background.ts`

- [ ] Implement `syncToBga(tabId: number)` in time-tracking.ts: uses `chrome.scripting.executeScript` with `world: "MAIN"` to inject a function that reads `localStorage.getItem('bgaa_time_sessions')` from the BGA page, returns the parsed data
- [ ] Implement merge logic: union both session arrays, deduplicate by `from` timestamp, write merged result to both `chrome.storage.local` and BGA page localStorage (second executeScript call)
- [ ] Implement `restoreFromBga(tabId: number)`: on fresh install (empty `chrome.storage.local`), read from BGA page localStorage and populate `chrome.storage.local`
- [ ] In background.ts: after any successful navigation to a BGA page (any page, not just game tables), trigger sync. Use a throttle (e.g. once per 5 minutes) to avoid excessive injection
- [ ] Write tests: sync merge with overlapping sessions, sync with empty extension storage (restore path), sync with empty BGA storage (initial population), dedup correctness
- [ ] Run project test suite — must pass before next task

### Task 5: JSON export

**Files:**
- Modify: `sidepanel.html`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/time-tracking.ts`

- [ ] Add `exportSessions()` function in time-tracking.ts: reads sessions and game map from `chrome.storage.local`, produces a JSON blob with human-readable format: `{ version: 1, exported: ISO-date, sessions: [{ gameId, gameName, tableId, from, to }, ...] }` — game name resolved from the game map, falling back to `"unknown"` for unmapped IDs
- [ ] Add export button to sidepanel.html toolbar (next to the download button), with a clock/timer icon and "Export play time" tooltip
- [ ] Wire the button in sidepanel.ts: on click, call `exportSessions()` and trigger a `downloadBlob` with filename `bgaa_playtime_YYYY-MM-DD.json`
- [ ] The export button is always enabled (not game-dependent) — play time data exists regardless of current page
- [ ] Write tests: export format correctness, game name resolution from map, empty sessions export
- [ ] Run project test suite — must pass before next task

### Task 6: Verify acceptance criteria

- [ ] Manual test: open a BGA game table, switch tabs, switch back — verify sessions appear in `chrome.storage.local` via DevTools
- [ ] Manual test: visit a non-supported game table — verify session is still tracked
- [ ] Manual test: close a game tab — verify session ends cleanly
- [ ] Manual test: export JSON — verify file contains correct session data with game names
- [ ] Manual test: clear extension storage, visit BGA — verify sessions restored from page localStorage
- [ ] Run full test suite: `npm test`
- [ ] Run linter: `npm run lint`

### Task 7: Update documentation

- [ ] Update `docs/pages/data-flow.md` with time tracking data flow (via `/document-data-flow`)
- [ ] Update `CLAUDE.md` project structure section with new file
- [ ] Move this plan to `docs/plans/completed/`
