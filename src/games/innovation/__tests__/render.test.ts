import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Card, CardDatabase, CardSet, cardIndex } from "../types";
import type { PlayerInfo } from "../../../models/types";
import { type GameState, createGameState } from "../game_state";
import { GameEngine } from "../game_engine";
import { renderSummary, renderTurnHistory, renderTurnHistoryRows } from "../render";
import type { TurnAction } from "../turn_history";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDatabase(): CardDatabase {
  const path = resolve(thisDir, "../../../../assets/bga/innovation/card_info.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return new CardDatabase(raw);
}

const PLAYERS: PlayerInfo[] = [
  { id: "Alice", name: "Alice", colorHex: "ff0000", isCurrent: true },
  { id: "Bob", name: "Bob", colorHex: "0000ff", isCurrent: false },
];
const PERSPECTIVE = "Alice";

let cardDb: CardDatabase;

beforeEach(() => {
  cardDb = loadCardDatabase();
});

// ---------------------------------------------------------------------------
// renderTurnHistory
// ---------------------------------------------------------------------------

describe("renderTurnHistory", () => {
  it("returns empty string for empty actions", () => {
    expect(renderTurnHistory([], cardDb, PLAYERS)).toBe("");
  });

  it("renders meld action with card tooltip", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("Alice:");
    expect(html).toContain("meld");
    expect(html).toContain("Agriculture");
    // Card exists in DB, so should have tooltip span
    expect(html).toContain('class="th-card"');
    expect(html).toContain("card-tip");
  });

  it("renders dogma action with card tooltip", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 2, time: null, logIndex: 0, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("Bob:");
    expect(html).toContain("dogma");
    expect(html).toContain("Philosophy");
    expect(html).toContain('class="th-card"');
  });

  it("renders endorse action", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "endorse", cardName: "Compass", cardAge: null, cardSet: null }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("endorse");
    expect(html).toContain("Compass");
  });

  it("renders draw with known card name", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: "Construction", cardAge: 4, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("draw");
    expect(html).toContain("Construction");
    expect(html).toContain('class="th-card"');
  });

  it("renders draw with unknown card (age only, base set)", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 2, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 2, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("draw [2]");
    // Should not include "base" set label
    expect(html).not.toContain("base");
  });

  it("renders draw with unknown card (non-base set)", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 3, cardSet: "echoes" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("draw [3] echoes");
  });

  it("renders achieve action", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "achieve", cardName: null, cardAge: 3, cardSet: null }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("achieve [3]");
  });

  it("renders artifact_pass as a distinct th-artifact line with card tooltip", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 0, time: null, logIndex: 0, actions: [{ actionType: "artifact_pass", cardName: "Holmegaard Bows", cardAge: 1, cardSet: "artifacts" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("th-artifact");
    expect(html).toContain("Alice:");
    expect(html).toContain("pass");
    expect(html).toContain("Holmegaard Bows");
    expect(html).toContain("artifact");
    expect(html).toContain('class="th-card"');
  });

  it("renders artifact_return as a distinct th-artifact line", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 0, time: null, logIndex: 0, actions: [{ actionType: "artifact_return", cardName: "Tools", cardAge: 1, cardSet: "artifacts" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("th-artifact");
    expect(html).toContain("Bob:");
    expect(html).toContain("return");
    expect(html).toContain("Tools");
    expect(html).toContain("artifact");
  });

  it("renders artifact_dogma as a distinct th-artifact line", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 0, time: null, logIndex: 0, actions: [{ actionType: "artifact_dogma", cardName: "Philosopher's Stone", cardAge: 3, cardSet: "artifacts" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("th-artifact");
    expect(html).toContain("dogma");
    expect(html).toContain("Philosopher");
    expect(html).toContain("artifact");
  });

  it("keeps artifact step in the same group as the following regular actions", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 0, time: null, logIndex: 0, actions: [{ actionType: "artifact_pass", cardName: "Tools", cardAge: 1, cardSet: "artifacts" }] },
      { player: "Alice", actionNumber: 1, time: null, logIndex: 1, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
      { player: "Alice", actionNumber: 2, time: null, logIndex: 2, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).not.toContain("turn-group-sep");
  });

  it("renders pending action without action text", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "pending", cardName: null, cardAge: null, cardSet: null }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain("Bob:");
    // Pending should not have action text after the colon
    expect(html).not.toMatch(/Bob:.*\b(meld|draw|dogma|endorse|achieve)\b/);
  });

  it("emits per-player BGA colors and the th-me observer class", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    // Observer (Alice) row gets the th-me class for the background-tint affordance
    expect(html).toContain("th-me");
    // Both rows carry their player's BGA color via inline style
    expect(html).toContain("--player-color: #ff0000");
    expect(html).toContain("--player-color: #0000ff");
  });

  it("adds group separator between different players", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] },
      { player: "Alice", actionNumber: 2, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 2, cardSet: "base" }] },
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain('class="turn-group-sep"');
    // Should have exactly one separator (between Alice and Bob)
    const sepCount = (html.match(/turn-group-sep/g) || []).length;
    expect(sepCount).toBe(1);
  });

  it("does not add separator within same player group", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
      { player: "Alice", actionNumber: 2, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).not.toContain("turn-group-sep");
  });

  it("renders timestamp when time is present", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: 1710000000, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).toContain('class="th-time"');
  });

  it("omits timestamp when time is null", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    expect(html).not.toContain("th-time");
  });

  it("renders sub-actions as continuation lines with arrow and th-sub class", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [
        { actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" },
        { actionType: "promote", cardName: "Feudalism", cardAge: 4, cardSet: "echoes" },
        { actionType: "dogma", cardName: "Feudalism", cardAge: null, cardSet: null },
      ] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    // Primary line
    expect(html).toContain("Alice:");
    expect(html).toContain("meld");
    // Sub-action lines with arrow prefix
    expect(html).toContain("\u2192 promote");
    expect(html).toContain("Feudalism");
    expect(html).toContain("\u2192 dogma");
    // Sub-action lines have th-sub class
    const subLines = html.match(/th-sub/g);
    expect(subLines).toHaveLength(2);
  });

  it("sub-action lines carry the player's BGA color but have no player label", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, time: null, logIndex: 0, actions: [
        { actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" },
        { actionType: "promote", cardName: "Feudalism", cardAge: 4, cardSet: "echoes" },
      ] },
    ];
    const html = renderTurnHistory(actions, cardDb, PLAYERS);
    // Sub-action line carries Bob's BGA color but no "Bob:" / "Alice:" name label
    const subLineMatch = html.match(/<div class="turn-action th-sub" style="--player-color: #0000ff">[\s\S]*?<\/div>/);
    expect(subLineMatch).not.toBeNull();
    expect(subLineMatch![0]).not.toContain("Bob:");
    expect(subLineMatch![0]).not.toContain("Alice:");
  });
});

