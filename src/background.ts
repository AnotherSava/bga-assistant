// Service worker: orchestrates extraction pipeline, opens side panel, handles messaging.

import { processRawLog, type GameLog } from "./games/innovation/process_log.js";
import { createGameState } from "./games/innovation/game_state.js";
import { GameEngine } from "./games/innovation/game_engine.js";
import { toJSON as innovationToJSON, type SerializedGameState } from "./games/innovation/serialization.js";
import { processAzulLog, type AzulGameLog } from "./games/azul/process_log.js";
import { processLog as processAzulState, toJSON as azulToJSON, type SerializedAzulGameState } from "./games/azul/game_state.js";
import { processCrewLog, type CrewGameLog } from "./games/crew/process_log.js";
import { processCrewState } from "./games/crew/game_engine.js";
import { crewToJSON, type SerializedCrewGameState } from "./games/crew/serialization.js";
import { CardDatabase, CardSet, type GameName, type RawExtractionData } from "./models/types.js";
import cardInfoRaw from "../assets/bga/innovation/card_info.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_CLEAR_DELAY_MS = 5000;
const EXTRACTION_TIMEOUT_MS = 60000;
const LIVE_MIN_INTERVAL_MS = 5000;
const SUPPORTED_GAMES: GameName[] = ["innovation", "azul", "thecrewdeepsea"];
const BGA_URL_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\/\d+\/(\w+).*[?&]table=\d+/;
const BGA_DOMAIN_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\//;
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Serialized pipeline results for side panel consumption. */
export type PipelineResults =
  | { gameName: "innovation"; tableNumber: string; rawData: RawExtractionData; gameLog: GameLog; gameState: SerializedGameState }
  | { gameName: "azul"; tableNumber: string; rawData: RawExtractionData; gameLog: AzulGameLog; gameState: SerializedAzulGameState }
  | { gameName: "thecrewdeepsea"; tableNumber: string; rawData: RawExtractionData; gameLog: CrewGameLog; gameState: SerializedCrewGameState }
  | { gameName: string; tableNumber: string; rawData: RawExtractionData; gameLog: null; gameState: null };

/** Where an extraction was triggered from. */
export type ExtractionSource = "click" | "navigation" | "reconnect" | "live";

/** Whether the given extraction source should show a loading indicator. */
export function shouldShowLoading(source: ExtractionSource): boolean {
  return source === "click" || source === "navigation";
}

/** What to do in response to a tab navigation event. */
export type NavigationAction =
  | { action: "extract"; tableNumber: string; gameName: GameName }
  | { action: "showHelp"; url: string }
  | { action: "unsupportedGame"; tableNumber: string; gameName: string };

/**
 * Check if a player count is valid for a given game.
 * Innovation requires exactly 2 players; Azul accepts 2-4.
 */
export function isValidPlayerCount(gameName: GameName, playerCount: number): boolean {
  if (gameName === "azul") return playerCount >= 2 && playerCount <= 4;
  if (gameName === "thecrewdeepsea") return playerCount >= 3 && playerCount <= 5;
  return playerCount === 2;
}

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
let deferredExtractionTimer: ReturnType<typeof setTimeout> | null = null;

// Load card database once at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardDb = new CardDatabase(cardInfoRaw as any[]);

