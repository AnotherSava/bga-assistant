# Prevent turn history from covering hand sections

## Overview

The turn history overlay (`position: fixed`, top-right) covers the opponent hand section when there are many actions. Add a right margin to both hand sections matching the turn history width so cards reflow via flex-wrap and stay left of the overlay.

## Context

- Files involved:
  - Modify: `src/sidepanel/sidepanel.ts` — measure turn history width after render, apply margin to hand sections
  - Modify: `src/sidepanel/sidepanel.css` — optional: transition for smooth margin changes
- Related patterns: turn history is rendered at lines 288-293 of `sidepanel.ts` into `#turn-history` (fixed, top: 38px, right: 8px, z-index: 10). Hand sections use `.card-row` with `display: flex; flex-wrap: wrap` so cards already reflow when width is constrained.
- Dependencies: none

## Development Approach

- Testing approach: Manual testing primary — layout changes are visual
- Complete each task fully before moving to the next
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Mechanism**: after rendering turn history HTML into `#turn-history`, measure its `offsetWidth` (includes padding). Set `margin-right` on the `#hand-opponent` and `#hand-me` container elements to that width plus a small gap (e.g. 8px). The flex-wrap `.card-row` inside each section naturally reflows cards into the narrower space.

**When turn history is hidden**: `applyTurnHistoryVisibility()` can set `display: none` on the turn history element. When hidden, margin should be reset to 0. The visibility toggle already exists — just extend it to also update the hand margins.

**When turn history is empty**: if no actions have occurred, `#turn-history` has no content and zero width. Margin computes to the gap only — effectively no change.

**Zoom interaction**: the side panel uses CSS `zoom` on `#content`. Since `#turn-history` is outside `#content` (fixed position), its measured width is in un-zoomed pixels. The hand sections inside `#content` are zoomed. The margin value needs to be divided by the current zoom level to compensate.

**Scope**: margin applies to the full hand section height, not just rows that vertically overlap with turn history. This is simpler and avoids JS height measurement/recalculation.

## Implementation Steps

### Task 1: Apply margin to hand sections after turn history render

**Files:**
- Modify: `src/sidepanel/sidepanel.ts`

- [x] After `turnHistoryEl.innerHTML = renderTurnHistory(...)` and `applyTurnHistoryVisibility()`, measure `turnHistoryEl.offsetWidth`
- [x] Find `#hand-opponent` and `#hand-me` elements
- [x] Set `marginRight` on both to `${turnHistoryWidth + 8}px` (8px gap between cards and history)
- [x] Account for zoom: divide the pixel value by the current zoom level
- [x] When turn history visibility is toggled off, reset both margins to 0; when toggled on, reapply
- [x] Extract a helper function (e.g. `updateHandMargins()`) called from both render and visibility toggle paths
- [x] Write/update tests for the margin helper if it has testable logic
- [x] Run project test suite — must pass before next task

### Task 2: Verify acceptance criteria

- [x] Manual test: load a game with many actions (3+ turns with sub-actions) and many opponent hand cards — cards should wrap left of turn history
- [x] Manual test: toggle turn history visibility off — hand sections should use full width
- [x] Manual test: change zoom level — margins should adjust correctly
- [x] Manual test: game with no actions — no unnecessary margin
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`

### Task 3: Update documentation

- [x] Update README.md if user-facing behavior changed
- [x] Update CLAUDE.md if internal patterns changed
- [x] Move this plan to `docs/plans/completed/`
