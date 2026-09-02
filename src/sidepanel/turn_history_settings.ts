// Settings shared by every game that shows a turn history.
//
// They live here rather than in one game's display menu because both surfaces and both games
// read them: keeping a second copy per game is how the mirror into the in-page store drifts.

import { loadSetting, saveSetting } from "./settings.js";
import { saveInPageSettings } from "./inpage_settings.js";

const SHOW_NAMES_KEY = "bgaa_show_player_names";

/** Whether history rows spell out player names rather than "you"/"opp". */
export function loadShowPlayerNames(): boolean {
  return loadSetting(SHOW_NAMES_KEY, false);
}

export function saveShowPlayerNames(value: boolean): void {
  saveSetting(SHOW_NAMES_KEY, value);
  // Mirror into the in-page log's own store so one checkbox drives both surfaces — the
  // service worker renders that log and cannot read the panel's localStorage.
  void saveInPageSettings({ showPlayerNames: value });
}

export function applyShowPlayerNames(): void {
  document.body.classList.toggle("show-player-names", loadShowPlayerNames());
}
