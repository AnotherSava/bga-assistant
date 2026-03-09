// Service worker: orchestrates extraction pipeline, opens side panel, handles messaging.

import { processRawLog, type RawExtractionData, type GameLog } from "./engine/process_log.js";
import { GameState } from "./engine/game_state.js";
import { CardDatabase, CardSet } from "./models/types.js";
import cardInfoRaw from "../assets/bga/innovation/card_info.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_CLEAR_DELAY_MS = 5000;
const EXTRACTION_TIMEOUT_MS = 60000;
const LIVE_MIN_INTERVAL_MS = 5000;
const SUPPORTED_GAMES = ["innovation"];
const BGA_URL_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\/\d+\/(\w+).*[?&]table=\d+/;
const BGA_DOMAIN_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\//;
const ICON_NORMAL = { "16": "assets/extension/icon-16.png", "48": "assets/extension/icon-48.png", "128": "assets/extension/icon-128.png" };
const ICON_LIT = { "16": "assets/extension/icon-16-lit.png", "48": "assets/extension/icon-48-lit.png", "128": "assets/extension/icon-128-lit.png" };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Serialized pipeline results for side panel consumption. */
export interface PipelineResults {
  tableNumber: string;
  rawData: RawExtractionData;
  gameLog: GameLog;
  gameState: ReturnType<GameState["toJSON"]>;
}

/** What to do in response to a tab navigation event. */
export type NavigationAction =
  | { action: "skip" }
  | { action: "extract"; tableNumber: string }
  | { action: "showHelp"; url: string };

/** Pin mode controlling auto-hide behavior. */
export type PinMode = "pinned" | "autohide-bga" | "autohide-game";
const VALID_PIN_MODES: ReadonlySet<string> = new Set<PinMode>(["pinned", "autohide-bga", "autohide-game"]);

let lastResults: PipelineResults | null = null;
let extracting = false;
let sidePanelOpen = false;
let activeTabId: number | null = null;
let pendingNavTabId: number | null = null;
let pinMode: PinMode = "pinned";
let liveTabId: number | null = null;
let lastExtractionTime = 0;

// Load card database once at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardDb = new CardDatabase(cardInfoRaw as any[]);

// Initialize activeTabId on service worker startup
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs[0]?.id) activeTabId = tabs[0].id;
});

// Load pin mode from storage on service worker startup
chrome.storage.local.get("pinMode").then((result) => {
  if (result.pinMode && VALID_PIN_MODES.has(result.pinMode)) pinMode = result.pinMode as PinMode;
});

// Show keyboard shortcut in the extension icon tooltip
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === "toggle-sidepanel");
  if (cmd?.shortcut) {
    chrome.action.setTitle({ title: `BGA Assistant (${cmd.shortcut})` });
  }
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full analysis pipeline on raw extraction data.
 * Exported for testing.
 */
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string): PipelineResults {
  const gameLog = processRawLog(rawData);

  // Supplement transfer-based detection with myHand detection
  if (!gameLog.expansions.echoes) {
    for (const name of gameLog.myHand) {
      const info = database.get(name.toLowerCase());
      if (info && info.cardSet === CardSet.ECHOES) {
        gameLog.expansions.echoes = true;
        break;
      }
    }
  }

  const players = Object.values(gameLog.players);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
  const state = new GameState(database, players, perspective);
  state.initGame(gameLog.expansions);
  state.processLog(gameLog.log, gameLog.myHand);
  return { tableNumber, rawData, gameLog, gameState: state.toJSON() };
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function setBadge(tabId: number, text: string, color: string): void {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

function clearBadgeLater(tabId: number): void {
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId });
  }, BADGE_CLEAR_DELAY_MS);
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms));
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

/** Show lit icon when auto-hide is active and a supported game is detected on the tab. */
function updateIcon(tabId: number, url: string | undefined): void {
  if (pinMode === "pinned") return;
  const isGame = classifyNavigation(url, null).action === "extract";
  chrome.action.setIcon({ tabId, path: isGame ? ICON_LIT : ICON_NORMAL });
}

/** Reset icon to normal (unlit) state. */
function resetIcon(tabId: number): void {
  chrome.action.setIcon({ tabId, path: ICON_NORMAL });
}

// ---------------------------------------------------------------------------
// Live tracking
// ---------------------------------------------------------------------------

/**
 * Watcher function injected into the page via executeScript.
 * Must be self-contained (no closures or external references).
 */
export function watcherFunction(): void {
  if ((window as any).__bgaWatcherActive) return;
  (window as any).__bgaWatcherActive = true;
  const logContainer = document.querySelector("#logs") ?? document.querySelector("#game_play_area");
  if (!logContainer) {
    (window as any).__bgaWatcherActive = false;
    return;
  }
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: "gameLogChanged" }).catch(() => {});
    }, 2000);
  });
  observer.observe(logContainer, { childList: true, subtree: true });
}

function injectWatcher(tabId: number): void {
  chrome.scripting.executeScript({ target: { tabId }, func: watcherFunction, world: "ISOLATED" as any });
  liveTabId = tabId;
  chrome.runtime.sendMessage({ type: "liveStatus", active: true }).catch(() => {});
}

