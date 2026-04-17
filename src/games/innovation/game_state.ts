// GameState interface — plain data layer, the serialization boundary.

import {
  type AgeSetKey,
  type Zone,
  Card,
} from "./types.js";

// ---------------------------------------------------------------------------
// GameState interface — plain data, the serialization boundary
// ---------------------------------------------------------------------------

export interface GameState {
  decks: Map<AgeSetKey, Card[]>;
  hands: Map<string, Card[]>;
  boards: Map<string, Card[]>;
  scores: Map<string, Card[]>;
  revealed: Map<string, Card[]>;
  forecast: Map<string, Card[]>;
  achievements: Card[];
  /** Per-player Artifact-on-display zone. At most one card per player (rules force
   *  return-to-deck before digging a new one) — stored as Card[] of length 0 or 1
   *  for uniformity with other zone maps. Fully public. */
  displays: Map<string, Card[]>;
  /** Global "Available Relics" pool. Fully public. Populated at deck init when the
   *  with-relics variant is active. */
  relics: Card[];
  /** Per-player: relics currently sitting in that player's achievements pile.
   *  Unlike regular achievements (count-only), relics can be seized back, so
   *  their identity must be tracked. Fully public. */
  achievementRelics: Map<string, Card[]>;
  players: string[];
  perspective: string;
}

/** Create a fresh GameState with empty zones for the given players. */
export function createGameState(players: string[], perspective: string): GameState {
  return {
    decks: new Map(),
    hands: new Map(players.map(p => [p, []])),
    boards: new Map(players.map(p => [p, []])),
    scores: new Map(players.map(p => [p, []])),
    revealed: new Map(players.map(p => [p, []])),
    forecast: new Map(players.map(p => [p, []])),
    achievements: [],
    displays: new Map(players.map(p => [p, []])),
    relics: [],
    achievementRelics: new Map(players.map(p => [p, []])),
    players,
    perspective,
  };
}

// ---------------------------------------------------------------------------
// Zone accessor (standalone — operates on GameState data)
// ---------------------------------------------------------------------------

/** Return the card list for a zone+player combination. */
export function cardsAt(state: GameState, zone: Zone, player: string | null, groupKey?: AgeSetKey): Card[] {
  switch (zone) {
    case "deck": {
      if (!groupKey) throw new Error(`cardsAt("deck") requires a groupKey`);
      return state.decks.get(groupKey) ?? [];
    }
    case "hand":
    case "board":
    case "score":
    case "revealed":
    case "forecast": {
      if (!player) throw new Error(`cardsAt("${zone}") requires a player`);
      const zoneMap = zone === "hand" ? state.hands : zone === "board" ? state.boards : zone === "score" ? state.scores : zone === "revealed" ? state.revealed : state.forecast;
      const cards = zoneMap.get(player);
      if (!cards) throw new Error(`Player "${player}" not found in ${zone} zone`);
      return cards;
    }
    case "display": {
      if (!player) throw new Error(`cardsAt("display") requires a player`);
      const cards = state.displays.get(player);
      if (!cards) throw new Error(`Player "${player}" not found in display zone`);
      return cards;
    }
    case "relics": {
      return state.relics;
    }
    case "achievements": {
      if (!player) return state.achievements;
      const cards = state.achievementRelics.get(player);
      if (!cards) throw new Error(`Player "${player}" not found in achievementRelics zone`);
      return cards;
    }
  }
}
