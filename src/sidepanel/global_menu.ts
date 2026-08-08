// The eye menu shown on the help page: settings that belong to no single game.
//
// Every other display menu is game-specific and lives beside its renderer. This one holds what
// applies across BGA, so it hangs off the help page — the only view that is not a game.

import { loadInPageSettings, saveInPageSettings } from "./inpage_settings.js";

/** Populate the eye-icon menu with the settings that apply to every BGA table. */
export function buildGlobalDisplayMenu(panel: HTMLElement): void {
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "dropdown-header";
  header.textContent = "On the game table:";
  panel.appendChild(header);

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "setting-compact-header";
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode("Compact BGA header"));
  panel.appendChild(label);

  const note = document.createElement("div");
  note.className = "dropdown-note";
  note.textContent = "Folds the table info, the current prompt and its buttons into one row. Applies to every game, supported or not.";
  panel.appendChild(note);

  // Progression only — a sub-option, since it restyles what the fold leaves in the corner.
  const progressionLabel = document.createElement("label");
  progressionLabel.className = "sub-option";
  const progressionCheckbox = document.createElement("input");
  progressionCheckbox.type = "checkbox";
  progressionCheckbox.id = "setting-progression-only";
  progressionLabel.appendChild(progressionCheckbox);
  progressionLabel.appendChild(document.createTextNode("Progression only"));
  panel.appendChild(progressionLabel);

  const progressionNote = document.createElement("div");
  progressionNote.className = "dropdown-note dropdown-note-sub";
  progressionNote.textContent = "Drops the table number and move count, leaving the percentage in the prompt's own type.";
  panel.appendChild(progressionNote);

  // Pinned panels — a setting of its own, not a sub-option: it needs nothing from the folded header,
  // and only reads its height to sit under it when there is one.
  const panelsLabel = document.createElement("label");
  const panelsCheckbox = document.createElement("input");
  panelsCheckbox.type = "checkbox";
  panelsCheckbox.id = "setting-sticky-panels";
  panelsLabel.appendChild(panelsCheckbox);
  panelsLabel.appendChild(document.createTextNode("Pin player panels"));
  panel.appendChild(panelsLabel);

  const panelsNote = document.createElement("div");
  panelsNote.className = "dropdown-note";
  panelsNote.textContent = "Keeps the player panels — and the turn history's view switch — at the top of their column while the board scrolls. Applies to every game, supported or not.";
  panel.appendChild(panelsNote);

  /** Nothing to strip down while the header is untouched, so the sub-option follows its parent. */
  const syncEnabled = (compactHeader: boolean): void => {
    progressionCheckbox.disabled = !compactHeader;
    progressionLabel.classList.toggle("disabled", !compactHeader);
    progressionNote.classList.toggle("disabled", !compactHeader);
  };

  // Read after the elements are in the panel: the menu is rebuilt on each open, so a slow read
  // resolving against a discarded checkbox is harmless, while gating the build on it is not.
  void loadInPageSettings().then((settings) => {
    checkbox.checked = settings.compactHeader;
    progressionCheckbox.checked = settings.progressionOnly;
    panelsCheckbox.checked = settings.stickyPanels;
    syncEnabled(settings.compactHeader);
  });

  checkbox.addEventListener("change", () => {
    syncEnabled(checkbox.checked);
    void saveInPageSettings({ compactHeader: checkbox.checked });
  });

  progressionCheckbox.addEventListener("change", () => {
    void saveInPageSettings({ progressionOnly: progressionCheckbox.checked });
  });

  panelsCheckbox.addEventListener("change", () => {
    void saveInPageSettings({ stickyPanels: panelsCheckbox.checked });
  });
}
