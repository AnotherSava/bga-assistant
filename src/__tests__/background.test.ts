import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Store captured Chrome event listeners for testing.
const listeners: Record<string, Function> = {};

// Mock Chrome APIs before background.ts module-level code runs.
vi.hoisted(() => {
  // Mock OffscreenCanvas + createImageBitmap + fetch for icon frame preloading
  // Each getImageData call returns a unique object tagged with the frame index
  // (2 sizes per frame: 16 and 48, loaded in order frame 0-9)
  let _getImageDataCallCount = 0;
  const mockCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => {
    const frame = Math.floor(_getImageDataCallCount / 2);
    _getImageDataCallCount++;
    return { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4), _frame: frame };
  }) };
  (globalThis as any).OffscreenCanvas = vi.fn(() => ({ getContext: () => mockCtx }));
  (globalThis as any).createImageBitmap = vi.fn(() => Promise.resolve({}));
  (globalThis as any).__origFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob()) }));

  const _listeners: Record<string, Function> = {};
  (globalThis as any).__chromeMockListeners = _listeners;
  (globalThis as any).chrome = {
    action: {
      onClicked: { addListener: (cb: Function) => { _listeners.onClicked = cb; } },
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setIcon: vi.fn(),
      setTitle: vi.fn(),
    },
    scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
    sidePanel: { open: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) },
    runtime: {
      onMessage: { addListener: (cb: Function) => { _listeners.onMessage = cb; } },
      onConnect: { addListener: (cb: Function) => { _listeners.onConnect = cb; } },
      sendMessage: vi.fn(() => Promise.resolve()),
      getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
    },
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
    commands: {
      onCommand: { addListener: vi.fn() },
      getAll: vi.fn((cb: any) => cb([{ name: "toggle-sidepanel", shortcut: "" }])),
    },
    tabs: {
      onActivated: { addListener: (cb: Function) => { _listeners.onActivated = cb; } },
      onUpdated: { addListener: (cb: Function) => { _listeners.onUpdated = cb; } },
      get: vi.fn(() => Promise.resolve({})),
      query: vi.fn(() => Promise.resolve([])),
    },
    windows: {
      onFocusChanged: { addListener: (cb: Function) => { _listeners.onFocusChanged = cb; } },
      WINDOW_ID_NONE: -1,
    },
  };
});

// Copy captured listeners into module-scoped object after import
const copyListeners = () => {
  Object.assign(listeners, (globalThis as any).__chromeMockListeners);
};

import { runPipeline, classifyNavigation, shouldAutoClose, shouldShowLoading, watcherFunction, isValidPlayerCount, type PipelineResults, type NavigationAction, type PinMode } from "../background";
import { CardDatabase } from "../models/types";
import type { RawExtractionData } from "../models/types";
import { type GameState, GameEngine, createGameState, cardsAt } from "../games/innovation/game_state";

// Initialize listeners after module import so all addListener calls have fired.
copyListeners();

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDb(): CardDatabase {
  const raw = JSON.parse(readFileSync(resolve(thisDir, "../../assets/bga/innovation/card_info.json"), "utf-8"));
  return new CardDatabase(raw);
}

