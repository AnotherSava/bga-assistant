import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Card, CardDatabase, cardIndex } from "../types";
import { GameState } from "../game_state";
import { renderSummary, renderTurnHistory } from "../render";
import type { TurnAction } from "../turn_history";

const thisDir = dirname(fileURLToPath(import.meta.url));

function loadCardDatabase(): CardDatabase {
  const path = resolve(thisDir, "../../../../assets/bga/innovation/card_info.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return new CardDatabase(raw);
}

const PLAYERS = ["Alice", "Bob"];
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
    expect(renderTurnHistory([], cardDb, PERSPECTIVE)).toBe("");
  });

  it("renders meld action with card tooltip", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("you:");
    expect(html).toContain("meld");
    expect(html).toContain("Agriculture");
    // Card exists in DB, so should have tooltip span
    expect(html).toContain('class="th-card"');
    expect(html).toContain("card-tip");
  });

  it("renders dogma action with card tooltip", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 2, actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null, time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("opp:");
    expect(html).toContain("dogma");
    expect(html).toContain("Philosophy");
    expect(html).toContain('class="th-card"');
  });

  it("renders endorse action", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "endorse", cardName: "Compass", cardAge: null, cardSet: null, time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("endorse");
    expect(html).toContain("Compass");
  });

  it("renders draw with known card name", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, actionType: "draw", cardName: "Construction", cardAge: 4, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("draw");
    expect(html).toContain("Construction");
    expect(html).toContain('class="th-card"');
  });

  it("renders draw with unknown card (age only, base set)", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 2, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("draw [2]");
    // Should not include "base" set label
    expect(html).not.toContain("base");
  });

  it("renders draw with unknown card (non-base set)", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, actionType: "draw", cardName: null, cardAge: 3, cardSet: "echoes", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("draw [3] echoes");
  });

  it("renders achieve action", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "achieve", cardName: null, cardAge: 3, cardSet: null, time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("achieve [3]");
  });

  it("renders pending action without action text", () => {
    const actions: TurnAction[] = [
      { player: "Bob", actionNumber: 1, actionType: "pending", cardName: null, cardAge: null, cardSet: null, time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("th-opp");
    expect(html).toContain("opp:");
    // Pending should not have action text after the colon
    expect(html).not.toMatch(/opp:.*\b(meld|draw|dogma|endorse|achieve)\b/);
  });

  it("uses th-me class for perspective player and th-opp for opponent", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base", time: null },
      { player: "Bob", actionNumber: 1, actionType: "draw", cardName: null, cardAge: 1, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain("th-me");
    expect(html).toContain("th-opp");
  });

  it("adds group separator between different players", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "dogma", cardName: "Philosophy", cardAge: null, cardSet: null, time: null },
      { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 2, cardSet: "base", time: null },
      { player: "Bob", actionNumber: 1, actionType: "meld", cardName: "Tools", cardAge: 1, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain('class="turn-group-sep"');
    // Should have exactly one separator (between Alice and Bob)
    const sepCount = (html.match(/turn-group-sep/g) || []).length;
    expect(sepCount).toBe(1);
  });

  it("does not add separator within same player group", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base", time: null },
      { player: "Alice", actionNumber: 2, actionType: "draw", cardName: null, cardAge: 1, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).not.toContain("turn-group-sep");
  });

  it("renders timestamp when time is present", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base", time: 1710000000 },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).toContain('class="th-time"');
  });

  it("omits timestamp when time is null", () => {
    const actions: TurnAction[] = [
      { player: "Alice", actionNumber: 1, actionType: "meld", cardName: "Agriculture", cardAge: 1, cardSet: "base", time: null },
    ];
    const html = renderTurnHistory(actions, cardDb, PERSPECTIVE);
    expect(html).not.toContain("th-time");
  });
});

// ---------------------------------------------------------------------------
// bug: forecast cards shown as unresolved in Cards section
// ---------------------------------------------------------------------------

describe("bug: forecast cards shown as unresolved in Cards section", () => {
  it("marks forecast cards as resolved (data-known) in the Cards section", () => {
    const gs = new GameState(cardDb, PLAYERS, PERSPECTIVE);
    gs.initGame();

    // Place Sanitation directly into Alice's forecast
    const sanInfo = cardDb.get(cardIndex("sanitation"))!;
    const sanCard = new Card(sanInfo.age, sanInfo.cardSet, [cardIndex("sanitation")]);
    gs.forecast.get(PERSPECTIVE)!.push(sanCard);

    const html = renderSummary(gs, cardDb, PERSPECTIVE, PLAYERS, "test", { textTooltips: true });

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
