import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { processAzulLog, TILE_TYPES, COLOR_COUNT, type AzulGameLog, type FactoryFillEntry, type WallPlacementEntry, type FloorClearEntry } from "../azul/process_log.js";
import type { RawExtractionData, RawPacket } from "../models/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("TILE_TYPES", () => {
  it("defines first player marker as 0", () => {
    expect(TILE_TYPES.FIRST_PLAYER).toBe(0);
  });

  it("defines 5 color types (1-5)", () => {
    expect(TILE_TYPES.BLACK).toBe(1);
    expect(TILE_TYPES.CYAN).toBe(2);
    expect(TILE_TYPES.BLUE).toBe(3);
    expect(TILE_TYPES.YELLOW).toBe(4);
    expect(TILE_TYPES.RED).toBe(5);
  });

  it("COLOR_COUNT is 5", () => {
    expect(COLOR_COUNT).toBe(5);
  });
});

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

function makeTile(id: number, type: number, location = "factory"): { id: number; type: number; column: number; line: number; location: string } {
  return { id, type, column: 0, line: 0, location };
}

function makeRawData(packets: RawPacket[], players?: Record<string, string>): RawExtractionData {
  return {
    players: players ?? { "1": "Alice", "2": "Bob" },
    packets,
  };
}

// ---------------------------------------------------------------------------
// processAzulLog — factoriesFilled
// ---------------------------------------------------------------------------

