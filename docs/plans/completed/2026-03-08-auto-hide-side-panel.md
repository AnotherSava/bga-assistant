# Auto-hide Side Panel

## Overview

Add a three-mode pin toggle that controls whether the side panel auto-closes when navigating away from game pages. Currently the panel stays open on all tabs, showing help on non-game pages. This adds two auto-hide modes that close the panel automatically, reducing clutter when browsing non-game content. A keyboard shortcut toggles the panel open/closed.

## Context

- Files involved:
  - Modify: `src/background.ts` — add auto-close logic in navigation handlers, persist pin mode, toggle shortcut, icon swap
  - Modify: `src/sidepanel/sidepanel.ts` — pin button with dropdown, send mode changes to background
  - Modify: `src/sidepanel/sidepanel.css` — pin button and dropdown styles
  - Modify: `sidepanel.html` — add pin button between eye and ? buttons
  - Modify: `manifest.json` — add `commands` entry for keyboard shortcut
  - Create: `assets/extension/icon-16-lit.png`, `icon-48-lit.png`, `icon-128-lit.png` — lit lightbulb icons
  - Modify: `src/__tests__/background.test.ts` — tests for auto-close logic
  - Modify: `src/__tests__/sidepanel_ui.test.ts` — tests for pin button UI
- Related patterns: section-selector dropdown (eye button), `chrome.storage.local` for persistence
- Dependencies: none

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Three pin modes:**
1. **Pinned** — panel always stays open; non-game tabs show help page (current behavior)
2. **Auto-hide (BGA)** — panel closes when navigating away from any BGA page; stays open across BGA pages (including unsupported games showing help)
3. **Auto-hide (Game)** — panel closes when navigating to anything that isn't a supported game table (strictest mode)

**Why auto-close but not auto-open:** `chrome.sidePanel.open()` requires a user gesture (icon click or keyboard shortcut). `chrome.sidePanel.close()` has no such restriction. The extension cannot programmatically open the panel on navigation, so auto-hide only auto-closes. Users reopen via the toolbar icon or keyboard shortcut.

**Pin button UI:** A pin icon in the top bar (between eye and ?) showing the current mode. Three icon variants:
- Filled pin = Pinned (always open)
- Pin-in-cloud (BGA cloud logo) = Auto-hide on non-BGA
- Crossed pin = Auto-hide on non-game

**Pin dropdown behavior:** The dropdown positions so its first row (current mode) overlaps exactly on top of the pin button — the button visually "expands" into a menu. Current mode is always the top row with its label shown; the other two modes appear below in fixed relative order. A "Customize shortcut" link appears at the bottom after a divider.

**Two interaction patterns:**
1. **Click-click:** `mousedown` on button opens menu, `mouseup` on same item (current mode) does nothing. Then `click` on another item selects it and closes the menu.
2. **Press-drag:** `mousedown` opens menu, cursor drags over items highlighting them (`mouseover`), `mouseup` on a different item selects it and closes. `mouseup` on the current mode (top item) closes without change.

Implementation uses `mousedown`/`mouseup`/`mouseover` events (not `click`), distinct from the section-selector pattern.

**Keyboard shortcut:** Added via manifest `commands` with `_execute_action` and a suggested default (e.g., `Alt+Shift+B`). This fires `chrome.action.onClicked`, which **toggles** the panel: opens if closed, closes if open. The `sidePanelOpen` state variable already tracks this. Users can customize the shortcut via `chrome://extensions/shortcuts`. Chrome requires shortcuts in the manifest — they cannot be registered programmatically.

**Persistence:** Pin mode stored in `chrome.storage.local` so it survives browser restarts. Background loads it on service worker startup.

**Lit lightbulb icon:** When auto-hide is active and the panel is closed, if a supported game page is detected on the active tab, swap the extension icon to a "lit" lightbulb variant (brighter/glowing) via `chrome.action.setIcon()`. This hints the user to click or use the shortcut to open. Reset to the normal (unlit) icon when the panel opens or when navigating away from a game page. Pre-rendered PNG files for each size (16, 48, 128) for crispness.

**Navigation classification reuse:** `classifyNavigation()` already returns `"showHelp"` (non-game) or `"extract"` (game). The auto-close logic uses this classification:
- Mode 2 (BGA): close when URL doesn't match BGA domain pattern at all
- Mode 3 (Game): close when `classifyNavigation()` returns `"showHelp"`

## Implementation Steps

### Task 1: Add pin mode state, persistence, and keyboard shortcut toggle

