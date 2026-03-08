// Help page content for the side panel.

import { escapeHtml } from "./summary.js";
import { ICON_ZOOM_OUT, ICON_ZOOM_IN, ICON_EYE, ICON_DOWNLOAD, ICON_DOT_GREEN, ICON_DOT_RED } from "./icons.js";

export function renderHelp(errorMessage?: string): string {
  const errorNote = errorMessage
    ? `<div class="help-note"><span class="help-note-icon">&#x26A0;</span> Failed to process game log for this table.<br><span class="help-note-hint">${escapeHtml(errorMessage)}</span></div>`
    : "";

  return `${errorNote}
<div class="help">
  <div class="help-hero">
    <div class="help-hero-title">BGA Assistant</div>
    <div class="help-hero-sub">Game assistant for <a href="https://boardgamearena.com" target="_blank">Board Game Arena</a></div>
  </div>

  <p>Turn-based games on BGA can last for days or even weeks. By the time it's your turn,
  you might have forgotten what was drawn, returned, transferred, or scored several moves ago.</p>
  <p>BGA Assistant reads the game log and reconstructs the full game state — including deck stack order, hand contents, score piles — so you can focus
  on strategy instead of trying to remember what happened.</p>

  <div class="help-section">
    <div class="help-section-title">How to use</div>
    <ol class="help-steps">
      <li>Open a table for any supported game on <a href="https://boardgamearena.com" target="_blank">Board Game Arena</a>.</li>
      <li>Click the extension icon in your toolbar to open the side panel with the game summary.</li>
      <li>When you switch to another supported game tab, the side panel updates automatically.</li>
    </ol>
  </div>

  <div class="help-section">
    <div class="help-section-title">Top bar</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn help-btn-text">#</span> ${ICON_DOT_GREEN}<span style="color:#888;margin:0 1px">/</span>${ICON_DOT_RED}</span><span> Table number, connection status (green\u00a0=\u00a0connected, red\u00a0=\u00a0connection lost), and timestamp of the last game log action</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_ZOOM_OUT}</span> <span class="help-btn">${ICON_ZOOM_IN}</span></span><span> Zoom out / in (also <b>Ctrl</b>+<b>\u2212</b> / <b>Ctrl</b>+<b>=</b>)</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_EYE}</span></span><span> Toggle visible sections (settings persist across sessions)</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_DOWNLOAD}</span></span><span> Download a ZIP archive with raw packets, the game log, game state, and summary page</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn help-btn-text">?</span></span><span> This help page</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Sections</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">Hands</span> Your cards and what your opponent knows about them, and vice versa</div>
      <div class="help-grid-item"><span class="help-grid-label">Scores</span> Same for the score piles</div>
      <div class="help-grid-item"><span class="help-grid-label">Deck</span> Cards remaining in each deck, shown in draw order</div>
      <div class="help-grid-item"><span class="help-grid-label">Cards</span> All cards from each set, with an option to show <i>unknown</i> cards only</div>
      <div class="help-grid-item"><span class="help-grid-label">Achievements</span> Cards sidelined as standard achievements for Ages 1–9</div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Toggles</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">Hide / Show</span> Collapse or expand a section</div>
      <div class="help-grid-item"><span class="help-grid-label">Base / Cities</span> Switch between Base and Cities card sets (Deck and Cards sections)</div>
      <div class="help-grid-item"><span class="help-grid-label">All / Unknown</span> Show all cards or only unaccounted ones (Cards section)</div>
      <div class="help-grid-item"><span class="help-grid-label">Wide / Tall</span> Display one row per age, or a columnar grid grouped by color</div>
    </div>
    <div style="margin-top: 6px; font-size: 11px; color: #888;">All toggle states persist across sessions.</div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Card tooltips</div>
    <div class="help-sections-grid">
      <div class="help-grid-item">Hover over any known Base card to see its full image. Cities cards display their names only.</div>
    </div>
  </div>
</div>`;
}

