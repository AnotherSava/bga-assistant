// Nucleum game state.
//
// Nucleum hides nothing — action tiles, contracts, technologies and everything on the map are
// public — so there is no hidden state to reconstruct and no candidates to narrow. What the
// extension tracks is the turn history itself: who did what, on which turn.

import type { PlayerInfo } from "../../models/types.js";
import type { NucleumTurnAction } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NucleumGameState {
  players: Record<string, PlayerInfo>;
  /** Chronological; the last one is the turn in progress. */
  actions: NucleumTurnAction[];
}

/** Serialized form for side panel message passing.
 *  Holds the players too, so the exported summary renders from this file alone. */
export interface SerializedNucleumGameState {
  gameName: "nucleum";
  players: Record<string, PlayerInfo>;
  actions: NucleumTurnAction[];
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function createNucleumGameState(players: Record<string, PlayerInfo>): NucleumGameState {
  return { players, actions: [] };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Serialize game state for side panel message passing. Everything is already plain JSON —
 *  the copies exist so the panel cannot mutate the worker's state through a shared reference. */
export function toJSON(state: NucleumGameState): SerializedNucleumGameState {
  return { gameName: "nucleum", players: copyPlayers(state.players), actions: copyActions(state.actions) };
}

export function fromJSON(data: SerializedNucleumGameState): NucleumGameState {
  return { players: copyPlayers(data.players), actions: copyActions(data.actions) };
}

function copyPlayers(players: Record<string, PlayerInfo>): Record<string, PlayerInfo> {
  return Object.fromEntries(Object.entries(players).map(([id, player]) => [id, { ...player }]));
}

function copyActions(actions: NucleumTurnAction[]): NucleumTurnAction[] {
  return actions.map(action => ({ ...action, actions: action.actions.map(detail => ({ ...detail })) }));
}
