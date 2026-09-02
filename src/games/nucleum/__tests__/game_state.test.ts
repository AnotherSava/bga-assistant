import { describe, it, expect } from "vitest";
import { createNucleumGameState, toJSON, fromJSON, type NucleumGameState } from "../game_state.js";
import type { NucleumTurnAction } from "../types.js";
import { mkPlayers } from "../../../__tests__/helpers/players.js";

const PLAYERS = mkPlayers({ "100": "Alice", "200": "Bob" }, "100");

function mkState(): NucleumGameState {
  const action: NucleumTurnAction = {
    player: "100",
    actionNumber: 1,
    time: 1788203467,
    logIndex: 4,
    actions: [
      { actionType: "railway", player: "100", city: null, link: [1, 18], count: null, label: null },
      { actionType: "develop", player: "100", city: null, link: null, count: 2, label: null },
    ],
  };
  return { players: PLAYERS, actions: [action] };
}

describe("createNucleumGameState", () => {
  it("starts with the players and no turns", () => {
    expect(createNucleumGameState(PLAYERS)).toEqual({ players: PLAYERS, actions: [] });
  });
});

describe("nucleum serialization", () => {
  it("round-trips a state unchanged", () => {
    const state = mkState();
    expect(fromJSON(toJSON(state))).toEqual(state);
  });

  it("stamps the game name so the panel can dispatch on it", () => {
    expect(toJSON(mkState()).gameName).toBe("nucleum");
  });

  it("survives a JSON round trip, since it crosses a message boundary", () => {
    const json = toJSON(mkState());
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("copies rather than aliases, so the panel cannot mutate the worker's state", () => {
    const state = mkState();
    const json = toJSON(state);
    json.actions[0].actions[0].link = [3, 5];
    json.players["100"].name = "Mallory";
    expect(state.actions[0].actions[0].link).toEqual([1, 18]);
    expect(state.players["100"].name).toBe("Alice");
  });

  it("handles an empty state", () => {
    const empty = { players: {}, actions: [] };
    expect(fromJSON(toJSON(empty))).toEqual(empty);
  });
});
