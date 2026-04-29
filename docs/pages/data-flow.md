---
layout: default
title: Data Flow Architecture
---

[Home](..) | [Innovation](innovation) | [Azul](azul) | [Crew](crew) | [Development](development) | [Privacy](privacy)

---

# Data Flow Architecture

This document traces how data moves between the extension's components, what
gets serialized at each boundary, and the message protocols that connect them.

## Component Overview

The extension has three components, each running in a separate Chrome extension context
(isolated JS environment with its own globals and lifecycle). They communicate via
Chrome's message passing APIs.
Chrome **JSON-serializes** all data crossing boundaries between contexts — no class instances,
Maps, Sets, or functions survive the trip. Game state objects must be explicitly serialized before sending and reconstructed
on the receiving side.

### Content Script

Runs in the **MAIN world** of the BGA game page. Returns raw extraction data to the
*Background Service Worker*.

Must be fully self-contained — injected via `chrome.scripting.executeScript()`, so any
references to module-level code are undefined after Chrome serializes the function.

Responsibilities:
- Read player info (id, name, BGA-assigned color, observer flag) and initial hand from `gameui.*` globals
- Fetch full notification history via BGA's API
- Extract game name from page URL pathname
- Package results as `RawExtractionData`

Key files:
- `src/extract.ts` — data extraction from BGA page globals and API

### Background Service Worker

Persistent orchestrator. Processes raw extraction data into game state and pushes
results to the *Side Panel*.

Responsibilities:
- Inject the *Content Script* into BGA game pages
- Run game-specific processing pipelines (raw packets -> game log -> game state)
- Push results to the *Side Panel* (no request/response — push-only model)
- Manage toolbar icon/badge animations
- Coordinate live tracking (watcher injection, rate-limited re-extraction with deferred catch-up)
- Handle navigation events and auto-hide logic

Key files:
- `src/background.ts` — orchestration, message handling, icon/badge, live tracking
- `src/pipeline.ts` — pure pipeline logic (`processGameLog`, `processGameState`, `runPipeline`); shared by background.ts and CLI scripts (`scripts/game-log.ts`, `scripts/game-state.ts`)
- `src/games/*/process_log.ts` — raw BGA packets to structured game log
- `src/games/*/game_state.ts` — game log to game state, serialization

### Side Panel

Extension page. Receives `PipelineResults` (raw data, game log, and serialized game state)
pushed from the *Background Service Worker*, renders interactive HTML in the browser side panel.

Responsibilities:
- Receive pushed results from the *Background Service Worker* and render game-specific HTML summaries
- Manage UI state (toggles, zoom, section visibility) with localStorage persistence
- Generate self-contained ZIP downloads with inlined assets
- Maintain connection lifecycle (reconnect on service worker restart)

Key files:
- `src/sidepanel/sidepanel.ts` — UI logic, message handling, downloads, zoom, toggles
- `src/games/*/render.ts` — game-specific HTML rendering
- `src/games/*/display.ts` — per-game display menu construction and display-option application (section visibility, shimmer)
- `src/render/help.ts` — help page content
- `src/sidepanel/settings.ts` — shared localStorage persistence (loadSetting/saveSetting with typed defaults)
- `src/render/toggle.ts` — shared toggle logic (used by both side panel and ZIP export); tooltips are CSS-only via anchor positioning

## Data Flow: Full Extraction

Extracts game data from a BGA page, processes it through a game-specific pipeline,
and delivers the result to the *Side Panel* for rendering. Both supported and
unsupported games follow the same flow — the difference is whether the pipeline
processes the data or passes it through as raw-only.

Triggers:
- User clicks the extension icon
- User presses the keyboard shortcut (`toggle-sidepanel`)
- User switches to a tab with a BGA game table
- Page finishes loading on a BGA game URL
- Window focus changes to a window with a BGA game tab

---

***Background Service Worker***

1. Classify the current tab URL via `background.classifyNavigation()`:
   - `"extract"` — supported game, continue below
   - `"unsupportedGame"` — BGA game table but unsupported game, continue below
   - `"showHelp"` — not a BGA game page, send `"notAGame"` to *Side Panel*
2. Determine gameName and tableNumber, lock against concurrent extractions
3. Send `"loading"` message to *Side Panel* (supported games only)
4. Inject `dist/extract.js` into the BGA page

```
⇩   (no data passed to Content Script)
```

***Content Script***

1. Read player info (id, name, BGA color hex, observer flag) and current hand contents from `gameui.gamedatas`
2. Fetch full notification history via `gameui.ajaxcall()`
3. Extract game name from page URL pathname
4. Package results as `RawExtractionData`

