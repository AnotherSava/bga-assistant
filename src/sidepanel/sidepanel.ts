// Side panel: receives data from background, renders summary, handles downloads.

import JSZip from "jszip";
import { renderSummary, renderFullPage, renderTurnHistory, setAssetResolver } from "../games/innovation/render.js";
import { buildInnovationDisplayMenu, applyInnovationDisplayOptions } from "../games/innovation/display.js";
import { buildAzulDisplayMenu, applyAzulDisplayOptions } from "../games/azul/display.js";
import { recentTurns } from "../games/innovation/turn_history.js";
import { renderHelp } from "../render/help.js";
import { applyToggleMode } from "../render/toggle.js";
import { CardDatabase, type GameName } from "../models/types.js";
import { GameEngine } from "../games/innovation/game_engine.js";
import { fromJSON as innovationFromJSON } from "../games/innovation/serialization.js";
import { renderAzulSummary, renderAzulFullPage, setAssetResolver as setAzulAssetResolver } from "../games/azul/render.js";
import { renderCrewSummary, renderCrewFullPage } from "../games/crew/render.js";
import { crewFromJSON } from "../games/crew/serialization.js";
import "../games/azul/styles.css";
import "../games/crew/styles.css";
import { fromJSON as azulFromJSON } from "../games/azul/game_state.js";
import type { PipelineResults } from "../pipeline.js";
import type { PinMode } from "../background.js";
import type { Granularity, SessionFilter, TimeSession } from "../time-tracking.js";
import { loadSetting, saveSetting } from "./settings.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentResults: PipelineResults | null = null;
let currentCss: string | null = null;
let cachedCardDb: CardDatabase | null = null;
let disconnectTimer: number | undefined;
let currentExpansions: { echoes: boolean; relics: boolean } = { echoes: false, relics: false };

const KEY_PIN_MODE = "bgaa_pin_mode";
const PIN_MODE_DEFAULT: PinMode = "pinned";
let currentPinMode: PinMode = loadSetting(KEY_PIN_MODE, PIN_MODE_DEFAULT);

// ---------------------------------------------------------------------------
// Asset URL resolution for Chrome extension context
// ---------------------------------------------------------------------------

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  setAssetResolver((path: string) => chrome.runtime.getURL(path));
  setAzulAssetResolver((path: string) => chrome.runtime.getURL(path));
}

// Establish a port to the background script so it can track side panel open/close.
// Reconnect on disconnect (service worker restart) to keep sidePanelOpen accurate.
if (typeof chrome !== "undefined" && chrome.runtime?.connect) {
  const connectToBackground = (): void => {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined; }
    try {
      console.log("[panel] connecting to background...");
      const port = chrome.runtime.connect(undefined, { name: "sidepanel" });
      console.log("[panel] port connected");
      // Re-push persisted pin mode after service worker restart
      chrome.runtime.sendMessage({ type: "setPinMode", mode: currentPinMode }).catch(() => {});
      port.onDisconnect.addListener(() => {
        console.log("[panel] port disconnected, reconnecting in 1s");
        disconnectTimer = window.setTimeout(() => {
          const indicator = document.getElementById("live-indicator");
          if (indicator && indicator.style.display !== "none") {
            indicator.classList.add("disconnected");
          }
        }, 3000);
        setTimeout(connectToBackground, 1000);
      });
    } catch (err) {
      // Extension context invalidated (e.g. after update/uninstall); stop reconnecting.
      console.log("[panel] connect failed (context invalidated):", err);
    }
  };
  connectToBackground();
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function lastMoveId(packets: { move_id: number | null }[]): string {
  for (let i = packets.length - 1; i >= 0; i--) {
    if (packets[i].move_id != null) return `_${packets[i].move_id}`;
  }
  return "";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Replace all `src="assets/..."` references in HTML with inline data URIs. */
async function inlineAssets(html: string): Promise<string> {
  const pattern = /src="(assets\/[^"]+)"/g;
  const paths = new Set<string>();
  for (const match of html.matchAll(pattern)) paths.add(match[1]);
  if (paths.size === 0) return html;

  const dataUris = new Map<string, string>();
  await Promise.all([...paths].map(async (path) => {
    try {
      const url = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const reader = new FileReader();
      const dataUri = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      dataUris.set(path, dataUri);
    } catch { /* skip failed assets */ }
  }));

  return html.replace(pattern, (full, path: string) => {
    const dataUri = dataUris.get(path);
    return dataUri ? `src="${dataUri}"` : full;
  });
}

// ---------------------------------------------------------------------------
// Toggle handlers (visibility + layout) with persistence
// ---------------------------------------------------------------------------

const KEY_HELP_TAB = "bgaa_help_tab";
const KEY_TOGGLES = "bgaa_toggle_state";
const TOGGLE_DEFAULTS: Record<string, string[]> = {};

function persistToggleMode(targetId: string, toggle: HTMLElement, mode: string): void {
  const state = loadSetting(KEY_TOGGLES, TOGGLE_DEFAULTS);
  const modes = state[targetId] ?? [];
  // Find which slot this toggle occupies (by DOM order among siblings with same target)
  const allToggles = Array.from(toggle.parentElement?.querySelectorAll<HTMLElement>(`.tri-toggle[data-target="${targetId}"]`) ?? []);
  const idx = allToggles.indexOf(toggle);
  while (modes.length <= idx) modes.push("");
  modes[idx] = mode;
  state[targetId] = modes;
  saveSetting(KEY_TOGGLES, state);
}

