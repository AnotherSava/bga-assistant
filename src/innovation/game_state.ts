// Unified game state engine: zone management, card movement, constraint propagation, serialization.
// Merges the original Python GameState + GameStateTracker into a single class.

import {
  type Action,
  type AgeSetKey,
  type GameLogEntry,
  type MessageEntry,
  type OpponentKnowledge,
  type TransferEntry,
  type Zone,
  Card,
  CardDatabase,
  CardSet,
  ageSetKey,
  cardIndex,
  cardSetFromLabel,
  cardSetLabel,
  parseAgeSetKey,
} from "../models/types.js";

const REGULAR_ICONS = new Set(["crown", "leaf", "lightbulb", "castle", "factory", "clock"]);

// ---------------------------------------------------------------------------
// Serialization types
// ---------------------------------------------------------------------------

interface SerializedCard {
  resolved?: string;
  age?: number;
  cardSet?: number;
  excluded?: string[];
  opponent?: SerializedOpponentKnowledge;
}

type SerializedOpponentKnowledge =
  | { kind: "exact"; name: string | null }
  | { kind: "partial"; suspects: string[]; closed: boolean };

interface SerializedGameState {
  decks: Record<string, SerializedCard[]>;
  hands: Record<string, SerializedCard[]>;
  boards: Record<string, SerializedCard[]>;
  scores: Record<string, SerializedCard[]>;
  revealed: Record<string, SerializedCard[]>;
  achievements: SerializedCard[];
}

// ---------------------------------------------------------------------------
// GameState
// ---------------------------------------------------------------------------

export class GameState {
  decks: Map<AgeSetKey, Card[]>;
  hands: Map<string, Card[]>;
  boards: Map<string, Card[]>;
  scores: Map<string, Card[]>;
  revealed: Map<string, Card[]>;
  achievements: Card[];

  /** All Card objects per (age, cardSet) group - master list for propagation. */
  private _groups: Map<AgeSetKey, Card[]>;

  private cardDb: CardDatabase;
  private players: string[];
  private perspective: string;
  private playerPattern: string;

  // Cities meld-filter tracking
  private meldIcon: string | null = null;
  private discardNames: Set<string> = new Set();
  private remainingReturns: number = 0;

  constructor(cardDb: CardDatabase, players: string[], perspective: string) {
    this.cardDb = cardDb;
    this.players = players;
    this.perspective = perspective;
    this.playerPattern = players.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

    this.decks = new Map();
    this.hands = new Map(players.map(p => [p, []]));
    this.boards = new Map(players.map(p => [p, []]));
    this.scores = new Map(players.map(p => [p, []]));
    this.revealed = new Map(players.map(p => [p, []]));
    this.achievements = [];
    this._groups = new Map();
  }

  // ------------------------------------------------------------------
  // Card creation
  // ------------------------------------------------------------------

  private createCard(groupKey: AgeSetKey, indexNames: Set<string>): Card {
    const { age, cardSet } = parseAgeSetKey(groupKey);
    const card = new Card(age, cardSet, indexNames);
    let group = this._groups.get(groupKey);
    if (!group) {
      group = [];
      this._groups.set(groupKey, group);
    }
    group.push(card);
    return card;
  }

  // ------------------------------------------------------------------
  // Zone accessors
  // ------------------------------------------------------------------

  /** Return the card list for a zone+player combination. */
  cardsAt(zone: Zone, player: string | null, groupKey?: AgeSetKey): Card[] {
    switch (zone) {
      case "deck":
        return this.decks.get(groupKey!) ?? [];
      case "hand":
        return this.hands.get(player!) ?? [];
      case "board":
        return this.boards.get(player!) ?? [];
      case "score":
        return this.scores.get(player!) ?? [];
      case "revealed":
        return this.revealed.get(player!) ?? [];
    }
  }

  /** Return the mutable card list for a zone, creating it if needed for decks. */
  private cardsAtMut(zone: Zone, player: string | null, groupKey: AgeSetKey): Card[] {
    if (zone === "deck") {
      let deck = this.decks.get(groupKey);
      if (!deck) {
        deck = [];
        this.decks.set(groupKey, deck);
      }
      return deck;
    }
    const zoneMap = zone === "hand" ? this.hands : zone === "board" ? this.boards : zone === "score" ? this.scores : this.revealed;
    const cards = zoneMap.get(player!);
    if (!cards) throw new Error(`Player "${player}" not found in ${zone} zone`);
    return cards;
  }

