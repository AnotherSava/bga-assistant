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

/** Spectator-channel plain-text log notification. */
function spectatorLogPlain(msg: string) {
  return { type: "log_spectator", args: { log: msg } };
}

/** gameStateChange with id:15 — marks start of an artifact-decision turn. */
function stateChange15(playerId: string) {
  return { type: "gameStateChange", args: { id: 15, active_player: playerId } };
}

const PLAYERS = { "100": "Alice", "200": "Bob" };

function extractActions(packets: any[]): TurnAction[] {
  return processRawLog({ gameName: "innovation", players: PLAYERS, packets: packets.flat() }).actions;
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
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] });
  });

  it("classifies draw action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 2)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 2)]),
      makePackets(11, [playerTransfer({ name: "Construction", age: 4, location_from: "deck", location_to: "hand" })], [spectatorTransfer(), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 2, actions: [{ actionType: "draw", cardName: "Construction", cardAge: 4, cardSet: "base" }] });
  });

  it("classifies draw with unknown card", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
      makePackets(11, [playerTransfer({ age: 2, type: "3" })], [spectatorTransfer("3"), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actions: [{ actionType: "draw", cardName: null, cardAge: 2, cardSet: "echoes" }] });
  });

  it("classifies dogma action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 2)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 2)]),
      makePackets(11, [], [spectatorLog("Alice activates the dogma of 1 Agriculture with [crown]"), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 2, actions: [{ actionType: "dogma", cardName: "Agriculture" }] });
  });

  it("classifies endorse action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
      makePackets(11, [], [spectatorLog("Bob endorses the dogma of 3 Compass with [crown]"), stateChange("100", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 1, actions: [{ actionType: "endorse", cardName: "Compass" }] });
  });

  it("classifies achieve action", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      makePackets(11, [playerTransfer({ age: 3, location_from: "achievements", location_to: "achievements" })], [spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "achieve", cardAge: 3 }] });
  });

  it("classifies pending action (no subsequent entries)", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("200", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("200", 1)]),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ player: "Bob", actionNumber: 1, actions: [{ actionType: "pending" }] });
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
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Pottery" }] });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 2, actions: [{ actionType: "draw" }] });
    expect(actions[2]).toMatchObject({ player: "Bob", actionNumber: 1, actions: [{ actionType: "dogma", cardName: "Agriculture" }] });
    expect(actions[3]).toMatchObject({ player: "Bob", actionNumber: 2, actions: [{ actionType: "meld", cardName: "Tools" }] });
  });

  it("classifies artifact_pass as actionNumber:0 with name from display tracking", () => {
    const actions = extractActions([
      // Setup: Alice draws her Artifact onto display at move 5 (no stateChange markers)
      makePackets(5,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "deck", location_to: "display", owner_from: "0", owner_to: "100", type: "1" })],
        [spectatorTransfer("1")]),
      // id:15 opens the artifact window for Alice (standalone move)
      makePackets(9, [stateChange15("100")], [stateChange15("100")]),
      // Pass message arrives
      makePackets(10, [], [spectatorLogPlain("Alice chooses not to return or dogma her Artifact on display.")]),
      // Alice's regular first action: meld
      makePackets(11,
        [stateChange("100", 1), playerTransfer({ name: "Agriculture", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })],
        [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1), spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 0, actions: [{ actionType: "artifact_pass", cardName: "Holmegaard Bows", cardAge: 1, cardSet: "artifacts" }] });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Agriculture" }] });
  });

  it("classifies a regular meld of an Artifact from display→board (table 841259361)", () => {
    // After passing on the pre-turn artifact step, a player may spend one of
    // their two regular actions to meld the Artifact still sitting on their
    // display straight onto the board. The transfer is display→board with
    // meld_keyword=true (vs. the usual hand→board for a meld from hand).
    const actions = extractActions([
      // Setup: Alice draws Holmegaard Bows onto display
      makePackets(5,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "deck", location_to: "display", owner_from: "0", owner_to: "100", type: "1" })],
        [spectatorTransfer("1")]),
      // id:15 opens the artifact window for Alice
      makePackets(9, [stateChange15("100")], [stateChange15("100")]),
      // Alice passes on the pre-turn artifact decision — action_number=1 fires next
      makePackets(10, [],
        [spectatorLogPlain("Alice chooses not to return or dogma her Artifact on display."), stateChange("100", 1)]),
      // Action 1: Alice melds the Artifact from display→board
      makePackets(11,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "display", location_to: "board", owner_from: "100", owner_to: "100", meld_keyword: true, type: "1" })],
        [spectatorTransfer("1"), stateChange("100", 2)]),
      // Action 2: Alice draws an echoes age 4 card
      makePackets(12,
        [playerTransfer({ age: 4, type: "3" })],
        [spectatorTransfer("3"), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 0, actions: [{ actionType: "artifact_pass", cardName: "Holmegaard Bows", cardAge: 1, cardSet: "artifacts" }] });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Holmegaard Bows", cardAge: 1, cardSet: "artifacts" }] });
    expect(actions[2]).toMatchObject({ player: "Alice", actionNumber: 2, actions: [{ actionType: "draw", cardAge: 4, cardSet: "echoes" }] });
  });

  it("classifies a meld of an Artifact from display→board as action 2", () => {
    // The display→board meld is a regular action and may be action 1 or action 2.
    const actions = extractActions([
      // Setup: Bob draws an Artifact onto display
      makePackets(5,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "deck", location_to: "display", owner_from: "0", owner_to: "200", type: "1" })],
        [spectatorTransfer("1")]),
      // Bob passes on the pre-turn artifact decision — action_number=1 fires next
      makePackets(9, [stateChange15("200")], [stateChange15("200")]),
      makePackets(10, [],
        [spectatorLogPlain("Bob chooses not to return or dogma his Artifact on display."), stateChange("200", 1)]),
      // Action 1: Bob draws first
      makePackets(11,
        [playerTransfer({ owner_to: "200", age: 1 })],
        [spectatorTransfer(), stateChange("200", 2)]),
      // Action 2: Bob then melds the Artifact from display→board
      makePackets(12,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "display", location_to: "board", owner_from: "200", owner_to: "200", meld_keyword: true, type: "1" })],
        [spectatorTransfer("1"), stateChange("100", 1)]),
    ]);
    expect(actions[1]).toMatchObject({ player: "Bob", actionNumber: 1, actions: [{ actionType: "draw" }] });
    expect(actions[2]).toMatchObject({ player: "Bob", actionNumber: 2, actions: [{ actionType: "meld", cardName: "Holmegaard Bows", cardSet: "artifacts" }] });
  });

  it("classifies artifact_return as actionNumber:0 with name from transfer", () => {
    const actions = extractActions([
      // Alice draws Tools onto display
      makePackets(5,
        [playerTransfer({ name: "Tools", age: 1, location_from: "deck", location_to: "display", owner_from: "0", owner_to: "100", type: "1" })],
        [spectatorTransfer("1")]),
      // id:15 opens the window
      makePackets(9, [stateChange15("100")], [stateChange15("100")]),
      // Return transfer
      makePackets(10,
        [playerTransfer({ name: "Tools", age: 1, location_from: "display", location_to: "deck", owner_from: "100", owner_to: "0", type: "1" })],
        [spectatorTransfer("1")]),
      // Alice's regular first action
      makePackets(11,
        [stateChange("100", 1), playerTransfer({ name: "Agriculture", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })],
        [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1), spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 0, actions: [{ actionType: "artifact_return", cardName: "Tools", cardAge: 1, cardSet: "artifacts" }] });
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Agriculture" }] });
  });

  it("classifies artifact_dogma (FAD) as actionNumber:0 preceding regular actions", () => {
    const actions = extractActions([
      // Alice draws Holmegaard Bows onto display
      makePackets(5,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "deck", location_to: "display", owner_from: "0", owner_to: "100", type: "1" })],
        [spectatorTransfer("1")]),
      // id:15 opens the window
      makePackets(9, [stateChange15("100")], [stateChange15("100")]),
      // FAD dogma message, followed by the auto-return transfer
      makePackets(10,
        [playerTransfer({ name: "Holmegaard Bows", age: 1, location_from: "display", location_to: "deck", owner_from: "100", owner_to: "0", type: "1" })],
        [spectatorLog("Alice activates the dogma of 1 Holmegaard Bows with [leaf] as the featured icon."), spectatorTransfer("1")]),
      // Alice's regular first action
      makePackets(11,
        [stateChange("100", 1), playerTransfer({ name: "Agriculture", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })],
        [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1), spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions[0]).toMatchObject({ player: "Alice", actionNumber: 0, actions: [{ actionType: "artifact_dogma", cardName: "Holmegaard Bows", cardAge: 1, cardSet: "artifacts" }] });
    // The auto-return transfer is NOT re-classified as artifact_return
    expect(actions.filter((a) => a.actions[0].actionType === "artifact_return")).toHaveLength(0);
    // The regular first action (meld) still classifies
    expect(actions[1]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld", cardName: "Agriculture" }] });
  });

  it("emits no artifact step when id:15 does not fire", () => {
    const actions = extractActions([
      makePackets(10, [stateChange("100", 1)], [{ type: "log_spectator", args: { log: "<!--empty-->" } }, stateChange("100", 1)]),
      makePackets(11, [playerTransfer({ name: "Agriculture", age: 1, location_from: "hand", location_to: "board", meld_keyword: true })], [spectatorTransfer(), stateChange("200", 1)]),
    ]);
    expect(actions.filter((a) => a.actionNumber === 0)).toHaveLength(0);
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
    expect(actions[0]).toMatchObject({ player: "Alice", actions: [{ actionType: "meld", cardName: "Pottery" }] });
    expect(actions[1]).toMatchObject({ player: "Alice", actions: [{ actionType: "meld", cardName: "Tools" }] });
    expect(actions[2]).toMatchObject({ player: "Bob", actions: [{ actionType: "pending" }] });
  });
});

