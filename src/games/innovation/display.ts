// Innovation display options: section visibility + show-player-names toggle, with localStorage persistence.

import { SECTION_IDS, SECTION_LABELS, ECHOES_ONLY_SECTIONS, RELICS_ONLY_SECTIONS } from "./config.js";
import { loadSetting, saveSetting } from "../../sidepanel/settings.js";
import { loadInPageSettings, saveInPageSettings, CARD_SCALE_MIN, CARD_SCALE_MAX, CARD_SCALE_STEP, ACTION_TINT_SPEED_MIN, ACTION_TINT_SPEED_MAX, ACTION_TINT_SPEED_STEP } from "../../sidepanel/inpage_settings.js";

export interface InnovationDisplayContext {
  echoes: boolean;
  relics: boolean;
  zoomLevel: number;
}

const KEY = "bgaa_section_visibility";
const DEFAULTS: Record<string, boolean> = {};

const SHOW_NAMES_KEY = "bgaa_show_player_names";

function loadSections(): Record<string, boolean> {
  return loadSetting(KEY, DEFAULTS);
}

function saveSections(state: Record<string, boolean>): void {
  saveSetting(KEY, state);
}

function loadShowPlayerNames(): boolean {
  return loadSetting(SHOW_NAMES_KEY, false);
}

