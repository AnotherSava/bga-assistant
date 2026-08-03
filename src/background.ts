// Service worker: orchestrates extraction pipeline, opens side panel, handles messaging.

import { runPipeline, isValidPlayerCount, type PipelineResults } from "./pipeline.js";
import { CardDatabase, type GameName, type RawExtractionData } from "./models/types.js";
import { SessionTracker, parseGameTableUrl, IDLE_DETECTION_SECONDS, IDLE_GRACE_MS, HEARTBEAT_MS } from "./time-tracking.js";
import cardInfoRaw from "../assets/bga/innovation/card_info.json";
import { renderTurnHistoryRows, setAssetResolver } from "./games/innovation/render.js";
import { recentTurns } from "./games/innovation/turn_history.js";
import { inPageLogFunction } from "./games/innovation/inpage_log.js";
import { compactHeaderFunction } from "./games/innovation/compact_header.js";
import { simplifiedCardsFunction } from "./games/innovation/simplified_cards.js";
import { loadInPageSettings, saveInPageSettings, subscribeInPageSettings, INPAGE_DEFAULTS, INPAGE_LOG_HALF_TURNS, type InPageSettings } from "./sidepanel/inpage_settings.js";
import cardTipCss from "./games/innovation/card_tip.css?raw";
import turnHistoryCss from "./games/innovation/turn_history.css?raw";
import inPageLogCss from "./games/innovation/inpage_log.css?raw";
import compactHeaderCss from "./games/innovation/compact_header.css?raw";
import simplifiedCardsCss from "./games/innovation/simplified_cards.css?raw";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BADGE_CLEAR_DELAY_MS = 5000;
const EXTRACTION_TIMEOUT_MS = 60000;
const LIVE_MIN_INTERVAL_MS = 5000;
const SUPPORTED_GAMES: GameName[] = ["innovation", "azul", "thecrewdeepsea"];
const BGA_DOMAIN_PATTERN = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\//;
const HEARTBEAT_ALARM = "bgaTimeHeartbeat";
const IDLE_FINALIZE_ALARM = "bgaTimeIdleFinalize";
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Where an extraction was triggered from.
 * - "click": user clicked the extension icon or pressed the keyboard shortcut
 * - "navigation": tab switch or same-tab page load
 * - "focus": window focus change (no loading — content stays visible)
 * - "reconnect": side panel reconnected after service worker restart (no loading)
 * - "reopen": side panel reopened on a different table than the cached one
 * - "live": watcher detected DOM changes during live tracking (no loading)
 */
export type ExtractionSource = "click" | "navigation" | "focus" | "reconnect" | "reopen" | "live";

/** Whether the given extraction source should show a loading indicator. */
export function shouldShowLoading(source: ExtractionSource): boolean {
  return source === "click" || source === "navigation" || source === "reopen";
}

/** What to do in response to a tab navigation event. */
export type NavigationAction =
  | { action: "extract"; tableNumber: string; gameName: GameName }
  | { action: "showHelp"; url: string }
  | { action: "unsupportedGame"; tableNumber: string; gameName: string };

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

/**
 * Whether anything is currently consuming extraction results.
 *
 * The side panel used to be the only consumer, so extraction and navigation handling were gated
 * on `sidePanelOpen` directly. The in-page game log is a second consumer that runs with the panel
 * closed — which is its whole point — so every one of those gates now asks this instead.
 */
function hasConsumer(): boolean {
  return sidePanelOpen || inPageLogSettings.enabled;
}

// Load card database once at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardDb = new CardDatabase(cardInfoRaw as any[]);

// The in-page log renders card tooltips whose faces are loaded by BGA's document, so asset
// paths must resolve to absolute chrome-extension:// URLs here just as they do in the panel.
setAssetResolver(chrome.runtime.getURL);

const timeTracker = new SessionTracker();
const BACKUP_THROTTLE_MS = 5 * 60 * 1000;
let lastBackupTime = 0;
let restoredFromBga = false;

function recordTableMode(tableNumber: string, rawData: RawExtractionData): void {
  const tableId = Number(tableNumber);
  if (!Number.isFinite(tableId)) return;
  timeTracker.setTableMode(tableId, rawData.realTime);
  // Extraction detects "tournament" (from gameui.tournament_id) or null. Arena vs regular isn't on
  // gameui, so it's probed separately via recordTableType().
  timeTracker.setTableType(tableId, rawData.tableType);
}

/** Tables already probed for their category this SW lifetime — avoids re-probing on every live re-extraction. */
const probedTableTypes = new Set<number>();

/**
 * Probe function injected into the page (MAIN world) to read the table category. Uses gameui.ajaxcall —
 * which carries BGA's session request token — because a plain service-worker fetch is rejected as
 * unauthorized. Self-contained (no external refs). Resolves "tournament" | "arena" | "regular", or null
 * when it can't be determined. Never throws/hangs (times out to null), so it can't disrupt anything.
 */
export function probeTableTypeFn(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gui = (globalThis as any).gameui;
  const match = window.location.search.match(/table=(\d+)/);
  if (!gui || !gui.ajaxcall || !match) return Promise.resolve(null);
  const tableId = parseInt(match[1]);
  const tournamentId = typeof gui.tournament_id === "number" ? gui.tournament_id : null;
  if (tournamentId !== null && tournamentId > 0) return Promise.resolve("tournament");
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null): void => { if (!done) { done = true; resolve(value); } };
    setTimeout(() => finish(null), 4000);
    try {
      gui.ajaxcall(
        "/table/table/tableinfos.html",
        { id: tableId },
        gui,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => {
          const info = r && r.data && typeof r.data === "object" ? r.data : r;
          if (!info || typeof info !== "object" || !info.players) { finish(null); return; }
          if (info.has_tournament === "1") { finish("tournament"); return; }
          // BGA framework option 201 ("Game mode") selects 0=Normal, 1=Friendly, 2=Arena. Its value is the
          // authoritative arena signal. (table_matchmaking only means "matchmade" — also true for "Play now"
          // quick games, which are regular, not arena — so it over-matched.)
          const gameMode = info.options && info.options["201"] ? String(info.options["201"].value) : "";
          finish(gameMode === "2" ? "arena" : "regular");
        },
        () => finish(null),
      );
    } catch { finish(null); }
  });
}

