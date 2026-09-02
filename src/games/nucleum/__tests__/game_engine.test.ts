import { describe, it, expect } from "vitest";
import { processNucleumState } from "../game_engine.js";
import type { NucleumGameLog, NucleumLogEntry } from "../process_log.js";
import { mkPlayers } from "../../../__tests__/helpers/players.js";

// ---------------------------------------------------------------------------
// Helpers — build a game log straight from entries
// ---------------------------------------------------------------------------

const PLAYERS = mkPlayers({ "100": "Alice", "200": "Bob" }, "100");

/** Entries rather than packets, so a change to the wire format breaks one file, not two. */
function makeLog(entries: NucleumLogEntry[]): NucleumGameLog {
  return { gameName: "nucleum", players: PLAYERS, log: entries };
}

function start(player: string, time: number | null = null): NucleumLogEntry {
  return { type: "turnStart", player, time };
}

function end(player: string): NucleumLogEntry {
  return { type: "turnEnd", player };
}

/** The action types of one turn's details, in order. */
function kinds(actions: { actions: { actionType: string }[] }[], index: number): string[] {
  return actions[index].actions.map(d => d.actionType);
}

// ---------------------------------------------------------------------------
// processNucleumState — turn grouping
// ---------------------------------------------------------------------------

describe("processNucleumState — turn grouping", () => {
  it("returns no turns for an empty log", () => {
    expect(processNucleumState(makeLog([])).actions).toEqual([]);
  });

  it("groups a turn's actions under one entry, primary first", () => {
    const state = processNucleumState(makeLog([
      start("100", 1788203467),
      { type: "urbanize", player: "100", city: 4 },
      { type: "fulfill", player: "100" },
      { type: "tech", player: "100" },
      end("100"),
    ]));
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0]).toMatchObject({ player: "100", actionNumber: 1, time: 1788203467, logIndex: 0 });
    expect(kinds(state.actions, 0)).toEqual(["urbanize", "fulfill", "tech"]);
  });

  it("starts a new turn for each player in turn", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "contract", player: "100" }, end("100"),
      start("200"), { type: "recharge", player: "200" }, end("200"),
    ]));
    expect(state.actions.map(a => a.player)).toEqual(["100", "200"]);
    expect(state.actions.map(a => a.logIndex)).toEqual([0, 3]);
  });

  it("keys each turn by its own entry index, so a later turn does not shift an earlier one", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "develop", player: "100", count: 1 }, end("100"),
      start("200"), { type: "develop", player: "200", count: 1 }, end("200"),
      start("100"), { type: "develop", player: "100", count: 1 },
    ]));
    expect(state.actions.map(a => a.logIndex)).toEqual([0, 3, 6]);
  });

  it("drops an action arriving before any turn has started", () => {
    expect(processNucleumState(makeLog([{ type: "urbanize", player: "100", city: 4 }])).actions).toEqual([]);
  });

  it("gives a finished turn with no actions the tile it played", () => {
    const state = processNucleumState(makeLog([start("100"), { type: "playTile", player: "100", slot: 0 }, end("100")]));
    expect(kinds(state.actions, 0)).toEqual(["tile"]);
  });

  it("marks a turn that ended with nothing at all as pending", () => {
    const state = processNucleumState(makeLog([start("100"), end("100")]));
    expect(kinds(state.actions, 0)).toEqual(["pending"]);
  });

  it("shows the turn in progress as pending rather than omitting it", () => {
    const state = processNucleumState(makeLog([start("100"), end("100"), start("200")]));
    expect(state.actions).toHaveLength(2);
    expect(kinds(state.actions, 1)).toEqual(["pending"]);
  });

  it("does not add a placeholder to a turn that already has an action", () => {
    const state = processNucleumState(makeLog([start("100"), { type: "playTile", player: "100", slot: 0 }, { type: "contract", player: "100" }, end("100")]));
    expect(kinds(state.actions, 0)).toEqual(["contract"]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumState — undo
// ---------------------------------------------------------------------------

describe("processNucleumState — undo", () => {
  it("rebuilds a turn started again for the same player without ending", () => {
    const state = processNucleumState(makeLog([
      start("100"),
      { type: "playTile", player: "100", slot: 0 },
      { type: "urbanize", player: "100", city: 4 },
      start("100"),
      { type: "railway", player: "100", tile: 5, road: 11 },
      end("100"),
    ]));
    expect(state.actions).toHaveLength(1);
    expect(kinds(state.actions, 0)).toEqual(["railway"]);
  });

  it("keeps the rewound turn's own place in the log, so its rows keep their identity", () => {
    const state = processNucleumState(makeLog([
      start("100", 500),
      { type: "urbanize", player: "100", city: 4 },
      start("100", 900),
      { type: "contract", player: "100" },
    ]));
    expect(state.actions[0]).toMatchObject({ logIndex: 0, time: 500 });
  });

  it("forgets a tile played before the rewind", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "playTile", player: "100", slot: 0 }, start("100"), end("100"),
    ]));
    expect(kinds(state.actions, 0)).toEqual(["pending"]);
  });

  it("treats a second turn for the same player after an end as a real new turn", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "contract", player: "100" }, end("100"),
      start("100"), { type: "recharge", player: "100" }, end("100"),
    ]));
    expect(state.actions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// processNucleumState — repeated actions
// ---------------------------------------------------------------------------

describe("processNucleumState — repeated actions", () => {
  it("collapses consecutive uranium sales into one counted action", () => {
    const state = processNucleumState(makeLog([
      start("200"),
      { type: "sell", player: "200" }, { type: "sell", player: "200" }, { type: "sell", player: "200" },
      { type: "mine", player: "200", city: 12 },
      end("200"),
    ]));
    expect(kinds(state.actions, 0)).toEqual(["sell", "mine"]);
    expect(state.actions[0].actions[0].count).toBe(3);
  });

  it("sums two develops in one turn", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "develop", player: "100", count: 2 }, { type: "develop", player: "100", count: 1 }, end("100"),
    ]));
    expect(state.actions[0].actions).toHaveLength(1);
    expect(state.actions[0].actions[0].count).toBe(3);
  });

  it("does not collapse across a different action in between", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "sell", player: "100" }, { type: "contract", player: "100" }, { type: "sell", player: "100" }, end("100"),
    ]));
    expect(kinds(state.actions, 0)).toEqual(["sell", "contract", "sell"]);
  });

  it("does not collapse two players' sales into one", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "sell", player: "100" }, { type: "sell", player: "200" }, end("100"),
    ]));
    expect(state.actions[0].actions.map(d => d.player)).toEqual(["100", "200"]);
  });

  it("leaves a lone action uncounted, so nothing renders a ×1", () => {
    const state = processNucleumState(makeLog([start("100"), { type: "sell", player: "100" }, end("100")]));
    expect(state.actions[0].actions[0].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// processNucleumState — milestones and recharge
// ---------------------------------------------------------------------------

describe("processNucleumState — milestones and recharge", () => {
  it("drops the marker a recharge places, since recharging always places one", () => {
    // BGA reports the marker first and the tile retrieval second.
    const state = processNucleumState(makeLog([
      start("100"), { type: "milestone", player: "100" }, { type: "recharge", player: "100" }, end("100"),
    ]));
    expect(kinds(state.actions, 0)).toEqual(["recharge"]);
  });

  it("keeps a marker placed with no recharge behind it", () => {
    const state = processNucleumState(makeLog([start("100"), { type: "milestone", player: "100" }, end("100")]));
    expect(kinds(state.actions, 0)).toEqual(["milestone"]);
  });

  it("keeps another player's marker when this player recharges", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "milestone", player: "200" }, { type: "recharge", player: "100" }, end("100"),
    ]));
    expect(kinds(state.actions, 0)).toEqual(["milestone", "recharge"]);
  });
});

