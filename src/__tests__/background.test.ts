import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Mock Chrome APIs before background.ts module-level code runs.
vi.hoisted(() => {
  (globalThis as any).chrome = {
    action: {
      onClicked: { addListener: () => {} },
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
    },
    scripting: { executeScript: () => Promise.resolve([]) },
    sidePanel: { open: () => Promise.resolve() },
    runtime: {
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      sendMessage: () => Promise.resolve(),
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      get: () => Promise.resolve({}),
      query: () => Promise.resolve([]),
    },
  };
});

import { runPipeline, classifyNavigation, type PipelineResults, type NavigationAction } from "../background";
import { CardDatabase } from "../models/types";
import type { RawExtractionData } from "../engine/process_log";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDb(): CardDatabase {
  const raw = JSON.parse(readFileSync(resolve(thisDir, "../../assets/bga/innovation/card_info.json"), "utf-8"));
  return new CardDatabase(raw);
}

// Helper to build minimal raw extraction data with the given notification packets.
function makeRawData(
  players: Record<string, string>,
  packets: RawExtractionData["packets"],
  gamedatas?: RawExtractionData["gamedatas"],
): RawExtractionData {
  return { players, packets, gamedatas };
}

// Helper to build a transferedCard spectator + player notification pair.
function transferPair(
  moveId: number,
  spectatorArgs: Record<string, unknown>,
  playerArgs: Record<string, unknown>,
): RawExtractionData["packets"] {
  return [
    {
      move_id: moveId,
      time: 1000 + moveId,
      data: [{ type: "transferedCard", args: playerArgs }],
    },
    {
      move_id: moveId,
      time: 1000 + moveId,
      data: [{ type: "transferedCard_spectator", args: spectatorArgs }],
    },
  ];
}

