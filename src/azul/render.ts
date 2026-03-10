// AzulGameState -> HTML summary string (compact tile count table).

import type { AzulGameState } from "./game_state.js";

// ---------------------------------------------------------------------------
// Tile color names (indexed by tile type 1-5)
// ---------------------------------------------------------------------------

const TILE_COLORS: string[] = ["", "black", "cyan", "blue", "yellow", "red"];

// ---------------------------------------------------------------------------
// Asset URL resolution
// ---------------------------------------------------------------------------

let resolveAssetUrl = (path: string): string => path;

export function setAssetResolver(resolver: (path: string) => string): void {
  resolveAssetUrl = resolver;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Render the Azul summary as an HTML string: a compact table with bag/box counts per color. */
export function renderAzulSummary(state: AzulGameState): string {
  let html = '<div class="azul-summary">';

  // Table: 5 color columns, 2 rows (Bag, Box)
  html += '<table class="azul-table"><thead><tr>';
  html += '<th></th>';
  for (let t = 1; t <= 5; t++) {
    html += `<th><img src="${resolveAssetUrl(`assets/bga/azul/tiles/tile_${t}.png`)}" width="24" height="24" alt="${TILE_COLORS[t]}"></th>`;
  }
  html += '</tr></thead><tbody>';

  // Bag row
  html += '<tr><td class="azul-row-label">Bag</td>';
  for (let t = 1; t <= 5; t++) {
    const count = state.bag[t];
    html += `<td class="azul-count${count === 0 ? " azul-zero" : ""}">${count}</td>`;
  }
  html += '</tr>';

  // Box row (discard pile / box lid)
  html += '<tr><td class="azul-row-label">Box</td>';
  for (let t = 1; t <= 5; t++) {
    const count = state.discard[t];
    html += `<td class="azul-count${count === 0 ? " azul-zero" : ""}">${count}</td>`;
  }
  html += '</tr>';

  html += '</tbody></table>';

  // Refill annotation
  if (state.refillRounds.length > 0) {
    const rounds = state.refillRounds.map((r) => String(r)).join(", ");
    const plural = state.refillRounds.length > 1 ? "rounds" : "round";
    html += `<div class="azul-refill-note">Bag refilled from box before ${plural} ${rounds}</div>`;
  }

  html += '</div>';
  return html;
}
