# React to Browser Navigation

## Overview

Automatically track browser tab changes (same-tab navigation and tab switching) while this extension's own side panel is open. When the active tab changes to a different BGA Innovation table, re-extract and update the side panel. When navigating to a non-game page, show the help page. When the URL matches the currently displayed table, do nothing. No tracking occurs when the extension's side panel is closed.

## Context

- Files involved:
  - `manifest.json` - add `tabs` permission and BGA host permission
  - `src/background.ts` - navigation listeners, side panel tracking, extraction refactor
  - `src/sidepanel/sidepanel.ts` - port connection for open/close tracking
  - `src/__tests__/background.test.ts` - tests for navigation classification and extraction
- Related patterns: existing message protocol (`resultsReady`, `notAGame`, `getResults`), Chrome API mocking in tests
- Dependencies: Chrome APIs (`chrome.tabs.onActivated`, `chrome.tabs.onUpdated`, `chrome.runtime.connect/onConnect`)

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Update manifest permissions

**Files:**
- Modify: `manifest.json`

- [x] Add `"tabs"` to `permissions` array (needed to read `tab.url` in event listeners without a user gesture)
- [x] Add `"host_permissions": ["https://*.boardgamearena.com/*"]` (needed for `chrome.scripting.executeScript` triggered by navigation events, since `activeTab` only grants access on user gesture)
- [x] Run `npm run build` and verify extension loads

### Task 2: Track this extension's side panel open/close via port connection

**Files:**
- Modify: `src/background.ts`
- Modify: `src/sidepanel/sidepanel.ts`

The extension needs to know when its own side panel is open. This is done by having `sidepanel.ts` open a port to the background script on load. Since `sidepanel.ts` only runs inside this extension's side panel, the port connection inherently tracks only this extension's panel — not any other side panel in the browser.

- [x] In `background.ts`: add `sidePanelOpen` boolean state variable (initially `false`)
- [x] In `background.ts`: add `chrome.runtime.onConnect` listener — when port name is `"sidepanel"`, set `sidePanelOpen = true`; on port's `onDisconnect`, set `sidePanelOpen = false`
- [x] In `sidepanel.ts`: on load (alongside existing Chrome API guard), call `chrome.runtime.connect({ name: "sidepanel" })` to establish the tracking port
- [x] Update Chrome API mocks in `src/__tests__/background.test.ts` to include `onConnect` listener mock
- [x] Run `npm test` — must pass before task 3

### Task 3: Add navigation listeners and auto-extraction

**Files:**
- Modify: `src/background.ts`
- Modify: `src/__tests__/background.test.ts`

- [x] Extract the core extraction logic (script injection, pipeline execution, result notification) from `chrome.action.onClicked` into a reusable `extractFromTab(tabId: number, url: string): Promise<void>` function
- [x] Refactor the icon click handler to call `extractFromTab` (side panel open + badge logic stays in the click handler)
- [x] Add exported `classifyNavigation(url: string | undefined, currentTableNumber: string | null): NavigationAction` pure function that returns `{ action: "skip" }`, `{ action: "extract", tableNumber: string }`, or `{ action: "showHelp", url: string }`
- [x] Add `activeTabId` state variable, updated by `chrome.tabs.onActivated`
- [x] Add `chrome.tabs.onActivated` listener: update `activeTabId`; if `sidePanelOpen`, get tab URL via `chrome.tabs.get()`, classify, and act (extract or show help)
- [x] Add `chrome.tabs.onUpdated` listener: if `sidePanelOpen` and `tabId === activeTabId` and `changeInfo.url` is present, classify and act
- [x] On extraction failure triggered by navigation, send `notAGame` to side panel (graceful fallback instead of ERR badge)
- [x] Write tests for `classifyNavigation` — cover: same table returns skip, different BGA table returns extract, non-BGA URL returns showHelp, undefined URL returns showHelp
- [x] Update Chrome API mocks in test file for `chrome.tabs.onActivated`, `chrome.tabs.onUpdated`, `chrome.tabs.get`
- [x] Run `npm test` — must pass before task 4

### Task 4: Verify acceptance criteria

- [x] Manual test: open side panel on game table, navigate to different game table in same tab — panel updates
- [x] Manual test: switch to a tab with a different game table — panel updates
- [x] Manual test: switch to a non-game tab — panel shows help
- [x] Manual test: stay on / switch to same game table — panel does not change
- [x] Manual test: close side panel, navigate between tabs — no extraction occurs
- [x] Run full test suite (`npm test`)
- [x] Run linter (`npm run lint`)

### Task 5: Update documentation

- [x] Update CLAUDE.md if internal patterns changed
- [x] Move this plan to `docs/plans/completed/`