// Helper: simulate port connect + set side panel open (shared across describe blocks)
function connectSidePanel(): { triggerDisconnect: () => void } {
  const disconnectListeners: Function[] = [];
  const port = {
    name: "sidepanel",
    onDisconnect: { addListener: (cb: Function) => { disconnectListeners.push(cb); } },
  };
  listeners.onConnect(port);
  return {
    triggerDisconnect: () => disconnectListeners.forEach((cb) => cb()),
  };
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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");
    expect(result.gameLog).toBeDefined();
    expect(result.gameState).toBeDefined();
    expect(result.gameLog.players).toEqual({ "1": "Alice", "2": "Bob" });
    expect(result.gameLog.log).toEqual([]);
  });

  it("initializes game state with correct deck structure", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");
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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

    expect(result.gameState.scores["Alice"].length).toBe(1);
    expect(result.gameState.scores["Alice"][0].resolved).toBe("pottery");
  });

  it("returns serializable game state", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

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
    const result = runPipeline(rawData, cardDb, "12345", "innovation");

    // Bob should have 3 cards in hand (2 initial + 1 drawn)
    expect(result.gameState.hands["Bob"].length).toBe(3);
  });

  it("pipeline results contain gameName, gameLog, and gameState", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result: PipelineResults = runPipeline(rawData, cardDb, "12345", "innovation");
    expect(result.gameName).toBe("innovation");
    expect(result).toHaveProperty("gameLog");
    expect(result).toHaveProperty("gameState");
    expect(result.gameLog).toHaveProperty("players");
    expect(result.gameLog).toHaveProperty("myHand");
    expect(result.gameLog).toHaveProperty("log");
  });

  it("detects echoes expansion from myHand card names", () => {
    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      [],
      {
        my_hand: [{ id: 1 }, { id: 2 }],
        cards: { "1": { name: "Pottery" }, "2": { name: "Bangle" } },
      },
    );
    const result = runPipeline(rawData, cardDb, "12345", "innovation");
    expect(result.gameLog.expansions.echoes).toBe(true);
    // With echoes active, each player gets 1 base + 1 echoes
    const hand = result.gameState.hands["Alice"];
    expect(hand.length).toBe(2);
  });

  it("does not detect echoes when myHand has only base cards", () => {
    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      [],
      {
        my_hand: [{ id: 1 }, { id: 2 }],
        cards: { "1": { name: "Pottery" }, "2": { name: "Tools" } },
      },
    );
    const result = runPipeline(rawData, cardDb, "12345", "innovation");
    expect(result.gameLog.expansions.echoes).toBe(false);
  });

  it("detects echoes from transfers even without myHand", () => {
    const packets = transferPair(
      1,
      { type: "3" },
      { name: "Bangle", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false },
    );
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, packets);
    const result = runPipeline(rawData, cardDb, "12345", "innovation");
    expect(result.gameLog.expansions.echoes).toBe(true);
  });

  it("processes Innovation fixture data end-to-end", () => {
    const raw = JSON.parse(readFileSync(resolve(thisDir, "fixtures/innovation_sample.json"), "utf-8"));
    const result = runPipeline(raw, cardDb, "12345", "innovation");

    expect(result.gameName).toBe("innovation");
    expect(result.tableNumber).toBe("12345");

    // Alice starts with Pottery+Tools, draws Metalworking, melds it, scores Pottery
    // Hand: Tools + 1 unresolved (started with 2, drew 1, played 1, scored 1 => 1 resolved + 1 unresolved? No:
    // Start: [Pottery, Tools] -> draw Metalworking -> [Pottery, Tools, Metalworking]
    // Meld Metalworking -> board: [Metalworking], hand: [Pottery, Tools]
    // Score Pottery -> score: [Pottery], hand: [Tools]
    expect(result.gameState.hands["Alice"].length).toBe(1);
    expect(result.gameState.boards["Alice"].length).toBe(1);
    expect(result.gameState.boards["Alice"][0].resolved).toBe("metalworking");
    expect(result.gameState.scores["Alice"].length).toBe(1);
    expect(result.gameState.scores["Alice"][0].resolved).toBe("pottery");

    // Game log should have 3 transfer entries
    expect(result.gameLog.log.length).toBe(3);
  });

  it("throws for unsupported game name", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    expect(() => runPipeline(rawData, cardDb, "12345", "unknowngame" as any)).toThrow("Pipeline not implemented for game: unknowngame");
  });
});

describe("runPipeline (azul)", () => {
  const cardDb = loadCardDb();

  it("processes empty Azul extraction data", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob", "3": "Carol" }, []);
    const result = runPipeline(rawData, cardDb, "99999", "azul");
    expect(result.gameName).toBe("azul");
    expect(result.tableNumber).toBe("99999");
    expect(result.gameState.bag).toEqual([0, 20, 20, 20, 20, 20]);
    expect(result.gameState.discard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.gameState.wall).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.gameState.refillRounds).toEqual([]);
  });

  it("processes Azul fixture data end-to-end", () => {
    const raw = JSON.parse(readFileSync(resolve(thisDir, "fixtures/azul_sample.json"), "utf-8"));
    const result = runPipeline(raw, cardDb, "816402832", "azul");

    expect(result.gameName).toBe("azul");
    expect(result.tableNumber).toBe("816402832");

    const { bag, discard, wall } = result.gameState;

    // Factory fill drew 28 tiles (7 factories x 4): 7 black, 5 cyan, 5 blue, 5 yellow, 6 red
    // Wall placed: 1 black + 1 yellow = 2 on wall
    // Wall discard: 1 black discarded from placement
    // Floor clear: 1 blue (player 1) + 1 red (player 3) discarded
    // Total removed from bag: 28; wall: 2; discard: 1+1+1 = 3
    // bag should be 100 - 28 = 72 remaining after fill
    expect(bag[1] + bag[2] + bag[3] + bag[4] + bag[5]).toBe(72);
    // Discard: 1 black (wall discard) + 1 blue (floor) + 1 red (floor) = 3
    expect(discard[1] + discard[2] + discard[3] + discard[4] + discard[5]).toBe(3);
    // Wall: 1 black + 1 yellow = 2
    expect(wall[1] + wall[2] + wall[3] + wall[4] + wall[5]).toBe(2);

    expect(result.gameLog.players).toBeDefined();
    expect(result.gameLog.log.length).toBe(3);
  });

  it("Azul pipeline result is JSON-serializable", () => {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    const result = runPipeline(rawData, cardDb, "12345", "azul");
    const json = JSON.stringify(result);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.gameName).toBe("azul");
    expect(parsed.gameState.bag).toEqual([0, 20, 20, 20, 20, 20]);
  });
});

