// Innovation display options: section visibility with localStorage persistence.

import { SECTION_IDS, SECTION_LABELS, ECHOES_ONLY_SECTIONS, RELICS_ONLY_SECTIONS } from "./config.js";
import { loadSetting, saveSetting } from "../../sidepanel/settings.js";

export interface InnovationDisplayContext {
  echoes: boolean;
  relics: boolean;
  zoomLevel: number;
}

const KEY = "bgaa_section_visibility";
const DEFAULTS: Record<string, boolean> = {};

function loadSections(): Record<string, boolean> {
  return loadSetting(KEY, DEFAULTS);
}

function saveSections(state: Record<string, boolean>): void {
  saveSetting(KEY, state);
}

export function buildInnovationDisplayMenu(panel: HTMLElement, context: InnovationDisplayContext): void {
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "Display sections:";
  panel.appendChild(header);

  const state = loadSections();

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
      const current = loadSections();
      current["turn-history"] = checkbox.checked;
      saveSections(current);
      applyTurnHistoryVisibility(context);
    });
  }

  for (const id of SECTION_IDS) {
    const disabled = (ECHOES_ONLY_SECTIONS.has(id) && !context.echoes) || (RELICS_ONLY_SECTIONS.has(id) && !context.relics);
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
      const current = loadSections();
      current[id] = checkbox.checked;
      saveSections(current);
      applySectionVisibility();
    });
  }
}

function applyTurnHistoryVisibility(context: InnovationDisplayContext): void {
  const state = loadSections();
  const visible = state["turn-history"] !== false;
  const el = document.getElementById("turn-history");
  if (el) el.style.display = visible ? "" : "none";
  updateHandMargins(context);
}

function updateHandMargins(context: InnovationDisplayContext): void {
  const turnHistoryEl = document.getElementById("turn-history");
  const handOpponent = document.querySelector<HTMLElement>('.section[data-section="hand-opponent"]');
  const handMe = document.querySelector<HTMLElement>('.section[data-section="hand-me"]');
  if (!turnHistoryEl || (!handOpponent && !handMe)) return;

  const isVisible = turnHistoryEl.style.display !== "none" && turnHistoryEl.innerHTML !== "";
  const width = isVisible ? turnHistoryEl.offsetWidth : 0;
  const marginPx = width > 0 ? `${Math.ceil((width + 8) / context.zoomLevel)}px` : "";

  if (handOpponent) handOpponent.style.marginRight = marginPx;
  if (handMe) handMe.style.marginRight = marginPx;
}

export function applySectionVisibility(): void {
  const state = loadSections();
  for (const id of SECTION_IDS) {
    const visible = state[id] !== false;
    const sectionEl = document.querySelector<HTMLElement>(`.section[data-section="${id}"]`);
    if (sectionEl) {
      sectionEl.classList.toggle("section-hidden", !visible);
    }
  }
}

export function applyInnovationDisplayOptions(context: InnovationDisplayContext): void {
  applySectionVisibility();
  applyTurnHistoryVisibility(context);
}
