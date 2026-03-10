// Azul game state: bag, discard (box lid), and wall tracking.

import type { AzulLogEntry } from "./process_log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Tile counts indexed by tile type (0 = first-player marker, 1-5 = colors).
 * 6-element array: [marker, black, cyan, blue, yellow, red].
 */
export type TileCounts = number[];

/** Azul game state tracking bag, discard (box lid), and wall tile counts. */
export interface AzulGameState {
  bag: TileCounts;
  discard: TileCounts;
  wall: TileCounts;
  /** Round numbers where a bag refill from discard occurred. */
  refillRounds: number[];
}

/** Serialized form for side panel message passing. */
export interface SerializedAzulGameState {
  bag: number[];
  discard: number[];
  wall: number[];
  refillRounds: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a zeroed TileCounts array. */
function zeroCounts(): TileCounts {
  return [0, 0, 0, 0, 0, 0];
}

/** Sum of color tile counts (indices 1-5, excluding first-player marker). */
function colorTotal(counts: TileCounts): number {
  return counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/** Create initial Azul game state: 20 of each color in bag. */
export function initGame(): AzulGameState {
  return {
    bag: [0, 20, 20, 20, 20, 20],
    discard: zeroCounts(),
    wall: zeroCounts(),
    refillRounds: [],
  };
}

// ---------------------------------------------------------------------------
// Log processing
// ---------------------------------------------------------------------------

/** Process the full Azul game log and return the final game state. */
export function processLog(log: AzulLogEntry[]): AzulGameState {
  const state = initGame();
  let roundNumber = 0;

  for (const entry of log) {
    switch (entry.type) {
      case "factoryFill": {
        roundNumber++;
        const totalDrawn = colorTotal(entry.tileCounts);
        const bagTotal = colorTotal(state.bag);

        // Refill detection: if we need more tiles than the bag has,
        // the discard pile was emptied into the bag mid-draw
        if (totalDrawn > bagTotal) {
          for (let i = 0; i <= 5; i++) {
            state.bag[i] += state.discard[i];
            state.discard[i] = 0;
          }
          state.refillRounds.push(roundNumber);
        }

        // Subtract drawn tiles from bag (clamp to zero — a mid-draw refill
        // means per-color precision is limited since BGA doesn't report
        // exactly when the bag emptied during the factory fill)
        for (let i = 0; i <= 5; i++) {
          state.bag[i] = Math.max(0, state.bag[i] - entry.tileCounts[i]);
        }
        break;
      }

      case "wallPlacement": {
        for (const placement of Object.values(entry.placements)) {
          state.wall[placement.placedType]++;
          for (const discardedType of placement.discardedTypes) {
            state.discard[discardedType]++;
          }
        }
        break;
      }

      case "floorClear": {
        for (const tiles of Object.values(entry.floorTiles)) {
          for (const tileType of tiles) {
            state.discard[tileType]++;
          }
        }
        break;
      }
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Serialize game state for side panel message passing. */
export function toJSON(state: AzulGameState): SerializedAzulGameState {
  return {
    bag: [...state.bag],
    discard: [...state.discard],
    wall: [...state.wall],
    refillRounds: [...state.refillRounds],
  };
}

/** Deserialize game state from side panel message. */
export function fromJSON(data: SerializedAzulGameState): AzulGameState {
  return {
    bag: [...data.bag],
    discard: [...data.discard],
    wall: [...data.wall],
    refillRounds: [...data.refillRounds],
  };
}
