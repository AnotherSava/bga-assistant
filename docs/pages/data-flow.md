---
layout: default
title: Data flow architecture
parent: Development
nav_order: 1
---

# Data Flow Architecture

This document traces how data moves between the extension's components, what
gets serialized at each boundary, and the message protocols that connect them.

## Component Overview

The extension has seven components, each running in a separate Chrome extension context
(isolated JS environment with its own globals and lifecycle). They communicate via
Chrome's message passing APIs — except the four in-page surfaces, the *In-Page Game Log*, the
*Compact Table Header*, the *Pinned Right Column* and the *Simplified Cards*, which are written to
rather than messaged (see
[In-Page Game Log](#data-flow-in-page-game-log) and
[Compact Table Header](#data-flow-compact-table-header)).
Chrome **JSON-serializes** all data crossing boundaries between contexts — no class instances,
Maps, Sets, or functions survive the trip. Game state objects must be explicitly serialized before sending and reconstructed
on the receiving side.

### Content Script

Runs in the **MAIN world** of the BGA game board. Returns raw extraction data to the
*Background Service Worker*.

BGA's modern layout serves a table at a `/tableview?table=<id>` shell page and embeds the actual
board in a same-origin **iframe** (the classic `/<gameId>/<slug>?table=<id>` page); the `gameui`
global lives only in that frame. So extraction (and the icon probe and live watcher) inject into
**all frames** of the tab — the board is whichever frame finds `gameui` loaded. Legacy direct game
URLs and replays are the special case where the board is the top frame.

The board iframe loads *after* the shell, and sub-frame loads don't fire `chrome.tabs.onUpdated`, so a
`chrome.webNavigation.onCompleted` listener (requires the `webNavigation` permission) re-runs the icon
probe for the active tab once a game-board frame finishes loading — otherwise the toolbar icon would
miss the late iframe and stay dark, most visibly while the side panel is closed. The same listener also
re-resolves the **panel content** when the board frame arrives, unless it's already resolved for that
table: the `onUpdated`-driven extraction fires when the shell completes and can give up (after its retry
window) before `gameui` exists in the iframe, which would otherwise strand an open panel on the
help/not-a-game view until the user clicked the icon.

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

### In-Page Game Log

Optional, Innovation only. Runs in the **ISOLATED world** of the board frame and renders the
turn history into BGA's own log column, in place of BGA's `#logs` list.

Unlike the *Side Panel*, it receives nothing by message: `chrome.runtime.sendMessage` reaches
extension pages only, never a content script. The *Background Service Worker* renders the HTML
itself and passes it as `chrome.scripting.executeScript` **arguments**, so the card database never
enters the BGA page — only finished rows do.

Responsibilities:
- Mount a container as a sibling of `#logs` inside `#logs_wrap` (never inside `#logs`, which the live watcher observes)
- Reconcile rows by `data-row-key` so unchanged rows keep their DOM identity across updates
- Reveal card tooltips through the popover API, escaping the clipping BGA applies to `#logs`
- Hide or restore BGA's own log via a class on the root element
- Offer in-page controls, the only way to reach these settings while the side panel is closed

Key files:
- `src/games/innovation/inpage_log.ts` — the injected mount function; self-contained, since Chrome serializes it
- `src/games/innovation/inpage_log.css` — in-page-only styling delta
- `src/sidepanel/inpage_settings.ts` — `chrome.storage.local` settings shared with the service worker

### Compact Table Header

Optional, off unless asked for, and — unlike everything else here — not limited to the supported games:
the header it folds belongs to BGA's framework and is the same on every table. Also an **ISOLATED
world** injection into the board frame, and written to rather than messaged for the same reason. It
differs from the *In-Page Game Log* in what it works on: no extraction results reach it, only the
DOM BGA already rendered.

Responsibilities:
- Move BGA's own header nodes — never copies of them — into a single row in the topbar, so BGA keeps writing to the elements it created
- Leave a placeholder at each origin, the only record of where a node belongs once the injection that moved it is gone
- Collapse BGA's status bar via a class on the root element, but only while its content is in the row instead. Collapsed — stripped of its padding and background, so an empty one measures 0px — rather than hidden, because BGA appends its own end-of-game notice (`#bga-last-turn-banner`) to that bar when a game's last turn begins, and `display: none` took the notice with it
- Freeze the bar at the top of the board as it scrolls (`position: sticky`), which also needs BGA's `#overall-content` switched from `overflow: hidden` to `clip` — `hidden` makes it a scroll container, and a sticky element sticks to its nearest scrollport rather than the viewport; `clip` clips identically without establishing one. Also suppresses the root's `overscroll-behavior-y`, since Chrome visually drags a stuck sticky element along with macOS's elastic scroll-bounce past the top of the page and springs it back — a compositor-level effect invisible to layout, so it needs its own fix independent of the sticky rule
- Let it go again once the bar grows past a fixed height ceiling, where freezing it would wall off the board instead of saving room. CSS cannot ask how tall an element is, so a `ResizeObserver` measures the bar and publishes the verdict as a root class the sticky rule keys on. The ceiling is fixed rather than learned from the bar's own history: a game whose own bulky content — a piece picker, board art — lives inside what gets folded can be tall from the very first measurement, with nothing smaller ever recorded to compare against, so a "smallest height seen so far" baseline would learn that as normal and never catch it
- Watch for Innovation's board buttons, which game setup builds after the frame reports loaded
- Refuse to collapse BGA's status bar on a game that still keeps something of its own in it — BGA's framework-level end-of-game banner excepted, since it belongs to no one game and the collapsed bar shows it
- Say a handful of known over-long prompts shorter, keyed by BGA's own game slug and matched on the exact text BGA writes, so anything unrecognised is left alone (Ark Nova's "You must choose an action card" becomes "Choose:"). A prompt long enough to wrap takes the row past the height ceiling, which un-freezes the bar for the length of the decision. BGA rewrites `#pagemaintitletext` on every state change, so a `MutationObserver` re-applies it; the observer is marked on the element rather than the root, so a rebuilt topbar gets a new one instead of a stale flag claiming it is watched, and it is parked on the node so switching the header off disconnects it outright. English-only by nature — BGA localises these, and any other language keeps the full prompt
- Pull Ark Nova's "choose a building" picker (`#pagesubtitle`) out ahead of the wrapper move, since it is nested inside the same wrapper as the prompt but is itself the permanently-oversized content the height ceiling exists to catch. Dropped after `#topbar` instead, it scrolls with the board in the normal document flow while the actual prompt still folds into the row — styled with the topbar's own background and shadow so the two read as one continuous header rather than the picker floating loose on the board, and hidden outright while the slot holds nothing — Ark Nova keeps it in the page between decisions, where its padding alone is a strip that anything below it reads as a gap under the bar

Key files:
- `src/games/innovation/compact_header.ts` — the injected mount function; self-contained, since Chrome serializes it
- `src/games/innovation/compact_header.css` — the one-row layout its DOM moves make possible
- `src/sidepanel/inpage_settings.ts` — the same `chrome.storage.local` object the in-page log uses
- `src/sidepanel/global_menu.ts` — the help page's eye menu, where the setting lives for games with no display menu of their own

### Simplified Cards

Optional, Innovation only, and off on a store build unless asked for — on by default on an unpacked
one, as the in-page log and the compact header are. The one in-page feature injected into the **MAIN
world** rather than the ISOLATED one, because it is a layout change and not only a restyle: BGA gives
every card an inline `left`/`top` it computes from `gameui.card_dimensions`, and recomputes them on
every move, splay and resize, so a card shrunk in CSS alone would keep its old slot and leave a hole.
Reaching `gameui` at all requires the page's own world. Like the compact header, it consumes no
extraction results for the cards BGA already draws — only the DOM and game object BGA built. Its one
sub-feature that does is the opponents' hands, below, where BGA draws nothing to restyle.

Responsibilities:
- Patch the three constants Innovation derives card layout from — `card_dimensions["M card"]`, `delta.my_hand` and `overlap_for_splay["M card"]` — then call BGA's own `refreshLayout()` and let its zone engine re-place every card. Splay direction, the echo-effect visibility rules and the pile-width clamping keep working, none of it reimplemented
- Stash BGA's originals on the game object on the first enabling injection only, so a repeated one cannot park the already-patched values and leave nothing able to restore them
- Publish the wanted state as a root attribute rather than closing over it, because the zones are built during Innovation's setup and a toggle can arrive before there is anything to lay out. The retry loop reads the attribute back each tick, so switching off while the board still loads is not overtaken by the retry that was started to switch it on
- Restyle the card interior from CSS, reusing the name, age and most icons BGA already drew as children of every card — so no card database and no BGA-id-to-card mapping enters the page. The six resource icons are the one exception (below): their image is swapped, but still keyed off BGA's own `color_N`/`icon_N` classes, so nothing about our card model crosses into the page
- Swap BGA's six resource tiles — crown, leaf, lightbulb, castle, factory, clock (`icon_1`..`icon_6`) — for the extension's own PNGs. BGA's sprite draws each as three layers: an outer card-colour frame ring, a resource-colour chip, then the glyph — plus a 1px white frame that at this display size is ~0.13px, too thin to survive scaling, so at a non-integer zoom it breaks into a stray white edge on one side. The extension's PNGs have BOTH frames removed, leaving just the resource-colour chip and glyph: one flat shape per resource that reads at the smallest sizes and carries no card-colour ring to clash with the card (the card shows its own colour via its background and border). Because the icon no longer varies by card colour, there is one file per resource, keyed by `icon_N` alone (nothing about our card model crosses over). Only the corners are rounded to match BGA's tiles (radius pre-divided by the 0.5556 icon transform). The PNGs load by `chrome-extension://` URL — BGA's `img-src` allows the scheme, unlike `font-src` — their base spliced into the stylesheet as `__BGAA_ICONS__` when it is assembled. The illustrated hex, city-special and bonus icons keep BGA's own rendering
- Use two layouts, since a fully visible card and one showing a single strip want different things. The top card of a pile — and every hand card, which is never stacked — reproduces the side panel's layout spot for spot, age in the bottom-right corner included. A covered card takes the real card's geometry instead, which is the panel's with the age and the right-hand icons swapped, so that every icon a splay is meant to reveal lands inside the strip it reveals: left gives `spot_4` (and `spot_5` on a Cities card), right gives `spot_1`/`spot_2`, up gives the bottom row
- Stamp `data-bgaa-top` on each pile's top card and select covered cards as everything else, scoped to the board containers (a hand is a grid whose cards are all fully visible). The top card cannot be found in CSS: a DOM-order test like `:has(~ .card.M)` reads the wrong thing, because BGA appends each new node to the container while keeping the stack in a separate `items` array — so a tuck, a card melded to the *bottom*, arrives last in the DOM while lying at the bottom of the pile. `items` is the authority; BGA's own splay code calls `i == items.length - 1` the top card. Re-stamped whenever a card enters or leaves a pile, which the same observer that restores the card names already sees
- Leave the age to fall out of that geometry rather than ruling on it. At 46→68 on a covered card it is outside both the strip a left splay reveals (70 onward) and the one a right splay reveals (up to 24), so it hides itself on either, while an up splay reveals the whole bottom row and carries it along. This is why nothing here reads the splay direction: BGA publishes it only as a class on a separate `splay_indicator_*` element that no selector reaches from a card, and the layout makes needing it moot
- Size the board and own-hand card at 94×46 rather than the panel's 92×45 — 2px wider and 1px taller — so the icon columns sit 2px apart (not 1px) and the rows likewise, which lets the revealed splay strip give the next icon a full 2px of room instead of butting against it. Only the boards splay, but BGA sizes every "M card" from one `card_dimensions` entry, so the own hand shares the larger size; the opponents' hands and the panel/ZIP keep 92×45 (`CARD` vs `CARD_BOARD` in simplified_cards.ts). The reveal band grows from 22 to 24 — equal to `--col-centre`, so the overlapping card's edge lands exactly on the next icon column, giving the revealed icon the same 2px margin it has from the card's own border
- Scope the shrink to your own hand and the boards, and restore BGA's card size for the other zones that share the patched `"M card"` size key — the artifact display, revealed cards and the expanded score/forecast views
- Scale everything from one multiplier, which the size slider sets between 100% and 200%. The layout constants handed to BGA and every length in the stylesheet derive from the same base numbers, the latter through `calc()` on a `--bgaa-card-scale` custom property published on the root, so the card and the splay strips grow together and the geometry above holds at any size. A store build starts the slider at 100%; a local build starts at 150%, so the cards are legible while being worked on — the same local-vs-store split the on-by-default features use
- Rewrite the card names from `gameui.cards`, where the original capitalisation survives — BGA uppercases a name into the markup (`_(card_data.name).toUpperCase()`), so no stylesheet can undo it and `text-transform` could only ever produce sentence case. Applied through BGA's own `_()` first, so a translated table keeps its translated names, and reverted to uppercase when the feature is switched off. A `MutationObserver` on the two zone kinds catches the cards BGA rebuilds as they move, coalesced to a frame; the pass writes only where the text differs, so it cannot retrigger its own observer
- Carry the panel's two fonts inlined as `data:` URIs. BGA's `font-src` lists its own hosts, a few font CDNs and `data:`, but no extension scheme, so a `chrome-extension://` font is refused by the page no matter that the extension injected the stylesheet — the cards silently fall back to a system font. Both are read from the packaged files at injection time and cached for the worker's lifetime, keeping ~38KB of base64 out of the bundle. The stylesheet's two icon marks — the search magnifier and the one standing in for an Echo card's effect text — are inline SVG needing no substitution
- Offer the Echo effect as text instead of the mark, through a second root class the stylesheet keys on. BGA already writes the effect into the card and this only ever hid it, so the setting is a display choice rather than anything to fetch or rebuild
- Neutralise `background-position` wherever a BGA icon's image is replaced. BGA offsets each icon box into its own sprite sheet per colour, so a replacement image left with that offset is pushed clean out of a 36px box: loaded, correctly sized, and invisible

Its one sub-feature that consumes results rather than only the DOM is the **opponents' hands**, which
BGA draws face-down and empty. Those are filled in with what the tracker has deduced — the panel's own
card, rendered by the service worker and pushed as markup, exactly as the *In-Page Game Log* is — so
this is the second surface for which `hasConsumer()` reports a tab worth extracting for.

Responsibilities (opponents' hands):
- Resize only the opponent-hand zones, by replacing each one's `itemIdToCoordsGrid`. `card_dimensions["S recto"]` is shared between the hands, all fifty deck piles, both achievement rows, the relics and every forecast and score back, so it cannot move — and the zone's own `item_width`/`item_height` are not an alternative, because Innovation does not use the framework's placement: `setPlacementRules` installs its own function on every zone, and that one reports each card's box straight from the shared `card_dimensions[HTML_class]`. Replacing it per zone — which is what Innovation itself does to a board pile when it splays — is the only lever that reaches one zone kind alone. Everything but the size stays BGA's: the step and the row count come from `delta[location]` and `num_cards_in_row[location]`
- Report the true painted size from that function, because BGA sizes the hand's container from it: `setPattern("grid")` leaves `autoheight` on, and `updateDisplay` takes the tallest `y + h` it was told. Reporting BGA's 47px while painting a card half again as tall left the hand overflowing its box — the visible symptom of the placement override being missed
- Match knowledge to cards by (age, set), the two things BGA states on a face-down card as `age_N` and `type_N`, and never card by card: the model holds a multiset of possibilities per group rather than an identity per card, so any assignment within a group says the same thing. Both sides are sorted — the DOM by the synthetic id BGA mints once per card and keeps across every reparenting — so the assignment is stable between pushes
- Take fewer hints than cards as normal rather than an error: a card nothing is known about contributes none, and one just drawn is not in the model until the next extraction. Those keep BGA's own back
- Write only on a difference, since the pass runs from the same `MutationObserver` that watches these cards; and sweep wrappers off cards that have left a hand, which BGA reparents rather than rebuilds
- Reveal the candidate list, or a known card's face, as a popover — the top layer being the one place a tip cannot be clipped by BGA's board — with hover delegated per container, since the cards themselves come and go

Key files:
- `src/games/innovation/simplified_cards.ts` — the injected patch and the separate, cheaper hint push; self-contained, since Chrome serializes them
- `src/games/innovation/simplified_cards.css` — the card interior, rebuilt at panel scale, and the opponent-hand slot
- `src/games/innovation/mini_card.css` — the panel's own card, shared with the page and scoped so it cannot reach BGA's `.card` elements
- `src/sidepanel/inpage_settings.ts` — the same `chrome.storage.local` object the in-page log uses
- `src/games/innovation/display.ts` — the Innovation eye menu, where the setting lives

### Pinned Right Column

Optional, for every game BGA hosts rather than the supported ones alone, and an **ISOLATED world**
injection into the board frame like the compact header — which it also sits under, though the two are
switched independently. It keeps the top of BGA's right column in place while the board scrolls past.

Two modes, and the page already says which applies: `bgaa-hide-bga-log` is on the root exactly while
the turn history is the column's content, since the *In-Page Game Log* puts it there to hide BGA's own
log. With it, the whole column is pinned — panels, history and the view switch — capped to the window
and scrollable inside itself. Without it, the player panels alone are pinned and BGA's log column
scrolls away as BGA intended.

Both modes are `position: sticky` rules keyed on that class, so the switch needs no injection of its
own. What does is what CSS cannot ask for: the height of the bar the pinned block sits under, whether
the panels are too tall to pin at all, and the backdrop of the page behind them.

Responsibilities:
- Publish where the pinned block sits as `--bgaa-sticky-top`: the frozen bar's height, plus the 5px top margin BGA gives the column. The margin is what makes the bar's height alone wrong — a block pinned at exactly that height starts the page 5px below where it will stick, so it visibly nudges up as soon as the page moves. Pinning it where it already sits removes the movement and keeps BGA's own separation. Taken from the column's computed margin rather than from the distance between the two boxes, which cannot be read back once the block is stuck: that measurement returns the stuck position and collapses the gap to nothing
- Take the bar's contribution from `#topbar`'s computed `position`, so a bar that scrolls away (BGA's own, or a folded one past the compact header's height ceiling) contributes nothing — neither its height nor the gap, there being nothing left up there to keep separation from — and the block pins at the very top instead. Read from the page rather than from our own settings, since the compact header owns that decision and can change it mid-game. One offset serves both modes: the pinned column takes it directly, and the panels inside that column take zero, the column standing at it having already accounted for it
- Give up on panels taller than half of what the viewport has left under the bar, as a root class their rule keys on. A share of the viewport rather than a pixel ceiling, unlike the compact header's: a panel stack is as tall as the table has players. Read by the panels-alone mode only — the pinned column is capped to the window and scrolls internally, so height can put nothing there out of reach
- Re-measure on a `ResizeObserver` over the panels and the bar, and on window resize — panels grow with their owner's board and BGA collapses them on click, the folded bar changes height with the prompt in it, and neither element resizes when only the window's height changes
- Copy the page's own background onto the pinned panels, read from the root element and then `body` — whichever paints something, since which of the two carries BGA's table felt is a theme's choice, and a custom stylesheet is free to move it. BGA leaves the gaps between panels transparent, which goes unnoticed until the block is pinned and a log starts travelling behind it
- Do nothing at all in BGA's narrow-window layout, without detecting it: that layout stacks the two columns (`flex-direction: column-reverse`), leaving the column's parent no taller than its own content and the sticky rules with nowhere to travel, and it hides the log column outright

The pinned-column mode also has to override BGA's own layout in one place, in CSS: `#right-side` is a
stretched flex item, as tall as the board beside it and therefore with nowhere to travel, so
`align-self: flex-start` shrinks it to its content. Safe only in that mode, where BGA's log — the one
thing in the column BGA sizes against the height being given up — is hidden.

Key files:
- `src/games/innovation/sticky_panels.ts` — the injected mount function; self-contained, since Chrome serializes it
- `src/games/innovation/sticky_panels.css` — the sticky rules for both modes, and the panels' backdrop
- `src/sidepanel/inpage_settings.ts` — the same `chrome.storage.local` object the in-page log uses
- `src/sidepanel/global_menu.ts` — the help page's eye menu, alongside the compact header's own setting

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

1. Gate on `background.isPotentialTablePage()` — a BGA URL carrying a `table=` id. This covers the classic `/<gameId>/<slug>?table=` board URL and the modern `/tableview?table=` shell that embeds the board in an iframe. It excludes the classic `/table?table=` page — the board-less pre-game lobby (which redirects to `/tableview`) — so that resolves to help immediately instead of flashing a spinner and burning extraction retries. If it isn't a potential table page, send `"notAGame"` to the *Side Panel* (help page) and stop.
2. Read the table number from the URL's `table=` param — the slug-less `/tableview` shell URL still carries it. Lock against concurrent extractions.
3. Send `"loading"` message to *Side Panel*
4. Inject `dist/extract.js` into **all frames** of the tab (MAIN world). Retry a few times to let the board iframe finish loading. The game slug isn't knowable from the shell URL, so it comes from the resolved board frame's data (next), not the tab URL.

```
⇩   (no data passed to Content Script)
```

***Content Script***

1. Read player info (id, name, BGA color hex, observer flag) and current hand contents from `gameui.gamedatas` (frames that aren't the board — the shell and loader frames — return `{ notGame: true }` instead, which the background skips silently; a frame that *has* `gameui` but fails returns `{ error, msg }`, which surfaces as an error rather than the help page)
2. Fetch full notification history via `gameui.ajaxcall()`
3. Extract game name from this frame's URL pathname
4. Package results as `RawExtractionData`

```
⇩   RawExtractionData (auto-serialized by Chrome):
⇩   { gameName, players: Record<id, PlayerInfo>, gamedatas: {my_hand, cards}, packets: RawPacket[], currentPlayerId }
⇩   PlayerInfo: { id, name, colorHex (BGA hex, no `#`), isCurrent }
```

***Background Service Worker*** — picks the successful (non-`error`) frame result as the board's `RawExtractionData`; the game slug it reports decides the branch. (No board frame after the retries — the iframe never loaded, or it isn't a game — falls back to `"notAGame"` / the help page.) Branches on whether that game is supported:

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

1. Observe DOM mutations on `#logs` / `#game_play_area` via `MutationObserver` (injected into all frames; self-bails where no log container exists, so only the board frame observes)
2. Wait for changes to settle (2000ms quiet period) before notifying

```
⇩   "gameLogChanged" message
```

***Background Service Worker***

1. Validate re-extraction guards:
   - Sender tab matches tracked live tab
   - A consumer exists — `background.hasConsumer()`, i.e. the *Side Panel* is open, **or** the *In-Page Game Log* is enabled, **or** the *Simplified Cards* are on with their opponents' hands: the three surfaces that consume results
   - No extraction currently in progress
   - At least 5 seconds since last extraction
2. If rate-limited (less than 5s since last extraction): schedule a deferred
   re-extraction after the remaining time. Only one deferred timer is active at
   a time; subsequent mutations within the same window are coalesced.
3. If all guards pass, re-run Full Extraction flow silently (clear any deferred timer)
4. Only push results if packet count increased — to the *Side Panel* by message, and to the *In-Page Game Log* and the opponents' hands by injection, through the one `background.pushResultSurfaces()` that keeps the two in step

## Data Flow: In-Page Game Log

Renders Innovation turn history into BGA's log column. Runs whenever results are produced and the
feature is enabled — including with the side panel closed, which is its purpose.

Triggers:
- `chrome.webNavigation.onCommitted` for an Innovation board frame — hides BGA's log early (below)
- Extraction completes (full or live)
- `bgaa_inpage_log` changes in `chrome.storage.local` (either surface's toggles)
- `chrome.webNavigation.onCompleted` reports the board frame finished loading
- An in-page control sends `setInPageLog`

### Hiding BGA's log before it paints

Extraction has to fetch and process the whole notification history before it can render anything,
so waiting for the mount would show BGA's log and swap it out a second later — a visible flash. The
hide therefore runs at frame-commit, independently of results.

***Background Service Worker***

1. On `webNavigation.onCommitted`, bail unless the feature is enabled, the tab is not currently
   switched to BGA's log, and `time-tracking.parseGameTableUrl()` reports an Innovation board frame
2. Inject `EARLY_HIDE_CSS` and `background.hideBgaLogEarlyFunction` into that frame alone

Because this hides before knowing whether a render will succeed, `background.pushInPageLog()`
**unmounts** rather than bailing when it has no Innovation game log — otherwise BGA's log would stay
hidden with nothing in its place and no control to bring it back.

---

***Background Service Worker***

1. Bail unless the feature is enabled, the game is Innovation, and a game log exists — otherwise unmount
2. Narrow the action list to the window via `turn_history.recentTurns()`, using this tab's override or the `INPAGE_LOG_HALF_TURNS` constant
3. Compare the windowed length against the full action list to decide `hasMore`, which drives the "more..." control
4. Render keyed rows via `render.renderTurnHistoryRows()` with `newestFirst`, `popoverTips`, `rowKeys` and `timeOnly`; wrapped in try/catch, since the renderer throws on an unknown player id
5. Await the stylesheet, then push the rows. The two injections are independent promises, so an un-awaited `insertCSS()` lets the DOM land first and render unstyled. The injection promise is cached per tab (not a boolean) so a second push cannot overtake the first one's CSS, and it is dropped on navigation — injected CSS does not survive a new document

```
⇩   executeScript arguments (JSON-serialized, not a message):
⇩   [ Array<{ key, html }>, { enabled, collapsed, showPlayerNames, halfTurns, hasMore } ]
```

***In-Page Game Log***

1. Locate `#logs_wrap`; return silently if absent — non-board frames and any future BGA restructuring
2. Mount `#bgaa-inpage-log` before `#logs` if not already present and connected; re-mount when BGA has rebuilt the column
3. Toggle `bgaa-hide-bga-log` on the root element — exactly one log shows at a time. A class, never an inline style on `#logs`: BGA's own `#seemorelogs` handler writes inline `maxHeight` there
4. Reconcile rows by `data-row-key`: reuse matching nodes, replace those whose content changed, drop the rest, preserving scroll position
5. Attach delegated `pointerover` / `pointerout` listeners once. On hover, `showPopover()` promotes the tip to the top layer, then it is positioned from JS in viewport coordinates — CSS anchor positioning drives the side panel's tips but does not resolve reliably for a top-layer element nested inside its own anchor
6. Render the view switch as an inline bulb glyph coloured by CSS — lit while the turn history is up, unlit while BGA's log is — with the action named via `title` / `aria-label`, since the icon alone cannot say which way it goes. Clicking flips `collapsed`, never `enabled`: disabling the feature from here would remove the only control able to bring the turn history back

```
⇩   "setInPageLog" message (only when the user uses an in-page control)
⇩   { patch: { collapsed?, halfTurns? } }
```

***Background Service Worker***

1. Apply `collapsed` / `halfTurns` to this tab's session state and push again; persist anything else

### Session overrides vs stored defaults

The two in-page controls are deliberately absent from the stored settings. `collapsed` (the bulb)
and `halfTurns` (the "more..." control) are held per-tab in the service worker and never written to
storage, so switching to BGA's log or widening the history lasts for that table rather than becoming
a new preference. `background.forgetInPageTab()` clears them — together with both cached
stylesheet injections — from `tabs.onUpdated` at navigation start, `webNavigation.onCompleted`, and
`tabs.onRemoved`. That is what makes the stored setting the default re-applied whenever a table
opens, and losing the state to a service-worker eviction is harmless for the same reason.

Clearing all three collections through one helper is deliberate: the stylesheet cache was once
cleared on only one navigation path, which left the log rendering unstyled on the way back into a
table.

### Settings storage

Every one of these ships off. The four that touch BGA's own page — the in-page log, the compact
header, the pinned panels and the simplified cards — are the exception on an **unpacked build**, where they default on
— `isUnpackedBuild()` compares `chrome.runtime.id` against the published id, so they are live while
being worked on without a switch after every extension reload, and reach store users only if they
ask for them.

The in-page settings live in `chrome.storage.local` under `bgaa_inpage_log`
(`{ enabled, showPlayerNames, compactHeader, progressionOnly, stickyPanels, simplifiedCards, cardScale, echoText, opponentHands }`), not in the `localStorage` used by every other
display preference. Three contexts need them and `localStorage` cannot serve all three: the service
worker has none at all, and a content script's belongs to `boardgamearena.com` rather than the
extension. The key is still named for the log alone, which was the first of these settings:
renaming it would silently drop what every existing user has already chosen. The panel's
own "Show player names" toggle mirrors its value into this object so a single checkbox drives both
surfaces. The starting window is the `INPAGE_LOG_HALF_TURNS` constant rather than a stored field,
so widening can never become the new starting point.

## Data Flow: Compact Table Header

Optional, for every game BGA hosts rather than the supported ones alone. Also an
ISOLATED-world injection into the board frame, but otherwise unlike the in-page log: it consumes no
extraction results, only the DOM BGA already rendered. It folds BGA's status bar and Innovation's "Look at all cards in piles" button up
into the topbar, so the table info, the current prompt and its action buttons share one bar instead
of three. The table id / move / progression stack is left as BGA renders it — it already fits the
topbar's height.

***Background Service Worker***

1. On `webNavigation.onCompleted`, bail unless the feature is on and `time-tracking.parseGameTableUrl()`
   reports a board frame — any game's, since the header is the framework's. This runs ahead of both
   gates the rest of that handler applies: no consumer is needed, and a table in a background tab is
   folded like the one in front
2. `background.pushCompactHeader()` awaits the stylesheet, then injects the mount function into all
   frames. The undo path skips the stylesheet: the mount removes the root class every rule hangs off

```
⇩   executeScript arguments (JSON-serialized, not a message):
⇩   [ { enabled, progressionOnly } ]
```

***Compact Table Header***

1. Return silently unless the frame carries a `bgagame-<slug>` wrapper — every frame of the tab
   receives the injection, and only a game board should be rearranged. The `/tableview` shell and the
   loader frame carry no such marker
2. On Ark Nova, move `#pagesubtitle` — its "choose a building" picker — out from inside
   `#pagemaintitle_wrap` to right after `#topbar`, ahead of the wrapper move below. Left in place, an
   800px+ tray of hex icons would ride into the row with the rest of the prompt, becoming exactly the
   kind of permanently-oversized content the height ceiling exists to catch; pulled out first, it
   scrolls with the board in the normal document flow while the actual prompt still folds as usual
3. Move `#pagemaintitle_wrap` and `#gameaction_status_wrap` into a row in the topbar's middle
   column, leaving a hidden placeholder at each origin. BGA's nodes are **moved, not copied**, so
   everything BGA writes by id — the prompt, the action buttons in `#generalactions`, the move
   counter — keeps updating in their new home. Both title wrappers move because BGA swaps between
   them by flipping their `display`
4. Move `#change_view_full_button` to the far left instead, between `#site-logo` and `#tableinfos`.
   Its label is collapsed and an eye drawn in its place by CSS rather than by markup: Innovation's
   `toggle_view` rewrites the button's innerHTML on every click, so anything put inside it from here
   would survive exactly one click
5. Move `#gotonexttable_wrap` to the head of `#upperrightmenu`. The whole wrapper moves: BGA keeps a
   labelled button and a bare arrow in there and shows whichever suits the state — and the label is
   not always short, since it becomes "N tables are waiting…" once your turn ends, which is why this
   sits on the right where the strip can widen rather than in the left corner beside the table info.
   It arrives inside `#pagemaintitle_wrap`, so this runs after the row is filled and takes it back out
6. Toggle `bgaa-compact-header` on the root element — and `bgaa-progression-only` alongside it when
   asked for, never on its own, since a bare figure in the corner of BGA's untouched header would
   read as a stray number — under two conditions: the prompt is genuinely in
   the row (collapsing a status bar that can no longer be filled would leave the page with no prompt
   at all), and `#page-title` holds nothing but the wrappers moved out of it and their placeholders —
   a game nobody here has looked at may keep a control down there. BGA's own `#bga-last-turn-banner`
   is exempt from that second condition: the framework adds it mid-game, with nothing to re-run this
   decision afterwards, so counting it would cost the compact header to anyone reloading during a
   last turn
7. Stamp the game's slug on the root as `data-bgaa-game`, which is what per-game CSS keys on. Games
   write their own art into BGA's title bar — Ark Nova's break cup, card icons — sized for the 62px
   bar this replaces, and no shared rule can anticipate each of them
8. Watch for `#change_view_full_button` when it does not exist yet: Innovation builds its board
   buttons during setup, which runs after the frame reports loaded. The observer retires once the
   button is placed, when a later injection turns the feature off, or on a timeout

Turning the feature off re-injects with `enabled: false`, which moves every node back to its
placeholder and drops the class. The placeholders are the whole restore path — an injection carries
no memory of the DOM an earlier one changed.

## Data Flow: Pinned Right Column

Optional, for every game BGA hosts, and pushed off the same event as the compact header for the same
reasons — no extraction results reach it either. It pins the whole right column while the turn history
is the column's content, and BGA's player panels alone otherwise. Both the pinning and the choice
between them are CSS; what crosses this boundary is the injection that measures what those rules stick
to.

***Background Service Worker***

1. On `webNavigation.onCompleted`, bail unless the feature is on and `time-tracking.parseGameTableUrl()`
   reports a board frame. Runs after the compact header is pushed, so the bar whose height this
   measures has folded by the time it is read — and a bar that folds later resizes, which the mount
   watches for anyway
2. `background.pushStickyPanels()` awaits the stylesheet, then injects the mount function into all
   frames. The stylesheet must land first, or the panels pin for a frame against the custom
   properties' fallback of zero, under a bar still covering them

```
⇩   executeScript arguments (JSON-serialized, not a message):
⇩   [ { enabled } ]
```

***Pinned Right Column***

1. Return silently unless the frame has a `#right-side-first-part` — every frame of the tab receives
   the injection, and only a board frame has a right column
2. Add `bgaa-sticky-panels` to the root, which is what every sticky rule keys on. Which mode applies
   is decided from there by `bgaa-hide-bga-log`, which the *In-Page Game Log* already maintains — so
   switching between the two logs switches what is pinned, with nothing to re-inject
3. Copy the page's backdrop onto the root as `--bgaa-panels-backdrop-image` and
   `--bgaa-panels-backdrop-color`, taken from the root element or from `body`, whichever paints
   something. Once per injection: a theme is chosen between page loads, unlike the measurements
4. Measure and publish `--bgaa-sticky-top` — the height of `#topbar` plus the column's own top margin,
   or zero unless the bar's computed `position` is `sticky` — and toggle `bgaa-panels-tall` when the
   panels are past the ceiling, the one thing that turns the panels-alone rule off
5. Re-measure from a `ResizeObserver` over the panels and the bar, and from a window `resize`
   listener for the viewport height that no element's size reflects. Both are guarded by a root
   attribute so overlapping injections leave one of each, and both read the root class back on every
   callback and stand down once it is gone — an injection cannot reach the observers of an earlier one

Turning the feature off re-injects with `enabled: false`, which drops the class and every published
property; the observers retire themselves on their next callback.

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

1. Query the active tab and read its table number via `background.tableNumberFromUrl()`
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

## Data Flow: Time Tracking

Tracks how long game table pages are open and in focus. Works across all BGA games,
not only supported ones.

### Session lifecycle

***Background Service Worker***

1. On every focus-changing event (`tabs.onActivated`, `tabs.onUpdated` URL change,
   `tabs.onRemoved`, `windows.onFocusChanged`), call `timeTracker.handleFocusChange(url)`
2. `SessionTracker` parses the URL via `parseGameTableUrl()`:
   - If it's a game table URL different from the active session: end the current session, start a new one
   - If it's the same table: no-op
   - If null or non-game URL: end the current session
3. Completed sessions are written to `chrome.storage.local` as compact tuples `[gameId, tableId, from, to]`
4. A game-name map (`gameId → gameName`) is maintained alongside sessions

The open session additionally carries `lastSeen` (last confirmed-active timestamp) and `idleSince` (start of the current idle stretch, or `null` when active); both are dropped when the session is finalized to the `[slug, tableId, from, to]` tuple.

### Idle, heartbeat, and recovery

Focus events alone can't catch the cases where *no* event fires: the user walks away with the game tab still focused, the screen locks, the machine sleeps, or the browser is killed before it can write the session end. `chrome.idle` plus a `chrome.alarms` heartbeat close those gaps. Tuning constants live in `time-tracking.ts` (`IDLE_DETECTION_SECONDS`, `IDLE_GRACE_MS`, `HEARTBEAT_MS`, `STALE_SESSION_MS`).

- **Idle onset** (`chrome.idle.onStateChanged` → `"idle"`/`"locked"`, after `IDLE_DETECTION_SECONDS` of no input): `timeTracker.markAway()` records `idleSince` but does **not** end the session, and a one-shot `IDLE_FINALIZE_ALARM` is armed for `IDLE_GRACE_MS` later. First idle wins, so the recorded onset isn't pushed forward.
- **Return to activity** (`"active"`): the finalize alarm is cancelled, then the focused tab is re-applied via `handleFocusChange` (reading the focused window's active tab; if no Chrome window holds focus, nothing is resumed). This one path covers both cases — if the session survived (returned within grace) the same table is a no-op continuation with no break; if the grace already finalized it during the away period, a fresh session starts. So a long absence yields two separate sessions, not one stretched across the gap.
- **Grace elapsed while still idle** (`IDLE_FINALIZE_ALARM` fires): `finalizeIdle()` ends the session at `idleSince`, so the detection interval counts as play but the grace wait does not. (Leaving via a focus change while idle ends it at `idleSince` too.)
- **Heartbeat** (`HEARTBEAT_ALARM`, every `HEARTBEAT_MS` while a session is open and the user is active): `touch()` advances `lastSeen` so an abrupt shutdown can be bounded. `syncHeartbeatAlarm()` creates the alarm only while a session is active and clears it otherwise, so the service worker isn't woken when nothing is being tracked.
- **Crash/quit recovery** (service-worker startup): `recoverStaleSession()` runs first. A session that was idle past the grace is closed at `idleSince`; one whose `lastSeen` is older than `STALE_SESSION_MS` is closed at `lastSeen`; a session still fresh (normal short SW restart) or idle-within-grace is left running. The startup re-apply of the focused tab is then **skipped when a session survived recovery** — otherwise the ~60s heartbeat-driven SW wake/restart cycle would re-run `handleFocusChange` and keep clearing `idleSince`, so a walk-away would never finalize. The re-apply is **also gated on `chrome.idle.queryState()` being `"active"`**: the SW cold-restarts repeatedly while the user is away, and `onStateChanged` won't replay the already-past idle transition to a fresh instance — so a session started blindly at startup would never learn it's idle and would be finalized as a 0-length stale session on the next restart, looping once per restart. Querying the live idle state starts a session only when the user is genuinely present; the `"active"` transition on their return starts it otherwise. This keeps a single session from ballooning across the entire time the browser was shut.
- **Zero-length guard**: `appendSession` drops any session whose end is not strictly after its start. The recovery rules above make this rare, but it cleanly absorbs residual races (open-then-immediately-leave, or a startup/crash that finalizes at the same instant it began) so history never accrues meaningless 0-duration rows.

### Storage architecture (two tiers)

| Tier | Key(s) | Written when | Purpose |
|------|---------|--------------|---------|
| `chrome.storage.local` | `bgaa_time_sessions`, `bgaa_time_games`, `bgaa_time_modes` (real-time), `bgaa_time_types` (tournament/arena/regular) | Every session end / on classification / on stats-page deletion | Primary durable store |
| BGA page `localStorage` | `bgaa_time_sessions` (the CSV export string) | On backup (throttled) | Cross-reinstall backup |

### BGA localStorage backup/restore

Triggered when navigating to any BGA page, throttled to once per 5 minutes. Backup/restore reuse the
CSV export/import, so the backup carries everything export does — sessions, game names, real-time modes,
and table types — through one serialization path.

- **Restore** (once per SW lifetime): if `chrome.storage.local` is empty, read the backup string from
  BGA page localStorage and `importSessionsCsv()` it. Handles the fresh-install-after-reinstall case.
- **Backup**: write `exportSessionsCsv()` to BGA page localStorage via `chrome.scripting.executeScript`
  (MAIN world).

### CSV export / import

***Side Panel***

1. User clicks Export
2. `exportSessionsCsv()` reads sessions, game map, real-time modes, and table types from `chrome.storage.local`
3. Produces CSV with columns: `game, game_id, table_id, from, to, minutes, realtime, type`. `game` is the display name and `game_id` the URL slug (both stored so the round-trip is lossless); `realtime` (`1`/`0`/empty) and `type` (`tournament`/`arena`/`regular`/empty) are per-table classifications. All are inlined on every session row.
4. Downloads as `bgaa_playtime_YYYY-MM-DD.csv`

`importSessionsCsv()` reads columns by header name (`game`, `game_id`, `table_id`, `from`, `to` required; `realtime`/`type` optional), merges sessions (dedup by start timestamp), and restores the session slug, the slug→name map, and each table's `realtime` mode and `type` (first value wins, so live data isn't clobbered). Export→import reproduces the stored data exactly.

### Session deletion

***Side Panel*** — each finished row in the Sessions / Tables stats view exposes an X on hover (the in-progress row has none, since the live tracker would re-append it). After a `window.confirm`, the side panel calls:

- `deleteSession(from)` — drops the single session whose start timestamp matches (the same key used for import dedup).
- `deleteTableSessions(tableId)` — drops every session for the table and prunes that table's now-orphaned `bgaa_time_modes` / `bgaa_time_types` entries.

Both rewrite `bgaa_time_sessions` in `chrome.storage.local`; the `storage.onChanged` listener re-renders the stats page.

Key files:
- `src/time-tracking.ts` — types, URL parser, SessionTracker class (focus + idle/liveness lifecycle), idle/heartbeat tuning constants, sync logic, export

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

### *In-Page Game Log* &rarr; *Background Service Worker*

| Message | Payload | Purpose |
|---------|---------|---------|
| `"setInPageLog"` | `{ patch: Partial<InPageSettings> }` | Apply a change from an in-page control ("more...", or the two-way view switch) |

### *Background Service Worker* &rarr; *In-Page Game Log*

Not messages — the service worker injects the mount function and passes data as arguments.

| Channel | Payload | Purpose |
|---------|---------|---------|
| `chrome.scripting.executeScript` | `[rows, opts]` | Render or unmount the in-page log (`opts.enabled: false` unmounts and restores BGA's log; `opts.collapsed` switches which log is shown) |
| `chrome.scripting.insertCSS` | concatenated stylesheet | Inject styling, once per tab per service-worker lifetime |

### *Background Service Worker* &rarr; *Compact Table Header*

| Channel | Payload | Purpose |
|---------|---------|---------|
| `chrome.scripting.executeScript` | `[{ enabled, progressionOnly }]` | Fold BGA's header into one row, or (`enabled: false`) move every node back to its placeholder; `progressionOnly` pares the table info down to the percentage |
| `chrome.scripting.insertCSS` | `compact_header.css` | Inject the one-row layout, once per tab per service-worker lifetime |

### *Background Service Worker* &rarr; *Pinned Right Column*

| Channel | Payload | Purpose |
|---------|---------|---------|
| `chrome.scripting.executeScript` | `[{ enabled }]` | Measure what the sticky rules stick to and publish it on the root, or (`enabled: false`) drop it and the class every rule hangs off |
| `chrome.scripting.insertCSS` | `sticky_panels.css` | Inject the sticky rules for both modes, once per tab per service-worker lifetime |

### *Background Service Worker* &rarr; *Simplified Cards*

| Channel | Payload | Purpose |
|---------|---------|---------|
| `chrome.scripting.executeScript` (MAIN world) | `[{ enabled, scale, echoText, opponentHands }]` | Patch Innovation's card-layout constants and re-run BGA's own relayout, or (`enabled: false`) put BGA's numbers back. `opponentHands` also resizes the opponent-hand zones and parks the applier the push below calls |
| `chrome.scripting.executeScript` (MAIN world) | `[HandHintGroup[]]` | The opponents' hands as finished markup, grouped by player, age and BGA's set id, run-length collapsed since a group's cards usually share their knowledge. Its own push, on every move: the mount ends by handing the board back to BGA to lay out, which animates every card, and this only writes into them |
| `chrome.scripting.insertCSS` | concatenated stylesheet (`mini_card` + `card_tip` + `simplified_cards`) | Inject the compact card, once per tab per service-worker lifetime — the panel's own card and the tooltip geometry ride along, since the opponents' hands are drawn with the panel's renderer. Its fonts are substituted in as `data:` URIs first — BGA's CSP allows `data:` for `font-src` but no extension scheme, so a font at a `chrome-extension://` URL is refused by the page however the stylesheet got there |

## Connection Management

The *Side Panel* maintains a persistent port via `chrome.runtime.connect({name: "sidepanel"})`.
The *Background Service Worker* uses port connection/disconnection to track whether the
*Side Panel* is open.

Port disconnection no longer stops live tracking unconditionally: if the *In-Page Game Log* is still
enabled, or the *Simplified Cards* are drawing the opponents' hands, tracking continues, because both
consume the same results with the panel closed. Every gate that previously read `sidePanelOpen`
directly — live re-extraction, watcher injection, and the four navigation handlers — now reads
`background.hasConsumer()`.

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
| User switches to a different Chrome window | `chrome.windows.onFocusChanged` | `handleNavigation` with source `"focus"` — queries the active tab in the focused window. Fires for the window gaining focus, regardless of whether the side panel is open there. Also ends any active time tracking session on `WINDOW_ID_NONE` (all windows lost focus). | Silent update (no loading indicator); shows current game or help |
| User closes a game tab | `chrome.tabs.onRemoved` | Ends the active time tracking session if the closed tab was the tracked tab | No side panel effect |
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
| Side panel closes | Port `onDisconnect` | Sets `sidePanelOpen = false`; stops live tracking only when `background.hasConsumer()` is now false | N/A (panel gone) |
| In-page log settings change | `chrome.storage.onChanged` for `bgaa_inpage_log` | Updates the cached settings, then mounts or unmounts the *In-Page Game Log* in the active tab. The *Compact Table Header* and *Simplified Cards* go to every open BGA tab instead — they are page state, and a table in a background tab or another window would otherwise keep the old setting until it reloaded. The active tab is always included, so the page being looked at updates even if the tab query fails | None |
| Board frame commits | `chrome.webNavigation.onCommitted` | Hides BGA's log in that frame before it paints, so the in-page log does not flash BGA's list first | None |
| Board iframe finishes loading | `chrome.webNavigation.onCompleted` | Re-attributes the play-time session, re-lights the icon, re-resolves panel content, and re-pushes the in-page log — the frame's DOM is new even when cached results still match the table | Content re-resolved unless already correct for this table |

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