  // ------------------------------------------------------------------
  // Initialization
  // ------------------------------------------------------------------

  /** Set up initial game state: all cards in decks, achievements, initial deal. */
  initGame(expansions?: { echoes: boolean }): void {
    const echoesActive = expansions?.echoes ?? false;

    // Create all cards in decks
    for (const [groupKey, indexNames] of this.cardDb.groups()) {
      const deck: Card[] = [];
      for (let i = 0; i < indexNames.size; i++) {
        deck.push(this.createCard(groupKey, indexNames));
      }
      this.decks.set(groupKey, deck);
    }

    // Move 1 card per base age 1-9 to achievements
    for (let age = 1; age <= 9; age++) {
      const key = ageSetKey(age, CardSet.BASE);
      const deck = this.decks.get(key)!;
      this.achievements.push(deck.pop()!);
    }

    // Deal initial hand: 1 base + 1 echoes age-1 when echoes active, 2 base age-1 otherwise
    const baseAge1Deck = this.decks.get(ageSetKey(1, CardSet.BASE))!;
    const echoesAge1Deck = echoesActive ? this.decks.get(ageSetKey(1, CardSet.ECHOES)) : undefined;
    for (const player of this.players) {
      const hand = this.hands.get(player)!;
      hand.push(baseAge1Deck.pop()!);
      if (echoesActive && echoesAge1Deck) {
        hand.push(echoesAge1Deck.pop()!);
      } else {
        hand.push(baseAge1Deck.pop()!);
      }
    }
  }

