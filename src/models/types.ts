// Shared BGA types used across all games.

// ---------------------------------------------------------------------------
// Game name
// ---------------------------------------------------------------------------

/** Supported game names for BGA tracking. */
export type GameName = "innovation" | "azul" | "thecrewdeepsea";

// ---------------------------------------------------------------------------
// Card index utility
// ---------------------------------------------------------------------------

/** Convert a display card name to a lowercase index key. */
export function cardIndex(name: string): string {
  return name.toLowerCase();
}

// ---------------------------------------------------------------------------
// Raw BGA data types (shared across all games)
// ---------------------------------------------------------------------------

/** A single BGA notification inside a packet. */
export interface RawNotification {
  type: string;
  args: Record<string, unknown>;
}

/** A BGA notification packet (one move can span multiple packets). */
export interface RawPacket {
  move_id: number | null;
  time: number;
  data: RawNotification[];
}

/** Per-player metadata captured at extraction time. */
export interface PlayerInfo {
  id: string;
  name: string;
  /** BGA-assigned color as bare 6-char hex (no `#`). */
  colorHex: string;
  /** True for the observer ("you") — derived from gameui.player_id. */
  isCurrent: boolean;
}

/** Shape of the raw extraction data sent from the content script. */
export interface RawExtractionData {
  gameName: string;
  players: Record<string, PlayerInfo>;
  packets: RawPacket[];
  currentPlayerId?: string;
  gamedatas?: {
    my_hand?: Array<{ id: number | string }>;
    cards?: Record<string, { name?: string; is_relic?: string | number | boolean; type?: string | number }>;
  };
}

// ---------------------------------------------------------------------------
// Re-export Innovation types for backward compatibility
// ---------------------------------------------------------------------------

export * from "../games/innovation/types.js";
