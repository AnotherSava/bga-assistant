import { describe, it, expect } from "vitest";
import { processCrewLog, type CrewGameLog, type MissionStartEntry, type HandDealtEntry, type CaptainEntry, type TrickStartEntry, type CardPlayedEntry, type TrickWonEntry, type CommunicationEntry, type CrewLogEntry } from "../process_log.js";
import type { RawExtractionData, RawPacket } from "../../../models/types.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePacket(moveId: number, notifications: Array<{ type: string; args: Record<string, unknown> }>): RawPacket {
  return {
    move_id: moveId,
    time: Date.now(),
    data: notifications.map((n) => ({ type: n.type, args: n.args })),
  };
}

function makeRawData(packets: RawPacket[], players?: Record<string, string>, currentPlayerId?: string): RawExtractionData {
  return {
    gameName: "thecrewdeepsea",
    players: players ?? { "1": "Alice", "2": "Bob", "3": "Charlie", "4": "Diana" },
    packets,
    currentPlayerId: currentPlayerId ?? "1",
  };
}

function makeBgaCard(color: string, value: string, pId: string): Record<string, unknown> {
  return { id: "1", color, value, location: "hand", pId };
}

function makePlayers(order: Record<string, string>): Record<string, unknown> {
  const players: Record<string, unknown> = {};
  for (const [pid, no] of Object.entries(order)) {
    players[pid] = { id: pid, name: `Player${pid}`, no, nCards: 10 };
  }
  return players;
}

function entriesOfType<T extends CrewLogEntry>(log: CrewLogEntry[], type: T["type"]): T[] {
  return log.filter((e) => e.type === type) as T[];
}

// ---------------------------------------------------------------------------
// processCrewLog — startNewMission
// ---------------------------------------------------------------------------

describe("processCrewLog — startNewMission", () => {
  it("parses mission number and id", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "startNewMission",
        args: { mission_nbr: 5, mission: { id: 5, title: "Test", difficulty: 2 } },
      }]),
    ]);
    const result = processCrewLog(raw);
    const missions = entriesOfType<MissionStartEntry>(result.log, "missionStart");
    expect(missions).toHaveLength(1);
    expect(missions[0].missionNumber).toBe(5);
    expect(missions[0].missionId).toBe(5);
  });

  it("detects multiple mission boundaries", () => {
    const raw = makeRawData([
      makePacket(1, [{ type: "startNewMission", args: { mission_nbr: 1, mission: { id: 1 } } }]),
      makePacket(10, [{ type: "startNewMission", args: { mission_nbr: 2, mission: { id: 2 } } }]),
      makePacket(20, [{ type: "startNewMission", args: { mission_nbr: 3, mission: { id: 3 } } }]),
    ]);
    const result = processCrewLog(raw);
    const missions = entriesOfType<MissionStartEntry>(result.log, "missionStart");
    expect(missions).toHaveLength(3);
    expect(missions.map((m) => m.missionNumber)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — newHand
// ---------------------------------------------------------------------------

describe("processCrewLog — newHand", () => {
  it("parses hand cards with suit and value", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "newHand",
        args: {
          hand: [
            makeBgaCard("1", "3", "1"),
            makeBgaCard("2", "7", "1"),
            makeBgaCard("5", "2", "1"),
          ],
          cards: {},
        },
      }]),
    ]);
    const result = processCrewLog(raw);
    const hands = entriesOfType<HandDealtEntry>(result.log, "handDealt");
    expect(hands).toHaveLength(1);
    expect(hands[0].cards).toEqual([
      { suit: 1, value: 3 },
      { suit: 2, value: 7 },
      { suit: 5, value: 2 },
    ]);
  });

  it("handles empty hand", () => {
    const raw = makeRawData([
      makePacket(1, [{ type: "newHand", args: { hand: [] } }]),
    ]);
    const result = processCrewLog(raw);
    const hands = entriesOfType<HandDealtEntry>(result.log, "handDealt");
    expect(hands[0].cards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — captain
// ---------------------------------------------------------------------------

describe("processCrewLog — captain", () => {
  it("extracts captain player id as string", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "captain",
        args: { player_id: 87923723, player_name: "azuremerge22" },
      }]),
    ]);
    const result = processCrewLog(raw);
    const captains = entriesOfType<CaptainEntry>(result.log, "captain");
    expect(captains).toHaveLength(1);
    expect(captains[0].playerId).toBe("87923723");
  });

  it("handles string player_id", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "captain",
        args: { player_id: "12345", player_name: "test" },
      }]),
    ]);
    const result = processCrewLog(raw);
    expect(entriesOfType<CaptainEntry>(result.log, "captain")[0].playerId).toBe("12345");
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — newTrick + player order extraction
// ---------------------------------------------------------------------------

