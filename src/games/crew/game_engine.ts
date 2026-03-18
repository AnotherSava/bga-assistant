// Game engine: state mutation logic for The Crew: Mission Deep Sea.
//
// Uses string card keys ("suit:value") for Set membership because TypeScript
// Sets use reference equality — two {suit:1, value:3} objects are distinct
// references, so Set<CrewCard>.has() would always miss. String keys via
// cardKey() give value-based identity for free.

import type { CrewGameLog, CrewLogEntry, CardPlayedEntry, CommunicationEntry } from "./process_log.js";
import { type CardGuess, type CrewGameState, createCrewGameState } from "./game_state.js";
import { ALL_SUITS, SUIT_VALUES, SUBMARINE, cardKey } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a candidate set for unknown slots: all cards minus the excluded set. */
function initUnknownCandidates(excludeCards: Set<string>): Set<string> {
  const candidates = new Set<string>();
  for (const suit of ALL_SUITS) {
    for (const value of SUIT_VALUES[suit]) {
      candidates.add(cardKey(suit, value));
    }
  }
  for (const key of excludeCards) {
    candidates.delete(key);
  }
  return candidates;
}

/** Remove a card key from all slots of all players (except the slot itself). */
function removeFromAllSlots(state: CrewGameState, cardKeyToRemove: string, exceptSlot?: CardGuess): void {
  for (const pid of Object.keys(state.hands)) {
    for (const slot of state.hands[pid]) {
      if (slot === exceptSlot) continue;
      slot.candidates.delete(cardKeyToRemove);
    }
  }
}

/** Derive the set of played cards from tricks. */
export function getPlayedCards(state: CrewGameState): Set<string> {
  const played = new Set<string>();
  for (const trick of state.tricks) {
    for (const play of trick.cards) {
      played.add(cardKey(play.card.suit, play.card.value));
    }
  }
  return played;
}

/** Remove candidates of a suit from a player's slots, optionally filtered by a value predicate, skipping one slot. */
function removeSuitFromPlayerSlots(state: CrewGameState, playerId: string, suit: number, skipSlot?: CardGuess, valuePredicate: (v: number) => boolean = () => true): void {
  for (const slot of state.hands[playerId]) {
    if (slot === skipSlot) continue;
    for (const value of SUIT_VALUES[suit]) {
      if (valuePredicate(value)) {
        slot.candidates.delete(cardKey(suit, value));
      }
    }
  }
}

