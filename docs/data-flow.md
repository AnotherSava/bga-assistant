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
- Read player names and initial hand from `gameui.*` globals
- Fetch full notification history via BGA's API
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
- `src/render/help.ts` — help page content
- `src/render/toggle.ts` — shared toggle/tooltip logic (used by both side panel and ZIP export)

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

1. Read player names and current hand contents from `gameui.gamedatas`
2. Fetch full notification history via `gameui.ajaxcall()`
3. Package results as `RawExtractionData`

```
⇩   RawExtractionData (auto-serialized by Chrome):
⇩   { players, gamedatas: {my_hand, cards}, packets: RawPacket[], currentPlayerId }
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

1. Transform raw data via `background.runPipeline()`:
   - Innovation: `process_log.processRawLog()` &rarr; `GameState.processLog()` &rarr; `GameState.toJSON()`
   - Azul: `process_log.processAzulLog()` &rarr; `game_state.processLog()` &rarr; `game_state.toJSON()`
2. Cache `PipelineResults` (with `gameLog` and `gameState`)
3. Push results to *Side Panel*
4. Inject live watcher (sets up Live Tracking)

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
2. Generate HTML, set up tooltips/toggles/zoom

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
2. Establish port via `chrome.runtime.connect({name: "sidepanel"})`

```
⇩   Port connection event
```

***Background Service Worker***

1. If cached `lastResults` exists: push `"resultsReady"` with the cached `PipelineResults` payload
2. If `lastResults` is `null` (e.g. after service worker restart): query the active tab
   and run `background.resolveContent()` to extract fresh results — the `"loading"` message
   is suppressed for reconnect extractions to avoid flashing over existing content

```
⇩   "resultsReady" message with PipelineResults payload (if available)
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
| `"getPinMode"` | `PinMode` | Get current auto-hide mode |
| `"setPinMode"` | — | Set auto-hide mode (persisted to `chrome.storage.local`) |
| `"pauseLive"` | — | Stop live tracking |
| `"resumeLive"` | — | Re-inject watcher on active tab |

### *Background Service Worker* &rarr; *Side Panel*

| Message | Payload | Purpose |
|---------|---------|---------|
| `"loading"` | — | Show loading spinner |
| `"resultsReady"` | `{ results: PipelineResults }` | Push extraction results for rendering |
| `"notAGame"` | — | Current tab is not a BGA game page — show help |
| `"gameError"` | `{ error: string }` | Extraction failed — show help with error message |
| `"liveStatus"` | `{ active: boolean }` | Update live tracking indicator |

### *Content Script* &rarr; *Background Service Worker*

| Message | Purpose |
|---------|---------|
| `"gameLogChanged"` | DOM mutation detected — trigger live re-extraction |

## Connection Management

The *Side Panel* maintains a persistent port via `chrome.runtime.connect({name: "sidepanel"})`.
The *Background Service Worker* uses port connection/disconnection to track whether the
*Side Panel* is open.

On port connect, the *Background Service Worker* immediately pushes any cached results
(see [Side Panel Connect](#data-flow-side-panel-connect)). If no results are cached
(e.g. after a service worker restart), it queries the active tab and triggers extraction
so the side panel receives fresh data without needing to request it.

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

**Suppressed `"loading"` on reconnect:** when `background.resolveContent()` is called
with source `"reconnect"`, the `"loading"` message is skipped. This prevents flashing
"Loading game data..." over existing content while re-extraction runs silently.

**Deduplication guard:** the *Side Panel* compares incoming `"resultsReady"` against
`currentResults` by `tableNumber` and `rawData.packets.length`. If both match, the
render is skipped. This is the same comparison the *Background Service Worker* uses
in Live Tracking to decide whether to push updates (only when packet count increases).

The `"loading"` message clears `currentResults`, ensuring that intentional re-extractions
(e.g. page reload) always render even if the data hasn't changed — the dedup guard only
suppresses redundant renders from the idle shutdown cycle.

## Asset Resolution

Game renderers accept an asset resolver function rather than hardcoding paths:

- **In extension**: `chrome.runtime.getURL("assets/bga/innovation/icons/hex_5.png")`
  produces `chrome-extension://<id>/assets/bga/innovation/icons/hex_5.png`
- **For ZIP export**: resolver returns relative path `"assets/bga/..."`, then
  `inlineAssets()` replaces all such references with base64 data URIs

This dual-mode resolution lets the same render code serve both live display and
self-contained HTML exports.