describe("processCrewLog — newTrick / player order", () => {
  it("extracts player order from first newTrick", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "newTrick",
        args: {
          trickCount: 1,
          players: makePlayers({ "10": "2", "20": "1", "30": "4", "40": "3" }),
        },
      }]),
    ]);
    const result = processCrewLog(raw);
    expect(result.playerOrder).toEqual(["20", "10", "40", "30"]);
  });

  it("emits trickStart entries", () => {
    const raw = makeRawData([
      makePacket(1, [{ type: "newTrick", args: { trickCount: 1, players: makePlayers({ "1": "1", "2": "2" }) } }]),
      makePacket(2, [{ type: "newTrick", args: { trickCount: 2, players: makePlayers({ "1": "1", "2": "2" }) } }]),
    ]);
    const result = processCrewLog(raw);
    expect(entriesOfType<TrickStartEntry>(result.log, "trickStart")).toHaveLength(2);
  });

  it("re-extracts player order after a new mission", () => {
    const raw = makeRawData([
      makePacket(1, [{ type: "newTrick", args: { trickCount: 1, players: makePlayers({ "1": "1", "2": "2", "3": "3" }) } }]),
      makePacket(5, [{ type: "startNewMission", args: { mission_nbr: 2, mission: { id: 2 } } }]),
      makePacket(6, [{ type: "newTrick", args: { trickCount: 1, players: makePlayers({ "1": "3", "2": "1", "3": "2" }) } }]),
    ]);
    const result = processCrewLog(raw);
    // Should use the order from the second mission's first newTrick
    expect(result.playerOrder).toEqual(["2", "3", "1"]);
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — playCard
// ---------------------------------------------------------------------------

describe("processCrewLog — playCard", () => {
  it("parses card played with player id", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "playCard",
        args: {
          player_id: 85809167,
          player_name: "olorinscousin",
          card: makeBgaCard("4", "9", "85809167"),
          color: "4",
          value: "9",
        },
      }]),
    ]);
    const result = processCrewLog(raw);
    const plays = entriesOfType<CardPlayedEntry>(result.log, "cardPlayed");
    expect(plays).toHaveLength(1);
    expect(plays[0].playerId).toBe("85809167");
    expect(plays[0].card).toEqual({ suit: 4, value: 9 });
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — trickWin
// ---------------------------------------------------------------------------

describe("processCrewLog — trickWin", () => {
  it("parses winner id", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "trickWin",
        args: { player_id: 76419314, player_name: "AnotherSava", oCards: [], cards: {} },
      }]),
    ]);
    const result = processCrewLog(raw);
    const wins = entriesOfType<TrickWonEntry>(result.log, "trickWon");
    expect(wins).toHaveLength(1);
    expect(wins[0].winnerId).toBe("76419314");
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — endComm (communication)
// ---------------------------------------------------------------------------

