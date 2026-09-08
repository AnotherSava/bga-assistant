// Serialization: toJSON/fromJSON for persisting and restoring CrewGameState.

import type { PlayerInfo } from "../../models/types.js";
import type { CrewCard, CrewTask, TaskBundle } from "./types.js";
import { type CrewGameState, type Trick, createCrewGameState } from "./game_state.js";

// ---------------------------------------------------------------------------
// Serialized types
// ---------------------------------------------------------------------------

export interface SerializedCrewGameState {
  gameName: "thecrewdeepsea";
  players: Record<string, PlayerInfo>;
  playerOrder: string[];
  currentPlayerId: string;
  missionNumber: number;
  hands: Record<string, string[][]>;
  tricks: Trick[];
  tasks: CrewTask[];
  bundles: Record<string, TaskBundle[]>;
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
    gameName: "thecrewdeepsea",
    players: state.players,
    playerOrder: state.playerOrder,
    currentPlayerId: state.currentPlayerId,
    missionNumber: state.missionNumber,
    hands,
    tricks: state.tricks,
    tasks: state.tasks,
    bundles: state.bundles,
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

  state.tasks = data.tasks.map(t => ({ ...t }));
  for (const [pid, bundles] of Object.entries(data.bundles)) {
    state.bundles[pid] = bundles.map(b => ({ id: b.id, taskIds: [...b.taskIds], opinion: b.opinion }));
  }

  return state;
}
