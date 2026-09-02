// Raw BGA packets -> structured Nucleum game log.
//
// Nucleum sends one packet stream with no spectator duplicates, so unlike Innovation there is
// nothing to dedupe. What it does send is a lot of noise: 119 `getBonus` deltas and 106 `msg`
// lines in a mid-game table, none of which is a decision anybody made. Only the notifications
// that mark a turn boundary or name a chosen action are kept.

import type { PlayerInfo, RawExtractionData, RawPacket } from "../../models/types.js";

// ---------------------------------------------------------------------------
// Nucleum log entry types — discriminated union
// ---------------------------------------------------------------------------

/** A player became the active player with the main-action prompt up. */
export interface TurnStartEntry {
  type: "turnStart";
  player: string;
  time: number | null;
}

/** The active player's turn finished. Absent between two `turnStart`s for the same player,
 *  which is exactly how an undo rewind is told apart from a new turn. */
export interface TurnEndEntry {
  type: "turnEnd";
  player: string;
}

/** An Action tile went to the player board. Only a fallback for the row text — what the two
 *  actions on it did is what the row actually says. */
export interface PlayTileEntry {
  type: "playTile";
  player: string;
  slot: number;
}

/** An Action tile went on the map as a railway. */
export interface RailwayEntry {
  type: "railway";
  player: string;
  tile: number;
  road: number;
}

/** A building, mine or turbine was placed in a city. */
export interface PlaceEntry {
  type: "urbanize" | "mine" | "turbine";
  player: string;
  city: number;
}

/** Action tiles bought from the market. */
export interface DevelopEntry {
  type: "develop";
  player: string;
  count: number;
}

/** Contract taken from the offer, or one already held fulfilled. */
export interface ContractEntry {
  type: "contract" | "fulfill";
  player: string;
}

/** A building was energized. `city` is the power plant that fed it. */
export interface EnergizeEntry {
  type: "energize";
  player: string;
  city: number | null;
}

/** A technology was unlocked, a milestone marker placed, or a uranium sold for a worker. */
export interface SimpleEntry {
  type: "tech" | "milestone" | "sell" | "recharge";
  player: string;
}

/** A Nucleum was placed on a power plant. */
export interface NucleumEntry {
  type: "nucleum";
  player: string;
  city: number;
}

/** The setup draft: which experiment a player took. */
export interface ExperimentEntry {
  type: "experiment";
  player: string;
  time: number | null;
  name: string;
}

/** Authoritative resync of which city pairs each player's railways directly link. A pair
 *  appears here exactly when the link holding it is completed. */
export interface NetworksEntry {
  type: "networks";
  conns: Record<string, [number, number][]>;
}

export type NucleumLogEntry =
  | TurnStartEntry
  | TurnEndEntry
  | PlayTileEntry
  | RailwayEntry
  | PlaceEntry
  | DevelopEntry
  | ContractEntry
  | EnergizeEntry
  | SimpleEntry
  | NucleumEntry
  | ExperimentEntry
  | NetworksEntry;

/** Structured Nucleum game log output from processNucleumLog. */
export interface NucleumGameLog {
  gameName: "nucleum";
  players: Record<string, PlayerInfo>;
  currentPlayerId?: string;
  log: NucleumLogEntry[];
}

// ---------------------------------------------------------------------------
// BGA notification shapes (internal)
// ---------------------------------------------------------------------------

/** BGA's own state ids, from the game's `ST_*` constants. */
const STATE_PLAYER_TURN = 2;
const STATE_NEXT_PLAYER = 3;

interface StateChangeArgs {
  id?: number;
  active_player?: string | number;
  args?: { main?: boolean; realActive?: boolean };
}

// ---------------------------------------------------------------------------
// Log processing
// ---------------------------------------------------------------------------

/**
 * Transform raw BGA packets into structured Nucleum log entries.
 *
 * Notifications that carry a `player_name` are attributed to that player, because a railway
 * colour match can hand an action to somebody other than the player whose turn it is. The
 * handful that carry no name at all — recharge, uranium sales — belong to whoever is active.
 */
