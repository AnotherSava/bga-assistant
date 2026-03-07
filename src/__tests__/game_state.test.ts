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
} from "../models/types";
import { GameState } from "../engine/game_state";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDatabase(): CardDatabase {
  const path = resolve(thisDir, "../../assets/bga/innovation/card_info.json");
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

function createGameState(): GameState {
  return new GameState(cardDb, PLAYERS, PERSPECTIVE);
}

function createInitializedGameState(): GameState {
  const gs = createGameState();
  gs.initGame();
  return gs;
}

function namedAction(overrides: Partial<NamedAction> & { cardName: string }): NamedAction {
  return {
    type: "named",
    source: "deck",
    dest: "hand",
    sourcePlayer: null,
    destPlayer: null,
    meldKeyword: false,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// initGame
// ---------------------------------------------------------------------------

describe("initGame", () => {
  it("creates decks for all card groups", () => {
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const age1Deck = gs.decks.get(age1Key)!;
    const groupSize = cardDb.groups().get(age1Key)!.size;
    // groupSize - 1 achievement - 2 per player (2 players)
    expect(age1Deck.length).toBe(groupSize - 1 - 2 * PLAYERS.length);
  });

  it("creates 9 achievements from base ages 1-9", () => {
    const gs = createInitializedGameState();
    expect(gs.achievements.length).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(gs.achievements[i].cardSet).toBe(CardSet.BASE);
      expect(gs.achievements[i].age).toBe(i + 1);
    }
  });

  it("deals 2 cards to each player's hand", () => {
    const gs = createInitializedGameState();
    for (const player of PLAYERS) {
      expect(gs.hands.get(player)!.length).toBe(2);
      for (const card of gs.hands.get(player)!) {
        expect(card.age).toBe(1);
        expect(card.cardSet).toBe(CardSet.BASE);
      }
    }
  });

  it("all cards start unresolved with full group candidates", () => {
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = cardDb.groups().get(age1Key)!;
    for (const card of gs.decks.get(age1Key)!) {
      expect(card.isResolved).toBe(false);
      expect(card.candidates).toEqual(groupNames);
    }
  });

  it("creates city decks", () => {
    const gs = createInitializedGameState();
    const cities1Key = ageSetKey(1, CardSet.CITIES);
    const citiesDeck = gs.decks.get(cities1Key);
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const hand = gs.hands.get("Alice")!;
    expect(hand[0].isResolved).toBe(true);
    expect(hand[0].resolvedName).toBe("agriculture");
    expect(hand[1].isResolved).toBe(true);
    expect(hand[1].resolvedName).toBe("archery");
  });

  it("propagates constraints after resolution", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const age1Key = ageSetKey(1, CardSet.BASE);
    for (const card of gs.decks.get(age1Key)!) {
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
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const cards = gs.cardsAt("deck", null, age1Key);
    const groupSize = cardDb.groups().get(age1Key)!.size;
    expect(cards.length).toBe(groupSize - 1 - 2 * PLAYERS.length);
  });

  it("returns hand cards by player", () => {
    const gs = createInitializedGameState();
    const cards = gs.cardsAt("hand", "Alice");
    expect(cards.length).toBe(2);
  });

  it("returns empty array for empty zones", () => {
    const gs = createInitializedGameState();
    expect(gs.cardsAt("board", "Alice").length).toBe(0);
    expect(gs.cardsAt("score", "Alice").length).toBe(0);
    expect(gs.cardsAt("revealed", "Alice").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Basic moves
// ---------------------------------------------------------------------------

describe("move", () => {
  it("moves a named card from deck to hand", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    gs.resolveHand("Bob", ["clothing", "city states"]);

    const card = gs.move(namedAction({
      cardName: "metalworking",
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("metalworking");
    expect(gs.hands.get("Alice")!.length).toBe(3);
    expect(gs.hands.get("Alice")!).toContain(card);
  });

  it("moves a grouped card from deck (hidden draw)", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      destPlayer: "Bob",
    }));

    expect(card.age).toBe(1);
    expect(card.cardSet).toBe(CardSet.BASE);
    expect(gs.hands.get("Bob")!).toContain(card);
  });

  it("moves a named card from hand to board (meld)", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
      meldKeyword: true,
    }));

    expect(card.resolvedName).toBe("agriculture");
    expect(gs.boards.get("Alice")!).toContain(card);
    expect(gs.hands.get("Alice")!.length).toBe(1);
  });

  it("moves a card from board to score", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    gs.move(namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    const card = gs.move(namedAction({
      cardName: "agriculture",
      source: "board",
      dest: "score",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    expect(card.resolvedName).toBe("agriculture");
    expect(gs.scores.get("Alice")!).toContain(card);
    expect(gs.boards.get("Alice")!.length).toBe(0);
  });

  it("marks cards public when moved to board", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(namedAction({
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "score",
      sourcePlayer: "Alice",
      destPlayer: "Bob",
    }));

    expect(card.opponentKnowledge.kind).toBe("exact");
  });

  it("sets exact opponent knowledge when card goes to opponent's private zone", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(namedAction({
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(namedAction({
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const card = gs.move(groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    expect(gs.hands.get("Bob")!.length).toBe(1);
    // Both the moved card and remaining card should share candidates
    const remaining = gs.hands.get("Bob")![0];
    expect(remaining.candidates).toEqual(card.candidates);
  });

  it("does not merge for named moves", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    gs.resolveHand("Bob", ["clothing", "city states"]);

    const card = gs.move(namedAction({
      cardName: "clothing",
      source: "hand",
      dest: "board",
      sourcePlayer: "Bob",
      destPlayer: "Bob",
    }));

    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("clothing");
    expect(gs.hands.get("Bob")![0].isResolved).toBe(true);
    expect(gs.hands.get("Bob")![0].resolvedName).toBe("city states");
  });
});

// ---------------------------------------------------------------------------
// Singleton propagation
// ---------------------------------------------------------------------------

describe("singleton propagation", () => {
  it("removes resolved name from other candidates in same group", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const age1Key = ageSetKey(1, CardSet.BASE);
    for (const card of gs.decks.get(age1Key)!) {
      expect(card.candidates.has("agriculture")).toBe(false);
      expect(card.candidates.has("archery")).toBe(false);
    }
  });

  it("cascade resolves when only one candidate remains", () => {
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    // Resolve Alice's hand (2 cards)
    gs.resolveHand("Alice", [groupNames[0], groupNames[1]]);
    // Resolve Bob's hand (2 cards)
    gs.resolveHand("Bob", [groupNames[2], groupNames[3]]);

    // Draw named cards from deck, leaving 1 unresolved (the achievement)
    const deckSize = gs.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize; i++) {
      gs.move(namedAction({
        cardName: groupNames[4 + i],
        source: "deck",
        dest: "hand",
        destPlayer: "Alice",
      }));
    }

    // After resolving all but 1, the achievement card should auto-resolve
    const allAge1Cards = [
      ...gs.decks.get(age1Key) ?? [],
      ...gs.hands.get("Alice")!.filter(c => c.groupKey === age1Key),
      ...gs.hands.get("Bob")!.filter(c => c.groupKey === age1Key),
      ...gs.achievements.filter(c => c.groupKey === age1Key),
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
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    // Resolve both hands
    gs.resolveHand("Alice", [groupNames[0], groupNames[1]]);
    gs.resolveHand("Bob", [groupNames[2], groupNames[3]]);

    // Draw all but 2 from deck, leaving 2 unresolved deck cards + 1 achievement = 3 unresolved
    const deckSize = gs.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize - 2; i++) {
      gs.move(namedAction({
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
    const remaining = gs.decks.get(age1Key)!;
    expect(remaining.length).toBe(2);

    // Resolve one more to trigger cascade
    gs.move(namedAction({
      cardName: groupNames[4 + deckSize - 2],
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    // Now 1 deck card + 1 achievement = 2 unresolved with 2 candidates each
    // They have the same candidates, so hidden singles can't help
    // But resolving 1 more triggers singleton cascade
    gs.move(namedAction({
      cardName: groupNames[4 + deckSize - 1],
      source: "deck",
      dest: "hand",
      destPlayer: "Alice",
    }));

    // Achievement should now be resolved via cascade
    const achievement = gs.achievements.find(c => c.groupKey === age1Key)!;
    expect(achievement.isResolved).toBe(true);
    expect(groupNames).toContain(achievement.resolvedName);
  });
});

// ---------------------------------------------------------------------------
// Naked subsets propagation
// ---------------------------------------------------------------------------

describe("naked subsets", () => {
  it("removes naked pair candidates from other cards", () => {
    const gs = createGameState();
    gs.initGame();

    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    gs.resolveHand("Alice", [groupNames[0], groupNames[1]]);
    gs.resolveHand("Bob", [groupNames[2], groupNames[3]]);

    // Draw some named cards to reduce the unresolved pool
    const deckSize = gs.decks.get(age1Key)!.length;
    // Leave enough unresolved for naked subsets to apply (need > 3 unresolved)
    const drawCount = Math.max(0, deckSize - 5);
    for (let i = 0; i < drawCount; i++) {
      gs.move(namedAction({ cardName: groupNames[4 + i], source: "deck", dest: "hand", destPlayer: "Alice" }));
    }

    // Verify remaining cards still have valid candidate sets
    const remaining = gs.decks.get(age1Key)!;
    for (const card of remaining) {
      expect(card.candidates.size).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Suspect propagation
// ---------------------------------------------------------------------------

describe("suspect propagation", () => {
  it("removes public card name from other cards' suspect lists on next propagation", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    // Set up partial knowledge on Bob's hand cards
    const bobHand = gs.hands.get("Bob")!;
    bobHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "clothing"]), closed: true };
    bobHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "metalworking"]), closed: false };

    // Move agriculture to board (marks it public)
    gs.move(namedAction({
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
    }));

    // Suspect propagation runs during propagate(), which is called during takeFromSource
    // But markPublic happens AFTER takeFromSource. So we need another move in the same
    // group to trigger propagation again.
    gs.move(namedAction({
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const aliceHand = gs.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture"]), closed: true };
    aliceHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["archery"]), closed: true };

    gs.move(groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Alice",
    }));

    const remaining = aliceHand[0];
    expect(remaining.opponentKnowledge.kind).toBe("partial");
    if (remaining.opponentKnowledge.kind === "partial") {
      expect(remaining.opponentKnowledge.suspects).toEqual(new Set(["agriculture", "archery"]));
      expect(remaining.opponentKnowledge.closed).toBe(true);
    }
  });

  it("does not merge suspects for opponent's moves", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    // Set knowledge on BOTH of Bob's cards so whichever remains, we can verify
    const bobHand = gs.hands.get("Bob")!;
    bobHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["clothing"]), closed: true };
    bobHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["metalworking"]), closed: true };

    gs.move(groupedAction({
      age: 1,
      cardSet: CardSet.BASE,
      source: "hand",
      dest: "deck",
      sourcePlayer: "Bob",
    }));

    // Bob's remaining card knowledge should not have been merged
    // (merge only happens for our perspective's private zones)
    const remaining = gs.hands.get("Bob")![0];
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
  it("tracks meld icon and discards", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    gs.confirmMeldFilter("crown");
    // After confirm with no discards, should not throw
  });

  it("does not corrupt later revealed->deck cards when meld filter returns go through hand (bug #816652225)", () => {
    // Jakarta (cities age 3) has leaf at icon position 5, triggering meld filter.
    // Draw phase: Education, Engineering, Alchemy drawn deck->revealed->hand.
    // Education and Engineering lack leaf -> discardNames.
    // confirmMeldFilter sets remainingReturns = 2.
    // Returns go hand->deck (NOT revealed->deck).
    // Later, unrelated Colonialism/Navigation go revealed->deck and must NOT be corrupted.
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    gs.resolveHand("Bob", ["clothing", "city states"]);

    // Draw Jakarta from cities deck, then meld it (meldKeyword triggers filter)
    gs.move(namedAction({ cardName: "jakarta", source: "deck", dest: "hand", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "jakarta", source: "hand", dest: "board", sourcePlayer: "Alice", destPlayer: "Alice", meldKeyword: true }));

    // Draw phase: deck->revealed->hand for Education, Engineering, Alchemy
    gs.move(namedAction({ cardName: "education", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "education", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "engineering", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "engineering", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "alchemy", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "alchemy", source: "revealed", dest: "hand", sourcePlayer: "Alice", destPlayer: "Alice" }));

    // Confirm meld filter
    gs.confirmMeldFilter("leaf");

    // Returns go hand->deck (the actual BGA flow)
    gs.move(namedAction({ cardName: "education", source: "hand", dest: "deck", sourcePlayer: "Alice" }));
    gs.move(namedAction({ cardName: "engineering", source: "hand", dest: "deck", sourcePlayer: "Alice" }));

    // Later: unrelated deck->revealed->deck for age 4 base cards
    gs.move(namedAction({ cardName: "colonialism", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    gs.move(namedAction({ cardName: "navigation", source: "deck", dest: "revealed", destPlayer: "Alice" }));
    // Return them to deck
    gs.move(namedAction({ cardName: "navigation", source: "revealed", dest: "deck", sourcePlayer: "Alice" }));
    gs.move(namedAction({ cardName: "colonialism", source: "revealed", dest: "deck", sourcePlayer: "Alice" }));

    // Colonialism and Navigation must still be themselves, not corrupted to education/engineering
    const age4Deck = gs.decks.get(ageSetKey(4, CardSet.BASE))!;
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
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    gs.revealHand("Bob", ["clothing", "city states"]);

    const bobHand = gs.hands.get("Bob")!;
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
    const gs = createGameState();
    gs.initGame();

    const result = gs.deduceInitialHand([], ["Agriculture", "Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("undoes incoming transfers", () => {
    const gs = createGameState();
    gs.initGame();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
    ];

    const result = gs.deduceInitialHand(log, ["Agriculture", "Archery", "Metalworking"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("undoes outgoing transfers", () => {
    const gs = createGameState();
    gs.initGame();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true },
    ];

    const result = gs.deduceInitialHand(log, ["Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("handles multiple transfers", () => {
    const gs = createGameState();
    gs.initGame();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
    ];

    const result = gs.deduceInitialHand(log, ["Archery", "Metalworking"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });

  it("ignores transfers for other players", () => {
    const gs = createGameState();
    gs.initGame();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "hand", cardName: "Clothing", cardAge: 1, sourceOwner: null, destOwner: "Bob", meldKeyword: false },
    ];

    const result = gs.deduceInitialHand(log, ["Agriculture", "Archery"]);
    expect(result.sort()).toEqual(["agriculture", "archery"]);
  });
});

// ---------------------------------------------------------------------------
// processLog (full pipeline)
// ---------------------------------------------------------------------------

describe("processLog", () => {
  it("processes a simple game log", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
    ];
    const myHand = ["Archery", "Metalworking"];

    gs.processLog(log, myHand);

    const board = gs.boards.get("Alice")!;
    expect(board.some(c => c.resolvedName === "agriculture")).toBe(true);

    const hand = gs.hands.get("Alice")!;
    expect(hand.length).toBe(2);
    const handNames = hand.map(c => c.resolvedName).sort();
    expect(handNames).toEqual(["archery", "metalworking"]);
  });

  it("processes reveal hand messages", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "logWithCardTooltips", move: 1, msg: "Bob reveals his hand: [1] Clothing, [1] City States." },
    ];
    const myHand = ["Agriculture", "Archery"];

    gs.processLog(log, myHand);

    const bobHand = gs.hands.get("Bob")!;
    const clothing = bobHand.find(c => c.resolvedName === "clothing");
    expect(clothing).toBeDefined();
    expect(clothing!.opponentKnowledge.kind).toBe("exact");
  });

  it("processes meld filter messages", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "log", move: 1, msg: "The revealed cards with a [crown] will be kept" },
    ];
    const myHand = ["Agriculture", "Archery"];

    gs.processLog(log, myHand);
  });

  it("skips achievement transfers", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "board", dest: "achievements", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false },
    ];
    const myHand = ["Agriculture", "Archery"];

    gs.processLog(log, myHand);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe("serialization", () => {
  it("round-trips an initial game state", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    gs.resolveHand("Bob", ["clothing", "city states"]);

    const json = gs.toJSON();
    const gs2 = GameState.fromJSON(json, cardDb, PLAYERS, PERSPECTIVE);

    const aliceHand = gs2.hands.get("Alice")!;
    expect(aliceHand.length).toBe(2);
    expect(aliceHand[0].resolvedName).toBe("agriculture");
    expect(aliceHand[1].resolvedName).toBe("archery");

    const bobHand = gs2.hands.get("Bob")!;
    expect(bobHand.length).toBe(2);
    expect(bobHand[0].resolvedName).toBe("clothing");
    expect(bobHand[1].resolvedName).toBe("city states");
  });

  it("round-trips unresolved cards with exclusions", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const json = gs.toJSON();
    const gs2 = GameState.fromJSON(json, cardDb, PLAYERS, PERSPECTIVE);

    const age1Key = ageSetKey(1, CardSet.BASE);
    const deckCards = gs2.decks.get(age1Key)!;
    for (const card of deckCards) {
      expect(card.candidates.has("agriculture")).toBe(false);
      expect(card.candidates.has("archery")).toBe(false);
    }
  });

  it("round-trips opponent knowledge", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const aliceHand = gs.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    aliceHand[1].opponentKnowledge = { kind: "partial", suspects: new Set(["archery", "clothing"]), closed: true };

    const json = gs.toJSON();
    const gs2 = GameState.fromJSON(json, cardDb, PLAYERS, PERSPECTIVE);

    const hand2 = gs2.hands.get("Alice")!;
    expect(hand2[0].opponentKnowledge).toEqual({ kind: "exact", name: "agriculture" });
    expect(hand2[1].opponentKnowledge.kind).toBe("partial");
    if (hand2[1].opponentKnowledge.kind === "partial") {
      expect(hand2[1].opponentKnowledge.suspects).toEqual(new Set(["archery", "clothing"]));
      expect(hand2[1].opponentKnowledge.closed).toBe(true);
    }
  });

  it("round-trips achievements", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const json = gs.toJSON();
    const gs2 = GameState.fromJSON(json, cardDb, PLAYERS, PERSPECTIVE);

    expect(gs2.achievements.length).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(gs2.achievements[i].age).toBe(i + 1);
    }
  });

  it("serializes resolved cards compactly", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const json = gs.toJSON();
    const aliceHand = json.hands["Alice"];
    expect(aliceHand[0].resolved).toBe("agriculture");
    expect(aliceHand[0].age).toBeUndefined();
    expect(aliceHand[0].cardSet).toBeUndefined();
  });

  it("serializes unresolved cards with exclusions", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const json = gs.toJSON();
    const deckKey = "1/base";
    const deckCards = json.decks[deckKey];
    for (const card of deckCards) {
      expect(card.age).toBe(1);
      expect(card.cardSet).toBe(CardSet.BASE);
      expect(card.excluded).toBeDefined();
      expect(card.excluded).toContain("agriculture");
      expect(card.excluded).toContain("archery");
    }
  });

  it("omits opponent knowledge when none", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const json = gs.toJSON();
    const aliceHand = json.hands["Alice"];
    expect(aliceHand[0].opponent).toBeUndefined();
    expect(aliceHand[1].opponent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Opponent knowledge queries
// ---------------------------------------------------------------------------

describe("opponent knowledge queries", () => {
  it("opponentKnowsNothing for fresh cards", () => {
    const gs = createInitializedGameState();
    const aliceHand = gs.hands.get("Alice")!;
    expect(gs.opponentKnowsNothing(aliceHand[0])).toBe(true);
  });

  it("opponentKnowsNothing false for exact knowledge", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const aliceHand = gs.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    expect(gs.opponentKnowsNothing(aliceHand[0])).toBe(false);
  });

  it("opponentHasPartialInformation for partial knowledge", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const aliceHand = gs.hands.get("Alice")!;

    aliceHand[0].opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture"]), closed: false };
    expect(gs.opponentHasPartialInformation(aliceHand[0])).toBe(true);
  });

  it("opponentHasPartialInformation false for exact knowledge", () => {
    const gs = createInitializedGameState();
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const aliceHand = gs.hands.get("Alice")!;
    aliceHand[0].opponentKnowledge = { kind: "exact", name: "agriculture" };
    expect(gs.opponentHasPartialInformation(aliceHand[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full game sequence
// ---------------------------------------------------------------------------

describe("full game sequence", () => {
  it("handles a multi-turn game sequence", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true },
      { type: "transfer", move: 2, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
      { type: "transfer", move: 3, cardSet: "base", source: "hand", dest: "board", cardName: null, cardAge: 1, sourceOwner: "Bob", destOwner: "Bob", meldKeyword: true },
      { type: "transfer", move: 4, cardSet: "base", source: "deck", dest: "hand", cardName: null, cardAge: 1, sourceOwner: null, destOwner: "Bob", meldKeyword: false },
      { type: "transfer", move: 5, cardSet: "base", source: "hand", dest: "score", cardName: "Archery", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: false },
      { type: "transfer", move: 6, cardSet: "base", source: "deck", dest: "hand", cardName: "Calendar", cardAge: 2, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
    ];
    const myHand = ["Metalworking", "Calendar"];

    gs.processLog(log, myHand);

    const aliceBoard = gs.boards.get("Alice")!;
    expect(aliceBoard.some(c => c.resolvedName === "agriculture")).toBe(true);

    const aliceScore = gs.scores.get("Alice")!;
    expect(aliceScore.some(c => c.resolvedName === "archery")).toBe(true);

    const aliceHand = gs.hands.get("Alice")!;
    expect(aliceHand.length).toBe(2);
    const handNames = aliceHand.map(c => c.resolvedName).sort();
    expect(handNames).toEqual(["calendar", "metalworking"]);

    expect(gs.hands.get("Bob")!.length).toBe(2);
    expect(gs.boards.get("Bob")!.length).toBe(1);
  });

  it("handles game with revealed hand", () => {
    const gs = createInitializedGameState();

    const log: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "hand", dest: "board", cardName: "Agriculture", cardAge: 1, sourceOwner: "Alice", destOwner: "Alice", meldKeyword: true },
      { type: "logWithCardTooltips", move: 2, msg: "Bob reveals his hand: [1] Clothing, [1] City States." },
      { type: "transfer", move: 3, cardSet: "base", source: "deck", dest: "hand", cardName: "Metalworking", cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
    ];
    const myHand = ["Archery", "Metalworking"];

    gs.processLog(log, myHand);

    const bobHand = gs.hands.get("Bob")!;
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
    const gs = createInitializedGameState();
    const age1Key = ageSetKey(1, CardSet.BASE);
    const groupNames = [...cardDb.groups().get(age1Key)!];

    gs.resolveHand("Alice", [groupNames[0], groupNames[1]]);
    gs.resolveHand("Bob", [groupNames[2], groupNames[3]]);

    // Draw and resolve many cards
    const deckSize = gs.decks.get(age1Key)!.length;
    for (let i = 0; i < deckSize; i++) {
      gs.move(namedAction({ cardName: groupNames[4 + i], source: "deck", dest: "hand", destPlayer: "Alice" }));
    }

    // All cards in the group should be resolved (including the achievement)
    const allCards = [
      ...gs.decks.get(age1Key) ?? [],
      ...gs.hands.get("Alice")!.filter(c => c.groupKey === age1Key),
      ...gs.hands.get("Bob")!.filter(c => c.groupKey === age1Key),
      ...gs.achievements.filter(c => c.groupKey === age1Key),
    ];
    const resolved = allCards.filter(c => c.isResolved);
    expect(resolved.length).toBe(groupNames.length);
  });
});
