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

Persistent orchestrator. Processes raw extraction data into game state and serializes
it before sending to the *Side Panel*.

Responsibilities:
- Inject the *Content Script* into BGA game pages
- Run game-specific processing pipelines (raw packets -> game log -> game state)
- Store and serve results to the *Side Panel*
- Manage toolbar icon/badge animations
- Coordinate live tracking (watcher injection, rate-limited re-extraction)
- Handle navigation events and auto-hide logic

Key files:
- `src/background.ts` — orchestration, message handling, icon/badge, live tracking
- `src/games/*/process_log.ts` — raw BGA packets to structured game log
- `src/games/*/game_state.ts` — game log to game state, serialization

### Side Panel

Extension page. Receives `PipelineResults` (raw data, game log, and serialized game state)
from the *Background Service Worker*, renders interactive HTML in the browser side panel.

Responsibilities:
- Request and receive results from the *Background Service Worker*
- Render game-specific HTML summaries
- Manage UI state (toggles, zoom, section visibility) with localStorage persistence
- Generate self-contained ZIP downloads with inlined assets
- Maintain connection lifecycle (reconnect on service worker restart)

Key files:
- `src/sidepanel/sidepanel.ts` — UI logic, message handling, downloads, zoom, toggles
- `src/games/*/render.ts` — game-specific HTML rendering
- `src/render/help.ts` — help page content

## Data Flow: Full Extraction

Extracts game data from a BGA page, processes it through a game-specific pipeline,
and delivers the result to the *Side Panel* for rendering.

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
   - `"unsupportedGame"` — supported table but unsupported game, continue below (same extraction)
   - `"showHelp"` — not a BGA page, send `"notAGame"` to *Side Panel*
   - `"skip"` — same table already extracted (only for tab switch/navigation events, not icon clicks)
2. Determine gameName and tableNumber, lock against concurrent extractions
3. Send `"loading"` message to *Side Panel* (may be lost if panel hasn't loaded yet)
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
2. Cache result for the *Side Panel* to retrieve
3. Notify *Side Panel*
4. Inject live watcher (sets up Live Tracking)

</td>
<td valign="top">

***Background Service Worker***

1. Clear cached pipeline results
2. Cache raw data for download

</td>
</tr>
<tr>
<td valign="top">

```
⇩   "resultsReady" message
```

***Side Panel***

1. Send `"getResults"` message

</td>
<td valign="top">

```
⇩   "notAGame" message
```

***Side Panel***

1. Show help page
2. Request raw data via `"getRawData"`
3. If available, enable download button (ZIP contains only `raw_data.json`)

</td>
</tr>
<tr>
<td valign="top">

```
⇩   PipelineResults { gameName, tableNumber, rawData, gameLog, gameState }
```

***Side Panel***

1. Reconstruct live objects from serialized state:
   - Innovation: fetch `card_info.json`, call `GameState.fromJSON()`
   - Azul: call `game_state.fromJSON()`
2. Generate HTML, set up tooltips/toggles/zoom

</td>
<td></td>
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

1. Validate re-extraction guards (silently drop if any fail — the next DOM mutation will retry):
   - Sender tab matches tracked live tab
   - *Side Panel* is open
   - No extraction currently in progress
   - At least 5 seconds since last extraction
2. If all guards pass, re-run Full Extraction flow silently
3. Only notify *Side Panel* if packet count increased

## Data Flow: Side Panel Show

Each time the *Side Panel* opens it starts as a fresh page. It immediately requests
cached results while a Full Extraction may still be running in parallel (triggered by
the same icon click or navigation event that opened the panel).

This flow exists as a race condition safety net: if Full Extraction finishes before the
side panel's JS loads and registers its message listener, the `"resultsReady"` message
is lost. The on-load `"getResults"` request catches that case.

Triggers:
- User opens the side panel (via extension icon or keyboard shortcut)

---

***Side Panel***

```
⇩   "getResults" message
```

***Background Service Worker***

1. Respond with cached `PipelineResults` (a single global cache, not per-tab):
   - Results from a previous extraction — may be for a different table
   - `null` if no extraction has completed or cache was cleared by navigation

```
⇩   PipelineResults or null
```

***Side Panel***

1. If results received: render game state (same as Full Extraction step 5) — no relevance check, may briefly show results from a different table
2. If `null`: show help page

If a Full Extraction is running concurrently, its `"resultsReady"` message will
arrive later and trigger a re-render with fresh data.

## Data Flow: ZIP Download

Packages current game data and a self-contained HTML summary into a downloadable ZIP file.

Triggers:
- User clicks the download button in the *Side Panel*

---

***Side Panel***

1. Use cached `PipelineResults` from the last render
2. Generate self-contained HTML page via `render.renderFullPage()` with all assets inlined as base64 data URIs
3. Package into ZIP via JSZip:
   - `raw_data.json` — original BGA packets
   - `game_log.json` — structured log entries
   - `game_state.json` — serialized game state
   - `summary.html` — self-contained HTML
4. Download as `bgaa_<tableNumber>_<moveId>.zip`

## Message Protocol

### *Side Panel* &rarr; *Background Service Worker*

| Message | Response | Purpose |
|---------|----------|---------|
| `"getResults"` | `PipelineResults` or `null` | Fetch current game state; `null` if no extraction has completed yet |
| `"getRawData"` | `{rawData, tableNumber}` or `null` | Fetch raw data for unsupported game download; `null` if no data available |
| `"getPinMode"` | `PinMode` | Get current auto-hide mode |
| `"setPinMode"` | — | Set auto-hide mode (persisted to `chrome.storage.local`) |
| `"pauseLive"` | — | Stop live tracking |
| `"resumeLive"` | — | Re-inject watcher on active tab |

### *Background Service Worker* &rarr; *Side Panel*

| Message | Purpose |
|---------|---------|
| `"loading"` | Show loading spinner |
| `"resultsReady"` | Signal to refetch results and re-render |
| `"notAGame"` | Current tab is not a BGA game — show help |
| `"gameError"` | Extraction failed — show help with error message |
| `"liveStatus"` | Update live tracking indicator |

### *Content Script* &rarr; *Background Service Worker*

| Message | Purpose |
|---------|---------|
| `"gameLogChanged"` | DOM mutation detected — trigger live re-extraction |

## Connection Management

The *Side Panel* maintains a persistent port via `chrome.runtime.connect({name: "sidepanel"})`.
The *Background Service Worker* uses port connection/disconnection to track whether the
*Side Panel* is open.

If the service worker restarts (Chrome may terminate idle workers), the port disconnects.
The *Side Panel* retries connection every 1 second and shows a "disconnected" indicator
after 3 seconds.

## Asset Resolution

Game renderers accept an asset resolver function rather than hardcoding paths:

- **In extension**: `chrome.runtime.getURL("assets/bga/innovation/icons/hex_5.png")`
  produces `chrome-extension://<id>/assets/bga/innovation/icons/hex_5.png`
- **For ZIP export**: resolver returns relative path `"assets/bga/..."`, then
  `inlineAssets()` replaces all such references with base64 data URIs

This dual-mode resolution lets the same render code serve both live display and
self-contained HTML exports.