describe("cardsAt fail-fast", () => {
  const cardDb = loadCardDb();

  function makeState(): { state: GameState; engine: GameEngine } {
    const engine = new GameEngine(cardDb);
    const state = createGameState(["Alice", "Bob"], "Alice");
    return { state, engine };
  }

  it("throws when player zone is called with null player", () => {
    const { state, engine } = makeState();
    engine.initGame(state);
    expect(() => cardsAt(state, "hand", null)).toThrow('cardsAt("hand") requires a player');
    expect(() => cardsAt(state, "board", null)).toThrow('cardsAt("board") requires a player');
    expect(() => cardsAt(state, "score", null)).toThrow('cardsAt("score") requires a player');
    expect(() => cardsAt(state, "revealed", null)).toThrow('cardsAt("revealed") requires a player');
    expect(() => cardsAt(state, "forecast", null)).toThrow('cardsAt("forecast") requires a player');
  });

  it("throws when player zone is called with unknown player", () => {
    const { state, engine } = makeState();
    engine.initGame(state);
    expect(() => cardsAt(state, "hand", "Unknown")).toThrow('Player "Unknown" not found in hand zone');
  });

  it("throws when deck zone is called without groupKey", () => {
    const { state, engine } = makeState();
    engine.initGame(state);
    expect(() => cardsAt(state, "deck", null)).toThrow('cardsAt("deck") requires a groupKey');
  });

  it("returns cards for valid zone+player", () => {
    const { state, engine } = makeState();
    engine.initGame(state);
    expect(cardsAt(state, "hand", "Alice").length).toBe(2);
    expect(cardsAt(state, "board", "Alice").length).toBe(0);
  });
});

describe("classifyNavigation", () => {
  it("returns extract for a supported game table", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=555");
    expect(result).toEqual({ action: "extract", tableNumber: "555", gameName: "innovation" });
  });

  it("returns extract for same-table navigation (no skip)", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=999");
    expect(result).toEqual({ action: "extract", tableNumber: "999", gameName: "innovation" });
  });

  it("returns showHelp for a non-BGA URL", () => {
    const result = classifyNavigation("https://example.com/page");
    expect(result).toEqual({ action: "showHelp", url: "https://example.com/page" });
  });

  it("returns showHelp for undefined URL", () => {
    const result = classifyNavigation(undefined);
    expect(result).toEqual({ action: "showHelp", url: "" });
  });

  it("returns showHelp for a BGA URL without a table parameter", () => {
    const result = classifyNavigation("https://boardgamearena.com/lobby");
    expect(result).toEqual({ action: "showHelp", url: "https://boardgamearena.com/lobby" });
  });

  it("returns unsupportedGame for an unsupported game with table param", () => {
    const result = classifyNavigation("https://boardgamearena.com/1/thecrewdeepsea?table=123");
    expect(result).toEqual({ action: "unsupportedGame", tableNumber: "123", gameName: "thecrewdeepsea" });
  });

  it("handles BGA subdomain URLs with table param", () => {
    const result = classifyNavigation("https://en.boardgamearena.com/8/innovation?table=123");
    expect(result).toEqual({ action: "extract", tableNumber: "123", gameName: "innovation" });
  });

  it("handles table param embedded in longer query string", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=456&other=1");
    expect(result).toEqual({ action: "extract", tableNumber: "456", gameName: "innovation" });
  });

  it("returns extract for an azul table URL", () => {
    const result = classifyNavigation("https://boardgamearena.com/1/azul?table=789");
    expect(result).toEqual({ action: "extract", tableNumber: "789", gameName: "azul" });
  });
});

describe("shouldShowLoading", () => {
  it("returns true for click and navigation sources", () => {
    expect(shouldShowLoading("click")).toBe(true);
    expect(shouldShowLoading("navigation")).toBe(true);
  });

  it("returns false for reconnect and live sources", () => {
    expect(shouldShowLoading("reconnect")).toBe(false);
    expect(shouldShowLoading("live")).toBe(false);
  });
});

