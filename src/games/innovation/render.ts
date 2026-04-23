// GameState -> HTML string via template literals.
// Replaces Jinja2 templates + DTO layer (TemplateCard/Row/Section).

import { type CardInfo, type Card, CardSet, Color, CardDatabase, colorLabel, cardSetLabel, ageSetKey, cardIndex } from "./types.js";
import { escapeHtml } from "../../render/icons.js";
import type { TurnAction, ActionDetail } from "./turn_history.js";
import { positionTooltip, applyToggleMode } from "../../render/toggle.js";
import type { GameState } from "./game_state.js";
import { GameEngine } from "./game_engine.js";
import { type SectionId, type SectionConfig, type Toggle, DEFAULT_SECTION_CONFIG, SECTION_IDS, ECHOES_ONLY_SECTIONS, RELICS_ONLY_SECTIONS, TALL_COLUMNS, visibilityToggle, layoutToggle, compositeToggle } from "./config.js";

// ---------------------------------------------------------------------------
// Asset URL resolution
// ---------------------------------------------------------------------------

/** Resolve an asset path. In extension context, uses chrome.runtime.getURL.
 *  For standalone HTML export, falls back to relative paths. */
let resolveAssetUrl = (path: string): string => path;

export function setAssetResolver(resolver: (path: string) => string): void {
  resolveAssetUrl = resolver;
}

/** When true, all cards use text-only tooltips (no card face images).
 *  Module-level state is intentional: single-threaded extension context makes
 *  this simpler than threading through every render function call. */
let useTextTooltips = false;

// ---------------------------------------------------------------------------
// SVG icons (inlined to avoid external file dependencies)
// ---------------------------------------------------------------------------

const SVG_EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
const SVG_EYE_CLOSED = '<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C11.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
const SVG_QUESTION = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>';

const ROW_LABEL_ICONS: Record<string, string> = {
  eye_open: SVG_EYE_OPEN,
  eye_closed: SVG_EYE_CLOSED,
  question: SVG_QUESTION,
};

// ---------------------------------------------------------------------------
// Icon rendering
// ---------------------------------------------------------------------------

