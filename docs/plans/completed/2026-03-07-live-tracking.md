# Live Tracking

## Overview

Add automatic live tracking so the side panel updates as the game progresses, without requiring the user to manually re-extract. Uses a DOM MutationObserver to detect game log changes locally (zero network overhead for change detection), then triggers a full extraction only when changes are detected.

## Context

- Files involved: `src/background.ts`, `src/sidepanel/sidepanel.ts`, `sidepanel.html`, `src/sidepanel/sidepanel.css`, `src/__tests__/background.test.ts`
- Related patterns: Existing extraction pipeline (inject extract.ts -> process -> notify side panel), port-based side panel lifecycle tracking
- Dependencies: None (uses existing Chrome APIs and extraction mechanism)

## Design Notes

**MutationObserver approach**: After the initial extraction, inject a lightweight inline watcher function (ISOLATED world) that sets up a MutationObserver on BGA's game log container (`#logs`). When new log entries appear (indicating game progress), the observer sends a `gameLogChanged` message to the background after a 2-second debounce. The background then triggers a full extraction.

**Why MutationObserver, not periodic polling**: BGA updates the page DOM in real-time when the game progresses (via its Comet/WebSocket notification system). By observing the DOM directly, we detect changes instantly with zero network cost. The full extraction (which requires the BGA API call for complete notification history) only runs when we know something changed. This is strictly better than 1-second polling: faster response and zero overhead between changes.

**Why inline function, not separate file**: The watcher logic is ~15 lines. Injecting it via `executeScript({ func })` avoids creating a new file, build entry, and export-stripping step. The function is self-contained (no closures or external references), so serialization works correctly.

**Debounce and throttle**: A single game action can produce multiple rapid log entries. The watcher debounces mutations (2s after last mutation before signaling). The background also enforces a minimum 5s interval between extractions to avoid hammering the BGA API.

**Packet-count guard**: After extraction, compare the new packet count with the previous count. If unchanged (MutationObserver fired for a non-game-state DOM change like an animation), skip the re-render.

**Watcher lifecycle**: The observer lives in the page's content script context. It is destroyed on page navigation and re-established after the next successful extraction. Double-injection is guarded by a `window.__bgaWatcherActive` flag. Messages from unexpected tabs are ignored by checking `sender.tab.id`.

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add live tracking infrastructure to background.ts

**Files:**
- Modify: `src/background.ts`
- Modify: `src/__tests__/background.test.ts`

- [x] Add constants: `LIVE_MIN_INTERVAL_MS` (5000)
- [x] Add state: `liveTabId: number | null`, `lastExtractionTime: number` (0)
- [x] Define `watcherFunction()` as a named function in background.ts (serialized by `executeScript`):
  - Guard: if `(window as any).__bgaWatcherActive` is truthy, return
  - Set `(window as any).__bgaWatcherActive = true`
  - Find log container: try `document.querySelector('#logs')`, fall back to `document.querySelector('#game_play_area')`
  - If not found, reset flag and return
  - Set up MutationObserver with 2s debounce: on mutation, clear/set timeout, after 2s call `chrome.runtime.sendMessage({ type: "gameLogChanged" })`
  - Observe with `{ childList: true, subtree: true }`
- [x] Implement `injectWatcher(tabId)`:
  - Call `chrome.scripting.executeScript({ target: { tabId }, func: watcherFunction, world: 'ISOLATED' })`
  - Set `liveTabId = tabId`
  - Send `{ type: "liveStatus", active: true }` to side panel
- [x] Implement `stopLiveTracking()`:
  - Set `liveTabId = null`
  - Send `{ type: "liveStatus", active: false }` to side panel
- [x] Handle `gameLogChanged` in `onMessage` listener:
  - Check `sender.tab?.id === liveTabId`, else skip
  - If `extracting` or `!sidePanelOpen` or `liveTabId === null`, skip
  - Enforce minimum interval: if `Date.now() - lastExtractionTime < LIVE_MIN_INTERVAL_MS`, skip
  - Save previous packet count from `lastResults`
  - Call `extractFromTab(liveTabId, ...)` (set extracting=true, handle finally)
  - After extraction: if new packet count equals old count, skip sending `resultsReady`; otherwise send it
  - Update `lastExtractionTime`
  - On error: log warning, do not stop live tracking (transient failures are OK)
- [x] Call `injectWatcher(tabId)` at the end of successful `extractFromTab()` (only if `sidePanelOpen`)
- [x] Update `lastExtractionTime = Date.now()` after each successful extraction in `extractFromTab()`
- [x] Call `stopLiveTracking()` in: port disconnect handler, `handleNavigation` showHelp/error paths, click handler showHelp/error paths
- [x] Write tests: watcher injection called after successful extraction, gameLogChanged triggers extraction, gameLogChanged skipped when extracting, gameLogChanged skipped within minimum interval, packet-count guard skips resultsReady, gameLogChanged from wrong tab ignored, stopLiveTracking on panel disconnect

### Task 2: Update side panel for live tracking

**Files:**
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `sidepanel.html`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/__tests__/sidepanel.test.ts` or `src/__tests__/sidepanel_ui.test.ts`

- [x] Preserve scroll position across re-renders: save `scrollTop` of `#content` before render, restore after
- [x] Add a live indicator element to `sidepanel.html` in the top-buttons bar: `<span id="live-indicator" class="live-indicator" style="display:none"><span class="live-dot"></span> LIVE</span>`
- [x] Add CSS for the live indicator: small green pulsing dot + "LIVE" text in green, compact styling
- [x] Handle `{ type: "liveStatus", active }` messages: show/hide the live indicator
- [x] Write tests: scroll position preserved across re-renders, live indicator visibility toggled by liveStatus messages

### Task 3: Verify acceptance criteria

- [x] manual test: open side panel on an Innovation game, observe that data auto-updates when opponent makes a move
- [x] run full test suite (`npm test`)
- [x] run linter (`npm run lint`)
- [x] verify test coverage meets 80%+

### Task 4: Update documentation

- [x] update CLAUDE.md if internal patterns changed
- [x] move this plan to `docs/plans/completed/`
