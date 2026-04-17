// Serialization: toJSON/fromJSON for persisting and restoring GameState.

import {
  type AgeSetKey,
  Card,
  CardSet,
  ageSetKey,
  cardSetFromLabel,
  cardSetLabel,
  parseAgeSetKey,
} from "./types.js";
import { type GameState, createGameState } from "./game_state.js";

// ---------------------------------------------------------------------------
// Serialization types
// ---------------------------------------------------------------------------

interface SerializedCard {
  resolved?: string;
  age?: number;
  cardSet?: number;
  candidates?: string[];
  opponent?: SerializedOpponentKnowledge;
}

type SerializedOpponentKnowledge =
  | { kind: "exact"; name: string | null }
  | { kind: "partial"; suspects: string[]; closed: boolean };

export interface SerializedGameState {
  gameName: "innovation";
  decks: Record<string, SerializedCard[]>;
  hands: Record<string, SerializedCard[]>;
  boards: Record<string, SerializedCard[]>;
  scores: Record<string, SerializedCard[]>;
  revealed: Record<string, SerializedCard[]>;
  forecast: Record<string, SerializedCard[]>;
  achievements: SerializedCard[];
  displays?: Record<string, SerializedCard[]>;
  relics?: SerializedCard[];
  achievementRelics?: Record<string, SerializedCard[]>;
}

// ---------------------------------------------------------------------------
// Standalone serialization functions
// ---------------------------------------------------------------------------

/** Serialize full game state to a JSON-compatible object. */
export function toJSON(state: GameState): SerializedGameState {
  const serializeCard = (card: Card): SerializedCard => {
    const result: SerializedCard = {};

    result.age = card.age;
    result.cardSet = card.cardSet;
    if (card.isResolved) {
      result.resolved = card.resolvedName!;
    } else {
      const candidateList = [...card.candidates].sort();
      if (candidateList.length === 0) throw new Error(`Cannot serialize unresolved card with no candidates (age ${card.age}, set ${card.cardSet})`);
      result.candidates = candidateList;
    }

    // Serialize opponent knowledge (omit if "none")
    if (card.opponentKnowledge.kind === "exact") {
      result.opponent = { kind: "exact", name: card.opponentKnowledge.name };
    } else if (card.opponentKnowledge.kind === "partial") {
      result.opponent = { kind: "partial", suspects: [...card.opponentKnowledge.suspects].sort(), closed: card.opponentKnowledge.closed };
    }

    return result;
  };

  const serializeCards = (cards: Card[]): SerializedCard[] => cards.map(serializeCard);

  const decks: Record<string, SerializedCard[]> = {};
  for (const [key, cards] of state.decks) {
    if (cards.length > 0) {
      const { age, cardSet } = parseAgeSetKey(key);
      decks[`${age}/${cardSetLabel(cardSet)}`] = serializeCards(cards);
    }
  }

  const hands: Record<string, SerializedCard[]> = {};
  const boards: Record<string, SerializedCard[]> = {};
  const scores: Record<string, SerializedCard[]> = {};
  const revealed: Record<string, SerializedCard[]> = {};
  const forecast: Record<string, SerializedCard[]> = {};
  const displays: Record<string, SerializedCard[]> = {};
  const achievementRelics: Record<string, SerializedCard[]> = {};
  for (const player of state.players) {
    hands[player] = serializeCards(state.hands.get(player)!);
    boards[player] = serializeCards(state.boards.get(player)!);
    scores[player] = serializeCards(state.scores.get(player)!);
    const rev = state.revealed.get(player) ?? [];
    if (rev.length > 0) revealed[player] = serializeCards(rev);
    const fc = state.forecast.get(player) ?? [];
    if (fc.length > 0) forecast[player] = serializeCards(fc);
    const dp = state.displays.get(player) ?? [];
    if (dp.length > 0) displays[player] = serializeCards(dp);
    const ar = state.achievementRelics.get(player) ?? [];
    if (ar.length > 0) achievementRelics[player] = serializeCards(ar);
  }

  const result: SerializedGameState = {
    gameName: "innovation", decks, hands, boards, scores, revealed, forecast,
    achievements: serializeCards(state.achievements),
  };
  if (Object.keys(displays).length > 0) result.displays = displays;
  if (state.relics.length > 0) result.relics = serializeCards(state.relics);
  if (Object.keys(achievementRelics).length > 0) result.achievementRelics = achievementRelics;
  return result;
}

/** Deserialize game state from JSON. No CardDatabase needed — candidates stored in full. */
export function fromJSON(data: SerializedGameState, players: string[], perspective: string): GameState {
  const state = createGameState(players, perspective);

  const loadCard = (d: SerializedCard): Card => {
    if ("excluded" in d) {
      throw new Error("Cannot load game state saved in the old exclusion-based format. Please re-export from a live game.");
    }
    let card: Card;
    if (d.resolved !== undefined) {
      card = new Card(d.age!, d.cardSet as CardSet, [d.resolved]);
    } else {
      if (!d.candidates || d.candidates.length === 0) throw new Error(`Serialized card has no resolved name and no candidates (age ${d.age}, set ${d.cardSet})`);
      card = new Card(d.age!, d.cardSet as CardSet, d.candidates);
    }

    // Restore opponent knowledge
    if (d.opponent) {
      if (d.opponent.kind === "exact") {
        card.opponentKnowledge = { kind: "exact", name: d.opponent.name };
      } else if (d.opponent.kind === "partial") {
        card.opponentKnowledge = { kind: "partial", suspects: new Set(d.opponent.suspects), closed: d.opponent.closed };
      }
    }

    return card;
  };

  const loadCards = (cards: SerializedCard[]): Card[] => cards.map(loadCard);

  // Load decks
  for (const [key, cardDicts] of Object.entries(data.decks ?? {})) {
    const [ageStr, setLabel] = key.split("/");
    const groupKey = ageSetKey(Number(ageStr), cardSetFromLabel(setLabel));
    state.decks.set(groupKey, loadCards(cardDicts));
  }

  // Load per-player zones
  for (const player of players) {
    state.hands.set(player, loadCards(data.hands[player] ?? []));
    state.boards.set(player, loadCards(data.boards[player] ?? []));
    state.scores.set(player, loadCards(data.scores[player] ?? []));
    const rev = data.revealed?.[player];
    if (rev && rev.length > 0) state.revealed.set(player, loadCards(rev));
    const fc = data.forecast?.[player];
    if (fc && fc.length > 0) state.forecast.set(player, loadCards(fc));
    const dp = data.displays?.[player];
    if (dp && dp.length > 0) state.displays.set(player, loadCards(dp));
    const ar = data.achievementRelics?.[player];
    if (ar && ar.length > 0) state.achievementRelics.set(player, loadCards(ar));
  }

  // Load achievements and relics
  state.achievements = loadCards(data.achievements ?? []);
  if (data.relics) state.relics = loadCards(data.relics);

  return state;
}