/** Best-effort: inject probeTableTypeFn to classify the table, then record its category. Decoupled from extraction — its failure never disrupts extraction or tracking. Classification is done once per table (first-write-wins), then skipped on future opens. */
async function recordTableType(tableId: number, tabId: number): Promise<void> {
  if (!Number.isFinite(tableId) || probedTableTypes.has(tableId)) return;
  probedTableTypes.add(tableId);
  try {
    if (await timeTracker.isTableTypeKnown(tableId)) return; // already classified — first-write-wins keeps it
    const results = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, func: probeTableTypeFn, world: "MAIN" }),
      timeout(EXTRACTION_TIMEOUT_MS, "table type probe timed out"),
    ]);
    const type = (results as chrome.scripting.InjectionResult[])[0]?.result as string | undefined;
    if (type === "tournament" || type === "arena" || type === "regular") {
      timeTracker.setTableType(tableId, type);
    } else {
      probedTableTypes.delete(tableId); // null/undefined = probe failed; allow a retry on the next extraction
    }
  } catch {
    probedTableTypes.delete(tableId);
  }
}

function maybeBgaSync(tabId: number, url: string | undefined): void {
  if (!url || !BGA_DOMAIN_PATTERN.test(url)) return;
  if (!restoredFromBga) {
    restoredFromBga = true;
    timeTracker.restoreFromBga(tabId).catch(() => {});
  }
  if (Date.now() - lastBackupTime < BACKUP_THROTTLE_MS) return;
  lastBackupTime = Date.now();
  timeTracker.backupToBga(tabId).catch(() => {});
}

/**
 * Drive the time tracker from a resolved game board. The board's frame URL carries the game slug that
 * the /tableview shell URL lacks, so feeding it (rather than the top-frame URL) attributes the session
 * to the right game. When no board resolved: on a non-table page pass the raw URL (so leaving a game
 * ends its session); on a table page whose board hasn't resolved yet, leave the session untouched —
 * passing the slug-less shell URL would chop the session on a transient probe miss.
 */
function trackTime(game: GameFrame | null, tabUrl: string | undefined, title: string | undefined): void {
  if (game) timeTracker.handleFocusChange(game.url, title);
  else if (!isPotentialTablePage(tabUrl)) timeTracker.handleFocusChange(tabUrl ?? null, title);
}

// Initialize activeTabId and icon on service worker startup
chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
  // Close out any session orphaned by a crash/quit before re-establishing the current one, so a long
  // offline gap is bounded at the last confirmed-active moment instead of stretching the session to now.
  await timeTracker.recoverStaleSession();
  const tab = tabs[0];
  if (tab?.id) {
    activeTabId = tab.id;
    const game = await updateIcon(tab.id, tab.url);
    // Start the session for the already-focused tab — no tab/window event fires when the SW (re)starts
    // while the user is already sitting on a game table. Two guards:
    // - Only when recovery left no session running: a session that survived recovery (e.g. one mid-grace)
    //   must keep its pending-idle state, or the grace finalize would never fire.
    // - Only when the user is actually active. The SW cold-restarts repeatedly (heartbeat alarm) while the
    //   user is away; chrome.idle.onStateChanged won't replay the already-past idle transition to this fresh
    //   instance, so a session started here would never learn it's idle. It would freeze (no touch while
    //   idle) and be finalized as a 0-length stale session on the next restart, looping once per restart.
    //   Querying the live idle state instead starts a session only when warranted; the "active" transition
    //   on the user's return starts it otherwise.
    if (!(await timeTracker.hasActiveSession()) && (await chrome.idle.queryState(IDLE_DETECTION_SECONDS)) === "active") {
      trackTime(game, tab.url, tab.title);
    }
  }
  syncHeartbeatAlarm();
});

// Idle / liveness wiring -----------------------------------------------------
// chrome.idle reports "idle" after IDLE_DETECTION_SECONDS without input, and "locked" on screen
// lock/sleep. We don't end the session immediately; we mark the idle onset and arm a grace alarm.
chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "active") {
    // User is back. Cancel the pending grace finalize, then re-apply the focused tab. handleFocusChange
    // makes this do the right thing in both cases: if the session survived (returned within grace) the
    // same table is a no-op continuation; if the grace already finalized it during the away period, a
    // fresh session starts — so a long absence yields two separate sessions, not one stretched one.
    // Gate on a Chrome window actually holding focus so a stray "active" (e.g. input racing an alt-tab
    // away) can't resurrect a session the focus handlers already ended.
    chrome.alarms.clear(IDLE_FINALIZE_ALARM);
    let handled = false;
    try {
      const win = await chrome.windows.getLastFocused({ populate: true });
      if (win.focused) {
        const activeTab = win.tabs?.find((tab) => tab.active);
        if (activeTab?.id != null) {
          // Resolve the board frame so a /tableview table resumes its session — the slug-less shell URL
          // can't continue it and would instead end it. updateIcon also re-lights the icon, matching the
          // other focus handlers.
          const game = await updateIcon(activeTab.id, activeTab.url);
          trackTime(game, activeTab.url, activeTab.title);
          handled = true;
        }
      }
    } catch { /* no focused window — leave the session ended */ }
    if (!handled) timeTracker.handleFocusChange(null);
    syncHeartbeatAlarm();
  } else {
    // "idle" or "locked": begin the grace countdown if one isn't already pending.
    timeTracker.markAway();
    if (!(await chrome.alarms.get(IDLE_FINALIZE_ALARM))) {
      chrome.alarms.create(IDLE_FINALIZE_ALARM, { delayInMinutes: IDLE_GRACE_MS / 60000 });
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === IDLE_FINALIZE_ALARM) {
    timeTracker.finalizeIdle();
    syncHeartbeatAlarm();
  } else if (alarm.name === HEARTBEAT_ALARM) {
    const state = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
    if (state === "active") timeTracker.touch();
    syncHeartbeatAlarm();
  }
});

/** Run the heartbeat alarm only while a session is open, so the service worker isn't woken every minute when nothing is being tracked. */
async function syncHeartbeatAlarm(): Promise<void> {
  if (await timeTracker.hasActiveSession()) {
    if (!(await chrome.alarms.get(HEARTBEAT_ALARM))) {
      chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MS / 60000 });
    }
  } else {
    chrome.alarms.clear(HEARTBEAT_ALARM);
  }
}

// Pin mode is loaded from sidepanel localStorage and pushed via setPinMode on connect.

// Show keyboard shortcut in the extension icon tooltip
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === "toggle-sidepanel");
  if (cmd?.shortcut) {
    chrome.action.setTitle({ title: `BGA Assistant (${cmd.shortcut})` });
  }
});

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Game-frame discovery
// ---------------------------------------------------------------------------

// BGA's modern layout serves the table at a /tableview?table=<id> shell page and embeds the actual
// game board in a same-origin iframe (the classic /<gameId>/<gameslug>?table=<id> page). The game
// framework global `gameui` lives only in that iframe, so detection and injection target *frames*:
// the probe runs in every frame and the one with `gameui` loaded is the game board. Legacy direct
// game URLs and replays are just the special case where the board is the top frame.