/** Simple naked-single constraint propagation: repeat until stable. */
function propagate(state: CrewGameState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const pid of Object.keys(state.hands)) {
      for (const slot of state.hands[pid]) {
        if (slot.candidates.size !== 1) continue;
        const resolved = [...slot.candidates][0];
        for (const pid2 of Object.keys(state.hands)) {
          for (const slot2 of state.hands[pid2]) {
            if (slot2 === slot) continue;
            if (slot2.candidates.delete(resolved)) {
              changed = true;
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Log entry scanning
// ---------------------------------------------------------------------------

/** Find the start index of the last mission in a log entry array. */
function findLastMissionStart(entries: CrewLogEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "handDealt") {
      for (let j = i - 1; j >= 0; j--) {
        if (entries[j].type === "missionStart") return j;
      }
      return i;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Entry handlers
// ---------------------------------------------------------------------------

function applyHandDealt(state: CrewGameState, entry: Extract<CrewLogEntry, { type: "handDealt" }>, playerCardCounts: Record<string, number>): void {
  const myCards = new Set(entry.cards.map(c => cardKey(c.suit, c.value)));
  const totalCards = 40;

  // Build fallback hand sizes from the observer's known hand size: distribute
  // remaining cards among opponents using playerOrder for remainder assignment.
  const fallbackSizes = computeFallbackHandSizes(state, entry.cards.length, totalCards);

  state.tricks = [];
  for (const pid of Object.keys(state.players)) {
    if (pid === state.currentPlayerId) {
      state.hands[pid] = entry.cards.map(c => ({ candidates: new Set([cardKey(c.suit, c.value)]) }));
    } else {
      const handSize = playerCardCounts[pid] ?? fallbackSizes[pid];
      const candidates = initUnknownCandidates(myCards);
      state.hands[pid] = Array.from({ length: handSize }, () => ({ candidates: new Set(candidates) }));
    }
  }
  propagate(state);
}

/** Compute fallback hand sizes for opponents when playerCardCounts is unavailable. */
function computeFallbackHandSizes(state: CrewGameState, observerHandSize: number, totalCards: number): Record<string, number> {
  const hasSeatOrder = state.playerOrder.length > 0;
  const order = hasSeatOrder ? state.playerOrder : Object.keys(state.players);
  const opponents = order.filter(pid => pid !== state.currentPlayerId);
  const remainingCards = totalCards - observerHandSize;
  const baseSize = Math.floor(remainingCards / opponents.length);
  const extraCards = remainingCards % opponents.length;
  const sizes: Record<string, number> = {};
  for (let i = 0; i < opponents.length; i++) {
    // When seat order is unknown, give all opponents the ceiling size so the
    // extra-card slot isn't mis-assigned to the wrong player.
    sizes[opponents[i]] = baseSize + (hasSeatOrder ? (i < extraCards ? 1 : 0) : (extraCards > 0 ? 1 : 0));
  }
  return sizes;
}

function applyCaptain(state: CrewGameState, playerId: string): void {
  const sub4Key = cardKey(SUBMARINE, 4);
  const slot = state.hands[playerId].find(s => s.candidates.has(sub4Key) && s.candidates.size > 1);
  if (slot) {
    slot.candidates = new Set([sub4Key]);
    removeFromAllSlots(state, sub4Key, slot);
    propagate(state);
  }
}

function applyCardPlayed(state: CrewGameState, entry: CardPlayedEntry): void {
  const key = cardKey(entry.card.suit, entry.card.value);

  // Remove the slot from that player's hand
  const playerSlots = state.hands[entry.playerId];
  const slotIdx = playerSlots.findIndex(s => s.candidates.has(key));
  if (slotIdx === -1) throw new Error(`Card ${key} not found in any hand slot for player ${entry.playerId}`);
  playerSlots.splice(slotIdx, 1);

  // Remove card from all remaining slots
  removeFromAllSlots(state, key);

  // Add to current trick
  const trick = state.tricks[state.tricks.length - 1];
  trick.cards.push({ playerId: entry.playerId, card: entry.card });

  // Void detection: off-suit play removes all lead-suit candidates
  const leadSuit = trick.cards[0].card.suit;
  if (trick.cards.length > 1 && entry.card.suit !== leadSuit) {
    removeSuitFromPlayerSlots(state, entry.playerId, leadSuit);
  }

  propagate(state);
}

function applyCommunication(state: CrewGameState, entry: CommunicationEntry): void {
  const commKey = cardKey(entry.card.suit, entry.card.value);

  // Resolve the communicated card's slot
  const commSlot = state.hands[entry.playerId].find(s => s.candidates.has(commKey));
  if (commSlot) {
    commSlot.candidates = new Set([commKey]);
    removeFromAllSlots(state, commKey, commSlot);
  }

  if (entry.position === "middle") {
    removeSuitFromPlayerSlots(state, entry.playerId, entry.card.suit, commSlot);
  } else if (entry.position === "top") {
    removeSuitFromPlayerSlots(state, entry.playerId, entry.card.suit, commSlot, v => v > entry.card.value);
  } else if (entry.position === "bottom") {
    removeSuitFromPlayerSlots(state, entry.playerId, entry.card.suit, commSlot, v => v < entry.card.value);
  }

  propagate(state);
}

// ---------------------------------------------------------------------------
// State processing — replay log entries for the last mission
// ---------------------------------------------------------------------------

/** Replay crew log entries and produce game state for the last mission. */
export function processCrewState(log: CrewGameLog): CrewGameState {
  const state = createCrewGameState(log.players, log.playerOrder, log.currentPlayerId);
  const startIdx = findLastMissionStart(log.log);

  let missionStartCount = 0;
  let handDealtCount = 0;
  for (let i = startIdx; i < log.log.length; i++) {
    if (log.log[i].type === "missionStart") missionStartCount++;
    if (log.log[i].type === "handDealt") handDealtCount++;
    applyEntry(state, log.log[i], log.playerCardCounts);
  }

  // New mission started but cards haven't been dealt yet — clear stale data
  if (missionStartCount > handDealtCount) {
    state.tricks = [];
    for (const pid of Object.keys(state.players)) {
      state.hands[pid] = [];
    }
  }

  return state;
}

/** Apply a single log entry to the game state. */
function applyEntry(state: CrewGameState, entry: CrewLogEntry, playerCardCounts: Record<string, number>): void {
  switch (entry.type) {
    case "missionStart":
      state.missionNumber = entry.missionNumber;
      break;
    case "handDealt":
      applyHandDealt(state, entry, playerCardCounts);
      break;
    case "captain":
      applyCaptain(state, entry.playerId);
      break;
    case "trickStart":
      state.tricks.push({ winnerId: null, cards: [] });
      break;
    case "cardPlayed":
      applyCardPlayed(state, entry);
      break;
    case "trickWon":
      state.tricks[state.tricks.length - 1].winnerId = entry.winnerId;
      break;
    case "communication":
      applyCommunication(state, entry);
      break;
  }
}

// ---------------------------------------------------------------------------
// Player-suit status derivation
// ---------------------------------------------------------------------------

/** Check if a player must hold a card of the given suit (some slot has only this suit as candidates). */
function playerMustHaveSuit(slots: CardGuess[], suit: number): boolean {
  const suitKeys = new Set(SUIT_VALUES[suit].map(v => cardKey(suit, v)));
  return slots.some(slot => slot.candidates.size > 0 && [...slot.candidates].every(k => suitKeys.has(k)));
}

/** Check if any slot has at least one candidate of the given suit. */
function playerMayHaveSuit(slots: CardGuess[], suit: number): boolean {
  return slots.some(slot => SUIT_VALUES[suit].some(v => slot.candidates.has(cardKey(suit, v))));
}

/** Derive the player-suit matrix: X (void), ! (has cards), ? (unknown). */
export function playerSuitStatus(state: CrewGameState): Record<string, Record<number, "X" | "!" | "?">> {
  const result: Record<string, Record<number, "X" | "!" | "?">> = {};
  const played = getPlayedCards(state);

  for (const pid of Object.keys(state.players)) {
    result[pid] = {};
    const slots = state.hands[pid];

    for (const suit of ALL_SUITS) {
      if (playerMustHaveSuit(slots, suit)) {
        result[pid][suit] = "!";
      } else if (!playerMayHaveSuit(slots, suit)) {
        result[pid][suit] = "X";
      } else {
        result[pid][suit] = "?";
      }
    }
  }

  // Upgrade ? to ! when only one non-void player remains for a suit with hidden cards.
  for (const suit of ALL_SUITS) {
    const hiddenCardsExist = SUIT_VALUES[suit].some(v => !played.has(cardKey(suit, v)) && !state.hands[state.currentPlayerId].some(s => s.candidates.size === 1 && s.candidates.has(cardKey(suit, v))));
    if (!hiddenCardsExist) continue;

    const nonVoidPlayers = Object.keys(state.players).filter(pid => result[pid][suit] !== "X");
    if (nonVoidPlayers.length === 1 && result[nonVoidPlayers[0]][suit] === "?") {
      result[nonVoidPlayers[0]][suit] = "!";
    }
  }

  return result;
}
