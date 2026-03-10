// Side panel: receives data from background, renders summary, handles downloads.

import JSZip from "jszip";
import { renderSummary, renderFullPage, setAssetResolver } from "../innovation/render.js";
import { SECTION_IDS, SECTION_LABELS } from "../innovation/config.js";
import { renderHelp } from "../render/help.js";
import { CardDatabase, type GameName } from "../models/types.js";
import { GameState } from "../innovation/game_state.js";
import { renderAzulSummary, setAssetResolver as setAzulAssetResolver } from "../azul/render.js";
import { fromJSON as azulFromJSON, type SerializedAzulGameState } from "../azul/game_state.js";
import type { PipelineResults, PinMode } from "../background.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentResults: PipelineResults | null = null;
let currentCss: string | null = null;
let cachedCardDb: CardDatabase | null = null;
let disconnectTimer: number | undefined;

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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Tooltip positioning (mouse-follow)
// ---------------------------------------------------------------------------

let tooltipsInitialized = false;

function setupTooltips(): void {
  if (tooltipsInitialized) return;
  tooltipsInitialized = true;
  document.addEventListener("mousemove", (e: MouseEvent) => {
    const tips = document.querySelectorAll<HTMLElement>(".card:hover > .card-tip, .card:hover > .card-tip-text");
    tips.forEach((tip) => {
      const rect = tip.getBoundingClientRect();
      const w = rect.width || 375;
      const h = rect.height || 275;
      let x = e.clientX + 12;
      let y = e.clientY + 12;
      if (x + w > window.innerWidth) x = e.clientX - w - 12;
      if (y + h > window.innerHeight) y = e.clientY - h - 12;
      if (x < 0) x = 4;
      if (y < 0) y = 4;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
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

function applyToggleMode(toggle: HTMLElement, mode: string, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;

  toggle.querySelectorAll(".tri-opt").forEach((o) => o.classList.remove("active"));
  toggle.querySelector<HTMLElement>(`.tri-opt[data-mode="${mode}"]`)?.classList.add("active");

  // Only the primary (first) toggle for a target controls visibility and sibling display
  const allToggles = toggle.parentElement?.querySelectorAll<HTMLElement>(`.tri-toggle[data-target="${targetId}"]`);
  const isPrimary = !allToggles || allToggles[0] === toggle;

  if (isPrimary) {
    const siblingDisplay = mode === "none" ? "none" : "";
    allToggles?.forEach((sib) => {
      if (sib !== toggle) sib.style.display = siblingDisplay;
    });
  }

  if (mode === "none") {
    target.style.display = "none";
  } else if (mode === "base" || mode === "echoes" || mode === "cities") {
    target.style.display = "";
    target.querySelectorAll<HTMLElement>("[data-set]").forEach((el) => {
      el.style.display = el.getAttribute("data-set") === mode ? "" : "none";
    });
  } else if (mode === "all") {
    if (isPrimary) target.style.display = "";
    target.classList.remove("mode-unknown");
  } else if (mode === "unknown") {
    if (isPrimary) target.style.display = "";
    target.classList.add("mode-unknown");
  } else if (mode === "wide" || mode === "tall") {
    document.querySelectorAll<HTMLElement>(`.layout-wide[data-list="${targetId}"]`).forEach((el) => {
      el.style.display = mode === "wide" ? "" : "none";
    });
    document.querySelectorAll<HTMLElement>(`.layout-tall[data-list="${targetId}"]`).forEach((el) => {
      el.style.display = mode === "tall" ? "" : "none";
    });
  }
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

  if (results.gameName === "azul") {
    const azulState = azulFromJSON(results.gameState as SerializedAzulGameState);
    contentEl.innerHTML = renderAzulSummary(azulState);

    // Hide section selector (Innovation-only feature)
    const btnSections = document.getElementById("btn-sections");
    if (btnSections) btnSections.style.display = "none";

    // Populate game info bar
    const tableEl = document.getElementById("game-info-table");
    if (tableEl) tableEl.textContent = `# ${results.tableNumber}`;
    const timeEl = document.getElementById("game-info-time");
    if (timeEl) {
      const packets = results.rawData.packets;
      const lastTime = packets.length > 0 ? packets[packets.length - 1].time : 0;
      timeEl.textContent = lastTime ? new Date(lastTime * 1000).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
    }

    // Show download button for Azul
    const btnDownload = document.getElementById("btn-download");
    if (btnDownload) {
      btnDownload.classList.remove("disabled");
      btnDownload.onclick = async () => {
        const zip = new JSZip();
        zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
        zip.file("game_log.json", JSON.stringify(results.gameLog, null, 2));
        zip.file("game_state.json", JSON.stringify(results.gameState, null, 2));
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `bgaa_${results.tableNumber}.zip`);
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
  if (btnSections) btnSections.style.display = "";

  const cardInfoUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("assets/bga/innovation/card_info.json")
    : "assets/bga/innovation/card_info.json";
  fetchCardDb(cardInfoUrl).then((db) => {
    renderWithDb(db, results, contentEl);
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

function renderWithDb(cardDb: CardDatabase, results: PipelineResults, contentEl: HTMLElement): void {
  const { gameLog, gameState: serializedState } = results;

  // Reconstruct GameState from serialized form
  const players = Object.keys(serializedState.hands);
  const perspective = gameLog.currentPlayerId && gameLog.players[gameLog.currentPlayerId] ? gameLog.players[gameLog.currentPlayerId] : players[0];
  const gameState = GameState.fromJSON(serializedState, cardDb, players, perspective);
  const tableId = "game";

  // Render summary HTML
  const summaryHtml = renderSummary(gameState, cardDb, perspective, players, tableId);
  contentEl.innerHTML = summaryHtml;

  // Populate game info bar
  const tableEl = document.getElementById("game-info-table");
  if (tableEl) tableEl.textContent = `# ${results.tableNumber}`;
  const timeEl = document.getElementById("game-info-time");
  if (timeEl) {
    const packets = results.rawData.packets;
    const lastTime = packets.length > 0 ? packets[packets.length - 1].time : 0;
    timeEl.textContent = lastTime ? new Date(lastTime * 1000).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  }

  // Set up interactivity
  setupTooltips();
  setupToggles();
  applySectionVisibility();

  // Cache CSS for downloads
  loadCss();

  // Show and wire download button (use onclick to replace any previous handler on re-render)
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) {
    btnDownload.classList.remove("disabled");
    btnDownload.onclick = async () => {
      const css = currentCss ?? "";
      setAssetResolver((path: string) => path);
      let summaryHtmlFile: string;
      try {
        summaryHtmlFile = renderFullPage(gameState, cardDb, perspective, players, tableId, css);
      } finally {
        if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
          setAssetResolver((path: string) => chrome.runtime.getURL(path));
        }
      }
      const zip = new JSZip();
      zip.file("raw_data.json", JSON.stringify(results.rawData, null, 2));
      zip.file("game_log.json", JSON.stringify(gameLog, null, 2));
      zip.file("game_state.json", JSON.stringify(serializedState, null, 2));
      zip.file("summary.html", summaryHtmlFile);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `bgaa_${results.tableNumber}.zip`);
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

  for (const id of SECTION_IDS) {
    const checked = state[id] !== false;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.sectionId = id;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(SECTION_LABELS[id]));
    panel.appendChild(label);

    checkbox.addEventListener("change", () => {
      const current = loadSectionVisibility();
      current[id] = checkbox.checked;
      saveSectionVisibility(current);
      applySectionVisibility();
    });
  }
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
  "autohide-game": "Leaving tables",
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
      if (stored === "azul" || stored === "innovation") effectiveTab = stored;
    } catch { /* ignore */ }
  }
  try { localStorage.setItem(STORAGE_KEY_HELP_TAB, effectiveTab); } catch { /* ignore */ }

  contentEl.innerHTML = renderHelp(errorMessage, effectiveTab);
  setupHelpTabs();

  const tableEl = document.getElementById("game-info-table");
  if (tableEl) tableEl.textContent = "";
  const timeEl = document.getElementById("game-info-time");
  if (timeEl) timeEl.textContent = "";
  const indicator = document.getElementById("live-indicator");
  if (indicator) indicator.style.display = "none";
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) { btnDownload.classList.add("disabled"); btnDownload.onclick = null; }
  chrome.runtime.sendMessage({ type: "pauseLive" }).catch(() => {});

  // Enable download button if raw data is available (e.g. unsupported game)
  chrome.runtime.sendMessage({ type: "getRawData" }).then((rawData: { rawData: unknown; tableNumber: string } | null) => {
    if (!rawData || !btnDownload) return;
    btnDownload.classList.remove("disabled");
    btnDownload.onclick = async () => {
      const zip = new JSZip();
      zip.file("raw_data.json", JSON.stringify(rawData.rawData, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `bgaa_${rawData.tableNumber}.zip`);
    };
  }).catch(() => {});
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
    render(currentResults);
    chrome.runtime.sendMessage({ type: "resumeLive" }).catch(() => {});
  } else {
    showHelp(undefined, currentResults?.gameName);
  }
});


// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // Request data from background on load
  chrome.runtime.sendMessage({ type: "getResults" }).then((response: PipelineResults | null) => {
    if (response) {
      currentResults = response;
      render(response);
    } else {
      showHelp();
    }
  }).catch(() => {
    document.getElementById("content")!.innerHTML = '<div class="status">Connection lost. Click the extension icon to re-extract.</div>';
  });

  // Listen for pushed updates when re-extraction occurs while panel is open
  chrome.runtime.onMessage.addListener((message: { type: string; error?: string; active?: boolean }) => {
    if (message.type === "liveStatus") {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined; }
      const indicator = document.getElementById("live-indicator");
      if (indicator) {
        indicator.style.display = message.active ? "" : "none";
        indicator.classList.remove("disconnected");
      }
    } else if (message.type === "resultsReady") {
      chrome.runtime.sendMessage({ type: "getResults" }).then((response: PipelineResults | null) => {
        if (response) {
          currentResults = response;
          render(response);
        }
      }).catch(() => {
        document.getElementById("content")!.innerHTML = '<div class="status">Connection lost. Click the extension icon to re-extract.</div>';
      });
    } else if (message.type === "loading") {
      document.getElementById("content")!.innerHTML = '<div class="status">Loading game data...</div>';
      const tableEl = document.getElementById("game-info-table");
      if (tableEl) tableEl.textContent = "";
      const timeEl = document.getElementById("game-info-time");
      if (timeEl) timeEl.textContent = "";
    } else if (message.type === "notAGame") {
      showHelp();
    } else if (message.type === "gameError") {
      showHelp(message.error);
    }
    return undefined;
  });
}

function getCurrentPinMode(): PinMode { return currentPinMode; }

// Export for testing
export { render, showHelp, setupTooltips, setupToggles, applySectionVisibility, downloadBlob, fetchCardDb, initPinButton, openPinDropdown, closePinDropdown, selectPinMode, updatePinButtonIcon, getCurrentPinMode, setupHelpTabs, switchZoomContext, PIN_ICONS };
