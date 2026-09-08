// CrewGameState interface — plain data layer, the serialization boundary.

import type { PlayerInfo } from "../../models/types.js";
import type { CrewCard, CrewTask, TaskBundle } from "./types.js";

// ---------------------------------------------------------------------------
// CardGuess — candidate model for unknown card tracking
// ---------------------------------------------------------------------------

/** A single card slot in a player's hand with a set of candidate card keys. */
export interface CardGuess {
  candidates: Set<string>;
}

// ---------------------------------------------------------------------------
// Trick
// ---------------------------------------------------------------------------

/** A trick: completed (winnerId set) or in progress (winnerId null). */
export interface Trick {
  cards: { playerId: string; card: CrewCard }[];
  winnerId: string | null;
}

// ---------------------------------------------------------------------------
// CrewGameState interface — plain data, the serialization boundary
// ---------------------------------------------------------------------------

export interface CrewGameState {
  /** Player ID → PlayerInfo (name, BGA color, observer flag). */
  players: Record<string, PlayerInfo>;
  /** Player IDs in seat order (determines card distribution for remainders). */
  playerOrder: string[];
  /** The observing player's ID (the one whose hand is fully known). */
  currentPlayerId: string;
  missionNumber: number;
  /** Player ID → array of CardGuess slots (one per card in hand). */
  hands: Record<string, CardGuess[]>;
  tricks: Trick[];
  /** Tasks offered this mission, in BGA's own order — which is what fixes their letters. Empty on a mission with no free allocation. */
  tasks: CrewTask[];
  /** Player ID → the opinion bundles they submitted while the tasks were being distributed. */
  bundles: Record<string, TaskBundle[]>;
}

/** Create a fresh CrewGameState with empty collections. */
export function createCrewGameState(players: Record<string, PlayerInfo>, playerOrder: string[], currentPlayerId: string): CrewGameState {
  const hands: Record<string, CardGuess[]> = {};
  const bundles: Record<string, TaskBundle[]> = {};
  for (const pid of Object.keys(players)) {
    hands[pid] = [];
    bundles[pid] = [];
  }

  return {
    players,
    playerOrder,
    currentPlayerId,
    missionNumber: 0,
    hands,
    tricks: [],
    tasks: [],
    bundles,
  };
}
