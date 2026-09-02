// Nucleum display options. The panel has one section — the turn history — so the menu holds
// only what changes how that history reads and where it is shown.

import { loadInPageSettings, saveInPageSettings } from "../../sidepanel/inpage_settings.js";
import { loadShowPlayerNames, saveShowPlayerNames, applyShowPlayerNames } from "../../sidepanel/turn_history_settings.js";

export function buildNucleumDisplayMenu(panel: HTMLElement): void {
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "Turn history:";
  panel.appendChild(header);

  {
    const label = document.createElement("label");
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

  // Stored in chrome.storage.local rather than localStorage because the service worker renders
  // that log and cannot read the panel's storage.
  {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode("Show in BGA game log"));
    panel.appendChild(label);

    void loadInPageSettings().then((settings) => { checkbox.checked = settings.enabled; });

    checkbox.addEventListener("change", () => {
      void saveInPageSettings({ enabled: checkbox.checked });
    });
  }

  // BGA's own player panels rather than the history, so it starts a section of its own. Stored
  // alongside the other in-page settings for the same reason as the log above.
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
  applyShowPlayerNames();
}