describe("shouldAutoClose", () => {
  it("returns false for pinned mode regardless of URL", () => {
    expect(shouldAutoClose("https://example.com", "pinned")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/lobby", "pinned")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/8/innovation?table=123", "pinned")).toBe(false);
    expect(shouldAutoClose(undefined, "pinned")).toBe(false);
  });

  it("returns true for autohide-bga mode on non-BGA URLs", () => {
    expect(shouldAutoClose("https://example.com", "autohide-bga")).toBe(true);
    expect(shouldAutoClose("https://google.com/search?q=bga", "autohide-bga")).toBe(true);
    expect(shouldAutoClose(undefined, "autohide-bga")).toBe(true);
  });

  it("returns false for autohide-bga mode on BGA URLs", () => {
    expect(shouldAutoClose("https://boardgamearena.com/lobby", "autohide-bga")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/8/innovation?table=123", "autohide-bga")).toBe(false);
    expect(shouldAutoClose("https://en.boardgamearena.com/8/innovation?table=123", "autohide-bga")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/1/thecrewdeepsea?table=123", "autohide-bga")).toBe(false);
  });

  it("returns true for autohide-game mode on unsupported game tables and non-BGA URLs", () => {
    expect(shouldAutoClose("https://example.com", "autohide-game")).toBe(true);
    expect(shouldAutoClose("https://boardgamearena.com/1/thecrewdeepsea?table=123", "autohide-game")).toBe(true);
    expect(shouldAutoClose(undefined, "autohide-game")).toBe(true);
  });

  it("returns false for autohide-game mode on non-table BGA pages", () => {
    expect(shouldAutoClose("https://boardgamearena.com/lobby", "autohide-game")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/player?id=123", "autohide-game")).toBe(false);
  });

  it("returns false for autohide-game mode on supported game URLs", () => {
    expect(shouldAutoClose("https://boardgamearena.com/8/innovation?table=123", "autohide-game")).toBe(false);
    expect(shouldAutoClose("https://en.boardgamearena.com/8/innovation?table=456", "autohide-game")).toBe(false);
    expect(shouldAutoClose("https://boardgamearena.com/1/azul?table=789", "autohide-game")).toBe(false);
  });
});

describe("isValidPlayerCount", () => {
  it("innovation requires exactly 2 players", () => {
    expect(isValidPlayerCount("innovation", 0)).toBe(false);
    expect(isValidPlayerCount("innovation", 1)).toBe(false);
    expect(isValidPlayerCount("innovation", 2)).toBe(true);
    expect(isValidPlayerCount("innovation", 3)).toBe(false);
    expect(isValidPlayerCount("innovation", 4)).toBe(false);
  });

  it("azul accepts 2-4 players", () => {
    expect(isValidPlayerCount("azul", 0)).toBe(false);
    expect(isValidPlayerCount("azul", 1)).toBe(false);
    expect(isValidPlayerCount("azul", 2)).toBe(true);
    expect(isValidPlayerCount("azul", 3)).toBe(true);
    expect(isValidPlayerCount("azul", 4)).toBe(true);
    expect(isValidPlayerCount("azul", 5)).toBe(false);
  });
});

describe("pin mode message handlers", () => {
  const mockStorageSet = chrome.storage.local.set as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset pin mode to default
    listeners.onMessage({ type: "setPinMode", mode: "pinned" }, {}, () => {});
    vi.clearAllMocks();
  });

  it("getPinMode returns pinned by default", () => {
    const sendResponse = vi.fn();
    listeners.onMessage({ type: "getPinMode" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith("pinned");
  });

  it("setPinMode updates mode and persists to storage", () => {
    const sendResponse = vi.fn();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(true);
    expect(mockStorageSet).toHaveBeenCalledWith({ pinMode: "autohide-bga" });
  });

  it("getPinMode returns updated mode after setPinMode", () => {
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    const sendResponse = vi.fn();
    listeners.onMessage({ type: "getPinMode" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith("autohide-game");
  });
});

describe("toggle panel on action click", () => {
  const mockSidePanelClose = chrome.sidePanel.close as ReturnType<typeof vi.fn>;
  const mockSidePanelOpen = chrome.sidePanel.open as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    vi.clearAllMocks();
  });

  it("closes panel when sidePanelOpen is true", async () => {
    const { triggerDisconnect } = connectSidePanel();
    const tab = { id: 1, windowId: 10, url: "https://example.com" };
    (chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(tab);
    await listeners.onClicked(tab);
    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    expect(mockSidePanelOpen).not.toHaveBeenCalled();
    triggerDisconnect();
  });

  it("opens panel when sidePanelOpen is false", async () => {
    const tab = { id: 1, windowId: 10, url: "https://example.com" };
    (chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(tab);
    await listeners.onClicked(tab);
    expect(mockSidePanelOpen).toHaveBeenCalled();
    expect(mockSidePanelClose).not.toHaveBeenCalled();
  });
});

describe("watcherFunction", () => {
  it("is exported and can be serialized by executeScript", () => {
    expect(typeof watcherFunction).toBe("function");
    expect(watcherFunction.name).toBe("watcherFunction");
  });
});

describe("live tracking", () => {
  const mockExecuteScript = chrome.scripting.executeScript as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  const cardDb = loadCardDb();

  // Helper: trigger a click on a BGA game tab to set up live tracking.
  // Simulates Chrome's real behavior: sidePanel.open triggers panel connection.
  async function clickExtract(tabId: number): Promise<{ triggerDisconnect: () => void }> {
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);
    let conn!: ReturnType<typeof connectSidePanel>;
    (chrome.sidePanel.open as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      conn = connectSidePanel();
      return Promise.resolve();
    });
    const tab = { id: tabId, url: "https://boardgamearena.com/8/innovation?table=123", windowId: 1 };
    (chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(tab);
    await listeners.onClicked(tab);
    return conn;
  }

  beforeEach(async () => {
    // Flush any pending async operations (e.g. gameLogChanged fire-and-forget chains)
    await new Promise((r) => setTimeout(r, 50));
    // Reset sidePanelOpen by connecting and immediately disconnecting a port
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
  });

  it("injects watcher after successful extraction", async () => {
    await clickExtract(42);

    // executeScript called twice: once for extract.js, once for watcher
    expect(mockExecuteScript).toHaveBeenCalledTimes(2);
    const watcherCall = mockExecuteScript.mock.calls[1];
    expect(watcherCall[0]).toMatchObject({
      target: { tabId: 42 },
      func: watcherFunction,
    });
  });

  it("sends liveStatus active after watcher injection", async () => {
    await clickExtract(42);

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "liveStatus", active: true }),
    );
  });

  it("gameLogChanged triggers extraction from the live tab", async () => {
    await clickExtract(42);
    vi.clearAllMocks();

    // Set up next extraction
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, [
      { move_id: 1, time: 1001, data: [{ type: "transferedCard_spectator", args: { type: "0" } }] },
    ]);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);

    // Simulate enough time passing
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10000);

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // Wait for async extraction and full promise chain
    await vi.waitFor(() => {
      expect(mockExecuteScript).toHaveBeenCalled();
    });
    // Flush .then/.finally handlers
    await new Promise((r) => setTimeout(r, 50));

    vi.restoreAllMocks();
  });

  it("gameLogChanged skipped when extracting", async () => {
    await clickExtract(42);

    // Now start a second extraction via gameLogChanged that won't resolve yet
    let resolveExtraction!: Function;
    mockExecuteScript.mockReturnValueOnce(new Promise((r) => { resolveExtraction = () => r([{ result: makeRawData({ "1": "Alice", "2": "Bob" }, []) }]); }));

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10000);

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // extracting is now true; a second gameLogChanged should be ignored
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20000);
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});
    expect(mockExecuteScript).not.toHaveBeenCalled();

    // Clean up
    vi.restoreAllMocks();
    resolveExtraction();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("gameLogChanged within minimum interval schedules deferred extraction", async () => {
    await clickExtract(42);
    vi.clearAllMocks();

    // Don't advance time — lastExtractionTime was just set
    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // No immediate extraction should have been triggered
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("packet-count guard skips resultsReady when count unchanged", async () => {
    await clickExtract(42);

    // Wait for extraction to fully complete
    await new Promise((r) => setTimeout(r, 50));
    vi.clearAllMocks();

    // Return same data (0 packets, same as initial extraction)
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10000);

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // Wait for full extraction chain to complete
    await new Promise((r) => setTimeout(r, 50));

    // The extraction should have run (executeScript called for extract.js + watcher)
    expect(mockExecuteScript).toHaveBeenCalled();

    // resultsReady should NOT be sent since packet count is the same
    const resultsReadyCalls = mockSendMessage.mock.calls.filter(
      (call: any[]) => call[0]?.type === "resultsReady",
    );
    expect(resultsReadyCalls.length).toBe(0);

    vi.restoreAllMocks();
  });

  it("gameLogChanged from wrong tab is ignored", async () => {
    await clickExtract(42);
    vi.clearAllMocks();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10000);

    // Message from a different tab
    const sender = { tab: { id: 99 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    expect(mockExecuteScript).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("deferred extraction fires after remaining rate limit window", async () => {
    await clickExtract(42);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate 3s elapsed since last extraction
    const baseTime = Date.now();
    vi.useFakeTimers({ now: baseTime + 3000 });
    vi.clearAllMocks();

    // Set up extraction mock for when deferred timer fires
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, [
      { move_id: 1, time: 1001, data: [{ type: "transferedCard_spectator", args: { type: "0" } }] },
    ]);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // No immediate extraction
    expect(mockExecuteScript).not.toHaveBeenCalled();

    // Advance past the remaining 2s window
    await vi.advanceTimersByTimeAsync(2100);

    // Deferred extraction should have fired
    expect(mockExecuteScript).toHaveBeenCalled();

    // Flush async extraction chain
    await vi.advanceTimersByTimeAsync(100);

    vi.useRealTimers();
  });

  it("deferred timer cleared when new extraction starts", async () => {
    await clickExtract(42);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate 3s elapsed — triggers deferred timer
    const baseTime = Date.now();
    vi.useFakeTimers({ now: baseTime + 3000 });
    vi.clearAllMocks();

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});
    expect(mockExecuteScript).not.toHaveBeenCalled();

    // Now jump past 5s and trigger a normal extraction before the deferred fires
    vi.setSystemTime(baseTime + 6000);

    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, [
      { move_id: 1, time: 1001, data: [{ type: "transferedCard_spectator", args: { type: "0" } }] },
    ]);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);

    // This should trigger immediately (past the interval) and clear the deferred timer
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});
    expect(mockExecuteScript).toHaveBeenCalledTimes(1);

    // Flush extraction chain
    await vi.advanceTimersByTimeAsync(100);

    // The original deferred timer would have fired around 2s from the first message
    // but it should have been cleared. No additional extraction should happen.
    vi.clearAllMocks();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockExecuteScript).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deferred timer cleared on panel disconnect", async () => {
    const { triggerDisconnect } = await clickExtract(42);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate 3s elapsed — triggers deferred timer
    const baseTime = Date.now();
    vi.useFakeTimers({ now: baseTime + 3000 });
    vi.clearAllMocks();

    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});
    expect(mockExecuteScript).not.toHaveBeenCalled();

    // Disconnect panel — should stop live tracking and clear the deferred timer
    triggerDisconnect();

    // Advance past the remaining window
    mockExecuteScript.mockResolvedValueOnce([{ result: makeRawData({ "1": "Alice", "2": "Bob" }, []) }]);
    await vi.advanceTimersByTimeAsync(3000);

    // No extraction should have fired
    expect(mockExecuteScript).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("stopLiveTracking on panel disconnect", async () => {
    const { triggerDisconnect } = await clickExtract(42);
    vi.clearAllMocks();

    triggerDisconnect();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "liveStatus", active: false }),
    );
  });
});