function setupToggles(): void {
  // Restore saved state
  const saved = loadSetting(KEY_TOGGLES, TOGGLE_DEFAULTS);
  for (const [targetId, modes] of Object.entries(saved)) {
    const toggles = Array.from(document.querySelectorAll<HTMLElement>(`.tri-toggle[data-target="${targetId}"]`));
    for (let i = 0; i < Math.min(modes.length, toggles.length); i++) {
      if (modes[i]) applyToggleMode(toggles[i], modes[i], targetId);
    }
  }

  // Attach click handlers
  document.querySelectorAll<HTMLElement>(".tri-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e: Event) => {
      const opt = (e.target as HTMLElement).closest(".tri-opt") as HTMLElement | null;
      if (!opt) return;
      const mode = opt.getAttribute("data-mode");
      const targetId = toggle.getAttribute("data-target");
      if (!targetId || !mode) return;

      applyToggleMode(toggle, mode, targetId);
      persistToggleMode(targetId, toggle, mode);
    });
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(results: PipelineResults): void {
  const contentEl = document.getElementById("content")!;
  switchZoomContext(results.gameName);
  const savedScroll = contentEl.scrollTop;

  if (results.gameName === "azul" && results.gameState !== null) {
    const azulState = azulFromJSON(results.gameState);
    contentEl.innerHTML = renderAzulSummary(azulState);
    applyAzulDisplayOptions();

    // Enable eye button, hide turn history
    const btnSections = document.getElementById("btn-sections");
    if (btnSections) btnSections.classList.remove("disabled");
    const turnHistoryEl = document.getElementById("turn-history");
    if (turnHistoryEl) turnHistoryEl.innerHTML = "";

    // Populate game info bar
    const tableEl = document.getElementById("game-info-table");
    if (tableEl) tableEl.textContent = `# ${results.tableNumber}`;

    // Cache CSS for downloads
    loadCss();

    // Show download button for Azul
    const btnDownload = document.getElementById("btn-download");
    if (btnDownload) {
      btnDownload.classList.remove("disabled");
      btnDownload.onclick = async () => {
        const css = currentCss ?? "";
        setAzulAssetResolver((path: string) => path);
        const rawHtml = renderAzulFullPage(azulState, results.tableNumber, css);
        if (typeof chrome !== "undefined" && chrome.runtime?.getURL) setAzulAssetResolver((path: string) => chrome.runtime.getURL(path));
        const summaryHtmlFile = await inlineAssets(rawHtml);
        const zip = new JSZip();
        zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
        zip.file("game_log.json", JSON.stringify(results.gameLog, null, 2));
        zip.file("game_state.json", JSON.stringify(results.gameState, null, 2));
        zip.file("summary.html", summaryHtmlFile);
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `bgaa_${results.tableNumber}${lastMoveId(results.rawData.packets)}.zip`);
      };
    }

    // Show live indicator
    const indicator = document.getElementById("live-indicator");
    if (indicator) indicator.style.display = "";

    contentEl.scrollTop = savedScroll;
    return;
  }

  if (results.gameName === "thecrewdeepsea" && results.gameState !== null) {
    const crewState = crewFromJSON(results.gameState);
    contentEl.innerHTML = renderCrewSummary(crewState);

    // Hide Innovation-only features
    const btnSections = document.getElementById("btn-sections");
    if (btnSections) btnSections.classList.add("disabled");
    const turnHistoryEl = document.getElementById("turn-history");
    if (turnHistoryEl) turnHistoryEl.innerHTML = "";

    // Populate game info bar
    const tableEl = document.getElementById("game-info-table");
    if (tableEl) tableEl.textContent = `# ${results.tableNumber}`;

    // Cache CSS for downloads
    loadCss();

    // Show download button for Crew
    const btnDownload = document.getElementById("btn-download");
    if (btnDownload) {
      btnDownload.classList.remove("disabled");
      btnDownload.onclick = async () => {
        const css = currentCss ?? "";
        const rawHtml = renderCrewFullPage(crewState, results.tableNumber, css);
        const summaryHtmlFile = await inlineAssets(rawHtml);
        const zip = new JSZip();
        zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
        zip.file("game_log.json", JSON.stringify(results.gameLog, null, 2));
        zip.file("game_state.json", JSON.stringify(results.gameState, null, 2));
        zip.file("summary.html", summaryHtmlFile);
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `bgaa_${results.tableNumber}${lastMoveId(results.rawData.packets)}.zip`);
      };
    }

    // Show live indicator
    const indicator = document.getElementById("live-indicator");
    if (indicator) indicator.style.display = "";

    contentEl.scrollTop = savedScroll;
    return;
  }

  if (results.gameName !== "innovation") {
    return;
  }

  // Restore section selector (may have been hidden by Azul render)
  const btnSections = document.getElementById("btn-sections");
  if (btnSections) btnSections.classList.remove("disabled");

  const cardInfoUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("assets/bga/innovation/card_info.json")
    : "assets/bga/innovation/card_info.json";
  fetchCardDb(cardInfoUrl).then((db) => {
    renderWithDb(db, results as InnovationResults, contentEl);
    contentEl.scrollTop = savedScroll;
  }).catch(() => {
    contentEl.innerHTML = '<div class="status">Error loading card database</div>';
  });
}

async function fetchCardDb(url: string): Promise<CardDatabase> {
  if (cachedCardDb) return cachedCardDb;
  const response = await fetch(url);
  const data = await response.json();
  cachedCardDb = new CardDatabase(data);
  return cachedCardDb;
}

type InnovationResults = Extract<PipelineResults, { gameName: "innovation" }>;

function renderWithDb(cardDb: CardDatabase, results: InnovationResults, contentEl: HTMLElement): void {
  const { gameLog, gameState: serializedState } = results;

  // Reconstruct GameState from serialized form
  const players = Object.values(gameLog.players);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.currentPlayerId : players[0].id;
  const engine = new GameEngine(cardDb);
  const gameState = innovationFromJSON(serializedState, players, perspective);
  engine.buildGroups(gameState);
  const tableId = "game";

  // Render summary HTML
  currentExpansions = gameLog.expansions;
  const summaryHtml = renderSummary(gameState, engine, cardDb, perspective, players, tableId, { expansions: gameLog.expansions });
  contentEl.innerHTML = summaryHtml;

  // Populate game info bar
  const tableEl = document.getElementById("game-info-table");
  if (tableEl) tableEl.textContent = `# ${results.tableNumber}`;

  // Set up interactivity (tooltips are fully CSS-driven via anchor positioning)
  setupToggles();

  // Render turn history
  const turnHistoryEl = document.getElementById("turn-history");
  if (turnHistoryEl) {
    const recent = recentTurns(gameLog.actions, 3);
    turnHistoryEl.innerHTML = renderTurnHistory(recent, cardDb, players);
  }

  applyInnovationDisplayOptions({ echoes: currentExpansions.echoes, relics: currentExpansions.relics ?? false, zoomLevel });

  // Cache CSS for downloads
  loadCss();

  // Show and wire download button (use onclick to replace any previous handler on re-render)
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) {
    btnDownload.classList.remove("disabled");
    btnDownload.onclick = async () => {
      const css = currentCss ?? "";
      setAssetResolver((path: string) => path);
      const rawHtml = renderFullPage(gameState, engine, cardDb, perspective, players, tableId, css, { textTooltips: true, expansions: gameLog.expansions });
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) setAssetResolver((path: string) => chrome.runtime.getURL(path));
      const summaryHtmlFile = await inlineAssets(rawHtml);
      const zip = new JSZip();
      zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
      zip.file("game_log.json", JSON.stringify(gameLog, null, 2));
      zip.file("game_state.json", JSON.stringify(serializedState, null, 2));
      zip.file("summary.html", summaryHtmlFile);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `bgaa_${results.tableNumber}${lastMoveId(results.rawData.packets)}.zip`);
    };
  }
}

