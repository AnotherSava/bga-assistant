// Service worker: orchestrates extraction pipeline, opens side panel, handles messaging.

import { processRawLog, type RawExtractionData, type GameLog } from "./engine/process_log.js";
import { GameState } from "./engine/game_state.js";
import { CardDatabase } from "./models/types.js";
import cardInfoRaw from "../assets/card_info.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_CLEAR_DELAY_MS = 5000;
const EXTRACTION_TIMEOUT_MS = 60000;
const BGA_URL_PATTERN = /^https?:\/\/([a-z0-9]+\.)?boardgamearena\.com\/.*[?&]table=\d/;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Serialized pipeline results for side panel consumption. */
export interface PipelineResults {
  gameLog: GameLog;
  gameState: ReturnType<GameState["toJSON"]>;
}

let lastResults: PipelineResults | null = null;
let extracting = false;

// Load card database once at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardDb = new CardDatabase(cardInfoRaw as any[]);

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full analysis pipeline on raw extraction data.
 * Exported for testing.
 */
export function runPipeline(rawData: RawExtractionData, database: CardDatabase): PipelineResults {
  const gameLog = processRawLog(rawData);
  const players = Object.values(gameLog.players);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
  const state = new GameState(database, players, perspective);
  state.initGame();
  state.processLog(gameLog.log, gameLog.myHand);
  return { gameLog, gameState: state.toJSON() };
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
// Chrome event listeners
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (extracting || !tab.id) return;

  // Validate URL
  if (!tab.url || !BGA_URL_PATTERN.test(tab.url)) {
    setBadge(tab.id, "ERR", "#D32F2F");
    console.error("Not a BGA game page:", tab.url);
    clearBadgeLater(tab.id);
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
    // Inject extract.js into the active tab's MAIN world (with timeout
    // so a hung BGA ajaxcall doesn't permanently block the extension)
    const extractionPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
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

    // Run pipeline
    lastResults = runPipeline(extractResult as RawExtractionData, cardDb);
    console.log("Pipeline complete:", Object.keys(lastResults));

    // Notify side panel of new results
    chrome.runtime.sendMessage({ type: "resultsReady" }).catch(() => {});

    // Success badge
    setBadge(tab.id, "\u2713", "#388E3C");
  } catch (err) {
    console.error("BGA Innovation Tracker error:", err);
    setBadge(tab.id, "ERR", "#D32F2F");
  }

  extracting = false;
  clearBadgeLater(tab.id);
});

// Handle messages from side panel
chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "getResults") {
      sendResponse(lastResults);
      return true; // keep channel open for async response
    }
  },
);
