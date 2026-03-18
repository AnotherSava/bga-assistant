// Side panel: receives data from background, renders summary, handles downloads.

import JSZip from "jszip";
import { renderSummary, renderFullPage, renderTurnHistory, setAssetResolver } from "../games/innovation/render.js";
import { SECTION_IDS, SECTION_LABELS, ECHOES_ONLY_SECTIONS } from "../games/innovation/config.js";
import { recentTurns } from "../games/innovation/turn_history.js";
import { renderHelp } from "../render/help.js";
import { positionTooltip, applyToggleMode } from "../render/toggle.js";
import { CardDatabase, type GameName } from "../models/types.js";
import { GameEngine } from "../games/innovation/game_engine.js";
import { fromJSON as innovationFromJSON } from "../games/innovation/serialization.js";
import { renderAzulSummary, renderAzulFullPage, setAssetResolver as setAzulAssetResolver } from "../games/azul/render.js";
import { renderCrewSummary, renderCrewFullPage } from "../games/crew/render.js";
import { crewFromJSON } from "../games/crew/serialization.js";
import "../games/crew/styles.css";
import { fromJSON as azulFromJSON } from "../games/azul/game_state.js";
import type { PipelineResults, PinMode } from "../background.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentResults: PipelineResults | null = null;
let currentCss: string | null = null;
let cachedCardDb: CardDatabase | null = null;
let disconnectTimer: number | undefined;
let currentExpansions: { echoes: boolean } = { echoes: false };

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
      const port = chrome.runtime.connect(undefined, { name: "sidepanel" });
      port.onDisconnect.addListener(() => {
        disconnectTimer = window.setTimeout(() => {
          const indicator = document.getElementById("live-indicator");
          if (indicator && indicator.style.display !== "none") {
            indicator.classList.add("disconnected");
          }
        }, 3000);
        setTimeout(connectToBackground, 1000);
      });
    } catch {
      // Extension context invalidated (e.g. after update/uninstall); stop reconnecting.
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
// Tooltip positioning (mouse-follow)
// ---------------------------------------------------------------------------

let tooltipsInitialized = false;

function setupTooltips(): void {
  if (tooltipsInitialized) return;
  tooltipsInitialized = true;
  document.addEventListener("mousemove", (e: MouseEvent) => {
    const tips = document.querySelectorAll<HTMLElement>(".card:hover > .card-tip, .card:hover > .card-tip-text, .th-card:hover > .card-tip, .th-card:hover > .card-tip-text");
    tips.forEach((tip) => positionTooltip(tip, e.clientX, e.clientY));
  });
}

// ---------------------------------------------------------------------------
// Toggle handlers (visibility + layout) with persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY_HELP_TAB = "bgaa_help_tab";
const STORAGE_KEY_TOGGLES = "bgaa_toggle_state";

function loadToggleState(): Record<string, string[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TOGGLES);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveToggleState(state: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY_TOGGLES, JSON.stringify(state));
  } catch { /* ignore */ }
}

function persistToggleMode(targetId: string, toggle: HTMLElement, mode: string): void {
  const state = loadToggleState();
  const modes = state[targetId] ?? [];
  // Find which slot this toggle occupies (by DOM order among siblings with same target)
  const allToggles = Array.from(toggle.parentElement?.querySelectorAll<HTMLElement>(`.tri-toggle[data-target="${targetId}"]`) ?? []);
  const idx = allToggles.indexOf(toggle);
  while (modes.length <= idx) modes.push("");
  modes[idx] = mode;
  state[targetId] = modes;
  saveToggleState(state);
}

function setupToggles(): void {
  // Restore saved state
  const saved = loadToggleState();
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
  const players = Object.keys(serializedState.hands);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
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

  // Set up interactivity
  setupTooltips();
  setupToggles();
  applySectionVisibility();

  // Render turn history
  const turnHistoryEl = document.getElementById("turn-history");
  if (turnHistoryEl) {
    const recent = recentTurns(gameLog.actions, 3);
    turnHistoryEl.innerHTML = renderTurnHistory(recent, cardDb, perspective);
    applyTurnHistoryVisibility(); // also calls updateHandMargins()
  }

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
let zoomLevel = 1.0;
let zoomFadeTimeout: ReturnType<typeof setTimeout> | undefined;
let currentZoomContext = "help";

function zoomStorageKey(): string {
  return `bgaa_zoom_${currentZoomContext}`;
}

function switchZoomContext(context: string): void {
  currentZoomContext = context;
  let level = 1.0;
  try {
    const stored = localStorage.getItem(zoomStorageKey());
    if (stored) {
      const parsed = parseFloat(stored);
      if (parsed >= ZOOM_MIN && parsed <= ZOOM_MAX) level = parsed;
    }
  } catch { /* ignore */ }
  zoomLevel = level;
  const contentEl = document.getElementById("content");
  if (contentEl) contentEl.style.zoom = String(zoomLevel);
}

// Remove legacy single-zoom key
try { localStorage.removeItem("bgaa_zoom"); } catch { /* ignore */ }

function applyZoom(): void {
  const contentEl = document.getElementById("content");
  if (contentEl) contentEl.style.zoom = String(zoomLevel);
  try { localStorage.setItem(zoomStorageKey(), String(zoomLevel)); } catch { /* ignore */ }
  const indicator = document.getElementById("zoom-indicator");
  if (indicator) {
    indicator.textContent = `${Math.round(zoomLevel * 100)}%`;
    indicator.classList.add("visible");
    clearTimeout(zoomFadeTimeout);
    zoomFadeTimeout = setTimeout(() => indicator.classList.remove("visible"), 1200);
  }
  updateHandMargins();
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

const STORAGE_KEY_SECTIONS = "bgaa_section_visibility";

function loadSectionVisibility(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SECTIONS);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveSectionVisibility(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY_SECTIONS, JSON.stringify(state));
  } catch { /* ignore */ }
}