describe("runPipeline", () => {
  const cardDb = loadCardDb();

  it("processes empty extraction data without errors", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345");
    expect(result.gameLog).toBeDefined();
    expect(result.gameState).toBeDefined();
    expect(result.gameLog.players).toEqual({ "1": "Alice", "2": "Bob" });
    expect(result.gameLog.log).toEqual([]);
  });

  it("initializes game state with correct deck structure", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345");

    // Decks should exist for each age/set combo
    expect(Object.keys(result.gameState.decks).length).toBeGreaterThan(0);
    // Hands should exist for each player
    expect(result.gameState.hands["Alice"]).toBeDefined();
    expect(result.gameState.hands["Bob"]).toBeDefined();
    // Each player starts with 2 cards in hand
    expect(result.gameState.hands["Alice"].length).toBe(2);
    expect(result.gameState.hands["Bob"].length).toBe(2);
  });

  it("initializes achievements from base ages 1-9", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345");
    expect(result.gameState.achievements.length).toBe(9);
  });

  it("processes a card draw from deck to hand", () => {
    const packets = transferPair(
      1,
      { type: "0" }, // spectator: base set
      { name: "Metalworking", age: 1, location_from: "deck", location_to: "hand", owner_from: "", owner_to: "1", meld_keyword: false },
    );

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
      { my_hand: [], cards: {} },
    );
    const result = runPipeline(rawData, cardDb, "12345");

    // Alice should have 3 cards in hand (2 initial + 1 drawn)
    expect(result.gameState.hands["Alice"].length).toBe(3);
    // The drawn card should be resolved to Metalworking
    const metalworking = result.gameState.hands["Alice"].find(
      (c: { resolved?: string }) => c.resolved === "metalworking",
    );
    expect(metalworking).toBeDefined();
  });

  it("processes a card meld from hand to board", () => {
    const packets = transferPair(
      1,
      { type: "0" },
      { name: "Pottery", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false },
    );

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
      { my_hand: [{ id: 1 }], cards: { "1": { name: "Pottery" } } },
    );
    const result = runPipeline(rawData, cardDb, "12345");

    // Alice should have 1 card on board
    expect(result.gameState.boards["Alice"].length).toBe(1);
    expect(result.gameState.boards["Alice"][0].resolved).toBe("pottery");
    // Alice should have 1 card in hand (started with 2, one moved to board)
    expect(result.gameState.hands["Alice"].length).toBe(1);
  });

  it("processes initial hand deduction from gamedatas", () => {
    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      [],
      {
        my_hand: [{ id: 10 }, { id: 20 }],
        cards: { "10": { name: "Pottery" }, "20": { name: "Tools" } },
      },
    );
    const result = runPipeline(rawData, cardDb, "12345");

    // Alice (first player = perspective) should have her hand resolved
    const hand = result.gameState.hands["Alice"];
    const resolvedNames = hand.map((c: { resolved?: string }) => c.resolved).filter(Boolean);
    expect(resolvedNames).toContain("pottery");
    expect(resolvedNames).toContain("tools");
  });

  it("processes multiple moves in sequence", () => {
    // Move 1: Alice draws Metalworking
    // Move 2: Alice melds Metalworking to board
    const packets = [
      ...transferPair(
        1,
        { type: "0" },
        { name: "Metalworking", age: 1, location_from: "deck", location_to: "hand", owner_from: "", owner_to: "1", meld_keyword: false },
      ),
      ...transferPair(
        2,
        { type: "0" },
        { name: "Metalworking", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false },
      ),
    ];

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
      { my_hand: [], cards: {} },
    );
    const result = runPipeline(rawData, cardDb, "12345");

    // Metalworking should be on Alice's board
    expect(result.gameState.boards["Alice"].length).toBe(1);
    expect(result.gameState.boards["Alice"][0].resolved).toBe("metalworking");
    // Alice's hand should still have 2 cards (started with 2, drew 1, played 1)
    expect(result.gameState.hands["Alice"].length).toBe(2);
  });

  it("processes scoring (hand to score)", () => {
    const packets = transferPair(
      1,
      { type: "0" },
      { name: "Pottery", age: 1, location_from: "hand", location_to: "score", owner_from: "1", owner_to: "1", meld_keyword: false },
    );

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
      { my_hand: [{ id: 1 }], cards: { "1": { name: "Pottery" } } },
    );
    const result = runPipeline(rawData, cardDb, "12345");

    expect(result.gameState.scores["Alice"].length).toBe(1);
    expect(result.gameState.scores["Alice"][0].resolved).toBe("pottery");
  });

  it("returns serializable game state", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345");

    // The result should be JSON-serializable (no Sets, Maps, class instances)
    const json = JSON.stringify(result.gameState);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.decks).toBeDefined();
    expect(parsed.hands).toBeDefined();
    expect(parsed.boards).toBeDefined();
    expect(parsed.scores).toBeDefined();
    expect(parsed.achievements).toBeDefined();
  });

  it("returns structured game log", () => {
    const packets = transferPair(
      1,
      { type: "0" },
      { name: "Metalworking", age: 1, location_from: "deck", location_to: "hand", owner_from: "", owner_to: "1", meld_keyword: false },
    );

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
    );
    const result = runPipeline(rawData, cardDb, "12345");

    expect(result.gameLog.log.length).toBe(1);
    const entry = result.gameLog.log[0];
    expect(entry.type).toBe("transfer");
    if (entry.type === "transfer") {
      expect(entry.cardName).toBe("Metalworking");
      expect(entry.source).toBe("deck");
      expect(entry.dest).toBe("hand");
    }
  });

  it("handles unknown cards (grouped actions) in pipeline", () => {
    // Spectator sees a transfer but player args have no name (hidden card)
    const packets: RawExtractionData["packets"] = [
      {
        move_id: 1,
        time: 1001,
        data: [{ type: "transferedCard", args: { name: null, age: 2, location_from: "deck", location_to: "hand", owner_from: "", owner_to: "2", meld_keyword: false } }],
      },
      {
        move_id: 1,
        time: 1001,
        data: [{ type: "transferedCard_spectator", args: { type: "0" } }],
      },
    ];

    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      packets,
    );
    const result = runPipeline(rawData, cardDb, "12345");

    // Bob should have 3 cards in hand (2 initial + 1 drawn)
    expect(result.gameState.hands["Bob"].length).toBe(3);
  });

  it("pipeline results contain both gameLog and gameState", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result: PipelineResults = runPipeline(rawData, cardDb, "12345");
    expect(result).toHaveProperty("gameLog");
    expect(result).toHaveProperty("gameState");
    expect(result.gameLog).toHaveProperty("players");
    expect(result.gameLog).toHaveProperty("myHand");
    expect(result.gameLog).toHaveProperty("log");
  });
});

describe("classifyNavigation", () => {
  it("returns skip when URL matches the current table", () => {
    const result = classifyNavigation("https://boardgamearena.com/table?table=999", "999");
    expect(result).toEqual({ action: "skip" });
  });

  it("returns extract when URL is a different BGA table", () => {
    const result = classifyNavigation("https://boardgamearena.com/table?table=888", "999");
    expect(result).toEqual({ action: "extract", tableNumber: "888" });
  });

  it("returns extract when no current table is tracked", () => {
    const result = classifyNavigation("https://boardgamearena.com/table?table=555", null);
    expect(result).toEqual({ action: "extract", tableNumber: "555" });
  });

  it("returns showHelp for a non-BGA URL", () => {
    const result = classifyNavigation("https://example.com/page", "999");
    expect(result).toEqual({ action: "showHelp", url: "https://example.com/page" });
  });

  it("returns showHelp for undefined URL", () => {
    const result = classifyNavigation(undefined, "999");
    expect(result).toEqual({ action: "showHelp", url: "" });
  });

  it("returns showHelp for a BGA URL without a table parameter", () => {
    const result = classifyNavigation("https://boardgamearena.com/lobby", "999");
    expect(result).toEqual({ action: "showHelp", url: "https://boardgamearena.com/lobby" });
  });

  it("handles BGA subdomain URLs with table param", () => {
    const result = classifyNavigation("https://en.boardgamearena.com/table?table=123", null);
    expect(result).toEqual({ action: "extract", tableNumber: "123" });
  });

  it("handles table param embedded in longer query string", () => {
    const result = classifyNavigation("https://boardgamearena.com/innovation?table=456&other=1", null);
    expect(result).toEqual({ action: "extract", tableNumber: "456" });
  });
});
