import { describe, it, expect } from "vitest";
import { crewToJSON, crewFromJSON } from "../serialization.js";
import { processCrewState } from "../game_engine.js";
import type { CrewGameLog } from "../process_log.js";
import { cardKey, PINK, BLUE, GREEN, YELLOW, SUBMARINE } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestState(): ReturnType<typeof processCrewState> {
  const log: CrewGameLog = {
    players: { "1": "Alice", "2": "Bob", "3": "Charlie" },
    playerOrder: ["1", "2", "3"],
    playerCardCounts: {},
    currentPlayerId: "1",
    log: [
      { type: "missionStart", missionId: 7, missionNumber: 7 },
      { type: "handDealt", cards: [{ suit: PINK, value: 3 }, { suit: BLUE, value: 7 }, { suit: SUBMARINE, value: 2 }] },
      { type: "captain", playerId: "2" },
      { type: "communication", playerId: "3", card: { suit: GREEN, value: 5 }, position: "bottom" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "1", card: { suit: PINK, value: 3 } },
      { type: "cardPlayed", playerId: "2", card: { suit: YELLOW, value: 1 } },
      { type: "cardPlayed", playerId: "3", card: { suit: PINK, value: 9 } },
      { type: "trickWon", winnerId: "3" },
      { type: "trickStart" },
      { type: "cardPlayed", playerId: "3", card: { suit: BLUE, value: 4 } },
    ],
  };
  return processCrewState(log);
}

// ---------------------------------------------------------------------------
// Roundtrip fidelity
// ---------------------------------------------------------------------------

describe("crew serialization — roundtrip", () => {
  it("preserves all state through toJSON/fromJSON", () => {
    const original = buildTestState();
    const json = crewToJSON(original);
    const restored = crewFromJSON(json);

    expect(restored.players).toEqual(original.players);
    expect(restored.playerOrder).toEqual(original.playerOrder);
    expect(restored.currentPlayerId).toBe(original.currentPlayerId);
    expect(restored.missionNumber).toBe(original.missionNumber);
    expect(restored.tricks).toEqual(original.tricks);
  });

  it("preserves hand slot candidates through roundtrip", () => {
    const original = buildTestState();
    const json = crewToJSON(original);
    const restored = crewFromJSON(json);

    for (const pid of Object.keys(original.hands)) {
      expect(restored.hands[pid].length).toBe(original.hands[pid].length);
      for (let i = 0; i < original.hands[pid].length; i++) {
        expect(restored.hands[pid][i].candidates).toEqual(original.hands[pid][i].candidates);
        expect(restored.hands[pid][i].candidates).toBeInstanceOf(Set);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// JSON shape
// ---------------------------------------------------------------------------

describe("crew serialization — JSON shape", () => {
  it("serializes hands as Record<string, string[][]>", () => {
    const original = buildTestState();
    const json = crewToJSON(original);

    for (const [pid, slots] of Object.entries(json.hands)) {
      expect(Array.isArray(slots)).toBe(true);
      for (const candidates of slots) {
        expect(Array.isArray(candidates)).toBe(true);
        // Each candidate array should be sorted
        const sorted = [...candidates].sort();
        expect(candidates).toEqual(sorted);
      }
    }
  });

  it("produces valid JSON (no undefined, no Set objects)", () => {
    const original = buildTestState();
    const json = crewToJSON(original);
    const str = JSON.stringify(json);
    const parsed = JSON.parse(str);
    expect(parsed).toEqual(json);
  });
});

// ---------------------------------------------------------------------------
// Edge case: empty state
// ---------------------------------------------------------------------------

describe("crew serialization — empty state", () => {
  it("handles state with no tricks", () => {
    const log: CrewGameLog = {
      players: { "1": "Alice", "2": "Bob", "3": "Charlie" },
      playerOrder: ["1", "2", "3"],
      playerCardCounts: {},
      currentPlayerId: "1",
      log: [
        { type: "missionStart", missionId: 1, missionNumber: 1 },
        { type: "handDealt", cards: [] },
      ],
    };
    const state = processCrewState(log);
    const json = crewToJSON(state);
    const restored = crewFromJSON(json);

    expect(restored.hands["1"]).toHaveLength(0);
    expect(restored.tricks).toHaveLength(0);
  });
});
