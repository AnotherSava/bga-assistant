import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Card, CardDatabase, CardSet, cardIndex } from "../types";
import type { PlayerInfo } from "../../../models/types";
import { type GameState, createGameState } from "../game_state";
import { GameEngine } from "../game_engine";
import { renderSummary, renderTurnHistory } from "../render";
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
