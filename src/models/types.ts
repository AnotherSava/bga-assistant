// All type definitions: Card, CardInfo, GameState, Action, enums

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum CardSet {
  BASE = 0,
  CITIES = 2,
  ECHOES = 3,
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
  if (upper === "CITIES") return CardSet.CITIES;
  if (upper === "ECHOES") return CardSet.ECHOES;
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

/** Convert a display card name to a lowercase index key. */
export function cardIndex(name: string): string {
  return name.toLowerCase();
}

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

  get groupKey(): AgeSetKey {
    return ageSetKey(this.age, this.cardSet);
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

  /** Remove names from candidates. Returns true if candidates changed. */
  removeCandidates(names: Set<string>): boolean {
    const before = this.candidates.size;
    for (const name of names) {
      this.candidates.delete(name);
    }
    return this.candidates.size < before;
  }

  /** Resolve this card to a single known identity. */
  resolve(name: string): void {
    this.candidates = new Set([name]);
  }

  /** Mark this card as publicly known to opponent. */
  markPublic(): void {
    this.opponentKnowledge = { kind: "exact", name: this.resolvedName };
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
      if (item.set !== CardSet.BASE && item.set !== CardSet.CITIES && item.set !== CardSet.ECHOES) continue;

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
      };
      this._cards.set(indexName, info);
    }

    // Build groups
    for (const info of this._cards.values()) {
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
export type Zone = "deck" | "hand" | "board" | "score" | "revealed";

interface ActionBase {
  source: Zone;
  dest: Zone;
  sourcePlayer: string | null;
  destPlayer: string | null;
  meldKeyword: boolean;
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
}

export interface MessageEntry {
  type: "log" | "logWithCardTooltips";
  move: number;
  msg: string;
}

export type GameLogEntry = TransferEntry | MessageEntry;