function loadCss(): void {
  if (currentCss !== null) return;
  try {
    const sheets = document.styleSheets;
    let css = "";
    for (let i = 0; i < sheets.length; i++) {
      try {
        const rules = sheets[i].cssRules;
        for (let j = 0; j < rules.length; j++) {
          css += rules[j].cssText + "\n";
        }
      } catch {
        // Cross-origin stylesheet, skip
      }
    }
    currentCss = css;
  } catch {
    currentCss = "";
  }
}

// ---------------------------------------------------------------------------
// Zoom (Ctrl+/- and Ctrl+0)
// ---------------------------------------------------------------------------

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const KEY_ZOOM = "bgaa_zoom_levels";
const ZOOM_DEFAULT = 1.0;

let zoomLevel = ZOOM_DEFAULT;
let zoomFadeTimeout: ReturnType<typeof setTimeout> | undefined;
let currentZoomContext = "help";

function switchZoomContext(context: string): void {
  currentZoomContext = context;
  const levels = loadSetting<Record<string, number>>(KEY_ZOOM, {});
  const stored = levels[context];
  zoomLevel = stored !== undefined && stored >= ZOOM_MIN && stored <= ZOOM_MAX ? stored : ZOOM_DEFAULT;
  const contentEl = document.getElementById("content");
  if (contentEl) contentEl.style.zoom = String(zoomLevel);
}

function applyZoom(): void {
  const contentEl = document.getElementById("content");
  if (contentEl) contentEl.style.zoom = String(zoomLevel);
  const levels = loadSetting<Record<string, number>>(KEY_ZOOM, {});
  levels[currentZoomContext] = zoomLevel;
  saveSetting(KEY_ZOOM, levels);
  const indicator = document.getElementById("zoom-indicator");
  if (indicator) {
    indicator.textContent = `${Math.round(zoomLevel * 100)}%`;
    indicator.classList.add("visible");
    clearTimeout(zoomFadeTimeout);
    zoomFadeTimeout = setTimeout(() => indicator.classList.remove("visible"), 1200);
  }
  if (currentResults?.gameName === "innovation") {
    applyInnovationDisplayOptions({ echoes: currentExpansions.echoes, relics: currentExpansions.relics ?? false, zoomLevel });
  }
}

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.key === "=" || e.key === "+") {
    e.preventDefault();
    zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 10) / 10);
    applyZoom();
  } else if (e.key === "-") {
    e.preventDefault();
    zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 10) / 10);
    applyZoom();
  } else if (e.key === "0") {
    e.preventDefault();
    zoomLevel = 1.0;
    applyZoom();
  }
});

document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
  zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 10) / 10);
  applyZoom();
});
document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
  zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 10) / 10);
  applyZoom();
});

// ---------------------------------------------------------------------------
// Section selector (eye button)
// ---------------------------------------------------------------------------

document.getElementById("btn-sections")?.addEventListener("click", async (e) => {
  e.stopPropagation();
  const panel = document.getElementById("section-selector");
  if (!panel) return;
  if (panel.style.display === "none") {
    closePinDropdown();
    if (statsPageOpen()) {
      await buildStatsSettingsMenu(panel);
    } else if (currentResults?.gameName === "azul") {
      buildAzulDisplayMenu(panel);
    } else if (currentResults?.gameName === "innovation") {
      buildInnovationDisplayMenu(panel, { echoes: currentExpansions.echoes, relics: currentExpansions.relics ?? false, zoomLevel });
    } else {
      return;
    }
    panel.style.display = "";
  } else {
    panel.style.display = "none";
  }
});

document.addEventListener("click", (e) => {
  const panel = document.getElementById("section-selector");
  if (!panel || panel.style.display === "none") return;
  if (!panel.contains(e.target as Node)) {
    panel.style.display = "none";
  }
});

/** Close both the section-selector and pin dropdown menus. */
function closeMenus(): void {
  const sectionPanel = document.getElementById("section-selector");
  if (sectionPanel) sectionPanel.style.display = "none";
  closePinDropdown();
}

// ---------------------------------------------------------------------------
// Auto-hide button & dropdown
// ---------------------------------------------------------------------------


const PIN_ICONS: Record<PinMode, string> = {
  "pinned": '<svg viewBox="0 0 28 24"><rect x="2" y="3" width="24" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  "autohide-bga": '<svg viewBox="0 0 28 24"><rect x="2" y="3" width="24" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  "autohide-game": '<svg viewBox="0 0 28 24"><rect x="2" y="3" width="24" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const PIN_LABELS: Record<PinMode, string> = {
  "pinned": "Never",
  "autohide-bga": "Leaving BGA",
  "autohide-game": "Unsupported games",
};

const PIN_ORDER: PinMode[] = ["pinned", "autohide-bga", "autohide-game"];

let pinDropdownOpen = false;


function updatePinButtonIcon(): void {
  const btn = document.getElementById("btn-pin");
  if (btn) btn.innerHTML = PIN_ICONS[currentPinMode];
}

