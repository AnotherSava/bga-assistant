// CrewGameState -> HTML summary string (card grid, player-suit matrix, trick history).

import type { CrewGameState } from "./game_state.js";
import { playerSuitStatus, getPlayedCards } from "./game_engine.js";
import { ALL_SUITS, SUIT_VALUES, PINK, BLUE, GREEN, YELLOW, SUBMARINE, cardKey } from "./types.js";
import { playerColorAttr } from "../../render/player.js";

// ---------------------------------------------------------------------------
// Suit icons — inline SVG constants (color-blind accessible geometric shapes)
// ---------------------------------------------------------------------------

const SUIT_ICONS: Record<number, string> = {
  [BLUE]: '<svg viewBox="0 0 12 12" width="12" height="12"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>',
  [GREEN]: '<svg viewBox="0 0 12 12" width="12" height="12"><polygon points="6,1 11,11 1,11" fill="currentColor"/></svg>',
  [PINK]: '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>',
  [YELLOW]: '<svg viewBox="0 0 12 12" width="12" height="12"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  [SUBMARINE]: '<svg viewBox="0 0 16 12" width="16" height="12"><ellipse cx="8" cy="7" rx="7" ry="4" fill="currentColor"/><rect x="6" y="2" width="4" height="4" rx="1" fill="currentColor"/><rect x="7" y="0" width="2" height="3" fill="currentColor"/></svg>',
};

const SUIT_CSS_CLASS: Record<number, string> = {
  [PINK]: "crew-pink",
  [BLUE]: "crew-blue",
  [GREEN]: "crew-green",
  [YELLOW]: "crew-yellow",
  [SUBMARINE]: "crew-sub",
};

const SUIT_NAMES: Record<number, string> = {
  [PINK]: "Pink",
  [BLUE]: "Blue",
  [GREEN]: "Green",
  [YELLOW]: "Yellow",
  [SUBMARINE]: "Sub",
};

// ---------------------------------------------------------------------------
// Card grid section (9 rows x 5 columns)
// ---------------------------------------------------------------------------

function renderCardGrid(state: CrewGameState): string {
  const played = getPlayedCards(state);
  const mySlots = state.hands[state.currentPlayerId];
  const myHand = new Set<string>();
  for (const slot of mySlots) {
    if (slot.candidates.size === 1) {
      myHand.add([...slot.candidates][0]);
    }
  }

  let html = '<div class="crew-section"><div class="crew-section-title">Cards</div>';
  html += '<div class="crew-card-grid">';

  // Header row with suit icons
  html += '<div class="crew-grid-header"><div class="crew-grid-corner"></div>';
  for (const suit of ALL_SUITS) {
    html += `<div class="crew-grid-suit-header ${SUIT_CSS_CLASS[suit]}">${SUIT_ICONS[suit]}</div>`;
  }
  html += '</div>';

  // Value rows (1-9)
  for (let value = 1; value <= 9; value++) {
    html += '<div class="crew-grid-row">';
    html += `<div class="crew-grid-value-label">${value}</div>`;
    for (const suit of ALL_SUITS) {
      if (suit === SUBMARINE && value > 4) {
        html += '<div class="crew-grid-cell crew-grid-empty"></div>';
        continue;
      }
      const key = cardKey(suit, value);
      let stateClass: string;
      if (played.has(key)) {
        stateClass = "crew-played";
      } else if (myHand.has(key)) {
        stateClass = "crew-myhand";
      } else {
        stateClass = "crew-hidden";
      }
      html += `<div class="crew-grid-cell ${SUIT_CSS_CLASS[suit]} ${stateClass}"><span class="crew-cell-value">${value}</span><span class="crew-cell-icon">${SUIT_ICONS[suit]}</span></div>`;
    }
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Player-suit matrix section
// ---------------------------------------------------------------------------

function effectivePlayerOrder(state: CrewGameState): string[] {
  return state.playerOrder.length > 0 ? state.playerOrder : Object.keys(state.players);
}

function renderSuitMatrix(state: CrewGameState): string {
  const matrix = playerSuitStatus(state);
  let html = '<div class="crew-section"><div class="crew-section-title">Player\u2013Suit</div>';
  html += '<table class="crew-matrix"><thead><tr><th></th>';
  for (const suit of ALL_SUITS) {
    html += `<th class="${SUIT_CSS_CLASS[suit]}">${SUIT_ICONS[suit]}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const pid of effectivePlayerOrder(state)) {
    const player = state.players[pid];
    const isMe = pid === state.currentPlayerId;
    const rowClass = isMe ? ' class="crew-matrix-me"' : '';
    html += `<tr ${playerColorAttr(player)}${rowClass}><td class="crew-matrix-name">${escapeHtml(player.name)}</td>`;
    for (const suit of ALL_SUITS) {
      const status = matrix[pid][suit];
      let cls = "crew-matrix-unknown";
      if (status === "X") cls = "crew-matrix-void";
      else if (status === "!") cls = "crew-matrix-has";
      html += `<td class="crew-matrix-cell ${cls}">${status}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Trick history section
// ---------------------------------------------------------------------------

function renderTrickHistory(state: CrewGameState): string {
  let html = '<div class="crew-section"><div class="crew-section-title">Tricks</div>';
  html += '<table class="crew-tricks"><thead><tr><th></th>';
  for (const pid of effectivePlayerOrder(state)) {
    const player = state.players[pid];
    const isMe = pid === state.currentPlayerId;
    const cls = isMe ? "crew-tricks-player crew-tricks-me-col" : "crew-tricks-player";
    html += `<th class="${cls}" ${playerColorAttr(player)}>${escapeHtml(player.name)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let i = 0; i < state.tricks.length; i++) {
    const trick = state.tricks[i];
    if (trick.cards.length === 0) continue;
    const isCurrent = trick.winnerId === null;
    const leadPlayerId = trick.cards[0].playerId;
    html += `<tr${isCurrent ? ' class="crew-trick-current"' : ''}><td class="crew-trick-num">${i + 1}</td>`;
    for (const pid of effectivePlayerOrder(state)) {
      const play = trick.cards.find(c => c.playerId === pid);
      const player = state.players[pid];
      const isMe = pid === state.currentPlayerId;
      const cellClass = isMe ? "crew-trick-cell crew-tricks-me-col" : "crew-trick-cell";
      if (play) {
        const isLead = pid === leadPlayerId;
        const isWinner = pid === trick.winnerId;
        let cls = SUIT_CSS_CLASS[play.card.suit];
        if (isLead) cls += " crew-lead";
        if (isWinner) cls += " crew-winner";
        html += `<td class="${cellClass}" ${playerColorAttr(player)}><div class="crew-grid-cell ${cls}"><span class="crew-cell-value">${play.card.value}</span><span class="crew-cell-icon">${SUIT_ICONS[play.card.suit]}</span></div></td>`;
      } else {
        html += `<td class="${cellClass}" ${playerColorAttr(player)}></td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render the full Crew summary as an HTML string with three sections. */
export function renderCrewSummary(state: CrewGameState): string {
  let html = '<div class="crew-summary">';
  html += renderCardGrid(state);
  html += renderSuitMatrix(state);
  html += renderTrickHistory(state);
  html += '</div>';
  return html;
}

/** Render a full standalone HTML page (for download). */
export function renderCrewFullPage(state: CrewGameState, tableId: string, css: string): string {
  const bodyHtml = renderCrewSummary(state);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>The Crew &mdash; ${escapeHtml(tableId)}</title>
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
