---
created: 2026-09-02 21:35
---

# Play-time stats page: fix the bugs and improvements spotted while looking at it for a screenshot (unlisted

inspect the page and enumerate them first). Blocks the docs shot: `docs/pages/time-tracking.md` is the only user-facing feature page with no image at all, and it should not be photographed until the page is right. Note the page has no pure renderer — `showStats()` in `src/sidepanel/sidepanel.ts` mutates `#content` directly, reads five `chrome.storage.local` keys, and buckets its chart off `Date.now()`, so any offline capture would need a storage shim and a frozen clock.