function buildPinDropdown(): void {
  const dropdown = document.getElementById("pin-dropdown");
  if (!dropdown) return;

  dropdown.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "When side bar hides:";
  dropdown.appendChild(header);

  // Always show in fixed order
  for (const mode of PIN_ORDER) {
    const isActive = mode === currentPinMode;
    const option = document.createElement("div");
    option.className = "pin-option" + (isActive ? " active" : "");
    option.dataset.mode = mode;
    option.innerHTML = PIN_ICONS[mode] + '<span>' + PIN_LABELS[mode] + '</span>';
    dropdown.appendChild(option);

    option.addEventListener("mouseover", () => {
      dropdown.querySelectorAll(".pin-option").forEach((el) => el.classList.remove("highlight"));
      option.classList.add("highlight");
    });
    option.addEventListener("mouseout", () => {
      option.classList.remove("highlight");
    });

    option.addEventListener("mouseup", (e: MouseEvent) => {
      e.stopPropagation();
      if (isActive) {
        closePinDropdown();
        return;
      }
      selectPinMode(mode);
    });
  }

  // Divider + shortcut link
  const divider = document.createElement("div");
  divider.className = "pin-divider";
  dropdown.appendChild(divider);

  const link = document.createElement("span");
  link.className = "pin-shortcut-link";
  link.textContent = "Set hide/show shortcut";

  // Query real shortcut binding and show it
  if (typeof chrome !== "undefined" && chrome.commands?.getAll) {
    chrome.commands.getAll((commands: chrome.commands.Command[]) => {
      const cmd = commands.find((c) => c.name === "toggle-sidepanel");
      if (cmd?.shortcut) {
        link.textContent = `Change hide/show shortcut (${cmd.shortcut})`;
      }
    });
  }

  link.addEventListener("mouseup", (e: MouseEvent) => {
    e.stopPropagation();
    // chrome://extensions/shortcuts can't be opened via window.open; use Chrome tabs API
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }
    closePinDropdown();
  });
  dropdown.appendChild(link);
}

function openPinDropdown(): void {
  const dropdown = document.getElementById("pin-dropdown");
  if (!dropdown) return;
  // Close section-selector if open
  const sectionPanel = document.getElementById("section-selector");
  if (sectionPanel) sectionPanel.style.display = "none";
  buildPinDropdown();
  dropdown.style.display = "";
  pinDropdownOpen = true;
}

function closePinDropdown(): void {
  const dropdown = document.getElementById("pin-dropdown");
  if (!dropdown) return;
  dropdown.style.display = "none";
  pinDropdownOpen = false;
}

function selectPinMode(mode: PinMode): void {
  currentPinMode = mode;
  saveSetting(KEY_PIN_MODE, mode);
  updatePinButtonIcon();
  closePinDropdown();
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "setPinMode", mode }).catch(() => {});
  }
}

function initPinButton(): void {
  const btn = document.getElementById("btn-pin");
  if (!btn) return;

  // Dual interaction: mousedown opens, mouseup on different item selects
  // Use onmousedown (not addEventListener) so repeated initPinButton calls replace rather than stack
  btn.onmousedown = (e: MouseEvent) => {
    e.preventDefault();
    if (pinDropdownOpen) {
      closePinDropdown();
    } else {
      openPinDropdown();
    }
  };

  updatePinButtonIcon();
}

// Close on mouseup outside the dropdown
document.addEventListener("mouseup", (e: MouseEvent) => {
  if (!pinDropdownOpen) return;
  const dropdown = document.getElementById("pin-dropdown");
  const btn = document.getElementById("btn-pin");
  if (dropdown && !dropdown.contains(e.target as Node) && btn && !btn.contains(e.target as Node)) {
    closePinDropdown();
  }
});

// Push persisted pin mode to background on startup
if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  chrome.runtime.sendMessage({ type: "setPinMode", mode: currentPinMode }).catch(() => {});
}

initPinButton();

// ---------------------------------------------------------------------------
// Help page
// ---------------------------------------------------------------------------

function showHelp(errorMessage?: string, forceGameTab?: GameName): void {
  const contentEl = document.getElementById("content");
  if (!contentEl) return;
  switchZoomContext("help");

  // Resolve effective tab: forceGameTab > localStorage > "innovation"
  const HELP_TAB_DEFAULT: GameName = "innovation";
  let effectiveTab: GameName = forceGameTab ?? loadSetting(KEY_HELP_TAB, HELP_TAB_DEFAULT);
  if (effectiveTab !== "azul" && effectiveTab !== "innovation" && effectiveTab !== "thecrewdeepsea") effectiveTab = HELP_TAB_DEFAULT;
  saveSetting(KEY_HELP_TAB, effectiveTab);

  contentEl.innerHTML = renderHelp(errorMessage, effectiveTab);
  setupHelpTabs();
  closeMenus();

  const btnSections = document.getElementById("btn-sections");
  if (btnSections) btnSections.classList.add("disabled");
  const tableEl = document.getElementById("game-info-table");
  if (tableEl) tableEl.textContent = "";
  const indicator = document.getElementById("live-indicator");
  if (indicator) indicator.style.display = "none";
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) { btnDownload.classList.add("disabled"); btnDownload.onclick = null; }
  const turnHistoryEl = document.getElementById("turn-history");
  if (turnHistoryEl) turnHistoryEl.innerHTML = "";
  chrome.runtime.sendMessage({ type: "pauseLive" }).catch(() => {});
}

/** Show help page with download enabled for unsupported game raw data. */
function showHelpWithRawData(results: PipelineResults): void {
  showHelp();
  const btnDownload = document.getElementById("btn-download");
  if (!btnDownload) return;
  btnDownload.classList.remove("disabled");
  btnDownload.onclick = async () => {
    const zip = new JSZip();
    zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `bgaa_${results.tableNumber}${lastMoveId(results.rawData.packets)}.zip`);
  };
}

function setupHelpTabs(): void {
  document.querySelectorAll<HTMLElement>(".help-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-help-tab");
      if (!tabName) return;

      // Toggle active class on buttons
      document.querySelectorAll<HTMLElement>(".help-tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-help-tab") === tabName));
      // Toggle active class on panels
      document.querySelectorAll<HTMLElement>(".help-tab-content").forEach((p) => p.classList.toggle("active", p.getAttribute("data-help-panel") === tabName));

      saveSetting(KEY_HELP_TAB, tabName);
    });
  });
}

// Wire help button — toggles between help and summary
document.getElementById("btn-help")?.addEventListener("click", () => {
  if (currentResults && document.getElementById("content")?.querySelector(".help")) {
    if (currentResults.gameState) {
      render(currentResults);
      chrome.runtime.sendMessage({ type: "resumeLive" }).catch(() => {});
    } else {
      showHelpWithRawData(currentResults);
    }
  } else {
    showHelp(undefined, currentResults?.gameName as GameName | undefined);
  }
});