describe("auto-close in handleNavigation", () => {
  const mockSidePanelClose = chrome.sidePanel.close as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  const mockTabsGet = chrome.tabs.get as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    // Reset panel state
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    // Reset pin mode to pinned
    listeners.onMessage({ type: "setPinMode", mode: "pinned" }, {}, () => {});
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
  });

  it("auto-closes panel in autohide-bga mode on non-BGA tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to non-BGA page (two mocks: icon update + handleNavigation)
    const tab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    conn.triggerDisconnect();
  });

  it("does not auto-close in autohide-bga mode on BGA tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to BGA page (two mocks: icon update + handleNavigation)
    const tab = { id: 1, url: "https://boardgamearena.com/lobby", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("does not auto-close in autohide-game mode on non-game BGA tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to BGA lobby (two mocks: icon update + handleNavigation)
    const tab = { id: 1, url: "https://boardgamearena.com/lobby", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("does not auto-close in autohide-game mode on supported game tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to a supported game
    const rawData = { players: { "1": "Alice", "2": "Bob" }, packets: [] };
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ result: rawData }]);
    // Two mocks: icon update + handleNavigation
    const tab = { id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("does not auto-close in pinned mode regardless of URL", async () => {
    const conn = connectSidePanel();
    // pinMode is already "pinned" from beforeEach
    vi.clearAllMocks();

    // Two mocks: icon update + handleNavigation
    const tab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("auto-closes on same-tab navigation via onUpdated", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, () => {});

    // Set active tab
    listeners.onActivated({ tabId: 5 });
    await new Promise((r) => setTimeout(r, 50));
    vi.clearAllMocks();

    // Same tab navigates to non-BGA page (two mocks: icon update + handleNavigation)
    const tab = { id: 5, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onUpdated(5, { status: "complete" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    conn.triggerDisconnect();
  });
});

describe("unified extraction flow", () => {
  const mockExecuteScript = chrome.scripting.executeScript as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  const mockTabsGet = chrome.tabs.get as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    // Reset panel state
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    // Reset pin mode to pinned so shouldAutoClose doesn't interfere
    listeners.onMessage({ type: "setPinMode", mode: "pinned" }, {}, () => {});
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
  });

  it("unsupported game sends resultsReady with rawData-only results", async () => {
    const conn = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);
    const tab = { id: 1, url: "https://boardgamearena.com/1/thecrewdeepsea?table=123", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    // Should send resultsReady (not notAGame) for unsupported games
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(1);
    const notAGameCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "notAGame");
    expect(notAGameCalls.length).toBe(0);

    conn.triggerDisconnect();
  });

  it("unsupported game resultsReady includes PipelineResults with null gameLog/gameState", async () => {
    const conn = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);
    const tab = { id: 1, url: "https://boardgamearena.com/1/thecrewdeepsea?table=123", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    // Verify resultsReady message includes the rawData-only result
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(1);
    const result = resultsCalls[0][0].results as PipelineResults;
    expect(result).not.toBeNull();
    expect(result.gameName).toBe("thecrewdeepsea");
    expect(result.tableNumber).toBe("123");
    expect(result.rawData).toEqual(rawData);
    expect(result.gameLog).toBeNull();
    expect(result.gameState).toBeNull();

    conn.triggerDisconnect();
  });

  it("non-BGA page sends notAGame (not resultsReady)", async () => {
    const conn = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const tab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    const notAGameCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "notAGame");
    expect(notAGameCalls.length).toBe(1);
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(0);

    conn.triggerDisconnect();
  });

  it("BGA lobby (no table param) sends notAGame", async () => {
    const conn = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const tab = { id: 1, url: "https://boardgamearena.com/lobby", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    const notAGameCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "notAGame");
    expect(notAGameCalls.length).toBe(1);

    conn.triggerDisconnect();
  });

  it("supported game sends resultsReady with full pipeline results in payload", async () => {
    const conn = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    // First executeScript call is updateIcon's probe, second is the extraction
    mockExecuteScript
      .mockResolvedValueOnce([{ result: 2 }])
      .mockResolvedValueOnce([{ result: rawData }]);
    const tab = { id: 1, url: "https://boardgamearena.com/8/innovation?table=456", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    // Verify resultsReady message includes full pipeline results
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(1);
    const result = resultsCalls[0][0].results as PipelineResults;
    expect(result).not.toBeNull();
    expect(result.gameName).toBe("innovation");
    expect(result.gameLog).not.toBeNull();
    expect(result.gameState).not.toBeNull();

    conn.triggerDisconnect();
  });
});

describe("onConnect pushes cached results", () => {
  const mockExecuteScript = chrome.scripting.executeScript as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  const mockTabsGet = chrome.tabs.get as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    // Reset panel state
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    // Reset pin mode to pinned so shouldAutoClose doesn't interfere
    listeners.onMessage({ type: "setPinMode", mode: "pinned" }, {}, () => {});
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
  });

  it("sends resultsReady with results on connect when lastResults is cached", async () => {
    // First, populate lastResults by navigating to a supported game
    const conn1 = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    // probe + extraction
    mockExecuteScript
      .mockResolvedValueOnce([{ result: 2 }])
      .mockResolvedValueOnce([{ result: rawData }]);
    const tab = { id: 1, url: "https://boardgamearena.com/8/innovation?table=789", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    conn1.triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    // Now reconnect — should push resultsReady with results payload
    const conn2 = connectSidePanel();
    await new Promise((r) => setTimeout(r, 50));

    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(1);
    const result = resultsCalls[0][0].results as PipelineResults;
    expect(result).not.toBeNull();
    expect(result.gameName).toBe("innovation");
    expect(result.tableNumber).toBe("789");

    conn2.triggerDisconnect();
  });

  it("does not send resultsReady on connect when lastResults is null and no active tab", async () => {
    // Navigate to non-BGA page to clear lastResults
    const conn1 = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const tab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(tab).mockResolvedValueOnce(tab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    conn1.triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    // tabs.query returns [] (default) — no active tab found
    const conn2 = connectSidePanel();
    await new Promise((r) => setTimeout(r, 50));

    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(0);

    conn2.triggerDisconnect();
  });

  it("re-extracts on reconnect when lastResults is null and active tab is a game", async () => {
    const mockTabsQuery = chrome.tabs.query as ReturnType<typeof vi.fn>;

    // Navigate to non-BGA page to clear lastResults
    const conn1 = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const nonGameTab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(nonGameTab).mockResolvedValueOnce(nonGameTab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    conn1.triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    // Simulate service worker restart: lastResults is null, but user is now on a game tab
    const gameTab = { id: 2, url: "https://boardgamearena.com/8/innovation?table=555", status: "complete", windowId: 10 };
    mockTabsQuery.mockResolvedValueOnce([gameTab]);
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, []);
    mockExecuteScript.mockResolvedValueOnce([{ result: rawData }]);

    const conn2 = connectSidePanel();
    await new Promise((r) => setTimeout(r, 100));

    // Should have triggered extraction and pushed results
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBeGreaterThanOrEqual(1);
    const result = resultsCalls[resultsCalls.length - 1][0].results as PipelineResults;
    expect(result).not.toBeNull();
    expect(result.gameName).toBe("innovation");
    expect(result.tableNumber).toBe("555");

    conn2.triggerDisconnect();
  });

  it("sends notAGame on reconnect when lastResults is null and active tab is not a game", async () => {
    const mockTabsQuery = chrome.tabs.query as ReturnType<typeof vi.fn>;

    // Navigate to non-BGA page to clear lastResults
    const conn1 = connectSidePanel();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    const nonGameTab = { id: 1, url: "https://example.com", status: "complete", windowId: 10 };
    mockTabsGet.mockResolvedValueOnce(nonGameTab).mockResolvedValueOnce(nonGameTab);
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    conn1.triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());

    // Simulate reconnect with non-game active tab
    mockTabsQuery.mockResolvedValueOnce([nonGameTab]);

    const conn2 = connectSidePanel();
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have sent resultsReady
    const resultsCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "resultsReady");
    expect(resultsCalls.length).toBe(0);

    // Should have sent notAGame
    const notAGameCalls = mockSendMessage.mock.calls.filter((c: any[]) => c[0]?.type === "notAGame");
    expect(notAGameCalls.length).toBe(1);

    conn2.triggerDisconnect();
  });
});

