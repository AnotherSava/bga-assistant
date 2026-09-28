---
created: 2026-09-08 17:55
---

# option to remove timestamp from history events.

Done as two independent settings, one per surface: the panel's in `localStorage` (`bgaa_show_timestamps`), BGA's log column's in the shared `chrome.storage.local` object (`InPageSettings.showTimestamps`); both default on. Hidden by a CSS class rather than a re-render, so the in-page reconcile never rebuilds the list on a toggle. The four turn-history menu rows moved into one shared `buildTurnHistoryOptions` both games append.
