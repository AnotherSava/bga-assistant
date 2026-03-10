import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initGame, processLog, toJSON, fromJSON, type AzulGameState, type TileCounts } from "../azul/game_state.js";
import { processAzulLog, type AzulLogEntry, type FactoryFillEntry, type WallPlacementEntry, type FloorClearEntry } from "../azul/process_log.js";
import type { RawExtractionData } from "../models/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum of color counts (indices 1-5). */
function colorTotal(counts: TileCounts): number {
  return counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
}

/** Create a factory fill entry. */
function fill(tileCounts: number[], remainingTiles: number): FactoryFillEntry {
  return { type: "factoryFill", tileCounts, remainingTiles };
}

/** Create a wall placement entry. */
function wallPlace(placements: Record<string, { placedType: number; discardedTypes: number[] }>): WallPlacementEntry {
  return { type: "wallPlacement", placements };
}

/** Create a floor clear entry. */
function floorClear(floorTiles: Record<string, number[]>): FloorClearEntry {
  return { type: "floorClear", floorTiles };
}

// ---------------------------------------------------------------------------
// initGame
// ---------------------------------------------------------------------------

describe("initGame", () => {
  it("starts with 20 of each color in bag", () => {
    const state = initGame();
    expect(state.bag).toEqual([0, 20, 20, 20, 20, 20]);
  });

  it("starts with empty discard and wall", () => {
    const state = initGame();
    expect(state.discard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(state.wall).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("starts with no refill events", () => {
    const state = initGame();
    expect(state.refillRounds).toEqual([]);
  });

  it("has 100 total color tiles", () => {
    const state = initGame();
    expect(colorTotal(state.bag)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// processLog — factory fill
// ---------------------------------------------------------------------------

describe("processLog — factoryFill", () => {
  it("subtracts drawn tiles from bag", () => {
    const log: AzulLogEntry[] = [fill([0, 3, 2, 5, 4, 6], 80)];
    const state = processLog(log);
    expect(state.bag).toEqual([0, 17, 18, 15, 16, 14]);
    expect(colorTotal(state.bag)).toBe(80);
  });

  it("handles multiple rounds of draws", () => {
    const log: AzulLogEntry[] = [
      fill([0, 4, 4, 4, 4, 4], 80),
      fill([0, 4, 4, 4, 4, 4], 60),
    ];
    const state = processLog(log);
    expect(state.bag).toEqual([0, 12, 12, 12, 12, 12]);
    expect(colorTotal(state.bag)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// processLog — wall placement
// ---------------------------------------------------------------------------

describe("processLog — wallPlacement", () => {
  it("increments wall for placed tile type", () => {
    const log: AzulLogEntry[] = [
      fill([0, 5, 5, 5, 5, 5], 75),
      wallPlace({ "1": { placedType: 3, discardedTypes: [] } }),
    ];
    const state = processLog(log);
    expect(state.wall[3]).toBe(1);
  });

  it("increments discard for discarded tiles", () => {
    const log: AzulLogEntry[] = [
      fill([0, 5, 5, 5, 5, 5], 75),
      wallPlace({ "1": { placedType: 2, discardedTypes: [2, 2] } }),
    ];
    const state = processLog(log);
    expect(state.wall[2]).toBe(1);
    expect(state.discard[2]).toBe(2);
  });

  it("handles multiple players in one placement", () => {
    const log: AzulLogEntry[] = [
      fill([0, 5, 5, 5, 5, 5], 75),
      wallPlace({
        "1": { placedType: 1, discardedTypes: [] },
        "2": { placedType: 5, discardedTypes: [5] },
      }),
    ];
    const state = processLog(log);
    expect(state.wall[1]).toBe(1);
    expect(state.wall[5]).toBe(1);
    expect(state.discard[5]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// processLog — floor clear
// ---------------------------------------------------------------------------

describe("processLog — floorClear", () => {
  it("adds floor tiles to discard", () => {
    const log: AzulLogEntry[] = [
      fill([0, 5, 5, 5, 5, 5], 75),
      floorClear({ "1": [3, 4] }),
    ];
    const state = processLog(log);
    expect(state.discard[3]).toBe(1);
    expect(state.discard[4]).toBe(1);
  });

  it("handles multiple players with floor tiles", () => {
    const log: AzulLogEntry[] = [
      fill([0, 5, 5, 5, 5, 5], 75),
      floorClear({ "1": [2], "2": [2, 5] }),
    ];
    const state = processLog(log);
    expect(state.discard[2]).toBe(2);
    expect(state.discard[5]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// processLog — refill detection
// ---------------------------------------------------------------------------

describe("processLog — refill detection", () => {
  it("detects refill when drawn exceeds bag total", () => {
    const log: AzulLogEntry[] = [
      // Round 1: draw 25, bag has 100 → no refill
      fill([0, 5, 5, 5, 5, 5], 75),
      // Put 20 tiles into discard via wall placements
      wallPlace({ "1": { placedType: 1, discardedTypes: [1, 1, 1, 1] } }),
      wallPlace({ "2": { placedType: 2, discardedTypes: [2, 2, 2, 2] } }),
      wallPlace({ "3": { placedType: 3, discardedTypes: [3, 3, 3, 3] } }),
      floorClear({ "1": [4, 4, 4, 4, 4, 5] }),
      // Round 2: draw 25, bag has 75 → no refill
      fill([0, 5, 5, 5, 5, 5], 50),
      // More discards
      wallPlace({ "1": { placedType: 4, discardedTypes: [4, 4, 4, 4] } }),
      wallPlace({ "2": { placedType: 5, discardedTypes: [5, 5, 5, 5] } }),
      floorClear({ "1": [1, 1, 2, 2, 3, 3] }),
      // Round 3: draw 25, bag has 50 → no refill
      fill([0, 5, 5, 5, 5, 5], 25),
      // More discards
      wallPlace({ "1": { placedType: 1, discardedTypes: [1, 1, 1, 1] } }),
      wallPlace({ "2": { placedType: 2, discardedTypes: [2, 2, 2, 2] } }),
      floorClear({ "1": [3, 3, 4, 4, 5, 5] }),
      // Round 4: draw 25, bag has 25 → no refill (exactly enough)
      fill([0, 5, 5, 5, 5, 5], 0),
    ];
    const state = processLog(log);
    expect(state.refillRounds).toEqual([]);
    expect(colorTotal(state.bag)).toBe(0);
  });

  it("triggers refill and records round number", () => {
    const log: AzulLogEntry[] = [
      // Round 1: draw all 100 tiles (e.g. extreme case)
      fill([0, 5, 5, 5, 5, 5], 75),
      // Discard 30 tiles
      wallPlace({ "1": { placedType: 1, discardedTypes: Array(9).fill(1) } }),
      wallPlace({ "2": { placedType: 2, discardedTypes: Array(9).fill(2) } }),
      floorClear({ "1": [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }),
      // Round 2: draw 25, bag has 75 → no refill
      fill([0, 5, 5, 5, 5, 5], 50),
      // Discard 20
      wallPlace({ "1": { placedType: 3, discardedTypes: Array(9).fill(3) } }),
      floorClear({ "1": [4, 4, 4, 4, 4, 4, 4, 4, 4, 4] }),
      // Round 3: draw 25, bag has 50 → no refill
      fill([0, 5, 5, 5, 5, 5], 25),
      // Discard 20
      wallPlace({ "1": { placedType: 4, discardedTypes: Array(9).fill(4) } }),
      floorClear({ "1": [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] }),
      // Round 4: draw 28, bag has 25 but discard has tiles → refill!
      fill([0, 6, 6, 6, 5, 5], 0),
    ];
    const state = processLog(log);
    expect(state.refillRounds).toEqual([4]);
  });

  it("adds discard to bag and resets discard on refill", () => {
    const log: AzulLogEntry[] = [
      // Draw most of the bag
      fill([0, 18, 18, 18, 18, 18], 10),
      // Discard 10 tiles
      floorClear({ "1": [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] }),
      // Round 2: draw 12, bag has 10 → refill from discard (10 + 10 = 20 tiles available)
      fill([0, 3, 3, 3, 2, 1], 8),
    ];
    const state = processLog(log);
    expect(state.refillRounds).toEqual([2]);
    // After refill: bag was [0,2,2,2,2,2] + discard [0,2,2,2,2,2] = [0,4,4,4,4,4]
    // Then draw [0,3,3,3,2,1] → bag = [0,1,1,1,2,3]
    expect(state.bag).toEqual([0, 1, 1, 1, 2, 3]);
    expect(state.discard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(colorTotal(state.bag)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// processLog — full round sequence
// ---------------------------------------------------------------------------

describe("processLog — full round sequence", () => {
  it("processes a complete round with all entry types", () => {
    const log: AzulLogEntry[] = [
      // Round start: draw tiles
      fill([0, 4, 4, 4, 4, 4], 80),
      // End of round: wall placements
      wallPlace({
        "1": { placedType: 1, discardedTypes: [] },
        "2": { placedType: 3, discardedTypes: [3] },
      }),
      wallPlace({
        "1": { placedType: 2, discardedTypes: [2] },
      }),
      // End of round: floor clear
      floorClear({ "2": [5] }),
    ];
    const state = processLog(log);
    expect(state.bag).toEqual([0, 16, 16, 16, 16, 16]);
    expect(state.wall).toEqual([0, 1, 1, 1, 0, 0]);
    expect(state.discard).toEqual([0, 0, 1, 1, 0, 1]);
    expect(state.refillRounds).toEqual([]);
  });

  it("conserves total tile count across zones", () => {
    const log: AzulLogEntry[] = [
      fill([0, 4, 4, 4, 4, 4], 80),
      wallPlace({ "1": { placedType: 1, discardedTypes: [1, 1] } }),
      wallPlace({ "2": { placedType: 2, discardedTypes: [] } }),
      floorClear({ "1": [3] }),
    ];
    const state = processLog(log);
    // bag + discard + wall + "in play" = 100
    const tracked = colorTotal(state.bag) + colorTotal(state.discard) + colorTotal(state.wall);
    const inPlay = 100 - tracked;
    // 20 drawn, 3 from wallPlace1 (1 wall + 2 discard), 1 from wallPlace2 (1 wall), 1 floor = 5 returned
    // in play = 20 - 5 = 15 tiles still on pattern lines
    expect(inPlay).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("toJSON / fromJSON", () => {
  it("roundtrips initial state", () => {
    const state = initGame();
    const serialized = toJSON(state);
    const restored = fromJSON(serialized);
    expect(restored).toEqual(state);
  });

  it("roundtrips state with data in all zones", () => {
    const log: AzulLogEntry[] = [
      fill([0, 4, 4, 4, 4, 4], 80),
      wallPlace({ "1": { placedType: 1, discardedTypes: [1, 1] } }),
      floorClear({ "1": [3, 5] }),
    ];
    const state = processLog(log);
    const serialized = toJSON(state);
    const restored = fromJSON(serialized);
    expect(restored).toEqual(state);
  });

  it("roundtrips state with refill events", () => {
    const log: AzulLogEntry[] = [
      fill([0, 18, 18, 18, 18, 18], 10),
      floorClear({ "1": [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] }),
      fill([0, 3, 3, 3, 2, 1], 8),
    ];
    const state = processLog(log);
    expect(state.refillRounds).toEqual([2]);

    const serialized = toJSON(state);
    const restored = fromJSON(serialized);
    expect(restored).toEqual(state);
  });

  it("produces plain JSON-compatible object", () => {
    const state = initGame();
    const serialized = toJSON(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const restored = fromJSON(parsed);
    expect(restored).toEqual(state);
  });

  it("does not share references with original state", () => {
    const state = initGame();
    const serialized = toJSON(state);
    serialized.bag[1] = 999;
    expect(state.bag[1]).toBe(20);

    const restored = fromJSON(serialized);
    restored.bag[1] = 0;
    expect(serialized.bag[1]).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// processLog — edge cases
// ---------------------------------------------------------------------------

describe("processLog — edge cases", () => {
  it("handles empty log", () => {
    const state = processLog([]);
    expect(state).toEqual(initGame());
  });

  it("handles log with only factory fills (no scoring)", () => {
    const log: AzulLogEntry[] = [fill([0, 4, 4, 4, 4, 4], 80)];
    const state = processLog(log);
    expect(state.bag).toEqual([0, 16, 16, 16, 16, 16]);
    expect(state.discard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(state.wall).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("handles asymmetric tile draws", () => {
    const log: AzulLogEntry[] = [fill([0, 0, 0, 0, 0, 20], 80)];
    const state = processLog(log);
    expect(state.bag).toEqual([0, 20, 20, 20, 20, 0]);
  });
});

// ---------------------------------------------------------------------------
// processLog — real fixture data (bgaa_816402832)
// ---------------------------------------------------------------------------

describe("processLog — real fixture data (bgaa_816402832)", () => {
  let log: AzulLogEntry[];

  beforeAll(() => {
    const rawPath = path.resolve("data/bgaa_816402832/raw_data.json");
    const rawData = JSON.parse(fs.readFileSync(rawPath, "utf8")) as RawExtractionData;
    const gameLog = processAzulLog(rawData);
    log = gameLog.log;
  });

  it("produces correct final state", () => {
    const state = processLog(log);
    expect(state.bag).toEqual([0, 7, 8, 6, 8, 7]);
    expect(state.discard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(state.wall).toEqual([0, 6, 6, 5, 6, 6]);
  });

  it("detects refill in round 4", () => {
    const state = processLog(log);
    expect(state.refillRounds).toEqual([4]);
  });

  it("bag total matches BGA remainingTiles after each factory fill", () => {
    // Replay entry by entry, checking bag total after each factory fill
    const state = initGame();
    let roundNumber = 0;

    for (const entry of log) {
      switch (entry.type) {
        case "factoryFill": {
          roundNumber++;
          const totalDrawn = entry.tileCounts.reduce((sum: number, c: number) => sum + c, 0);
          const bagTotal = colorTotal(state.bag);
          if (totalDrawn > bagTotal) {
            for (let i = 0; i <= 5; i++) { state.bag[i] += state.discard[i]; state.discard[i] = 0; }
          }
          for (let i = 0; i <= 5; i++) state.bag[i] -= entry.tileCounts[i];
          expect(colorTotal(state.bag)).toBe(entry.remainingTiles);
          break;
        }
        case "wallPlacement":
          for (const placement of Object.values(entry.placements)) {
            state.wall[placement.placedType]++;
            for (const dt of placement.discardedTypes) state.discard[dt]++;
          }
          break;
        case "floorClear":
          for (const tiles of Object.values(entry.floorTiles)) {
            for (const tt of tiles) state.discard[tt]++;
          }
          break;
      }
    }

    expect(roundNumber).toBe(4);
  });

  it("bag counts never go negative", () => {
    const state = initGame();

    for (const entry of log) {
      if (entry.type === "factoryFill") {
        const totalDrawn = entry.tileCounts.reduce((sum: number, c: number) => sum + c, 0);
        const bagTotal = colorTotal(state.bag);
        if (totalDrawn > bagTotal) {
          for (let i = 0; i <= 5; i++) { state.bag[i] += state.discard[i]; state.discard[i] = 0; }
        }
        for (let i = 0; i <= 5; i++) state.bag[i] -= entry.tileCounts[i];
        for (let i = 1; i <= 5; i++) {
          expect(state.bag[i]).toBeGreaterThanOrEqual(0);
        }
      } else if (entry.type === "wallPlacement") {
        for (const placement of Object.values(entry.placements)) {
          state.wall[placement.placedType]++;
          for (const dt of placement.discardedTypes) state.discard[dt]++;
        }
      } else if (entry.type === "floorClear") {
        for (const tiles of Object.values(entry.floorTiles)) {
          for (const tt of tiles) state.discard[tt]++;
        }
      }
    }
  });

  it("wall total equals 29 (in-progress 3p game, 3 completed rounds)", () => {
    const state = processLog(log);
    expect(colorTotal(state.wall)).toBe(29);
  });

  it("tracked tiles (bag + discard + wall) <= 100", () => {
    const state = processLog(log);
    const tracked = colorTotal(state.bag) + colorTotal(state.discard) + colorTotal(state.wall);
    expect(tracked).toBeLessThanOrEqual(100);
    // In-play tiles = 100 - tracked = 35
    expect(100 - tracked).toBe(35);
  });
});
