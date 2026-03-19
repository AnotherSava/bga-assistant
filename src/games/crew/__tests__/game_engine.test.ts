import { describe, it, expect } from "vitest";
import { processCrewState, playerSuitStatus, getPlayedCards } from "../game_engine.js";
import type { CrewGameLog, CrewLogEntry } from "../process_log.js";
import { cardKey, PINK, BLUE, GREEN, YELLOW, SUBMARINE } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(entries: CrewLogEntry[], overrides?: Partial<CrewGameLog>): CrewGameLog {
  return {
    gameName: "thecrewdeepsea",
    players: overrides?.players ?? { "1": "Alice", "2": "Bob", "3": "Charlie", "4": "Diana" },
    playerOrder: overrides?.playerOrder ?? ["1", "2", "3", "4"],
    playerCardCounts: overrides?.playerCardCounts ?? {},
    currentPlayerId: overrides?.currentPlayerId ?? "1",
    log: entries,
  };
}

/** Get resolved card keys from a player's hand slots (candidates.size === 1). */
function resolvedCards(state: ReturnType<typeof processCrewState>, pid: string): Set<string> {
  return new Set(state.hands[pid].filter(s => s.candidates.size === 1).map(s => [...s.candidates][0]));
}

// ---------------------------------------------------------------------------
// processCrewState — initial state after hand dealt
// ---------------------------------------------------------------------------

describe("processCrewState — initial state", () => {
  it("populates observer hand from HandDealtEntry", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 3 }, { suit: BLUE, value: 7 }, { suit: SUBMARINE, value: 2 }] },
    ]);
    const state = processCrewState(log);
    const myResolved = resolvedCards(state, "1");
    expect(myResolved).toEqual(new Set([cardKey(PINK, 3), cardKey(BLUE, 7), cardKey(SUBMARINE, 2)]));
    expect(state.missionNumber).toBe(1);
  });

  it("starts with empty played and tricks", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 1 }] },
    ]);
    const state = processCrewState(log);
    expect(getPlayedCards(state).size).toBe(0);
    expect(state.tricks).toHaveLength(0);
  });

  it("initializes opponent hands with ceiling size when seat order is unknown", () => {
    // 3-player game: 40 cards, observer has 13 → remaining 27 / 2 opponents
    // = 13 base + 1 remainder. Without seat order, both opponents get ceiling (14)
    // to avoid mis-assigning the extra card.
    // Use non-sequential IDs to ensure numeric-ID order doesn't accidentally match seat order.
    const observerCards: { suit: number; value: number }[] = [
      { suit: PINK, value: 1 }, { suit: PINK, value: 2 }, { suit: PINK, value: 3 },
      { suit: PINK, value: 4 }, { suit: PINK, value: 5 }, { suit: PINK, value: 6 },
      { suit: PINK, value: 7 }, { suit: PINK, value: 8 }, { suit: PINK, value: 9 },
      { suit: BLUE, value: 1 }, { suit: BLUE, value: 2 }, { suit: BLUE, value: 3 },
      { suit: BLUE, value: 4 },
    ];
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: observerCards },
    ], {
      players: { "85120": "Alice", "85123": "Bob", "85125": "Charlie" },
      playerOrder: [],
      currentPlayerId: "85120",
    });
    const state = processCrewState(log);
    expect(state.hands["85120"]).toHaveLength(13);
    // Without seat order, both opponents get ceiling size (14)
    expect(state.hands["85123"]).toHaveLength(14);
    expect(state.hands["85125"]).toHaveLength(14);

    // Opponent candidates should NOT contain observer's cards
    for (const slot of state.hands["85123"]) {
      expect(slot.candidates.has(cardKey(PINK, 3))).toBe(false);
      expect(slot.candidates.has(cardKey(BLUE, 4))).toBe(false);
    }
  });

  it("assigns extra card by seat order when playerOrder is known", () => {
    // 3-player game with known seat order: first opponent in order gets 14, second gets 13
    const observerCards: { suit: number; value: number }[] = [
      { suit: PINK, value: 1 }, { suit: PINK, value: 2 }, { suit: PINK, value: 3 },
      { suit: PINK, value: 4 }, { suit: PINK, value: 5 }, { suit: PINK, value: 6 },
      { suit: PINK, value: 7 }, { suit: PINK, value: 8 }, { suit: PINK, value: 9 },
      { suit: BLUE, value: 1 }, { suit: BLUE, value: 2 }, { suit: BLUE, value: 3 },
      { suit: BLUE, value: 4 },
    ];
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: observerCards },
    ], {
      players: { "85120": "Alice", "85123": "Bob", "85125": "Charlie" },
      playerOrder: ["85125", "85120", "85123"],
      currentPlayerId: "85120",
    });
    const state = processCrewState(log);
    expect(state.hands["85120"]).toHaveLength(13);
    // Seat order (excluding observer): "85125", "85123" → first gets 14, second gets 13
    expect(state.hands["85125"]).toHaveLength(14);
    expect(state.hands["85123"]).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// processCrewState — captain card tracking
