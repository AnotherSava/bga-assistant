// GameEngine: state tracking, card movement, constraint propagation.

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
  parseAgeSetKey,
} from "./types.js";
import { type GameState, createGameState, cardsAt } from "./game_state.js";
import { normalizeName } from "./process_log.js";

const REGULAR_ICONS = new Set(["crown", "leaf", "lightbulb", "castle", "factory", "clock"]);

// ---------------------------------------------------------------------------
// GameEngine
// ---------------------------------------------------------------------------

export class GameEngine {
  private cardDb: CardDatabase;

  /** All Card objects per (age, cardSet) group - master list for propagation. */
  private _groups: Map<AgeSetKey, Card[]>;

  // Cities meld-filter tracking
  private meldIcon: string | null = null;
  private discardNames: Set<string> = new Set();
  private remainingReturns: number = 0;

  // Cached from state.players during processLog
  private _playerPattern: string = "";

  constructor(cardDb: CardDatabase) {
    this.cardDb = cardDb;
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
  // Zone helpers (private, operate on GameState)
  // ------------------------------------------------------------------

  /** Return the mutable card list for a zone, creating it if needed for decks. */
  private cardsAtMut(state: GameState, zone: Zone, player: string | null, groupKey: AgeSetKey): Card[] {
    if (zone === "deck") {
      let deck = state.decks.get(groupKey);
      if (!deck) {
        deck = [];
        state.decks.set(groupKey, deck);
      }
      return deck;
    }
    if (zone === "relics") return state.relics;
    if (zone === "achievements") {
      // Relic-aware achievement slot (per player). Regular achievements are handled
      // upstream in processTransfer via the SKIPPED path.
      const cards = state.achievementRelics.get(player!);
      if (!cards) throw new Error(`Player "${player}" not found in achievementRelics zone`);
      return cards;
    }
    const zoneMap =
      zone === "hand" ? state.hands
        : zone === "board" ? state.boards
          : zone === "score" ? state.scores
            : zone === "forecast" ? state.forecast
              : zone === "revealed" ? state.revealed
                : state.displays;
    const cards = zoneMap.get(player!);
    if (!cards) throw new Error(`Player "${player}" not found in ${zone} zone`);
    return cards;
  }

  // ------------------------------------------------------------------
  // Relic-specific achievement transfers
  // ------------------------------------------------------------------

  /** Handle a transfer involving the relics zone or relic cards in achievements.
   *  Covers relics→hand, relics→achievements, *→relics (return from any zone),
   *  achievements→hand, achievements→achievements. */
  private processRelicAchievementTransfer(state: GameState, entry: TransferEntry): void {
    const cardIdx = entry.cardName ? cardIndex(entry.cardName) : null;

    const takeFromRelicList = (list: Card[]): Card => {
      let idx: number;
      if (cardIdx) {
        idx = list.findIndex(c => c.isResolved && c.resolvedName === cardIdx);
      } else {
        const targetSet = cardSetFromLabel(entry.cardSet);
        idx = list.findIndex(c => c.age === entry.cardAge && c.cardSet === targetSet);
      }
      if (idx === -1) throw new Error(`Relic "${cardIdx ?? `age ${entry.cardAge}`}" not found`);
      return list.splice(idx, 1)[0];
    };

    // *→relics: return a relic to the Available Relics pool from any zone
    if (entry.dest === "relics") {
      let card: Card;
      if (entry.source === "relics") {
        card = takeFromRelicList(state.relics);
      } else if (entry.source === "achievements") {
        card = takeFromRelicList(state.achievementRelics.get(entry.sourceOwner!)!);
      } else {
        const sourceZone = entry.source as Zone;
        const sourceCards = cardsAt(state, sourceZone, entry.sourceOwner);
        const idx = cardIdx ? sourceCards.findIndex(c => c.isResolved && c.resolvedName === cardIdx) : sourceCards.findIndex(c => c.age === entry.cardAge && c.cardSet === cardSetFromLabel(entry.cardSet));
        if (idx === -1) throw new Error(`Relic "${cardIdx ?? `age ${entry.cardAge}`}" not found in ${entry.source}`);
        card = sourceCards.splice(idx, 1)[0];
      }
      state.relics.push(card);
      return;
    }

    // relics→hand or relics→achievements
    if (entry.source === "relics") {
      const card = takeFromRelicList(state.relics);
      if (entry.dest === "achievements") {
        state.achievementRelics.get(entry.destOwner!)!.push(card);
      } else {
        state.hands.get(entry.destOwner!)!.push(card);
        this.propagate(ageSetKey(card.age, card.cardSet));
      }
      return;
    }

    // achievements→achievements or achievements→hand
    if (entry.source === "achievements") {
      const card = takeFromRelicList(state.achievementRelics.get(entry.sourceOwner!)!);
      if (entry.dest === "achievements") {
        state.achievementRelics.get(entry.destOwner!)!.push(card);
      } else {
        state.hands.get(entry.destOwner!)!.push(card);
        this.propagate(ageSetKey(card.age, card.cardSet));
      }
      return;
    }

    throw new Error(`Unexpected relic transfer: ${entry.source} -> ${entry.dest} for "${entry.cardName}"`);
  }

  // ------------------------------------------------------------------
  // Group helpers
  // ------------------------------------------------------------------

  /** Look up the card group for an (age, cardSet) pair. */
  findGroup(age: number, cardSet: CardSet): Card[] {
    return this._groups.get(ageSetKey(age, cardSet)) ?? [];
  }

  // ------------------------------------------------------------------
  // Initialization
  // ------------------------------------------------------------------

  /** Set up initial game state: all cards in decks, achievements, initial deal. */
  initGame(state: GameState, expansions?: { echoes: boolean; artifacts?: boolean; relics?: boolean }, initialRelics?: string[]): void {
    const echoesActive = expansions?.echoes ?? false;
    const relicsActive = expansions?.relics ?? false;

    // Create all cards in decks — excluding known relics (they start in the relics zone instead)
    const relicNames = new Set((relicsActive ? initialRelics ?? [] : []).map(n => cardIndex(n)));
    for (const [groupKey, indexNames] of this.cardDb.groups()) {
      const filtered = new Set([...indexNames].filter(n => !relicNames.has(n)));
      const deck: Card[] = [];
      for (let i = 0; i < filtered.size; i++) {
        deck.push(this.createCard(groupKey, filtered));
      }
      state.decks.set(groupKey, deck);
    }

    // Populate the relics zone — one resolved card per relic name.
    for (const relicName of relicNames) {
      const info = this.cardDb.get(relicName);
      if (!info) throw new Error(`Relic "${relicName}" not found in card database`);
      const groupKey = ageSetKey(info.age, info.cardSet);
      const card = this.createCard(groupKey, new Set([relicName]));
      card.opponentKnowledge = { kind: "exact", name: relicName };
      state.relics.push(card);
    }

    // Move 1 card per base age 1-9 to achievements
    for (let age = 1; age <= 9; age++) {
      const key = ageSetKey(age, CardSet.BASE);
      const deck = state.decks.get(key)!;
      state.achievements.push(deck.pop()!);
    }

    // Deal initial hand: 1 base + 1 echoes age-1 when echoes active, 2 base age-1 otherwise
    const baseAge1Deck = state.decks.get(ageSetKey(1, CardSet.BASE))!;
    const echoesAge1Deck = echoesActive ? state.decks.get(ageSetKey(1, CardSet.ECHOES)) : undefined;
    for (const player of state.players) {
      const hand = state.hands.get(player)!;
      hand.push(baseAge1Deck.pop()!);
      if (echoesActive && echoesAge1Deck) {
        hand.push(echoesAge1Deck.pop()!);
      } else {
        hand.push(baseAge1Deck.pop()!);
      }
    }
  }

  /** Resolve initial hand cards right after initGame. */
  resolveHand(state: GameState, player: string, cardNames: string[]): void {
    const hand = state.hands.get(player)!;
    const resolved = new Set<Card>();
    for (const idx of cardNames) {
      const card = hand.find(c => !resolved.has(c) && c.candidates.has(idx));
      if (!card) throw new Error(`Cannot resolve hand card "${idx}" for ${player}`);
      const info = this.cardDb.get(idx)!;
      const groupKey = ageSetKey(info.age, info.cardSet);
      card.candidates = new Set([idx]);
      resolved.add(card);
      this.propagate(groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Log processing (replaces GameLogProcessor)
  // ------------------------------------------------------------------

  /** Deduce initial hand by reverse-walking the log to undo all hand transfers. */
  deduceInitialHand(state: GameState, log: GameLogEntry[], myHand: string[]): string[] {
    const hand = new Set(myHand);
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (entry.type !== "transfer") continue;
      if (entry.dest === "hand" && entry.destOwner === state.perspective) {
        if (entry.cardName !== null) hand.delete(entry.cardName);
      }
      if (entry.source === "hand" && entry.sourceOwner === state.perspective) {
        if (entry.cardName !== null) hand.add(entry.cardName);
      }
    }
    return [...hand].map(name => cardIndex(name));
  }

  /** Initialize log processing: deduce hand and resolve, without processing entries. */
  initLog(state: GameState, log: GameLogEntry[], myHand: string[]): void {
    this._playerPattern = state.players.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

    const initialHand = this.deduceInitialHand(state, log, myHand);
    this.resolveHand(state, state.perspective, initialHand);
  }

  /** Process the full game log: deduce hand, resolve, then process all entries. */
  processLog(state: GameState, log: GameLogEntry[], myHand: string[]): void {
    this.initLog(state, log, myHand);

    for (const entry of log) {
      this.processEntry(state, entry);
    }
  }

  /** Process a single log entry: dispatch to move, revealHand, or confirmMeldFilter. Requires initLog() or processLog() to be called first. */
  processEntry(state: GameState, entry: GameLogEntry): void {
    if (!this._playerPattern) throw new Error("processEntry() called before initLog() — call initLog() or processLog() first");
    if (entry.type === "transfer") {
      this.processTransfer(state, entry as TransferEntry);
    } else if (entry.type === "logWithCardTooltips") {
      const me = entry as MessageEntry;
      const match = me.msg.match(new RegExp(`^(${this._playerPattern}) reveals (?:his|her|their) hand: (.+)\\.$`));
      if (match) {
        const cardNames = match[2].split(", ").map(part => cardIndex(normalizeName(part.substring(part.indexOf(" ") + 1))));
        this.revealHand(state, match[1], cardNames);
      }
    } else if (entry.type === "log") {
      const me = entry as MessageEntry;
      const match = me.msg.match(/The revealed cards with a \[(\w+)\] will be kept/);
      if (match) {
        this.confirmMeldFilter(match[1]);
      }
    }
  }

  private static readonly TRACKED_ZONES: ReadonlySet<string> = new Set(["deck", "hand", "board", "score", "revealed", "forecast", "display", "relics"]);
  private static readonly SKIPPED_ZONES: ReadonlySet<string> = new Set(["claimed", "fountains", "flags"]);

  /** Convert a TransferEntry to an Action and execute it. */
  private processTransfer(state: GameState, entry: TransferEntry): void {
    if (GameEngine.SKIPPED_ZONES.has(entry.source) || GameEngine.SKIPPED_ZONES.has(entry.dest)) return;

    const cardName = entry.cardName;
    const cardIdx = cardName ? cardIndex(cardName) : null;

    // Transfers involving the relics zone always go through relic-tracking.
    if (entry.source === "relics" || entry.dest === "relics") {
      this.processRelicAchievementTransfer(state, entry);
      return;
    }

    // Achievements are count-only for regular cards, but relics keep their identity
    // there and can be seized back. Any achievements-side transfer of a non-relic card
    // is either a regular claim (skip) or unexpected.
    if (entry.source === "achievements" || entry.dest === "achievements") {
      // Anonymous transfer into achievements: regular claim, count-only.
      if (!cardIdx && entry.dest === "achievements") return;

      // Named non-relic card involving achievements: regular claim if going IN,
      // anomalous if coming OUT (non-relic cards never leave the zone).
      if (cardIdx) {
        const info = this.cardDb.get(cardIdx);
        if (!info?.isRelic) {
          if (entry.dest === "achievements") return;
          throw new Error(`Unexpected transfer from achievements for non-relic card: "${cardName}" (${entry.source} -> ${entry.dest})`);
        }
      }

      // Either a named relic, or an anonymous transfer OUT of achievements.
      // Relic transfers normally arrive with a resolved name (process_log fills it
      // in from the relic roster when BGA omits it), but processRelicAchievementTransfer
      // also matches by (age, cardSet) as a defensive fallback.
      this.processRelicAchievementTransfer(state, entry);
      return;
    }

    if (!GameEngine.TRACKED_ZONES.has(entry.source) || !GameEngine.TRACKED_ZONES.has(entry.dest)) {
      throw new Error(`Unknown zone in transfer: source="${entry.source}", dest="${entry.dest}"`);
    }

    if (cardIdx && !this.cardDb.has(cardIdx)) {
      throw new Error(`Card "${cardName}" (index "${cardIdx}") not found in card database`);
    }

    let action: Action;
    if (cardIdx) {
      action = {
        type: "named",
        cardName: cardIdx,
        source: entry.source as Zone,
        dest: entry.dest as Zone,
        sourcePlayer: entry.source !== "deck" ? entry.sourceOwner : null,
        destPlayer: entry.dest !== "deck" ? entry.destOwner : null,
        meldKeyword: entry.meldKeyword,
        topOfDeck: entry.topOfDeck,
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
        topOfDeck: entry.topOfDeck,
      };
    }

    this.move(state, action);
  }

  // ------------------------------------------------------------------
  // Card movement
  // ------------------------------------------------------------------

  /** Move a card from one location to another. */
  move(state: GameState, action: Action): Card {
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

    // Meld filter return phase: resolve grouped discard to a named action.
    // We know which cards lack the meld icon, so pick one from discardNames.
    if (this.remainingReturns > 0 && action.source === "hand" && action.dest === "deck") {
      if (action.type === "grouped") {
        const sourceCards = cardsAt(state, action.source, action.sourcePlayer, groupKey);
        const match = sourceCards.find(c => c.isResolved && this.discardNames.has(c.resolvedName!));
        if (match) {
          action = { type: "named", cardName: match.resolvedName!, source: action.source, dest: action.dest, sourcePlayer: action.sourcePlayer, destPlayer: action.destPlayer, meldKeyword: action.meldKeyword, topOfDeck: action.topOfDeck };
        }
      }
      // Decrement for both named and grouped-resolved returns that match discardNames
      if (action.type === "named" && this.discardNames.has(action.cardName)) {
        this.remainingReturns -= 1;
        if (this.remainingReturns === 0) this.meldIcon = null;
      }
    }

    const card = this.takeFromSource(state, action, groupKey);
    const destCards = this.cardsAtMut(state, action.dest, action.destPlayer, groupKey);
    if (action.topOfDeck) {
      destCards.unshift(card);
    } else {
      destCards.push(card);
    }
    this.updateOpponentKnowledge(state, card, action);

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
  revealHand(state: GameState, player: string, cardIndices: string[]): void {
    const hand = state.hands.get(player)!;
    for (const idx of cardIndices) {
      const info = this.cardDb.get(idx);
      if (!info) throw new Error(`Revealed card "${idx}" not found in card database`);
      const groupKey = ageSetKey(info.age, info.cardSet);
      const card = hand.find(c => c.candidates.has(idx));
      if (!card) throw new Error(`Revealed card "${idx}" not found among hand candidates for player "${player}"`);
      card.candidates = new Set([idx]);
      card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
      this.propagate(groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Internal mutation helpers
  // ------------------------------------------------------------------

  /** Find, resolve, remove, and merge at the source location. */
  private takeFromSource(state: GameState, action: Action, groupKey: AgeSetKey): Card {
    let sourceCards: Card[];
    let card: Card;

    if (action.source === "deck") {
      sourceCards = this.cardsAtMut(state, action.source, null, groupKey);
      if (sourceCards.length === 0) {
        throw new Error(`Cannot draw from empty deck: ${groupKey}`);
      }
      // Prefer a card already resolved to the target name (e.g. returned to deck earlier)
      if (action.type === "named") {
        card = sourceCards.find(c => c.isResolved && c.resolvedName === action.cardName) ?? sourceCards[0];
      } else {
        card = sourceCards[0];
      }
    } else {
      sourceCards = cardsAt(state, action.source, action.sourcePlayer, groupKey);

      // Grouped removal from private zone: pool candidates for all same-age-set
      // cards before selecting which one to remove. We don't know which card left,
      // so all must share the same candidate set to avoid committing to an arbitrary
      // resolution that could conflict with a later named reference.
      if (action.type !== "named" && (action.source === "hand" || action.source === "score" || action.source === "forecast")) {
        const sameGroup = sourceCards.filter(c => ageSetKey(c.age, c.cardSet) === groupKey);
        if (sameGroup.length > 1) {
          const union = new Set<string>();
          for (const c of sameGroup) {
            for (const name of c.candidates) union.add(name);
          }
          for (const c of sameGroup) {
            c.candidates = new Set(union);
          }
        }
      }

      if (action.type === "named") {
        const found = sourceCards.find(c => c.candidates.has(action.cardName));
        if (!found) throw new Error(`Card "${action.cardName}" not found in ${action.source}`);
        card = found;
      } else {
        const found = sourceCards.find(c => ageSetKey(c.age, c.cardSet) === groupKey);
        if (!found) throw new Error(`No card with groupKey "${groupKey}" found in ${action.source}`);
        card = found;
      }
    }

    // Named removal from private zone: collect all cards whose candidates
    // include the named card (the "affected" set from prior merges), pool
    // their candidates, resolve one to the named card, and distribute the
    // remaining candidates to the others.
    if (action.type === "named" && (action.source === "hand" || action.source === "score" || action.source === "forecast")) {
      const affected = sourceCards.filter(c => c.candidates.has(action.cardName));
      if (affected.length > 1) {
        const union = new Set<string>();
        for (const c of affected) {
          for (const name of c.candidates) union.add(name);
        }
        union.delete(action.cardName);
        card.candidates = new Set([action.cardName]);
        for (const c of affected) {
          if (c !== card) c.candidates = new Set(union);
        }
        this.propagate(groupKey);
      }
    }

    // Resolve if named and not yet resolved
    if (action.type === "named" && !card.isResolved) {
      card.candidates = new Set([action.cardName]);
      this.propagate(groupKey);
    }

    // Remove from source
    const idx = sourceCards.indexOf(card);
    if (idx === -1) throw new Error("Card not found in source zone for removal");
    sourceCards.splice(idx, 1);

    this.mergeSuspects(state, card, sourceCards, action);

    return card;
  }

  /** Update opponent knowledge flags after a move. */
  private updateOpponentKnowledge(state: GameState, card: Card, action: Action): void {
    const isVisibleToBoth = action.dest === "board" || action.dest === "revealed" || action.dest === "display" || action.dest === "relics"
      || (action.sourcePlayer !== null && action.destPlayer !== null && action.sourcePlayer !== action.destPlayer);
    if (isVisibleToBoth) {
      card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
      return;
    }

    const isVisibleToOpponent = (action.dest === "hand" || action.dest === "score" || action.dest === "forecast") && action.destPlayer !== state.perspective;
    if (isVisibleToOpponent) {
      card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
    }
  }

  /** Merge suspect lists when opponent can't tell which card moved. */
  private mergeSuspects(state: GameState, card: Card, remainingSource: Card[], action: Action): void {
    // Only relevant when our card moves between private zones
    if (!(
      (action.source === "hand" || action.source === "score" || action.source === "forecast")
      && (action.dest === "deck" || action.dest === "hand" || action.dest === "score" || action.dest === "forecast")
      && action.sourcePlayer === state.perspective
      && (action.destPlayer === null || action.destPlayer === state.perspective)
    )) return;

    const cardGroupKey = ageSetKey(card.age, card.cardSet);
    const affected = [card, ...remainingSource.filter(c => ageSetKey(c.age, c.cardSet) === cardGroupKey)];
    if (affected.length <= 1) return;

    // Collect all suspects and closed status
    const suspectUnion = new Set<string>();
    let allClosed = true;
    for (const c of affected) {
      const { suspects, closed } = extractSuspects(c.opponentKnowledge);
      for (const s of suspects) suspectUnion.add(s);
      if (!closed) allClosed = false;
    }

    if (suspectUnion.size === affected.length && allClosed) {
      // Complete subset: opponent knows exactly which N names — resolve 1:1.
      const names = [...suspectUnion];
      for (let i = 0; i < affected.length; i++) affected[i].opponentKnowledge = { kind: "exact", name: names[i] };
    } else {
      for (const c of affected) {
        if (suspectUnion.size === 0 && !allClosed) {
          c.opponentKnowledge = { kind: "none" };
        } else {
          c.opponentKnowledge = { kind: "partial", suspects: new Set(suspectUnion), closed: allClosed };
        }
      }
    }
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
          holders[0].candidates = new Set([candidateName]);
          changed = true;
        }
      }

      // 3. Suspect propagation: publicly-known names removed from suspect lists
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
    const group = this.findGroup(card.age, card.cardSet);
    const hiddenCount = group.filter(c => c.opponentKnowledge.kind !== "exact").length;
    return card.opponentKnowledge.suspects.size < hiddenCount;
  }

  /** True if the opponent has no information about this card's identity. */
  opponentKnowsNothing(card: Card): boolean {
    return card.opponentKnowledge.kind !== "exact" && !this.opponentHasPartialInformation(card);
  }

  // ------------------------------------------------------------------
  // Group building (for deserialized states)
  // ------------------------------------------------------------------

  /** Scan all zone cards in state and populate _groups for constraint queries. */
  buildGroups(state: GameState): void {
    this._groups = new Map();
    const registerCard = (card: Card): void => {
      const key = ageSetKey(card.age, card.cardSet);
      let group = this._groups.get(key);
      if (!group) {
        group = [];
        this._groups.set(key, group);
      }
      group.push(card);
    };

    for (const cards of state.decks.values()) for (const card of cards) registerCard(card);
    for (const cards of state.hands.values()) for (const card of cards) registerCard(card);
    for (const cards of state.boards.values()) for (const card of cards) registerCard(card);
    for (const cards of state.scores.values()) for (const card of cards) registerCard(card);
    for (const cards of state.revealed.values()) for (const card of cards) registerCard(card);
    for (const cards of state.forecast.values()) for (const card of cards) registerCard(card);
    for (const cards of state.displays.values()) for (const card of cards) registerCard(card);
    for (const card of state.achievements) registerCard(card);
    for (const card of state.relics) registerCard(card);
    for (const cards of state.achievementRelics.values()) for (const card of cards) registerCard(card);
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