export function processNucleumLog(rawData: RawExtractionData): NucleumGameLog {
  const players: Record<string, PlayerInfo> = rawData.players ?? {};
  const allPackets: RawPacket[] = rawData.packets ?? [];
  const log: NucleumLogEntry[] = [];

  const idByName = new Map<string, string>();
  for (const player of Object.values(players)) idByName.set(player.name, player.id);

  let activePlayer: string | null = null;
  // Set by `startEnergize` and read by the `energize` that follows it: only the former names
  // the power plant, and only the latter says a building was actually lit.
  let pendingPlant: number | null = null;

  /** Whoever an action belongs to: the name it carries, else the active player. */
  const actor = (args: Record<string, unknown>): string | null => {
    const name = typeof args.player_name === "string" ? args.player_name : null;
    return (name ? idByName.get(name) : null) ?? activePlayer;
  };

  for (const packet of allPackets) {
    for (const notif of packet.data) {
      const args = notif.args ?? {};

      if (notif.type === "gameStateChange") {
        const state = args as StateChangeArgs;
        const player = state.active_player != null ? String(state.active_player) : null;
        if (state.id === STATE_NEXT_PLAYER) {
          if (player) log.push({ type: "turnEnd", player });
          continue;
        }
        if (state.id !== STATE_PLAYER_TURN || !player) continue;
        // A state pushed while a stale pending node is still around names a player who is not
        // really on turn; attributing the next nameless notification to them would be wrong.
        if (state.args?.realActive !== false) activePlayer = player;
        if (state.args?.main === true) log.push({ type: "turnStart", player, time: packet.time ?? null });
        continue;
      }

      const player = actor(args);
      if (!player) {
        // The one exception: a network resync belongs to no player.
        if (notif.type === "updateNetworks") log.push({ type: "networks", conns: parseConns(args.conns) });
        continue;
      }

      switch (notif.type) {
        case "chooseExperiment":
          log.push({ type: "experiment", player, time: packet.time ?? null, name: String(args.experiment ?? "") });
          break;
        case "playTile":
          log.push({ type: "playTile", player, slot: Number(args.slot ?? 0) });
          break;
        case "placeTile":
          log.push({ type: "railway", player, tile: Number(args.tile), road: Number(args.road) });
          break;
        case "urbanize":
          log.push({ type: "urbanize", player, city: Number(args.city) });
          break;
        case "placeMine":
          log.push({ type: "mine", player, city: Number(args.city) });
          break;
        case "placeTurbine":
          log.push({ type: "turbine", player, city: Number(args.city) });
          break;
        case "getActionTiles": {
          const tiles = Array.isArray(args.tiles) ? args.tiles : [];
          // Named = tiles bought from the market (Develop); nameless = every played tile coming
          // back to the pool, which is the second half of a Recharge.
          if (typeof args.player_name === "string" && args.player_name !== "") log.push({ type: "develop", player, count: tiles.length });
          else log.push({ type: "recharge", player });
          break;
        }
        case "getContract":
          log.push({ type: "contract", player });
          break;
        case "resolveContract":
          log.push({ type: "fulfill", player });
          break;
        case "startEnergize":
          pendingPlant = Number(args.plant);
          break;
        case "energize":
          log.push({ type: "energize", player, city: pendingPlant });
          pendingPlant = null;
          break;
        case "unlockTech":
          log.push({ type: "tech", player });
          break;
        case "placeNucleum":
          log.push({ type: "nucleum", player, city: Number(args.city) });
          break;
        case "placeMileStone":
          log.push({ type: "milestone", player: args.pid != null ? String(args.pid) : player });
          break;
        case "spendUranium":
          // A negative plant means the uranium was sold for a worker rather than routed to a
          // power plant; routing is part of an energize and says nothing extra.
          if (Number(args.plant) < 0) log.push({ type: "sell", player });
          break;
        case "updateNetworks":
          log.push({ type: "networks", conns: parseConns(args.conns) });
          break;
      }
    }
  }

  return { gameName: "nucleum" as const, players, currentPlayerId: rawData.currentPlayerId, log };
}

/** Normalize `updateNetworks.conns` into sorted city pairs per player id. */
function parseConns(raw: unknown): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [playerId, pairs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(pairs)) continue;
    out[playerId] = pairs
      .filter((pair): pair is number[] => Array.isArray(pair) && pair.length >= 2)
      .map((pair) => (pair[0] <= pair[1] ? [pair[0], pair[1]] : [pair[1], pair[0]]) as [number, number]);
  }
  return out;
}