// ---------------------------------------------------------------------------

describe("processCrewState — captain", () => {
  it("resolves Submarine 4 slot for captain", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "captain", playerId: "3" },
    ]);
    const state = processCrewState(log);
    const resolved = resolvedCards(state, "3");
    expect(resolved.has(cardKey(SUBMARINE, 4))).toBe(true);
  });

  it("captain known card is removed when played", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "captain", playerId: "3" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "3", card: { suit: SUBMARINE, value: 4 } },
    ]);
    const state = processCrewState(log);
    const resolved = resolvedCards(state, "3");
    expect(resolved.has(cardKey(SUBMARINE, 4))).toBe(false);
    expect(getPlayedCards(state).has(cardKey(SUBMARINE, 4))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processCrewState — void detection
// ---------------------------------------------------------------------------

describe("processCrewState — void detection", () => {
  it("detects void when player plays off-suit", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 5 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 5 } },
      { type: "cardPlayed", playerId: "2", card: { suit: BLUE, value: 3 } },
    ]);
    const state = processCrewState(log);
    // Player 2 has no pink candidates in any slot
    const hasPink = state.hands["2"].some(s => [...s.candidates].some(k => k.startsWith(`${PINK}:`)));
    expect(hasPink).toBe(false);
  });

  it("does not mark lead player as void", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 5 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 5 } },
      { type: "cardPlayed", playerId: "2", card: { suit: PINK, value: 3 } },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    // Neither player should be void in pink just from following suit
    expect(status["2"][PINK]).not.toBe("X");
  });

  it("submarine on color lead means void in lead suit", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: GREEN, value: 7 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: GREEN, value: 7 } },
      { type: "cardPlayed", playerId: "2", card: { suit: SUBMARINE, value: 1 } },
    ]);
    const state = processCrewState(log);
    // Player 2 has no green candidates in any slot
    const hasGreen = state.hands["2"].some(s => [...s.candidates].some(k => k.startsWith(`${GREEN}:`)));
    expect(hasGreen).toBe(false);
  });

  it("voids persist across tricks", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 5 }, { suit: YELLOW, value: 2 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 5 } },
      { type: "cardPlayed", playerId: "2", card: { suit: BLUE, value: 3 } },
      { type: "trickWon", winnerId: "1" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: YELLOW, value: 2 } },
    ]);
    const state = processCrewState(log);
    // Player 2 still has no pink candidates
    const hasPink = state.hands["2"].some(s => [...s.candidates].some(k => k.startsWith(`${PINK}:`)));
    expect(hasPink).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processCrewState — communication tracking
// ---------------------------------------------------------------------------