// ---------------------------------------------------------------------------
// bug: forecast cards shown as unresolved in Cards section
// ---------------------------------------------------------------------------

describe("bug: forecast cards shown as unresolved in Cards section", () => {
  it("marks forecast cards as resolved (data-known) in the Cards section", () => {
    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs);

    // Place Sanitation directly into Alice's forecast
    const sanInfo = cardDb.get(cardIndex("sanitation"))!;
    const sanCard = new Card(sanInfo.age, sanInfo.cardSet, [cardIndex("sanitation")]);
    gs.forecast.get(PERSPECTIVE)!.push(sanCard);

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", { textTooltips: true });

    // In the Cards section, find the card div containing "Sanitation"
    const cardsSection = html.match(/data-section="cards"[\s\S]*?(?=<div class="section"|$)/);
    expect(cardsSection).not.toBeNull();

    // The Sanitation card within the Cards section should have data-known
    const cardsSectionHtml = cardsSection![0];
    expect(cardsSectionHtml).toContain("Sanitation");

    // Extract the card div that contains Sanitation's name
    const sanCardMatch = cardsSectionHtml.match(/<div class="card[^"]*"[^>]*>(?:[^<]|<(?!\/div><div class="card))*Sanitation/);
    expect(sanCardMatch).not.toBeNull();
    expect(sanCardMatch![0]).toContain("data-known");
  });
});

// ---------------------------------------------------------------------------
// unknown-card candidate tooltip
// ---------------------------------------------------------------------------