// Stats page
let cachedExportFn: (() => Promise<string>) | null = null;

const KEY_STATS_GRANULARITY = "bgaa_stats_granularity";
const KEY_STATS_DAY_START = "bgaa_stats_day_start";
const KEY_STATS_WEEK_START = "bgaa_stats_week_start";
const KEY_STATS_SESSION_FILTER = "bgaa_stats_session_filter";
const KEY_STATS_TABLE_VIEW = "bgaa_stats_table_view";
type TableView = "sessions" | "tables";
const TABLE_VIEW_LABELS: Record<TableView, string> = { sessions: "Sessions", tables: "Tables" };
const CHART_PALETTE = ["#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b", "#cc5de8", "#ff922b", "#22b8cf", "#f06595", "#94d82d", "#a78bfa", "#ffa94d", "#63e6be"];
const CHART_HEIGHT = 140;
const STOPWATCH_SVG = '<svg class="stats-rt" viewBox="0 0 24 24" width="11" height="11" aria-label="real-time"><path fill="currentColor" d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0012 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
const TROPHY_SVG = '<svg class="stats-trophy" viewBox="0 0 24 24" width="11" height="11" aria-label="tournament"><title>Tournament</title><path fill="currentColor" d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0011 16.9V19H7v2h10v-2h-4v-2.1a5.01 5.01 0 003.61-3.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>';
const ARENA_SVG = '<svg class="stats-arena" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-label="arena"><title>Arena</title><path fill-rule="evenodd" d="M1.5 6A10.5 4.2 0 0 0 22.5 6L22.5 15A10.5 4 0 0 1 1.5 15ZM2.5 6.4a9.5 3.7 0 0 0 19 0a9.5 3.7 0 0 0 -19 0ZM4.35 13.8V13.15a0.85 0.85 0 0 1 1.7 0V13.8ZM4.45 11.7V11.15a0.75 0.75 0 0 1 1.5 0V11.7ZM7.75 13.8V13.15a0.85 0.85 0 0 1 1.7 0V13.8ZM7.85 11.7V11.15a0.75 0.75 0 0 1 1.5 0V11.7ZM11.15 13.8V13.15a0.85 0.85 0 0 1 1.7 0V13.8ZM11.25 11.7V11.15a0.75 0.75 0 0 1 1.5 0V11.7ZM14.55 13.8V13.15a0.85 0.85 0 0 1 1.7 0V13.8ZM14.65 11.7V11.15a0.75 0.75 0 0 1 1.5 0V11.7ZM17.95 13.8V13.15a0.85 0.85 0 0 1 1.7 0V13.8ZM18.05 11.7V11.15a0.75 0.75 0 0 1 1.5 0V11.7Z"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** Short localized weekday name (e.g. "Wed") for a day bucket key formatted "YYYY-MM-DD". */
function weekdayAbbr(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: "short" });
}

/** True while the user has the play-time stats page open. Background pushes (e.g. on service worker revival) must not re-render over it. */
function statsPageOpen(): boolean {
  return !!document.getElementById("content")?.querySelector(".stats-page");
}

/** Round a max value up to a "nice" axis maximum and return evenly spaced tick values from 0. */
function niceTicks(max: number): { axisMax: number; ticks: number[] } {
  if (max <= 0) return { axisMax: 1, ticks: [0] };
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow;
  const axisMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= axisMax + step / 1000; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return { axisMax, ticks };
}

/** Build the chart's y-axis. Bars are scaled in minutes; once the axis would exceed 100 minutes the labels switch to hours. */
function axisScale(maxMinutes: number): { axisMaxMinutes: number; ticks: { minutes: number; label: string }[] } {
  const minutes = niceTicks(maxMinutes);
  if (minutes.axisMax <= 100) {
    return { axisMaxMinutes: minutes.axisMax, ticks: minutes.ticks.map((t) => ({ minutes: t, label: Number.isInteger(t) ? String(t) : t.toFixed(1) })) };
  }
  const hours = niceTicks(maxMinutes / 60); // niceTicks yields ~4 steps, so always ≥2 non-zero hour marks
  return { axisMaxMinutes: hours.axisMax * 60, ticks: hours.ticks.map((h) => ({ minutes: h * 60, label: h === 0 ? "0" : `${Number.isInteger(h) ? h : h.toFixed(1)}h` })) };
}

