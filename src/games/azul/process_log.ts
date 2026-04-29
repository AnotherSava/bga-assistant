// Raw BGA packets -> structured Azul game log

import type { PlayerInfo, RawExtractionData, RawPacket } from "../../models/types.js";
import type { TileCounts } from "./game_state.js";

// ---------------------------------------------------------------------------
// Azul tile types
// ---------------------------------------------------------------------------

/** BGA tile type constants. 0 = first-player marker, 1-5 = colors. */
export const TILE_TYPES = {
  FIRST_PLAYER: 0,
  BLACK: 1,
  CYAN: 2,
  BLUE: 3,
  YELLOW: 4,
  RED: 5,
} as const;

/** Number of distinct color types (1-5). */
export const COLOR_COUNT = 5;

/** Check if a tile type is a valid color (not the first-player marker). */
function isColorTile(type: number): boolean {
  return type >= TILE_TYPES.BLACK && type <= TILE_TYPES.RED;
}

// ---------------------------------------------------------------------------
// Azul log entry types — discriminated union
// ---------------------------------------------------------------------------

/** Tiles drawn from bag to fill factories at the start of a round. */
export interface FactoryFillEntry {
  type: "factoryFill";
  /** Number of tiles drawn per type (index = tile type 0-5). */
  tileCounts: TileCounts;
  /** Tiles remaining in bag after draw (from BGA server). */
  remainingTiles: number;
}

/** End-of-round wall tiling: one tile placed, extras discarded per player. */
export interface WallPlacementEntry {
  type: "wallPlacement";
  /** Per-player placement: player ID -> placed tile type + discarded tile types. */
  placements: Record<string, { placedType: number; discardedTypes: number[] }>;
}

/** End-of-round floor clearing: discarded floor tiles per player. */
export interface FloorClearEntry {
  type: "floorClear";
  /** Per-player floor tiles: player ID -> array of tile types (excluding type 0). */
  floorTiles: Record<string, number[]>;
}

export type AzulLogEntry = FactoryFillEntry | WallPlacementEntry | FloorClearEntry;

/** Structured Azul game log output from processAzulLog. */
export interface AzulGameLog {
  gameName: "azul";
  players: Record<string, PlayerInfo>;
  log: AzulLogEntry[];
}

// ---------------------------------------------------------------------------
// BGA notification shapes (internal)
// ---------------------------------------------------------------------------

interface BgaTile {
  id: number;
  type: number;
  column: number;
  line: number;
  location: string;
}

interface BgaCompleteLine {
  placedTile: BgaTile;
  discardedTiles: BgaTile[];
  pointsDetail: unknown;
}

interface BgaFloorLine {
  points: number;
  tiles: BgaTile[];
}

// ---------------------------------------------------------------------------
// Log processing
// ---------------------------------------------------------------------------

/**
 * Transform raw BGA packets into structured Azul game log entries.
 *
 * Extracts three notification types relevant to bag/discard/wall tracking:
 * - factoriesFilled: tiles drawn from bag at round start
 * - placeTileOnWall: tiles placed on wall + extras discarded at round end
 * - emptyFloorLine: floor tiles discarded at round end
 */
export function processAzulLog(rawData: RawExtractionData): AzulGameLog {
  const players: Record<string, PlayerInfo> = rawData.players ?? {};
  const allPackets: RawPacket[] = rawData.packets ?? [];
  const log: AzulLogEntry[] = [];

  for (const packet of allPackets) {
    for (const notif of packet.data) {
      if (notif.type === "factoriesFilled") {
        log.push(parseFactoriesFilled(notif.args));
      } else if (notif.type === "placeTileOnWall") {
        log.push(parsePlaceTileOnWall(notif.args));
      } else if (notif.type === "emptyFloorLine") {
        const entry = parseEmptyFloorLine(notif.args);
        if (entry) log.push(entry);
      }
    }
  }

  return { gameName: "azul" as const, players, log };
}

/** Parse a factoriesFilled notification into a FactoryFillEntry. */
function parseFactoriesFilled(args: Record<string, unknown>): FactoryFillEntry {
  const factories = (args.factories as BgaTile[][] | undefined) ?? [];
  const tileCounts: TileCounts = [0, 0, 0, 0, 0, 0];

  for (const factory of factories) {
    for (const tile of factory) {
      if (isColorTile(tile.type)) {
        tileCounts[tile.type]++;
      }
    }
  }

  return {
    type: "factoryFill",
    tileCounts,
    remainingTiles: (args.remainingTiles as number) ?? 0,
  };
}

/** Parse a placeTileOnWall notification into a WallPlacementEntry. */
function parsePlaceTileOnWall(args: Record<string, unknown>): WallPlacementEntry {
  const completeLines = (args.completeLines as Record<string, BgaCompleteLine> | undefined) ?? {};
  const placements: Record<string, { placedType: number; discardedTypes: number[] }> = {};

  for (const [playerId, line] of Object.entries(completeLines)) {
    placements[playerId] = {
      placedType: line.placedTile.type,
      discardedTypes: line.discardedTiles.filter((t) => isColorTile(t.type)).map((t) => t.type),
    };
  }

  return { type: "wallPlacement", placements };
}

/** Parse an emptyFloorLine notification into a FloorClearEntry, or null if no color tiles. */
function parseEmptyFloorLine(args: Record<string, unknown>): FloorClearEntry | null {
  const floorLines = args.floorLines;

  // floorLines can be an empty array [] when no players have floor tiles,
  // or absent entirely in edge cases
  if (!floorLines || Array.isArray(floorLines)) return null;

  const floorLinesObj = floorLines as Record<string, BgaFloorLine>;
  const floorTiles: Record<string, number[]> = {};
  let hasColorTiles = false;

  for (const [playerId, line] of Object.entries(floorLinesObj)) {
    const colorTypes = line.tiles.filter((t) => isColorTile(t.type)).map((t) => t.type);
    if (colorTypes.length > 0) {
      floorTiles[playerId] = colorTypes;
      hasColorTiles = true;
    }
  }

  if (!hasColorTiles) return null;

  return { type: "floorClear", floorTiles };
}
