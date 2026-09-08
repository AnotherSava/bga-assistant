---
name: project_bga_sparse_list_shape
description: A BGA list field arrives as a JSON object rather than an array once anything has been deleted from it — normalise both shapes at the parse boundary
metadata:
  type: project
---

BGA's backend is PHP, and `json_encode` writes an array as a JSON array only while its keys still run
0..n-1. Delete an element and the same field arrives as an object keyed by the survivors:
`{"0": …, "1": …, "3": …}`. A field's JSON *type* therefore depends on what the players did, not on
its schema.

Found 2026-09-07 on Crew's free allocation: `gameStateChange.args.args.bundles[playerId]` is an array
until a player withdraws a bundle, after which it is an object. That reached the user as
`playerBundles.map is not a function` on a real table carrying 23 deletions, while 1181 tests passed
— the committed fixture has no deletions, so it could not produce the shape at all.

**How to apply:** normalise at the parse boundary with `Array.isArray(x) ? x : Object.values(x)`, and
work out which fields actually need it instead of wrapping every list defensively. Scope it by
scanning one real table's whole notification history for the shape: on Crew only the per-player
bundle *list* drifts, because a delete is the only thing that punches a hole in a list, while `tasks`
and a bundle's own `tasks` are rebuilt each time and stay arrays.

A fixture is the wrong instrument for this question — only a table where someone deleted something
can answer it, which is the standing gap in [[feedback_tests_no_gitignored_data]]: committed fixtures
are required, and they cover only the shapes the one recorded game happened to produce.
