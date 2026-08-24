// Innovation-specific type definitions: Card, CardInfo, CardDatabase, enums, actions, log entries.

// Re-export shared types so Innovation modules can use a single import source.
export type { RawNotification, RawPacket, RawExtractionData } from "../../models/types.js";
import { cardIndex } from "../../models/types.js";
export { cardIndex };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum CardSet {
  BASE = 0,
  FIGURES = 1,
  CITIES = 2,
  ECHOES = 3,
  ARTIFACTS = 4,
}

export enum Color {
  BLUE = 0,
  RED = 1,
  GREEN = 2,
  YELLOW = 3,
  PURPLE = 4,
}

/** Map Color enum value to its lowercase label. */
export function colorLabel(color: Color): string {
  return Color[color].toLowerCase();
}

/** Map CardSet enum value to its lowercase label. */
export function cardSetLabel(cardSet: CardSet): string {
  return CardSet[cardSet].toLowerCase();
}

/** Parse a lowercase label ("base" | "cities" | "echoes") to a CardSet enum. */
export function cardSetFromLabel(label: string): CardSet {
  const upper = label.toUpperCase();
  if (upper === "BASE") return CardSet.BASE;
  if (upper === "FIGURES") return CardSet.FIGURES;
  if (upper === "CITIES") return CardSet.CITIES;
  if (upper === "ECHOES") return CardSet.ECHOES;
  if (upper === "ARTIFACTS") return CardSet.ARTIFACTS;
  throw new Error(`Unknown card set label: ${label}`);
}

// ---------------------------------------------------------------------------
// AgeSet — compound key for card groups
// ---------------------------------------------------------------------------

/** String key for an (age, cardSet) pair, used as Map/object key. */
export type AgeSetKey = `${number}:${CardSet}`;

export function ageSetKey(age: number, cardSet: CardSet): AgeSetKey {
  return `${age}:${cardSet}`;
}

export function parseAgeSetKey(key: AgeSetKey): { age: number; cardSet: CardSet } {
  const [ageStr, setStr] = key.split(":");
  return { age: Number(ageStr), cardSet: Number(setStr) as CardSet };
}

// ---------------------------------------------------------------------------
// Opponent knowledge — discriminated union
// ---------------------------------------------------------------------------

export type OpponentKnowledge =
  | { kind: "none" }
  | { kind: "partial"; suspects: Set<string>; closed: boolean }
  | { kind: "exact"; name: string | null };

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export class Card {
  age: number;
  cardSet: CardSet;
  candidates: Set<string>;
  opponentKnowledge: OpponentKnowledge;

  constructor(age: number, cardSet: CardSet, candidates?: Iterable<string>) {
    this.age = age;
    this.cardSet = cardSet;
    this.candidates = new Set(candidates);
    this.opponentKnowledge = { kind: "none" };
  }

  get isResolved(): boolean {
    return this.candidates.size === 1;
  }

  /** The single resolved name, or null if unresolved. */
  get resolvedName(): string | null {
    if (this.isResolved) {
      return this.candidates.values().next().value!;
    }
    return null;
  }

}

// ---------------------------------------------------------------------------
// CardInfo — static database entry
// ---------------------------------------------------------------------------

export interface CardInfo {
  name: string;
  indexName: string;
  age: number;
  color: Color;
  cardSet: CardSet;
  spriteIndex: number;
  icons: readonly string[];
  dogmas: readonly string[];
  isRelic: boolean;
}

// ---------------------------------------------------------------------------
// CardDatabase
// ---------------------------------------------------------------------------

/** Raw JSON entry shape from card_info.json. */
interface RawCardEntry {
  name: string;
  age: number;
  color: string;
  set: number;
  icons?: string[];
  dogmas?: string[];
  is_relic?: boolean;
}

const COLOR_MAP: Record<string, Color> = {
  blue: Color.BLUE,
  red: Color.RED,
  green: Color.GREEN,
  yellow: Color.YELLOW,
  purple: Color.PURPLE,
};

export class CardDatabase {
  private _cards: Map<string, CardInfo> = new Map();
  private _groups: Map<AgeSetKey, Set<string>> = new Map();
  private _groupInfos: Map<AgeSetKey, CardInfo[]> = new Map();

  constructor(rawEntries: (RawCardEntry | null)[]) {
    for (let idx = 0; idx < rawEntries.length; idx++) {
      const item = rawEntries[idx];
      if (item === null || item === undefined || !("age" in item) || !("color" in item)) continue;
      if (item.set !== CardSet.BASE && item.set !== CardSet.FIGURES && item.set !== CardSet.CITIES && item.set !== CardSet.ECHOES && item.set !== CardSet.ARTIFACTS) continue;

      const indexName = cardIndex(item.name);
      const color = COLOR_MAP[item.color.toLowerCase()];
      if (color === undefined) continue;

      const info: CardInfo = {
        name: item.name,
        indexName,
        age: item.age,
        color,
        cardSet: item.set as CardSet,
        spriteIndex: idx,
        icons: item.icons ?? [],
        dogmas: item.dogmas ?? [],
        isRelic: item.is_relic === true,
      };
      this._cards.set(indexName, info);
    }

    // Build groups — relic cards and Figures cards are excluded. Relics start
    // in the relics zone (engine creates them separately). Figures cards are
    // loaded into _cards for name lookups (relic seizes, transfers) but don't
    // have tracked decks.
    for (const info of this._cards.values()) {
      if (info.isRelic || info.cardSet === CardSet.FIGURES) continue;
      const key = ageSetKey(info.age, info.cardSet);
      let group = this._groups.get(key);
      if (!group) {
        group = new Set();
        this._groups.set(key, group);
      }
      group.add(info.indexName);
    }

    // Build sorted group infos
    for (const [key, names] of this._groups) {
      const infos = [...names].map((n) => this._cards.get(n)!);
      infos.sort((a, b) => a.color - b.color || a.indexName.localeCompare(b.indexName));
      this._groupInfos.set(key, infos);
    }
  }