/** Per-frame probe result (one per frame when probeGameTable is injected with allFrames). */
export interface FrameProbe {
  players: number;
  slug: string | null;
  tableNumber: string | null;
  href: string;
}

/** A resolved game board — whichever frame (top or iframe) actually hosts the BGA game framework. */
export interface GameFrame {
  gameName: string;
  tableNumber: string;
  playerCount: number;
  /** The board frame's own URL (always a classic /<gameId>/<slug>?table= URL, even when iframed under /tableview). */
  url: string;
}

// Retry delay between probes: the board iframe loads after the /tableview shell, so the game frame
// may not exist (or gameui may not be ready) on the first probe.
const PROBE_RETRY_MS = 700;
const ICON_PROBE_RETRIES = 1;
const EXTRACT_RETRIES = 2;

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

/**
 * Probe injected into every frame (MAIN world) to report that frame's BGA framework state.
 * Must be self-contained (no closures or external references) — it is serialized for injection.
 * Returns the player count (0 when gameui isn't loaded in this frame), the game slug and table id
 * parsed from this frame's own URL, and the frame's href.
 */
function probeGameTable(): { players: number; slug: string | null; tableNumber: string | null; href: string } {
  const gui = (globalThis as any).gameui;
  const pathMatch = location.pathname.match(/^\/\d+\/(\w+)/);
  const tableMatch = location.search.match(/[?&]table=(\d+)/);
  const players = gui?.ajaxcall && gui.gamedatas?.players ? Object.keys(gui.gamedatas.players).length : 0;
  return { players, slug: pathMatch ? pathMatch[1] : null, tableNumber: tableMatch ? tableMatch[1] : null, href: location.href };
}

/** Pick the game board from per-frame probe results: the frame with the BGA framework loaded (players > 0) and a parseable game slug + table id. Pure for testability. */
export function selectGameFrame(frames: (FrameProbe | undefined)[]): GameFrame | null {
  for (const frame of frames) {
    if (frame && frame.players > 0 && frame.slug && frame.tableNumber) {
      return { gameName: frame.slug, tableNumber: frame.tableNumber, playerCount: frame.players, url: frame.href };
    }
  }
  return null;
}

/** Inject the all-frames probe and return the resolved game board, or null if none is found (after a few retries to let the board iframe finish loading). Returns null — never throws — on non-injectable pages (e.g. chrome://). */
async function probeGameFrame(tabId: number, retries: number): Promise<GameFrame | null> {
  for (let attempt = 0; ; attempt++) {
    let results: chrome.scripting.InjectionResult[];
    try {
      results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeGameTable, world: "MAIN" });
    } catch {
      return null;
    }
    const game = selectGameFrame(results.map((result) => result.result as FrameProbe | undefined));
    if (game || attempt >= retries) return game;
    await delay(PROBE_RETRY_MS);
  }
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

/**
 * Light the icon when the tab has a supported game board (in any frame) with a valid player count.
 * Returns the resolved game board (or null) so callers can also drive time tracking from its URL —
 * the board's frame URL carries the game slug that the /tableview shell URL lacks.
 */
async function updateIcon(tabId: number, url: string | undefined): Promise<GameFrame | null> {
  if (!isPotentialTablePage(url)) {
    iconController.run(tabId, iconController.getFrame() > 0 ? FADE_OUT : INSTANT_NORMAL);
    return null;
  }
  const game = await probeGameFrame(tabId, ICON_PROBE_RETRIES);
  const isGame = !!game && (SUPPORTED_GAMES as readonly string[]).includes(game.gameName) && isValidPlayerCount(game.gameName as GameName, game.playerCount);
  if (isGame) {
    if (iconController.getTabFrame(tabId) > 0) {
      iconController.run(tabId, INSTANT_LIT);
    } else {
      iconController.run(tabId, sidePanelOpen ? FLASH_SHORT : FLASH_FULL);
    }
  } else {
    iconController.run(tabId, iconController.getFrame() > 0 ? FADE_OUT : INSTANT_NORMAL);
  }
  return game;
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

// ---------------------------------------------------------------------------
// In-page game log
// ---------------------------------------------------------------------------

/** Concatenated in the order the cascade needs: shared geometry, shared rows, in-page overrides. */
const INPAGE_LOG_CSS = `${cardTipCss}\n${turnHistoryCss}\n${inPageLogCss}`;

/** Hydrated at startup and kept current by storage.onChanged, so gating can read it synchronously. */
let inPageLogSettings: InPageSettings = { ...INPAGE_DEFAULTS };
/** In-flight or completed stylesheet injection per tab, so every push can await the same one. */
const inPageLogStyles = new Map<number, Promise<unknown>>();
/**
 * Tabs currently showing BGA's log instead of the turn history.
 *
 * Deliberately in-memory and per-tab rather than in storage: the in-page bulb is a temporary
 * override, while `inPageLogSettings.enabled` is the default re-applied whenever a table opens.
 * Losing this to a service-worker eviction is correct — it falls back to the default.
 */
const inPageLogCollapsedTabs = new Set<number>();
/**
 * Per-tab window size, when widened past the stored default via the in-page "more..." control.
 *
 * Session state for the same reason as the collapsed set: widening is a temporary look further
 * back, not a new preference. Cleared on navigation, so a reload or a different table starts
 * from `INPAGE_LOG_HALF_TURNS` again.
 */
const inPageLogHalfTurns = new Map<number, number>();
/** In-flight or completed compact-header stylesheet injection per tab. Same contract as the log's. */
const compactHeaderStyles = new Map<number, Promise<unknown>>();
/** In-flight or completed simplified-card stylesheet injection per tab. Same contract as the log's. */
const simplifiedCardsStyles = new Map<number, Promise<unknown>>();

/**
 * Drop every per-tab in-page override.
 *
 * One helper rather than a delete per collection at each call site: the stylesheet cache was once
 * cleared on only one of the navigation paths, which left the log rendering unstyled on the way
 * back into a table. Anything added here must be dropped through this helper for the same reason.
 */
function forgetInPageTab(tabId: number): void {
  inPageLogStyles.delete(tabId);
  inPageLogCollapsedTabs.delete(tabId);
  inPageLogHalfTurns.delete(tabId);
  compactHeaderStyles.delete(tabId);
  simplifiedCardsStyles.delete(tabId);
}

/**
 * Inject a stylesheet once per tab per service-worker lifetime, awaiting the same injection on
 * every push.
 *
 * The *promise* is cached rather than a "styled" boolean: marking the tab styled when the injection
 * starts lets a second push overtake the first one's CSS, and the resulting flash of unstyled
 * markup looks intermittent because it depends on which push wins. On failure the entry is dropped,
 * so the next push retries rather than leaving the tab permanently unstyled.
 *
 * `css` is a callback rather than a string so a stylesheet that has to be built — the simplified
 * cards inline their fonts as `data:` URIs — is built only when a tab actually needs it.
 */
async function ensureStyles(cache: Map<number, Promise<unknown>>, tabId: number, css: () => string | Promise<string>): Promise<void> {
  let styles = cache.get(tabId);
  if (!styles) {
    styles = Promise.resolve(css()).then((text) => chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, css: text }));
    cache.set(tabId, styles);
  }
  try {
    await styles;
  } catch {
    cache.delete(tabId);
  }
}

