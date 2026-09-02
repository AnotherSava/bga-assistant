import { describe, it, expect } from "vitest";
import { processNucleumLog, type NucleumLogEntry } from "../process_log.js";
import { mkPlayers } from "../../../__tests__/helpers/players.js";

// ---------------------------------------------------------------------------
// Helpers — build raw BGA packets for processNucleumLog
// ---------------------------------------------------------------------------

const PLAYERS = mkPlayers({ "100": "Alice", "200": "Bob" }, "100");

/* eslint-disable @typescript-eslint/no-explicit-any */

function makePacket(moveId: number, notifs: any[]) {
  return { move_id: moveId, time: moveId, data: notifs };
}

/** `gameStateChange id:2` with the main-action prompt up — the start of a turn. */
function turnStart(playerId: string, overrides: Record<string, unknown> = {}) {
  return { type: "gameStateChange", args: { id: 2, active_player: playerId, args: { main: true, realActive: true, ...overrides } } };
}

/** `gameStateChange id:2` for a step inside a turn. */
function subState(playerId: string, overrides: Record<string, unknown> = {}) {
  return { type: "gameStateChange", args: { id: 2, active_player: playerId, args: { main: false, realActive: true, ...overrides } } };
}

/** `gameStateChange id:3` — its active player is the one who just finished. */
function turnEnd(playerId: string) {
  return { type: "gameStateChange", args: { id: 3, active_player: playerId, args: [] } };
}

function notif(type: string, args: Record<string, unknown> = {}) {
  return { type, args };
}

function process(packets: any[]): NucleumLogEntry[] {
  return processNucleumLog({ gameName: "nucleum", players: PLAYERS, packets }).log;
}

/** Everything but the turn scaffolding, which most cases assert separately. */
function actionsOf(packets: any[]): NucleumLogEntry[] {
  return process(packets).filter(e => e.type !== "turnStart" && e.type !== "turnEnd");
}

// ---------------------------------------------------------------------------
// processNucleumLog — turn boundaries
// ---------------------------------------------------------------------------

describe("processNucleumLog — turn boundaries", () => {
  it("records a turn start from a main-action state", () => {
    expect(process([makePacket(1, [turnStart("100")])])).toEqual([{ type: "turnStart", player: "100", time: 1 }]);
  });

  it("ignores states inside a turn", () => {
    expect(process([makePacket(1, [subState("100")])])).toEqual([]);
  });

  it("records a turn end against the player who just finished", () => {
    expect(process([makePacket(2, [turnEnd("100")])])).toEqual([{ type: "turnEnd", player: "100" }]);
  });

  it("normalizes a numeric active player id to a string", () => {
    const log = process([makePacket(1, [{ type: "gameStateChange", args: { id: 2, active_player: 100, args: { main: true } } }])]);
    expect(log).toEqual([{ type: "turnStart", player: "100", time: 1 }]);
  });

  it("carries the packet time onto the turn start", () => {
    const log = process([{ move_id: 7, time: 1788203467, data: [turnStart("200")] }]);
    expect(log[0]).toMatchObject({ type: "turnStart", time: 1788203467 });
  });
});

// ---------------------------------------------------------------------------
// processNucleumLog — actions
// ---------------------------------------------------------------------------

