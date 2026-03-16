import { describe, it, expect } from "vitest";
import { recentTurns, type TurnAction } from "../turn_history.js";
import { processRawLog } from "../process_log.js";

// ---------------------------------------------------------------------------
// Helpers — build raw BGA packets for processRawLog
// ---------------------------------------------------------------------------

/** Create a pair of player+spectator packets for a single move. */
function makePackets(moveId: number, playerNotifs: any[], spectatorNotifs: any[]) {
  return [
    { move_id: moveId, time: moveId, data: playerNotifs },
    { move_id: moveId, time: moveId, data: spectatorNotifs },
  ];
}

/** gameStateChange notification signaling a player action. */
function stateChange(playerId: string, actionNumber: number) {
  return { type: "gameStateChange", args: { id: 4, active_player: playerId, args: { action_number: actionNumber } } };
}

/** Player-channel transferedCard notification with full card info. */
function playerTransfer(overrides: Record<string, unknown> = {}) {
  return { type: "transferedCard", args: { name: null, age: null, location_from: "deck", location_to: "hand", owner_from: "100", owner_to: "100", meld_keyword: false, type: "0", ...overrides } };
}

/** Spectator-channel transferedCard notification (minimal). */
function spectatorTransfer(setType = "0") {
  return { type: "transferedCard_spectator", args: { type: setType } };
}

/** Spectator-channel logWithCardTooltips notification. */
function spectatorLog(msg: string) {
  return { type: "logWithCardTooltips_spectator", args: { log: msg } };
}

const PLAYERS = { "100": "Alice", "200": "Bob" };

function extractActions(packets: any[]): TurnAction[] {
  return processRawLog({ players: PLAYERS, packets: packets.flat() }).actions;
}

// ---------------------------------------------------------------------------
// Action classification (via processRawLog)
// ---------------------------------------------------------------------------

