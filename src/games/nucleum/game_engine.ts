// Nucleum game engine: log entries -> turn history.
//
// One Nucleum turn is one `TurnAction`, whose details are the actions the player chose during
// it. Three things make that more than a group-by:
//
//  - an undo rewinds the turn, and BGA signals it by starting the same player's turn again;
//  - a railway placement only names the cities it joined once the link is complete, which has
//    to be read out of the network resync that follows it;
//  - repeated free conversions collapse into one row rather than three.

import type { NucleumGameLog, NucleumLogEntry } from "./process_log.js";
import { createNucleumGameState, type NucleumGameState } from "./game_state.js";
import type { NucleumActionDetail, NucleumActionType, NucleumTurnAction } from "./types.js";

/** Actions a player may repeat within one turn, shown once with a count. */
const COUNTED: ReadonlySet<NucleumActionType> = new Set<NucleumActionType>(["develop", "sell"]);

function detail(actionType: NucleumActionType, player: string, extra: Partial<NucleumActionDetail> = {}): NucleumActionDetail {
  return { actionType, player, city: null, link: null, count: null, label: null, ...extra };
}

/**
 * Replay a Nucleum log into its turn history.
 */
export function processNucleumState(gameLog: NucleumGameLog): NucleumGameState {
  const state = createNucleumGameState(gameLog.players);

  /** The turn currently collecting actions, and whether BGA has already ended it. */
  let open: NucleumTurnAction | null = null;
  let openEnded = false;
  /** A tile went to the player board this turn — the row to show if nothing else happens. */
  let openPlayedTile = false;
  /** The most recent railway placement, still waiting to learn whether it completed a link. */
  let pendingRailway: NucleumActionDetail | null = null;
  /** Each player's city pairs as of the last network resync, to diff the next one against. */
  const seenConns = new Map<string, Set<string>>();

  /** Give a turn with no actions something to say. */
  const settle = (action: NucleumTurnAction, playedTile: boolean): void => {
    if (action.actions.length === 0) action.actions.push(detail(playedTile ? "tile" : "pending", action.player));
  };

  const record = (entryDetail: NucleumActionDetail): void => {
    if (!open) return;
    const last = open.actions[open.actions.length - 1];
    if (last && COUNTED.has(entryDetail.actionType) && last.actionType === entryDetail.actionType && last.player === entryDetail.player) {
      last.count = (last.count ?? 1) + (entryDetail.count ?? 1);
      return;
    }
    open.actions.push(entryDetail);
  };

  for (let index = 0; index < gameLog.log.length; index++) {
    const entry: NucleumLogEntry = gameLog.log[index];

    switch (entry.type) {
      case "turnStart": {
        // A second turn start for a player whose turn has not ended is an undo rewinding the
        // whole turn. Everything collected so far was cancelled; the row keeps its identity
        // (and its place in the log) and is rebuilt from whatever the player does instead.
        if (open && open.player === entry.player && !openEnded) {
          open.actions.length = 0;
          openPlayedTile = false;
          pendingRailway = null;
          break;
        }
        if (open) settle(open, openPlayedTile);
        open = { player: entry.player, actionNumber: 1, time: entry.time, logIndex: index, actions: [] };
        openEnded = false;
        openPlayedTile = false;
        pendingRailway = null;
        state.actions.push(open);
        break;
      }

      case "turnEnd":
        if (open && open.player === entry.player) {
          settle(open, openPlayedTile);
          openEnded = true;
        }
        break;

      case "experiment":
        // Setup, before any turn has started: its own row rather than part of one.
        state.actions.push({ player: entry.player, actionNumber: 1, time: entry.time, logIndex: index, actions: [detail("experiment", entry.player, { label: entry.name })] });
        break;

      case "networks": {
        for (const [playerId, pairs] of Object.entries(entry.conns)) {
          const now = new Set(pairs.map(([a, b]) => `${a}-${b}`));
          const before = seenConns.get(playerId);
          // A pair appears here exactly when the link holding it is completed, so the first new
          // one after a placement names the two cities that placement joined.
          if (before && pendingRailway && pendingRailway.player === playerId) {
            for (const pair of now) {
              if (before.has(pair)) continue;
              const [a, b] = pair.split("-").map(Number);
              pendingRailway.link = [a, b];
              break;
            }
          }
          seenConns.set(playerId, now);
        }
        break;
      }

      case "playTile":
        openPlayedTile = true;
        break;

      case "railway": {
        const railway = detail("railway", entry.player);
        pendingRailway = railway;
        record(railway);
        break;
      }

      case "urbanize":
      case "mine":
      case "turbine":
        record(detail(entry.type, entry.player, { city: entry.city }));
        break;

      case "energize":
        record(detail("energize", entry.player, { city: entry.city }));
        break;

      case "nucleum":
        record(detail("nucleum", entry.player, { city: entry.city }));
        break;

      case "develop":
        record(detail("develop", entry.player, { count: entry.count }));
        break;

      case "sell":
        record(detail("sell", entry.player, { count: 1 }));
        break;

      case "milestone":
        record(detail("milestone", entry.player));
        break;

      case "recharge":
        // A recharge places a milestone marker on the way, and BGA reports the marker first.
        // The marker is part of recharging, not a second thing the player chose, so it goes;
        // a marker with no recharge behind it — the end-game final placement — stays.
        if (open) open.actions = open.actions.filter(a => !(a.actionType === "milestone" && a.player === entry.player));
        record(detail("recharge", entry.player));
        break;

      case "contract":
      case "fulfill":
      case "tech":
        record(detail(entry.type, entry.player));
        break;
    }
  }

  // The turn in progress gets a row too, so the history shows whose turn it is.
  if (open) settle(open, openPlayedTile);

  return state;
}
