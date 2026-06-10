---
layout: default
title: Play time
---

[Home](..) | [Innovation](innovation) | [Azul](azul) | [Crew](crew) | [Play time](time-tracking) | [Development](development) | [Privacy](privacy)

---

Automatically tracks how much time you spend playing on BGA — for every game and table, not just the supported ones. The clock runs only while a game table tab is focused, pauses when you step away, and a stats page shows daily, weekly, and monthly charts per game with session and per-table summaries.

Open the stats page with the stopwatch icon in the side panel's top bar; click it again to return to the game summary.

### How tracking works

- **Focused tab only**: time counts while a BGA game table tab is the active, focused tab — switching tabs, windows, or apps stops the clock
- **Idle handling**: short pauses (thinking on your turn) keep counting; after about a minute without keyboard or mouse input the session is marked idle, and if you stay away past a grace period it ends retroactively at the moment idleness began
- **Sessions split across breaks**: each return to a table starts a new session, so turn-based games naturally accumulate many short sittings
- **Stray glances dropped**: revisiting a forgotten table for a few seconds before heading back to the lobby leaves a tiny session next to the real one; when consecutive sessions for the same table include such a glance (under 20 seconds) alongside a sitting at least 5× longer, the glance is dropped from the stats so it doesn't clutter the list or skew the table's average
- **Per-table classification**: each table is remembered as real-time or turn-based, and as a tournament, arena, or regular table

### The stats page

- **Summary**: total play time today and this week
- **Chart**: stacked bars of play time per game, switchable between Day, Week, and Month granularity
- **Sessions view**: every sitting with its game, table, start time, and duration — the in-progress session shows a pulsing dot (green while active, yellow while idle)
- **Long-session highlighting**: turn-based sessions far above the game's average length are tinted yellow (over 3×) or red (over 10×) — hover for the exact ratio
- **Tables view**: one row per table with last played time, average session length (turn-based tables only), and total time
- **Table icons**: a stopwatch marks real-time tables, a trophy marks tournament tables, and crossed swords mark arena tables
- **Deletion**: hover over a row to remove a single session (Sessions view) or all sessions for a table (Tables view)

### Settings

The eye icon on the stats page opens display settings, persisted across sessions:

- **Day starts at**: hour at which a calendar day rolls over (late-night games count toward the previous day)
- **Week starts on**: first day of the week for weekly buckets
- **Show sessions**: filter the table to Off, Today, This week, or All

### Data and backup

- **Export / Import**: download all sessions as a CSV file, or merge a previously exported CSV back in (duplicates are skipped)
- **Clear**: remove all recorded data
- **Reinstall safety**: sessions are automatically backed up to BGA's own site storage, so your history survives an extension reinstall