// Initialize activeTabId and icon on service worker startup
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  const tab = tabs[0];
  if (tab?.id) {
    activeTabId = tab.id;
    updateIcon(tab.id, tab.url);
  }
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
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "innovation"): Extract<PipelineResults, { gameName: "innovation" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "azul"): Extract<PipelineResults, { gameName: "azul" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "thecrewdeepsea"): Extract<PipelineResults, { gameName: "thecrewdeepsea" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: GameName): PipelineResults;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: GameName): PipelineResults {
  const playerCount = Object.keys(rawData.players).length;
  if (!isValidPlayerCount(gameName, playerCount)) {
    throw new Error(`${gameName} does not support ${playerCount}-player games`);
  }

  if (gameName === "thecrewdeepsea") {
    const crewLog = processCrewLog(rawData);
    const crewState = processCrewState(crewLog);
    return { gameName, tableNumber, rawData, gameLog: crewLog, gameState: crewToJSON(crewState) };
  }

  if (gameName === "azul") {
    const azulLog = processAzulLog(rawData);
    const azulState = processAzulState(azulLog.log);
    return { gameName, tableNumber, rawData, gameLog: azulLog, gameState: azulToJSON(azulState) };
  }

  if (gameName !== "innovation") {
    throw new Error(`Pipeline not implemented for game: ${gameName}`);
  }

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
  const engine = new GameEngine(database);
  const state = createGameState(players, perspective);
  engine.initGame(state, gameLog.expansions);
  engine.processLog(state, gameLog.log, gameLog.myHand);
  return { gameName, tableNumber, rawData, gameLog, gameState: innovationToJSON(state) };
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

/**
 * Probe function injected into the page to check if a game table is active.
 * Must be self-contained (no closures or external references).
 * Returns the number of players if gameui is loaded, 0 otherwise.
 */
function probeGameTable(): number {
  const gui = (globalThis as any).gameui;
  if (!gui?.ajaxcall || !gui.gamedatas?.players) return 0;
  return Object.keys(gui.gamedatas.players).length;
}

// Icon frame paths: 0 = normal (dark), 1–8 = intermediate, 9 = fully lit
const FRAME_PATHS: Record<string, string>[] = Array.from({ length: 10 }, (_, i) => ({
  "16": `/assets/extension/icon-16-${i}.png`,
  "48": `/assets/extension/icon-48-${i}.png`,
  "128": `/assets/extension/icon-128-${i}.png`,
}));

/** Load a PNG from an extension URL and return its ImageData at the given size. */
async function loadIconData(path: string, size: number): Promise<ImageData> {
  const url = chrome.runtime.getURL(path);
  const resp = await fetch(url);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, size, size);
}

/** Preloaded ImageData for each frame, keyed by size. */
type IconImageData = Record<string, ImageData>; // { "16": ImageData, "48": ImageData }
let frameImageData: IconImageData[] | null = null;

/** Preload all icon frames as ImageData so setIcon needs no file I/O during animation. */
async function ensureFramesLoaded(): Promise<IconImageData[]> {
  if (frameImageData) return frameImageData;
  frameImageData = await Promise.all(
    FRAME_PATHS.map(async (paths) => {
      const [d16, d48] = await Promise.all([loadIconData(paths["16"], 16), loadIconData(paths["48"], 48)]);
      return { "16": d16, "48": d48 };
    })
  );
  return frameImageData;
}

// Icon animation command: [delay ms, transition ms, target frame 0–9]
type Command = [delay: number, transitionTime: number, targetFrame: number];

// Panel closed: wait, flash up, flash down, flash up
const FLASH_FULL: Command[] = [
  [1000, 100, 9],
  [500,  150, 0],
  [250,  100, 9],
];

// Panel open: wait, light up
const FLASH_SHORT: Command[] = [
  [1000, 100, 9],
];

// Hold lit, then fade to normal
const FADE_OUT: Command[] = [
  [300, 300, 0],
];

// Instant reset to normal
const INSTANT_NORMAL: Command[] = [
  [0, 0, 0],
];

// Instant set to lit (for returning to an already-lit tab)
const INSTANT_LIT: Command[] = [
  [0, 0, 9],
];

/**
 * Queue-based icon animation controller using the global (default) icon.
 * All chrome.action.setIcon calls go through this — nothing else touches the icon.
 * Calling run() cancels any in-progress animation and starts the new sequence.
 *
 * Uses global icon (no tabId) because Chrome shows one toolbar icon at a time.
 * Per-tab "target frame" is tracked separately to avoid re-flashing known game tabs.
 */
class IconController {
  private displayFrame = 0;
  private tabTargets = new Map<number, number>();
  private generation = 0;