/**
 * Render turn history in the service worker and push the rows into the page.
 *
 * Rendering here rather than in the page keeps the 240 KB card database out of BGA's document —
 * only finished HTML crosses the boundary, as executeScript arguments.
 */
async function pushInPageLog(tabId: number): Promise<void> {
  if (!inPageLogSettings.enabled) return;
  if (!lastResults || lastResults.gameName !== "innovation" || !lastResults.gameLog) {
    // Frame-commit hiding may already have run for this tab, so never just bail — that would
    // leave BGA's log hidden with nothing in its place and no control to bring it back.
    unmountInPageLog(tabId);
    return;
  }

  const halfTurns = inPageLogHalfTurns.get(tabId) ?? INPAGE_LOG_HALF_TURNS;
  let rows: { key: string; html: string }[];
  let atEnd = true;
  try {
    const gameLog = lastResults.gameLog;
    const players = Object.values(gameLog.players);
    const windowed = recentTurns(gameLog.actions, halfTurns);
    // recentTurns returns everything once the requested half-turns exceed what was played, so an
    // equal length means the window already covers the whole history.
    atEnd = windowed.length === gameLog.actions.length;
    rows = renderTurnHistoryRows(windowed, cardDb, players, { newestFirst: true, popoverTips: true, rowKeys: true, timeOnly: true });
  } catch (err) {
    // renderTurnHistoryRows throws on an action referencing an unknown player id. Never let that
    // take down the service worker.
    console.warn("[inpage-log] render failed:", err);
    return;
  }

  const opts = { enabled: true, collapsed: inPageLogCollapsedTabs.has(tabId), showPlayerNames: inPageLogSettings.showPlayerNames, halfTurns, hasMore: !atEnd };

  // The stylesheet must land before the rows, or the turn history renders as unstyled text —
  // both player-name spans visible, narration unindented — until the CSS catches up.
  await ensureStyles(inPageLogStyles, tabId, () => INPAGE_LOG_CSS);

  // chrome-types declares `func` as `() => void`, so the arg-taking form needs a cast — the same
  // workaround the world/ISOLATED injections already use.
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: inPageLogFunction as unknown as () => void, args: [rows, opts], world: "ISOLATED" as chrome.scripting.ExecutionWorld }).catch(() => {});
}

/** Just the hiding rule, injected at frame-commit time so BGA's log never paints. */
const EARLY_HIDE_CSS = "html.bgaa-hide-bga-log #logs { display: none !important; }";

/**
 * Injected at frame-commit to hide BGA's log before it renders. Self-contained.
 *
 * Adds the same class the mount function manages, so switching to BGA's log later removes it
 * and both this rule and the full stylesheet stop applying.
 */
export function hideBgaLogEarlyFunction(): void {
  document.documentElement.classList.add("bgaa-hide-bga-log");
}

/** Remove the in-page log from a tab, restoring BGA's own log. */
function unmountInPageLog(tabId: number): void {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: inPageLogFunction as unknown as () => void,
    args: [[], { enabled: false, collapsed: false, showPlayerNames: false, halfTurns: INPAGE_LOG_HALF_TURNS, hasMore: false }],
    world: "ISOLATED" as chrome.scripting.ExecutionWorld,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Compact table header
// ---------------------------------------------------------------------------

/**
 * Apply or undo the compact header on a tab.
 *
 * Deliberately independent of extraction: the header needs nothing from the game log, only an
 * Innovation board to rearrange. Gating it on results would tie a purely visual change to the
 * side panel being open or the in-page log being on.
 *
 * All frames, as with the log — the board lives in an iframe under BGA's /tableview shell, and the
 * injected function bails in every frame that is not an Innovation board.
 */
async function pushCompactHeader(tabId: number, enabled: boolean): Promise<void> {
  // Read at push time rather than passed in: every caller wants whatever is stored right now.
  const progressionOnly = inPageLogSettings.progressionOnly;
  // The stylesheet must land before the DOM moves, or the row renders with BGA's status bar still
  // taking up its own line.
  if (enabled) await ensureStyles(compactHeaderStyles, tabId, () => compactHeaderCss);

  // Undoing needs no stylesheet: the injected function removes the root class every rule hangs off.
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: compactHeaderFunction as unknown as () => void, args: [{ enabled, progressionOnly }], world: "ISOLATED" as chrome.scripting.ExecutionWorld }).catch(() => {});
}

/**
 * The simplified-card stylesheet with its assets inlined, built once per service-worker lifetime.
 *
 * Everything it references has to arrive as a `data:` URI. BGA serves a Content-Security-Policy
 * whose `font-src` allows its own hosts, a handful of font CDNs and `data:`, but no extension
 * scheme — so a font at a `chrome-extension://` URL is refused by the page no matter that the
 * stylesheet was injected by the extension, and the cards fall back to a system font. `data:` is
 * the one source on that list this can use.
 *
 * The promise is cached rather than the string, so overlapping pushes share one read instead of
 * racing to do the same work.
 */
let simplifiedCardsCssReady: Promise<string> | null = null;