function iconImg(iconName: string, color: string, spriteIndex: number): string {
  if (iconName === "hex") {
    return `<img src="${resolveAssetUrl(`assets/bga/innovation/icons/hex_${spriteIndex}.png`)}" width="20" height="20" alt="${iconName}">`;
  }
  if (iconName === "hexnote") {
    return `<img src="${resolveAssetUrl("assets/bga/innovation/icons/hexnote_purple.png")}" width="20" height="20" alt="${iconName}">`;
  }
  if (iconName === "echo") {
    return `<img src="${resolveAssetUrl("assets/bga/innovation/icons/echo.svg")}" width="20" height="20" alt="${iconName}">`;
  }
  if (iconName === "left" || iconName === "right" || iconName === "up") {
    const rotate = iconName === "right" ? ' style="transform:rotate(180deg)"' : iconName === "up" ? ' style="transform:rotate(90deg)"' : "";
    return `<img src="${resolveAssetUrl(`assets/bga/innovation/icons/arrow_${color}.png`)}" width="20" height="20" alt="${iconName}"${rotate}>`;
  }
  if (iconName.startsWith("bonus-")) {
    const bonusNum = iconName.split("-")[1];
    return `<img src="${resolveAssetUrl(`assets/bga/innovation/icons/bonus_${bonusNum}.png`)}" width="20" height="20" alt="${iconName}">`;
  }
  return `<img src="${resolveAssetUrl(`assets/bga/innovation/icons/${iconName}_${color}.png`)}" width="20" height="20" alt="${iconName}">`;
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

function renderKnownCard(info: CardInfo, markResolved: boolean): string {
  const color = colorLabel(info.color);
  const resolvedAttr = markResolved ? " data-known" : "";

  if (info.cardSet === CardSet.BASE || info.cardSet === CardSet.ECHOES || info.cardSet === CardSet.ARTIFACTS || info.cardSet === CardSet.FIGURES) {
    const tip = useTextTooltips
      ? `<div class="card-tip-text">${escapeHtml(info.name)}</div>`
      : `<div class="card-tip"><img src="${resolveAssetUrl(`assets/bga/innovation/cards/card_${info.spriteIndex}.webp`)}"></div>`;
    return `<div class="card card-base b-${color}"${resolvedAttr}>`
      + `<div class="cb-tl">${iconImg(info.icons[0], color, info.spriteIndex)}</div>`
      + `<div class="cb-name">${escapeHtml(info.name)}</div>`
      + `<div class="cb-bl">${iconImg(info.icons[1], color, info.spriteIndex)}</div>`
      + `<div class="cb-mid">${iconImg(info.icons[2], color, info.spriteIndex)}${iconImg(info.icons[3], color, info.spriteIndex)}</div>`
      + `<div class="card-age">${info.age}</div>`
      + tip
      + `</div>`;
  }

  if (info.cardSet === CardSet.CITIES) {
    if (info.icons.length < 6) throw new Error(`City card "${info.name}" has ${info.icons.length} icons, expected 6`);
    const topIcons = [0, 5, 4].map(p => iconImg(info.icons[p], color, info.spriteIndex)).join("");
    const botIcons = [1, 2, 3].map(p => iconImg(info.icons[p], color, info.spriteIndex)).join("");
    const cityTip = useTextTooltips || !info.isRelic
      ? `<div class="card-tip-text">${escapeHtml(info.name)}</div>`
      : `<div class="card-tip"><img src="${resolveAssetUrl(`assets/bga/innovation/cards/card_${info.spriteIndex}.webp`)}"></div>`;
    return `<div class="card card-cities b-${color}"${resolvedAttr}>`
      + `<div class="cc-top">${topIcons}</div>`
      + `<div class="cc-bot">${botIcons}</div>`
      + `<div class="card-age">${info.age}</div>`
      + cityTip
      + `</div>`;
  }

  return `<div class="card b-${color}"${resolvedAttr}><div class="card-name">${escapeHtml(info.name)}</div><div class="card-body"><div class="card-age">${info.age}</div></div></div>`;
}

function renderUnknownCard(age: number | null, cardSet: CardSet): string {
  let cls: string;
  if (cardSet === CardSet.BASE) cls = "b-gray-base";
  else if (cardSet === CardSet.CITIES) cls = "b-gray-cities";
  else if (cardSet === CardSet.ECHOES) cls = "b-gray-echoes";
  else if (cardSet === CardSet.ARTIFACTS) cls = "b-gray-artifacts";
  else cls = "b-gray";

  return `<div class="card card-base ${cls}"><div class="cb-tl"></div><div class="cb-name"></div><div class="cb-bl"></div><div class="cb-mid"></div><div class="card-age">${age ?? ""}</div></div>`;
}

function renderCard(card: Card, cardDb: CardDatabase, markResolved: boolean): string {
  if (card.isResolved) {
    const info = cardDb.get(card.resolvedName!)!;
    return renderKnownCard(info, markResolved);
  }
  return renderUnknownCard(card.age, card.cardSet);
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

interface Row {
  cards: string[];
  label: string;
  allKnown: boolean;
}

function renderRowLabel(label: string): string {
  if (label in ROW_LABEL_ICONS) {
    return ROW_LABEL_ICONS[label];
  }
  return escapeHtml(label);
}

function renderSectionRow(row: Row): string {
  const allKnownCls = row.allKnown ? " all-known" : "";
  const labelHtml = renderRowLabel(row.label);
  const cardsHtml = row.cards.join("");
  return `<div class="section-row${allKnownCls}"><span class="row-label">${labelHtml}</span><div class="card-row">${cardsHtml}</div></div>`;
}

// ---------------------------------------------------------------------------
// Toggle rendering
// ---------------------------------------------------------------------------

function renderTriToggle(toggle: Toggle, extraAttrs: string = ""): string {
  const opts = toggle.options.map(opt => `<span class="tri-opt${opt.active ? " active" : ""}" data-mode="${opt.mode}">${opt.label}</span>`);
  return `<span class="tri-toggle" data-target="${toggle.targetId}"${extraAttrs}>[${opts.join('<span class="tri-sep">|</span>')}]</span>`;
}

// ---------------------------------------------------------------------------
// Section rendering
// ---------------------------------------------------------------------------

interface SetRows {
  set: string;
  rows: Row[];
}

interface SectionData {
  sectionId: SectionId;
  title: string;
  toggle: Toggle | null;
  extraToggles: Toggle[];
  sets: SetRows[];
  columnCount: number;
  arrangeByColumns: boolean;
  empty: boolean;
}

function renderTallGrid(rows: Row[], columnCount: number, arrangeByColumns: boolean): string {
  let html = '<table class="tall-grid">';
  for (const row of rows) {
    const numRows = Math.ceil(row.cards.length / columnCount);
    for (let r = 0; r < numRows; r++) {
      const rowClass = row.allKnown ? ' class="all-known"' : "";
      html += `<tr${rowClass}>`;
      if (r === 0) {
        html += `<td class="row-label" rowspan="${numRows}">${renderRowLabel(row.label)}</td>`;
      }
      for (let c = 0; c < columnCount; c++) {
        const idx = arrangeByColumns ? c * numRows + r : r * columnCount + c;
        const card = idx < row.cards.length ? row.cards[idx] : "";
        html += `<td>${card}</td>`;
      }
      html += "</tr>";
    }
  }
  html += "</table>";
  return html;
}

function renderSetContent(rows: Row[], section: SectionData, hasLayout: boolean): string {
  let html = "";
  if (hasLayout) {
    const lt = section.extraToggles.find(t => t.defaultMode === "wide" || t.defaultMode === "tall");
    const defaultLayout = lt?.defaultMode ?? "wide";
    const wideHide = defaultLayout === "tall" ? ' style="display:none"' : "";
    const tallHide = defaultLayout !== "tall" ? ' style="display:none"' : "";
    html += `<div class="layout-wide" data-list="${section.sectionId}"${wideHide}>`;
    for (const row of rows) html += renderSectionRow(row);
    html += `</div><div class="layout-tall" data-list="${section.sectionId}"${tallHide}>`;
    html += renderTallGrid(rows, section.columnCount, section.arrangeByColumns);
    html += "</div>";
  } else {
    for (const row of rows) html += renderSectionRow(row);
  }
  return html;
}

function renderSection(section: SectionData): string {
  let html = `<div class="section" data-section="${section.sectionId}">`;

  // Title with toggles
  html += `<div class="section-title">${section.title}`;
  if (section.toggle) html += ` ${renderTriToggle(section.toggle)}`;
  const hideExtra = section.toggle?.defaultMode === "none" ? ' style="display:none"' : "";
  for (const t of section.extraToggles) html += ` ${renderTriToggle(t, hideExtra)}`;
  html += "</div>";

  const isComposite = section.sets.length > 1;
  const allRows = section.sets.flatMap(s => s.rows);

  if (section.empty) {
    if (section.toggle) {
      const hideStyle = section.toggle.defaultMode === "none" ? ' style="display:none"' : "";
      html += `<div id="${section.sectionId}"${hideStyle}>`;
    }
    html += '<div class="section-row"><span class="row-label"> </span><div class="card-row"><div class="empty-card">empty</div></div></div>';
    if (section.toggle) html += "</div>";
  } else if (section.toggle) {
    const hideStyle = section.toggle.defaultMode === "none" ? ' style="display:none"' : "";
    const hasUnknownDefault = section.toggle.defaultMode === "unknown" || section.extraToggles.some(t => t.defaultMode === "unknown");
    const unknownCls = hasUnknownDefault ? ' class="mode-unknown"' : "";
    html += `<div id="${section.sectionId}"${hideStyle}${unknownCls}>`;

    if (isComposite) {
      const hasLayout = section.columnCount > 0;
      for (const setData of section.sets) {
        const setDisplay = setData.set === section.toggle.defaultMode ? "" : ' style="display:none"';
        html += `<div data-set="${setData.set}"${setDisplay}>`;
        html += renderSetContent(setData.rows, section, hasLayout);
        html += "</div>";
      }
    } else {
      html += renderSetContent(allRows, section, section.columnCount > 0 && section.extraToggles.length > 0);
    }

    html += "</div>";
  } else {
    for (const row of allRows) html += renderSectionRow(row);
  }

  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// Turn history renderer
// ---------------------------------------------------------------------------

/** Wrap a card name in a tooltip span if the card exists in the database. */
function cardTooltipSpan(cardName: string, cardDb: CardDatabase): string {
  const info = cardDb.get(cardIndex(cardName));
  if (!info) return escapeHtml(cardName);
  const tip = useTextTooltips
    ? `<div class="card-tip-text">${escapeHtml(info.name)}</div>`
    : `<div class="card-tip"><img src="${resolveAssetUrl(`assets/bga/innovation/cards/card_${info.spriteIndex}.webp`)}"></div>`;
  return `<span class="th-card">${escapeHtml(info.name)}${tip}</span>`;
}

/** Format the action detail text (action type + card/age). */
function formatActionDetail(detail: ActionDetail, cardDb: CardDatabase): string {
  if (detail.actionType === "pending") return "";
  if (detail.actionType === "achieve") return `achieve [${detail.cardAge}]`;
  if (detail.actionType === "draw") {
    if (detail.cardName) return `draw ${cardTooltipSpan(detail.cardName, cardDb)}`;
    const setLabel = detail.cardSet && detail.cardSet !== "base" ? ` ${detail.cardSet}` : "";
    return `draw [${detail.cardAge}]${setLabel}`;
  }
  if (detail.actionType === "artifact_pass" || detail.actionType === "artifact_return" || detail.actionType === "artifact_dogma") {
    const verb = detail.actionType === "artifact_pass" ? "pass" : detail.actionType === "artifact_return" ? "return" : "dogma";
    const card = detail.cardName ? `${cardTooltipSpan(detail.cardName, cardDb)} ` : "";
    return `${verb} ${card}artifact`;
  }
  const verb = detail.actionType;
  if (detail.cardName) return `${verb} ${cardTooltipSpan(detail.cardName, cardDb)}`;
  return verb;
}

/** Format a unix timestamp using the same locale format as the old top-bar clock. */
function formatTime(time: number | null): string {
  if (time === null) return "";
  return new Date(time * 1000).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Render turn history HTML from a list of recent actions (chronological order). */
export function renderTurnHistory(actions: TurnAction[], cardDb: CardDatabase, perspective: string): string {
  if (actions.length === 0) return "";

  let html = "";
  let currentPlayer: string | null = null;

  for (const action of actions) {
    if (action.player !== currentPlayer && currentPlayer !== null) {
      html += '<div class="turn-group-sep"></div>';
    }
    currentPlayer = action.player;

    const isMe = action.player === perspective;
    const label = isMe ? "you" : "opp";
    const playerCls = isMe ? " th-me" : " th-opp";
    const artifactCls = action.actionNumber === 0 ? " th-artifact" : "";
    const timeStr = formatTime(action.time);
    const timePrefix = timeStr ? `<span class="th-time">${timeStr}</span> ` : "";
    const detail = formatActionDetail(action.actions[0], cardDb);
    const suffix = detail ? ` ${detail}` : "";
    html += `<div class="turn-action${playerCls}${artifactCls}">${timePrefix}${label}:${suffix}</div>`;

    // Render sub-actions (promote, dogma after promote, etc.)
    for (let i = 1; i < action.actions.length; i++) {
      const subDetail = formatActionDetail(action.actions[i], cardDb);
      html += `<div class="turn-action th-sub${playerCls}">  \u2192 ${subDetail}</div>`;
    }
  }

  return html;
}

// ---------------------------------------------------------------------------
// Summary renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  sectionConfig?: Record<SectionId, SectionConfig>;
  /** Use text-only tooltips for all cards (no card face images). */
  textTooltips?: boolean;
  /** Active expansions — determines which sections are rendered (e.g. forecast requires echoes). */
  expansions?: { echoes: boolean; artifacts?: boolean; relics?: boolean };
}

/** Sort key for a card: (age, isUnknown, color, name). */
function cardSortKey(card: Card, cardDb: CardDatabase): [number, number, number, string] {
  if (card.isResolved) {
    const info = cardDb.get(card.resolvedName!)!;
    return [info.age, 0, info.color, info.indexName];
  }
  return [card.age, 1, card.cardSet, ""];
}

function prepareCards(cards: Card[], cardDb: CardDatabase, label: string, sort: boolean, markResolved: boolean): Row {
  const ordered = sort ? [...cards].sort((a, b) => {
    const ka = cardSortKey(a, cardDb);
    const kb = cardSortKey(b, cardDb);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3].localeCompare(kb[3]);
  }) : cards;
  return { cards: ordered.map(c => renderCard(c, cardDb, markResolved)), label, allKnown: false };
}

function prepareMyCards(zone: Card[], engine: GameEngine, cardDb: CardDatabase): Row[] {
  const rows: Row[] = [];

  const hidden = zone.filter(c => engine.opponentKnowsNothing(c));
  if (hidden.length > 0) rows.push(prepareCards(hidden, cardDb, "eye_closed", true, false));

  const suspected = zone.filter(c => engine.opponentHasPartialInformation(c));
  if (suspected.length > 0) rows.push(prepareCards(suspected, cardDb, "question", true, false));

  const revealed = zone.filter(c => c.opponentKnowledge.kind === "exact");
  if (revealed.length > 0) rows.push(prepareCards(revealed, cardDb, "eye_open", true, false));

  return rows;
}

function prepareDeck(gameState: GameState, targetSet: CardSet, cardDb: CardDatabase): Row[] {
  const rows: Row[] = [];
  let emptyAges = true;
  for (let age = 1; age <= 10; age++) {
    const cards = gameState.decks.get(ageSetKey(age, targetSet)) ?? [];
    if (emptyAges && cards.length === 0) continue;
    emptyAges = false;
    rows.push(prepareCards(cards, cardDb, String(age), false, false));
  }
  return rows;
}

/** Collect all resolved card names across every zone into a single Set. */
function collectResolvedNames(gameState: GameState): Set<string> {
  const resolved = new Set<string>();
  const addFrom = (cards: Card[]) => { for (const c of cards) { if (c.isResolved) resolved.add(c.resolvedName!); } };
  for (const cards of gameState.hands.values()) addFrom(cards);
  for (const cards of gameState.boards.values()) addFrom(cards);
  for (const cards of gameState.scores.values()) addFrom(cards);
  for (const cards of gameState.revealed.values()) addFrom(cards);
  for (const cards of gameState.forecast.values()) addFrom(cards);
  for (const cards of gameState.decks.values()) addFrom(cards);
  for (const cards of gameState.displays.values()) addFrom(cards);
  addFrom(gameState.achievements);
  addFrom(gameState.relics);
  for (const cards of gameState.achievementRelics.values()) addFrom(cards);
  return resolved;
}

function prepareAllCards(gameState: GameState, cardSet: CardSet, cardDb: CardDatabase, resolvedNames: Set<string>): Row[] {
  const rows: Row[] = [];
  for (let age = 1; age <= 10; age++) {
    const cardInfos = cardDb.groupInfos(age, cardSet);
    const items: string[] = [];
    let allKnown = true;
    for (const info of cardInfos) {
      const resolved = resolvedNames.has(info.indexName);
      if (!resolved) allKnown = false;
      items.push(renderKnownCard(info, resolved));
    }
    rows.push({ cards: items, label: String(age), allKnown });
  }
  return rows;
}

function makeSection(sectionId: SectionId, title: string, rows: Row[], config: SectionConfig, options: { hasUnknown?: boolean; columnCount?: number; arrangeByColumns?: boolean }): SectionData {
  const toggle = visibilityToggle(sectionId, config.defaultVisibility, options.hasUnknown ?? false);
  const extraToggles: Toggle[] = [];
  if (options.columnCount && options.columnCount > 0 && config.defaultLayout) {
    extraToggles.push(layoutToggle(sectionId, config.defaultLayout));
  }
  const empty = !rows.some(row => row.cards.length > 0);

  return {
    sectionId,
    title,
    toggle,
    extraToggles,
    sets: [{ set: "base", rows }],
    columnCount: options.columnCount ?? 0,
    arrangeByColumns: options.arrangeByColumns ?? true,
    empty,
  };
}

function makeCompositeSection(sectionId: SectionId, title: string, baseRows: Row[], echoesRows: Row[], citiesRows: Row[], artifactsRows: Row[], config: SectionConfig, options: { hasUnknown?: boolean; columnCount?: number; arrangeByColumns?: boolean }): SectionData {
  const toggle = compositeToggle(sectionId, config.defaultVisibility);
  const extraToggles: Toggle[] = [];
  if (options.hasUnknown) {
    const filterMode = config.defaultFilter ?? "all";
    extraToggles.push({
      targetId: sectionId,
      defaultMode: filterMode,
      options: [
        { mode: "all", label: "All", active: filterMode === "all" },
        { mode: "unknown", label: "Unknown", active: filterMode === "unknown" },
      ],
    });
  }
  if (options.columnCount && options.columnCount > 0 && config.defaultLayout) {
    extraToggles.push(layoutToggle(sectionId, config.defaultLayout));
  }
  const allRows = [...baseRows, ...echoesRows, ...citiesRows, ...artifactsRows];
  const empty = !allRows.some(row => row.cards.length > 0);

  return {
    sectionId,
    title,
    toggle,
    extraToggles,
    sets: [
      { set: "base", rows: baseRows },
      { set: "echoes", rows: echoesRows },
      { set: "cities", rows: citiesRows },
      { set: "artifacts", rows: artifactsRows },
    ],
    columnCount: options.columnCount ?? 0,
    arrangeByColumns: options.arrangeByColumns ?? true,
    empty,
  };
}

/** Render the full summary HTML for a game state. */
export function renderSummary(gameState: GameState, engine: GameEngine, cardDb: CardDatabase, perspective: string, players: string[], tableId: string, options?: RenderOptions): string {
  const prevTextTooltips = useTextTooltips;
  useTextTooltips = options?.textTooltips ?? false;
  try {
    const config = options?.sectionConfig ?? DEFAULT_SECTION_CONFIG;
    const hasEchoes = options?.expansions?.echoes ?? false;
    const hasRelics = options?.expansions?.relics ?? false;
    const opponent = players.find(p => p !== perspective);
    if (!opponent) throw new Error(`No opponent found: perspective="${perspective}", players=[${players.join(", ")}]`);

    const opponentHand = prepareCards(gameState.hands.get(opponent) ?? [], cardDb, "", true, false);
    const opponentScore = prepareCards(gameState.scores.get(opponent) ?? [], cardDb, "", true, false);
    const achievements = prepareCards(gameState.achievements, cardDb, "", true, false);

    const sectionBuilders: Record<SectionId, () => SectionData> = {
      "hand-opponent": () => makeSection("hand-opponent", "Hand &mdash; opponent", [opponentHand], config["hand-opponent"], {}),
      "hand-me": () => makeSection("hand-me", "Hand &mdash; me", prepareMyCards(gameState.hands.get(perspective) ?? [], engine, cardDb), config["hand-me"], {}),
      "score-opponent": () => makeSection("score-opponent", "Score &mdash; opponent", [opponentScore], config["score-opponent"], {}),
      "score-me": () => makeSection("score-me", "Score &mdash; me", prepareMyCards(gameState.scores.get(perspective) ?? [], engine, cardDb), config["score-me"], {}),
      "forecast-opponent": () => makeSection("forecast-opponent", "Forecast &mdash; opponent", [prepareCards(gameState.forecast.get(opponent) ?? [], cardDb, "", true, false)], config["forecast-opponent"], {}),
      "forecast-me": () => makeSection("forecast-me", "Forecast &mdash; me", prepareMyCards(gameState.forecast.get(perspective) ?? [], engine, cardDb), config["forecast-me"], {}),
      "achievements": () => makeSection("achievements", "Achievements", [achievements], config["achievements"], { columnCount: TALL_COLUMNS, arrangeByColumns: false }),
      "relics": () => {
        const relicNames = new Set<string>();
        for (const info of cardDb.values()) { if (info.isRelic) relicNames.add(info.indexName); }
        const allRelics: Card[] = [];
        const scanZone = (cards: Card[]) => { for (const c of cards) { if (c.isResolved && relicNames.has(c.resolvedName!)) allRelics.push(c); } };
        for (const c of gameState.relics) allRelics.push(c);
        for (const cards of gameState.achievementRelics.values()) allRelics.push(...cards);
        for (const cards of gameState.hands.values()) scanZone(cards);
        for (const cards of gameState.boards.values()) scanZone(cards);
        for (const cards of gameState.scores.values()) scanZone(cards);
        for (const cards of gameState.displays.values()) scanZone(cards);
        allRelics.sort((a, b) => a.age - b.age);
        return makeSection("relics", "Relics", [prepareCards(allRelics, cardDb, "", true, false)], config["relics"], {});
      },
      "deck": () => makeCompositeSection("deck", "Deck",
        prepareDeck(gameState, CardSet.BASE, cardDb),
        prepareDeck(gameState, CardSet.ECHOES, cardDb),
        prepareDeck(gameState, CardSet.CITIES, cardDb),
        prepareDeck(gameState, CardSet.ARTIFACTS, cardDb),
        config["deck"], {}),
      "cards": () => {
        const resolved = collectResolvedNames(gameState);
        return makeCompositeSection("cards", "Cards",
          prepareAllCards(gameState, CardSet.BASE, cardDb, resolved),
          prepareAllCards(gameState, CardSet.ECHOES, cardDb, resolved),
          prepareAllCards(gameState, CardSet.CITIES, cardDb, resolved),
          prepareAllCards(gameState, CardSet.ARTIFACTS, cardDb, resolved),
          config["cards"], { hasUnknown: true, columnCount: TALL_COLUMNS });
      },
    };

    let html = "";
    for (const id of SECTION_IDS) {
      if (ECHOES_ONLY_SECTIONS.has(id) && !hasEchoes) continue;
      if (RELICS_ONLY_SECTIONS.has(id) && !hasRelics) continue;
      html += renderSection(sectionBuilders[id]());
    }
    return html;
  } finally {
    useTextTooltips = prevTextTooltips;
  }
}

/** Render a full standalone HTML page (for download). */
export function renderFullPage(gameState: GameState, engine: GameEngine, cardDb: CardDatabase, perspective: string, players: string[], tableId: string, css: string, options?: RenderOptions): string {
  const bodyHtml = renderSummary(gameState, engine, cardDb, perspective, players, tableId, options);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Innovation &mdash; ${escapeHtml(tableId)}</title>
<link href="https://fonts.googleapis.com/css2?family=Russo+One&family=Barlow+Condensed&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
<script>
${SUMMARY_JS}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Client-side JavaScript (inlined in standalone HTML downloads)
// ---------------------------------------------------------------------------

export const SUMMARY_JS = `var positionTooltip = ${positionTooltip.toString()};
var applyToggleMode = ${applyToggleMode.toString()};
document.addEventListener('mousemove', function(e) {
  var tips = document.querySelectorAll('.card:hover > .card-tip, .card:hover > .card-tip-text');
  tips.forEach(function(tip) { positionTooltip(tip, e.clientX, e.clientY); });
});
document.querySelectorAll('.tri-toggle').forEach(function(toggle) {
  toggle.addEventListener('click', function(e) {
    var opt = e.target.closest('.tri-opt');
    if (!opt) return;
    var mode = opt.getAttribute('data-mode');
    var targetId = toggle.getAttribute('data-target');
    if (!targetId || !mode) return;
    applyToggleMode(toggle, mode, targetId);
  });
});`;