describe("unknown-card candidate tooltip", () => {
  it("renders a candidate list tooltip and count when the card is narrowed", () => {
    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs);

    // Opponent holds one unknown age-1 base card that could be Agriculture or Archery.
    const unknown = new Card(1, CardSet.BASE, [cardIndex("agriculture"), cardIndex("archery")]);
    gs.hands.set("Bob", [unknown]);

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", { textTooltips: true });
    const handSection = html.match(/data-section="hand-opponent"[\s\S]*?(?=<div class="section"|$)/)![0];

    expect(handSection).toContain('class="card-tip-list"');
    expect(handSection).toContain("Agriculture");
    expect(handSection).toContain("Archery");
    // Candidate count is shown on the card (2 candidates, below the full age-1 group size).
    expect(handSection).toContain('<div class="cb-count">2</div>');
  });

  it("omits the candidate tooltip for resolved cards", () => {
    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs);

    const resolved = new Card(1, CardSet.BASE, [cardIndex("agriculture")]);
    gs.hands.set("Bob", [resolved]);

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", { textTooltips: true });
    const handSection = html.match(/data-section="hand-opponent"[\s\S]*?(?=<div class="section"|$)/)![0];

    expect(handSection).not.toContain("card-tip-list");
    expect(handSection).not.toContain("cb-count");
  });

  it("omits both the count and tooltip when the candidate set spans the full group", () => {
    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs);

    // Candidate set == the entire age-1 base group: no information gained.
    const fullGroup = cardDb.groupInfos(1, CardSet.BASE).map(info => info.indexName);
    expect(fullGroup.length).toBeGreaterThan(1);
    const unknown = new Card(1, CardSet.BASE, fullGroup);
    gs.hands.set("Bob", [unknown]);

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", { textTooltips: true });
    const handSection = html.match(/data-section="hand-opponent"[\s\S]*?(?=<div class="section"|$)/)![0];

    expect(handSection).not.toContain("card-tip-list");
    expect(handSection).not.toContain("cb-count");
  });
});

// ---------------------------------------------------------------------------
// bug: relic cards appear as extra unknowns in Cards section
// ---------------------------------------------------------------------------

describe("bug: relic cards excluded from Cards section when in relics zone", () => {
  it("does not show relic cards in the Cards section when relics variant is active", () => {
    const relicInfo = [...cardDb.values()].find(c => c.isRelic && c.cardSet === CardSet.BASE);
    if (!relicInfo) return; // skip if no base relic in card_info

    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs, { echoes: true, artifacts: true, relics: true }, [relicInfo.indexName]);

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", {
      textTooltips: true,
      expansions: { echoes: true, artifacts: true, relics: true },
    });

    const cardsSection = html.match(/data-section="cards"[\s\S]*?(?=<div class="section"|$)/);
    expect(cardsSection).not.toBeNull();
    expect(cardsSection![0]).not.toContain(relicInfo.name);
  });

  it("excludes relic cards from Cards section even without relics variant", () => {
    const relicInfo = [...cardDb.values()].find(c => c.isRelic && c.cardSet === CardSet.BASE);
    if (!relicInfo) return;

    const engine = new GameEngine(cardDb);
    const gs = createGameState(PLAYERS, PERSPECTIVE);
    engine.initGame(gs, { echoes: false, artifacts: false, relics: false });

    const html = renderSummary(gs, engine, cardDb, PERSPECTIVE, PLAYERS, "test", {
      textTooltips: true,
      expansions: { echoes: false },
    });

    const cardsSection = html.match(/data-section="cards"[\s\S]*?(?=<div class="section"|$)/);
    expect(cardsSection).not.toBeNull();
    expect(cardsSection![0]).not.toContain(relicInfo.name);
  });
});

// ---------------------------------------------------------------------------
// renderTurnHistory options (in-page log variant)
// ---------------------------------------------------------------------------