/** Read a packaged file and return it as a base64 `data:` URI. */
async function packagedDataUrl(path: string, mimeType: string): Promise<string> {
  const response = await fetch(chrome.runtime.getURL(path));
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Chunked rather than one spread: a whole font passed as arguments overflows the call stack.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function buildSimplifiedCardsCss(): Promise<string> {
  if (!simplifiedCardsCssReady) {
    simplifiedCardsCssReady = (async () => {
      // Only the fonts are read from disk: the stylesheet's own marks are inline SVG, small enough
      // to live in the CSS and drawn here rather than taken from BGA or the panel.
      const [russoOne, barlowCondensed] = await Promise.all([
        packagedDataUrl("assets/fonts/russo-one-regular.woff2", "font/woff2"),
        packagedDataUrl("assets/fonts/barlow-condensed-regular.woff2", "font/woff2"),
      ]);
      return simplifiedCardsCss
        .replaceAll("__BGAA_FONT_RUSSO_ONE__", russoOne)
        .replaceAll("__BGAA_FONT_BARLOW_CONDENSED__", barlowCondensed);
    })().catch((err) => {
      // Let the next push retry rather than caching a failure for the worker's lifetime.
      simplifiedCardsCssReady = null;
      throw err;
    });
  }
  return simplifiedCardsCssReady;
}

/**
 * Swap Innovation's table cards between BGA's illustrated ones and the side panel's compact ones.
 *
 * Independent of extraction for the same reason as the compact header: it needs nothing from the
 * game log, only an Innovation board to restyle, and the injected function bails in every frame
 * that is not one.
 *
 * The stylesheet carries its fonts and icon marks inlined as `data:` URIs, the only source BGA's
 * own Content-Security-Policy leaves open to them.
 */
async function pushSimplifiedCards(tabId: number, enabled: boolean): Promise<void> {
  // Read at push time rather than passed in: every caller wants whatever is stored right now.
  const scale = inPageLogSettings.cardScale;
  const echoText = inPageLogSettings.echoText;
  // The stylesheet must land before the layout does: the injected function hands the relayout to
  // BGA, which measures the cards as it re-places them.
  if (enabled) await ensureStyles(simplifiedCardsStyles, tabId, buildSimplifiedCardsCss);

  // Undoing needs no stylesheet: the injected function puts BGA's own layout constants back and
  // removes the root class every rule hangs off.
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: simplifiedCardsFunction as unknown as () => void, args: [{ enabled, scale, echoText }], world: "MAIN" as chrome.scripting.ExecutionWorld }).catch(() => {});
}

/**
 * Every BGA tab that is open, so a settings change can reach all of them.
 *
 * These two features are per-page state the service worker pushes, and pushing to the active tab
 * alone leaves a table in any other tab — or another window — showing the old setting until it
 * reloads. That is easy to hit with two tables open, and reads as the setting not working at all.
 *
 * Broadcast on change rather than re-pushed on every activation: a change is rare and a tab switch
 * is not, and this way a background table is already correct when it comes to the front rather than
 * being fixed up as it does.
 */
async function inPageTargetTabs(): Promise<number[]> {
  // The active tab is always included, never merely because the query found it: that is the one the
  // user is looking at, and it must still be updated if the query fails or the permission is absent.
  const tabIds = new Set<number>();
  if (activeTabId !== null) tabIds.add(activeTabId);
  try {
    const tabs = await chrome.tabs.query({ url: ["https://boardgamearena.com/*", "https://*.boardgamearena.com/*"] });
    for (const tab of tabs) { if (tab.id !== undefined) tabIds.add(tab.id); }
  } catch { /* the active tab alone, then */ }
  return [...tabIds];
}

/**
 * Send a per-page setting to every open BGA tab.
 *
 * These features are page state rather than panel state, so pushing to the active tab alone leaves a
 * table in any other tab — or another window — showing the old setting until it reloads, which reads
 * as the switch simply not working.
 *
 * `freshlyEnabled` drops the cached stylesheet injection first: the tab may well have reloaded while
 * the feature was off, and injected CSS does not survive a document navigation.
 */
function broadcastInPageSetting(cache: Map<number, Promise<unknown>>, push: (tabId: number, enabled: boolean) => Promise<void>, enabled: boolean, freshlyEnabled: boolean): void {
  void inPageTargetTabs().then((tabIds) => {
    for (const tabId of tabIds) {
      if (freshlyEnabled) cache.delete(tabId);
      void push(tabId, enabled);
    }
  });
}