async function showStats(): Promise<void> {
  const contentEl = document.getElementById("content");
  if (!contentEl) return;
  const { exportSessionsCsv, aggregateSessions, aggregateByTable, minutesInCurrentBucket, currentBucketRange, sessionsOverlapping, formatDuration, formatDurationClock, DAY_START_HOUR, WEEK_START_DAY, STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, STORAGE_KEY_ACTIVE, STORAGE_KEY_MODES, STORAGE_KEY_TYPES } = await import("../time-tracking.js");
  cachedExportFn = exportSessionsCsv;
  const result = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, STORAGE_KEY_MODES, STORAGE_KEY_TYPES, STORAGE_KEY_ACTIVE]);
  const stored: TimeSession[] = result[STORAGE_KEY_SESSIONS] ?? [];
  const gameMap: Record<string, string> = result[STORAGE_KEY_GAMES] ?? {};
  const modeMap: Record<string, boolean> = result[STORAGE_KEY_MODES] ?? {};
  const typeMap: Record<string, "tournament" | "arena" | "regular"> = result[STORAGE_KEY_TYPES] ?? {};
  const active = result[STORAGE_KEY_ACTIVE] as { slug: string; tableId: number; from: number; idleSince?: number | null } | undefined;
  const now = Date.now();
  // Fold the in-progress session (if any) in as a synthetic [slug, table, from, now] tuple — newest, so it sorts first.
  const activeTuple: TimeSession | null = active ? [active.slug, active.tableId, active.from, now] : null;
  // The in-progress session is "idle" once the user has gone away (idleSince set) but the grace window hasn't yet ended it; its live dot turns yellow instead of green.
  const activeIdle = active?.idleSince != null;
  const sessions: TimeSession[] = activeTuple ? [...stored, activeTuple] : stored;
  const granularity = loadSetting<Granularity>(KEY_STATS_GRANULARITY, "day");
  const dayStartHour = loadSetting<number>(KEY_STATS_DAY_START, DAY_START_HOUR);
  const weekStartDay = loadSetting<number>(KEY_STATS_WEEK_START, WEEK_START_DAY);
  const sessionFilter = loadSetting<SessionFilter>(KEY_STATS_SESSION_FILTER, "all");
  const tableView = loadSetting<TableView>(KEY_STATS_TABLE_VIEW, "sessions");
  const dayRange = currentBucketRange("day", now, dayStartHour, weekStartDay);
  const weekRange = currentBucketRange("week", now, dayStartHour, weekStartDay);
  const tableSessions = sessionFilter === "off" ? [] : sessionFilter === "today" ? sessionsOverlapping(sessions, dayRange.start, dayRange.end) : sessionFilter === "week" ? sessionsOverlapping(sessions, weekRange.start, weekRange.end) : sessions;
  switchZoomContext("help");
  const btnSections = document.getElementById("btn-sections");
  if (btnSections) btnSections.classList.remove("disabled");
  const turnHistoryEl = document.getElementById("turn-history");
  if (turnHistoryEl) turnHistoryEl.innerHTML = "";
  chrome.runtime.sendMessage({ type: "pauseLive" }).catch(() => {});

  // Unified "Table" cell for both views: table id + stopwatch (real-time) + trophy (tournament) /
  // crossed swords (arena) + a pulsing dot for the in-progress table (green when active, yellow when idle).
  const tableCell = (tableId: number, isActive: boolean): string => {
    const rt = modeMap[tableId] ? ` ${STOPWATCH_SVG}` : "";
    const typeIcon = typeMap[tableId] === "tournament" ? ` ${TROPHY_SVG}` : typeMap[tableId] === "arena" ? ` ${ARENA_SVG}` : "";
    const live = isActive ? ` <span class="stats-live${activeIdle ? " idle" : ""}" title="${activeIdle ? "in progress (idle)" : "in progress"}"></span>` : "";
    return `${tableId}${rt}${typeIcon}${live}`;
  };

  // The in-progress session/table has no delete affordance — removing it from storage is meaningless while the live tracker holds it in memory and would re-append it.
  const delButton = (attr: string, label: string): string => `<button class="stats-del" ${attr} title="${label}" aria-label="${label}">${CLOSE_SVG}</button>`;

  const rows = tableSessions.slice().reverse().map(([slug, tableId, from, to]) => {
    const duration = formatDurationClock(to - from);
    const date = new Date(from).toLocaleDateString();
    const time = new Date(from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const isActive = activeTuple !== null && from === activeTuple[2];
    const del = isActive ? "" : delButton(`data-del-session="${from}"`, "Remove this session");
    return `<tr${isActive ? ' class="stats-active"' : ""}><td>${escapeHtml(gameMap[slug] ?? slug)}</td><td>${tableCell(tableId, isActive)}</td><td>${date} ${time}</td><td>${duration}${del}</td></tr>`;
  }).join("");

  const tableRows = aggregateByTable(tableSessions).map(({ slug, tableId, lastTo, totalMinutes, sessionCount }) => {
    const date = new Date(lastTo).toLocaleDateString();
    const time = new Date(lastTo).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const isActive = activeTuple !== null && activeTuple[1] === tableId;
    // Average per session is only meaningful for turn-based play (many short sittings); real-time games run in one continuous session, so leave it blank.
    const avg = modeMap[tableId] === true ? "" : formatDurationClock((totalMinutes * 60000) / sessionCount);
    const del = isActive ? "" : delButton(`data-del-table="${tableId}"`, "Remove all sessions for this table");
    return `<tr${isActive ? ' class="stats-active"' : ""}><td>${escapeHtml(gameMap[slug] ?? slug)}</td><td>${tableCell(tableId, isActive)}</td><td>${date} ${time}</td><td class="stats-num">${avg}</td><td>${formatDuration(totalMinutes)}${del}</td></tr>`;
  }).join("");

  const chart = aggregateSessions(sessions, gameMap, granularity, dayStartHour, weekStartDay);
  const colorOf = (game: string): string => CHART_PALETTE[chart.games.indexOf(game) % CHART_PALETTE.length];
  const switchHtml = (["day", "week", "month"] as Granularity[]).map((g) => `<button class="stats-gran${g === granularity ? " active" : ""}" data-gran="${g}">${g[0].toUpperCase()}${g.slice(1)}</button>`).join("");
  let chartHtml: string;
  if (chart.buckets.length === 0) {
    chartHtml = '<div class="stats-chart-empty">No data to chart yet</div>';
  } else {
    const { axisMaxMinutes, ticks } = axisScale(chart.maxTotalMinutes);
    const cols = chart.buckets.map((bucket) => {
      const segs = chart.games.filter((game) => bucket.minutesByGame[game] > 0).map((game) => {
        const px = Math.max(1, Math.round((bucket.minutesByGame[game] / axisMaxMinutes) * CHART_HEIGHT));
        return `<div class="stats-seg" style="height:${px}px;background:${colorOf(game)}" title="${escapeHtml(game)}: ${formatDuration(bucket.minutesByGame[game])}"></div>`;
      }).join("");
      const xLabel = granularity === "day" ? `<span class="stats-col-dow">${weekdayAbbr(bucket.key)}</span>${bucket.label}` : bucket.label;
      return `<div class="stats-col" title="${bucket.label}: ${formatDuration(bucket.totalMinutes)}"><div class="stats-col-bars" style="height:${CHART_HEIGHT}px">${segs}</div><div class="stats-col-x">${xLabel}</div></div>`;
    }).join("");
    const axis = ticks.map((t) => `<span class="stats-ytick" style="bottom:${(t.minutes / axisMaxMinutes) * CHART_HEIGHT}px">${t.label}</span>`).join("");
    const legend = chart.games.map((game) => `<span class="stats-legend-item"><span class="stats-legend-swatch" style="background:${colorOf(game)}"></span>${escapeHtml(game)}</span>`).join("");
    chartHtml = `<div class="stats-chart-wrap"><div class="stats-yaxis" style="height:${CHART_HEIGHT}px">${axis}</div><div class="stats-chart">${cols}</div></div><div class="stats-legend">${legend}</div>`;
  }

  const todayMinutes = minutesInCurrentBucket(sessions, "day", now, dayStartHour, weekStartDay);
  const weekMinutes = minutesInCurrentBucket(sessions, "week", now, dayStartHour, weekStartDay);
  const summary = `Today: ${formatDuration(todayMinutes)}<span class="stats-sep">·</span>This week: ${formatDuration(weekMinutes)}`;
  const emptyMessage = sessionFilter === "all" ? "No sessions recorded yet" : "No sessions in this period";
  const viewSwitchHtml = (["sessions", "tables"] as TableView[]).map((view) => `<button class="stats-gran${view === tableView ? " active" : ""}" data-view="${view}">${TABLE_VIEW_LABELS[view]}</button>`).join("");
  const headerCells = tableView === "tables" ? '<th>Game</th><th>Table</th><th>Last played</th><th class="stats-num">Avg</th><th>Total</th>' : "<th>Game</th><th>Table</th><th>Date</th><th>Duration</th>";
  const bodyRows = tableView === "tables" ? tableRows : rows;
  const colCount = tableView === "tables" ? 5 : 4;
  const tableHtml = sessionFilter === "off" ? "" : `<div class="stats-gran-switch">${viewSwitchHtml}</div><div class="stats-table-wrap"><table class="stats-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows || `<tr><td colspan="${colCount}" class="stats-empty">${emptyMessage}</td></tr>`}</tbody></table></div>`;
  contentEl.innerHTML = `<div class="stats-page"><h2>Play time</h2><div class="stats-summary"><span>${summary}</span><span class="stats-actions"><button class="stats-btn" id="btn-stats-refresh">Refresh</button><button class="stats-btn" id="btn-stats-export">Export</button><button class="stats-btn" id="btn-stats-import">Import</button><button class="stats-btn stats-btn-danger" id="btn-stats-clear">Clear</button></span></div><div class="stats-gran-switch">${switchHtml}</div>${chartHtml}${tableHtml}</div>`;

  document.querySelectorAll<HTMLElement>("[data-gran]").forEach((btn) => btn.addEventListener("click", () => {
    saveSetting(KEY_STATS_GRANULARITY, btn.getAttribute("data-gran"));
    showStats();
  }));
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((btn) => btn.addEventListener("click", () => {
    saveSetting(KEY_STATS_TABLE_VIEW, btn.getAttribute("data-view"));
    showStats();
  }));
  // Deletion rewrites bgaa_time_sessions; the storage.onChanged listener re-renders the page once the write lands.
  document.querySelectorAll<HTMLElement>("[data-del-session]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!window.confirm("Remove this session?")) return;
    const { deleteSession } = await import("../time-tracking.js");
    await deleteSession(Number(btn.getAttribute("data-del-session")));
  }));
  document.querySelectorAll<HTMLElement>("[data-del-table]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!window.confirm("Remove all sessions for this table?")) return;
    const { deleteTableSessions } = await import("../time-tracking.js");
    await deleteTableSessions(Number(btn.getAttribute("data-del-table")));
  }));
  document.getElementById("btn-stats-refresh")?.addEventListener("click", () => showStats());
  document.getElementById("btn-stats-export")?.addEventListener("click", async () => {
    const csv = await cachedExportFn!();
    const blob = new Blob([csv], { type: "text/csv" });
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `bgaa_playtime_${dateStr}.csv`);
  });
  document.getElementById("btn-stats-import")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const { importSessionsCsv } = await import("../time-tracking.js");
      const added = await importSessionsCsv(await file.text());
      window.alert(`Imported ${added} session${added === 1 ? "" : "s"}.`);
      showStats();
    });
    input.click();
  });
  document.getElementById("btn-stats-clear")?.addEventListener("click", async () => {
    if (!window.confirm("Delete all recorded play time? This cannot be undone.")) return;
    await chrome.storage.local.remove([STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, STORAGE_KEY_ACTIVE, STORAGE_KEY_MODES, STORAGE_KEY_TYPES]);
    chrome.runtime.sendMessage({ type: "resetTimeTracking" }).catch(() => {});
    showStats();
  });
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SESSION_FILTER_LABELS: Record<SessionFilter, string> = { off: "Off", today: "Today", week: "This week", all: "All" };

