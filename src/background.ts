// Service worker: orchestrates extraction pipeline, opens side panel, handles messaging.

import { processRawLog, type RawExtractionData, type GameLog } from "./engine/process_log.js";
import { GameState } from "./engine/game_state.js";
import { CardDatabase } from "./models/types.js";
import cardInfoRaw from "../assets/bga/innovation/card_info.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_CLEAR_DELAY_MS = 5000;
const EXTRACTION_TIMEOUT_MS = 60000;
const LIVE_MIN_INTERVAL_MS = 5000;
const SUPPORTED_GAMES = ["innovation"];
const BGA_URL_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\/\d+\/(\w+).*[?&]table=\d/;

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

let lastResults: PipelineResults | null = null;
let extracting = false;
let sidePanelOpen = false;
let activeTabId: number | null = null;
let pendingNavTabId: number | null = null;
let liveTabId: number | null = null;
let lastExtractionTime = 0;

// Load card database once at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardDb = new CardDatabase(cardInfoRaw as any[]);

// Initialize activeTabId on service worker startup
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs[0]?.id) activeTabId = tabs[0].id;
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
  const players = Object.values(gameLog.players);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
  const state = new GameState(database, players, perspective);
  state.initGame();
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

function stopLiveTracking(): void {
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
  sidePanelOpen = true;
  port.onDisconnect.addListener(() => {
    sidePanelOpen = false;
    stopLiveTracking();
  });
});

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (extracting || !tab.id) return;

  // Non-game or unsupported game: open side panel with help message
  const clickNav = classifyNavigation(tab.url, null);
  if (clickNav.action === "showHelp") {
    lastResults = null;
    stopLiveTracking();
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    } catch (err) {
      console.warn("Could not open side panel:", err);
    }
    return;
  }

  setBadge(tab.id, "...", "#1976D2");
  extracting = true;

  // Open side panel immediately while user gesture context is valid
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.warn("Could not open side panel:", err);
  }

  try {
    await extractFromTab(tab.id, tab.url ?? "");
    setBadge(tab.id, "\u2713", "#388E3C");
  } catch (err) {
    console.error("BGA Assistant error:", err);
    setBadge(tab.id, "ERR", "#D32F2F");
    lastResults = null;
    stopLiveTracking();
    const errorMsg = err instanceof Error ? err.message : String(err);
    chrome.runtime.sendMessage({ type: "gameError", error: errorMsg }).catch(() => {});
  } finally {
    extracting = false;
    clearBadgeLater(tab.id);
    const pending = pendingNavTabId;
    pendingNavTabId = null;
    if (sidePanelOpen && pending !== null) {
      handleNavigation(pending);
    }
  }
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
      const nav = classifyNavigation(tab.url, lastResults?.tableNumber ?? null);
      if (nav.action === "extract") {
        chrome.runtime.sendMessage({ type: "loading" }).catch(() => {});
        try {
          await extractFromTab(tabId, tab.url ?? "", nav.tableNumber);
        } catch (err) {
          console.error("Extraction error:", err);
          lastResults = null;
          stopLiveTracking();
          const errorMsg = err instanceof Error ? err.message : String(err);
          chrome.runtime.sendMessage({ type: "gameError", error: errorMsg }).catch(() => {});
        }
      } else if (nav.action === "showHelp") {
        lastResults = null;
        stopLiveTracking();
        chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
      }
    } catch (err) {
      console.error("Navigation error:", err);
      lastResults = null;
      stopLiveTracking();
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
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  if (!sidePanelOpen) return;
  if (extracting) {
    pendingNavTabId = activeInfo.tabId;
    return;
  }
  handleNavigation(activeInfo.tabId);
});

// React to same-tab navigation (page load complete)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!sidePanelOpen || tabId !== activeTabId) return;
  if (changeInfo.status !== "complete") return;
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
    } else if (message.type === "gameLogChanged") {
      if (sender.tab?.id !== liveTabId) return;
      if (extracting || !sidePanelOpen || liveTabId === null) return;
      if (Date.now() - lastExtractionTime < LIVE_MIN_INTERVAL_MS) return;
      const previousPacketCount = lastResults?.rawData?.packets?.length ?? 0;
      extracting = true;
      extractFromTab(liveTabId, "", lastResults?.tableNumber ?? undefined, true)
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
