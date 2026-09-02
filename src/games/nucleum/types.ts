// Nucleum types: the board's cities and the actions a turn history row can name.

import type { TurnAction } from "../../engine/turn_history.js";

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

/**
 * City names by BGA city id, from the game's own `CITY_*` constants (0-18).
 *
 * Both board sides share one numbering — the 1/2-player map simply has no Karlsbad or
 * Görlitz — so a single table covers every table size. Names are proper nouns and BGA does
 * not translate them: `placeNucleum` ships `cityName` pre-rendered and it matches these.
 */
const CITY_NAMES: readonly string[] = [
  "Plauen", "Zittau", "Glashütte", "Grimma", "Riesa", "Leipzig", "Chemnitz", "Zwickau",
  "Joachimsthal", "Freiberg", "Marienberg", "Pressnitz", "Brüx", "Dresden", "Bautzen",
  "Aussig", "Praha", "Karlsbad", "Görlitz",
];

/** Name a city id, or null when the id is outside the board's range. */
export function cityName(city: number | null): string | null {
  if (city === null || city < 0 || city >= CITY_NAMES.length) return null;
  return CITY_NAMES[city];
}

// ---------------------------------------------------------------------------
// Turn actions
// ---------------------------------------------------------------------------

/**
 * What a turn-history row says a player did.
 *
 * Only choices a player made are here. Everything a choice *produced* — thaler, workers, VP,
 * income, achievements, uranium, market refills — is dropped, the same scope the Innovation
 * history keeps.
 */
export type NucleumActionType =
  | "urbanize"
  | "mine"
  | "turbine"
  | "develop"
  | "contract"
  | "fulfill"
  | "energize"
  | "tech"
  | "nucleum"
  | "milestone"
  | "sell"
  | "railway"
  | "recharge"
  | "experiment"
  /** A tile went to the player board and both of its actions were skipped. */
  | "tile"
  /** A turn that is still being played, so nothing can be said about it yet. */
  | "pending";

export interface NucleumActionDetail {
  actionType: NucleumActionType;
  /** Whoever performed it. Usually the turn owner, but a railway colour match lets one player
   *  act during another player's turn, and then the row names them. */
  player: string;
  /** City the action happened in, for the actions that name one. */
  city: number | null;
  /** The two cities a railway placement joined, when it completed the link. */
  link: [number, number] | null;
  /** How many, for the actions that repeat within a turn (`develop`, `sell`). */
  count: number | null;
  /** Free-text label, used only by the setup experiment choice. */
  label: string | null;
}

export type NucleumTurnAction = TurnAction<NucleumActionDetail>;
