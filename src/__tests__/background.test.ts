import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Store captured Chrome event listeners for testing.
const listeners: Record<string, Function> = {};

// Mock Chrome APIs before background.ts module-level code runs.
vi.hoisted(() => {
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
      query: () => Promise.resolve([]),
    },
  };
});

// Copy captured listeners into module-scoped object after import
const copyListeners = () => {
  Object.assign(listeners, (globalThis as any).__chromeMockListeners);
};

import { runPipeline, classifyNavigation, shouldAutoClose, watcherFunction, type PipelineResults, type NavigationAction, type PinMode } from "../background";
import { CardDatabase } from "../models/types";
import type { RawExtractionData } from "../engine/process_log";

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

  it("detects echoes expansion from myHand card names", () => {
    const rawData = makeRawData(
      { "1": "Alice", "2": "Bob" },
      [],
      {
        my_hand: [{ id: 1 }, { id: 2 }],
        cards: { "1": { name: "Pottery" }, "2": { name: "Bangle" } },
      },
    );
    const result = runPipeline(rawData, cardDb, "12345");
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
    const result = runPipeline(rawData, cardDb, "12345");
    expect(result.gameLog.expansions.echoes).toBe(false);
  });

  it("detects echoes from transfers even without myHand", () => {
    const packets = transferPair(
      1,
      { type: "3" },
      { name: "Bangle", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false },
    );
    const rawData = makeRawData({ "1": "Alice", "2": "Bob" }, packets);
    const result = runPipeline(rawData, cardDb, "12345");
    expect(result.gameLog.expansions.echoes).toBe(true);
  });
});

describe("classifyNavigation", () => {
  it("returns skip when URL matches the current table", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=999", "999");
    expect(result).toEqual({ action: "skip" });
  });

  it("returns extract when URL is a different BGA table", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=888", "999");
    expect(result).toEqual({ action: "extract", tableNumber: "888" });
  });

  it("returns extract when no current table is tracked", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=555", null);
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

  it("returns showHelp for an unsupported game", () => {
    const result = classifyNavigation("https://boardgamearena.com/1/thecrewdeepsea?table=123", null);
    expect(result).toEqual({ action: "showHelp", url: "https://boardgamearena.com/1/thecrewdeepsea?table=123" });
  });

  it("handles BGA subdomain URLs with table param", () => {
    const result = classifyNavigation("https://en.boardgamearena.com/8/innovation?table=123", null);
    expect(result).toEqual({ action: "extract", tableNumber: "123" });
  });

  it("handles table param embedded in longer query string", () => {
    const result = classifyNavigation("https://boardgamearena.com/8/innovation?table=456&other=1", null);
    expect(result).toEqual({ action: "extract", tableNumber: "456" });
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

  it("returns true for autohide-game mode on non-game URLs", () => {
    expect(shouldAutoClose("https://example.com", "autohide-game")).toBe(true);
    expect(shouldAutoClose("https://boardgamearena.com/lobby", "autohide-game")).toBe(true);
    expect(shouldAutoClose("https://boardgamearena.com/1/thecrewdeepsea?table=123", "autohide-game")).toBe(true);
    expect(shouldAutoClose(undefined, "autohide-game")).toBe(true);
  });

  it("returns false for autohide-game mode on supported game URLs", () => {
    expect(shouldAutoClose("https://boardgamearena.com/8/innovation?table=123", "autohide-game")).toBe(false);
    expect(shouldAutoClose("https://en.boardgamearena.com/8/innovation?table=456", "autohide-game")).toBe(false);
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

  it("gameLogChanged skipped within minimum interval", async () => {
    await clickExtract(42);
    vi.clearAllMocks();

    // Don't advance time — lastExtractionTime was just set
    const sender = { tab: { id: 42 } };
    listeners.onMessage({ type: "gameLogChanged" }, sender, () => {});

    // No extraction should have been triggered
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
  const mockSetIcon = chrome.action.setIcon as ReturnType<typeof vi.fn>;

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

    // Navigate to non-BGA page
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://example.com", status: "complete", windowId: 10 });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    conn.triggerDisconnect();
  });

  it("does not auto-close in autohide-bga mode on BGA tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to BGA page (non-game, but still BGA domain)
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/lobby", status: "complete", windowId: 10 });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("auto-closes panel in autohide-game mode on non-game BGA tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to BGA lobby (not a game table)
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/lobby", status: "complete", windowId: 10 });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    conn.triggerDisconnect();
  });

  it("does not auto-close in autohide-game mode on supported game tab", async () => {
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Navigate to a supported game
    const rawData = { players: { "1": "Alice", "2": "Bob" }, packets: [] };
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ result: rawData }]);
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete", windowId: 10 });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).not.toHaveBeenCalled();
    conn.triggerDisconnect();
  });

  it("does not auto-close in pinned mode regardless of URL", async () => {
    const conn = connectSidePanel();
    // pinMode is already "pinned" from beforeEach
    vi.clearAllMocks();

    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://example.com", status: "complete", windowId: 10 });
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

    // Same tab navigates to non-BGA page
    mockTabsGet.mockResolvedValueOnce({ id: 5, url: "https://example.com", status: "complete", windowId: 10 });
    listeners.onUpdated(5, { status: "complete" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSidePanelClose).toHaveBeenCalledWith({ windowId: 10 });
    conn.triggerDisconnect();
  });
});

