import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  CardSet,
  Color,
  colorLabel,
  cardSetLabel,
  cardSetFromLabel,
  ageSetKey,
  parseAgeSetKey,
  cardIndex,
  Card,
  CardDatabase,
  type AgeSetKey,
  type CardInfo,
  type NamedAction,
  type GroupedAction,
  type TransferEntry,
  type MessageEntry,
  type GameLogEntry,
} from "../models/types";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDatabase(): CardDatabase {
  const path = resolve(thisDir, "../../assets/bga/innovation/card_info.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return new CardDatabase(raw);
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("CardSet enum", () => {
  it("has correct numeric values", () => {
    expect(CardSet.BASE).toBe(0);
    expect(CardSet.CITIES).toBe(2);
    expect(CardSet.ECHOES).toBe(3);
  });

  it("cardSetLabel returns lowercase", () => {
    expect(cardSetLabel(CardSet.BASE)).toBe("base");
    expect(cardSetLabel(CardSet.CITIES)).toBe("cities");
    expect(cardSetLabel(CardSet.ECHOES)).toBe("echoes");
  });

  it("cardSetFromLabel parses labels", () => {
    expect(cardSetFromLabel("base")).toBe(CardSet.BASE);
    expect(cardSetFromLabel("CITIES")).toBe(CardSet.CITIES);
    expect(cardSetFromLabel("Echoes")).toBe(CardSet.ECHOES);
    expect(cardSetFromLabel("Base")).toBe(CardSet.BASE);
  });

  it("cardSetFromLabel throws on unknown label", () => {
    expect(() => cardSetFromLabel("figures")).toThrow("Unknown card set label: figures");
  });
});

describe("Color enum", () => {
  it("has correct numeric values", () => {
    expect(Color.BLUE).toBe(0);
    expect(Color.RED).toBe(1);
    expect(Color.GREEN).toBe(2);
    expect(Color.YELLOW).toBe(3);
    expect(Color.PURPLE).toBe(4);
  });

  it("colorLabel returns lowercase", () => {
    expect(colorLabel(Color.BLUE)).toBe("blue");
    expect(colorLabel(Color.PURPLE)).toBe("purple");
  });
});

// ---------------------------------------------------------------------------
// AgeSet key
// ---------------------------------------------------------------------------

describe("AgeSetKey", () => {
  it("creates and parses keys correctly", () => {
    const key = ageSetKey(3, CardSet.BASE);
    expect(key).toBe("3:0");
    const parsed = parseAgeSetKey(key);
    expect(parsed.age).toBe(3);
    expect(parsed.cardSet).toBe(CardSet.BASE);
  });

  it("round-trips cities cards", () => {
    const key = ageSetKey(5, CardSet.CITIES);
    expect(key).toBe("5:2");
    const parsed = parseAgeSetKey(key);
    expect(parsed.age).toBe(5);
    expect(parsed.cardSet).toBe(CardSet.CITIES);
  });
});

// ---------------------------------------------------------------------------
// cardIndex
// ---------------------------------------------------------------------------

describe("cardIndex", () => {
  it("lowercases names", () => {
    expect(cardIndex("Agriculture")).toBe("agriculture");
    expect(cardIndex("The Pirate Code")).toBe("the pirate code");
  });
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

describe("Card", () => {
  it("creates with no candidates", () => {
    const card = new Card(1, CardSet.BASE);
    expect(card.age).toBe(1);
    expect(card.cardSet).toBe(CardSet.BASE);
    expect(card.candidates.size).toBe(0);
    expect(card.isResolved).toBe(false);
    expect(card.resolvedName).toBeNull();
    expect(card.opponentKnowledge).toEqual({ kind: "none" });
  });

  it("creates with candidates", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture", "archery", "clothing"]);
    expect(card.candidates.size).toBe(3);
    expect(card.isResolved).toBe(false);
  });

  it("isResolved and resolvedName with single candidate", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture"]);
    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("agriculture");
  });

  it("inline resolve sets single candidate", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture", "archery"]);
    card.candidates = new Set(["agriculture"]);
    expect(card.isResolved).toBe(true);
    expect(card.resolvedName).toBe("agriculture");
    expect(card.candidates.size).toBe(1);
  });

  it("inline markPublic sets exact opponent knowledge", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture"]);
    card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
    expect(card.opponentKnowledge).toEqual({ kind: "exact", name: "agriculture" });
  });

  it("inline markPublic sets exact with null name when unresolved", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture", "archery"]);
    card.opponentKnowledge = { kind: "exact", name: card.resolvedName };
    expect(card.opponentKnowledge).toEqual({ kind: "exact", name: null });
  });

  it("supports partial opponent knowledge", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture", "archery", "clothing"]);
    card.opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "archery"]), closed: false };
    expect(card.opponentKnowledge.kind).toBe("partial");
    if (card.opponentKnowledge.kind === "partial") {
      expect(card.opponentKnowledge.suspects.size).toBe(2);
      expect(card.opponentKnowledge.closed).toBe(false);
    }
  });

  it("supports closed partial knowledge", () => {
    const card = new Card(1, CardSet.BASE, ["agriculture", "archery"]);
    card.opponentKnowledge = { kind: "partial", suspects: new Set(["agriculture", "archery"]), closed: true };
    if (card.opponentKnowledge.kind === "partial") {
      expect(card.opponentKnowledge.closed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CardDatabase
// ---------------------------------------------------------------------------

describe("CardDatabase", () => {
  it("loads from real card_info.json", () => {
    const db = loadCardDatabase();
    expect(db.size).toBeGreaterThan(100);
    expect(db.has("agriculture")).toBe(true);
    expect(db.has("nonexistent")).toBe(false);
  });

  it("skips null and non-card entries", () => {
    const db = new CardDatabase([null, { name: "Special", text: "not a card" } as any, null]);
    expect(db.size).toBe(0);
  });

  it("skips entries with unknown sets", () => {
    const db = new CardDatabase([{ name: "Test", age: 1, color: "blue", set: 99 }]);
    expect(db.size).toBe(0);
  });

  it("get returns CardInfo for known cards", () => {
    const db = loadCardDatabase();
    const info = db.get("agriculture")!;
    expect(info).toBeDefined();
    expect(info.name).toBe("Agriculture");
    expect(info.indexName).toBe("agriculture");
    expect(info.age).toBe(1);
    expect(info.color).toBe(Color.YELLOW);
    expect(info.cardSet).toBe(CardSet.BASE);
    expect(info.icons).toEqual(["hex", "leaf", "leaf", "leaf"]);
    expect(info.spriteIndex).toBeGreaterThan(0);
  });

  it("get returns undefined for unknown cards", () => {
    const db = loadCardDatabase();
    expect(db.get("nonexistent")).toBeUndefined();
  });

  it("displayName returns proper case name", () => {
    const db = loadCardDatabase();
    expect(db.displayName("agriculture")).toBe("Agriculture");
    expect(db.displayName("archery")).toBe("Archery");
  });

  it("displayName throws for unknown cards", () => {
    const db = loadCardDatabase();
    expect(() => db.displayName("nonexistent")).toThrow("Unknown card: nonexistent");
  });

  it("groups base age 1 cards correctly", () => {
    const db = loadCardDatabase();
    const groups = db.groups();
    const baseAge1Key = ageSetKey(1, CardSet.BASE);
    const baseAge1 = groups.get(baseAge1Key);
    expect(baseAge1).toBeDefined();
    expect(baseAge1!.size).toBeGreaterThanOrEqual(5);
    expect(baseAge1!.has("agriculture")).toBe(true);
    expect(baseAge1!.has("archery")).toBe(true);
    expect(baseAge1!.has("clothing")).toBe(true);
  });

  it("groupInfos returns sorted cards", () => {
    const db = loadCardDatabase();
    const infos = db.groupInfos(1, CardSet.BASE);
    expect(infos.length).toBeGreaterThanOrEqual(5);
    // Should be sorted by color then name
    for (let i = 1; i < infos.length; i++) {
      const prev = infos[i - 1];
      const curr = infos[i];
      expect(prev.color < curr.color || (prev.color === curr.color && prev.indexName <= curr.indexName)).toBe(true);
    }
  });

  it("groupInfos returns empty array for missing group", () => {
    const db = loadCardDatabase();
    expect(db.groupInfos(99, CardSet.BASE)).toEqual([]);
  });

  it("has cities cards", () => {
    const db = loadCardDatabase();
    const citiesGroups = [...db.groups().entries()].filter(([key]) => parseAgeSetKey(key as AgeSetKey).cardSet === CardSet.CITIES);
    expect(citiesGroups.length).toBeGreaterThan(0);
  });

  it("sortKey returns correct tuple", () => {
    const db = loadCardDatabase();
    const [age, color, name] = db.sortKey("agriculture");
    expect(age).toBe(1);
    expect(color).toBe(Color.YELLOW);
    expect(name).toBe("agriculture");
  });

  it("sortKey throws for unknown cards", () => {
    const db = loadCardDatabase();
    expect(() => db.sortKey("nonexistent")).toThrow("Unknown card: nonexistent");
  });

  it("iterates over all cards", () => {
    const db = loadCardDatabase();
    const keys = [...db.keys()];
    const values = [...db.values()];
    const entries = [...db.entries()];
    expect(keys.length).toBe(db.size);
    expect(values.length).toBe(db.size);
    expect(entries.length).toBe(db.size);
    expect(entries[0][0]).toBe(entries[0][1].indexName);
  });

  it("works with minimal synthetic data", () => {
    const db = new CardDatabase([
      null,
      { name: "Alpha", age: 1, color: "blue", set: 0, icons: ["hex", "crown"], dogmas: ["Do something"] },
      { name: "Beta", age: 1, color: "red", set: 0, icons: ["leaf", "factory"], dogmas: [] },
      { name: "CityA", age: 1, color: "green", set: 2, icons: ["castle"], dogmas: [] },
      { name: "EchoA", age: 1, color: "purple", set: 3, icons: ["hex", "castle", "echo", "bonus-1"], dogmas: [] },
    ]);
    expect(db.size).toBe(4);
    expect(db.get("alpha")!.spriteIndex).toBe(1);
    expect(db.get("beta")!.spriteIndex).toBe(2);
    expect(db.get("citya")!.cardSet).toBe(CardSet.CITIES);
    expect(db.get("echoa")!.cardSet).toBe(CardSet.ECHOES);

    const baseAge1 = db.groupInfos(1, CardSet.BASE);
    expect(baseAge1.length).toBe(2);
    expect(baseAge1[0].name).toBe("Alpha"); // blue before red

    const citiesAge1 = db.groupInfos(1, CardSet.CITIES);
    expect(citiesAge1.length).toBe(1);
    expect(citiesAge1[0].name).toBe("CityA");

    const echoesAge1 = db.groupInfos(1, CardSet.ECHOES);
    expect(echoesAge1.length).toBe(1);
    expect(echoesAge1[0].name).toBe("EchoA");
  });
});

// ---------------------------------------------------------------------------
// Action types (compile-time checks)
// ---------------------------------------------------------------------------

describe("Action types", () => {
  it("NamedAction has type 'named' with cardName", () => {
    const action: NamedAction = {
      type: "named",
      cardName: "agriculture",
      source: "hand",
      dest: "board",
      sourcePlayer: "Alice",
      destPlayer: "Alice",
      meldKeyword: true,
    };
    expect(action.type).toBe("named");
    expect(action.cardName).toBe("agriculture");
  });

  it("GroupedAction has type 'grouped' with age and cardSet", () => {
    const action: GroupedAction = {
      type: "grouped",
      age: 3,
      cardSet: CardSet.BASE,
      source: "deck",
      dest: "hand",
      sourcePlayer: null,
      destPlayer: "Bob",
      meldKeyword: false,
    };
    expect(action.type).toBe("grouped");
    expect(action.age).toBe(3);
    expect(action.cardSet).toBe(CardSet.BASE);
  });
});

// ---------------------------------------------------------------------------
// GameLogEntry types (compile-time checks)
// ---------------------------------------------------------------------------

describe("GameLogEntry types", () => {
  it("TransferEntry has correct shape", () => {
    const entry: TransferEntry = {
      type: "transfer",
      move: 3,
      cardSet: "base",
      source: "hand",
      dest: "board",
      cardName: "Clothing",
      cardAge: 1,
      sourceOwner: "Alice",
      destOwner: "Alice",
      meldKeyword: true,
    };
    expect(entry.type).toBe("transfer");
    expect(entry.cardName).toBe("Clothing");
  });

  it("MessageEntry with type 'log' has correct shape", () => {
    const entry: MessageEntry = {
      type: "log",
      move: 2,
      msg: "Alice chooses a card.",
    };
    expect(entry.type).toBe("log");
  });

  it("MessageEntry with type 'logWithCardTooltips' has correct shape", () => {
    const entry: MessageEntry = {
      type: "logWithCardTooltips",
      move: 8,
      msg: "Bob endorses the dogma of 1 Archery with [castle] as the featured icon.",
    };
    expect(entry.type).toBe("logWithCardTooltips");
  });

  it("GameLogEntry discriminates on type field", () => {
    const entries: GameLogEntry[] = [
      { type: "transfer", move: 1, cardSet: "base", source: "deck", dest: "hand", cardName: null, cardAge: 1, sourceOwner: null, destOwner: "Alice", meldKeyword: false },
      { type: "log", move: 2, msg: "A message" },
    ];
    for (const entry of entries) {
      if (entry.type === "transfer") {
        expect(entry.cardSet).toBe("base");
      } else if (entry.type === "log" || entry.type === "logWithCardTooltips") {
        expect(entry.msg).toBe("A message");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// bug: A.I. card name mismatch with BGA
// ---------------------------------------------------------------------------

describe("bug: A.I. card name matches BGA notation", () => {
  it("card_info.json uses 'A. I.' to match BGA gamedatas", () => {
    const db = loadCardDatabase();
    expect(db.has(cardIndex("A. I."))).toBe(true);
    expect(db.get(cardIndex("A. I."))!.name).toBe("A. I.");
  });
});