describe("processCrewState — communication", () => {
  it("resolves communicated card in player's hand", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: BLUE, value: 8 }, position: "top" },
    ]);
    const state = processCrewState(log);
    const resolved = resolvedCards(state, "2");
    expect(resolved.has(cardKey(BLUE, 8))).toBe(true);
  });

  it("communicated card removed from hand when played", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: BLUE, value: 8 }, position: "top" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "2", card: { suit: BLUE, value: 8 } },
    ]);
    const state = processCrewState(log);
    const resolved = resolvedCards(state, "2");
    expect(resolved.has(cardKey(BLUE, 8))).toBe(false);
  });

  it("'middle' = only card — removes all other candidates of that suit from player's slots", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: GREEN, value: 5 }, position: "middle" },
    ]);
    const state = processCrewState(log);
    // No other slot of player 2 should have any green candidate
    for (const slot of state.hands["2"]) {
      if (slot.candidates.size === 1 && slot.candidates.has(cardKey(GREEN, 5))) continue;
      const hasGreen = [...slot.candidates].some(k => k.startsWith(`${GREEN}:`));
      expect(hasGreen).toBe(false);
    }
  });

  it("'middle' card played marks player void via candidate removal", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: GREEN, value: 5 }, position: "middle" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "3", card: { suit: GREEN, value: 9 } },
      { type: "cardPlayed", playerId: "2", card: { suit: GREEN, value: 5 } },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["2"][GREEN]).toBe("X");
  });

  it("'top' removes higher values of that suit from other slots", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: BLUE, value: 5 }, position: "top" },
    ]);
    const state = processCrewState(log);
    // No slot of player 2 (other than the resolved one) should have blue 6-9
    for (const slot of state.hands["2"]) {
      if (slot.candidates.size === 1 && slot.candidates.has(cardKey(BLUE, 5))) continue;
      for (const v of [6, 7, 8, 9]) {
        expect(slot.candidates.has(cardKey(BLUE, v))).toBe(false);
      }
    }
  });

  it("'bottom' removes lower values of that suit from other slots", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: BLUE, value: 5 }, position: "bottom" },
    ]);
    const state = processCrewState(log);
    // No slot of player 2 (other than the resolved one) should have blue 1-4
    for (const slot of state.hands["2"]) {
      if (slot.candidates.size === 1 && slot.candidates.has(cardKey(BLUE, 5))) continue;
      for (const v of [1, 2, 3, 4]) {
        expect(slot.candidates.has(cardKey(BLUE, v))).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// processCrewState — multi-trick progression
// ---------------------------------------------------------------------------

describe("processCrewState — trick progression", () => {
  it("tracks completed tricks and current trick separately", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 5 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 5 } },
      { type: "cardPlayed", playerId: "2", card: { suit: PINK, value: 3 } },
      { type: "cardPlayed", playerId: "3", card: { suit: PINK, value: 9 } },
      { type: "cardPlayed", playerId: "4", card: { suit: PINK, value: 1 } },
      { type: "trickWon", winnerId: "3" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "3", card: { suit: BLUE, value: 7 } },
    ]);
    const state = processCrewState(log);

    expect(state.tricks).toHaveLength(2);
    // First trick: completed — lead suit derived from first card
    expect(state.tricks[0].cards[0].card.suit).toBe(PINK);
    expect(state.tricks[0].winnerId).toBe("3");
    expect(state.tricks[0].cards).toHaveLength(4);
    // Second trick: in progress
    expect(state.tricks[1].cards[0].card.suit).toBe(BLUE);
    expect(state.tricks[1].winnerId).toBeNull();
    expect(state.tricks[1].cards).toHaveLength(1);
  });

  it("removes played card from observer's hand", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 5 }, { suit: BLUE, value: 2 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 5 } },
    ]);
    const state = processCrewState(log);
    const resolved = resolvedCards(state, "1");
    expect(resolved.has(cardKey(PINK, 5))).toBe(false);
    expect(resolved.has(cardKey(BLUE, 2))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processCrewState — last mission only
// ---------------------------------------------------------------------------

describe("processCrewState — multi-mission (uses last)", () => {
  it("processes only the last mission", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 1 }] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 1 } },
      { type: "trickWon", winnerId: "1" },
      // Second mission
      { type: "missionStart", missionId: 5, missionNumber: 5 },
      { type: "handDealt", cards: [{ suit: BLUE, value: 9 }, { suit: GREEN, value: 3 }] },
      { type: "captain", playerId: "4" },
    ]);
    const state = processCrewState(log);

    expect(state.missionNumber).toBe(5);
    const myResolved = resolvedCards(state, "1");
    expect(myResolved).toEqual(new Set([cardKey(BLUE, 9), cardKey(GREEN, 3)]));
    // First mission's played cards should not carry over
    expect(getPlayedCards(state).size).toBe(0);
    expect(state.tricks).toHaveLength(0);
    // Captain from second mission should be tracked
    expect(resolvedCards(state, "4").has(cardKey(SUBMARINE, 4))).toBe(true);
  });

  it("resets state when newHand arrives before startNewMission (BGA ordering)", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 16, missionNumber: 16 },
      { type: "handDealt", cards: [{ suit: PINK, value: 1 }] },
      { type: "captain", playerId: "2" },
      { type: "communication", playerId: "3", card: { suit: GREEN, value: 5 }, position: "top" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 1 } },
      { type: "cardPlayed", playerId: "2", card: { suit: PINK, value: 7 } },
      { type: "cardPlayed", playerId: "3", card: { suit: BLUE, value: 2 } },
      { type: "cardPlayed", playerId: "4", card: { suit: PINK, value: 4 } },
      { type: "trickWon", winnerId: "2" },
      // BGA emits newHand before startNewMission for mission 17
      { type: "handDealt", cards: [{ suit: BLUE, value: 9 }] },
      { type: "missionStart", missionId: 17, missionNumber: 17 },
      { type: "captain", playerId: "4" },
    ]);
    const state = processCrewState(log);

    expect(state.missionNumber).toBe(17);
    const myResolved = resolvedCards(state, "1");
    expect(myResolved).toEqual(new Set([cardKey(BLUE, 9)]));
    // Mission 16 state must not leak
    expect(getPlayedCards(state).size).toBe(0);
    expect(state.tricks).toHaveLength(0);
    // Voids from mission 16 must be cleared — player 3 should have pink candidates again
    const p3HasPink = state.hands["3"].some(s => [...s.candidates].some(k => k.startsWith(`${PINK}:`)));
    expect(p3HasPink).toBe(true);
    // Captain from mission 17 should be tracked (not mission 16's captain)
    expect(resolvedCards(state, "2").has(cardKey(SUBMARINE, 4))).toBe(false);
    expect(resolvedCards(state, "4").has(cardKey(SUBMARINE, 4))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playerSuitStatus — X/!/? derivation
// ---------------------------------------------------------------------------

describe("playerSuitStatus", () => {
  it("observer shows ! for suits in hand, X otherwise", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [{ suit: PINK, value: 3 }, { suit: BLUE, value: 7 }] },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["1"][PINK]).toBe("!");
    expect(status["1"][BLUE]).toBe("!");
    expect(status["1"][GREEN]).toBe("X");
    expect(status["1"][YELLOW]).toBe("X");
    expect(status["1"][SUBMARINE]).toBe("X");
  });

  it("X for void players", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "2", card: { suit: PINK, value: 5 } },
      { type: "cardPlayed", playerId: "3", card: { suit: BLUE, value: 3 } },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["3"][PINK]).toBe("X");
  });

  it("! for player with known unplayed communicated card", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: GREEN, value: 4 }, position: "top" },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["2"][GREEN]).toBe("!");
  });

  it("! for captain with Submarine 4", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "captain", playerId: "3" },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["3"][SUBMARINE]).toBe("!");
  });

  it("X when 'middle' communicated card has been played (only card → void)", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
      { type: "communication", playerId: "2", card: { suit: GREEN, value: 5 }, position: "middle" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "3", card: { suit: GREEN, value: 9 } },
      { type: "cardPlayed", playerId: "2", card: { suit: GREEN, value: 5 } },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["2"][GREEN]).toBe("X");
  });

  it("? when no information is available", () => {
    const log = makeLog([
      { type: "missionStart", missionId: 1, missionNumber: 1 },
      { type: "handDealt", cards: [] },
    ]);
    const state = processCrewState(log);
    const status = playerSuitStatus(state);
    expect(status["2"][PINK]).toBe("?");
    expect(status["3"][BLUE]).toBe("?");
    expect(status["4"][SUBMARINE]).toBe("?");
  });
});