describe("icon swap behavior", () => {
  const mockSetIcon = chrome.action.setIcon as ReturnType<typeof vi.fn>;
  const mockTabsGet = chrome.tabs.get as ReturnType<typeof vi.fn>;
  const mockSendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

  const ICON_NORMAL = { "16": "assets/extension/icon-16.png", "48": "assets/extension/icon-48.png", "128": "assets/extension/icon-128.png" };
  const ICON_LIT = { "16": "assets/extension/icon-16-lit.png", "48": "assets/extension/icon-48-lit.png", "128": "assets/extension/icon-128-lit.png" };

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    // Reset panel state
    const { triggerDisconnect } = connectSidePanel();
    triggerDisconnect();
    // Reset pin mode
    listeners.onMessage({ type: "setPinMode", mode: "pinned" }, {}, () => {});
    vi.clearAllMocks();
    mockSendMessage.mockImplementation(() => Promise.resolve());
  });

  it("sets lit icon when switching to game tab with panel closed and auto-hide active", async () => {
    // Panel is closed (from beforeEach), set autohide mode
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Switch to a game tab
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 1, path: ICON_LIT });
  });

  it("sets normal icon when switching to non-game tab with panel closed and auto-hide active", async () => {
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    vi.clearAllMocks();

    // Switch to a non-game tab
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://example.com", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 1, path: ICON_NORMAL });
  });

  it("does not update icon when switching tabs in pinned mode", async () => {
    // pinMode is already "pinned"
    vi.clearAllMocks();

    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));

    // setIcon should not be called because updateIcon returns early for pinned mode
    expect(mockSetIcon).not.toHaveBeenCalled();
  });

  it("resets icon to normal when panel opens", async () => {
    // Set auto-hide mode first
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});

    // Set active tab to a game page (sets lit icon)
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });
    listeners.onActivated({ tabId: 1 });
    await new Promise((r) => setTimeout(r, 50));
    vi.clearAllMocks();

    // Panel opens
    const conn = connectSidePanel();

    // Icon should be reset to normal
    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 1, path: ICON_NORMAL });
    conn.triggerDisconnect();
  });

  it("sets lit icon after toggle-close on a game page with auto-hide active", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    const tab = { id: 1, windowId: 10, url: "https://boardgamearena.com/8/innovation?table=123" };
    mockTabsGet.mockReset().mockResolvedValue(tab);
    vi.clearAllMocks();

    // Toggle close on a game page
    await listeners.onClicked(tab);

    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 1, path: ICON_LIT });
    conn.triggerDisconnect();
  });

  it("sets normal icon after toggle-close on a non-game page with auto-hide active", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const conn = connectSidePanel();
    listeners.onMessage({ type: "setPinMode", mode: "autohide-game" }, {}, () => {});
    const tab = { id: 1, windowId: 10, url: "https://example.com" };
    mockTabsGet.mockReset().mockResolvedValue(tab);
    vi.clearAllMocks();

    // Toggle close on a non-game page
    await listeners.onClicked(tab);

    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 1, path: ICON_NORMAL });
    conn.triggerDisconnect();
  });

  it("sets lit icon on same-tab navigation to game page with panel closed", async () => {
    await new Promise((r) => setTimeout(r, 50));
    listeners.onMessage({ type: "setPinMode", mode: "autohide-bga" }, {}, () => {});
    vi.clearAllMocks();
    // Queue two sequential responses: first for onActivated, second for onUpdated
    mockTabsGet.mockResolvedValueOnce({ id: 5, url: "https://example.com", status: "complete" });
    mockTabsGet.mockResolvedValueOnce({ id: 5, url: "https://boardgamearena.com/8/innovation?table=123", status: "complete" });

    // Set active tab (consumes first mock)
    listeners.onActivated({ tabId: 5 });
    await new Promise((r) => setTimeout(r, 50));

    // Page finishes loading on a game URL (consumes second mock)
    listeners.onUpdated(5, { status: "complete" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSetIcon).toHaveBeenCalledWith({ tabId: 5, path: ICON_LIT });
  });
});
