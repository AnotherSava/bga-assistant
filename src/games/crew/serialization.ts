// Serialization: toJSON/fromJSON for persisting and restoring CrewGameState.

import type { CrewCard } from "./types.js";
import { type CrewGameState, type Trick, createCrewGameState } from "./game_state.js";

// ---------------------------------------------------------------------------
// Serialized types
// ---------------------------------------------------------------------------

export interface SerializedCrewGameState {
  players: Record<string, string>;
  playerOrder: string[];
  currentPlayerId: string;
  missionNumber: number;
  hands: Record<string, string[][]>;
  tricks: Trick[];
}

// ---------------------------------------------------------------------------
// Serialization functions
// ---------------------------------------------------------------------------

/** Serialize CrewGameState to a JSON-compatible object. */
export function crewToJSON(state: CrewGameState): SerializedCrewGameState {
  const hands: Record<string, string[][]> = {};
  for (const [pid, slots] of Object.entries(state.hands)) {
    hands[pid] = slots.map(slot => [...slot.candidates].sort());
  }

  return {
    players: state.players,
    playerOrder: state.playerOrder,
    currentPlayerId: state.currentPlayerId,
    missionNumber: state.missionNumber,
    hands,
    tricks: state.tricks,
  };
}

/** Deserialize CrewGameState from JSON. */
export function crewFromJSON(data: SerializedCrewGameState): CrewGameState {
  const state = createCrewGameState(data.players, data.playerOrder, data.currentPlayerId);
  state.missionNumber = data.missionNumber;

  for (const [pid, slots] of Object.entries(data.hands)) {
    state.hands[pid] = slots.map(candidates => ({
      candidates: new Set(candidates),
    }));
  }

  state.tricks = data.tricks.map(t => ({ winnerId: t.winnerId, cards: t.cards.map(c => ({ playerId: c.playerId, card: { ...c.card } })) }));

  return state;
}
