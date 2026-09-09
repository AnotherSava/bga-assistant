// Nucleum display options. The panel has one section — the turn history — so the menu holds what
// changes how that history reads and where it is shown, and then what the extension does to BGA's
// own table.

import { loadInPageSettings, saveInPageSettings } from "../../sidepanel/inpage_settings.js";
import { buildTurnHistoryOptions, applyTurnHistorySettings } from "../../sidepanel/turn_history_settings.js";

export function buildNucleumDisplayMenu(panel: HTMLElement): void {
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "Turn history:";
  panel.appendChild(header);

  // Under a header rather than a checkbox, so the rows sit at the menu's own left edge.
  buildTurnHistoryOptions(panel);

  // BGA's own player panels rather than the history, so it starts a section of its own. Stored in
  // chrome.storage.local like the rest of the in-page settings: the service worker applies it, and
  // it has no localStorage.
  {
    const header = document.createElement("div");
    header.className = "dropdown-header";
    header.textContent = "On BGA's table:";
    panel.appendChild(header);

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode("Compact player panels"));
    panel.appendChild(label);

    void loadInPageSettings().then((settings) => { checkbox.checked = settings.compactPlayerPanels; });

    checkbox.addEventListener("change", () => {
      void saveInPageSettings({ compactPlayerPanels: checkbox.checked });
    });
  }
}

export function applyNucleumDisplayOptions(): void {
  applyTurnHistorySettings();
}