  run(tabId: number, commands: Command[]): void {
    const gen = ++this.generation;
    this.processQueue(tabId, [...commands], gen);
  }

  /** Current displayed frame (what's showing in the toolbar right now). */
  getFrame(): number {
    return this.displayFrame;
  }

  /** What frame a tab was last animated to (used to avoid re-flashing). */
  getTabFrame(tabId: number): number {
    return this.tabTargets.get(tabId) ?? 0;
  }

  private async processQueue(tabId: number, commands: Command[], gen: number): Promise<void> {
    const frames = await ensureFramesLoaded();
    for (const [delay, transitionTime, targetFrame] of commands) {
      if (this.generation !== gen) return;
      if (this.displayFrame === targetFrame) {
        this.tabTargets.set(tabId, targetFrame);
        continue;
      }
      if (delay > 0) {
        await this.wait(delay);
        if (this.generation !== gen) return;
      }
      if (transitionTime > 0) {
        const from = this.displayFrame;
        const steps = Math.abs(targetFrame - from);
        if (steps > 0) {
          const stepDuration = transitionTime / steps;
          const direction = targetFrame > from ? 1 : -1;
          for (let i = 1; i <= steps; i++) {
            await this.wait(stepDuration);
            if (this.generation !== gen) return;
            this.setGlobalFrame(from + direction * i, frames);
          }
        }
      } else {
        this.setGlobalFrame(targetFrame, frames);
      }
    }
    if (this.generation === gen) {
      this.tabTargets.set(tabId, this.displayFrame);
    }
  }

  private setGlobalFrame(frame: number, frames: IconImageData[]): void {
    this.displayFrame = frame;
    chrome.action.setIcon({ imageData: frames[frame] });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const iconController = new IconController();

/** Show lit icon when the tab has a supported game table open with a valid player count. */
async function updateIcon(tabId: number, url: string | undefined): Promise<void> {
  const nav = classifyNavigation(url);
  if (nav.action !== "extract") {
    iconController.run(tabId, iconController.getFrame() > 0 ? FADE_OUT : INSTANT_NORMAL);
    return;
  }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: probeGameTable, world: "MAIN" });
    const playerCount = (results?.[0]?.result as number) ?? 0;
    const isGame = isValidPlayerCount(nav.gameName, playerCount);
    if (isGame) {
      if (iconController.getTabFrame(tabId) > 0) {
        iconController.run(tabId, INSTANT_LIT);
      } else {
        iconController.run(tabId, sidePanelOpen ? FLASH_SHORT : FLASH_FULL);
      }
    } else {
      iconController.run(tabId, iconController.getFrame() > 0 ? FADE_OUT : INSTANT_NORMAL);
    }
  } catch {
    iconController.run(tabId, INSTANT_NORMAL);
  }
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

function clearDeferredExtraction(): void {
  if (deferredExtractionTimer !== null) {
    clearTimeout(deferredExtractionTimer);
    deferredExtractionTimer = null;
  }
}

function stopLiveTracking(reason: string): void {
  if (liveTabId !== null) {
    console.log("[live] stopped:", reason);
  }
  clearDeferredExtraction();
  liveTabId = null;
  chrome.runtime.sendMessage({ type: "liveStatus", active: false }).catch(() => {});
}

