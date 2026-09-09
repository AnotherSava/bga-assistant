// Settings shared by every game that shows a turn history, and the menu rows that drive them.
//
// They live here rather than in one game's display menu because both surfaces and both games
// read them: keeping a second copy per game is how the mirror into the in-page store drifts.
// The rows are built here for the same reason — every game with a history offers the same options
// in the same order, and only the indent they hang at differs.

import { loadSetting, saveSetting } from "./settings.js";
import { loadInPageSettings, saveInPageSettings } from "./inpage_settings.js";

const SHOW_NAMES_KEY = "bgaa_show_player_names";
const SHOW_TIMES_KEY = "bgaa_show_timestamps";

/** Whether history rows spell out player names rather than "you"/"opp". */
function loadShowPlayerNames(): boolean {
  return loadSetting(SHOW_NAMES_KEY, false);
}

function saveShowPlayerNames(value: boolean): void {
  saveSetting(SHOW_NAMES_KEY, value);
  // Mirror into the in-page log's own store so one checkbox drives both surfaces — the
  // service worker renders that log and cannot read the panel's localStorage.
  void saveInPageSettings({ showPlayerNames: value });
}

function applyShowPlayerNames(): void {
  document.body.classList.toggle("show-player-names", loadShowPlayerNames());
}

/**
 * Whether the panel's history rows carry the time they happened at.
 *
 * Deliberately not mirrored the way the player names are: the panel and BGA's log column are
 * different widths and are read at different moments, so `InPageSettings.showTimestamps` is a
 * setting of its own rather than a copy of this one.
 */
function loadShowTimestamps(): boolean {
  return loadSetting(SHOW_TIMES_KEY, true);
}

function saveShowTimestamps(value: boolean): void {
  saveSetting(SHOW_TIMES_KEY, value);
}

/** Hiding rather than re-rendering: the rows already carry the time, and this is what they look like. */
function applyShowTimestamps(): void {
  document.body.classList.toggle("hide-timestamps", !loadShowTimestamps());
}

/** Apply every shared turn-history setting to the panel as it stands. */
export function applyTurnHistorySettings(): void {
  applyShowPlayerNames();
  applyShowTimestamps();
}

/** One checkbox row of the eye menu, at `depth` levels of indent under the menu's own left edge. */
function optionRow(panel: HTMLElement, text: string, depth: number): { label: HTMLLabelElement; checkbox: HTMLInputElement } {
  const label = document.createElement("label");
  if (depth === 1) label.className = "sub-option";
  else if (depth >= 2) label.className = "sub-option-2";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(text));
  panel.appendChild(label);
  return { label, checkbox };
}

export interface TurnHistoryMenuOptions {
  /** Indent every row one level, for a menu that hangs them off a "Turn history" checkbox. */
  nested?: boolean;
  /**
   * Called after a toggle that changes how wide the panel's history renders.
   *
   * Innovation's history is a fixed overlay with no width of its own, and its hand sections reserve
   * a margin measured from it, so dropping the stamps has to be followed by measuring again — the
   * reclaimed width is the whole point of the option, and without this the hands keep the old
   * margin until something else forces a render.
   */
  onLayoutChange?: () => void;
}

/**
 * Append the turn-history options every game with a history offers.
 *
 * Timestamps are asked for twice on purpose — once for the panel, once for BGA's log column —
 * since the two surfaces are read at different moments and the narrow column is where a time
 * costs the most. Each sits under the surface it applies to, and the log's follows the log
 * itself, greyed out while there is no log to stamp.
 */
export function buildTurnHistoryOptions(panel: HTMLElement, options: TurnHistoryMenuOptions = {}): void {
  const depth = options.nested ? 1 : 0;
  // Both panel toggles change the rendered width of a history row, so each re-measures after
  // applying its class — never before, or the game measures the layout it is replacing.
  const onLayoutChange = options.onLayoutChange;

  const names = optionRow(panel, "Show player names", depth);
  names.checkbox.checked = loadShowPlayerNames();
  names.checkbox.addEventListener("change", () => {
    saveShowPlayerNames(names.checkbox.checked);
    applyShowPlayerNames();
    onLayoutChange?.();
  });

  const times = optionRow(panel, "Show timestamps", depth);
  times.checkbox.checked = loadShowTimestamps();
  times.checkbox.addEventListener("change", () => {
    saveShowTimestamps(times.checkbox.checked);
    applyShowTimestamps();
    onLayoutChange?.();
  });

  // The log and its own timestamps are stored in chrome.storage.local rather than localStorage
  // because the service worker renders that log and cannot read the panel's storage.
  const log = optionRow(panel, "Show in BGA game log", depth);
  const logTimes = optionRow(panel, "Show timestamps", depth + 1);

  /** Nothing to stamp while the log is off, so the sub-option follows its parent. */
  const syncLog = (): void => {
    logTimes.checkbox.disabled = !log.checkbox.checked;
    logTimes.label.classList.toggle("disabled", !log.checkbox.checked);
  };

  // Read after the rows are in the panel: the menu is rebuilt on each open, so a slow read
  // resolving against a discarded checkbox is harmless, while gating the build on it is not.
  void loadInPageSettings().then((settings) => {
    log.checkbox.checked = settings.enabled;
    logTimes.checkbox.checked = settings.showTimestamps;
    syncLog();
  });

  log.checkbox.addEventListener("change", () => {
    void saveInPageSettings({ enabled: log.checkbox.checked });
    syncLog();
  });

  logTimes.checkbox.addEventListener("change", () => {
    void saveInPageSettings({ showTimestamps: logTimes.checkbox.checked });
  });
}