// ---------------------------------------------------------------------------
// recentTurns
// ---------------------------------------------------------------------------

describe("recentTurns", () => {
  const sampleActions: TurnAction[] = [
    { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Pottery", cardAge: 1, cardSet: "base" }] },
    { player: "Alice", actionNumber: 2, time: null, logIndex: 1, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] },
    { player: "Bob", actionNumber: 1, time: null, logIndex: 2, actions: [{ actionType: "dogma", cardName: "Agriculture", cardAge: null, cardSet: null }] },
    { player: "Bob", actionNumber: 2, time: null, logIndex: 3, actions: [{ actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base" }] },
    { player: "Alice", actionNumber: 1, time: null, logIndex: 4, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] },
    { player: "Alice", actionNumber: 2, time: null, logIndex: 5, actions: [{ actionType: "draw", cardName: null, cardAge: 2, cardSet: "base" }] },
  ];

  it("returns empty for count=0", () => {
    expect(recentTurns(sampleActions, 0)).toEqual([]);
  });

  it("returns empty for empty actions", () => {
    expect(recentTurns([], 3)).toEqual([]);
  });

  it("returns last half-turn for count=1, chronological order", () => {
    const result = recentTurns(sampleActions, 1);
    expect(result).toHaveLength(2);
    expect(result[0].player).toBe("Alice");
    expect(result[0].actions[0].actionType).toBe("dogma");
    expect(result[1].player).toBe("Alice");
    expect(result[1].actions[0].actionType).toBe("draw");
  });

  it("returns last 2 half-turns for count=2, chronological order", () => {
    const result = recentTurns(sampleActions, 2);
    expect(result).toHaveLength(4);
    // Oldest half-turn first (Bob's turn), oldest action first within
    expect(result[0].player).toBe("Bob");
    expect(result[0].actions[0].actionType).toBe("dogma");
    expect(result[1].player).toBe("Bob");
    expect(result[1].actions[0].actionType).toBe("meld");
    // Then Alice's second turn, oldest action first within
    expect(result[2].player).toBe("Alice");
    expect(result[2].actions[0].actionType).toBe("dogma");
    expect(result[3].player).toBe("Alice");
    expect(result[3].actions[0].actionType).toBe("draw");
  });

  it("returns last 3 half-turns for count=3, chronological order", () => {
    const result = recentTurns(sampleActions, 3);
    expect(result).toHaveLength(6);
    // All 3 half-turns, chronological order
    expect(result[0]).toMatchObject({ player: "Alice", actions: [{ actionType: "meld" }] });
    expect(result[1]).toMatchObject({ player: "Alice", actions: [{ actionType: "draw" }] });
    expect(result[2]).toMatchObject({ player: "Bob", actions: [{ actionType: "dogma" }] });
    expect(result[3]).toMatchObject({ player: "Bob", actions: [{ actionType: "meld" }] });
    expect(result[4]).toMatchObject({ player: "Alice", actions: [{ actionType: "dogma" }] });
    expect(result[5]).toMatchObject({ player: "Alice", actions: [{ actionType: "draw" }] });
  });

  it("handles count larger than available half-turns", () => {
    const result = recentTurns(sampleActions, 10);
    expect(result).toHaveLength(6); // all actions
  });

  it("groups an artifact step (actionNumber:0) with the following regular actions of the same player", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 2, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 2, cardSet: "base" }] },
      { player: "Alice", actionNumber: 0, time: null, logIndex: 1, actions: [{ actionType: "artifact_pass", cardName: "Tools", cardAge: 1, cardSet: "artifacts" }] },
      { player: "Alice", actionNumber: 1, time: null, logIndex: 2, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
      { player: "Alice", actionNumber: 2, time: null, logIndex: 3, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] },
    ];
    const result = recentTurns(actions, 1);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ player: "Alice", actionNumber: 0, actions: [{ actionType: "artifact_pass" }] });
    expect(result[1]).toMatchObject({ player: "Alice", actionNumber: 1, actions: [{ actionType: "meld" }] });
    expect(result[2]).toMatchObject({ player: "Alice", actionNumber: 2, actions: [{ actionType: "dogma" }] });
  });

  it("first turn (single action) is one half-turn", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Archery", cardAge: 1, cardSet: "base" }] },
      { player: "Bob", actionNumber: 1, time: null, logIndex: 1, actions: [{ actionType: "meld", cardName: "Oars", cardAge: 1, cardSet: "base" }] },
      { player: "Bob", actionNumber: 2, time: null, logIndex: 2, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] },
    ];
    const result = recentTurns(actions, 2);
    expect(result).toHaveLength(3);
    // Chronological: Alice first, then Bob
    expect(result[0]).toMatchObject({ player: "Alice", actions: [{ actionType: "meld" }] });
    expect(result[1]).toMatchObject({ player: "Bob", actions: [{ actionType: "meld" }] });
    expect(result[2]).toMatchObject({ player: "Bob", actions: [{ actionType: "draw" }] });
  });
});
