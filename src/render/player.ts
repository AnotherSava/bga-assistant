// Shared rendering helpers for per-player color cues.

import type { PlayerInfo } from "../models/types.js";

/** Inline `style` attribute that sets `--player-color` from a PlayerInfo. */
export function playerColorAttr(player: PlayerInfo): string {
  return `style="--player-color: #${player.colorHex}"`;
}