describe("action classification", () => {
  it("returns empty for no gameStateChange", () => {
    const packets = makePackets(1, [playerTransfer()], [spectatorTransfer()]);
    expect(extractActions([packets])).toEqual([]);
  });

  it("classifies meld action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      makePackets(11, [playerTransfer({ name: "Agriculture", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })], [spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" });
  });

  it("classifies draw action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 2)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 2)]),
      makePackets(11, [playerTransfer({ name: "Construction", age: 4, location_from: "deck", location_to: "hand" })], [spectatorTransfer(), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 2, actionType: "draw", cardName: "Construction", cardAge: 4, cardSet: "base" });
  });

  it("classifies draw with unknown card", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
      makePackets(11, [playerTransfer({ age: 2, type: "3" })], [spectatorTransfer("3"), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actionType: "draw", cardName: null, cardAge: 2, cardSet: "echoes" });
  });

  it("classifies dogma action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 2)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 2)]),
      makePackets(11, [], [spectatorLog("Alice activates the dogma of 1 Agriculture with [crown]"), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 2, actionType: "dogma", cardName: "Agriculture" });
  });

  it("classifies endorse action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
      makePackets(11, [], [spectatorLog("Bob endorses the dogma of 3 Compass with [crown]"), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 1, actionType: "endorse", cardName: "Compass" });
  });

  it("classifies achieve action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      makePackets(11, [playerTransfer({ age: 3, location_from: "achievements", location_to: "achievements" })], [spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actionType: "achieve", cardAge: 3 });
  });

  it("classifies pending action (no subsequent entries)", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 1, actionType: "pending" });
  });

  it("handles multiple turns in sequence", () => {
    const actions = extractActions([
      // Alice action 1: marker
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      // Alice action 1: meld Pottery, then marker for action 2
      makePackets(11,
        [playerTransfer({ name: "Pottery", age: 1, location_from: "hand", location_to: "board", meld_keyword: true }), stateChange("100", 2)],
        [spectatorTransfer(), stateChange("100", 2)]),
      // Alice action 2: draw, then marker for Bob action 1
      makePackets(12,
        [playerTransfer({ name: null, age: 1 }), stateChange("200", 1)],
        [spectatorTransfer(), stateChange("200", 1)]),
      // Bob action 1: dogma, then marker for Bob action 2
      makePackets(13,
        [stateChange("200", 2)],
        [spectatorLog("Bob activates the dogma of 1 Agriculture with [leaf]"), stateChange("200", 2)]),
      // Bob action 2: meld Tools
      makePackets(14,
        [playerTransfer({ name: "Tools", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })],
        [spectatorTransfer()]),
    ]);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Pottery" });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 2, actionType: "draw" });
    expect(actions[2]).toMatchObject({ player: "Bob", actionNumber: 1, actionType: "dogma", cardName: "Agriculture" });
    expect(actions[3]).toMatchObject({ player: "Bob", actionNumber: 2, actionType: "meld", cardName: "Tools" });
  });

  it("deduplicates gameStateChange across player and spectator channels", () => {
    const actions = extractActions([
      // Player channel has gameStateChange, spectator channel also has it
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      makePackets(11,
        [playerTransfer({ name: "Pottery", age: 1, location_from: "hand", location_to: "board", meld_keyword: true }), stateChange("100", 2)],
        [spectatorTransfer(), stateChange("100", 2)]),
      makePackets(12,
        [playerTransfer({ name: "Tools", age: 1, location_from: "hand", location_to: "board", meld_keyword: true }), stateChange("200", 1)],
        [spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({ player: "Alice", actionType: "meld", cardName: "Pottery" });
    expect(actions[1]).toMatchObject({ player: "Alice", actionType: "meld", cardName: "Tools" });
    expect(actions[2]).toMatchObject({ player: "Bob", actionType: "pending" });
  });
});

// ---------------------------------------------------------------------------
// recentTurns
// ---------------------------------------------------------------------------

describe("recentTurns", () => {
  const sampleActions: TurnAction[] = [
    { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Pottery", cardAge: 1, cardSet: "base", time: null },
    { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 1, cardSet: "base", time: null },
    { player: "Bob", actionNumber: 1, actionType: "dogma", cardName: "Agriculture", cardAge: null, cardSet: null, time: null },
    { player: "Bob", actionNumber: 2, actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base", time: null },
    { player: "Alice", actionNumber: 1, actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null, time: null },
    { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 2, cardSet: "base", time: null },
  ];

  it("returns empty for count=0", () => {
    expect(recentTurns(sampleActions, 0)).toEqual([]);
  });

  it("returns empty for empty actions", () => {
    expect(recentTurns([], 3)).toEqual([]);
  });

  it("returns last half-turn for count=1, newest action first", () => {
    const result = recentTurns(sampleActions, 1);
    expect(result).toHaveLength(2);
    expect(result[0].player).toBe("Alice");
    expect(result[0].actionType).toBe("draw");
    expect(result[1].player).toBe("Alice");
    expect(result[1].actionType).toBe("dogma");
  });

  it("returns last 2 half-turns for count=2, newest action first", () => {
    const result = recentTurns(sampleActions, 2);
    expect(result).toHaveLength(4);
    // Newest half-turn first (Alice's second turn), newest action first within
    expect(result[0].player).toBe("Alice");
    expect(result[0].actionType).toBe("draw");
    expect(result[1].player).toBe("Alice");
    expect(result[1].actionType).toBe("dogma");
    // Then Bob's turn, newest action first within
    expect(result[2].player).toBe("Bob");
    expect(result[2].actionType).toBe("meld");
    expect(result[3].player).toBe("Bob");
    expect(result[3].actionType).toBe("dogma");
  });

  it("returns last 3 half-turns for count=3, newest action first", () => {
    const result = recentTurns(sampleActions, 3);
    expect(result).toHaveLength(6);
    // All 3 half-turns, newest first, newest action first within each
    expect(result[0]).toMatchObject({ player: "Alice", actionType: "draw" });
    expect(result[1]).toMatchObject({ player: "Alice", actionType: "dogma" });
    expect(result[2]).toMatchObject({ player: "Bob", actionType: "meld" });
    expect(result[3]).toMatchObject({ player: "Bob", actionType: "dogma" });
    expect(result[4]).toMatchObject({ player: "Alice", actionType: "draw" });
    expect(result[5]).toMatchObject({ player: "Alice", actionType: "meld" });
  });

  it("handles count larger than available half-turns", () => {
    const result = recentTurns(sampleActions, 10);
    expect(result).toHaveLength(6); // all actions
  });

  it("first turn (single action) is one half-turn", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Archery", cardAge: 1, cardSet: "base", time: null },
      { player: "Bob", actionNumber: 1, actionType: "meld", cardName: "Oars", cardAge: 1, cardSet: "base", time: null },
      { player: "Bob", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 1, cardSet: "base", time: null },
    ];
    const result = recentTurns(actions, 2);
    expect(result).toHaveLength(3);
    // Bob's turn first (newest), newest action first
    expect(result[0]).toMatchObject({ player: "Bob", actionType: "draw" });
    expect(result[1]).toMatchObject({ player: "Bob", actionType: "meld" });
    // Alice's single action
    expect(result[2]).toMatchObject({ player: "Alice", actionType: "meld" });
  });
});