  /** Resolve initial hand cards right after initGame. */
  resolveHand(player: string, cardNames: string[]): void {
    const hand = this.hands.get(player)!;
    const resolved = new Set<Card>();
    for (const idx of cardNames) {
      const card = hand.find(c => !resolved.has(c) && c.candidates.has(idx));
      if (!card) throw new Error(`Cannot resolve hand card "${idx}" for ${player}`);
      const info = this.cardDb.get(idx)!;
      const groupKey = ageSetKey(info.age, info.cardSet);
      card.resolve(idx);
      resolved.add(card);
      this.propagate(groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Log processing (replaces GameLogProcessor)
  // ------------------------------------------------------------------

  /** Deduce initial hand by reverse-walking the log to undo all hand transfers. */
  deduceInitialHand(log: GameLogEntry[], myHand: string[]): string[] {
    const hand = new Set(myHand);
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (entry.type !== "transfer") continue;
      if (entry.dest === "hand" && entry.destOwner === this.perspective) {
        if (entry.cardName !== null) hand.delete(entry.cardName);
      }
      if (entry.source === "hand" && entry.sourceOwner === this.perspective) {
        if (entry.cardName !== null) hand.add(entry.cardName);
      }
    }
    return [...hand].map(name => cardIndex(name));
  }

  /** Process the full game log: deduce hand, resolve, then process all entries. */
  processLog(log: GameLogEntry[], myHand: string[]): void {
    const initialHand = this.deduceInitialHand(log, myHand);
    this.resolveHand(this.perspective, initialHand);

    for (const entry of log) {
      this.processEntry(entry);
    }
  }

  /** Process a single log entry: dispatch to move, revealHand, or confirmMeldFilter. */
  private processEntry(entry: GameLogEntry): void {
    if (entry.type === "transfer") {
      const te = entry as TransferEntry;
      if (["achievements", "claimed", "flags"].includes(te.dest)) return;
      if (["achievements", "claimed", "flags"].includes(te.source)) return;
      this.processTransfer(te);
    } else if (entry.type === "logWithCardTooltips") {
      const me = entry as MessageEntry;
      const match = me.msg.match(new RegExp(`^(${this.playerPattern}) reveals (?:his|her|their) hand: (.+)\\.$`));
      if (match) {
        const cardNames = match[2].split(", ").map(part => cardIndex(part.substring(part.indexOf(" ") + 1)));
        this.revealHand(match[1], cardNames);
      }
    } else if (entry.type === "log") {
      const me = entry as MessageEntry;
      const match = me.msg.match(/The revealed cards with a \[(\w+)\] will be kept/);
      if (match) {
        this.confirmMeldFilter(match[1]);
      }
    }
  }

  private static readonly VALID_ZONES: ReadonlySet<string> = new Set(["deck", "hand", "board", "score", "revealed"]);

  /** Convert a TransferEntry to an Action and execute it. */
  private processTransfer(entry: TransferEntry): void {
    if (!GameState.VALID_ZONES.has(entry.source) || !GameState.VALID_ZONES.has(entry.dest)) return;

    const cardName = entry.cardName;
    const cardIdx = cardName ? cardIndex(cardName) : null;

    let action: Action;
    if (cardIdx && this.cardDb.has(cardIdx)) {
      action = {
        type: "named",
        cardName: cardIdx,
        source: entry.source as Zone,
        dest: entry.dest as Zone,
        sourcePlayer: entry.source !== "deck" ? entry.sourceOwner : null,
        destPlayer: entry.dest !== "deck" ? entry.destOwner : null,
        meldKeyword: entry.meldKeyword,
      };
    } else {
      if (entry.cardAge === null) return;
      action = {
        type: "grouped",
        age: entry.cardAge,
        cardSet: cardSetFromLabel(entry.cardSet),
        source: entry.source as Zone,
        dest: entry.dest as Zone,
        sourcePlayer: entry.source !== "deck" ? entry.sourceOwner : null,
        destPlayer: entry.dest !== "deck" ? entry.destOwner : null,
        meldKeyword: entry.meldKeyword,
      };
    }

    this.move(action);
  }

  // ------------------------------------------------------------------
  // Card movement
  // ------------------------------------------------------------------

  /** Move a card from one location to another. */
  move(action: Action): Card {
    const groupKey = action.type === "named"
      ? ageSetKey(this.cardDb.get(action.cardName)!.age, this.cardDb.get(action.cardName)!.cardSet)
      : ageSetKey(action.age, action.cardSet);

    // Detect city meld with a regular icon at position 5
    if (action.meldKeyword && action.source === "hand" && action.dest === "board" && action.type === "named") {
      const info = this.cardDb.get(action.cardName)!;
      if (info.cardSet === CardSet.CITIES && info.icons[5] !== undefined && REGULAR_ICONS.has(info.icons[5])) {
        this.meldIcon = info.icons[5];
        this.discardNames = new Set();
        this.remainingReturns = 0;
      }
    }

    // Track draws (draw phase: meld icon set, not yet confirmed)
    if (this.meldIcon && this.remainingReturns === 0) {
      if (action.source === "deck" && action.dest === "revealed" && action.type === "named") {
        if (!this.cardDb.get(action.cardName)!.icons.includes(this.meldIcon)) {
          this.discardNames.add(action.cardName);
        }
      } else if (action.source !== "revealed" && action.dest !== "board") {
        this.meldIcon = null;
      }
    }

    const card = this.takeFromSource(action, groupKey);
    this.cardsAtMut(action.dest, action.destPlayer, groupKey).push(card);
    this.updateOpponentKnowledge(card, action);

    // Filter returns (return phase: remaining > 0)
    // BGA routes meld filter returns through hand (revealed->hand, then hand->deck).
    if (this.remainingReturns > 0 && action.source === "hand" && action.dest === "deck" && card.isResolved && this.discardNames.has(card.resolvedName!)) {
      this.remainingReturns -= 1;
      if (this.remainingReturns === 0) {
        this.meldIcon = null;
      }
    }

    return card;
  }

  /** Confirm meld icon filtering - transition from draw phase to return phase. */
  confirmMeldFilter(_icon?: string): void {
    this.remainingReturns = this.discardNames.size;
    if (this.remainingReturns === 0) {
      this.meldIcon = null;
    }
  }

  /** Handle "reveals his hand" - resolve and mark cards without moving them. */
  revealHand(player: string, cardIndices: string[]): void {
    const hand = this.hands.get(player)!;
    for (const idx of cardIndices) {
      const info = this.cardDb.get(idx);
      if (!info) continue;
      const groupKey = ageSetKey(info.age, info.cardSet);
      const card = hand.find(c => c.candidates.has(idx));
      if (!card) continue;
      card.resolve(idx);
      card.markPublic();
      this.propagate(groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Internal mutation helpers
  // ------------------------------------------------------------------

  /** Find, resolve, remove, and merge at the source location. */
  private takeFromSource(action: Action, groupKey: AgeSetKey): Card {
    let sourceCards: Card[];
    let card: Card;

    if (action.source === "deck") {
      sourceCards = this.cardsAtMut(action.source, null, groupKey);
      if (sourceCards.length === 0) {
        throw new Error(`Cannot draw from empty deck: ${groupKey}`);
      }
      card = sourceCards[0];
    } else {
      sourceCards = this.cardsAt(action.source, action.sourcePlayer, groupKey);
      if (action.type === "named") {
        const found = sourceCards.find(c => c.candidates.has(action.cardName));
        if (!found) throw new Error(`Card "${action.cardName}" not found in ${action.source}`);
        card = found;
      } else {
        const found = sourceCards.find(c => c.groupKey === groupKey);
        if (!found) throw new Error(`No card with groupKey "${groupKey}" found in ${action.source}`);
        card = found;
      }
    }

    // Resolve if named and not yet resolved
    if (action.type === "named" && !card.isResolved) {
      card.resolve(action.cardName);
      this.propagate(groupKey);
    }

    // Remove from source
    const idx = sourceCards.indexOf(card);
    if (idx === -1) throw new Error("Card not found in source zone for removal");
    sourceCards.splice(idx, 1);

    // Hidden action from private zone: can't tell which card moved
    if (action.type === "grouped" && (action.source === "hand" || action.source === "score")) {
      this.mergeCandidates(card, sourceCards);
    }

    this.mergeSuspects(card, sourceCards, action);

    return card;
  }

  /** Update opponent knowledge flags after a move. */
  private updateOpponentKnowledge(card: Card, action: Action): void {
    const isVisibleToBoth = action.dest === "board" || action.dest === "revealed"
      || (action.sourcePlayer !== null && action.destPlayer !== null && action.sourcePlayer !== action.destPlayer);
    if (isVisibleToBoth) {
      card.markPublic();
      return;
    }

    const isVisibleToOpponent = (action.dest === "hand" || action.dest === "score") && action.destPlayer !== this.perspective;
    if (isVisibleToOpponent) {
      card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
    }
  }

  /** Merge candidate sets when we can't tell which card moved from a private zone. */
  private mergeCandidates(card: Card, remainingSource: Card[]): void {
    const affected = [card, ...remainingSource.filter(c => c.groupKey === card.groupKey)];
    if (affected.length <= 1) return;

    const union = new Set<string>();
    for (const c of affected) {
      for (const name of c.candidates) union.add(name);
    }

    for (const c of affected) {
      c.candidates = new Set(union);
    }
  }

  /** Merge suspect lists when opponent can't tell which card moved. */
  private mergeSuspects(card: Card, remainingSource: Card[], action: Action): void {
    // Only relevant when our card moves between private zones
    if (!(
      (action.source === "hand" || action.source === "score")
      && (action.dest === "deck" || action.dest === "hand" || action.dest === "score")
      && action.sourcePlayer === this.perspective
      && (action.destPlayer === null || action.destPlayer === this.perspective)
    )) return;

    const affected = [card, ...remainingSource.filter(c => c.groupKey === card.groupKey)];
    if (affected.length <= 1) return;

    // Collect all suspects and closed status
    const suspectUnion = new Set<string>();
    let allClosed = true;
    for (const c of affected) {
      const { suspects, closed } = extractSuspects(c.opponentKnowledge);
      for (const s of suspects) suspectUnion.add(s);
      if (!closed) allClosed = false;
    }

    // All cards lose certainty
    for (const c of affected) {
      if (suspectUnion.size === 0 && !allClosed) {
        c.opponentKnowledge = { kind: "none" };
      } else {
        c.opponentKnowledge = { kind: "partial", suspects: new Set(suspectUnion), closed: allClosed };
      }
    }
  }

  /** Restrict card candidates and suspects to a known set of possible names. */
  private restrictCandidates(card: Card, allowedNames: Set<string>): void {
    card.candidates = new Set(allowedNames);

    // Restrict opponent suspects
    if (card.opponentKnowledge.kind === "partial") {
      const newSuspects = new Set([...card.opponentKnowledge.suspects].filter(n => allowedNames.has(n)));
      if (card.opponentKnowledge.closed && newSuspects.size === 1) {
        card.opponentKnowledge = { kind: "exact", name: [...newSuspects][0] };
      } else {
        card.opponentKnowledge = { kind: "partial", suspects: newSuspects, closed: card.opponentKnowledge.closed };
      }
    }

    this.propagate(card.groupKey);
  }

  // ------------------------------------------------------------------
  // Constraint propagation
  // ------------------------------------------------------------------

  /** Propagate constraints within an (age, cardSet) group to fixed-point. */
  private propagate(groupKey: AgeSetKey): void {
    const group = this._groups.get(groupKey);
    if (!group) return;

    let changed = true;
    while (changed) {
      changed = false;

      // 1. Singleton propagation: resolved card's name removed from all others
      for (const card of group) {
        if (card.isResolved) {
          const name = card.resolvedName!;
          for (const other of group) {
            if (other !== card && other.candidates.has(name)) {
              other.candidates.delete(name);
              changed = true;
            }
          }
        }
      }

      // 2. Hidden singles: name appearing in only one unresolved card's candidates
      const unresolvedNames = new Set<string>();
      for (const card of group) {
        if (!card.isResolved) {
          for (const name of card.candidates) unresolvedNames.add(name);
        }
      }
      for (const candidateName of unresolvedNames) {
        const holders = group.filter(c => !c.isResolved && c.candidates.has(candidateName));
        if (holders.length === 1) {
          holders[0].resolve(candidateName);
          changed = true;
        }
      }

      // 3. Naked subsets (only when >3 unresolved cards)
      const unresolved = group.filter(c => !c.isResolved);
      if (unresolved.length > 3) {
        let foundSubset = false;
        for (let size = 2; size < unresolved.length && !foundSubset; size++) {
          for (const subset of combinations(unresolved, size)) {
            const union = new Set<string>();
            for (const c of subset) {
              for (const name of c.candidates) union.add(name);
            }
            if (union.size === size) {
              for (const other of unresolved) {
                if (!subset.includes(other)) {
                  for (const name of union) {
                    if (other.candidates.has(name)) {
                      other.candidates.delete(name);
                      changed = true;
                    }
                  }
                }
              }
              foundSubset = true;
              break;
            }
          }
        }
      }

      // 4. Suspect propagation: publicly-known names removed from suspect lists
      for (const card of group) {
        if (card.opponentKnowledge.kind === "exact" && card.isResolved) {
          const name = card.resolvedName!;
          for (const other of group) {
            if (other !== card && other.opponentKnowledge.kind === "partial") {
              if (other.opponentKnowledge.suspects.has(name)) {
                other.opponentKnowledge.suspects.delete(name);
                if (other.opponentKnowledge.closed && other.opponentKnowledge.suspects.size === 1) {
                  const remainingName = other.opponentKnowledge.suspects.values().next().value!;
                  other.opponentKnowledge = { kind: "exact", name: remainingName };
                  changed = true;
                }
              }
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /** True if the opponent has a partial (but not exact) suspect list for this card. */
  opponentHasPartialInformation(card: Card): boolean {
    if (card.opponentKnowledge.kind !== "partial") return false;
    if (card.opponentKnowledge.suspects.size === 0) return false;
    const group = this._groups.get(card.groupKey) ?? [];
    const hiddenCount = group.filter(c => c.opponentKnowledge.kind !== "exact").length;
    return card.opponentKnowledge.suspects.size < hiddenCount;
  }

  /** True if the opponent has no information about this card's identity. */
  opponentKnowsNothing(card: Card): boolean {
    return card.opponentKnowledge.kind !== "exact" && !this.opponentHasPartialInformation(card);
  }

  // ------------------------------------------------------------------
  // Serialization
  // ------------------------------------------------------------------

  /** Serialize full game state to a JSON-compatible object. */
  toJSON(): SerializedGameState {
    const serializeCard = (card: Card): SerializedCard => {
      const result: SerializedCard = {};

      if (card.isResolved) {
        result.resolved = card.resolvedName!;
      } else {
        result.age = card.age;
        result.cardSet = card.cardSet;
        // Store exclusions instead of full candidates
        const groupNames = this.cardDb.groups().get(card.groupKey);
        if (groupNames) {
          const excluded = [...groupNames].filter(n => !card.candidates.has(n)).sort();
          if (excluded.length > 0) {
            result.excluded = excluded;
          }
        }
      }

      // Serialize opponent knowledge (omit if "none")
      if (card.opponentKnowledge.kind === "exact") {
        result.opponent = { kind: "exact", name: card.opponentKnowledge.name };
      } else if (card.opponentKnowledge.kind === "partial") {
        result.opponent = { kind: "partial", suspects: [...card.opponentKnowledge.suspects].sort(), closed: card.opponentKnowledge.closed };
      }

      return result;
    };

    const serializeCards = (cards: Card[]): SerializedCard[] => cards.map(serializeCard);

    const decks: Record<string, SerializedCard[]> = {};
    for (const [key, cards] of this.decks) {
      if (cards.length > 0) {
        const { age, cardSet } = parseAgeSetKey(key);
        decks[`${age}/${cardSetLabel(cardSet)}`] = serializeCards(cards);
      }
    }

    const hands: Record<string, SerializedCard[]> = {};
    const boards: Record<string, SerializedCard[]> = {};
    const scores: Record<string, SerializedCard[]> = {};
    const revealed: Record<string, SerializedCard[]> = {};
    for (const player of this.players) {
      hands[player] = serializeCards(this.hands.get(player)!);
      boards[player] = serializeCards(this.boards.get(player)!);
      scores[player] = serializeCards(this.scores.get(player)!);
      const rev = this.revealed.get(player) ?? [];
      if (rev.length > 0) revealed[player] = serializeCards(rev);
    }

    return { decks, hands, boards, scores, revealed, achievements: serializeCards(this.achievements) };
  }

  /** Deserialize game state from JSON, using CardDatabase to reconstruct candidates. */
  static fromJSON(data: SerializedGameState, cardDb: CardDatabase, players: string[], perspective: string): GameState {
    const state = new GameState(cardDb, players, perspective);

    const loadCard = (d: SerializedCard): Card => {
      let card: Card;
      if (d.resolved !== undefined) {
        const info = cardDb.get(d.resolved)!;
        card = state.createCard(ageSetKey(info.age, info.cardSet), new Set([d.resolved]));
        card.resolve(d.resolved);
      } else {
        const groupKey = ageSetKey(d.age!, d.cardSet as CardSet);
        const groupNames = cardDb.groups().get(groupKey) ?? new Set();
        const candidates = new Set(groupNames);
        if (d.excluded) {
          for (const name of d.excluded) candidates.delete(name);
        }
        card = state.createCard(groupKey, candidates);
      }

      // Restore opponent knowledge
      if (d.opponent) {
        if (d.opponent.kind === "exact") {
          card.opponentKnowledge = { kind: "exact", name: d.opponent.name };
        } else if (d.opponent.kind === "partial") {
          card.opponentKnowledge = { kind: "partial", suspects: new Set(d.opponent.suspects), closed: d.opponent.closed };
        }
      }

      return card;
    };

    const loadCards = (cards: SerializedCard[]): Card[] => cards.map(loadCard);

    // Load decks
    for (const [key, cardDicts] of Object.entries(data.decks ?? {})) {
      const [ageStr, setLabel] = key.split("/");
      const groupKey = ageSetKey(Number(ageStr), cardSetFromLabel(setLabel));
      state.decks.set(groupKey, loadCards(cardDicts));
    }

    // Load per-player zones
    for (const player of players) {
      state.hands.set(player, loadCards(data.hands[player] ?? []));
      state.boards.set(player, loadCards(data.boards[player] ?? []));
      state.scores.set(player, loadCards(data.scores[player] ?? []));
      const rev = data.revealed?.[player];
      if (rev && rev.length > 0) state.revealed.set(player, loadCards(rev));
    }

    // Load achievements
    state.achievements = loadCards(data.achievements ?? []);

    return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract suspects and closed flag from any OpponentKnowledge variant. */
function extractSuspects(ok: OpponentKnowledge): { suspects: Set<string>; closed: boolean } {
  switch (ok.kind) {
    case "none":
      return { suspects: new Set(), closed: false };
    case "partial":
      return { suspects: ok.suspects, closed: ok.closed };
    case "exact":
      return ok.name !== null ? { suspects: new Set([ok.name]), closed: true } : { suspects: new Set(), closed: false };
  }
}

/** Generate all combinations of size k from an array. */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}