**Files:**
- Modify: `src/background.ts`
- Modify: `manifest.json`
- Modify: `src/__tests__/background.test.ts`

- [x] Define `PinMode` type: `"pinned" | "autohide-bga" | "autohide-game"`
- [x] Add `pinMode` state variable, default `"pinned"`
- [x] Load pin mode from `chrome.storage.local` on service worker startup
- [x] Add `"setPinMode"` message handler that updates state and persists to storage
- [x] Add `"getPinMode"` message handler that returns current mode
- [x] Export `PinMode` type and add helper `shouldAutoClose(url, pinMode)` that returns boolean
- [x] Add `"commands"` section to manifest with `"_execute_action"` and suggested `Alt+Shift+B`
- [x] Update `chrome.action.onClicked` to toggle: if `sidePanelOpen`, call `chrome.sidePanel.close()`, else `open()`
- [x] Write tests for `shouldAutoClose` with all three modes and various URLs
- [x] Write tests for setPinMode/getPinMode message handlers
- [x] Run project test suite — must pass before task 2

### Task 2: Add auto-close logic and lit icon hint

**Files:**
- Modify: `src/background.ts`
- Create: `assets/extension/icon-16-lit.png`, `icon-48-lit.png`, `icon-128-lit.png`
- Modify: `src/__tests__/background.test.ts`

- [x] In `handleNavigation()`: after classification, if `shouldAutoClose` returns true, call `chrome.sidePanel.close({ tabId })` instead of sending help/extract messages
- [x] In `chrome.tabs.onActivated` listener: check auto-close before calling `handleNavigation`
- [x] When auto-close is active and a supported game is detected on the active tab, swap icon to lit variant via `chrome.action.setIcon()`
- [x] Reset icon to normal (unlit) when panel opens or when navigating away from game page
- [x] Create lit lightbulb icon variants (16, 48, 128px) — brighter/glowing version of current icons
- [x] Write tests for auto-close triggering in each mode
- [x] Write tests for icon swap behavior (lit/unlit)
- [x] Run project test suite — must pass before task 3

### Task 3: Add pin button with dropdown to side panel

**Files:**
- Modify: `sidepanel.html`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/__tests__/sidepanel_ui.test.ts`

- [x] Add pin button element in top bar between eye (`btn-sections`) and download buttons
- [x] Create three SVG pin icon variants (filled, pin-in-cloud, crossed/outline) for the three modes
- [x] Add dropdown panel positioned so first row overlaps the pin button (button "expands" into menu)
- [x] Current mode always top row; other two below in fixed relative order
- [x] Add "Customize shortcut" link after divider at bottom, opens `chrome://extensions/shortcuts`
- [x] Implement dual interaction: click-click (mousedown opens, click selects) and press-drag (mousedown opens, mouseup on different item selects)
- [x] Use `mousedown`/`mouseup`/`mouseover` events; highlight item under cursor; mouseup on current mode closes without change
- [x] On page load, request current mode via `"getPinMode"` message and set button icon
- [x] On mode selection, send `"setPinMode"` message to background and update button icon
- [x] Close dropdown on mouseup outside or when selection is made
- [x] Style dropdown, hover highlights, active state, divider
- [x] Write tests for pin button mousedown opening dropdown
- [x] Write tests for mode selection updating the button icon
- [x] Write tests for mouseup-outside closing dropdown
- [x] Run project test suite — must pass before task 4

### Task 4: Verify acceptance criteria

- [x] Manual test: pinned mode behaves identically to current behavior
- [x] Manual test: auto-hide (BGA) closes panel on non-BGA tabs, keeps open on BGA tabs
- [x] Manual test: auto-hide (Game) closes panel on non-game tabs, keeps open on game tables
- [x] Manual test: keyboard shortcut toggles panel open/closed
- [x] Manual test: lit lightbulb icon appears when game detected and panel is closed in auto-hide mode
- [x] Manual test: pin mode persists across browser restart
- [x] Manual test: dropdown opens/closes correctly, shows current mode
- [x] Manual test: "Customize shortcut" link works
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`
- [x] Verify test coverage meets 80%+

### Task 5: Update documentation

- [x] Update README.md with auto-hide feature and keyboard shortcut
- [x] Update CLAUDE.md if internal patterns changed
- [x] Move this plan to `docs/plans/completed/`

## Post-Completion

**Manual verification:**
- Test keyboard shortcut customization via `chrome://extensions/shortcuts`
- Test with multiple windows (pin mode is global, not per-window)
- Verify auto-close doesn't interfere with live tracking reconnection