function stopLiveTracking(reason: string): void {
  if (liveTabId !== null) {
    console.log("[live] stopped:", reason);
  }
  liveTabId = null;
  chrome.runtime.sendMessage({ type: "liveStatus", active: false }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Navigation classification
// ---------------------------------------------------------------------------

/**
 * Classify a tab's URL to decide what the extension should do.
 * Pure function — no side effects, easy to test.
 */
export function classifyNavigation(url: string | undefined, currentTableNumber: string | null): NavigationAction {
  const match = url?.match(BGA_URL_PATTERN);
  if (!match) {
    return { action: "showHelp", url: url ?? "" };
  }
  const gameName = match[2];
  if (!SUPPORTED_GAMES.includes(gameName)) {
    return { action: "showHelp", url: url ?? "" };
  }
  const tableNumber = url!.match(/table=(\d+)/)?.[1] ?? "";
  if (tableNumber === currentTableNumber) {
    return { action: "skip" };
  }
  return { action: "extract", tableNumber };
}

/**
 * Determine whether the side panel should auto-close for a given URL and pin mode.
 * Pure function — no side effects, easy to test.
 */
export function shouldAutoClose(url: string | undefined, mode: PinMode): boolean {
  if (mode === "pinned") return false;
  if (mode === "autohide-bga") return !url || !BGA_DOMAIN_PATTERN.test(url);
  // autohide-game: close when not on a supported game table
  return classifyNavigation(url, null).action === "showHelp";
}

// ---------------------------------------------------------------------------
// Extraction helper
// ---------------------------------------------------------------------------

/**
 * Inject extract.js, run the pipeline, and notify the side panel.
 * Shared by click handler and navigation listeners.
 */
async function extractFromTab(tabId: number, url: string, tableNumber?: string, skipNotify = false): Promise<void> {
  const extractionPromise = chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/extract.js"],
    world: "MAIN",
  });
  // Suppress unhandled rejection if extraction settles after timeout
  extractionPromise.catch(() => {});

  const results = await Promise.race([
    extractionPromise,
    timeout(EXTRACTION_TIMEOUT_MS, "Extraction timed out"),
  ]);

  const extractResult = (results as chrome.scripting.InjectionResult[])[0]?.result;
  if (!extractResult || (extractResult as Record<string, unknown>).error) {
    const msg = (extractResult as Record<string, unknown>)?.msg ?? "No result from extraction";
    throw new Error("Extraction failed: " + msg);
  }

  const tblNum = tableNumber ?? url.match(/table=(\d+)/)?.[1] ?? "unknown";
  lastResults = runPipeline(extractResult as RawExtractionData, cardDb, tblNum);
  console.log("Pipeline complete:", Object.keys(lastResults));

  lastExtractionTime = Date.now();

  // Inject watcher for live tracking after successful extraction
  if (sidePanelOpen) {
    injectWatcher(tabId);
  }

  // Notify side panel of new results
  if (!skipNotify) {
    chrome.runtime.sendMessage({ type: "resultsReady" }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Chrome event listeners
// ---------------------------------------------------------------------------

// Track side panel open/close via port connection
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "sidepanel") return;
  console.log("[live] port connected");
  sidePanelOpen = true;

  // Reset icon to normal when panel opens
  if (activeTabId !== null) resetIcon(activeTabId);

  // After service worker restart, state is lost. Re-inject watcher on the active game tab
  // so it can detect DOM changes and trigger extraction on demand (no immediate BGA query).
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return;
    activeTabId = tab.id;
    const nav = classifyNavigation(tab.url, null);
    if (nav.action === "extract") {
      console.log("[live] reconnect: re-injecting watcher on tab", tab.id);
      injectWatcher(tab.id);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("[live] port disconnected");
    sidePanelOpen = false;
    stopLiveTracking("port disconnect");
  });
});

async function togglePanel(tabId: number): Promise<void> {
  // Toggle: close panel if already open
  if (sidePanelOpen) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.sidePanel.close({ windowId: tab.windowId });
      updateIcon(tabId, tab.url);
    } catch (err) {
      console.warn("Could not close side panel:", err);
    }
    return;
  }

  if (extracting) return;

  // Open side panel immediately while user gesture context is valid
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (err) {
    console.warn("Could not open side panel:", err);
    return;
  }

  // Fetch tab details for classification and extraction
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch { return; }

  // Non-game or unsupported game: show help
  const clickNav = classifyNavigation(tab.url, null);
  if (clickNav.action === "showHelp") {
    lastResults = null;
    stopLiveTracking("click: not a game");
    chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    return;
  }

  setBadge(tabId, "...", "#1976D2");
  extracting = true;

  try {
    await extractFromTab(tabId, tab.url ?? "");
    setBadge(tabId, "\u2713", "#388E3C");
  } catch (err) {
    console.error("BGA Assistant error:", err);
    setBadge(tabId, "ERR", "#D32F2F");
    lastResults = null;
    stopLiveTracking("click: extraction error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    chrome.runtime.sendMessage({ type: "gameError", error: errorMsg }).catch(() => {});
  } finally {
    extracting = false;
    clearBadgeLater(tabId);
    const pending = pendingNavTabId;
    pendingNavTabId = null;
    if (sidePanelOpen && pending !== null) {
      handleNavigation(pending);
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) await togglePanel(tab.id);
});