function triggerLiveExtraction(): void {
  if (extracting || !sidePanelOpen || liveTabId === null) return;
  const elapsed = Date.now() - lastExtractionTime;
  if (elapsed < LIVE_MIN_INTERVAL_MS) {
    if (deferredExtractionTimer === null) {
      const remaining = LIVE_MIN_INTERVAL_MS - elapsed;
      deferredExtractionTimer = setTimeout(() => {
        deferredExtractionTimer = null;
        triggerLiveExtraction();
      }, remaining);
    }
    return;
  }
  const liveTableNumber = lastResults?.tableNumber;
  if (!liveTableNumber) { console.log("[live] ignored: no table number"); return; }
  const liveGameName = lastResults!.gameName;
  if (!(SUPPORTED_GAMES as readonly string[]).includes(liveGameName)) { console.log("[live] ignored: unsupported game", liveGameName); return; }
  const previousPacketCount = lastResults?.rawData?.packets?.length ?? 0;
  clearDeferredExtraction();
  extracting = true;
  extractFromTab(liveTabId, "", liveGameName as GameName, liveTableNumber, true)
    .then(() => {
      const newPacketCount = lastResults?.rawData?.packets?.length ?? 0;
      if (newPacketCount !== previousPacketCount) {
        chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
      }
    })
    .catch((err) => {
      console.warn("Live extraction error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      chrome.runtime.sendMessage({ type: "gameError", error: errorMsg }).catch(() => {});
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

// ---------------------------------------------------------------------------
// Navigation classification
// ---------------------------------------------------------------------------

/**
 * Classify a tab's URL to decide what the extension should do.
 * Pure function — no side effects, easy to test.
 */
export function classifyNavigation(url: string | undefined): NavigationAction {
  const match = url?.match(BGA_URL_PATTERN);
  if (!match) {
    return { action: "showHelp", url: url ?? "" };
  }
  const gameName = match[2];
  const tableNumber = url!.match(/table=(\d+)/)?.[1] ?? "";
  if (!(SUPPORTED_GAMES as readonly string[]).includes(gameName)) {
    return { action: "unsupportedGame", tableNumber, gameName };
  }
  return { action: "extract", tableNumber, gameName: gameName as GameName };
}

/**
 * Determine whether the side panel should auto-close for a given URL and pin mode.
 * Pure function — no side effects, easy to test.
 */
export function shouldAutoClose(url: string | undefined, mode: PinMode): boolean {
  if (mode === "pinned") return false;
  if (mode === "autohide-bga") return !url || !BGA_DOMAIN_PATTERN.test(url);
  // autohide-game: close on unsupported game tables or when leaving BGA
  const nav = classifyNavigation(url);
  if (nav.action === "extract") return false;
  if (nav.action === "unsupportedGame") return true;
  return !url || !BGA_DOMAIN_PATTERN.test(url);
}

// ---------------------------------------------------------------------------
// Extraction helper
// ---------------------------------------------------------------------------

/**
 * Inject extract.js, run the pipeline, and notify the side panel.
 * Shared by click handler and navigation listeners.
 */
async function extractFromTab(tabId: number, url: string, gameName: GameName, tableNumber?: string, skipNotify = false): Promise<void> {
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
  const rawData = extractResult as RawExtractionData;
  try {
    lastResults = runPipeline(rawData, cardDb, tblNum, gameName);
  } catch (err) {
    // Preserve raw data for download even when the pipeline fails
    lastResults = { gameName, tableNumber: tblNum, rawData, gameLog: null, gameState: null };
    throw err;
  }
  console.log("Pipeline complete:", Object.keys(lastResults));

  lastExtractionTime = Date.now();

  // Inject watcher for live tracking after successful extraction
  if (sidePanelOpen) {
    injectWatcher(tabId);
  }

  // Notify side panel of new results
  if (!skipNotify) {
    chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Content resolution helpers
// ---------------------------------------------------------------------------

/** Extract raw data from a tab for unsupported games (no pipeline processing). */
async function extractRawDataAsResults(tabId: number, tableNumber: string, gameName: string): Promise<void> {
  try {
    const extractionPromise = chrome.scripting.executeScript({ target: { tabId }, files: ["dist/extract.js"], world: "MAIN" });
    // Suppress unhandled rejection if extraction settles after timeout
    extractionPromise.catch(() => {});
    const results = await Promise.race([
      extractionPromise,
      timeout(EXTRACTION_TIMEOUT_MS, "Extraction timed out"),
    ]);
    const extractResult = (results as chrome.scripting.InjectionResult[])[0]?.result;
    if (extractResult && !(extractResult as Record<string, unknown>).error) {
      lastResults = { gameName, tableNumber, rawData: extractResult as RawExtractionData, gameLog: null, gameState: null };
    } else {
      lastResults = null;
    }
  } catch {
    lastResults = null;
  }
}

/**
 * Evaluate a tab and update side panel content accordingly.
 * Handles extract, unsupported game, and help actions.
 * Throws on extraction errors — callers handle error display.
 */
async function resolveContent(tabId: number, tabUrl: string, source: ExtractionSource): Promise<void> {
  const nav = classifyNavigation(tabUrl);

  if (nav.action === "extract") {
    if (shouldShowLoading(source)) chrome.runtime.sendMessage({ type: "loading" }).catch(() => {});
    await extractFromTab(tabId, tabUrl, nav.gameName, nav.tableNumber);
    return;
  }

  if (nav.action === "unsupportedGame") {
    stopLiveTracking(source + ": unsupported game");
    await extractRawDataAsResults(tabId, nav.tableNumber, nav.gameName);
    if (lastResults) {
      chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    }
    return;
  }

  // showHelp
  lastResults = null;
  stopLiveTracking(source + ": not a game");
  chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Chrome event listeners
// ---------------------------------------------------------------------------

// Track side panel open/close via port connection
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "sidepanel") return;
  console.log("[live] port connected");
  sidePanelOpen = true;

  // Push cached results immediately so the side panel renders without a round trip.
  if (lastResults) {
    chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
  }

  // After service worker restart, state is lost. Re-extract the active game tab so the
  // side panel gets fresh results instead of showing stale data from before the restart.
  chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return;
    activeTabId = tab.id;
    if (!lastResults && !extracting) {
      extracting = true;
      try {
        await resolveContent(tab.id, tab.url, "reconnect");
      } catch (err) {
        console.warn("Reconnect extraction error:", err);
        chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
      } finally {
        extracting = false;
      }
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
  // Set extracting before opening the panel so the onConnect reconnect handler
  // sees it and skips its own extraction (prevents a race between the two paths).
  extracting = true;
  try {
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

    // Non-game pages resolve immediately without badge
    const clickNav = classifyNavigation(tab.url);
    if (clickNav.action === "showHelp") {
      await resolveContent(tabId, tab.url ?? "", "click");
      return;
    }

    // Extraction needed (supported or unsupported game)
    setBadge(tabId, "...", "#1976D2");
    await resolveContent(tabId, tab.url ?? "", "click");
    if (lastResults) setBadge(tabId, "\u2713", "#388E3C");
  } catch (err) {
    console.error("BGA Assistant error:", err);
    setBadge(tabId, "ERR", "#D32F2F");
    stopLiveTracking("click: extraction error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    chrome.runtime.sendMessage({ type: "gameError", error: errorMsg, results: lastResults }).catch(() => {});
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

      await resolveContent(tabId, tab.url ?? "", "navigation");
    } catch (err) {
      console.error("Navigation error:", err);
      lastResults = null;
      stopLiveTracking("navigation: error");
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
  // Update lit icon based on whether tab is a supported game
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateIcon(activeInfo.tabId, tab.url);
  } catch { /* tab may have been closed */ }
  if (!sidePanelOpen) return;
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
  // Update lit icon based on whether tab is a supported game
  chrome.tabs.get(tabId).then((tab) => updateIcon(tabId, tab.url)).catch(() => {});
  if (!sidePanelOpen) return;
  if (extracting) {
    pendingNavTabId = tabId;
    return;
  }
  handleNavigation(tabId);
});

// React to window focus changes (switching between Chrome windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, windowId });
  } catch { return; }
  const tab = tabs[0];
  if (!tab?.id) return;
  activeTabId = tab.id;
  updateIcon(tab.id, tab.url);
  if (!sidePanelOpen) return;
  if (extracting) {
    pendingNavTabId = tab.id;
    return;
  }
  handleNavigation(tab.id);
});

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "pauseLive") {
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
      triggerLiveExtraction();
    }
    return undefined;
  },
);