function injectWatcher(tabId: number): void {
  // All frames: the live log container (#logs / #game_play_area) lives in the board iframe under the
  // /tableview shell. watcherFunction self-bails in frames without a log container, so only the board
  // frame ends up observing.
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: watcherFunction, world: "ISOLATED" as any });
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
  if (extracting || !hasConsumer() || liveTabId === null) return;
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
  extractFromTab(liveTabId, liveTableNumber, true)
    .then(() => {
      const newPacketCount = lastResults?.rawData?.packets?.length ?? 0;
      if (newPacketCount !== previousPacketCount) {
        chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
        // sendMessage reaches extension pages only, never a content script, so the in-page log
        // needs its own push.
        if (liveTabId !== null) void pushInPageLog(liveTabId);
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
      if (hasConsumer() && pending !== null) {
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
  const info = url ? parseGameTableUrl(url) : null;
  if (!info) {
    return { action: "showHelp", url: url ?? "" };
  }
  const tableNumber = String(info.tableId);
  if (!(SUPPORTED_GAMES as readonly string[]).includes(info.gameName)) {
    return { action: "unsupportedGame", tableNumber, gameName: info.gameName };
  }
  return { action: "extract", tableNumber, gameName: info.gameName as GameName };
}

/**
 * Whether a URL could host a BGA game board — a BGA page carrying a table id. Covers the classic game
 * URL (/<gameId>/<slug>?table=) and the modern /tableview?table= shell that embeds the board in an
 * iframe. Excludes the classic /table?table= page: that's the pre-game lobby/management view, which
 * never hosts a board, so it resolves to help immediately instead of flashing a spinner and burning
 * extraction retries. The game slug isn't knowable from the /tableview shell URL, so the actual game is
 * resolved by probing the tab's frames; this gate just decides when that probe is worth doing.
 */
export function isPotentialTablePage(url: string | undefined): boolean {
  if (!url || !BGA_DOMAIN_PATTERN.test(url) || !/[?&]table=\d+/.test(url)) return false;
  if (/^https:\/\/[^/]+\/table\?/.test(url)) return false; // /table?table= is the lobby, not a board
  return true;
}

/** The table id from a BGA URL's query string, or null. */
function tableNumberFromUrl(url: string | undefined): string | null {
  const match = url?.match(/[?&]table=(\d+)/);
  return match ? match[1] : null;
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
 * Pick the game board's extraction (the frame whose script found the BGA framework) from per-frame
 * results. Returns the board's rawData when a frame succeeded; otherwise reports a real board error
 * (gameui present but extraction failed) if one was seen, so the caller can distinguish that from
 * "no frame was the board" (the shell/loader frames return { notGame } and are skipped silently).
 */
function pickExtraction(results: chrome.scripting.InjectionResult[]): { rawData: RawExtractionData | null; boardError: string | null } {
  let boardError: string | null = null;
  for (const result of results) {
    const value = result.result as Record<string, unknown> | undefined;
    if (value && !value.error && !value.notGame && typeof value.gameName === "string") return { rawData: value as unknown as RawExtractionData, boardError };
    if (value?.error && typeof value.msg === "string") boardError = value.msg;
  }
  return { rawData: null, boardError };
}

/**
 * Inject extract.js into every frame, pick the game board's data, run the pipeline (for supported
 * games), and notify the side panel. The board is iframed under the /tableview shell in BGA's modern
 * layout, so injection targets all frames and the game frame is the one whose script finds the BGA
 * framework; the game slug comes from that frame's data, not the (slug-less) shell URL. Retries a few
 * times to let the board iframe finish loading. Shared by click, navigation, and live paths.
 *
 * Returns false when no game board is found in any frame (a non-game page, or a table shell whose
 * board hasn't loaded) — callers fall back to the help view. Throws only when the pipeline rejects a
 * supported game (e.g. an invalid player count); lastResults then holds the raw data for download.
 */
async function extractFromTab(tabId: number, tableNumber: string, skipNotify = false): Promise<boolean> {
  let rawData: RawExtractionData | null = null;
  let boardError: string | null = null;
  for (let attempt = 0; attempt <= EXTRACT_RETRIES; attempt++) {
    const extractionPromise = chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["dist/extract.js"], world: "MAIN" });
    extractionPromise.catch(() => {}); // suppress unhandled rejection if it settles after the timeout
    const results = await Promise.race([extractionPromise, timeout(EXTRACTION_TIMEOUT_MS, "Extraction timed out")]) as chrome.scripting.InjectionResult[];
    const picked = pickExtraction(results);
    if (picked.rawData) { rawData = picked.rawData; break; }
    boardError = picked.boardError ?? boardError; // sticky: a later all-notGame attempt can't erase a real error
    if (attempt < EXTRACT_RETRIES) await delay(PROBE_RETRY_MS);
  }
  if (!rawData) {
    // A board frame that reported a real error (gameui present but extraction failed) is surfaced so the
    // click/live paths show it (ERR badge / gameError); every frame merely "not the board" (shell/loader)
    // falls back to the help view.
    if (boardError) {
      // No frame produced data, so there's nothing to offer for download — clear lastResults so the click
      // path's gameError can't forward (and re-offer the download of) a *previous* table's stale results.
      lastResults = null;
      throw new Error("Extraction failed: " + boardError);
    }
    console.log("[extract] no game board found in any frame");
    return false;
  }

  const gameName = rawData.gameName;
  recordTableMode(tableNumber, rawData);
  recordTableType(Number(tableNumber), tabId);

  if ((SUPPORTED_GAMES as readonly string[]).includes(gameName)) {
    try {
      lastResults = runPipeline(rawData, cardDb, tableNumber, gameName as GameName);
    } catch (err) {
      // Preserve raw data for download even when the pipeline fails.
      lastResults = { gameName, tableNumber, rawData, gameLog: null, gameState: null };
      throw err;
    }
    console.log("Pipeline complete:", Object.keys(lastResults));
    if (hasConsumer()) injectWatcher(tabId);
  } else {
    lastResults = { gameName, tableNumber, rawData, gameLog: null, gameState: null };
    stopLiveTracking("unsupported game");
  }

  lastExtractionTime = Date.now();
  if (!skipNotify) chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
  void pushInPageLog(tabId);
  return true;
}

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------

/**
 * Evaluate a tab and update side panel content accordingly: extract and process a game board (in any
 * frame), or fall back to the help view. Throws only on a pipeline error for a supported game —
 * callers handle that error display.
 */
async function resolveContent(tabId: number, tabUrl: string, source: ExtractionSource): Promise<void> {
  if (!isPotentialTablePage(tabUrl)) {
    lastResults = null;
    stopLiveTracking(source + ": not a game");
    chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    return;
  }

  const tableNumber = tableNumberFromUrl(tabUrl) ?? "unknown";
  if (shouldShowLoading(source) && lastResults?.tableNumber !== tableNumber) {
    chrome.runtime.sendMessage({ type: "loading" }).catch(() => {});
  }

  const found = await extractFromTab(tabId, tableNumber);
  if (!found) {
    lastResults = null;
    stopLiveTracking(source + ": no game board");
    chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Chrome event listeners
// ---------------------------------------------------------------------------

// Track side panel open/close via port connection
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== "sidepanel") return;
  console.log("[live] port connected, was sidePanelOpen=", sidePanelOpen);
  sidePanelOpen = true;

  // Check the active tab and either push cached results (same table) or
  // trigger a fresh extraction (different table or no cached results).
  chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return;
    activeTabId = tab.id;

    // If cached results match the active tab's table, push them immediately
    const activeTable = tableNumberFromUrl(tab.url);
    if (lastResults && lastResults.tableNumber === activeTable) {
      chrome.runtime.sendMessage({ type: "resultsReady", results: lastResults }).catch(() => {});
      return;
    }

    // Different table or no cached results — extract fresh data.
    // "reopen" shows loading (user navigated while panel was closed);
    // "reconnect" does not (SW restart on the same table).
    if (!extracting) {
      const source: ExtractionSource = lastResults ? "reopen" : "reconnect";
      extracting = true;
      try {
        await resolveContent(tab.id, tab.url, source);
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
    // The in-page log is still consuming results, so closing the panel must not stop the
    // tracking it depends on.
    if (hasConsumer()) console.log("[live] kept alive for in-page log");
    else stopLiveTracking("port disconnect");
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

    // Non-table pages resolve immediately without badge
    if (!isPotentialTablePage(tab.url)) {
      await resolveContent(tabId, tab.url ?? "", "click");
      return;
    }

    // A table page — extract (the board may be a supported game, an unsupported game, or still loading)
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
    if (hasConsumer() && pending !== null) {
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
// Navigation handler (shared by tab-switch, same-tab navigation, and focus change)
// ---------------------------------------------------------------------------

async function handleNavigation(initialTabId: number, source: ExtractionSource = "navigation"): Promise<void> {
  let tabId = initialTabId;
  while (true) {
    extracting = true;
    try {
      const tab = await chrome.tabs.get(tabId);
      console.log("[nav] handleNavigation: tab", tabId, "url=", tab.url, "status=", tab.status, "pinMode=", pinMode);
      if (tab.status !== "complete") { console.log("[nav] handleNavigation: tab not complete, break"); break; }

      // Auto-close when pin mode requires it
      const nav = classifyNavigation(tab.url);
      console.log("[nav] handleNavigation: classified as", nav.action, "shouldAutoClose=", shouldAutoClose(tab.url, pinMode));
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

      await resolveContent(tabId, tab.url ?? "", source);

      // autohide-game also closes on an unsupported game whose identity only became known after extraction:
      // the slug-less /tableview shell URL doesn't reveal it, so the pre-extraction check above (which keys
      // off the URL) can't. lastResults holds the game resolved by resolveContent.
      if (pinMode === "autohide-game" && lastResults && !(SUPPORTED_GAMES as readonly string[]).includes(lastResults.gameName)) {
        try {
          await chrome.sidePanel.close({ windowId: tab.windowId });
        } catch (err) {
          console.warn("Could not close side panel:", err);
        }
        // extractFromTab already stopped live tracking for the unsupported game before lastResults was set.
        lastResults = null;
        updateIcon(tabId, tab.url);
        break;
      }
    } catch (err) {
      console.warn("Navigation error:", err);
      lastResults = null;
      stopLiveTracking("navigation: error");
      chrome.runtime.sendMessage({ type: "notAGame" }).catch(() => {});
    } finally {
      extracting = false;
    }
    const pending = pendingNavTabId;
    pendingNavTabId = null;
    if (!hasConsumer() || pending === null) break;
    tabId = pending;
  }
}

// React to tab switching
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  // Update lit icon based on whether tab is a supported game
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const game = await updateIcon(activeInfo.tabId, tab.url);
    if (activeInfo.tabId !== activeTabId) return; // a newer activation superseded this one while probing
    trackTime(game, tab.url, tab.title);
    maybeBgaSync(activeInfo.tabId, tab.url);
    syncHeartbeatAlarm();
  } catch { /* tab may have been closed */ }
  if (!hasConsumer()) { console.log("[nav] onActivated: no consumer, skip"); return; }
  if (extracting) {
    console.log("[nav] onActivated: extracting, queued tab", activeInfo.tabId);
    pendingNavTabId = activeInfo.tabId;
    return;
  }
  console.log("[nav] onActivated: handleNavigation tab", activeInfo.tabId);
  handleNavigation(activeInfo.tabId);
});

// React to same-tab navigation (page load complete or SPA pushState)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Injected CSS does not survive a document navigation, and the temporary view switch is
  // scoped to a table. Both are dropped the moment the tab starts navigating — not only in the
  // webNavigation path, which does not cover every way back into a table (leaving to the table
  // list and re-entering would otherwise render unstyled, the stylesheet being wrongly cached).
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    forgetInPageTab(tabId);
  }
  if (tabId !== activeTabId) return;
  // Full page load: status goes "loading" → "complete"; react to "complete".
  // SPA navigation (BGA uses pushState): only url changes, no status field.
  // Skip "loading" events (page not ready) and irrelevant changes (title, favicon).
  const isPageLoadComplete = changeInfo.status === "complete";
  const isSpaNavigation = changeInfo.url !== undefined && changeInfo.status === undefined;
  if (!isPageLoadComplete && !isSpaNavigation) return;
  console.log("[nav] onUpdated: triggered", isPageLoadComplete ? "pageLoad" : "SPA", changeInfo.url ?? "");
  // Update lit icon based on whether tab is a supported game
  chrome.tabs.get(tabId).then(async (tab) => {
    const game = await updateIcon(tabId, tab.url);
    if (tabId !== activeTabId) return; // the active tab changed while the board was resolving
    trackTime(game, tab.url, tab.title);
    maybeBgaSync(tabId, tab.url);
    syncHeartbeatAlarm();
  }).catch(() => {});
  if (!hasConsumer()) { console.log("[nav] onUpdated: no consumer, skip. sidePanelOpen=", sidePanelOpen, "inPageLog=", inPageLogSettings.enabled, "tabId=", tabId, "activeTabId=", activeTabId); return; }
  if (extracting) {
    console.log("[nav] onUpdated: extracting, queued tab", tabId);
    pendingNavTabId = tabId;
    return;
  }
  console.log("[nav] onUpdated: handleNavigation tab", tabId);
  handleNavigation(tabId);
});

