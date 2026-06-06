---
name: settings-surface
description: "BGA Assistant has no options page; settings persist via localStorage (settings.ts) and are surfaced through the eye-icon menu (#section-selector)"
metadata: 
  node_type: memory
  type: project
---

The extension has **no options/settings page**. User-configurable settings persist to localStorage via `src/sidepanel/settings.ts` (`loadSetting`/`saveSetting` with typed defaults, `bgaa_*` keys) and are surfaced through the **eye-icon button** (`#btn-sections`), which toggles the `#section-selector` menu.

**Why:** there is no central config UI; the eye menu is the single place users reach per-context display/settings controls.

**How to apply:** to add a user-facing setting, (1) persist it with `loadSetting`/`saveSetting` under a `bgaa_*` key, and (2) add a control to the `#section-selector` menu. The eye-button click handler in `sidepanel.ts` dispatches the menu by context — it checks `statsPageOpen()` first (→ stats/time-tracking settings: day-start hour, week-start day, session-list filter via `buildStatsSettingsMenu`), then falls back to the per-game menus (`buildAzulDisplayMenu`, `buildInnovationDisplayMenu`). Code constants like `DAY_START_HOUR`/`WEEK_START_DAY` in `src/time-tracking.ts` serve as the defaults for these settings. Changing a stats setting calls `refreshStatsView`, which re-renders the page and rebuilds the open menu (see [[feedback_actions_refresh_not_navigate]]).
