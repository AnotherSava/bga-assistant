import { describe, it, expect } from "vitest";
import { buildTurnHistory, recentTurns } from "../turn_history.js";
import type { GameLogEntry, TurnMarkerEntry, TransferEntry, MessageEntry } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function marker(move: number, player: string, actionNumber: number): TurnMarkerEntry {
  return { type: "turnMarker", move, player, actionNumber };
}

function transfer(move: number, overrides: Partial<TransferEntry> = {}): TransferEntry {
  return {
    type: "transfer",
    move,
    cardSet: "base",
    source: "deck",
    dest: "hand",
    cardName: null,
    cardAge: null,
    sourceOwner: null,
    destOwner: null,
    meldKeyword: false,
    ...overrides,
  };
}

function msg(move: number, message: string, type: "log" | "logWithCardTooltips" = "logWithCardTooltips"): MessageEntry {
  return { type, move, msg: message };
}

// ---------------------------------------------------------------------------
// buildTurnHistory
// ---------------------------------------------------------------------------

describe("buildTurnHistory", () => {
  it("returns empty array for empty log", () => {
    expect(buildTurnHistory([])).toEqual([]);
  });

  it("returns empty array for log with no turnMarkers", () => {
    const log: GameLogEntry[] = [
      transfer(1, { source: "deck", dest: "hand" }),
      msg(1, "some log message"),
    ];
    expect(buildTurnHistory(log)).toEqual([]);
  });

  it("classifies meld action", () => {
    const log: GameLogEntry[] = [
      marker(10, "Alice", 1),
      transfer(10, { source: "hand", dest: "board", meldKeyword: true, cardName: "Agriculture", cardAge: 1, cardSet: "base" }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      player: "Alice",
      actionNumber: 1,
      actionType: "meld",
      cardName: "Agriculture",
      cardAge: 1,
      cardSet: "base",
    });
  });

  it("classifies draw action", () => {
    const log: GameLogEntry[] = [
      marker(20, "Bob", 2),
      transfer(20, { source: "deck", dest: "hand", cardName: "Construction", cardAge: 4, cardSet: "base" }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      player: "Bob",
      actionNumber: 2,
      actionType: "draw",
      cardName: "Construction",
      cardAge: 4,
      cardSet: "base",
    });
  });

  it("classifies draw with unknown card (no name)", () => {
    const log: GameLogEntry[] = [
      marker(20, "Bob", 1),
      transfer(20, { source: "deck", dest: "hand", cardName: null, cardAge: 2, cardSet: "echoes" }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions[0].actionType).toBe("draw");
    expect(actions[0].cardName).toBeNull();
    expect(actions[0].cardAge).toBe(2);
    expect(actions[0].cardSet).toBe("echoes");
  });

  it("classifies dogma action", () => {
    const log: GameLogEntry[] = [
      marker(30, "Alice", 2),
      msg(30, "Alice activates the dogma of 1 Agriculture with [crown]"),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("dogma");
    expect(actions[0].cardName).toBe("Agriculture");
  });

  it("classifies endorse action", () => {
    const log: GameLogEntry[] = [
      marker(35, "Bob", 1),
      msg(35, "Bob endorses the dogma of 3 Compass with [crown]"),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("endorse");
    expect(actions[0].cardName).toBe("Compass");
  });

  it("classifies achieve action", () => {
    const log: GameLogEntry[] = [
      marker(40, "Alice", 1),
      transfer(40, { source: "achievements", dest: "achievements", cardAge: 3 }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("achieve");
    expect(actions[0].cardAge).toBe(3);
  });

  it("classifies pending action (no subsequent entries)", () => {
    const log: GameLogEntry[] = [
      marker(50, "Bob", 1),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("pending");
    expect(actions[0].player).toBe("Bob");
  });

  it("classifies pending when subsequent entries are in different move", () => {
    const log: GameLogEntry[] = [
      marker(50, "Bob", 1),
      transfer(99, { source: "deck", dest: "hand" }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("pending");
  });

  it("handles multiple turns in sequence", () => {
    const log: GameLogEntry[] = [
      // Alice action 1: meld
      marker(10, "Alice", 1),
      transfer(10, { source: "hand", dest: "board", meldKeyword: true, cardName: "Pottery", cardAge: 1 }),
      // Alice action 2: draw
      marker(11, "Alice", 2),
      transfer(11, { source: "deck", dest: "hand", cardAge: 1 }),
      // Bob action 1: dogma
      marker(12, "Bob", 1),
      msg(12, "Bob activates the dogma of 1 Agriculture with [leaf]"),
      transfer(12, { source: "deck", dest: "hand", cardAge: 1 }), // effect of dogma
      // Bob action 2: meld
      marker(13, "Bob", 2),
      transfer(13, { source: "hand", dest: "board", meldKeyword: true, cardName: "Tools", cardAge: 1 }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Pottery" });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 2, actionType: "draw" });
    expect(actions[2]).toMatchObject({ player: "Bob", actionNumber: 1, actionType: "dogma", cardName: "Agriculture" });
    expect(actions[3]).toMatchObject({ player: "Bob", actionNumber: 2, actionType: "meld", cardName: "Tools" });
  });

  it("first turn: single action produces 1-action result", () => {
    const log: GameLogEntry[] = [
      marker(1, "Alice", 1),
      transfer(1, { source: "hand", dest: "board", meldKeyword: true, cardName: "Archery", cardAge: 1 }),
      // Bob gets 2 actions
      marker(2, "Bob", 1),
      transfer(2, { source: "hand", dest: "board", meldKeyword: true, cardName: "Oars", cardAge: 1 }),
      marker(3, "Bob", 2),
      transfer(3, { source: "deck", dest: "hand", cardAge: 1 }),
    ];
    const actions = buildTurnHistory(log);
    expect(actions).toHaveLength(3);
    // Alice only has 1 action
    const aliceActions = actions.filter((a) => a.player === "Alice");
    expect(aliceActions).toHaveLength(1);
    expect(aliceActions[0].actionNumber).toBe(1);
  });

  it("ignores entries from different moves when classifying", () => {
    const log: GameLogEntry[] = [
      marker(10, "Alice", 1),
      // These belong to a different move — should not affect Alice's classification
      transfer(99, { source: "hand", dest: "board", meldKeyword: true, cardName: "X" }),
      msg(99, "Alice activates the dogma of 1 Something with [crown]"),
    ];
    const actions = buildTurnHistory(log);
    expect(actions[0].actionType).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// recentTurns
// ---------------------------------------------------------------------------

describe("recentTurns", () => {
  const sampleActions: ReturnType<typeof buildTurnHistory> = [
    { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Pottery", cardAge: 1, cardSet: "base" },
    { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" },
    { player: "Bob", actionNumber: 1, actionType: "dogma", cardName: "Agriculture", cardAge: null, cardSet: null },
    { player: "Bob", actionNumber: 2, actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base" },
    { player: "Alice", actionNumber: 1, actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null },
    { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 2, cardSet: "base" },
  ];

  it("returns empty for count=0", () => {
    expect(recentTurns(sampleActions, 0)).toEqual([]);
  });

  it("returns empty for empty actions", () => {
    expect(recentTurns([], 3)).toEqual([]);
  });

  it("returns last half-turn for count=1", () => {
    const result = recentTurns(sampleActions, 1);
    expect(result).toHaveLength(2);
    expect(result[0].player).toBe("Alice");
    expect(result[0].actionType).toBe("dogma");
    expect(result[1].player).toBe("Alice");
    expect(result[1].actionType).toBe("draw");
  });

  it("returns last 2 half-turns for count=2", () => {
    const result = recentTurns(sampleActions, 2);
    expect(result).toHaveLength(4);
    // Newest half-turn first (Alice's second turn)
    expect(result[0].player).toBe("Alice");
    expect(result[0].actionType).toBe("dogma");
    expect(result[1].player).toBe("Alice");
    expect(result[1].actionType).toBe("draw");
    // Then Bob's turn
    expect(result[2].player).toBe("Bob");
    expect(result[2].actionType).toBe("dogma");
    expect(result[3].player).toBe("Bob");
    expect(result[3].actionType).toBe("meld");
  });

  it("returns last 3 half-turns for count=3", () => {
    const result = recentTurns(sampleActions, 3);
    expect(result).toHaveLength(6);
    // All 3 half-turns, newest first
    expect(result[0].player).toBe("Alice");
    expect(result[1].player).toBe("Alice");
    expect(result[2].player).toBe("Bob");
    expect(result[3].player).toBe("Bob");
    expect(result[4].player).toBe("Alice");
    expect(result[5].player).toBe("Alice");
  });

  it("handles count larger than available half-turns", () => {
    const result = recentTurns(sampleActions, 10);
    expect(result).toHaveLength(6); // all actions
  });

  it("first turn (single action) is one half-turn", () => {
    const actions = [
      { player: "Alice", actionNumber: 1, actionType: "meld" as const, cardName: "Archery", cardAge: 1, cardSet: "base" },
      { player: "Bob", actionNumber: 1, actionType: "meld" as const, cardName: "Oars", cardAge: 1, cardSet: "base" },
      { player: "Bob", actionNumber: 2, actionType: "draw" as const, cardName: null, cardAge: 1, cardSet: "base" },
    ];
    const result = recentTurns(actions, 2);
    expect(result).toHaveLength(3);
    // Bob's turn first (newest)
    expect(result[0].player).toBe("Bob");
    expect(result[1].player).toBe("Bob");
    // Alice's single action
    expect(result[2].player).toBe("Alice");
  });
});