// Hide BGA's log as its board frame commits, before it can paint. Waiting for the mount would
// show BGA's log first and swap it out a second later — a visible flash, since extraction has to
// fetch and process the whole notification history before it can render anything.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!inPageLogSettings.enabled || inPageLogCollapsedTabs.has(details.tabId)) return;
  const boardInfo = parseGameTableUrl(details.url);
  if (!boardInfo || boardInfo.gameName !== "innovation") return;
  const target = { tabId: details.tabId, frameIds: [details.frameId] };
  chrome.scripting.insertCSS({ target, css: EARLY_HIDE_CSS }).catch(() => {});
  chrome.scripting.executeScript({ target, func: hideBgaLogEarlyFunction, world: "ISOLATED" as chrome.scripting.ExecutionWorld }).catch(() => {});
}, { url: [{ hostSuffix: "boardgamearena.com" }] });

// React to a game board FRAME finishing load. BGA embeds the board in an iframe under the /tableview
// shell page, and sub-frame loads do NOT fire chrome.tabs.onUpdated — so without this the toolbar icon
// would miss the late-loading iframe and stay dark (until the next focus/activate re-probes), most
// noticeably while the side panel is closed. When the active tab's board frame finishes loading, the
// probe can finally see gameui, so re-light the icon.
chrome.webNavigation.onCompleted.addListener((details) => {
  const boardInfo = parseGameTableUrl(details.url);
  if (!boardInfo) return; // only the real game-board frame, not the /tableview shell or loader
  // The compact header comes first and answers to neither gate below: it consumes no extraction
  // results, so it needs no consumer, and a table sitting in a background tab should come back to
  // the same layout as the one in front. It waits for the frame to finish because it rearranges
  // what BGA rendered — Innovation's own board buttons arrive later still, which the injected
  // function watches for itself.
  if (inPageLogSettings.compactHeader) {
    // Every game, not just the supported ones: the header this folds is BGA's own framework, the
    // same on every table, and `parseGameTableUrl` has already confirmed this is a board frame.
    // This frame is new, so it carries none of the CSS injected into its predecessor — and the
    // per-tab cleanup further down runs only when a consumer exists, which the header never needs.
    compactHeaderStyles.delete(details.tabId);
    void pushCompactHeader(details.tabId, true);
  }
  // Same story, and for the same reasons: no consumer needed, and a fresh frame carries none of the
  // CSS injected into the one it replaced. The injected function waits for Innovation's zones itself.
  if (inPageLogSettings.simplifiedCards) {
    simplifiedCardsStyles.delete(details.tabId);
    void pushSimplifiedCards(details.tabId, true);
  }
  if (details.tabId !== activeTabId) return;
  chrome.tabs.get(details.tabId).then(async (tab) => {
    const game = await updateIcon(details.tabId, tab.url);
    if (details.tabId !== activeTabId) return; // tab switched while the board was resolving
    // This is also the only event that fires when a board iframe finishes loading after its /tableview
    // shell, so it's where a late-resolving board must (re)attribute the play-time session — otherwise the
    // tracker stays on the previous table while the new one is played.
    trackTime(game, tab.url, tab.title);
    syncHeartbeatAlarm();
    // Same story for the panel's content: the board iframe loads after its /tableview shell reports
    // complete, so the tabs.onUpdated-driven extraction can run (and give up ~1.4s later) before gameui
    // exists — leaving an open panel stuck on the help/not-a-game view even as the icon lights from this
    // very event. Now that the board frame is actually ready, re-resolve the panel content too, unless it's
    // already resolved for this table. Mirrors the onUpdated/onActivated queueing so it can't race a
    // concurrent extraction.
    if (!hasConsumer()) return;
    // Opening a table re-applies the stored default, discarding any temporary view switch, and
    // the freshly loaded frame carries none of the previously injected CSS.
    forgetInPageTab(details.tabId);
    if (lastResults?.tableNumber === String(boardInfo.tableId)) {
      // Results are still valid, but the board frame just reloaded, so its DOM no longer holds
      // the in-page log. Re-push before taking the cached-results short-circuit.
      void pushInPageLog(details.tabId);
      return;
    }
    if (extracting) { pendingNavTabId = details.tabId; return; }
    handleNavigation(details.tabId);
  }).catch(() => {});
}, { url: [{ hostSuffix: "boardgamearena.com" }] });

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetInPageTab(tabId);
  if (tabId === activeTabId) {
    timeTracker.handleFocusChange(null);
    syncHeartbeatAlarm();
  }
});