/** Re-render the stats page and, while the eye-icon menu is open, rebuild it so the per-option session counts stay current. */
function refreshStatsView(): void {
  showStats();
  const panel = document.getElementById("section-selector");
  if (panel && panel.style.display !== "none") buildStatsSettingsMenu(panel);
}

/** Populate the eye-icon menu with the play-time tracking settings (day-start hour, week-start day, session-list filter), persisted to localStorage. */
async function buildStatsSettingsMenu(panel: HTMLElement): Promise<void> {
  const { DAY_START_HOUR, WEEK_START_DAY, currentBucketRange, sessionsOverlapping, STORAGE_KEY_SESSIONS, STORAGE_KEY_ACTIVE } = await import("../time-tracking.js");
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "Time tracking settings:";
  panel.appendChild(header);

  const dayStart = loadSetting<number>(KEY_STATS_DAY_START, DAY_START_HOUR);
  const dayOptions = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${hour === dayStart ? " selected" : ""}>${hour}:00</option>`).join("");
  const dayLabel = document.createElement("label");
  dayLabel.className = "stats-setting";
  dayLabel.innerHTML = `<span>Day starts at</span><select id="setting-day-start">${dayOptions}</select>`;
  panel.appendChild(dayLabel);

  const weekStart = loadSetting<number>(KEY_STATS_WEEK_START, WEEK_START_DAY);
  const weekOptions = WEEKDAY_NAMES.map((day, index) => `<option value="${index}"${index === weekStart ? " selected" : ""}>${day}</option>`).join("");
  const weekLabel = document.createElement("label");
  weekLabel.className = "stats-setting";
  weekLabel.innerHTML = `<span>Week starts on</span><select id="setting-week-start">${weekOptions}</select>`;
  panel.appendChild(weekLabel);

  // Session-list filter, with a live count of matching sessions per option.
  const stats = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_ACTIVE]);
  const stored = (stats[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const active = stats[STORAGE_KEY_ACTIVE] as { slug: string; tableId: number; from: number } | undefined;
  const now = Date.now();
  const sessions: TimeSession[] = active ? [...stored, [active.slug, active.tableId, active.from, now]] : stored;
  const dayRange = currentBucketRange("day", now, dayStart, weekStart);
  const weekRange = currentBucketRange("week", now, dayStart, weekStart);
  const counts: Record<SessionFilter, number | null> = {
    off: null,
    today: sessionsOverlapping(sessions, dayRange.start, dayRange.end).length,
    week: sessionsOverlapping(sessions, weekRange.start, weekRange.end).length,
    all: sessions.length,
  };
  const filterValue = loadSetting<SessionFilter>(KEY_STATS_SESSION_FILTER, "all");
  const filterOptions = (Object.keys(SESSION_FILTER_LABELS) as SessionFilter[]).map((value) => {
    const count = counts[value];
    const text = count === null ? SESSION_FILTER_LABELS[value] : `${SESSION_FILTER_LABELS[value]} (${count})`;
    return `<option value="${value}"${value === filterValue ? " selected" : ""}>${text}</option>`;
  }).join("");
  const filterLabel = document.createElement("label");
  filterLabel.className = "stats-setting";
  filterLabel.innerHTML = `<span>Show sessions</span><select id="setting-session-filter">${filterOptions}</select>`;
  panel.appendChild(filterLabel);

  dayLabel.querySelector("select")!.addEventListener("change", (event) => {
    saveSetting(KEY_STATS_DAY_START, Number((event.target as HTMLSelectElement).value));
    refreshStatsView();
  });
  weekLabel.querySelector("select")!.addEventListener("change", (event) => {
    saveSetting(KEY_STATS_WEEK_START, Number((event.target as HTMLSelectElement).value));
    refreshStatsView();
  });
  filterLabel.querySelector("select")!.addEventListener("change", (event) => {
    saveSetting(KEY_STATS_SESSION_FILTER, (event.target as HTMLSelectElement).value);
    refreshStatsView();
  });
}

// Wire stats button — toggles between stats page and game summary
document.getElementById("btn-stats")?.addEventListener("click", () => {
  const contentEl = document.getElementById("content");
  if (!contentEl) return;
  if (contentEl.querySelector(".stats-page")) {
    if (currentResults?.gameState) {
      render(currentResults);
      chrome.runtime.sendMessage({ type: "resumeLive" }).catch(() => {});
    } else {
      showHelp(undefined, currentResults?.gameName as GameName | undefined);
    }
    return;
  }
  showStats();
});


// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // Start with loading indicator — background will push the appropriate message
  // ("resultsReady", "notAGame", or "gameError") shortly after port connect.
  const initContent = document.getElementById("content");
  if (initContent) initContent.innerHTML = '<div class="status">Loading game data...</div>';

  // Listen for pushed updates from background
  chrome.runtime.onMessage.addListener((message: { type: string; error?: string; active?: boolean; results?: PipelineResults }) => {
    if (message.type === "liveStatus") {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined; }
      const indicator = document.getElementById("live-indicator");
      if (indicator) {
        indicator.style.display = message.active ? "" : "none";
        indicator.classList.remove("disconnected");
      }
    } else if (message.type === "resultsReady") {
      const response = message.results ?? null;
      if (response) {
        // Skip re-render if we already have identical results (same table, same packet count).
        // This prevents unnecessary refreshes when the service worker restarts and re-pushes cached data.
        const same = currentResults && currentResults.tableNumber === response.tableNumber && currentResults.rawData.packets.length === response.rawData.packets.length;
        const sameTable = currentResults && currentResults.tableNumber === response.tableNumber;
        currentResults = response;
        // Keep the stats page up unless the user navigated to a *different supported* table (results with gameState).
        // Same-table re-pushes (service worker revival) and unsupported tables must not clobber it.
        const navigatedToSupportedTable = !sameTable && !!response.gameState;
        if (statsPageOpen() && !navigatedToSupportedTable) return;
        if (same) return;
        if (!sameTable) closeMenus();
        if (response.gameState) {
          render(response);
        } else {
          showHelpWithRawData(response);
        }
      }
    } else if (message.type === "loading") {
      // "loading" is only sent when navigating to a different *supported* table, so it should
      // leave the stats page (with feedback). It never fires during idle same-table revival.
      currentResults = null;
      closeMenus();
      const btnSections = document.getElementById("btn-sections");
      if (btnSections) btnSections.classList.add("disabled");
      document.getElementById("content")!.innerHTML = '<div class="status">Loading game data...</div>';
      const tableEl = document.getElementById("game-info-table");
      if (tableEl) tableEl.textContent = "";
      const turnHistoryEl = document.getElementById("turn-history");
      if (turnHistoryEl) turnHistoryEl.innerHTML = "";
    } else if (message.type === "notAGame") {
      currentResults = null;
      if (statsPageOpen()) return;
      showHelp();
    } else if (message.type === "gameError") {
      currentResults = message.results ?? null;
      if (statsPageOpen()) return;
      showHelp(message.error);
      if (currentResults) {
        const btnDownload = document.getElementById("btn-download");
        if (btnDownload) {
          btnDownload.classList.remove("disabled");
          const results = currentResults;
          btnDownload.onclick = async () => {
            const zip = new JSZip();
            zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
            const blob = await zip.generateAsync({ type: "blob" });
            downloadBlob(blob, `bgaa_${results.tableNumber}${lastMoveId(results.rawData.packets)}.zip`);
          };
        }
      }
    }
    return undefined;
  });
}

// Re-render the stats page whenever the tracked sessions change in storage — e.g. the active
// session ends as you navigate away (its dot should disappear and it should become a finished row).
// Fires after the write completes, so it reflects up-to-date data (no message-timing race).
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !statsPageOpen()) return;
    // Keys mirror time-tracking.ts (STORAGE_KEY_SESSIONS / _ACTIVE / _MODES / _TYPES).
    if (changes["bgaa_time_sessions"] || changes["bgaa_time_active"] || changes["bgaa_time_modes"] || changes["bgaa_time_types"]) {
      showStats();
    }
  });
}

function getCurrentPinMode(): PinMode { return currentPinMode; }

// Export for testing
export { render, showHelp, showHelpWithRawData, setupToggles, downloadBlob, fetchCardDb, initPinButton, openPinDropdown, closePinDropdown, selectPinMode, updatePinButtonIcon, getCurrentPinMode, setupHelpTabs, switchZoomContext, PIN_ICONS };
