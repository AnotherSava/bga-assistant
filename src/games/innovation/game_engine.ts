// GameEngine: state tracking, card movement, constraint propagation.

import {
  type Action,
  type AgeSetKey,
  type GameLogEntry,
  type MessageEntry,
  type OpponentKnowledge,
  type RemovalEntry,
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
} from "./types.js";
import { type GameState, createGameState, cardsAt } from "./game_state.js";
import { normalizeName } from "./process_log.js";
import { propagate as kernelPropagate } from "../../engine/constraint.js";

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
  private _idByName: Map<string, string> = new Map();

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
    if (zone === "removed") return state.removed;
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
        this.propagate(state, ageSetKey(card.age, card.cardSet));
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
        this.propagate(state, ageSetKey(card.age, card.cardSet));
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
      const hand = state.hands.get(player.id)!;
      hand.push(baseAge1Deck.pop()!);
      if (echoesActive && echoesAge1Deck) {
        hand.push(echoesAge1Deck.pop()!);
      } else {
        hand.push(baseAge1Deck.pop()!);
      }
    }
  }

  /** Resolve initial hand cards right after initGame. The deal is never logged, so nothing says
   *  which dealt card BGA put in which slot. Cards sharing a stack therefore start as one pool:
   *  we know the hand holds them, not which slot holds which, and the first move that names one
   *  pins it while the rest follow by elimination. Guessing the order instead would misread the
   *  index BGA reports for every later move out of that stack — and it is a coin flip that lands
   *  wrong half the time, as the committed bgaa_823235522 capture shows. Only bites without
   *  Echoes: with it the two dealt cards sit in different stacks and resolve immediately. */
  resolveHand(state: GameState, player: string, cardNames: string[]): void {
    const hand = state.hands.get(player)!;
    const namesByGroup = new Map<AgeSetKey, string[]>();
    for (const idx of cardNames) {
      const info = this.cardDb.get(idx);
      if (!info) throw new Error(`Cannot resolve hand card "${idx}" for ${player}`);
      const groupKey = ageSetKey(info.age, info.cardSet);
      const names = namesByGroup.get(groupKey);
      if (names) names.push(idx);
      else namesByGroup.set(groupKey, [idx]);
    }
    for (const [groupKey, names] of namesByGroup) {
      // A sweep can take a dealt card out of the hand without ever naming it, and no walk back
      // through the log recovers it — so the names may not account for every slot of the stack.
      // Narrowing on a short list would pin a name to whichever slot matched first; leave the
      // whole stack open instead and let the moves that do name a card settle it.
      const stack = this.stackOf(hand, groupKey, false);
      if (names.length < stack.length) continue;

      const slots: Card[] = [];
      for (const idx of names) {
        const card = hand.find(c => !slots.includes(c) && c.candidates.has(idx));
        if (!card) throw new Error(`Cannot resolve hand card "${idx}" for ${player}`);
        slots.push(card);
      }
      for (const card of slots) card.candidates = new Set(names);
      this.propagate(state, groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Log processing (replaces GameLogProcessor)
  // ------------------------------------------------------------------

  /** Deduce initial hand by reverse-walking the log to undo all hand transfers. Only transfers
   *  can be undone: a bulk removal takes cards out of the hand without naming them, so after one
   *  the result is a subset of the deal rather than the deal — see resolveHand, which declines to
   *  narrow a stack it cannot account for in full. */
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
    this._playerPattern = state.players.map(p => p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    this._idByName = new Map(state.players.map(p => [p.name, p.id]));

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
        const playerId = this._idByName.get(match[1]);
        if (!playerId) throw new Error(`Reveal-hand log mentions unknown player "${match[1]}"`);
        this.revealHand(state, playerId, cardNames);
      }
    } else if (entry.type === "log") {
      const me = entry as MessageEntry;
      const match = me.msg.match(/The revealed cards with a \[(\w+)\] will be kept/);
      if (match) {
        this.confirmMeldFilter(match[1]);
      }
    } else if (entry.type === "removal") {
      this.processRemoval(state, entry as RemovalEntry);
    }
  }

  // ------------------------------------------------------------------
  // Bulk removal
  // ------------------------------------------------------------------

  /** Take a sweep of cards out of the game. BGA names none of them — one notification stands for
   *  the whole sweep — so the zones it clears are worked out from our own model. The cards keep
   *  their group membership in the "removed" zone: a card taken face-down out of a hand is gone
   *  without ever being identified, and the names it might have been must not fall back to the
   *  cards left behind. */
  private processRemoval(state: GameState, entry: RemovalEntry): void {
    const touched = new Set<AgeSetKey>();
    const sweep = (cards: Card[]): void => {
      for (const card of cards) {
        touched.add(ageSetKey(card.age, card.cardSet));
        state.removed.push(card);
      }
      cards.length = 0;
    };

    if (entry.scope === "hands-boards-scores") {
      // Fission. Forecasts, displays and achievements are left alone. The age-10 card the effect
      // just drew is sitting in "revealed", and goes with the rest.
      for (const player of state.players) {
        for (const zone of [state.hands, state.boards, state.scores, state.revealed]) sweep(zone.get(player.id)!);
      }
    } else if (entry.scope === "top-cards-and-hands") {
      // DeLorean. Every hand goes wholesale; the board loses one card per colour, and those are
      // face up, so BGA lists them by name rather than leaving us to guess at pile order.
      for (const player of state.players) sweep(state.hands.get(player.id)!);
      for (const name of entry.cardNames) {
        const cardIdx = cardIndex(name);
        const owner = state.players.find(p => state.boards.get(p.id)!.some(c => c.isResolved && c.resolvedName === cardIdx));
        if (!owner) throw new Error(`Removed top card "${name}" is not on any board`);
        const board = state.boards.get(owner.id)!;
        const index = board.findIndex(c => c.isResolved && c.resolvedName === cardIdx);
        touched.add(ageSetKey(board[index].age, board[index].cardSet));
        state.removed.push(board.splice(index, 1)[0]);
      }
    } else {
      // Exxon Valdez: everything one player owns, down to the relics in their achievement pile.
      // BGA removes their claimed achievements too, but ours are an unattributed pool — the nine
      // sidelined cards, with no record of who took which — so there is nothing there to pick out,
      // and leaving them makes no difference to the group either way.
      const player = entry.player;
      if (!state.hands.has(player)) throw new Error(`Removal names unknown player "${player}"`);
      for (const zone of [state.hands, state.boards, state.scores, state.revealed, state.forecast, state.displays, state.achievementRelics]) sweep(zone.get(player)!);
    }

    for (const groupKey of touched) this.propagate(state, groupKey);
  }

  private static readonly TRACKED_ZONES: ReadonlySet<string> = new Set(["deck", "hand", "board", "score", "revealed", "forecast", "display", "relics", "removed"]);
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
        sourcePosition: entry.sourcePosition,
        destPosition: entry.destPosition,
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
        sourcePosition: entry.sourcePosition,
        destPosition: entry.destPosition,
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

    // Capture meld-filter state BEFORE takeFromSource so we can decrement after.
    // takeFromSource needs to see remainingReturns > 0 to know we're in the filter phase
    // and partition the pool accordingly (only pool cards that could be discards,
    // preserving kept cards' resolutions).
    const isMeldFilterReturn = this.remainingReturns > 0 && action.source === "hand" && action.dest === "deck";

    const card = this.takeFromSource(state, action, groupKey);
    const destCards = this.cardsAtMut(state, action.dest, action.destPlayer, groupKey);
    this.verifyDestinationSize(action, card, destCards, groupKey);
    if (action.topOfDeck) {
      destCards.unshift(card);
    } else {
      destCards.push(card);
    }
    this.updateOpponentKnowledge(state, card, action);

    if (isMeldFilterReturn) {
      this.remainingReturns -= 1;
      if (this.remainingReturns === 0) this.meldIcon = null;
    }

    // Re-propagate after destination is finalized: per-container hidden-single depends on
    // container membership, which only reflects the move once the card is in its destination.
    this.propagate(state, groupKey);

    return card;
  }

  /** Stack name for error messages, e.g. "age 1 base". */
  private static describeGroup(groupKey: AgeSetKey): string {
    const { age, cardSet } = parseAgeSetKey(groupKey);
    return `age ${age} ${cardSetLabel(cardSet)}`;
  }

  /** Zones BGA numbers per (owner, age, set, relic-or-not), where an index names one specific
   *  card. Indexing them is what makes them ordered — keep isOrderedContainer in step. */
  private static isStackedZone(zone: Zone): boolean {
    return zone === "hand" || zone === "score" || zone === "forecast";
  }

  /** Audit our bookkeeping against BGA's on every insert. A card appended to a stack takes
   *  the position after the last one, so the reported index is the size of that stack in
   *  BGA's model. Disagreeing means we are not tracking the stack BGA is tracking, which
   *  would make every index we later read out of it name the wrong card — stop instead of
   *  carrying the divergence forward. Bottom insertions report 0 and say nothing. */
  private verifyDestinationSize(action: Action, card: Card, destCards: Card[], groupKey: AgeSetKey): void {
    if (action.destPosition === undefined) return;
    const isTopOfDeck = action.dest === "deck" && action.topOfDeck;
    if (!GameEngine.isStackedZone(action.dest) && !isTopOfDeck) return;
    // Decks hold one group per pile already; private zones hold every group together, and split
    // relics off into a stack of their own — so count the side of that split the card arrives on.
    const movingRelic = this.isRelicCard(card);
    const tracked = isTopOfDeck ? destCards.length : this.stackOf(destCards, groupKey, movingRelic).length;
    if (tracked !== action.destPosition) {
      throw new Error(`BGA put the card at index ${action.destPosition} of the ${GameEngine.describeGroup(groupKey)} ${action.dest} stack${action.destPlayer ? ` of player "${action.destPlayer}"` : ""}, but we track ${tracked} card(s) there`);
    }
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
      this.propagate(state, groupKey);
    }
  }

  // ------------------------------------------------------------------
  // Internal mutation helpers
  // ------------------------------------------------------------------

  /** A card whose resolved identity is a relic. Relics are public, individually
   *  identified cards: they always move by name, so an anonymous same-group transfer
   *  can never refer to one — they must be excluded from candidate pooling/selection. */
  private isRelicCard(card: Card): boolean {
    return card.isResolved && (this.cardDb.get(card.resolvedName!)?.isRelic ?? false);
  }

  /** The cards BGA keeps as one stack: same (age, set) group, and on the same side of the split it
   *  keeps between relics and everything else. Spelled out once so the places that index into a
   *  stack and the one that counts it cannot drift apart. */
  private stackOf(cards: Card[], groupKey: AgeSetKey, relics: boolean): Card[] {
    return cards.filter(c => ageSetKey(c.age, c.cardSet) === groupKey && this.isRelicCard(c) === relics);
  }

  /** Find, resolve, remove, and merge at the source location. */
  private takeFromSource(state: GameState, action: Action, groupKey: AgeSetKey): Card {
    let sourceCards: Card[];
    let card: Card;

    if (action.source === "deck") {
      sourceCards = this.cardsAtMut(state, action.source, null, groupKey);
      if (sourceCards.length === 0) {
        throw new Error(`Cannot draw from empty deck: ${groupKey}`);
      }
      // Salvage: if a card already resolved to the named target is somewhere in the deck,
      // prefer it. This compensates for residual deck-order drift from BGA scenarios where
      // the engine's array order doesn't match BGA's physical order.
      if (action.type === "named") {
        card = sourceCards.find(c => c.isResolved && c.resolvedName === action.cardName) ?? sourceCards[0];
      } else {
        card = sourceCards[0];
      }
    } else {
      sourceCards = cardsAt(state, action.source, action.sourcePlayer, groupKey);

      const isStackedZone = GameEngine.isStackedZone(action.source);
      // BGA numbers hand, score and forecast per (owner, age, set, relic-or-not), appending on
      // entry and closing the gap on exit; the engine's array mirrors that by doing the same two
      // things, so the reported index names one specific card of the stack. Anonymous moves need
      // it to know which card left at all. Named moves need it just as much: taking the first
      // card that merely COULD be the named one removes the wrong object whenever a card that
      // cannot be it sits in between, and from there our order and BGA's disagree for good.
      const stackPosition = isStackedZone ? action.sourcePosition : undefined;
      // Relics keep a stack of their own, so an index counts only cards on the moving card's side
      // of that split.
      const movingRelic = action.type === "named" && (this.cardDb.get(action.cardName)?.isRelic ?? false);
      const stackCards = (): Card[] => this.stackOf(sourceCards, groupKey, movingRelic);
      const atPosition = (position: number): Card => {
        const stack = stackCards();
        const found = stack[position];
        if (!found) throw new Error(`No card at position ${position} of the ${GameEngine.describeGroup(groupKey)} ${action.source} stack of player "${action.sourcePlayer}" (${stack.length} cards)`);
        return found;
      };

      // Grouped removal from private zone: pool candidates among indistinguishable cards
      // before selecting which one to remove. During the meld-filter return phase
      // (remainingReturns > 0, dest=deck), we know the returned card is a discard, so we
      // pool only the discard candidates (cards whose candidates fit within discardNames)
      // and leave kept cards untouched — preserving their resolutions. Outside the filter
      // phase, fall back to pooling all sameGroup cards (we have no differentiation info).
      const inMeldFilterReturn = action.type !== "named" && isStackedZone && action.dest === "deck" && this.remainingReturns > 0;
      const isDiscardCandidate = (c: Card): boolean => c.candidates.size > 0 && [...c.candidates].every(name => this.discardNames.has(name));
      if (action.type !== "named" && isStackedZone && stackPosition === undefined) {
        const sameGroup = this.stackOf(sourceCards, groupKey, false);
        const toPool = inMeldFilterReturn ? sameGroup.filter(isDiscardCandidate) : sameGroup;
        if (toPool.length > 1) {
          const union = new Set<string>();
          for (const c of toPool) {
            for (const name of c.candidates) union.add(name);
          }
          for (const c of toPool) {
            c.candidates = new Set(union);
          }
        }
      }

      if (action.type === "named") {
        if (stackPosition !== undefined) {
          // The name and the index describe the same card, so they cross-check each other on
          // every meld: a slot that cannot be the named card means our stack is not BGA's.
          const found = atPosition(stackPosition);
          if (!found.candidates.has(action.cardName)) {
            const holds = found.isResolved ? `"${found.resolvedName}"` : `one of ${found.candidates.size} other cards`;
            throw new Error(`BGA moved "${action.cardName}" out of position ${stackPosition} of the ${GameEngine.describeGroup(groupKey)} ${action.source} stack of player "${action.sourcePlayer}", but we track that slot as ${holds}`);
          }
          card = found;
        } else {
          const found = sourceCards.find(c => c.candidates.has(action.cardName));
          if (!found) throw new Error(`Card "${action.cardName}" not found in ${action.source}`);
          card = found;
        }
      } else if (stackPosition !== undefined) {
        card = atPosition(stackPosition);
        if (inMeldFilterReturn) {
          // The filter returns the revealed cards that missed the melded city's icon, so the slot
          // BGA points at holds one of them. The pooling above would have narrowed to those; with
          // an index it is a direct intersection, and an empty one means we disagree with BGA.
          const discards = new Set([...card.candidates].filter(name => this.discardNames.has(name)));
          if (discards.size === 0) throw new Error(`BGA returned position ${stackPosition} of the ${GameEngine.describeGroup(groupKey)} ${action.source} stack of player "${action.sourcePlayer}" as a meld-filter discard, but we track that slot as a card the filter would keep`);
          card.candidates = discards;
        }
      } else {
        // For meld-filter returns, the moved card is a discard by construction — prefer one.
        // Falls back to any sameGroup card if no discard candidate is found (defensive).
        let found: Card | undefined;
        if (inMeldFilterReturn) {
          found = sourceCards.find(c => ageSetKey(c.age, c.cardSet) === groupKey && isDiscardCandidate(c));
        }
        if (!found) found = this.stackOf(sourceCards, groupKey, false)[0];
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
        this.propagate(state, groupKey);
      }
    }

    // Resolve if named and not yet resolved
    if (action.type === "named" && !card.isResolved) {
      card.candidates = new Set([action.cardName]);
      this.propagate(state, groupKey);
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
    const sameGroup = [card, ...remainingSource.filter(c => ageSetKey(c.age, c.cardSet) === cardGroupKey)];
    // Only cards the opponent tracks as a shared uncertainty pool ("partial") may merge.
    // Cards the opponent knows exactly are distinguishable, and cards it has no information
    // about ("none") are untracked — pooling either would corrupt knowledge: it downgrades
    // exact cards to partial, or fabricates a suspect set that excludes an untracked card's
    // true identity.
    const affected = sameGroup.filter(c => c.opponentKnowledge.kind === "partial");
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

  /** Propagate constraints within an (age, cardSet) group to fixed-point.
   *  Card-identity deductions go through the shared kernel. Per-container hidden-single is enabled
   *  but skips ordered containers (see isOrderedContainer), where committing a name to a specific
   *  placeholder would pin a position the observer cannot know. Naked N-tuples are enabled: the
   *  opening deal pools names nothing has resolved yet, so a closed pool now prunes its peers —
   *  which is how "this hand holds exactly these two" reaches the rest of the group without
   *  guessing which slot is which. Opponent-knowledge (suspect) propagation stays here as a
   *  separate fact layer. */
  private propagate(state: GameState, groupKey: AgeSetKey): void {
    const group = this._groups.get(groupKey);
    if (!group) return;

    const locator = this.locateCards(state);
    const containerOf = (c: Card): string => locator.get(c) ?? "orphan";

    let changed = true;
    while (changed) {
      changed = false;
      if (kernelPropagate(group, { containerOf, isContainerOrdered: GameEngine.isOrderedContainer, enableNakedTuples: true })) changed = true;
      if (this.propagateSuspects(group)) changed = true;
    }
  }

  /** Containers something selects out of by index, so their slots are not interchangeable and
   *  per-container hidden-single must not commit a name to one of them. A deck qualifies through
   *  grouped-draw semantics. Hand and score qualify because BGA reports the index a card left them
   *  from: choosing one of several equally-possible slots to carry a name is a coin flip, and the
   *  next move out of that stack would read the guess back as fact. Nothing is lost by declining —
   *  "this name is in this container" stays in the candidate sets either way. Keep this in step
   *  with isStackedZone: whatever we index into belongs here. */
  private static isOrderedContainer(containerId: string): boolean {
    return containerId.startsWith("deck:") || containerId.startsWith("forecast:") || containerId.startsWith("revealed:")
      || containerId.startsWith("hand:") || containerId.startsWith("score:");
  }

  /** Build a Card → container-key map by scanning all zones in the state. */
  private locateCards(state: GameState): Map<Card, string> {
    const locator = new Map<Card, string>();
    const visit = (cards: Card[], container: string): void => {
      for (const card of cards) locator.set(card, container);
    };
    for (const [groupKey, cards] of state.decks) visit(cards, `deck:${groupKey}`);
    for (const [pid, cards] of state.hands) visit(cards, `hand:${pid}`);
    for (const [pid, cards] of state.boards) visit(cards, `board:${pid}`);
    for (const [pid, cards] of state.scores) visit(cards, `score:${pid}`);
    for (const [pid, cards] of state.forecast) visit(cards, `forecast:${pid}`);
    for (const [pid, cards] of state.revealed) visit(cards, `revealed:${pid}`);
    for (const [pid, cards] of state.displays) visit(cards, `display:${pid}`);
    visit(state.achievements, "achievements");
    visit(state.relics, "relics");
    visit(state.removed, "removed");
    for (const [pid, cards] of state.achievementRelics) visit(cards, `achievementRelics:${pid}`);
    return locator;
  }

  /** Suspect-list propagation: a publicly-known resolved name is removed from peers' suspect lists.
   *  A closed suspect list collapsing to size 1 becomes an "exact" knowledge entry. */
  private propagateSuspects(group: Card[]): boolean {
    let anyChange = false;
    for (const card of group) {
      if (card.opponentKnowledge.kind !== "exact" || !card.isResolved) continue;
      const name = card.resolvedName!;
      for (const other of group) {
        if (other === card || other.opponentKnowledge.kind !== "partial") continue;
        if (!other.opponentKnowledge.suspects.has(name)) continue;
        other.opponentKnowledge.suspects.delete(name);
        if (other.opponentKnowledge.closed && other.opponentKnowledge.suspects.size === 1) {
          const remainingName = other.opponentKnowledge.suspects.values().next().value!;
          other.opponentKnowledge = { kind: "exact", name: remainingName };
          anyChange = true;
        }
      }
    }
    return anyChange;
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
    for (const card of state.removed) registerCard(card);
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

