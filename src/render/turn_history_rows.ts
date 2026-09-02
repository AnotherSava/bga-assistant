// Turn-history rows, shared by every game and by both surfaces that show them: the side
// panel and the turn history rendered into BGA's own log column.
//
// The only game-specific part is the text of one action, which arrives as a formatter
// callback — that is what keeps Innovation's card database out of this module and out of
// games that have no cards at all.

import type { PlayerInfo } from "../models/types.js";
import { escapeHtml } from "./icons.js";
import { playerColorAttr } from "./player.js";
import type { TurnAction } from "../engine/turn_history.js";

export interface TurnHistoryOptions {
  /** Newest half-turn first (BGA log order). Default is chronological (side panel order). */
  newestFirst?: boolean;
  /** Emit `popover="manual"` on card tips, for in-page rendering where clipping must be escaped. */
  popoverTips?: boolean;
  /** Emit `data-row-key` on every row, so a consumer can reconcile rows instead of replacing them. */
  rowKeys?: boolean;
  /** Drop the date from timestamps, keeping the time. For narrow columns where rows wrap. */
  timeOnly?: boolean;
}

/** One rendered row plus the stable key identifying it across renders. */
export interface TurnHistoryRow {
  key: string;
  html: string;
}

/**
 * Render one action detail as row text.
 *
 * `popoverTips` asks for tooltips that escape clipping (see `renderTurnHistoryRows`), and the
 * owning action is passed so a game can render a detail differently depending on whose turn it
 * sits in — Nucleum's railway matches let one player act during another player's turn.
 */
export type DetailFormatter<TDetail> = (detail: TDetail, popoverTips: boolean, action: TurnAction<TDetail>) => string;

/** Format a unix timestamp using the same locale format as the old top-bar clock.
 *  `timeOnly` drops the date for the in-page log, where rows wrap in a narrow column and the
 *  date costs a whole extra line for information that is redundant across a few half-turns. */
function formatTime(time: number | null, timeOnly: boolean = false): string {
  if (time === null) return "";
  const date = new Date(time * 1000);
  if (timeOnly) return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Render turn history as individually keyed rows.
 *
 * Keys are derived from the action's own position in the game log, never from its index in
 * `actions` — the caller passes a sliding window (`recentTurns`), so array indices shift as
 * the game advances while the rows themselves are unchanged. Actions sharing a `logIndex`
 * (Innovation's artifact windows) are disambiguated by their order within that group, which
 * `recentTurns` preserves because it slices on half-turn boundaries.
 */
export function renderTurnHistoryRows<TDetail>(actions: TurnAction<TDetail>[], players: PlayerInfo[], formatDetail: DetailFormatter<TDetail>, options: TurnHistoryOptions = {}): TurnHistoryRow[] {
  if (actions.length === 0) return [];

  const { newestFirst = false, popoverTips = false, rowKeys = false, timeOnly = false } = options;
  const playerById = new Map(players.map(p => [p.id, p]));
  const keyAttr = (key: string): string => rowKeys ? ` data-row-key="${key}"` : "";

  // One chunk per action, chronological. Group separators are applied afterwards, over the
  // final display order, so they land between half-turns in both orderings.
  const chunks: { player: string; rows: TurnHistoryRow[] }[] = [];
  let sameLogIndexRun = 0;

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (index > 0 && actions[index - 1].logIndex === action.logIndex) sameLogIndexRun++;
    else sameLogIndexRun = 0;
    const baseKey = `${action.logIndex}.${sameLogIndexRun}`;

    const player = playerById.get(action.player);
    if (!player) throw new Error(`Turn-history action references unknown player id "${action.player}"`);
    const playerCls = player.isCurrent ? " th-me" : "";
    const colorAttr = playerColorAttr(player);
    const artifactCls = action.actionNumber === 0 ? " th-artifact" : "";
    const timeStr = formatTime(action.time, timeOnly);
    const timePrefix = timeStr ? `<span class="th-time">${timeStr}</span> ` : "";
    const detail = formatDetail(action.actions[0], popoverTips, action);
    const suffix = detail ? ` ${detail}` : "";
    const fullName = escapeHtml(player.name);
    const shortName = player.isCurrent ? "you" : "opp";

    const rows: TurnHistoryRow[] = [
      { key: `${baseKey}:0`, html: `<div class="turn-action${playerCls}${artifactCls}"${keyAttr(`${baseKey}:0`)} ${colorAttr}>${timePrefix}<span class="th-name-short">${shortName}:</span><span class="th-name-full">${fullName}:</span>${suffix}</div>` },
    ];

    // Render sub-actions (Innovation's promote/dogma, Nucleum's second main action, etc.)
    for (let i = 1; i < action.actions.length; i++) {
      const subDetail = formatDetail(action.actions[i], popoverTips, action);
      const key = `${baseKey}:${i}`;
      rows.push({ key, html: `<div class="turn-action th-sub${playerCls}"${keyAttr(key)} ${colorAttr}>  → ${subDetail}</div>` });
    }

    chunks.push({ player: action.player, rows });
  }

  if (newestFirst) chunks.reverse();

  const out: TurnHistoryRow[] = [];
  let currentPlayer: string | null = null;
  for (const chunk of chunks) {
    if (chunk.player !== currentPlayer && currentPlayer !== null) {
      const key = `sep:${chunk.rows[0].key}`;
      out.push({ key, html: `<div class="turn-group-sep"${keyAttr(key)}></div>` });
    }
    currentPlayer = chunk.player;
    out.push(...chunk.rows);
  }
  return out;
}

export function renderTurnHistory<TDetail>(actions: TurnAction<TDetail>[], players: PlayerInfo[], formatDetail: DetailFormatter<TDetail>, options: TurnHistoryOptions = {}): string {
  return renderTurnHistoryRows(actions, players, formatDetail, options).map(r => r.html).join("");
}