describe("processAzulLog — factoriesFilled", () => {
  it("counts tiles per type excluding first-player marker", () => {
    const raw = makeRawData([
      makePacket(1, [
        {
          type: "factoriesFilled",
          args: {
            factories: [
              [makeTile(0, 0, "deck")], // first player marker — excluded
              [makeTile(1, 1), makeTile(2, 1), makeTile(3, 3), makeTile(4, 5)],
              [makeTile(5, 2), makeTile(6, 2), makeTile(7, 4), makeTile(8, 4)],
            ],
            remainingTiles: 92,
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(1);

    const entry = result.log[0] as FactoryFillEntry;
    expect(entry.type).toBe("factoryFill");
    expect(entry.tileCounts).toEqual([0, 2, 2, 1, 2, 1]); // 0=none, 1=Black x2, 2=Cyan x2, 3=Blue x1, 4=Yellow x2, 5=Red x1
    expect(entry.remainingTiles).toBe(92);
  });

  it("handles factory with no tiles (empty factory)", () => {
    const raw = makeRawData([
      makePacket(1, [
        {
          type: "factoriesFilled",
          args: {
            factories: [
              [makeTile(0, 0, "deck")],
              [], // empty factory
              [makeTile(1, 3), makeTile(2, 3), makeTile(3, 3), makeTile(4, 3)],
            ],
            remainingTiles: 96,
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    const entry = result.log[0] as FactoryFillEntry;
    expect(entry.tileCounts).toEqual([0, 0, 0, 4, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — placeTileOnWall
// ---------------------------------------------------------------------------

describe("processAzulLog — placeTileOnWall", () => {
  it("extracts placed tile type and discarded tile types per player", () => {
    const raw = makeRawData([
      makePacket(10, [
        {
          type: "placeTileOnWall",
          args: {
            completeLines: {
              "1": {
                placedTile: makeTile(50, 3, "line1"),
                discardedTiles: [makeTile(51, 3, "line1"), makeTile(52, 3, "line1")],
                pointsDetail: {},
              },
              "2": {
                placedTile: makeTile(60, 5, "line2"),
                discardedTiles: [],
                pointsDetail: {},
              },
            },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(1);

    const entry = result.log[0] as WallPlacementEntry;
    expect(entry.type).toBe("wallPlacement");
    expect(entry.placements["1"]).toEqual({ placedType: 3, discardedTypes: [3, 3] });
    expect(entry.placements["2"]).toEqual({ placedType: 5, discardedTypes: [] });
  });

  it("handles single player placement", () => {
    const raw = makeRawData([
      makePacket(10, [
        {
          type: "placeTileOnWall",
          args: {
            completeLines: {
              "1": {
                placedTile: makeTile(50, 1, "line1"),
                discardedTiles: [makeTile(51, 1, "line1")],
                pointsDetail: {},
              },
            },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    const entry = result.log[0] as WallPlacementEntry;
    expect(Object.keys(entry.placements)).toHaveLength(1);
    expect(entry.placements["1"]).toEqual({ placedType: 1, discardedTypes: [1] });
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — emptyFloorLine
// ---------------------------------------------------------------------------

describe("processAzulLog — emptyFloorLine", () => {
  it("extracts color tile types, excludes first-player marker", () => {
    const raw = makeRawData([
      makePacket(20, [
        {
          type: "emptyFloorLine",
          args: {
            floorLines: {
              "1": {
                points: -2,
                tiles: [makeTile(0, 0, "line1"), makeTile(10, 4, "line1")],
              },
            },
            specialFactoryZeroTiles: { "1": [] },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(1);

    const entry = result.log[0] as FloorClearEntry;
    expect(entry.type).toBe("floorClear");
    expect(entry.floorTiles["1"]).toEqual([4]);
  });

  it("skips when floorLines is an empty array", () => {
    const raw = makeRawData([
      makePacket(20, [
        {
          type: "emptyFloorLine",
          args: {
            floorLines: [],
            specialFactoryZeroTiles: {},
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(0);
  });

  it("skips when no color tiles on floor (only first-player marker)", () => {
    const raw = makeRawData([
      makePacket(20, [
        {
          type: "emptyFloorLine",
          args: {
            floorLines: {
              "1": {
                points: -1,
                tiles: [makeTile(0, 0, "line1")],
              },
            },
            specialFactoryZeroTiles: { "1": [] },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(0);
  });

  it("includes multiple players with floor tiles", () => {
    const raw = makeRawData([
      makePacket(20, [
        {
          type: "emptyFloorLine",
          args: {
            floorLines: {
              "1": {
                points: -2,
                tiles: [makeTile(0, 0, "line1"), makeTile(10, 2, "line1")],
              },
              "2": {
                points: -1,
                tiles: [makeTile(20, 5, "line2")],
              },
            },
            specialFactoryZeroTiles: { "1": [], "2": [] },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(1);

    const entry = result.log[0] as FloorClearEntry;
    expect(entry.floorTiles["1"]).toEqual([2]);
    expect(entry.floorTiles["2"]).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — ignored notification types
// ---------------------------------------------------------------------------

describe("processAzulLog — ignored notifications", () => {
  it("ignores tilesSelected, tilesPlacedOnLine, firstPlayerToken, etc.", () => {
    const raw = makeRawData([
      makePacket(1, [
        { type: "tilesSelected", args: {} },
        { type: "tilesPlacedOnLine", args: {} },
        { type: "firstPlayerToken", args: {} },
        { type: "gameStateChange", args: {} },
        { type: "updateReflexionTime", args: {} },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — player data
// ---------------------------------------------------------------------------

describe("processAzulLog — player data", () => {
  it("preserves player names from raw data", () => {
    const players = { "100": "Alice", "200": "Bob", "300": "Charlie" };
    const raw = makeRawData([], players);

    const result = processAzulLog(raw);
    expect(result.players).toEqual(players);
  });

  it("defaults to empty players when not provided", () => {
    const raw: RawExtractionData = { players: {}, packets: [] } as any;
    const result = processAzulLog(raw);
    expect(result.players).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — mixed notification ordering
// ---------------------------------------------------------------------------

describe("processAzulLog — mixed notifications", () => {
  it("processes a full round sequence in order", () => {
    const raw = makeRawData([
      // Round start: fill factories
      makePacket(1, [
        {
          type: "factoriesFilled",
          args: {
            factories: [
              [makeTile(0, 0, "deck")],
              [makeTile(1, 1), makeTile(2, 2), makeTile(3, 3), makeTile(4, 4)],
            ],
            remainingTiles: 96,
          },
        },
      ]),
      // Selection phase: ignored
      makePacket(2, [{ type: "tilesSelected", args: {} }]),
      makePacket(3, [{ type: "tilesPlacedOnLine", args: {} }]),
      // End of round: wall placement
      makePacket(10, [
        {
          type: "placeTileOnWall",
          args: {
            completeLines: {
              "1": {
                placedTile: makeTile(1, 1, "line1"),
                discardedTiles: [],
                pointsDetail: {},
              },
            },
          },
        },
      ]),
      // End of round: floor clear
      makePacket(10, [
        {
          type: "emptyFloorLine",
          args: {
            floorLines: {
              "2": { points: -1, tiles: [makeTile(10, 3, "line2")] },
            },
            specialFactoryZeroTiles: { "2": [] },
          },
        },
      ]),
    ]);

    const result = processAzulLog(raw);
    expect(result.log).toHaveLength(3);
    expect(result.log[0].type).toBe("factoryFill");
    expect(result.log[1].type).toBe("wallPlacement");
    expect(result.log[2].type).toBe("floorClear");
  });
});

// ---------------------------------------------------------------------------
// processAzulLog — real fixture data
// ---------------------------------------------------------------------------

describe("processAzulLog — real fixture data (bgaa_816402832)", () => {
  let gameLog: AzulGameLog;

  beforeAll(() => {
    const rawPath = path.resolve("data/bgaa_816402832/raw_data.json");
    const rawData = JSON.parse(fs.readFileSync(rawPath, "utf8")) as RawExtractionData;
    gameLog = processAzulLog(rawData);
  });

  it("identifies 3 players", () => {
    expect(Object.keys(gameLog.players)).toHaveLength(3);
  });

  it("produces entries for 4 rounds of play", () => {
    const factoryFills = gameLog.log.filter((e) => e.type === "factoryFill");
    expect(factoryFills).toHaveLength(4);
  });

  it("round 1: draws 28 tiles (3-player = 7 factories x 4 tiles)", () => {
    const entry = gameLog.log.find((e) => e.type === "factoryFill") as FactoryFillEntry;
    const totalDrawn = entry.tileCounts.reduce((sum, c) => sum + c, 0);
    expect(totalDrawn).toBe(28);
    expect(entry.tileCounts).toEqual([0, 4, 7, 8, 3, 6]);
    expect(entry.remainingTiles).toBe(72);
  });

  it("round 2: draws 28 tiles with correct distribution", () => {
    const fills = gameLog.log.filter((e) => e.type === "factoryFill") as FactoryFillEntry[];
    expect(fills[1].tileCounts).toEqual([0, 4, 6, 3, 11, 4]);
    expect(fills[1].remainingTiles).toBe(44);
  });

  it("round 3: draws 28 tiles, remaining 16", () => {
    const fills = gameLog.log.filter((e) => e.type === "factoryFill") as FactoryFillEntry[];
    expect(fills[2].tileCounts).toEqual([0, 8, 7, 5, 2, 6]);
    expect(fills[2].remainingTiles).toBe(16);
  });

  it("round 4: draws 28 tiles, remaining 36 (refill occurred)", () => {
    const fills = gameLog.log.filter((e) => e.type === "factoryFill") as FactoryFillEntry[];
    expect(fills[3].tileCounts).toEqual([0, 5, 4, 6, 6, 7]);
    expect(fills[3].remainingTiles).toBe(36);
  });

  it("has wall placement entries", () => {
    const walls = gameLog.log.filter((e) => e.type === "wallPlacement");
    expect(walls.length).toBeGreaterThan(0);
  });

  it("round 1 wall placements include correct placed/discarded types", () => {
    // Find wall placements between first and second factoryFill
    const entries = gameLog.log;
    const firstFillIdx = entries.findIndex((e) => e.type === "factoryFill");
    const secondFillIdx = entries.findIndex((e, i) => i > firstFillIdx && e.type === "factoryFill");
    const round1Walls = entries.slice(firstFillIdx + 1, secondFillIdx).filter((e) => e.type === "wallPlacement") as WallPlacementEntry[];

    expect(round1Walls.length).toBe(10);

    // First wall placement: player 95035511 places type 1, no discards
    expect(round1Walls[0].placements["95035511"]).toEqual({ placedType: 1, discardedTypes: [] });
  });

  it("has floor clear entries with color tiles", () => {
    const floors = gameLog.log.filter((e) => e.type === "floorClear") as FloorClearEntry[];
    // Some rounds have color tiles on the floor
    expect(floors.length).toBeGreaterThan(0);

    // Round 2 has player 87929817 with type 4 on floor
    const round2Floor = floors.find((e) => e.floorTiles["87929817"]?.includes(4));
    expect(round2Floor).toBeDefined();
  });
});
