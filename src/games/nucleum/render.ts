// NucleumGameState -> HTML. The turn history is the whole summary: Nucleum hides nothing, so
// there is no reconstructed state to draw beside it.

import type { PlayerInfo } from "../../models/types.js";
import { escapeHtml } from "../../render/icons.js";
import { playerColorAttr } from "../../render/player.js";
import { renderTurnHistoryRows as renderSharedTurnHistoryRows, type TurnHistoryOptions, type TurnHistoryRow } from "../../render/turn_history_rows.js";
import type { NucleumGameState } from "./game_state.js";
import { cityName, type NucleumActionDetail, type NucleumTurnAction } from "./types.js";

// ---------------------------------------------------------------------------
// Action text
// ---------------------------------------------------------------------------

/** The verb each action reads as. Lower case, matching the Innovation history's rows. */
const VERBS: Record<NucleumActionDetail["actionType"], string> = {
  urbanize: "urbanize",
  mine: "mine",
  turbine: "turbine",
  develop: "develop",
  contract: "take contract",
  fulfill: "fulfil contract",
  energize: "energize",
  tech: "unlock tech",
  nucleum: "nucleum",
  milestone: "milestone",
  sell: "sell uranium",
  railway: "railway",
  recharge: "recharge",
  experiment: "",
  tile: "plays a tile",
  pending: "",
};

/**
 * Format one action as row text.
 *
 * A railway names the two cities it joined only when the placement completed the link — an
 * unfinished link connects nothing yet, and its road number would mean nothing to a reader.
 */
export function formatNucleumActionDetail(detail: NucleumActionDetail, players: Record<string, PlayerInfo>, action?: NucleumTurnAction): string {
  const parts: string[] = [];

  // A railway colour match can hand an action to a player whose turn it is not, so say whose.
  if (action && detail.player !== action.player) {
    const actor = players[detail.player];
    if (actor) parts.push(`<span class="nucleum-actor" ${playerColorAttr(actor)}>${escapeHtml(actor.name)}</span>`);
  }

  if (detail.actionType === "experiment") {
    parts.push(escapeHtml(detail.label ?? "experiment"));
    return parts.join(" ");
  }

  const verb = VERBS[detail.actionType];
  if (!verb) return parts.join(" ");
  parts.push(verb);

  const city = cityName(detail.city);
  if (city) parts.push(escapeHtml(city));

  if (detail.link) {
    const [from, to] = detail.link;
    const fromName = cityName(from);
    const toName = cityName(to);
    if (fromName && toName) parts.push(`${escapeHtml(fromName)}–${escapeHtml(toName)}`);
  }

  if (detail.count !== null && detail.count > 1) parts.push(`×${detail.count}`);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Turn history
// ---------------------------------------------------------------------------

/** Render Nucleum turn history as individually keyed rows, binding the players the detail
 *  formatter needs to name a player acting out of turn. */
export function renderNucleumTurnHistoryRows(actions: NucleumTurnAction[], players: Record<string, PlayerInfo>, options: TurnHistoryOptions = {}): TurnHistoryRow[] {
  return renderSharedTurnHistoryRows(actions, Object.values(players), (detail, _popoverTips, action) => formatNucleumActionDetail(detail, players, action), options);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Render the Nucleum summary: the whole turn history, newest turn first. */
export function renderNucleumSummary(state: NucleumGameState): string {
  const rows = renderNucleumTurnHistoryRows(state.actions, state.players, { newestFirst: true });
  if (rows.length === 0) return '<div class="nucleum-history nucleum-empty">No turns played yet.</div>';
  return `<div class="nucleum-history">${rows.map(r => r.html).join("")}</div>`;
}

/** Render a full standalone HTML page (for download). */
export function renderNucleumFullPage(state: NucleumGameState, tableId: string, css: string): string {
  const bodyHtml = renderNucleumSummary(state);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Nucleum &mdash; ${escapeHtml(tableId)}</title>
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
