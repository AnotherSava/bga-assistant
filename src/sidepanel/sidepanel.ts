// Side panel: receives data from background, renders summary, handles downloads.

import JSZip from "jszip";
import { renderSummary, renderFullPage, setAssetResolver } from "../render/summary.js";
import { SECTION_IDS, SECTION_LABELS } from "../render/config.js";
import { renderHelp } from "../render/help.js";
import { CardDatabase } from "../models/types.js";
import { GameState } from "../engine/game_state.js";
import type { PipelineResults } from "../background.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentResults: PipelineResults | null = null;
let currentCss: string | null = null;

// ---------------------------------------------------------------------------
// Asset URL resolution for Chrome extension context
// ---------------------------------------------------------------------------

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  setAssetResolver((path: string) => chrome.runtime.getURL(path));
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
  } else if (mode === "base" || mode === "cities") {
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

  const cardInfoUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("assets/bga/innovation/card_info.json")
    : "assets/bga/innovation/card_info.json";
  fetchCardDb(cardInfoUrl).then((db) => {
    renderWithDb(db, results, contentEl);
  }).catch(() => {
    contentEl.innerHTML = '<div class="status">Error loading card database</div>';
  });
}

async function fetchCardDb(url: string): Promise<CardDatabase> {
  const response = await fetch(url);
  const data = await response.json();
  return new CardDatabase(data);
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

  // Set up interactivity
  setupTooltips();
  setupToggles();
  applySectionVisibility();

  // Cache CSS for downloads
  loadCss();

  // Show and wire download button (use onclick to replace any previous handler on re-render)
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) {
    btnDownload.style.display = "";
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

function applyZoom(): void {
  document.body.style.zoom = String(zoomLevel);
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
// Help page
// ---------------------------------------------------------------------------

function showHelp(notAGameUrl?: string): void {
  const contentEl = document.getElementById("content");
  if (!contentEl) return;
  contentEl.innerHTML = renderHelp(notAGameUrl);
  const btnDownload = document.getElementById("btn-download");
  if (btnDownload) btnDownload.style.display = "none";
}

// Wire help button
document.getElementById("btn-help")?.addEventListener("click", () => {
  showHelp();
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
  chrome.runtime.onMessage.addListener((message: { type: string; url?: string }) => {
    if (message.type === "resultsReady") {
      chrome.runtime.sendMessage({ type: "getResults" }).then((response: PipelineResults | null) => {
        if (response) {
          currentResults = response;
          render(response);
        }
      }).catch(() => {
        document.getElementById("content")!.innerHTML = '<div class="status">Connection lost. Click the extension icon to re-extract.</div>';
      });
    } else if (message.type === "notAGame") {
      showHelp(message.url);
    }
    return undefined;
  });
}

// Export for testing
export { render, showHelp, setupTooltips, setupToggles, applySectionVisibility, downloadBlob, fetchCardDb };
