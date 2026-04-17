import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  Card,
  CardDatabase,
  CardSet,
  ageSetKey,
  cardIndex,
  type Action,
  type NamedAction,
  type GroupedAction,
  type AgeSetKey,
  type TransferEntry,
  type MessageEntry,
  type GameLogEntry,
} from "../types";
import { type GameState, createGameState as newGameState, cardsAt } from "../game_state";
import { GameEngine } from "../game_engine";
import { toJSON, fromJSON } from "../serialization";
import { processRawLog } from "../process_log";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDatabase(): CardDatabase {
  const path = resolve(thisDir, "../../../../assets/bga/innovation/card_info.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return new CardDatabase(raw);
}

const PLAYERS = ["Alice", "Bob"];
const PERSPECTIVE = "Alice";

let cardDb: CardDatabase;

beforeEach(() => {
  cardDb = loadCardDatabase();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGS(): { state: GameState; engine: GameEngine } {
  const engine = new GameEngine(cardDb);
  const state = newGameState(PLAYERS, PERSPECTIVE);
  return { state, engine };
}

function createInitializedGS(expansions?: { echoes: boolean; artifacts?: boolean; relics?: boolean }): { state: GameState; engine: GameEngine } {
  const { state, engine } = createGS();
  engine.initGame(state, expansions);
  return { state, engine };
}

function namedAction(overrides: Partial<NamedAction> & { cardName: string }): NamedAction {
  return {
    type: "named",
    source: "deck",
    dest: "hand",
    sourcePlayer: null,
    destPlayer: null,
    meldKeyword: false,
    topOfDeck: false,
    ...overrides,
  };
}

function groupedAction(overrides: Partial<GroupedAction> & { age: number; cardSet: CardSet }): GroupedAction {
  return {
    type: "grouped",
    source: "deck",
    dest: "hand",
    sourcePlayer: null,
    destPlayer: null,
    meldKeyword: false,
    topOfDeck: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// initGame
// ---------------------------------------------------------------------------

describe("initGame", () => {
  it("creates decks for all card groups", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const age1Deck = state.decks.get(age1Key)!;
    const groupSize = cardDb.groups().get(age1Key)!.size;
    // groupSize - 1 achievement - 2 per player (2 players)
    expect(age1Deck.length).toBe(groupSize - 1 - 2 * PLAYERS.length);
  });

  it("creates 9 achievements from base ages 1-9", () => {
    const { state, engine } = createInitializedGS();
    expect(state.achievements.length).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(state.achievements[i].cardSet).toBe(CardSet.BASE);
      expect(state.achievements[i].age).toBe(i + 1);
    }
  });

  it("deals 2 cards to each player's hand", () => {
    const { state, engine } = createInitializedGS();
    for (const player of PLAYERS) {
      expect(state.hands.get(player)!.length).toBe(2);
      for (const card of state.hands.get(player)!) {
        expect(card.age).toBe(1);
        expect(card.cardSet).toBe(CardSet.BASE);
      }
    }
  });

  it("all cards start unresolved with full group candidates", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = cardDb.groups().get(age1Key)!;
    for (const card of state.decks.get(age1Key)!) {
      expect(card.isResolved).toBe(false);
      expect(card.candidates).toEqual(groupNames);
    }
  });

  it("creates city decks", () => {
    const { state, engine } = createInitializedGS();
    const cities1Key = ageSetKey(1, CardSet.CITIES);
    const citiesDeck = state.decks.get(cities1Key);
    if (citiesDeck) {
      const cityGroupNames = cardDb.groups().get(cities1Key)!;
      expect(citiesDeck.length).toBe(cityGroupNames.size);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveHand
// ---------------------------------------------------------------------------

describe("resolveHand", () => {
  it("resolves initial hand cards by name", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    const hand = state.hands.get("Alice")!;
    expect(hand[0].isResolved).toBe(true);
    expect(hand[0].resolvedName).toBe("agriculture");
    expect(hand[1].isResolved).toBe(true);
    expect(hand[1].resolvedName).toBe("archery");
  });

  it("propagates constraints after resolution", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    const age1Key = ageSetKey(1, CardSet.BASE);
    for (const card of state.decks.get(age1Key)!) {
      expect(card.candidates.has("agriculture")).toBe(false);
      expect(card.candidates.has("archery")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Zone accessors
// ---------------------------------------------------------------------------

describe("cardsAt", () => {
  it("returns deck cards by group key", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const cards = cardsAt(state, "deck", null, age1Key);
    const groupSize = cardDb.groups().get(age1Key)!.size;
    expect(cards.length).toBe(groupSize - 1 - 2 * PLAYERS.length);
  });

  it("returns hand cards by player", () => {
    const { state, engine } = createInitializedGS();
    const cards = cardsAt(state, "hand", "Alice");
    expect(cards.length).toBe(2);
  });

  it("returns empty array for empty zones", () => {
    const { state, engine } = createInitializedGS();
    expect(cardsAt(state, "board", "Alice").length).toBe(0);
    expect(cardsAt(state, "score", "Alice").length).toBe(0);
    expect(cardsAt(state, "revealed", "Alice").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Basic moves
// ---------------------------------------------------------------------------

describe("move", () => {
  it("moves a named card from deck to hand", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    const card = engine.move(state, namedAction({
      cardName: "metalworking",
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("metalworking");
    expect(state.hands.get("Alice")!.length).toBe(3);
    expect(state.hands.get("Alice")!).toContain(card);
  });

  it("moves a grouped card from deck (hidden draw)", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    expect(card.age).toBe(1);
    expect(card.cardSet).toBe(CardSet.BASE);
    expect(state.hands.get("Bob")!).toContain(card);
  });

  it("moves a named card from hand to board (meld)", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
      meldKeyword: true,
    }));

    expect(card.resolvedName).toBe("agriculture");
    expect(state.boards.get("Alice")!).toContain(card);
    expect(state.hands.get("Alice")!.length).toBe(1);
  });

  it("moves a card from board to score", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    engine.move(state, namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    const card = engine.move(state, namedAction({
      cardName: "agriculture",
      source: "board",
      dest: "score",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    expect(card.resolvedName).toBe("agriculture");
    expect(state.scores.get("Alice")!).toContain(card);
    expect(state.boards.get("Alice")!.length).toBe(0);
  });

  it("marks cards public when moved to board", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    expect(card.opponentKnowledge.kind).toBe("exact");
    if (card.opponentKnowledge.kind === "exact") {
      expect(card.opponentKnowledge.name).toBe("agriculture");
    }
  });

  it("marks cards public when transferred between players", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "score",
      sourcePlayer: "Alice",
      destPlayer: "Bob",
    }));

    expect(card.opponentKnowledge.kind).toBe("exact");
  });

  it("sets exact opponent knowledge when card goes to opponent's private zone", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, namedAction({
      cardName: "metalworking",
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    expect(card.opponentKnowledge.kind).toBe("exact");
    if (card.opponentKnowledge.kind === "exact") {
      expect(card.opponentKnowledge.name).toBe("metalworking");
    }
  });

  it("does not update opponent knowledge for own private zone draw", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, namedAction({
      cardName: "metalworking",
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    expect(card.opponentKnowledge.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Candidate merging (hidden moves from private zones)
// ---------------------------------------------------------------------------

describe("candidate merging", () => {
  it("merges candidates when hidden card leaves hand", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const card = engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    expect(state.hands.get("Bob")!.length).toBe(1);
    // Both the moved card and remaining card should share candidates
    const remaining = state.hands.get("Bob")![0];
    expect(remaining.candidates).toEqual(card.candidates);
  });

  it("preserves resolved cards when unknown card of same age/set is drawn", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    // Resolve Bob's hand so both cards are known
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    // Bob draws an unknown age 1 base card — should NOT destroy existing resolutions
    engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.length).toBe(3);
    // The two originally resolved cards must stay resolved
    expect(bobHand.some(c => c.resolvedName === "clothing")).toBe(true);
    expect(bobHand.some(c => c.resolvedName === "city states")).toBe(true);
    // The new card should be unresolved
    const newCard = bobHand.find(c => !c.isResolved);
    expect(newCard).toBeDefined();
  });

  it("merges resolved cards when unknown card of same age/set leaves hand", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    // Bob has 2 resolved + 1 unresolved of same age/set
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);
    engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    // Grouped hand→deck move — we don't know which card left, so
    // remaining cards of the same age/set lose their resolution
    engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.length).toBe(2);
    // The two remaining cards should share candidates (ambiguous)
    const age1Cards = bobHand.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(1, CardSet.BASE));
    expect(age1Cards.length).toBe(2);
    expect(age1Cards[0].candidates).toEqual(age1Cards[1].candidates);
  });

  it("preserves construction when one of two age-2-base cards leaves hand (bgaa_823235522)", () => {
    // Scenario from real game: opponent has construction[2/base] (resolved)
    // and one unresolved [2/base] card. A grouped age-2-base return triggers
    // mergeCandidates which pools both candidate sets, destroying the
    // construction resolution. But construction was NOT the returned card —
    // the reveal at move 23 confirms it's still in hand.
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    // Give Bob a resolved construction via named draw + a second unresolved age 2
    engine.move(state, namedAction({
      cardName: "construction",
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));
    engine.move(state, groupedAction({
      age: 2,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    // Verify setup: Bob has construction resolved + one unresolved age 2 base
    const bobBefore = state.hands.get("Bob")!;
    expect(bobBefore.some(c => c.resolvedName === "construction")).toBe(true);
    const age2BaseBefore = bobBefore.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(2, CardSet.BASE));
    expect(age2BaseBefore.length).toBe(2);

    // Return one unknown age 2 base card from hand
    engine.move(state, groupedAction({
      age: 2,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    // After the return, construction should still be a candidate in
    // the remaining age 2 base hand card
    const bobAfter = state.hands.get("Bob")!;
    const age2BaseAfter = bobAfter.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(2, CardSet.BASE));
    expect(age2BaseAfter.length).toBe(1);
    expect(age2BaseAfter[0].candidates.has("construction")).toBe(true);
  });

  it("creates ambiguity when two resolved same-age cards lose one via grouped removal (bgaa_823235522_111)", () => {
    // Scenario: opponent has translation[3/base] and medicine[3/base], both
    // fully resolved. A grouped age-3-base hand→deck transfer removes one
    // but we don't know which. Both the removed card and the remaining card
    // must become ambiguous so a later named reference to either still works.
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    // Give Bob two resolved age 3 base cards via named draws
    engine.move(state, namedAction({ cardName: "translation", source: "deck", dest: "hand", destPlayer: "Bob" }));
    engine.move(state, namedAction({ cardName: "medicine", source: "deck", dest: "hand", destPlayer: "Bob" }));

    // Verify both are resolved
    const bobBefore = state.hands.get("Bob")!;
    const age3Before = bobBefore.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(3, CardSet.BASE));
    expect(age3Before.length).toBe(2);
    expect(age3Before.some(c => c.resolvedName === "translation")).toBe(true);
    expect(age3Before.some(c => c.resolvedName === "medicine")).toBe(true);

    // Grouped removal: one unknown age 3 base card leaves hand
    engine.move(state, groupedAction({ age: 3, cardSet: CardSet.BASE, source: "hand", dest: "deck", sourcePlayer: "Bob" }));

    // The remaining age 3 base card should have both candidates
    const bobAfter = state.hands.get("Bob")!;
    const age3After = bobAfter.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(3, CardSet.BASE));
    expect(age3After.length).toBe(1);
    expect(age3After[0].candidates.has("translation")).toBe(true);
    expect(age3After[0].candidates.has("medicine")).toBe(true);

    // A subsequent named reference to "translation" should succeed
    expect(() => {
      engine.move(state, namedAction({ cardName: "translation", source: "hand", dest: "board", sourcePlayer: "Bob", destPlayer: "Bob" }));
    }).not.toThrow();
  });

  it("does not merge when grouped card enters hand from deck", () => {
    // Drawing an unknown card into hand is not ambiguous — no existing
    // hand card moved. mergeCandidates only fires on source=hand, not dest=hand.
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    const bobHandBefore = state.hands.get("Bob")!.map(c => c.resolvedName);

    engine.move(state, groupedAction({
      age: 1, cardSet: CardSet.BASE,
      source: "deck", dest: "hand", destPlayer: "Bob",
    }));

    const bobHand = state.hands.get("Bob")!;
    // Existing resolved cards untouched
    expect(bobHand.filter(c => c.isResolved).map(c => c.resolvedName).sort()).toEqual(bobHandBefore.sort());
    // New card is unresolved
    expect(bobHand.filter(c => !c.isResolved).length).toBe(1);
  });

  it("includes resolved cards in merge when grouped card leaves hand", () => {
    // When an unknown card leaves, ANY card (including resolved) could be
    // the one that left. All same-group cards must pool candidates.
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    // Draw unknown, then send unknown back — resolved cards should merge
    engine.move(state, groupedAction({
      age: 1, cardSet: CardSet.BASE,
      source: "deck", dest: "hand", destPlayer: "Bob",
    }));
    engine.move(state, groupedAction({
      age: 1, cardSet: CardSet.BASE,
      source: "hand", dest: "deck", sourcePlayer: "Bob",
    }));

    const bobHand = state.hands.get("Bob")!;
    const age1Cards = bobHand.filter(c => ageSetKey(c.age, c.cardSet) === ageSetKey(1, CardSet.BASE));
    // Both remaining cards should have candidates that include clothing AND city states
    for (const card of age1Cards) {
      expect(card.candidates.has("clothing")).toBe(true);
      expect(card.candidates.has("city states")).toBe(true);
    }
  });

  it("does not merge for named moves", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    const card = engine.move(state, namedAction({
      cardName: "clothing",
      source: "hand",
      dest: "board",
      sourcePlayer: "Bob",
      destPlayer: "Bob",
    }));

    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("clothing");
    expect(state.hands.get("Bob")![0].isResolved).toBe(true);
    expect(state.hands.get("Bob")![0].resolvedName).toBe("city states");
  });
});

// ---------------------------------------------------------------------------
// Singleton propagation
// ---------------------------------------------------------------------------

describe("singleton propagation", () => {
  it("removes resolved name from other candidates in same group", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const age1Key = ageSetKey(1, CardSet.BASE);
    for (const card of state.decks.get(age1Key)!) {
      expect(card.candidates.has("agriculture")).toBe(false);
      expect(card.candidates.has("archery")).toBe(false);
    }
  });

  it("cascade resolves when only one candidate remains", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    // Resolve Alice's hand (2 cards)
    engine.resolveHand(state, "Alice", [groupNames[0], groupNames[1]]);
    // Resolve Bob's hand (2 cards)
    engine.resolveHand(state, "Bob", [groupNames[2], groupNames[3]]);

    // Draw named cards from deck, leaving 1 unresolved (the achievement)
    const deckSize = state.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize; i++) {
      engine.move(state, namedAction({
        cardName: groupNames[4 + i],
        source: "deck",
        dest: "hand",
        destPlayer: "Alice",
      }));
    }

    // After resolving all but 1, the achievement card should auto-resolve
    const allAge1Cards = [
      ...state.decks.get(age1Key) ?? [],
      ...state.hands.get("Alice")!.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
      ...state.hands.get("Bob")!.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
      ...state.achievements.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
    ];
    const resolvedCount = allAge1Cards.filter(c => c.isResolved).length;
    expect(resolvedCount).toBe(groupNames.length);
  });
});

// ---------------------------------------------------------------------------
// Hidden singles propagation
// ---------------------------------------------------------------------------

describe("hidden singles", () => {
  it("resolves a card when its name appears in only one unresolved card", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    // Resolve both hands
    engine.resolveHand(state, "Alice", [groupNames[0], groupNames[1]]);
    engine.resolveHand(state, "Bob", [groupNames[2], groupNames[3]]);

    // Draw all but 2 from deck, leaving 2 unresolved deck cards + 1 achievement = 3 unresolved
    const deckSize = state.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize - 2; i++) {
      engine.move(state, namedAction({
        cardName: groupNames[4 + i],
        source: "deck",
        dest: "hand",
        destPlayer: "Alice",
      }));
    }

    // Now there are 3 unresolved cards, each with 3 candidates
    // Hidden singles: if one name uniquely identifies one card position
    // With 3 identical candidate sets, hidden singles alone can't resolve
    // But with 2 more draws resolving 2 of the 3, the last cascades
    const remaining = state.decks.get(age1Key)!;
    expect(remaining.length).toBe(2);

    // Resolve one more to trigger cascade
    engine.move(state, namedAction({
      cardName: groupNames[4 + deckSize - 2],
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    // Now 1 deck card + 1 achievement = 2 unresolved with 2 candidates each
    // They have the same candidates, so hidden singles can't help
    // But resolving 1 more triggers singleton cascade
    engine.move(state, namedAction({
      cardName: groupNames[4 + deckSize - 1],
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    // Achievement should now be resolved via cascade
    const achievement = state.achievements.find(c => ageSetKey(c.age, c.cardSet) === age1Key)!;
    expect(achievement.isResolved).toBe(true);
    expect(groupNames).toContain(achievement.resolvedName);
  });
});

// ---------------------------------------------------------------------------
// Naked subsets propagation
// ---------------------------------------------------------------------------

describe("naked subsets", () => {
  it("preserves naked pair candidates on other cards after complete subset refactor", () => {
    const { state, engine } = createGS();
    engine.initGame(state);

    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    engine.resolveHand(state, "Alice", [groupNames[0], groupNames[1]]);
    engine.resolveHand(state, "Bob", [groupNames[2], groupNames[3]]);

    // Draw named cards from deck to reduce the pool, leaving enough for naked subsets (>3 unresolved)
    const deck = state.decks.get(age1Key)!;
    const drawCount = Math.max(0, deck.length - 6);
    for (let i = 0; i < drawCount; i++) {
      engine.move(state, namedAction({ cardName: groupNames[4 + i], source: "deck", dest: "hand", destPlayer: "Alice" }));
    }

    // All remaining deck cards should share the same unresolved candidate set
    const remaining = state.decks.get(age1Key)!;
    const unresolvedCards = remaining.filter(c => !c.isResolved);
    expect(unresolvedCards.length).toBeGreaterThan(4);

    // Force a naked pair on the LAST two deck cards (not first, since takeFromSource grabs deck[0])
    const lastIdx = unresolvedCards.length - 1;
    const pairCard0 = unresolvedCards[lastIdx - 1];
    const pairCard1 = unresolvedCards[lastIdx];
    const pairNames = [...pairCard0.candidates].slice(0, 2);
    pairCard0.candidates = new Set(pairNames);
    pairCard1.candidates = new Set(pairNames);

    // Confirm other unresolved cards currently have the pair names
    for (const card of unresolvedCards.slice(0, lastIdx - 1)) {
      expect(card.candidates.has(pairNames[0]) || card.candidates.has(pairNames[1])).toBe(true);
    }

    // Trigger propagation by drawing a named card from the deck (draws deck[0], not a pair card)
    const drawName = [...unresolvedCards[0].candidates].find(n => !pairNames.includes(n))!;
    engine.move(state, namedAction({ cardName: drawName, source: "deck", dest: "hand", destPlayer: "Alice" }));

    // After the refactor to complete subset detection, naked pair candidates are
    // no longer eliminated from other unresolved cards in the group
    const afterDeck = state.decks.get(age1Key)!;
    for (const card of afterDeck.filter(c => !c.isResolved)) {
      if (card === pairCard0 || card === pairCard1) continue;
      for (const name of pairNames) {
        expect(card.candidates.has(name)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suspect propagation
// ---------------------------------------------------------------------------

describe("suspect propagation", () => {
  it("removes public card name from other cards' suspect lists on next propagation", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    // Set up partial knowledge on Bob's hand cards
    const bobHand = state.hands.get("Bob")!;
    bobHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "clothing"]), closed: true };
    bobHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "metalworking"]), closed: false };

    // Move agriculture to board (marks it public)
    engine.move(state, namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    // Suspect propagation runs during propagate(), which is called during takeFromSource
    // But markPublic happens AFTER takeFromSource. So we need another move in the same
    // group to trigger propagation again.
    engine.move(state, namedAction({
      cardName: "metalworking",
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    // Now propagation should have removed agriculture from suspect lists
    const card0 = bobHand[0];
    const card1 = bobHand[1];

    expect(card0.opponentKnowledge.kind).toBe("exact");
    if (card0.opponentKnowledge.kind === "exact") {
      expect(card0.opponentKnowledge.name).toBe("clothing");
    }

    // Card1 had open list, removing agriculture leaves metalworking but not closed → stays partial
    if (card1.opponentKnowledge.kind === "partial") {
      expect(card1.opponentKnowledge.suspects.has("agriculture")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Suspect merging
// ---------------------------------------------------------------------------

describe("suspect merging", () => {
  it("merges suspect lists when hidden card leaves our hand", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const aliceHand = state.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture"]), closed: true };
    aliceHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["archery"]), closed: true };

    engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Alice",
    }));

    const remaining = aliceHand[0];
    expect(remaining.opponentKnowledge.kind).toBe("exact");
    if (remaining.opponentKnowledge.kind === "exact") {
      expect(remaining.opponentKnowledge.name).toBe("archery");
    }
  });

  it("does not merge suspects for opponent's moves", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    // Set knowledge on BOTH of Bob's cards so whichever remains, we can verify
    const bobHand = state.hands.get("Bob")!;
    bobHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["clothing"]), closed: true };
    bobHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["metalworking"]), closed: true };

    engine.move(state, groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    // Bob's remaining card knowledge should not have been merged
    // (merge only happens for our perspective's private zones)
    const remaining = state.hands.get("Bob")![0];
    expect(remaining.opponentKnowledge.kind).toBe("partial");
    if (remaining.opponentKnowledge.kind === "partial") {
      // Should have only ONE suspect, not a merged union
      expect(remaining.opponentKnowledge.suspects.size).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Meld filtering (Cities)
// ---------------------------------------------------------------------------

describe("meld filtering", () => {
  it("confirmMeldFilter with no prior meld does not interfere with subsequent moves", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    engine.confirmMeldFilter("crown");

    // A subsequent hand->deck grouped move should work normally (not intercepted by return logic)
    const aliceHandBefore = state.hands.get("Alice")!.length;
    engine.move(state, groupedAction({ age: 1, cardSet: CardSet.BASE, source: "hand", dest: "deck", sourcePlayer: "Alice" }));
    expect(state.hands.get("Alice")!.length).toBe(aliceHandBefore - 1);
  });

  it("does not corrupt later revealed->deck cards when meld filter returns go through hand (bug #816652225)", () => {
    // Jakarta (cities age 3) has leaf at icon position 5, triggering meld filter.
    // Draw phase: Education, Engineering, Alchemy drawn deck->revealed->hand.
    // Education and Engineering lack leaf -> discardNames.
    // confirmMeldFilter sets remainingReturns = 2.
    // Returns go hand->deck (NOT revealed->deck).
    // Later, unrelated Colonialism/Navigation go revealed->deck and must NOT be corrupted.
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    // Draw Jakarta from cities deck, then meld it (meldKeyword triggers filter)
    engine.move(state, namedAction({ cardName: "jakarta", source: "deck", dest: "hand", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "jakarta", source: "hand", dest: "board", sourcePlayer: "Alice", destPlayer: "Alice", meldKeyword: true }));

    // Draw phase: deck->revealed->hand for Education, Engineering, Alchemy
    engine.move(state, namedAction({ cardName: "education", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "education", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "engineering", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "engineering", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "alchemy", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "alchemy", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));

    // Confirm meld filter
    engine.confirmMeldFilter("leaf");

    // Returns go hand->deck (the actual BGA flow)
    engine.move(state, namedAction({ cardName: "education", source: "hand", dest: "deck", sourcePlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "engineering", source: "hand", dest: "deck", sourcePlayer: "Alice" }));

    // Later: unrelated deck->revealed->deck for age 4 base cards
    engine.move(state, namedAction({ cardName: "colonialism", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "navigation", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    // Return them to deck
    engine.move(state, namedAction({ cardName: "navigation", source: "revealed", dest: "deck", sourcePlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: "colonialism", source: "revealed", dest: "deck", sourcePlayer: "Alice" }));

    // Colonialism and Navigation must still be themselves, not corrupted to education/engineering
    const age4Deck = state.decks.get(ageSetKey(4, CardSet.BASE))!;
    const resolvedNames = age4Deck.filter(c => c.isResolved).map(c => c.resolvedName).sort();
    expect(resolvedNames).toContain("colonialism");
    expect(resolvedNames).toContain("navigation");
    expect(resolvedNames).not.toContain("education");
    expect(resolvedNames).not.toContain("engineering");
  });
});

// ---------------------------------------------------------------------------
// Reveal hand
// ---------------------------------------------------------------------------

describe("revealHand", () => {
  it("resolves and marks cards public", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    engine.revealHand(state, "Bob", ["clothing", "city states"]);

    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.length).toBe(2);

    const clothing = bobHand.find(c => c.resolvedName === "clothing");
    const cityStates = bobHand.find(c => c.resolvedName === "city states");
    expect(clothing).toBeDefined();
    expect(cityStates).toBeDefined();
    expect(clothing!.opponentKnowledge.kind).toBe("exact");
    expect(cityStates!.opponentKnowledge.kind).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// deduceInitialHand
// ---------------------------------------------------------------------------

describe("deduceInitialHand", () => {
  it("returns initial hand from current hand with no transfers", () => {
    const { state, engine } = createGS();
    engine.initGame(state, );

    const result = engine.deduceInitialHand(state, [], ["Agriculture", "Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("undoes incoming transfers", () => {
    const { state, engine } = createGS();
    engine.initGame(state, );

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];

    const result = engine.deduceInitialHand(state, log, ["Agriculture", "Archery", "Metalworking"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("undoes outgoing transfers", () => {
    const { state, engine } = createGS();
    engine.initGame(state, );

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
    ];

    const result = engine.deduceInitialHand(state, log, ["Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("handles multiple transfers", () => {
    const { state, engine } = createGS();
    engine.initGame(state, );

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];

    const result = engine.deduceInitialHand(state, log, ["Archery", "Metalworking"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("ignores transfers for other players", () => {
    const { state, engine } = createGS();
    engine.initGame(state, );

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "hand", cardName: "Clothing", cardAge: 1, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
    ];

    const result = engine.deduceInitialHand(state, log, ["Agriculture", "Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });
});

// ---------------------------------------------------------------------------
// processLog (full pipeline)
// ---------------------------------------------------------------------------

describe("processLog", () => {
  it("processes a simple game log", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Archery", "Metalworking"];

    engine.processLog(state, log, myHand);

    const board = state.boards.get("Alice")!;
    expect(board.some(c => c.resolvedName === "agriculture")).toBe(true);

    const hand = state.hands.get("Alice")!;
    expect(hand.length).toBe(2);
    const handNames = hand.map(c => c.resolvedName).sort();
    expect(handNames).toEqual(["archery", "metalworking"]);
  });

  it("processes reveal hand messages", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "logWithCardTooltips", move: 1, msg: "Bob reveals his hand: [1] Clothing, [1] City States." },
    ];
    const myHand = ["Agriculture", "Archery"];

    engine.processLog(state, log, myHand);

    const bobHand = state.hands.get("Bob")!;
    const clothing = bobHand.find(c => c.resolvedName === "clothing");
    expect(clothing).toBeDefined();
    expect(clothing!.opponentKnowledge.kind).toBe("exact");
  });

  it("processes meld filter messages", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "log", move: 1, msg: "The revealed cards with a [crown] will be kept" },
    ];
    const myHand = ["Agriculture", "Archery"];

    engine.processLog(state, log, myHand);
  });

  it("keeps resolved cards after grouped discard from meld filter (bgaa_818433588)", () => {
    const { state, engine } = createInitializedGS();

    // Opponent melds Hoi An (cities age 5, icon[5]=crown), triggering meld filter.
    // Draws 5 named age-5 base cards through revealed → hand, then returns 1 unnamed (Coal, no crown).
    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "cities", source: "deck", dest: "hand", cardName: "Hoi An", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "cities", source: "hand", dest: "board", cardName: "Hoi An", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Coal", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Coal", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "The pirate code", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "The pirate code", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Steam engine", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Steam engine", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Astronomy", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Astronomy", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Banking", cardAge: 5, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Banking", cardAge: 5, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "log", move: 1, msg: "The revealed cards with a [crown] will be kept and the others will be returned." },
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "deck", cardName: null, cardAge: 5, sourceOwner: "Bob", destOwner: null, meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Agriculture", "Archery"];

    engine.processLog(state, log, myHand);

    // The 4 kept cards in Bob's hand should still be resolved
    const bobHand = state.hands.get("Bob")!;
    const age5Cards = bobHand.filter(c => c.age === 5 && c.cardSet === CardSet.BASE);
    expect(age5Cards.length).toBe(4);
    const resolvedNames = age5Cards.filter(c => c.isResolved).map(c => c.resolvedName).sort();
    expect(resolvedNames.length).toBe(4);
  });

  it("decrements meld filter counter for named returns from perspective player (bgaa_818433588)", () => {
    const { state, engine } = createInitializedGS();

    // Perspective player (Alice) melds Nanjing (cities age 2, icon[5]=castle), draws 2 cards
    // without castle, then returns both as named transfers. After that, Philosophy should be
    // drawable from deck without error.
    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "cities", source: "deck", dest: "hand", cardName: "Nanjing", cardAge: 2, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "cities", source: "hand", dest: "board", cardName: "Nanjing", cardAge: 2, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Philosophy", cardAge: 2, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Philosophy", cardAge: 2, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "revealed", cardName: "Calendar", cardAge: 2, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 1, cardSet: "base", source: "revealed", dest: "hand", cardName: "Calendar", cardAge: 2, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "log", move: 1, msg: "The revealed cards with a [castle] will be kept and the others will be returned." },
      { type: "transfer", move: 2, cardSet: "base", source: "hand", dest: "deck", cardName: "Calendar", cardAge: 2, sourceOwner: "Alice", destOwner: null, meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 2, cardSet: "base", source: "hand", dest: "deck", cardName: "Philosophy", cardAge: 2, sourceOwner: "Alice", destOwner: null, meldKeyword: false, topOfDeck: false },
      // After returns, another player draws Philosophy from deck — should not throw
      { type: "transfer", move: 3, cardSet: "base", source: "deck", dest: "revealed", cardName: "Philosophy", cardAge: 2, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 3, cardSet: "base", source: "revealed", dest: "hand", cardName: "Philosophy", cardAge: 2, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Agriculture", "Archery"];

    // Should not throw "Card 'philosophy' not found in revealed"
    engine.processLog(state, log, myHand);

    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.some(c => c.resolvedName === "philosophy")).toBe(true);
  });

  it("topOfDeck places card at draw position (index 0) in deck", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", [cardIndex("Agriculture"), cardIndex("Archery")]);

    // Draw Vaccination from age 6 deck, then place it on top of deck
    engine.move(state, namedAction({ cardName: cardIndex("Vaccination"), source: "deck", dest: "hand", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: cardIndex("Vaccination"), source: "hand", dest: "deck", sourcePlayer: "Alice", topOfDeck: true }));

    // Vaccination should be at index 0 (top/draw position) of the base age 6 deck
    const deck6 = cardsAt(state, "deck", null, ageSetKey(6, CardSet.BASE));
    expect(deck6[0].resolvedName).toBe(cardIndex("Vaccination"));

    // Next draw from age 6 should get Vaccination
    const drawn = engine.move(state, groupedAction({ age: 6, cardSet: CardSet.BASE, dest: "hand", destPlayer: "Bob" }));
    expect(drawn.resolvedName).toBe(cardIndex("Vaccination"));
  });

  it("return to bottom of deck (topOfDeck=false) places card at end", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", [cardIndex("Agriculture"), cardIndex("Archery")]);

    // Draw Vaccination, then return it to bottom of deck (default behavior)
    engine.move(state, namedAction({ cardName: cardIndex("Vaccination"), source: "deck", dest: "hand", destPlayer: "Alice" }));
    engine.move(state, namedAction({ cardName: cardIndex("Vaccination"), source: "hand", dest: "deck", sourcePlayer: "Alice", topOfDeck: false }));

    // Vaccination should NOT be at index 0 — it's at the bottom
    const deck6 = cardsAt(state, "deck", null, ageSetKey(6, CardSet.BASE));
    expect(deck6[0].resolvedName).not.toBe(cardIndex("Vaccination"));
    expect(deck6[deck6.length - 1].resolvedName).toBe(cardIndex("Vaccination"));
  });

  it("full pipeline succeeds for bgaa_823235522 (construction reveal after merge)", () => {
    // After grouped hand→deck transfers, propagation can eliminate a card
    // from all hand candidates. A subsequent revealHand listing that card
    // should recover by falling back to an unresolved card of matching age/set.
    const raw = JSON.parse(readFileSync(resolve(thisDir, "fixtures/bgaa_823235522.json"), "utf-8"));
    const cardDb = loadCardDatabase();
    const gameLog = processRawLog(raw);
    const players = Object.values(gameLog.players);
    const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
    const engine = new GameEngine(cardDb);
    const state = newGameState(players, perspective);
    engine.initGame(state, gameLog.expansions);
    // Should not throw "Revealed card construction not found among hand candidates"
    engine.processLog(state, gameLog.log, gameLog.myHand);
    const jamdalla = state.hands.get("jamdalla")!;
    const names = jamdalla.map(c => c.resolvedName);
    expect(names).toContain("construction");
  });

  it("skips achievement transfers", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "board", dest: "achievements", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Agriculture", "Archery"];

    engine.processLog(state, log, myHand);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe("serialization", () => {
  it("round-trips an initial game state", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    engine.resolveHand(state, "Bob", ["clothing", "city states"]);

    const json = toJSON(state);
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);
    engine.buildGroups(gs2);

    const aliceHand = gs2.hands.get("Alice")!;
    expect(aliceHand.length).toBe(2);
    expect(aliceHand[0].resolvedName).toBe("agriculture");
    expect(aliceHand[1].resolvedName).toBe("archery");

    const bobHand = gs2.hands.get("Bob")!;
    expect(bobHand.length).toBe(2);
    expect(bobHand[0].resolvedName).toBe("clothing");
    expect(bobHand[1].resolvedName).toBe("city states");
  });

  it("round-trips unresolved cards with full candidates", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);

    const age1Key = ageSetKey(1, CardSet.BASE);
    const deckCards = gs2.decks.get(age1Key)!;
    for (const card of deckCards) {
      expect(card.candidates.has("agriculture")).toBe(false);
      expect(card.candidates.has("archery")).toBe(false);
    }
  });

  it("round-trips opponent knowledge", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const aliceHand = state.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    aliceHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["archery", "clothing"]), closed: true };

    const json = toJSON(state);
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);

    const hand2 = gs2.hands.get("Alice")!;
    expect(hand2[0].opponentKnowledge).toEqual({ kind: "exact", name: "agriculture" });
    expect(hand2[1].opponentKnowledge.kind).toBe("partial");
    if (hand2[1].opponentKnowledge.kind === "partial") {
      expect(hand2[1].opponentKnowledge.suspects).toEqual(new Set(["archery", "clothing"]));
      expect(hand2[1].opponentKnowledge.closed).toBe(true);
    }
  });

  it("round-trips achievements", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);

    expect(gs2.achievements.length).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(gs2.achievements[i].age).toBe(i + 1);
    }
  });

  it("serializes resolved cards with age and cardSet", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const aliceHand = json.hands["Alice"];
    expect(aliceHand[0].resolved).toBe("agriculture");
    expect(aliceHand[0].age).toBe(1);
    expect(aliceHand[0].cardSet).toBe(CardSet.BASE);
    expect(aliceHand[0].candidates).toBeUndefined();
  });

  it("serializes unresolved cards with full candidates", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const deckKey = "1/base";
    const deckCards = json.decks[deckKey];
    for (const card of deckCards) {
      expect(card.age).toBe(1);
      expect(card.cardSet).toBe(CardSet.BASE);
      expect(card.candidates).toBeDefined();
      expect(card.candidates).not.toContain("agriculture");
      expect(card.candidates).not.toContain("archery");
    }
  });

  it("omits opponent knowledge when none", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const aliceHand = json.hands["Alice"];
    expect(aliceHand[0].opponent).toBeUndefined();
    expect(aliceHand[1].opponent).toBeUndefined();
  });

  it("fromJSON does not require CardDatabase", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    // fromJSON is a standalone function — no engine/cardDb needed
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);

    const aliceHand = gs2.hands.get("Alice")!;
    expect(aliceHand[0].resolvedName).toBe("agriculture");
    expect(aliceHand[0].age).toBe(1);
    expect(aliceHand[0].cardSet).toBe(CardSet.BASE);
  });

  it("buildGroups populates engine groups from deserialized state", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);

    const json = toJSON(state);
    const gs2 = fromJSON(json, PLAYERS, PERSPECTIVE);

    const engine2 = new GameEngine(cardDb);
    engine2.buildGroups(gs2);

    // Engine should be able to query opponent knowledge after buildGroups
    const bobHand = gs2.hands.get("Bob")!;
    expect(engine2.opponentKnowsNothing(bobHand[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opponent knowledge queries
// ---------------------------------------------------------------------------

describe("opponent knowledge queries", () => {
  it("opponentKnowsNothing for fresh cards", () => {
    const { state, engine } = createInitializedGS();
    const aliceHand = state.hands.get("Alice")!;
    expect(engine.opponentKnowsNothing(aliceHand[0])).toBe(true);
  });

  it("opponentKnowsNothing false for exact knowledge", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    const aliceHand = state.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    expect(engine.opponentKnowsNothing(aliceHand[0])).toBe(false);
  });

  it("opponentHasPartialInformation for partial knowledge", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    const aliceHand = state.hands.get("Alice")!;

    aliceHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture"]), closed: false };
    expect(engine.opponentHasPartialInformation(aliceHand[0])).toBe(true);
  });

  it("opponentHasPartialInformation false for exact knowledge", () => {
    const { state, engine } = createInitializedGS();
    engine.resolveHand(state, "Alice", ["agriculture", "archery"]);
    const aliceHand = state.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    expect(engine.opponentHasPartialInformation(aliceHand[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full game sequence
// ---------------------------------------------------------------------------

describe("full game sequence", () => {
  it("handles a multi-turn game sequence", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 3, cardSet: "base", source: "hand", dest: "board", cardName: null, cardAge: 1, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: true, topOfDeck: false },
      { type: "transfer", move: 4, cardSet: "base", source: "deck", dest: "hand", cardName: null, cardAge: 1, sourceOwner: null, destOwner: "Bob", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 5, cardSet: "base", source: "hand", dest: "score", cardName: "Archery", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false, topOfDeck: false },
      { type: "transfer", move: 6, cardSet: "base", source: "deck", dest: "hand", cardName: "Calendar", cardAge: 2, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Metalworking", "Calendar"];

    engine.processLog(state, log, myHand);

    const aliceBoard = state.boards.get("Alice")!;
    expect(aliceBoard.some(c => c.resolvedName === "agriculture")).toBe(true);

    const aliceScore = state.scores.get("Alice")!;
    expect(aliceScore.some(c => c.resolvedName === "archery")).toBe(true);

    const aliceHand = state.hands.get("Alice")!;
    expect(aliceHand.length).toBe(2);
    const handNames = aliceHand.map(c => c.resolvedName).sort();
    expect(handNames).toEqual(["calendar", "metalworking"]);

    expect(state.hands.get("Bob")!.length).toBe(2);
    expect(state.boards.get("Bob")!.length).toBe(1);
  });

  it("handles game with revealed hand", () => {
    const { state, engine } = createInitializedGS();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true, topOfDeck: false },
      { type: "logWithCardTooltips", move: 2, msg: "Bob reveals his hand: [1] Clothing, [1] City States." },
      { type: "transfer", move: 3, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false, topOfDeck: false },
    ];
    const myHand = ["Archery", "Metalworking"];

    engine.processLog(state, log, myHand);

    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.find(c => c.resolvedName === "clothing")).toBeDefined();
    expect(bobHand.find(c => c.resolvedName === "city states")).toBeDefined();

    for (const card of bobHand) {
      expect(card.opponentKnowledge.kind).toBe("exact");
    }
  });
});

// ---------------------------------------------------------------------------
// Propagation with many resolved cards
// ---------------------------------------------------------------------------

describe("propagation with many resolved cards", () => {
  it("handles resolving most cards in a group", () => {
    const { state, engine } = createInitializedGS();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    engine.resolveHand(state, "Alice", [groupNames[0], groupNames[1]]);
    engine.resolveHand(state, "Bob", [groupNames[2], groupNames[3]]);

    // Draw and resolve many cards
    const deckSize = state.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize; i++) {
      engine.move(state, namedAction({ cardName: groupNames[4 + i], source: "deck", dest: "hand", destPlayer: "Alice" }));
    }

    // All cards in the group should be resolved (including the achievement)
    const allCards = [
      ...state.decks.get(age1Key) ?? [],
      ...state.hands.get("Alice")!.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
      ...state.hands.get("Bob")!.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
      ...state.achievements.filter(c => ageSetKey(c.age, c.cardSet) === age1Key),
    ];
    const resolved = allCards.filter(c => c.isResolved);
    expect(resolved.length).toBe(groupNames.length);
  });
});

// ---------------------------------------------------------------------------
// Echoes expansion: initial deal
// ---------------------------------------------------------------------------

describe("echoes expansion initGame", () => {
  it("deals 1 base + 1 echoes age-1 card per player when echoes active", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    for (const player of PLAYERS) {
      const hand = state.hands.get(player)!;
      expect(hand.length).toBe(2);
      const sets = hand.map(c => c.cardSet);
      expect(sets).toContain(CardSet.BASE);
      expect(sets).toContain(CardSet.ECHOES);
    }
  });

  it("removes 1 card from base age-1 deck per player when echoes active", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    const baseAge1Key = ageSetKey(1, CardSet.BASE);
    const baseGroupSize = cardDb.groups().get(baseAge1Key)!.size;
    const baseDeck = state.decks.get(baseAge1Key)!;
    // base age-1 deck: groupSize - 1 achievement - 1 per player (not 2)
    expect(baseDeck.length).toBe(baseGroupSize - 1 - PLAYERS.length);
  });

  it("removes 1 card from echoes age-1 deck per player when echoes active", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    const echoesAge1Key = ageSetKey(1, CardSet.ECHOES);
    const echoesGroupSize = cardDb.groups().get(echoesAge1Key)!.size;
    const echoesDeck = state.decks.get(echoesAge1Key)!;
    // echoes age-1 deck: groupSize - 1 per player (no achievements from echoes)
    expect(echoesDeck.length).toBe(echoesGroupSize - PLAYERS.length);
  });

  it("creates echoes decks for all ages", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    for (let age = 1; age <= 10; age++) {
      const key = ageSetKey(age, CardSet.ECHOES);
      const deck = state.decks.get(key);
      expect(deck).toBeDefined();
      expect(deck!.length).toBeGreaterThan(0);
    }
  });

  it("deals 2 base age-1 cards when echoes not active (default)", () => {
    const { state, engine } = createInitializedGS();
    for (const player of PLAYERS) {
      const hand = state.hands.get(player)!;
      expect(hand.length).toBe(2);
      for (const card of hand) {
        expect(card.cardSet).toBe(CardSet.BASE);
        expect(card.age).toBe(1);
      }
    }
  });

  it("deals 2 base age-1 cards when echoes explicitly false", () => {
    const { state, engine } = createInitializedGS({ echoes: false });
    for (const player of PLAYERS) {
      const hand = state.hands.get(player)!;
      expect(hand.length).toBe(2);
      for (const card of hand) {
        expect(card.cardSet).toBe(CardSet.BASE);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Echoes expansion: resolveHand with mixed sets
// ---------------------------------------------------------------------------

describe("echoes resolveHand", () => {
  it("resolves mixed-set hand cards by candidate matching", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    // Find a base age-1 card and an echoes age-1 card from the database
    const baseNames = [...cardDb.groups().get(ageSetKey(1, CardSet.BASE))!];
    const echoesNames = [...cardDb.groups().get(ageSetKey(1, CardSet.ECHOES))!];
    const baseName = baseNames[0];
    const echoesName = echoesNames[0];

    // Resolve with echoes name first, base second (opposite of deal order)
    engine.resolveHand(state, "Alice", [echoesName, baseName]);
    const hand = state.hands.get("Alice")!;
    const resolved = hand.filter(c => c.isResolved);
    expect(resolved.length).toBe(2);
    const resolvedNames = resolved.map(c => c.resolvedName).sort();
    expect(resolvedNames).toEqual([baseName, echoesName].sort());
  });

  it("propagates constraints in both base and echoes groups", () => {
    const { state, engine } = createInitializedGS({ echoes: true });
    const baseNames = [...cardDb.groups().get(ageSetKey(1, CardSet.BASE))!];
    const echoesNames = [...cardDb.groups().get(ageSetKey(1, CardSet.ECHOES))!];

    engine.resolveHand(state, "Alice", [baseNames[0], echoesNames[0]]);

    // Base deck should not contain the resolved base card
    const baseDeck = state.decks.get(ageSetKey(1, CardSet.BASE))!;
    for (const card of baseDeck) {
      expect(card.candidates.has(baseNames[0])).toBe(false);
    }
    // Echoes deck should not contain the resolved echoes card
    const echoesDeck = state.decks.get(ageSetKey(1, CardSet.ECHOES))!;
    for (const card of echoesDeck) {
      expect(card.candidates.has(echoesNames[0])).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Artifacts of History expansion
// ---------------------------------------------------------------------------

describe("artifacts expansion", () => {
  function dig(state: GameState, engine: GameEngine, player: string, cardName: string): void {
    const info = cardDb.get(cardName)!;
    const action: NamedAction = namedAction({
      cardName, source: "deck", dest: "display",
      sourcePlayer: null, destPlayer: player,
    });
    engine.move(state, action);
    expect(info.cardSet).toBe(CardSet.ARTIFACTS);
  }

  function returnToDeck(state: GameState, engine: GameEngine, player: string, cardName: string): void {
    engine.move(state, namedAction({
      cardName, source: "display", dest: "deck",
      sourcePlayer: player, destPlayer: null, topOfDeck: false,
    }));
  }

  it("dig moves card from artifact deck to the player's display", () => {
    const { state, engine } = createInitializedGS({ echoes: false, artifacts: true, relics: false });
    const age1Deck = state.decks.get(ageSetKey(1, CardSet.ARTIFACTS))!;
    const deckSizeBefore = age1Deck.length;
    const cardName = cardDb.groupInfos(1, CardSet.ARTIFACTS)[0].indexName;

    dig(state, engine, "Alice", cardName);

    expect(state.decks.get(ageSetKey(1, CardSet.ARTIFACTS))!.length).toBe(deckSizeBefore - 1);
    const aliceDisplay = state.displays.get("Alice")!;
    expect(aliceDisplay.length).toBe(1);
    expect(aliceDisplay[0].isResolved).toBe(true);
    expect(aliceDisplay[0].resolvedName).toBe(cardName);
    expect(aliceDisplay[0].opponentKnowledge.kind).toBe("exact");
  });

  it("dig then return restores the deck and empties the display", () => {
    const { state, engine } = createInitializedGS({ echoes: false, artifacts: true, relics: false });
    const age1Deck = state.decks.get(ageSetKey(1, CardSet.ARTIFACTS))!;
    const sizeBefore = age1Deck.length;
    const cardName = cardDb.groupInfos(1, CardSet.ARTIFACTS)[0].indexName;

    dig(state, engine, "Alice", cardName);
    returnToDeck(state, engine, "Alice", cardName);

    expect(state.displays.get("Alice")!.length).toBe(0);
    expect(state.decks.get(ageSetKey(1, CardSet.ARTIFACTS))!.length).toBe(sizeBefore);
  });

  it("dig leaves card resolved on display across subsequent moves", () => {
    const { state, engine } = createInitializedGS({ echoes: false, artifacts: true, relics: false });
    const cardName = cardDb.groupInfos(1, CardSet.ARTIFACTS)[0].indexName;
    dig(state, engine, "Alice", cardName);

    // No intervening return: display stays populated until next explicit action
    const display = state.displays.get("Alice")!;
    expect(display.length).toBe(1);
    expect(display[0].resolvedName).toBe(cardName);
  });
});

describe("with-relics variant", () => {
  function relicNames(): string[] {
    // Collect relic indexNames across all supported sets.
    const out: string[] = [];
    for (const info of cardDb.values()) {
      if (info.isRelic) out.push(info.indexName);
    }
    return out;
  }

  it("removes relic cards from their source decks at init and puts them in the relics zone", () => {
    const relics = relicNames();
    expect(relics.length).toBeGreaterThan(0);
    const engine2 = new GameEngine(cardDb);
    const state2 = newGameState(PLAYERS, PERSPECTIVE);
    engine2.initGame(state2, { echoes: true, artifacts: true, relics: true }, relics);

    expect(state2.relics.length).toBe(relics.length);
    for (const card of state2.relics) {
      expect(card.isResolved).toBe(true);
      expect(relics).toContain(card.resolvedName);
    }
    // Each relic's source deck (if it exists) must not contain the relic.
    // Relics from unsupported sets (e.g. Figures) have no deck at all.
    for (const name of relics) {
      const info = cardDb.get(name)!;
      const deck = state2.decks.get(ageSetKey(info.age, info.cardSet));
      if (deck) {
        for (const c of deck) {
          expect(c.candidates.has(name)).toBe(false);
        }
      }
    }
  });

  it("without-relics init does not include relic cards in decks", () => {
    const relics = relicNames();
    const engine = new GameEngine(cardDb);
    const state = newGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(state, { echoes: true, artifacts: true, relics: false });
    expect(state.relics.length).toBe(0);
    // Relic cards are extra cards that only exist in the relics variant —
    // they're excluded from cardDb groups so they never appear in decks.
    for (const name of relics) {
      const info = cardDb.get(name)!;
      const deck = state.decks.get(ageSetKey(info.age, info.cardSet));
      if (deck) {
        const present = deck.some(c => c.candidates.has(name));
        expect(present).toBe(false);
      }
    }
  });
});

describe("relic seizes", () => {
  function seizeRelicToHand(engine: GameEngine, state: GameState, relicName: string, player: string): void {
    const entry: TransferEntry = {
      type: "transfer", move: 1, cardSet: "cities",
      source: "relics", dest: "hand",
      cardName: relicName, cardAge: cardDb.get(relicName)!.age,
      sourceOwner: null, destOwner: player,
      meldKeyword: false, topOfDeck: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).processTransfer(state, entry);
  }
  function achievementTransfer(engine: GameEngine, state: GameState, source: "relics" | "achievements", dest: "hand" | "achievements" | "relics", relicName: string, srcPlayer: string | null, destPlayer: string | null): void {
    const info = cardDb.get(relicName)!;
    const setLabel = info.cardSet === CardSet.BASE ? "base" : info.cardSet === CardSet.CITIES ? "cities" : info.cardSet === CardSet.ECHOES ? "echoes" : "artifacts";
    const entry: TransferEntry = {
      type: "transfer", move: 1, cardSet: setLabel,
      source, dest, cardName: relicName, cardAge: info.age,
      sourceOwner: srcPlayer, destOwner: destPlayer,
      meldKeyword: false, topOfDeck: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).processTransfer(state, entry);
  }

  function relicNames(): string[] {
    const out: string[] = [];
    for (const info of cardDb.values()) {
      if (info.isRelic) out.push(info.indexName);
    }
    return out;
  }

  function setup(): { state: GameState; engine: GameEngine; relics: string[] } {
    const relics = relicNames();
    const engine = new GameEngine(cardDb);
    const state = newGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(state, { echoes: true, artifacts: true, relics: true }, relics);
    // Must initialize log-processing state (even with an empty log) before
    // calling processTransfer, which uses the internal player pattern.
    engine.initLog(state, [], []);
    return { state, engine, relics };
  }

  it("seizes a relic from the relics zone to a player's hand", () => {
    const { state, engine, relics } = setup();
    const relicName = relics[0];
    seizeRelicToHand(engine, state, relicName, "Alice");

    expect(state.relics.some(c => c.resolvedName === relicName)).toBe(false);
    const aliceHand = state.hands.get("Alice")!;
    expect(aliceHand.some(c => c.isResolved && c.resolvedName === relicName)).toBe(true);
  });

  it("seizes a relic from the relics zone to a player's achievements", () => {
    const { state, engine, relics } = setup();
    const relicName = relics[0];
    achievementTransfer(engine, state, "relics", "achievements", relicName, null, "Alice");

    expect(state.relics.some(c => c.resolvedName === relicName)).toBe(false);
    const aliceAchRelics = state.achievementRelics.get("Alice")!;
    expect(aliceAchRelics.length).toBe(1);
    expect(aliceAchRelics[0].resolvedName).toBe(relicName);
  });

  it("re-seizes a relic from achievements back to hand", () => {
    const { state, engine, relics } = setup();
    const relicName = relics[0];
    achievementTransfer(engine, state, "relics", "achievements", relicName, null, "Alice");
    achievementTransfer(engine, state, "achievements", "hand", relicName, "Alice", "Bob");

    expect(state.achievementRelics.get("Alice")!.length).toBe(0);
    const bobHand = state.hands.get("Bob")!;
    expect(bobHand.some(c => c.isResolved && c.resolvedName === relicName)).toBe(true);
  });

  it("cross-player relic re-seize between achievement piles", () => {
    const { state, engine, relics } = setup();
    const relicName = relics[0];
    achievementTransfer(engine, state, "relics", "achievements", relicName, null, "Alice");
    achievementTransfer(engine, state, "achievements", "achievements", relicName, "Alice", "Bob");

    expect(state.achievementRelics.get("Alice")!.length).toBe(0);
    expect(state.achievementRelics.get("Bob")!.length).toBe(1);
    expect(state.achievementRelics.get("Bob")![0].resolvedName).toBe(relicName);
  });

  it("throws on non-relic achievement→hand transfer (defensive)", () => {
    const { state, engine } = setup();
    // Pick any non-relic base card
    const baseCard = [...cardDb.values()].find(c => c.cardSet === CardSet.BASE && !c.isRelic)!;
    const entry: TransferEntry = {
      type: "transfer", move: 1, cardSet: "base",
      source: "achievements", dest: "hand",
      cardName: baseCard.indexName, cardAge: baseCard.age,
      sourceOwner: "Alice", destOwner: "Alice",
      meldKeyword: false, topOfDeck: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (engine as any).processTransfer(state, entry)).toThrow(/non-relic/);
  });

  it("regular achievement claim (no card name) is silently skipped", () => {
    const { state, engine } = setup();
    const entry: TransferEntry = {
      type: "transfer", move: 1, cardSet: "base",
      source: "achievements", dest: "achievements",
      cardName: null, cardAge: 1,
      sourceOwner: null, destOwner: "Alice",
      meldKeyword: false, topOfDeck: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (engine as any).processTransfer(state, entry)).not.toThrow();
  });
});