```
⇩   RawExtractionData (auto-serialized by Chrome):
⇩   { gameName, players: Record<id, PlayerInfo>, gamedatas: {my_hand, cards}, packets: RawPacket[], currentPlayerId }
⇩   PlayerInfo: { id, name, colorHex (BGA hex, no `#`), isCurrent }
```

***Background Service Worker*** — branches here based on classification:

<table>
<tr>
<th>Supported game (<code>"extract"</code>)</th>
<th>Unsupported game (<code>"unsupportedGame"</code>)</th>
</tr>
<tr>
<td valign="top">

***Background Service Worker***

1. Validate player count via `pipeline.isValidPlayerCount()` — reject unsupported configurations (e.g. 2-player Crew)
2. Transform raw data via `pipeline.runPipeline()`:
   - Innovation: `process_log.processRawLog()` &rarr; `GameState.processLog()` &rarr; `GameState.toJSON()`
   - Azul: `process_log.processAzulLog()` &rarr; `game_state.processLog()` &rarr; `game_state.toJSON()`
   - Crew: `process_log.processCrewLog()` &rarr; `game_engine.processCrewState()` &rarr; `serialization.crewToJSON()`
3. If the pipeline throws, cache a fallback `PipelineResults` with `rawData` only (`gameLog` and `gameState` are `null`) so the *Side Panel* can still offer a raw data download
4. Cache `PipelineResults` (with `gameLog` and `gameState`)
5. Push results to *Side Panel*
6. Inject live watcher (sets up Live Tracking)

</td>
<td valign="top">

***Background Service Worker***

1. Cache `PipelineResults` with `rawData` only (`gameLog` and `gameState` are `null`)
2. Push results to *Side Panel*

</td>
</tr>
<tr>
<td valign="top">

```
⇩   "resultsReady" message with PipelineResults payload:
⇩   { gameName, tableNumber, rawData, gameLog, gameState }
```

***Side Panel***

1. Reconstruct live objects from serialized state:
   - Innovation: fetch `card_info.json`, call `GameState.fromJSON()`
   - Azul: call `game_state.fromJSON()`
   - Crew: call `serialization.crewFromJSON()`
2. Generate HTML, set up toggles/zoom, apply per-game display options (tooltips are CSS-driven via anchor positioning)

</td>
<td valign="top">

```
⇩   "resultsReady" message with PipelineResults payload:
⇩   { gameName, tableNumber, rawData, gameLog: null, gameState: null }
```

***Side Panel***

1. Detect `gameState` is `null` — show help page
2. Enable download button (ZIP contains only `raw_data.json`)

</td>
</tr>
</table>

## Data Flow: Live Tracking

Keeps the *Side Panel* in sync as the game progresses by detecting DOM changes
and re-running the extraction pipeline. Initiated by the watcher injection in
[Full Extraction](#data-flow-full-extraction) step 4.

---

***Content Script*** (watcher)

1. Observe DOM mutations on `#logs` / `#game_play_area` via `MutationObserver`
2. Wait for changes to settle (2000ms quiet period) before notifying

```
⇩   "gameLogChanged" message
```

***Background Service Worker***

1. Validate re-extraction guards:
   - Sender tab matches tracked live tab
   - *Side Panel* is open
   - No extraction currently in progress
   - At least 5 seconds since last extraction
2. If rate-limited (less than 5s since last extraction): schedule a deferred
   re-extraction after the remaining time. Only one deferred timer is active at
   a time; subsequent mutations within the same window are coalesced.
3. If all guards pass, re-run Full Extraction flow silently (clear any deferred timer)
4. Only push results to *Side Panel* if packet count increased

## Data Flow: Side Panel Connect

When the *Side Panel* opens (or reconnects after a service worker restart), the
*Background Service Worker* pushes any cached results immediately. This eliminates
request/response round trips — the side panel never polls for data.

Triggers:
- User opens the side panel (via extension icon or keyboard shortcut)
- Service worker restarts while the side panel is open

---

***Side Panel***

1. Start in help page state by default
2. Load persisted pin mode from localStorage and push to background via `setPinMode`
3. Establish port via `chrome.runtime.connect({name: "sidepanel"})`

```
⇩   Port connection event
```

***Background Service Worker***

1. Query the active tab and classify its URL via `background.classifyNavigation()`
2. Compare the active tab's table number against `lastResults?.tableNumber`:
   - **Same table**: push cached `"resultsReady"` immediately (no loading flash)
   - **Different table** (user navigated while panel was closed): run `background.resolveContent()` with `source: "reopen"` — shows `"loading"`, then extracts fresh results
   - **No cached results** (service worker restart): run `background.resolveContent()` with `source: "reconnect"` — no `"loading"` to avoid flashing during the idle shutdown cycle

```
⇩   "resultsReady" message with PipelineResults payload (cached or freshly extracted)
```

***Side Panel***