describe("processNucleumLog — actions", () => {
  it("records a tile played to the player board", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("playTile", { player_name: "Alice", tile: 50, slot: 2 })])]))
      .toEqual([{ type: "playTile", player: "100", slot: 2 }]);
  });

  it("records a tile placed as a railway", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("placeTile", { player_name: "Alice", tile: 43, road: 14, rot: 0 })])]))
      .toEqual([{ type: "railway", player: "100", tile: 43, road: 14 }]);
  });

  it("records a building, a mine and a turbine with their city", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("urbanize", { player_name: "Alice", buildingId: 51, city: 4, idx: 1 }),
      notif("placeMine", { player_name: "Alice", id: 39, city: 12, idx: 1 }),
      notif("placeTurbine", { player_name: "Alice", id: 96, city: 1, idx: 0 }),
    ])]);
    expect(log).toEqual([
      { type: "urbanize", player: "100", city: 4 },
      { type: "mine", player: "100", city: 12 },
      { type: "turbine", player: "100", city: 1 },
    ]);
  });

  it("reads a named getActionTiles as develop, counting the tiles bought", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("getActionTiles", { player_name: "Alice", tiles: [3, 4] })])]))
      .toEqual([{ type: "develop", player: "100", count: 2 }]);
  });

  it("reads a nameless getActionTiles as the active player's recharge", () => {
    expect(actionsOf([makePacket(1, [turnStart("200"), notif("getActionTiles", { tiles: [50, 52, 49] })])]))
      .toEqual([{ type: "recharge", player: "200" }]);
  });

  it("records taking and fulfilling a contract", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("getContract", { player_name: "Alice", contract: 11, slot: 2 }),
      notif("resolveContract", { player_name: "Alice", contract: 11 }),
    ])]);
    expect(log).toEqual([{ type: "contract", player: "100" }, { type: "fulfill", player: "100" }]);
  });

  it("takes the energize power plant from the startEnergize before it", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("startEnergize", { plant: 3, energy: 1 }),
      notif("energize", { player_name: "Alice", buildingId: 84, amountC: 2, amountU: 0 }),
    ])]);
    expect(log).toEqual([{ type: "energize", player: "100", city: 3 }]);
  });

  it("leaves the plant null when energize arrives without a startEnergize", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("energize", { player_name: "Alice", buildingId: 84 })])]))
      .toEqual([{ type: "energize", player: "100", city: null }]);
  });

  it("does not reuse a power plant across two energize actions", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("startEnergize", { plant: 3, energy: 0 }),
      notif("energize", { player_name: "Alice", buildingId: 84 }),
      notif("energize", { player_name: "Alice", buildingId: 85 }),
    ])]);
    expect(log).toEqual([{ type: "energize", player: "100", city: 3 }, { type: "energize", player: "100", city: null }]);
  });

  it("records a technology unlock and a nucleum placement", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("unlockTech", { player_name: "Alice", tech: 6, origin: "turbine & mine row" }),
      notif("placeNucleum", { player_name: "Alice", id: 12, city: 0, cityName: "Plauen" }),
    ])]);
    expect(log).toEqual([{ type: "tech", player: "100" }, { type: "nucleum", player: "100", city: 0 }]);
  });

  it("attributes a milestone marker to its owner id rather than the active player", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("placeMileStone", { player_name: "Bob", id: 157, pos: 0, pid: 200 })])]))
      .toEqual([{ type: "milestone", player: "200" }]);
  });

  it("records a uranium sale but not uranium routed to a power plant", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("spendUranium", { ids: [182], plant: -1, roads: [], energy: -1 }),
      notif("spendUranium", { ids: [183], plant: 3, roads: [43], energy: 2 }),
    ])]);
    expect(log).toEqual([{ type: "sell", player: "100" }]);
  });

  it("records the setup experiment choice", () => {
    expect(actionsOf([makePacket(1, [notif("chooseExperiment", { player_name: "Bob", idx: 1, experiment: "Experiment B", techId: 158 })])]))
      .toEqual([{ type: "experiment", player: "200", time: 1, name: "Experiment B" }]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumLog — attribution
// ---------------------------------------------------------------------------

describe("processNucleumLog — attribution", () => {
  it("credits a named action to that player, not the player on turn", () => {
    expect(actionsOf([makePacket(1, [turnStart("100"), notif("urbanize", { player_name: "Bob", city: 5 })])]))
      .toEqual([{ type: "urbanize", player: "200", city: 5 }]);
  });

  it("falls back to the active player when a notification carries no name", () => {
    expect(actionsOf([makePacket(1, [turnStart("200"), subState("200"), notif("spendUranium", { ids: [1], plant: -1 })])]))
      .toEqual([{ type: "sell", player: "200" }]);
  });

  it("does not take the active player from a state whose player is not really active", () => {
    // A stale pending node names a player who is not on turn; the nameless sale below still
    // belongs to whoever really is.
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      subState("200", { realActive: false }),
      notif("spendUranium", { ids: [1], plant: -1 }),
    ])]);
    expect(log).toEqual([{ type: "sell", player: "100" }]);
  });

  it("drops an action from an unknown player before any turn has started", () => {
    expect(actionsOf([makePacket(1, [notif("urbanize", { player_name: "Nobody", city: 5 })])])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumLog — networks
// ---------------------------------------------------------------------------

describe("processNucleumLog — networks", () => {
  it("normalizes each connection into a sorted city pair", () => {
    const log = actionsOf([makePacket(1, [notif("updateNetworks", { networks: {}, conns: { "100": [[18, 1], [10, 12]], "200": [] } })])]);
    expect(log).toEqual([{ type: "networks", conns: { "100": [[1, 18], [10, 12]], "200": [] } }]);
  });

  it("records a resync that arrives during a turn", () => {
    const log = actionsOf([makePacket(1, [turnStart("100"), notif("updateNetworks", { conns: { "100": [[3, 5]] } })])]);
    expect(log).toEqual([{ type: "networks", conns: { "100": [[3, 5]] } }]);
  });

  it("survives a malformed conns payload", () => {
    const log = actionsOf([makePacket(1, [notif("updateNetworks", { conns: { "100": [[3], "nope"], "200": null } })])]);
    expect(log).toEqual([{ type: "networks", conns: { "100": [] } }]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumLog — ignored notifications
// ---------------------------------------------------------------------------

describe("processNucleumLog — ignored notifications", () => {
  it("drops every consequence and every framework notification", () => {
    const log = actionsOf([makePacket(1, [
      turnStart("100"),
      notif("getBonus", { player_id: 100, bonus: 0, amount: 2, origin: "action tile" }),
      notif("getBonus", { player_name: "Alice", player_id: 100, bonus: 0, amount: -1, n: 1 }),
      notif("msg", { player_name: "Alice", text: { log: "${player_name} may urbanize", args: {} }, origin: "action tile" }),
      notif("refillMarket", { player_name: "Alice", newCards: [], newContracts: [] }),
      notif("completeRoad", { ids: [43] }),
      notif("getUranium", { player_name: "Alice", player_id: 100, amount: 2, uranium: [] }),
      notif("useCoal", { site: 1, amount: 2, flips: [7, 8], deletes: [], city: 4, roads: [] }),
      notif("energizeOptions", { player_id: "100", buildingId: 84 }),
      notif("updateReflexionTime", { player_id: "100", delta: 5400, max: 43200 }),
      notif("debugNotif", { data: "…" }),
      notif("someFutureNotification", { player_name: "Alice" }),
    ])]);
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumLog — game log shape
// ---------------------------------------------------------------------------

describe("processNucleumLog — game log shape", () => {
  it("stamps the game name and carries players and the observer through", () => {
    const log = processNucleumLog({ gameName: "nucleum", players: PLAYERS, packets: [], currentPlayerId: "100" });
    expect(log).toEqual({ gameName: "nucleum", players: PLAYERS, currentPlayerId: "100", log: [] });
  });

  it("survives extraction data with no packets and no players", () => {
    expect(processNucleumLog({ gameName: "nucleum", players: {}, packets: [] }).log).toEqual([]);
  });

  it("keeps entries in the order the packets arrived", () => {
    const log = process([
      makePacket(1, [turnStart("100"), notif("urbanize", { player_name: "Alice", city: 4 })]),
      makePacket(2, [turnEnd("100"), turnStart("200")]),
      makePacket(3, [notif("getContract", { player_name: "Bob", contract: 9, slot: 1 })]),
    ]);
    expect(log.map(e => e.type)).toEqual(["turnStart", "urbanize", "turnEnd", "turnStart", "contract"]);
  });
});
