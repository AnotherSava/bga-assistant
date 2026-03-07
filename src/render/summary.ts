// GameState -> HTML string via template literals.
// Replaces Jinja2 templates + DTO layer (TemplateCard/Row/Section).

import { type CardInfo, type Card, CardSet, Color, CardDatabase, colorLabel, cardSetLabel, ageSetKey } from "../models/types.js";
import { GameState } from "../engine/game_state.js";
import { type SectionId, type SectionConfig, type Toggle, type Layout, DEFAULT_SECTION_CONFIG, TALL_COLUMNS, visibilityToggle, layoutToggle } from "./config.js";

// ---------------------------------------------------------------------------
// Asset URL resolution
// ---------------------------------------------------------------------------

/** Resolve an asset path. In extension context, uses chrome.runtime.getURL.
 *  For standalone HTML export, falls back to relative paths. */
let resolveAssetUrl = (path: string): string => path;

export function setAssetResolver(resolver: (path: string) => string): void {
  resolveAssetUrl = resolver;
}

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
  if (iconName === "left" || iconName === "right" || iconName === "up") {
    return `<img src="${resolveAssetUrl(`assets/bga/innovation/icons/arrow_${color}.png`)}" width="20" height="20" alt="${iconName}">`;
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderKnownCard(info: CardInfo, markResolved: boolean): string {
  const color = colorLabel(info.color);
  const resolvedAttr = markResolved ? " data-known" : "";

  if (info.cardSet === CardSet.BASE) {
    return `<div class="card card-base b-${color}"${resolvedAttr}>`
      + `<div class="cb-tl">${iconImg(info.icons[0], color, info.spriteIndex)}</div>`
      + `<div class="cb-name">${escapeHtml(info.name)}</div>`
      + `<div class="cb-bl">${iconImg(info.icons[1], color, info.spriteIndex)}</div>`
      + `<div class="cb-mid">${iconImg(info.icons[2], color, info.spriteIndex)}${iconImg(info.icons[3], color, info.spriteIndex)}</div>`
      + `<div class="card-age">${info.age}</div>`
      + `<div class="card-tip"><img src="${resolveAssetUrl(`assets/bga/innovation/cards/card_${info.spriteIndex}.png`)}"></div>`
      + `</div>`;
  }

  if (info.cardSet === CardSet.CITIES) {
    const topIcons = [0, 5, 4].map(p => p < info.icons.length ? iconImg(info.icons[p], color, info.spriteIndex) : "").join("");
    const botIcons = [1, 2, 3].map(p => p < info.icons.length ? iconImg(info.icons[p], color, info.spriteIndex) : "").join("");
    return `<div class="card card-cities b-${color}"${resolvedAttr}>`
      + `<div class="cc-top">${topIcons}</div>`
      + `<div class="cc-bot">${botIcons}</div>`
      + `<div class="card-age">${info.age}</div>`
      + `<div class="card-tip-text">${escapeHtml(info.name)}</div>`
      + `</div>`;
  }

  return `<div class="card b-${color}"${resolvedAttr}><div class="card-name">${escapeHtml(info.name)}</div><div class="card-body"><div class="card-age">${info.age}</div></div></div>`;
}

function renderUnknownCard(age: number | null, cardSet: CardSet): string {
  let cls: string;
  if (cardSet === CardSet.BASE) cls = "b-gray-base";
  else if (cardSet === CardSet.CITIES) cls = "b-gray-cities";
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

function renderTriToggle(toggle: Toggle): string {
  const opts = toggle.options.map(opt => `<span class="tri-opt${opt.active ? " active" : ""}" data-mode="${opt.mode}">${opt.label}</span>`);
  return `<span class="tri-toggle" data-target="${toggle.targetId}">[${opts.join('<span class="tri-sep">|</span>')}]</span>`;
}

// ---------------------------------------------------------------------------
// Section rendering
// ---------------------------------------------------------------------------

interface SectionData {
  sectionId: SectionId;
  title: string;
  toggle: Toggle | null;
  layoutToggle: Toggle | null;
  rows: Row[];
  columnCount: number;
  arrangeByColumns: boolean;
  empty: boolean;
  markResolved: boolean;
}

function renderTallGrid(section: SectionData): string {
  let html = '<table class="tall-grid">';
  for (const row of section.rows) {
    const numRows = Math.ceil(row.cards.length / section.columnCount);
    for (let r = 0; r < numRows; r++) {
      const rowClass = row.allKnown ? ' class="all-known"' : "";
      html += `<tr${rowClass}>`;
      if (r === 0) {
        html += `<td class="row-label" rowspan="${numRows}">${renderRowLabel(row.label)}</td>`;
      }
      for (let c = 0; c < section.columnCount; c++) {
        const idx = section.arrangeByColumns ? c * numRows + r : r * section.columnCount + c;
        const card = idx < row.cards.length ? row.cards[idx] : "";
        html += `<td>${card}</td>`;
      }
      html += "</tr>";
    }
  }
  html += "</table>";
  return html;
}

function renderSection(section: SectionData): string {
  let html = '<div class="section">';

  // Title with toggles
  html += `<div class="section-title">${section.title}`;
  if (section.toggle) html += ` ${renderTriToggle(section.toggle)}`;
  if (section.layoutToggle) html += ` ${renderTriToggle(section.layoutToggle)}`;
  html += "</div>";

  if (section.empty) {
    html += '<div class="section-row"><span class="row-label"> </span><div class="card-row"><div class="empty-card">empty</div></div></div>';
  } else if (section.toggle) {
    const hideStyle = section.toggle.defaultMode === "none" ? ' style="display:none"' : "";
    const unknownCls = section.toggle.defaultMode === "unknown" ? ' class="mode-unknown"' : "";
    html += `<div id="${section.sectionId}"${hideStyle}${unknownCls}>`;

    if (section.layoutToggle) {
      const wideHide = section.layoutToggle.defaultMode === "tall" ? ' style="display:none"' : "";
      const tallHide = section.layoutToggle.defaultMode !== "tall" ? ' style="display:none"' : "";
      html += `<div class="layout-wide" data-list="${section.sectionId}"${wideHide}>`;
      for (const row of section.rows) html += renderSectionRow(row);
      html += `</div><div class="layout-tall" data-list="${section.sectionId}"${tallHide}>`;
      html += renderTallGrid(section);
      html += "</div>";
    } else {
      for (const row of section.rows) html += renderSectionRow(row);
    }

    html += "</div>";
  } else {
    for (const row of section.rows) html += renderSectionRow(row);
  }

  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// Summary renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  sectionConfig?: Record<SectionId, SectionConfig>;
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

function prepareMyCards(zone: Card[], gameState: GameState, cardDb: CardDatabase): Row[] {
  const rows: Row[] = [];

  const hidden = zone.filter(c => gameState.opponentKnowsNothing(c));
  if (hidden.length > 0) rows.push(prepareCards(hidden, cardDb, "eye_closed", true, false));

  const suspected = zone.filter(c => gameState.opponentHasPartialInformation(c));
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

/** Check if a given card index name is resolved anywhere in the game state. */
function isCardResolved(indexName: string, gameState: GameState): boolean {
  // Check all zones for a resolved card with this name
  for (const cards of gameState.hands.values()) {
    for (const card of cards) {
      if (card.isResolved && card.resolvedName === indexName) return true;
    }
  }
  for (const cards of gameState.boards.values()) {
    for (const card of cards) {
      if (card.isResolved && card.resolvedName === indexName) return true;
    }
  }
  for (const cards of gameState.scores.values()) {
    for (const card of cards) {
      if (card.isResolved && card.resolvedName === indexName) return true;
    }
  }
  for (const cards of gameState.revealed.values()) {
    for (const card of cards) {
      if (card.isResolved && card.resolvedName === indexName) return true;
    }
  }
  for (const cards of gameState.decks.values()) {
    for (const card of cards) {
      if (card.isResolved && card.resolvedName === indexName) return true;
    }
  }
  for (const card of gameState.achievements) {
    if (card.isResolved && card.resolvedName === indexName) return true;
  }
  return false;
}

function prepareAllCards(gameState: GameState, cardSet: CardSet, cardDb: CardDatabase): Row[] {
  const rows: Row[] = [];
  for (let age = 1; age <= 10; age++) {
    const cardInfos = cardDb.groupInfos(age, cardSet);
    const items: string[] = [];
    let allKnown = true;
    for (const info of cardInfos) {
      const resolved = isCardResolved(info.indexName, gameState);
      if (!resolved) allKnown = false;
      items.push(renderKnownCard(info, resolved));
    }
    rows.push({ cards: items, label: String(age), allKnown });
  }
  return rows;
}

function makeSection(sectionId: SectionId, title: string, rows: Row[], config: SectionConfig, options: { hasUnknown?: boolean; columnCount?: number; arrangeByColumns?: boolean; markResolved?: boolean }): SectionData {
  const toggle = visibilityToggle(sectionId, config.defaultVisibility, options.hasUnknown ?? false);
  const lt = options.columnCount && options.columnCount > 0 && config.defaultLayout ? layoutToggle(sectionId, config.defaultLayout) : null;
  const empty = !rows.some(row => row.cards.length > 0);

  return {
    sectionId,
    title,
    toggle,
    layoutToggle: lt,
    rows,
    columnCount: options.columnCount ?? 0,
    arrangeByColumns: options.arrangeByColumns ?? true,
    empty,
    markResolved: options.markResolved ?? false,
  };
}

/** Render the full summary HTML for a game state. */
export function renderSummary(gameState: GameState, cardDb: CardDatabase, perspective: string, players: string[], tableId: string, options?: RenderOptions): string {
  const config = options?.sectionConfig ?? DEFAULT_SECTION_CONFIG;
  const opponent = players.find(p => p !== perspective) ?? players[0];

  const opponentHand = prepareCards(gameState.hands.get(opponent) ?? [], cardDb, "", true, false);
  const opponentScore = prepareCards(gameState.scores.get(opponent) ?? [], cardDb, "", true, false);
  const achievements = prepareCards(gameState.achievements, cardDb, "", true, false);

  const sections: SectionData[] = [
    makeSection("hand-opponent", "Hand &mdash; opponent", [opponentHand], config["hand-opponent"], {}),
    makeSection("hand-me", "Hand &mdash; me", prepareMyCards(gameState.hands.get(perspective) ?? [], gameState, cardDb), config["hand-me"], {}),
    makeSection("score-opponent", "Score &mdash; opponent", [opponentScore], config["score-opponent"], {}),
    makeSection("score-me", "Score &mdash; me", prepareMyCards(gameState.scores.get(perspective) ?? [], gameState, cardDb), config["score-me"], {}),
    makeSection("achievements", "Achievements", [achievements], config["achievements"], { columnCount: TALL_COLUMNS, arrangeByColumns: false }),
    makeSection("base-deck", "Base deck", prepareDeck(gameState, CardSet.BASE, cardDb), config["base-deck"], {}),
    makeSection("cities-deck", "Cities deck", prepareDeck(gameState, CardSet.CITIES, cardDb), config["cities-deck"], {}),
    makeSection("base-list", "Base list", prepareAllCards(gameState, CardSet.BASE, cardDb), config["base-list"], { hasUnknown: true, columnCount: TALL_COLUMNS, markResolved: true }),
    makeSection("cities-list", "Cities list", prepareAllCards(gameState, CardSet.CITIES, cardDb), config["cities-list"], { hasUnknown: true, columnCount: TALL_COLUMNS, markResolved: true }),
  ];

  // Sort by (column, order) and group into columns
  sections.sort((a, b) => {
    const ca = config[a.sectionId];
    const cb = config[b.sectionId];
    return ca.column - cb.column || ca.order - cb.order;
  });

  const columns: SectionData[][] = [];
  let currentCol = -1;
  for (const section of sections) {
    const col = config[section.sectionId].column;
    if (col !== currentCol) {
      columns.push([]);
      currentCol = col;
    }
    columns[columns.length - 1].push(section);
  }

  // Build HTML
  let html = "";

  if (columns.length === 1) {
    for (const section of columns[0]) html += renderSection(section);
  } else {
    const listIds = new Set(["base-list", "cities-list"]);
    const colWidths = columns.map(col => col.some(s => listIds.has(s.sectionId)) ? "auto" : "1fr");
    html += `<div class="page-grid" style="grid-template-columns: ${colWidths.join(" ")};">`;
    for (const col of columns) {
      html += '<div class="page-col">';
      for (const section of col) html += renderSection(section);
      html += "</div>";
    }
    html += "</div>";
  }

  return html;
}

/** Render a full standalone HTML page (for download). */
export function renderFullPage(gameState: GameState, cardDb: CardDatabase, perspective: string, players: string[], tableId: string, css: string, options?: RenderOptions): string {
  const bodyHtml = renderSummary(gameState, cardDb, perspective, players, tableId, options);

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

export const SUMMARY_JS = `document.addEventListener('mousemove', function(e) {
  var tips = document.querySelectorAll('.card:hover > .card-tip, .card:hover > .card-tip-text');
  tips.forEach(function(tip) {
    var rect = tip.getBoundingClientRect();
    var w = rect.width || 375, h = rect.height || 275;
    var x = e.clientX + 12;
    var y = e.clientY + 12;
    if (x + w > window.innerWidth) x = e.clientX - w - 12;
    if (y + h > window.innerHeight) y = e.clientY - h - 12;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
});
document.querySelectorAll('.tri-toggle').forEach(function(toggle) {
  toggle.addEventListener('click', function(e) {
    var opt = e.target.closest('.tri-opt');
    if (!opt) return;
    var mode = opt.getAttribute('data-mode');
    var target = document.getElementById(toggle.getAttribute('data-target'));
    if (!target) return;
    toggle.querySelectorAll('.tri-opt').forEach(function(o) { o.classList.remove('active'); });
    opt.classList.add('active');
    if (mode === 'none') {
      target.style.display = 'none';
      target.classList.remove('mode-unknown');
    } else if (mode === 'all') {
      target.style.display = '';
      target.classList.remove('mode-unknown');
    } else if (mode === 'unknown') {
      target.style.display = '';
      target.classList.add('mode-unknown');
    } else if (mode === 'wide' || mode === 'tall') {
      var id = toggle.getAttribute('data-target');
      document.querySelectorAll('.layout-wide[data-list="'+id+'"]').forEach(function(el) {
        el.style.display = mode === 'wide' ? '' : 'none';
      });
      document.querySelectorAll('.layout-tall[data-list="'+id+'"]').forEach(function(el) {
        el.style.display = mode === 'tall' ? '' : 'none';
      });
    }
  });
});`;