// ---------------------------------------------------------------------------
// processNucleumState — railway links
// ---------------------------------------------------------------------------

describe("processNucleumState — railway links", () => {
  it("names the two cities a placement joined, from the connection it created", () => {
    const state = processNucleumState(makeLog([
      { type: "networks", conns: { "100": [], "200": [] } },
      start("100"),
      { type: "railway", player: "100", tile: 43, road: 14 },
      { type: "networks", conns: { "100": [[1, 18]], "200": [] } },
      end("100"),
    ]));
    expect(state.actions[0].actions[0]).toMatchObject({ actionType: "railway", link: [1, 18] });
  });

  it("leaves the link unnamed when the placement completed nothing", () => {
    const state = processNucleumState(makeLog([
      { type: "networks", conns: { "100": [] } },
      start("100"),
      { type: "railway", player: "100", tile: 43, road: 14 },
      { type: "networks", conns: { "100": [] } },
      end("100"),
    ]));
    expect(state.actions[0].actions[0].link).toBeNull();
  });

  it("ignores a connection another player gained from the same completion", () => {
    const state = processNucleumState(makeLog([
      { type: "networks", conns: { "100": [], "200": [] } },
      start("100"),
      { type: "railway", player: "100", tile: 43, road: 14 },
      { type: "networks", conns: { "100": [], "200": [[3, 5]] } },
      end("100"),
    ]));
    expect(state.actions[0].actions[0].link).toBeNull();
  });

  it("does not name a link from the first resync, which reports what was already there", () => {
    const state = processNucleumState(makeLog([
      start("100"),
      { type: "railway", player: "100", tile: 43, road: 14 },
      { type: "networks", conns: { "100": [[1, 18]] } },
      end("100"),
    ]));
    expect(state.actions[0].actions[0].link).toBeNull();
  });

  it("does not carry a link onto a placement from a later turn", () => {
    const state = processNucleumState(makeLog([
      { type: "networks", conns: { "100": [] } },
      start("100"), { type: "railway", player: "100", tile: 43, road: 14 }, end("100"),
      start("200"), end("200"),
      { type: "networks", conns: { "100": [[1, 18]] } },
    ]));
    expect(state.actions[0].actions[0].link).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// processNucleumState — setup and detail contents
// ---------------------------------------------------------------------------

describe("processNucleumState — setup and detail contents", () => {
  it("gives each experiment choice its own row before the first turn", () => {
    const state = processNucleumState(makeLog([
      { type: "experiment", player: "200", time: 10, name: "Experiment B" },
      { type: "experiment", player: "100", time: 20, name: "Experiment A" },
      start("200"),
    ]));
    expect(state.actions).toHaveLength(3);
    expect(state.actions[0]).toMatchObject({ player: "200", time: 10, logIndex: 0 });
    expect(state.actions[0].actions[0]).toMatchObject({ actionType: "experiment", label: "Experiment B" });
  });

  it("carries the city onto the actions that name one", () => {
    const state = processNucleumState(makeLog([
      start("100"),
      { type: "mine", player: "100", city: 12 },
      { type: "energize", player: "100", city: 3 },
      { type: "nucleum", player: "100", city: 0 },
      end("100"),
    ]));
    expect(state.actions[0].actions.map(d => d.city)).toEqual([12, 3, 0]);
  });

  it("records the actor on every detail, so one taken out of turn can be named", () => {
    const state = processNucleumState(makeLog([
      start("100"), { type: "urbanize", player: "200", city: 5 }, end("100"),
    ]));
    expect(state.actions[0].player).toBe("100");
    expect(state.actions[0].actions[0].player).toBe("200");
  });

  it("carries the players through onto the state", () => {
    expect(processNucleumState(makeLog([])).players).toEqual(PLAYERS);
  });
});
