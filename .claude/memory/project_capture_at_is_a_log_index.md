---
name: project_capture_at_is_a_log_index
description: The docs capture scripts' `--at N` counts processed log entries, so adding a log entry type silently re-frames every shot of that game
metadata:
  type: project
---

`docs/screenshots/capture/<id>.sh` passes `--at N` to `lib/render.ts`, which slices the *processed*
log to its first N entries. N is an index into whatever that game's `process_log` currently emits,
not a move number, a turn or a timestamp.

Adding a log entry type shifts it. On 2026-09-07, parsing Crew's free-allocation phase inserted 18
entries ahead of the gameplay ones, so both Crew scripts' `--at 34` began rendering an earlier
moment: `crew-history` came back showing two tricks where the committed frame has five. They now use
`--at 52`.

**How to apply:** after changing what a game's `process_log` emits, re-run that game's capture scripts
and diff the frames against git rather than assuming they still frame the same moment. To find the
new index, count how many entries of the new types precede the old one — walk the log keeping the
indices of the entries that are *not* new, and take the one sitting at the old position.

Two things make the diff readable. A frame that comes back byte-identical is the proof the re-index
worked. A frame that differs by a pixel of height with a mean channel delta of about 2/255 is a
sub-pixel reflow caused by a section above it changing size, not a wrong index — content-identical,
and it can come back on its own once the section above settles.

Also watch the selectors: sections are picked by `data-section` hooks precisely because
`nth-of-type` broke when a new section was inserted between two existing ones.