// React to window focus changes (switching between Chrome windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    timeTracker.handleFocusChange(null);
    syncHeartbeatAlarm();
    return;
  }
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, windowId });
  } catch { return; }
  const tab = tabs[0];
  if (!tab?.id) return;
  activeTabId = tab.id;
  const game = await updateIcon(tab.id, tab.url);
  if (tab.id !== activeTabId) return; // focus moved again while the board was resolving
  trackTime(game, tab.url, tab.title);
  syncHeartbeatAlarm();
  if (!hasConsumer()) return;
  if (extracting) {
    pendingNavTabId = tab.id;
    return;
  }
  handleNavigation(tab.id, "focus");
});

// Hydrate the in-page log settings and keep them current. Gating (hasConsumer) reads these
// synchronously, so they are mirrored into a module-level copy rather than awaited per call.
void loadInPageSettings().then((settings) => {
  inPageLogSettings = settings;
  if (activeTabId === null) return;
  if (settings.enabled) void pushInPageLog(activeTabId);
  // A table can already be open when the service worker starts (an extension reload, or its first
  // wake after install), and no navigation event will follow to fold its header.
  if (settings.compactHeader) void pushCompactHeader(activeTabId, true);
  if (settings.simplifiedCards) void pushSimplifiedCards(activeTabId, true);
});

subscribeInPageSettings((settings) => {
  const wasEnabled = inPageLogSettings.enabled;
  const wasCompactHeader = inPageLogSettings.compactHeader;
  const wasProgressionOnly = inPageLogSettings.progressionOnly;
  const wasSimplifiedCards = inPageLogSettings.simplifiedCards;
  const wasCardScale = inPageLogSettings.cardScale;
  const wasEchoText = inPageLogSettings.echoText;
  inPageLogSettings = settings;
  if (settings.compactHeader !== wasCompactHeader || settings.progressionOnly !== wasProgressionOnly) {
    broadcastInPageSetting(compactHeaderStyles, pushCompactHeader, settings.compactHeader, settings.compactHeader && !wasCompactHeader);
  }
  // A size or echo-text change re-pushes too: the stylesheet reads both from what the injected
  // function publishes, and only it can restate BGA's own layout constants at the new scale.
  if (settings.simplifiedCards !== wasSimplifiedCards || (settings.simplifiedCards && (settings.cardScale !== wasCardScale || settings.echoText !== wasEchoText))) {
    broadcastInPageSetting(simplifiedCardsStyles, pushSimplifiedCards, settings.simplifiedCards, settings.simplifiedCards && !wasSimplifiedCards);
  }
  if (activeTabId === null) return;
  if (!settings.enabled) {
    if (wasEnabled) unmountInPageLog(activeTabId);
    return;
  }
  // Re-inject the stylesheet on re-enable: the tab may have reloaded while it was off.
  if (!wasEnabled) inPageLogStyles.delete(activeTabId);
  void pushInPageLog(activeTabId);
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
    } else if (message.type === "setPinMode") {
      if (typeof message.mode !== "string" || !VALID_PIN_MODES.has(message.mode)) { sendResponse(false); return; }
      pinMode = message.mode as PinMode;
      // Persisted by sidepanel via localStorage; background only keeps in-memory copy.
      sendResponse(true);
    } else if (message.type === "setInPageLog") {
      // Sent by the in-page header controls, the only way to reach these while the side panel
      // is closed. The view switch is a temporary per-tab override and never persists; anything
      // else is a stored default, written to storage so the onChanged listener re-pushes.
      // collapsed and halfTurns are session-only overrides, not part of the stored settings.
      const patch = { ...(message.patch ?? {}) } as Partial<InPageSettings> & { collapsed?: boolean; halfTurns?: number };
      const tabId = sender.tab?.id;
      let pushNeeded = false;
      if (typeof patch.collapsed === "boolean" && tabId !== undefined) {
        if (patch.collapsed) inPageLogCollapsedTabs.add(tabId);
        else inPageLogCollapsedTabs.delete(tabId);
        pushNeeded = true;
      }
      if (typeof patch.halfTurns === "number" && tabId !== undefined) {
        inPageLogHalfTurns.set(tabId, patch.halfTurns);
        pushNeeded = true;
      }
      if (pushNeeded && tabId !== undefined) void pushInPageLog(tabId);
      delete patch.collapsed;
      delete patch.halfTurns;
      if (Object.keys(patch).length > 0) void saveInPageSettings(patch);
    } else if (message.type === "gameLogChanged") {
      if (sender.tab?.id !== liveTabId) { console.log("[live] ignored: sender tab", sender.tab?.id, "!= liveTabId", liveTabId); return; }
      triggerLiveExtraction();
    } else if (message.type === "resetTimeTracking") {
      timeTracker.reset();
      chrome.alarms.clear(HEARTBEAT_ALARM);
      chrome.alarms.clear(IDLE_FINALIZE_ALARM);
    }
    return undefined;
  },
);