  get(nameIndex: string): CardInfo | undefined {
    return this._cards.get(nameIndex);
  }

  has(nameIndex: string): boolean {
    return this._cards.has(nameIndex);
  }

  get size(): number {
    return this._cards.size;
  }

  keys(): IterableIterator<string> {
    return this._cards.keys();
  }

  values(): IterableIterator<CardInfo> {
    return this._cards.values();
  }

  entries(): IterableIterator<[string, CardInfo]> {
    return this._cards.entries();
  }

  displayName(nameIndex: string): string {
    const info = this._cards.get(nameIndex);
    if (!info) throw new Error(`Unknown card: ${nameIndex}`);
    return info.name;
  }

  /** Return all (age, cardSet) groups as a Map of AgeSetKey -> set of index names. */
  groups(): Map<AgeSetKey, Set<string>> {
    return this._groups;
  }

  /** Return CardInfo objects for an (age, cardSet) group, sorted by color then name. */
  groupInfos(age: number, cardSet: CardSet): CardInfo[] {
    return this._groupInfos.get(ageSetKey(age, cardSet)) ?? [];
  }

  /** Sorting key tuple for ordering cards. */
  sortKey(nameIndex: string): [number, Color, string] {
    const info = this._cards.get(nameIndex);
    if (!info) throw new Error(`Unknown card: ${nameIndex}`);
    return [info.age, info.color, nameIndex];
  }
}

// ---------------------------------------------------------------------------
// Action — discriminated union (named vs grouped)
// ---------------------------------------------------------------------------

/** Zone names for card locations. */
export type Zone = "deck" | "hand" | "board" | "score" | "revealed" | "forecast" | "display" | "relics" | "achievements" | "removed";

interface ActionBase {
  source: Zone;
  dest: Zone;
  sourcePlayer: string | null;
  destPlayer: string | null;
  meldKeyword: boolean;
  topOfDeck: boolean;
  /** BGA's index of the card inside the stack it left. See TransferEntry.sourcePosition. */
  sourcePosition?: number;
  /** BGA's index of the card inside the stack it joined. See TransferEntry.destPosition. */
  destPosition?: number;
}

export interface NamedAction extends ActionBase {
  type: "named";
  cardName: string;
}

export interface GroupedAction extends ActionBase {
  type: "grouped";
  age: number;
  cardSet: CardSet;
}

export type Action = NamedAction | GroupedAction;

// ---------------------------------------------------------------------------
// Game log entry types — discriminated union
// ---------------------------------------------------------------------------

export interface TransferEntry {
  type: "transfer";
  move: number;
  cardSet: string;
  source: string;
  dest: string;
  cardName: string | null;
  cardAge: number | null;
  sourceOwner: string | null;
  destOwner: string | null;
  meldKeyword: boolean;
  topOfDeck: boolean;
  /** BGA's `position_from`: the index the card occupied in the stack it left. Private
   *  zones (hand, score, forecast) keep one stack per (owner, age, set), filled by
   *  appending and closed up when a card leaves, so the index names one specific card
   *  even when BGA withholds its identity. Decks number from the bottom instead, and
   *  the remaining zones use a single per-owner stack. Absent on logs recorded before
   *  the field was captured. */
  sourcePosition?: number;
  /** BGA's `position_to`: the index the card took in the stack it joined. An ordinary
   *  insert appends, so the index doubles as the size that stack had in BGA's model —
   *  the engine audits its own bookkeeping against it. Insertions at the bottom report 0
   *  regardless. Absent on logs recorded before the field was captured. */
  destPosition?: number;
}

export interface MessageEntry {
  type: "log" | "logWithCardTooltips";
  move: number;
  msg: string;
}

/** A sweep of cards leaves the game. BGA sends one notification for the whole sweep rather than a
 *  transfer per card, so the log carries the instruction and the engine works out which of its own
 *  cards it hits. Named per the card that causes it. */
export interface FissionRemoval {
  type: "removal";
  move: number;
  /** Every hand, board, score pile and revealed card, for every player. Forecasts, displays and
   *  achievements survive. Fission, base age 9. */
  scope: "hands-boards-scores";
}

export interface DeLoreanRemoval {
  type: "removal";
  move: number;
  /** Every hand, plus the top card of every board pile. DeLorean DMC-12, Artifacts age 10. */
  scope: "top-cards-and-hands";
  /** The board tops the sweep takes. They are face up, so BGA names them rather than leaving the
   *  pile order to be guessed at. */
  cardNames: string[];
}

export interface PlayerRemoval {
  type: "removal";
  move: number;
  /** Everything one player owns, that player being out of the game. Exxon Valdez, Artifacts 10. */
  scope: "player";
  player: string;
}

export type RemovalEntry = FissionRemoval | DeLoreanRemoval | PlayerRemoval;

export type GameLogEntry = TransferEntry | MessageEntry | RemovalEntry;