describe("renderTurnHistory options", () => {
  const alice1: TurnAction = { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] };
  const alice2: TurnAction = { player: "Alice", actionNumber: 2, time: null, logIndex: 1, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] };
  const bob1: TurnAction = { player: "Bob", actionNumber: 1, time: null, logIndex: 2, actions: [{ actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null }] };

  it("omits popover attribute by default and emits it when popoverTips is set", () => {
    expect(renderTurnHistory([alice1], cardDb, PLAYERS)).not.toContain("popover=");
    expect(renderTurnHistory([alice1], cardDb, PLAYERS, { popoverTips: true })).toContain('popover="manual"');
  });

  it("keeps the card tip a child of its .th-card anchor when using popovers", () => {
    const html = renderTurnHistory([alice1], cardDb, PLAYERS, { popoverTips: true });
    expect(html).toMatch(/<span class="th-card">[^<]*<div class="card-tip" popover="manual"/);
  });

  it("omits row keys by default and emits them when rowKeys is set", () => {
    expect(renderTurnHistory([alice1], cardDb, PLAYERS)).not.toContain("data-row-key");
    expect(renderTurnHistory([alice1], cardDb, PLAYERS, { rowKeys: true })).toContain('data-row-key="0.0:0"');
  });

  it("produces unique, stable row keys across renders of the same input", () => {
    const first = renderTurnHistoryRows([alice1, alice2, bob1], cardDb, PLAYERS, { rowKeys: true });
    const second = renderTurnHistoryRows([alice1, alice2, bob1], cardDb, PLAYERS, { rowKeys: true });
    expect(first.map(r => r.key)).toEqual(second.map(r => r.key));
    expect(new Set(first.map(r => r.key)).size).toBe(first.length);
  });

  it("keeps a row's key stable when the window slides", () => {
    const wide = renderTurnHistoryRows([alice1, alice2, bob1], cardDb, PLAYERS, { rowKeys: true });
    const narrow = renderTurnHistoryRows([alice2, bob1], cardDb, PLAYERS, { rowKeys: true });
    const bobKey = wide[wide.length - 1].key;
    expect(narrow[narrow.length - 1].key).toBe(bobKey);
  });

  it("disambiguates actions sharing a logIndex", () => {
    const artifactA: TurnAction = { player: "Alice", actionNumber: 0, time: null, logIndex: 5, actions: [{ actionType: "artifact_pass", cardName: "Tools", cardAge: 1, cardSet: "artifacts" }] };
    const artifactB: TurnAction = { player: "Alice", actionNumber: 0, time: null, logIndex: 5, actions: [{ actionType: "artifact_return", cardName: "Oars", cardAge: 1, cardSet: "artifacts" }] };
    const rows = renderTurnHistoryRows([artifactA, artifactB], cardDb, PLAYERS, { rowKeys: true });
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
    expect(rows.map(r => r.key)).toEqual(["5.0:0", "5.1:0"]);
  });

  it("newestFirst reverses action order", () => {
    const chronological = renderTurnHistoryRows([alice1, bob1], cardDb, PLAYERS);
    const reversed = renderTurnHistoryRows([alice1, bob1], cardDb, PLAYERS, { newestFirst: true });
    expect(chronological[0].html).toContain("Agriculture");
    expect(reversed[0].html).toContain("Philosophy");
  });

  it("newestFirst keeps sub-action rows below their parent action", () => {
    const withSub: TurnAction = { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [
      { actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null },
      { actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base" },
    ] };
    const rows = renderTurnHistoryRows([withSub, bob1], cardDb, PLAYERS, { newestFirst: true });
    const parentIdx = rows.findIndex(r => r.html.includes("Philosophy"));
    const subIdx = rows.findIndex(r => r.html.includes("th-sub"));
    expect(subIdx).toBeGreaterThan(parentIdx);
  });

  it("places a group separator between half-turns in both orderings", () => {
    const chronological = renderTurnHistoryRows([alice1, bob1], cardDb, PLAYERS);
    const reversed = renderTurnHistoryRows([alice1, bob1], cardDb, PLAYERS, { newestFirst: true });
    expect(chronological.filter(r => r.html.includes("turn-group-sep"))).toHaveLength(1);
    expect(reversed.filter(r => r.html.includes("turn-group-sep"))).toHaveLength(1);
    // Separator sits between the two players' chunks, never at the edges.
    const sepIdx = reversed.findIndex(r => r.html.includes("turn-group-sep"));
    expect(sepIdx).toBeGreaterThan(0);
    expect(sepIdx).toBeLessThan(reversed.length - 1);
  });

  it("renders only actions — BGA's own narration is not folded in", () => {
    const html = renderTurnHistory([alice1, bob1], cardDb, PLAYERS, { newestFirst: true });
    expect(html).not.toContain("th-narration");
  });
});

describe("timestamp format", () => {
  const action: TurnAction = { player: "Alice", actionNumber: 1, time: 1710000000, logIndex: 0, actions: [{ actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base" }] };

  it("includes the date by default, as the side panel expects", () => {
    const html = renderTurnHistory([action], cardDb, PLAYERS);
    expect(html).toMatch(/class="th-time">[A-Z][a-z]{2} \d{2}, \d{2}:\d{2}</);
  });

  it("drops the date when timeOnly is set", () => {
    const html = renderTurnHistory([action], cardDb, PLAYERS, { timeOnly: true });
    expect(html).toMatch(/class="th-time">\d{2}:\d{2}</);
    expect(html).not.toMatch(/class="th-time">[A-Z][a-z]{2} \d{2},/);
  });

  it("still omits the timestamp entirely when the action has no time", () => {
    const timeless = { ...action, time: null };
    expect(renderTurnHistory([timeless], cardDb, PLAYERS, { timeOnly: true })).not.toContain("th-time");
  });
});