// Toggle side panel via keyboard shortcut (named command)
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-sidepanel") return;
  if (activeTabId !== null) togglePanel(activeTabId);
});

// ---------------------------------------------------------------------------
// Navigation handler (shared by tab-switch and same-tab navigation)
// ---------------------------------------------------------------------------

async function handleNavigation(initialTabId: number): Promise<void> {
  let tabId = initialTabId;
  while (true) {
    extracting = true;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== "complete") break;

      // Auto-close when pin mode requires it
      if (shouldAutoClose(tab.url, pinMode)) {
        try {
          await chrome.sidePanel.close({ windowId: tab.windowId });
        } catch (err) {
          console.warn("Could not close side panel:", err);
        }
        lastResults = null;
        stopLiveTracking("auto-close");
        updateIcon(tabId, tab.url);
        break;
      }

      const nav = classifyNavigation(tab.url, lastResults?.tableNumber ?? null);
      if (nav.action === "extract") {
        chrome.runtime.sendMessage({ type: "loading" }).catch(() => {});
        try {
          await extractFromTab(tabId, tab.url ?? "", nav.tableNumber);
        } catch (err) {
          console.error("Extraction error:", err);
          lastResults = null;
          stopLiveTracking("nav: extraction error");
          const errorMsg = err instanceof Error ? err.message : String(err);
          chrome.runtime.sendMessage({ type: "gameError", error: errorMsg }).catch(() => {});
        }
      } else if (nav.action === "showHelp") {
        lastResults = null;
        stopLiveTracking("nav: not a game");
        chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
      }
    } catch (err) {
      console.error("Navigation error:", err);
      lastResults = null;
      stopLiveTracking("nav: infrastructure error");
      chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    } finally {
      extracting = false;
    }
    const pending = pendingNavTabId;
    pendingNavTabId = null;
    if (!sidePanelOpen || pending === null) break;
    tabId = pending;
  }
}

// React to tab switching
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  if (!sidePanelOpen) {
    // Update lit icon hint when panel is closed and auto-hide is active
    if (pinMode !== "pinned") {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        updateIcon(activeInfo.tabId, tab.url);
      } catch { /* tab may have been closed */ }
    }
    return;
  }
  if (extracting) {
    pendingNavTabId = activeInfo.tabId;
    return;
  }
  handleNavigation(activeInfo.tabId);
});

// React to same-tab navigation (page load complete)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId) return;
  if (changeInfo.status !== "complete") return;
  if (!sidePanelOpen) {
    // Update lit icon hint when page finishes loading
    if (pinMode !== "pinned") {
      chrome.tabs.get(tabId).then((tab) => updateIcon(tabId, tab.url)).catch(() => {});
    }
    return;
  }
  if (extracting) {
    pendingNavTabId = tabId;
    return;
  }
  handleNavigation(tabId);
});

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "getResults") {
      sendResponse(lastResults);
    } else if (message.type === "pauseLive") {
      stopLiveTracking("help page opened");
    } else if (message.type === "resumeLive") {
      if (activeTabId !== null) injectWatcher(activeTabId);
    } else if (message.type === "getPinMode") {
      sendResponse(pinMode);
    } else if (message.type === "setPinMode") {
      if (typeof message.mode !== "string" || !VALID_PIN_MODES.has(message.mode)) { sendResponse(false); return; }
      pinMode = message.mode as PinMode;
      chrome.storage.local.set({ pinMode });
      sendResponse(true);
    } else if (message.type === "gameLogChanged") {
      if (sender.tab?.id !== liveTabId) { console.log("[live] ignored: sender tab", sender.tab?.id, "!= liveTabId", liveTabId); return; }
      if (extracting || !sidePanelOpen || liveTabId === null) { console.log("[live] ignored: extracting=", extracting, "sidePanelOpen=", sidePanelOpen, "liveTabId=", liveTabId); return; }
      if (Date.now() - lastExtractionTime < LIVE_MIN_INTERVAL_MS) return;
      const liveTableNumber = lastResults?.tableNumber;
      if (!liveTableNumber) { console.log("[live] ignored: no table number"); return; }
      const previousPacketCount = lastResults?.rawData?.packets?.length ?? 0;
      extracting = true;
      extractFromTab(liveTabId, "", liveTableNumber, true)
        .then(() => {
          const newPacketCount = lastResults?.rawData?.packets?.length ?? 0;
          if (newPacketCount !== previousPacketCount) {
            chrome.runtime.sendMessage({ type: "resultsReady" }).catch(() => {});
          }
        })
        .catch((err) => {
          console.warn("Live extraction error:", err);
        })
        .finally(() => {
          extracting = false;
          lastExtractionTime = Date.now();
          const pending = pendingNavTabId;
          pendingNavTabId = null;
          if (sidePanelOpen && pending !== null) {
            handleNavigation(pending);
          }
        });
    }
    return undefined;
  },
);