describe("icon swap behavior", () => {
  const mockSetIcon = chrome.action.setIcon as ReturnType<typeof vi.fn>;
  const mockTabsGet = chrome.tabs.get as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  const mockExecuteScript = chrome.scripting.executeScript as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(50);
    // Reset panel state
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
    // Probe returns 2 for game tabs (2-player game detected)
    mockExecuteScript.mockResolvedValue([{ result: 2 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush microtasks and advance fake timers past the flash sequence. */
  async function flushFlash(): Promise<void> {
    await vi.advanceTimersByTimeAsync(2500);
  }

  /** Check that the last setIcon call used frame 9 (lit). */
  function expectLastIconLit(): void {
    expect(mockSetIcon).toHaveBeenCalled();
    const calls = mockSetIcon.mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last).toHaveProperty("imageData");
    expect(last).not.toHaveProperty("tabId");
    expect((last.imageData as any)["16"]._frame).toBe(9);
  }

  /** Check that the last setIcon call used frame 0 (normal/dark). */
  function expectLastIconNormal(): void {
    expect(mockSetIcon).toHaveBeenCalled();
    const calls = mockSetIcon.mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last).toHaveProperty("imageData");
    expect(last).not.toHaveProperty("tabId");
    expect((last.imageData as any)["16"]._frame).toBe(0);
  }

  it("sets lit icon when switching to game tab", async () => {
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await flushFlash();

    expectLastIconLit();
  });

  it("sets normal icon when switching to non-game tab", async () => {
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://example.com", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await flushFlash();

    expectLastIconNormal();
  });

  it("sets lit icon on game tab regardless of pin mode", async () => {
    // pinMode is "pinned" (default)
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await flushFlash();

    expectLastIconLit();
  });

  it("sets normal icon on game URL when probe returns invalid player count", async () => {
    mockExecuteScript.mockResolvedValueOnce([{ result: 3 }]);
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await flushFlash();

    expectLastIconNormal();
  });

  it("keeps lit icon when panel opens on game tab", async () => {
    // Set active tab to a game page
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await flushFlash();
    vi.clearAllMocks();

    // Panel opens — icon should not change
    const conn = connectSidePanel();
    expect(mockSetIcon).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("keeps lit icon after toggle-close on a game page (global icon already lit)", async () => {
    const conn = connectSidePanel();
    const tab = { id: 1, windowId: 10, url: "https://boardgamearena.com/8/innovation?table=123" };
    mockTabsGet.mockReset().mockResolvedValue(tab);
    vi.clearAllMocks();

    // Toggle close on a game page — global icon already at frame 9, no setIcon needed
    await listeners.onClicked(tab);
    await flushFlash();

    expect(mockSetIcon).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("sets normal icon after toggle-close on a non-game page", async () => {
    const conn = connectSidePanel();
    const tab = { id: 1, windowId: 10, url: "https://example.com" };
    mockTabsGet.mockReset().mockResolvedValue(tab);
    vi.clearAllMocks();

    // Toggle close on a non-game page
    await listeners.onClicked(tab);
    await flushFlash();

    expectLastIconNormal();
    conn.triggerDisconnect();
  });

  it("sets lit icon on same-tab navigation to game page", async () => {
    vi.clearAllMocks();
    // Queue two sequential responses: first for onActivated, second for onUpdated
    mockTabsGet.mockResolvedValueOnce({ id: 5, url: "https://example.com", status: "complete" });
    mockTabsGet.mockResolvedValueOnce({ id: 5, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });

    // Set active tab (consumes first mock)
    listeners.onActivated({ tabId: 5 });
    await flushFlash();

    // Page finishes loading on a game URL (consumes second mock)
    listeners.onUpdated(5, { status: "complete" });
    await flushFlash();

    expectLastIconLit();
  });
});