1. Compare incoming results against `currentResults` (by `tableNumber` and packet count) —
   skip render if identical (see [Service worker shutdown cycle](#service-worker-shutdown-cycle))
2. If results received with `gameState`: render game page
3. If results received without `gameState`: show help page with download enabled
4. If no results: remain on help page until a Full Extraction completes

## Data Flow: ZIP Download

Packages current game data and a self-contained HTML summary into a downloadable ZIP file.

Triggers:
- User clicks the download button in the *Side Panel*

---

***Side Panel***

1. Use cached `PipelineResults` from the last render
2. For supported games: generate self-contained HTML page via `render.renderFullPage()` with all assets inlined as base64 data URIs
3. Package into ZIP via JSZip:
   - `raw_data.json` — original BGA packets
   - `game_log.json` — structured log entries (supported games only)
   - `game_state.json` — serialized game state (supported games only)
   - `summary.html` — self-contained HTML (supported games only)
4. For unsupported games: ZIP contains only `raw_data.json`
5. Download as `bgaa_<tableNumber>_<moveId>.zip`

## Message Protocol

### *Side Panel* &rarr; *Background Service Worker*

| Message | Response | Purpose |
|---------|----------|---------|
| `"setPinMode"` | `true` | Set auto-hide mode (background keeps in-memory copy; sidepanel persists via localStorage) |
| `"pauseLive"` | — | Stop live tracking |
| `"resumeLive"` | — | Re-inject watcher on active tab |

### *Background Service Worker* &rarr; *Side Panel*

| Message | Payload | Purpose |
|---------|---------|---------|
| `"loading"` | — | Show loading spinner |
| `"resultsReady"` | `{ results: PipelineResults }` | Push extraction results for rendering |
| `"notAGame"` | — | Current tab is not a BGA game page — show help |
| `"gameError"` | `{ error: string, results?: PipelineResults }` | Pipeline failed — show help with error message; if `results` is present (raw data preserved from failed pipeline), enable download button |
| `"liveStatus"` | `{ active: boolean }` | Update live tracking indicator |

### *Content Script* &rarr; *Background Service Worker*

| Message | Purpose |
|---------|---------|
| `"gameLogChanged"` | DOM mutation detected — trigger live re-extraction |

## Connection Management

The *Side Panel* maintains a persistent port via `chrome.runtime.connect({name: "sidepanel"})`.
The *Background Service Worker* uses port connection/disconnection to track whether the
*Side Panel* is open.

On port connect, the *Background Service Worker* queries the active tab and compares
its table number against cached results. If they match, cached results are pushed
immediately (see [Side Panel Connect](#data-flow-side-panel-connect)). If they differ
(user navigated to a different table while the panel was closed) or no results are cached
(e.g. after a service worker restart), a fresh extraction runs with a `"loading"` indicator.

### Service worker shutdown cycle

Chrome terminates idle service workers after ~30 seconds of inactivity. When this
happens while the *Side Panel* is open, a reconnect cycle occurs:

1. Service worker shuts down — the port disconnects
2. *Side Panel* schedules a "disconnected" indicator after 3 seconds
3. *Side Panel* retries `chrome.runtime.connect()` after 1 second
4. Reconnection wakes the service worker — `onConnect` fires
5. *Background Service Worker* pushes cached `lastResults` via `"resultsReady"`

This cycle repeats every ~30 seconds during idle periods. Two mechanisms prevent
unnecessary re-renders and loading flicker:

**Cached results on same-table reconnect:** On port connect, the *Background Service Worker* checks whether the active tab matches cached `lastResults` by table number. During the idle shutdown cycle the tab hasn't changed, so cached results are pushed directly without re-extraction or loading indicator. Only when the tab has changed (e.g. user navigated while the panel was closed) does a full re-extraction run with `"loading"`.

**Deduplication guard:** the *Side Panel* compares incoming `"resultsReady"` against
`currentResults` by `tableNumber` and `rawData.packets.length`. If both match, the
render is skipped. This is the same comparison the *Background Service Worker* uses
in Live Tracking to decide whether to push updates (only when packet count increases).

The `"loading"` message clears `currentResults`, ensuring that intentional re-extractions
(e.g. page reload) always render even if the data hasn't changed — the dedup guard only
suppresses redundant renders from the idle shutdown cycle.

## Event Catalog

This section describes every external event that can affect the side panel, how
the background service worker detects it, and what it does in response.

There are two main handlers in the background service worker:

- **`togglePanel`** — handles icon clicks and keyboard shortcuts. Opens/closes
  the panel and runs the initial extraction with badge animation.
- **`handleNavigation`** — handles all subsequent navigation events (tab switch,
  page load, SPA navigation, window focus). Classifies the active tab's URL via
  `resolveContent` and pushes the appropriate message to the side panel. When an
  extraction is already in progress, the tab ID is saved as `pendingNavTabId` and
  processed when the current extraction finishes. Also checks auto-hide pin mode
  and closes the panel when applicable.

### User actions

| Event | Chrome API | Handler | Side panel effect |
|-------|-----------|---------|-------------------|
| Click extension icon / keyboard shortcut | `chrome.action.onClicked`, `chrome.commands.onCommand` | `togglePanel` — if panel is open, close it; otherwise open panel, extract, push results. Sets `extracting` before opening so the `onConnect` handler (which fires when the panel's JS loads) skips its own extraction, avoiding a race. | Full extraction with badge animation; shows loading then results or help |
| User reloads the game page | `chrome.tabs.onUpdated` with `status: "complete"` | `handleNavigation` with source `"navigation"` — re-extracts from the reloaded page | Fresh extraction; loading shown if table changed, otherwise silent update |
| User navigates to a different page in the same tab | `chrome.tabs.onUpdated` — two detection modes: (1) full page load fires `status: "complete"`; (2) SPA navigation (BGA uses `pushState`) fires with `url` change but no `status` field. Both reach the same `handleNavigation` call. | `handleNavigation` — classifies the new URL and resolves content | Shows new game, help page, or auto-closes depending on URL and pin mode |
| User switches to a different tab | `chrome.tabs.onActivated` | `handleNavigation` with source `"navigation"` — extracts from the newly active tab | Shows the new tab's game, help page, or auto-closes |
| User switches to a different Chrome window | `chrome.windows.onFocusChanged` | `handleNavigation` with source `"focus"` — queries the active tab in the focused window. Fires for the window gaining focus, regardless of whether the side panel is open there. | Silent update (no loading indicator); shows current game or help |
| User clicks help button in side panel | Side panel DOM event | Toggles between help page and game summary; sends `"pauseLive"` / `"resumeLive"` to background | Swaps view; live tracking paused while on help |

### Game state changes

| Event | Chrome API | Handler | Side panel effect |
|-------|-----------|---------|-------------------|
| Game move happens (opponent or self) | `"gameLogChanged"` message from watcher's `MutationObserver` on `#logs` / `#game_play_area` (2s debounce) | `triggerLiveExtraction` — rate-limited (5s minimum interval), deferred if too soon, skipped if panel closed or extraction in progress | Re-renders only if packet count increased; silent (no loading indicator) |

### Extension lifecycle

These events use the `onConnect` handler, which is the same code path that fires
when `togglePanel` opens the panel. The race is avoided by the `extracting` flag:
`togglePanel` sets it before opening, so when `onConnect` fires it sees the flag
and skips its own extraction.

| Event | Chrome API | Handler | Side panel effect |
|-------|-----------|---------|-------------------|
| Service worker restarts | Port disconnect detected by side panel; reconnects after 1s via `chrome.runtime.connect` | `onConnect` handler — pushes cached results if same table, otherwise re-extracts with source `"reconnect"` | No loading indicator; dedup guard skips render if data unchanged. Disconnected indicator shown after 3s if reconnect hasn't completed |
| Side panel closes | Port `onDisconnect` | Sets `sidePanelOpen = false`, stops live tracking | N/A (panel gone) |

### Filtering and deduplication

Not all events lead to a visible update. Several guards prevent unnecessary work:

- **`extracting` flag**: only one extraction runs at a time; concurrent navigation events are queued via `pendingNavTabId` (last writer wins)
- **`tab.status !== "complete"` check**: `handleNavigation` breaks early if the tab is still loading (waits for the subsequent `status: "complete"` event)
- **`shouldShowLoading` filter**: only `"click"`, `"navigation"`, and `"reopen"` sources show the loading indicator; `"focus"`, `"reconnect"`, and `"live"` sources update silently
- **Same-table loading suppression**: even for sources that show loading, the `"loading"` message is only sent when the table number differs from cached results
- **Packet count dedup**: live tracking only pushes results when `packets.length` increases; the side panel independently skips re-renders when both `tableNumber` and `packets.length` match `currentResults`
- **Auto-hide**: `handleNavigation` checks `shouldAutoClose(url, pinMode)` before extracting — if the pin mode requires it, the panel is closed and no extraction runs

## Asset Resolution

Game renderers accept an asset resolver function rather than hardcoding paths:

- **In extension**: `chrome.runtime.getURL("assets/bga/innovation/icons/hex_5.png")`
  produces `chrome-extension://<id>/assets/bga/innovation/icons/hex_5.png`
- **For ZIP export**: resolver returns relative path `"assets/bga/..."`, then
  `inlineAssets()` replaces all such references with base64 data URIs

This dual-mode resolution lets the same render code serve both live display and
self-contained HTML exports.