function saveShowPlayerNames(value: boolean): void {
  saveSetting(SHOW_NAMES_KEY, value);
  // Mirror into the in-page log's own store so one checkbox drives both surfaces — the
  // service worker renders that log and cannot read the panel's localStorage.
  void saveInPageSettings({ showPlayerNames: value });
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

  // Show player names toggle (turn-history sub-option)
  {
    const label = document.createElement("label");
    label.className = "sub-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = loadShowPlayerNames();
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode("Show player names"));
    panel.appendChild(label);

    checkbox.addEventListener("change", () => {
      saveShowPlayerNames(checkbox.checked);
      applyShowPlayerNames();
    });
  }

  // In-page game log (turn-history sub-options). Stored in chrome.storage.local rather than
  // localStorage because the service worker renders that log and cannot read the panel's storage.
  {
    const logLabel = document.createElement("label");
    logLabel.className = "sub-option";
    const logCheckbox = document.createElement("input");
    logCheckbox.type = "checkbox";
    logLabel.appendChild(logCheckbox);
    logLabel.appendChild(document.createTextNode("Show in BGA game log"));
    panel.appendChild(logLabel);

    void loadInPageSettings().then((settings) => { logCheckbox.checked = settings.enabled; });

    logCheckbox.addEventListener("change", () => {
      void saveInPageSettings({ enabled: logCheckbox.checked });
    });
  }

  // Simplified cards on BGA's own table. Stored alongside the other in-page settings for the same
  // reason: the service worker applies it, and it has no localStorage. Top-level rather than a
  // sub-option — it restyles the board itself and owes nothing to the turn history above it.
  {
    const cardsLabel = document.createElement("label");
    const cardsCheckbox = document.createElement("input");
    cardsCheckbox.type = "checkbox";
    cardsLabel.appendChild(cardsCheckbox);
    cardsLabel.appendChild(document.createTextNode("Simplified cards on BGA's table"));
    panel.appendChild(cardsLabel);

    // How big those cards are drawn, as a percentage of the side panel's own. A sub-option: it
    // restyles nothing on its own, it only sizes what the checkbox above turned on.
    const scaleLabel = document.createElement("label");
    scaleLabel.className = "sub-option slider-option";
    const scaleSlider = document.createElement("input");
    scaleSlider.type = "range";
    scaleSlider.min = String(CARD_SCALE_MIN);
    scaleSlider.max = String(CARD_SCALE_MAX);
    scaleSlider.step = String(CARD_SCALE_STEP);
    const scaleValue = document.createElement("span");
    scaleValue.className = "slider-value";
    scaleLabel.appendChild(document.createTextNode("Size"));
    scaleLabel.appendChild(scaleSlider);
    scaleLabel.appendChild(scaleValue);
    panel.appendChild(scaleLabel);

    // The opponents' hands, which BGA draws face-down and this fills in with what has been deduced.
    // A sub-option: it draws the same card the checkbox above turned on, in the one place BGA shows
    // nothing at all.
    const handsLabel = document.createElement("label");
    handsLabel.className = "sub-option";
    const handsCheckbox = document.createElement("input");
    handsCheckbox.type = "checkbox";
    handsLabel.appendChild(handsCheckbox);
    handsLabel.appendChild(document.createTextNode("Opponents' hands"));
    panel.appendChild(handsLabel);

    // An Echo card's effect printed in full, rather than a mark saying the slot holds text. Small
    // enough at these card sizes to need the slider above, or the browser's own zoom, to read.
    const echoLabel = document.createElement("label");
    echoLabel.className = "sub-option";
    const echoCheckbox = document.createElement("input");
    echoCheckbox.type = "checkbox";
    echoLabel.appendChild(echoCheckbox);
    echoLabel.appendChild(document.createTextNode("Echo effects as text"));
    panel.appendChild(echoLabel);

    /** Grey the sub-options out while the cards they apply to are switched off. */
    const syncSubOptions = (): void => {
      scaleSlider.disabled = !cardsCheckbox.checked;
      echoCheckbox.disabled = !cardsCheckbox.checked;
      handsCheckbox.disabled = !cardsCheckbox.checked;
      scaleLabel.classList.toggle("disabled", !cardsCheckbox.checked);
      echoLabel.classList.toggle("disabled", !cardsCheckbox.checked);
      handsLabel.classList.toggle("disabled", !cardsCheckbox.checked);
    };

    void loadInPageSettings().then((settings) => {
      cardsCheckbox.checked = settings.simplifiedCards;
      scaleSlider.value = String(settings.cardScale);
      scaleValue.textContent = `${settings.cardScale}%`;
      echoCheckbox.checked = settings.echoText;
      handsCheckbox.checked = settings.opponentHands;
      syncSubOptions();
    });

    cardsCheckbox.addEventListener("change", () => {
      void saveInPageSettings({ simplifiedCards: cardsCheckbox.checked });
      syncSubOptions();
    });

    echoCheckbox.addEventListener("change", () => {
      void saveInPageSettings({ echoText: echoCheckbox.checked });
    });

    handsCheckbox.addEventListener("change", () => {
      void saveInPageSettings({ opponentHands: handsCheckbox.checked });
    });

    // On "input" rather than "change", so dragging resizes the board as it goes rather than only
    // when the handle is let go.
    scaleSlider.addEventListener("input", () => {
      const scale = Number(scaleSlider.value);
      scaleValue.textContent = `${scale}%`;
      void saveInPageSettings({ cardScale: scale });
    });
  }

  // Police-line highlight: hazard stripes across BGA's top bar when you must act during another
  // player's turn. Innovation only, so it lives here rather than in the global menu. Stored alongside
  // the other in-page settings — the service worker applies it, and it has no localStorage.
  {
    const tintLabel = document.createElement("label");
    const tintCheckbox = document.createElement("input");
    tintCheckbox.type = "checkbox";
    tintLabel.appendChild(tintCheckbox);
    tintLabel.appendChild(document.createTextNode("Police-line highlight"));
    panel.appendChild(tintLabel);

    // Scroll of the stripes: centre (0) is static, the sign is the direction, the magnitude is the
    // speed. A sub-option — it only tunes the highlight the checkbox above turns on.
    const speedLabel = document.createElement("label");
    speedLabel.className = "sub-option slider-option";
    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = String(ACTION_TINT_SPEED_MIN);
    speedSlider.max = String(ACTION_TINT_SPEED_MAX);
    speedSlider.step = String(ACTION_TINT_SPEED_STEP);
    const speedValue = document.createElement("span");
    speedValue.className = "slider-value";
    speedLabel.appendChild(document.createTextNode("Movement"));
    speedLabel.appendChild(speedSlider);
    speedLabel.appendChild(speedValue);
    panel.appendChild(speedLabel);

    const speedText = (v: number): string => v === 0 ? "static" : `${v > 0 ? "→" : "←"} ${Math.abs(v)}`;

    /** The movement slider only matters while the highlight itself is on, so it follows its parent. */
    const syncTint = (): void => {
      speedSlider.disabled = !tintCheckbox.checked;
      speedLabel.classList.toggle("disabled", !tintCheckbox.checked);
    };

    void loadInPageSettings().then((settings) => {
      tintCheckbox.checked = settings.actionTint;
      speedSlider.value = String(settings.actionTintSpeed);
      speedValue.textContent = speedText(settings.actionTintSpeed);
      syncTint();
    });

    tintCheckbox.addEventListener("change", () => {
      void saveInPageSettings({ actionTint: tintCheckbox.checked });
      syncTint();
    });

    speedSlider.addEventListener("input", () => {
      const speed = Number(speedSlider.value);
      speedValue.textContent = speedText(speed);
      void saveInPageSettings({ actionTintSpeed: speed });
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

export function applyShowPlayerNames(): void {
  document.body.classList.toggle("show-player-names", loadShowPlayerNames());
}

export function applyInnovationDisplayOptions(context: InnovationDisplayContext): void {
  applySectionVisibility();
  applyTurnHistoryVisibility(context);
  applyShowPlayerNames();
}
