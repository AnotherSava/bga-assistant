// Shared test helper: build a Record<string, PlayerInfo> from a name dict.
// Used by per-game test suites (Crew + Innovation) to construct player metadata
// without repeating the same 4-line boilerplate everywhere.

import type { PlayerInfo } from "../../models/types.js";

export function mkPlayers(names: Record<string, string>, currentId?: string): Record<string, PlayerInfo> {
  const out: Record<string, PlayerInfo> = {};
  for (const id in names) out[id] = { id, name: names[id], colorHex: "ff0000", isCurrent: id === currentId };
  return out;
}