function buildSectionSelector(): void {
  const panel = document.getElementById("section-selector");
  if (!panel) return;

  const state = loadSectionVisibility();
  panel.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "Display sections:";
  panel.appendChild(header);

  // Turn history toggle (not a card section, separate element)
  {
    const checked = state["turn-history"] !== false;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.sectionId = "turn-history";
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(SECTION_LABELS["turn-history"]));
    panel.appendChild(label);

    checkbox.addEventListener("change", () => {
      const current = loadSectionVisibility();
      current["turn-history"] = checkbox.checked;
      saveSectionVisibility(current);
      applyTurnHistoryVisibility();
    });
  }

  for (const id of SECTION_IDS) {
    const isEchoesOnly = ECHOES_ONLY_SECTIONS.has(id);
    const disabled = isEchoesOnly && !currentExpansions.echoes;
    const checked = !disabled && state[id] !== false;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.disabled = disabled;
    checkbox.dataset.sectionId = id;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(SECTION_LABELS[id]));
    if (disabled) label.style.opacity = "0.4";
    panel.appendChild(label);

    checkbox.addEventListener("change", () => {
      const current = loadSectionVisibility();
      current[id] = checkbox.checked;
      saveSectionVisibility(current);
      applySectionVisibility();
    });
  }
}

function applyTurnHistoryVisibility(): void {
  const state = loadSectionVisibility();
  const visible = state["turn-history"] !== false;
  const el = document.getElementById("turn-history");
  if (el) el.style.display = visible ? "" : "none";
  updateHandMargins();
}

function updateHandMargins(): void {
  const turnHistoryEl = document.getElementById("turn-history");
  const handOpponent = document.querySelector<HTMLElement>('.section[data-section="hand-opponent"]');
  const handMe = document.querySelector<HTMLElement>('.section[data-section="hand-me"]');
  if (!turnHistoryEl || (!handOpponent && !handMe)) return;

  const isVisible = turnHistoryEl.style.display !== "none" && turnHistoryEl.innerHTML !== "";
  const width = isVisible ? turnHistoryEl.offsetWidth : 0;
  const marginPx = width > 0 ? `${Math.ceil((width + 8) / zoomLevel)}px` : "";

  if (handOpponent) handOpponent.style.marginRight = marginPx;
  if (handMe) handMe.style.marginRight = marginPx;
}

function applySectionVisibility(): void {
  const state = loadSectionVisibility();
  for (const id of SECTION_IDS) {
    const visible = state[id] !== false;
    const sectionEl = document.querySelector<HTMLElement>(`.section[data-section="${id}"]`);
    if (sectionEl) {
      sectionEl.classList.toggle("section-hidden", !visible);
    }
  }
}

document.getElementById("btn-sections")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const panel = document.getElementById("section-selector");
  if (!panel) return;
  if (panel.style.display === "none") {
    closePinDropdown();
    buildSectionSelector();
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

let currentPinMode: PinMode = "pinned";
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

// Load initial pin mode from background
if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  chrome.runtime.sendMessage({ type: "getPinMode" }).then((mode: PinMode | null) => {
    if (mode) {
      currentPinMode = mode;
      updatePinButtonIcon();
    }
  }).catch(() => {});
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
  let effectiveTab: GameName = "innovation";
  if (forceGameTab) {
    effectiveTab = forceGameTab;
  } else {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_HELP_TAB);
      if (stored === "azul" || stored === "innovation" || stored === "thecrewdeepsea") effectiveTab = stored;
    } catch { /* ignore */ }
  }
  try { localStorage.setItem(STORAGE_KEY_HELP_TAB, effectiveTab); } catch { /* ignore */ }

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

      try { localStorage.setItem(STORAGE_KEY_HELP_TAB, tabName); } catch { /* ignore */ }
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


// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // Start with help page — background will push results via "resultsReady" on port connect.
  showHelp();

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
        if (same) return;
        if (!sameTable) closeMenus();
        if (response.gameState) {
          render(response);
        } else {
          showHelpWithRawData(response);
        }
      }
    } else if (message.type === "loading") {
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
      showHelp();
    } else if (message.type === "gameError") {
      currentResults = message.results ?? null;
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

function getCurrentPinMode(): PinMode { return currentPinMode; }

// Export for testing
export { render, showHelp, showHelpWithRawData, setupTooltips, setupToggles, applySectionVisibility, applyTurnHistoryVisibility, downloadBlob, fetchCardDb, initPinButton, openPinDropdown, closePinDropdown, selectPinMode, updatePinButtonIcon, getCurrentPinMode, setupHelpTabs, switchZoomContext, PIN_ICONS };