describe("processCrewLog — endComm", () => {
  it("parses communication with top position", () => {
    const raw = makeRawData([
      makePacket(1, [{
        type: "endComm",
        args: {
          player_id: 89867354,
          player_name: "ZecaMS",
          card: makeBgaCard("2", "8", "89867354"),
          comm_status: "top",
        },
      }]),
    ]);
    const result = processCrewLog(raw);
    const comms = entriesOfType<CommunicationEntry>(result.log, "communication");
    expect(comms).toHaveLength(1);
    expect(comms[0].playerId).toBe("89867354");
    expect(comms[0].card).toEqual({ suit: 2, value: 8 });
    expect(comms[0].position).toBe("top");
  });

  it("parses all position types", () => {
    const positions = ["top", "bottom", "middle", "hidden"] as const;
    const packets = positions.map((pos, i) =>
      makePacket(i, [{
        type: "endComm",
        args: {
          player_id: "1",
          player_name: "test",
          card: makeBgaCard("1", String(i + 1), "1"),
          comm_status: pos,
        },
      }])
    );
    const raw = makeRawData(packets);
    const result = processCrewLog(raw);
    const comms = entriesOfType<CommunicationEntry>(result.log, "communication");
    expect(comms.map((c) => c.position)).toEqual(["top", "bottom", "middle", "hidden"]);
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — currentPlayerId and player data
// ---------------------------------------------------------------------------

describe("processCrewLog — metadata", () => {
  it("extracts currentPlayerId", () => {
    const raw = makeRawData([], { "42": "Alice" }, "42");
    const result = processCrewLog(raw);
    expect(result.currentPlayerId).toBe("42");
  });

  it("preserves player names", () => {
    const players = { "1": "Alice", "2": "Bob", "3": "Charlie" };
    const raw = makeRawData([], players);
    const result = processCrewLog(raw);
    expect(result.players).toEqual(players);
  });

  it("throws when currentPlayerId is missing", () => {
    const raw: RawExtractionData = { gameName: "thecrewdeepsea", players: {}, packets: [] };
    expect(() => processCrewLog(raw)).toThrow("currentPlayerId missing from extraction data");
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — ignored notifications
// ---------------------------------------------------------------------------

describe("processCrewLog — ignored notifications", () => {
  it("ignores irrelevant notification types", () => {
    const raw = makeRawData([
      makePacket(1, [
        { type: "gameStateChange", args: {} },
        { type: "updateReflexionTime", args: {} },
        { type: "takeTask", args: {} },
        { type: "taskUpdate", args: {} },
        { type: "continue", args: {} },
        { type: "cleanUp", args: {} },
        { type: "startComm", args: {} },
        { type: "usedComm", args: {} },
        { type: "toggleCommPending", args: {} },
      ]),
    ]);
    const result = processCrewLog(raw);
    expect(result.log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// processCrewLog — full mission from fixture
// ---------------------------------------------------------------------------

describe("processCrewLog — fixture: complete mission", () => {
  const fixtureData: RawExtractionData = JSON.parse(readFileSync(resolve(__dirname, "fixtures/last_mission.json"), "utf-8"));

  it("processes the fixture without errors", () => {
    const result = processCrewLog(fixtureData);
    expect(result.players).toEqual({
      "76419314": "AnotherSava",
      "85809167": "olorinscousin",
      "87923723": "azuremerge22",
      "89867354": "ZecaMS",
    });
    expect(result.currentPlayerId).toBe("76419314");
  });

  it("extracts correct player seat order", () => {
    const result = processCrewLog(fixtureData);
    expect(result.playerOrder).toEqual(["85809167", "89867354", "76419314", "87923723"]);
  });

  it("finds exactly 1 mission, 1 hand, 1 captain", () => {
    const result = processCrewLog(fixtureData);
    expect(entriesOfType<MissionStartEntry>(result.log, "missionStart")).toHaveLength(1);
    expect(entriesOfType<HandDealtEntry>(result.log, "handDealt")).toHaveLength(1);
    expect(entriesOfType<CaptainEntry>(result.log, "captain")).toHaveLength(1);
  });

  it("finds 10 tricks with 40 card plays and 10 trick wins", () => {
    const result = processCrewLog(fixtureData);
    expect(entriesOfType<TrickStartEntry>(result.log, "trickStart")).toHaveLength(10);
    expect(entriesOfType<CardPlayedEntry>(result.log, "cardPlayed")).toHaveLength(40);
    expect(entriesOfType<TrickWonEntry>(result.log, "trickWon")).toHaveLength(10);
  });

  it("finds 2 communications", () => {
    const result = processCrewLog(fixtureData);
    const comms = entriesOfType<CommunicationEntry>(result.log, "communication");
    expect(comms).toHaveLength(2);
    // First comm: ZecaMS communicates Blue 8 as top
    expect(comms[0].playerId).toBe("89867354");
    expect(comms[0].card).toEqual({ suit: 2, value: 8 });
    expect(comms[0].position).toBe("top");
    // Second comm: AnotherSava communicates Blue 1 as middle
    expect(comms[1].playerId).toBe("76419314");
    expect(comms[1].card).toEqual({ suit: 2, value: 1 });
    expect(comms[1].position).toBe("middle");
  });

  it("captain is azuremerge22 (player 87923723)", () => {
    const result = processCrewLog(fixtureData);
    const captains = entriesOfType<CaptainEntry>(result.log, "captain");
    expect(captains[0].playerId).toBe("87923723");
  });

  it("observer's hand has 10 cards", () => {
    const result = processCrewLog(fixtureData);
    const hands = entriesOfType<HandDealtEntry>(result.log, "handDealt");
    expect(hands[0].cards).toHaveLength(10);
    // Verify specific cards from the fixture
    expect(hands[0].cards).toContainEqual({ suit: 1, value: 3 });
    expect(hands[0].cards).toContainEqual({ suit: 5, value: 3 });
  });

  it("log entries are in correct chronological order", () => {
    const result = processCrewLog(fixtureData);
    const types = result.log.map((e) => e.type);
    // Hand is dealt before mission start in BGA
    const handIdx = types.indexOf("handDealt");
    const missionIdx = types.indexOf("missionStart");
    const captainIdx = types.indexOf("captain");
    const firstTrick = types.indexOf("trickStart");
    const firstPlay = types.indexOf("cardPlayed");

    expect(handIdx).toBeLessThan(missionIdx);
    expect(missionIdx).toBeLessThan(captainIdx);
    expect(captainIdx).toBeLessThan(firstTrick);
    expect(firstTrick).toBeLessThan(firstPlay);
  });
});
