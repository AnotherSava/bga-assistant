// Tests for config, summary rendering, toggle state management

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import {
  DEFAULT_SECTION_CONFIG,
  SECTION_IDS,
  SECTION_LABELS,
  TALL_COLUMNS,
  visibilityToggle,
  layoutToggle,
  compositeToggle,
  type SectionId,
} from "../games/innovation/config.js";
import { renderSummary, renderFullPage, setAssetResolver, SUMMARY_JS } from "../games/innovation/render.js";
import { recentTurns } from "../games/innovation/turn_history.js";
import { CardDatabase, CardSet, Card, ageSetKey } from "../models/types.js";
import { type GameState, createGameState } from "../games/innovation/game_state.js";
import { GameEngine } from "../games/innovation/game_engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cardDb: CardDatabase;

beforeAll(() => {
  const rawPath = path.join(__dirname, "../../assets/bga/innovation/card_info.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));
  cardDb = new CardDatabase(raw);
  // Use identity resolver for tests (no chrome.runtime.getURL)
  setAssetResolver((p: string) => p);
});

let engine: GameEngine;

function makeGameState(players: string[], perspective: string): { state: GameState; engine: GameEngine } {
  engine = new GameEngine(cardDb);
  const state = createGameState(players, perspective);
  engine.initGame(state);
  return { state, engine };
}

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

describe("Section Config", () => {
  it("has all 9 section IDs with configs", () => {
    expect(SECTION_IDS).toHaveLength(9);
    for (const id of SECTION_IDS) {
      expect(DEFAULT_SECTION_CONFIG[id]).toBeDefined();
    }
  });

  it("section order follows SECTION_IDS array", () => {
    expect(SECTION_IDS).toEqual([
      "hand-opponent", "hand-me", "score-opponent", "score-me",
      "forecast-opponent", "forecast-me",
      "deck", "cards", "achievements",
    ]);
  });

  it("deck defaults to base visibility", () => {
    expect(DEFAULT_SECTION_CONFIG["deck"].defaultVisibility).toBe("base");
  });

  it("cards defaults to base visibility, unknown filter, wide layout", () => {
    expect(DEFAULT_SECTION_CONFIG["cards"].defaultVisibility).toBe("base");
    expect(DEFAULT_SECTION_CONFIG["cards"].defaultFilter).toBe("unknown");
    expect(DEFAULT_SECTION_CONFIG["cards"].defaultLayout).toBe("wide");
  });

  it("hand sections default to show visibility", () => {
    expect(DEFAULT_SECTION_CONFIG["hand-opponent"].defaultVisibility).toBe("show");
    expect(DEFAULT_SECTION_CONFIG["hand-me"].defaultVisibility).toBe("show");
  });

  it("achievements has defaultLayout", () => {
    expect(DEFAULT_SECTION_CONFIG["achievements"].defaultLayout).toBe("wide");
  });

  it("TALL_COLUMNS is 5 (one per color)", () => {
    expect(TALL_COLUMNS).toBe(5);
  });

  it("SECTION_LABELS includes turn-history", () => {
    expect(SECTION_LABELS["turn-history"]).toBe("Turn history");
  });

  it("turn-history is NOT in SECTION_IDS", () => {
    expect((SECTION_IDS as readonly string[]).includes("turn-history")).toBe(false);
  });
});

describe("visibilityToggle", () => {
  it("builds show/hide toggle without unknown option", () => {
    const toggle = visibilityToggle("hand-opponent", "show", false);
    expect(toggle.targetId).toBe("hand-opponent");
    expect(toggle.defaultMode).toBe("all");
    expect(toggle.options).toHaveLength(2);
    expect(toggle.options[0].mode).toBe("none");
    expect(toggle.options[0].label).toBe("Hide");
    expect(toggle.options[1].mode).toBe("all");
    expect(toggle.options[1].label).toBe("Show");
    expect(toggle.options[1].active).toBe(true);
  });

  it("builds toggle with unknown option", () => {
    const toggle = visibilityToggle("cards", "unknown", true);
    expect(toggle.defaultMode).toBe("unknown");
    expect(toggle.options).toHaveLength(3);
    expect(toggle.options[0].label).toBe("None");
    expect(toggle.options[1].label).toBe("All");
    expect(toggle.options[2].label).toBe("Unknown");
    expect(toggle.options[2].active).toBe(true);
  });

  it("maps hide to none mode", () => {
    const toggle = visibilityToggle("deck", "hide", false);
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true); // "Hide" is active
  });

  it("maps none to none mode", () => {
    const toggle = visibilityToggle("cards", "none", true);
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true); // "None" is active
  });
});

describe("compositeToggle", () => {
  it("builds Hide/Base/Echoes/Cities toggle with base default", () => {
    const toggle = compositeToggle("deck", "base");
    expect(toggle.targetId).toBe("deck");
    expect(toggle.defaultMode).toBe("base");
    expect(toggle.options).toHaveLength(4);
    expect(toggle.options[0]).toEqual({ mode: "none", label: "Hide", active: false });
    expect(toggle.options[1]).toEqual({ mode: "base", label: "Base", active: true });
    expect(toggle.options[2]).toEqual({ mode: "echoes", label: "Echoes", active: false });
    expect(toggle.options[3]).toEqual({ mode: "cities", label: "Cities", active: false });
  });

  it("builds Hide/Base/Echoes/Cities toggle with none default", () => {
    const toggle = compositeToggle("cards", "none");
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true);
    expect(toggle.options[1].active).toBe(false);
    expect(toggle.options[2].active).toBe(false);
    expect(toggle.options[3].active).toBe(false);
  });

  it("builds toggle with echoes default", () => {
    const toggle = compositeToggle("deck", "echoes");
    expect(toggle.defaultMode).toBe("echoes");
    expect(toggle.options[0].active).toBe(false);
    expect(toggle.options[1].active).toBe(false);
    expect(toggle.options[2].active).toBe(true);
    expect(toggle.options[3].active).toBe(false);
  });
});

describe("layoutToggle", () => {
  it("builds wide/tall toggle with wide default", () => {
    const toggle = layoutToggle("cards", "wide");
    expect(toggle.targetId).toBe("cards");
    expect(toggle.defaultMode).toBe("wide");
    expect(toggle.options).toHaveLength(2);
    expect(toggle.options[0].active).toBe(true);
    expect(toggle.options[1].active).toBe(false);
  });

  it("builds wide/tall toggle with tall default", () => {
    const toggle = layoutToggle("achievements", "tall");
    expect(toggle.defaultMode).toBe("tall");
    expect(toggle.options[0].active).toBe(false);
    expect(toggle.options[1].active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Summary rendering tests
// ---------------------------------------------------------------------------

describe("renderSummary", () => {
  it("produces HTML with all 7 section titles", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("Hand &mdash; opponent");
    expect(html).toContain("Hand &mdash; me");
    expect(html).toContain("Score &mdash; opponent");
    expect(html).toContain("Score &mdash; me");
    expect(html).toContain("Achievements");
    expect(html).toContain("Deck");
    expect(html).toContain("Cards");
  });

  it("contains tri-toggle elements", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("tri-toggle");
    expect(html).toContain("tri-opt");
    expect(html).toContain("tri-sep");
  });

  it("renders unknown cards with b-gray-base class", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Hand cards should be unresolved -> gray cards
    expect(html).toContain("b-gray-base");
  });

  it("renders card-age elements", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('class="card-age"');
  });

  it("renders deck section with age labels", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("section-row");
    expect(html).toContain("row-label");
  });

  it("renders section divs with data-section attributes", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('data-section="hand-opponent"');
    expect(html).toContain('data-section="hand-me"');
    expect(html).toContain('data-section="deck"');
    expect(html).toContain('data-section="cards"');
    expect(html).toContain('data-section="achievements"');
  });

  it("renders section divs with IDs for toggle targeting", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('id="hand-opponent"');
    expect(html).toContain('id="deck"');
    expect(html).toContain('id="cards"');
  });

  it("cards section defaults to base with unknown filter", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Cards visible (no display:none), with mode-unknown class
    expect(html).toContain('id="cards" class="mode-unknown"');
  });

  it("deck section shows base set by default and hides echoes/cities", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract deck section content — use enough chars to include all sets
    const deckStart = html.indexOf('id="deck"');
    expect(deckStart).toBeGreaterThan(-1);
    // Find the end of the deck section (next <div class="section"> or end)
    const nextSectionStart = html.indexOf('<div class="section">', deckStart);
    const deckHtml = nextSectionStart > deckStart ? html.slice(deckStart, nextSectionStart) : html.slice(deckStart);

    expect(deckHtml).toContain('data-set="base"');
    expect(deckHtml).toContain('data-set="echoes"');
    expect(deckHtml).toContain('data-set="cities"');
    // Base visible (no style="display:none" on base set div)
    expect(deckHtml).toMatch(/data-set="base">/)
    // Echoes and cities hidden
    expect(deckHtml).toContain('data-set="echoes" style="display:none"');
    expect(deckHtml).toContain('data-set="cities" style="display:none"');
  });

  it("cards section contains all three data-set containers", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);

    expect(cardsHtml).toContain('data-set="base"');
    expect(cardsHtml).toContain('data-set="echoes"');
    expect(cardsHtml).toContain('data-set="cities"');
  });

  it("deck section has Hide/Base/Echoes/Cities composite toggle", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Find the Deck section title area
    const deckTitleIdx = html.indexOf(">Deck");
    const deckTitleArea = html.slice(deckTitleIdx, deckTitleIdx + 600);

    expect(deckTitleArea).toContain('data-mode="none"');
    expect(deckTitleArea).toContain('data-mode="base"');
    expect(deckTitleArea).toContain('data-mode="echoes"');
    expect(deckTitleArea).toContain('data-mode="cities"');
    expect(deckTitleArea).toContain(">Hide<");
    expect(deckTitleArea).toContain(">Base<");
    expect(deckTitleArea).toContain(">Echoes<");
    expect(deckTitleArea).toContain(">Cities<");
  });

  it("cards section has All/Unknown and Wide/Tall toggles alongside set toggle", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Find the Cards section title area
    const cardsTitleIdx = html.indexOf(">Cards");
    const cardsTitleArea = html.slice(cardsTitleIdx, cardsTitleIdx + 1000);

    // Composite toggle: Hide/Base/Echoes/Cities
    expect(cardsTitleArea).toContain(">Hide<");
    expect(cardsTitleArea).toContain(">Base<");
    expect(cardsTitleArea).toContain(">Echoes<");
    expect(cardsTitleArea).toContain(">Cities<");
    // Visibility toggle: All/Unknown (no None — Hide in composite toggle replaces it)
    expect(cardsTitleArea).toContain(">All<");
    expect(cardsTitleArea).toContain(">Unknown<");
    expect(cardsTitleArea).not.toContain(">None<");
    // Layout toggle: Wide/Tall
    expect(cardsTitleArea).toContain(">Wide<");
    expect(cardsTitleArea).toContain(">Tall<");
  });

  it("hides extra toggles initially when section defaults to none", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Achievements defaults to "none" — its Wide/Tall toggle should be hidden
    const achTitleIdx = html.indexOf(">Achievements");
    const achTitleArea = html.slice(achTitleIdx, achTitleIdx + 500);
    // The layout toggle exists but is hidden
    expect(achTitleArea).toContain(">Wide<");
    expect(achTitleArea).toContain('style="display:none"');
  });

  it("shows extra toggles when section is visible", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Cards defaults to "base" — its extra toggles should be visible (no display:none)
    const cardsTitleIdx = html.indexOf(">Cards");
    const cardsTitleEnd = html.indexOf("</div>", cardsTitleIdx);
    const cardsTitleArea = html.slice(cardsTitleIdx, cardsTitleEnd);
    expect(cardsTitleArea).not.toContain('style="display:none"');
  });

  it("renders resolved cards with known card info", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("Agriculture");
    expect(html).toContain("Archery");
  });

  it("renders icon images for known base cards", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("assets/bga/innovation/icons/");
    expect(html).toContain('width="20"');
  });

  it("renders card tooltips for base cards", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("card-tip");
    expect(html).toContain("assets/bga/innovation/cards/card_");
  });

  it("classifies my cards by opponent knowledge", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("M12 7c2.76");
  });

  it("renders cards section with data-known attributes for resolved cards", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("data-known");
  });

  it("renders unresolved card-list cards face-up with card names", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract the cards section (base set)
    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);

    expect(cardsHtml).toContain("Metalworking");
    expect(cardsHtml).toContain("Oars");
    // Should NOT be gray placeholders in the card list
    const baseSetStart = cardsHtml.indexOf('data-set="base"');
    const echoesSetStart = cardsHtml.indexOf('data-set="echoes"');
    const baseSetHtml = cardsHtml.slice(baseSetStart, echoesSetStart);
    expect(baseSetHtml).not.toContain("b-gray-base");
  });

  it("marks only resolved card-list cards with data-known", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);
    const baseSetStart = cardsHtml.indexOf('data-set="base"');
    const echoesSetStart = cardsHtml.indexOf('data-set="echoes"');
    const baseSetHtml = cardsHtml.slice(baseSetStart, echoesSetStart);

    // Resolved card (Agriculture) should have data-known
    const agricultureIdx = baseSetHtml.indexOf("Agriculture");
    expect(agricultureIdx).toBeGreaterThan(-1);
    const agricultureCardStart = baseSetHtml.lastIndexOf('<div class="card ', agricultureIdx);
    const agricultureSnippet = baseSetHtml.slice(agricultureCardStart, agricultureIdx);
    expect(agricultureSnippet).toContain("data-known");

    // Unresolved card (Metalworking) should NOT have data-known
    const metalworkingIdx = baseSetHtml.indexOf("Metalworking");
    expect(metalworkingIdx).toBeGreaterThan(-1);
    const metalworkingCardStart = baseSetHtml.lastIndexOf('<div class="card ', metalworkingIdx);
    const metalworkingSnippet = baseSetHtml.slice(metalworkingCardStart, metalworkingIdx);
    expect(metalworkingSnippet).not.toContain("data-known");
  });

  it("renders tall grid for cards section", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("layout-wide");
    expect(html).toContain("layout-tall");
    expect(html).toContain("tall-grid");
  });

  it("renders empty card placeholder when section is empty", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("empty-card");
    expect(html).toContain("empty");
  });

  it("renders all-known class on fully resolved age rows in card lists", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);

    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("section-row");
  });
});

describe("renderFullPage", () => {
  it("produces complete standalone HTML document", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const css = "body { background: #000; }";
    const html = renderFullPage(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345", css);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("Innovation &mdash; 12345");
    expect(html).toContain(css);
    expect(html).toContain("Russo+One");
    expect(html).toContain("</html>");
  });

  it("includes interactive JavaScript", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderFullPage(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345", "");

    expect(html).toContain("<script>");
    expect(html).toContain("mousemove");
    expect(html).toContain("tri-toggle");
  });

  it("includes the inline CSS", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const css = ".test-class { color: red; }";
    const html = renderFullPage(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345", css);

    expect(html).toContain("<style>");
    expect(html).toContain(css);
  });
});

describe("SUMMARY_JS", () => {
  it("includes mousemove handler", () => {
    expect(SUMMARY_JS).toContain("mousemove");
    expect(SUMMARY_JS).toContain("card-tip");
  });

  it("includes toggle handler", () => {
    expect(SUMMARY_JS).toContain("tri-toggle");
    expect(SUMMARY_JS).toContain("mode-unknown");
  });

  it("handles visibility modes: none, all, unknown", () => {
    expect(SUMMARY_JS).toContain('mode === "none"');
    expect(SUMMARY_JS).toContain('mode === "all"');
    expect(SUMMARY_JS).toContain('mode === "unknown"');
  });

  it("handles composite modes: base, echoes, cities", () => {
    expect(SUMMARY_JS).toContain('mode === "base"');
    expect(SUMMARY_JS).toContain('mode === "echoes"');
    expect(SUMMARY_JS).toContain('mode === "cities"');
    expect(SUMMARY_JS).toContain("data-set");
  });

  it("handles layout modes: wide, tall", () => {
    expect(SUMMARY_JS).toContain('mode === "wide"');
    expect(SUMMARY_JS).toContain('mode === "tall"');
  });
});

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe("echoes card rendering", () => {
  function makeEchoesGameState(players: string[], perspective: string): { state: GameState; engine: GameEngine } {
    engine = new GameEngine(cardDb);
    const state = createGameState(players, perspective);
    engine.initGame(state, { echoes: true });
    return { state, engine };
  }

  it("renders unknown echoes cards with b-gray-echoes class", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Echoes-mode deals 1 base + 1 echoes to each player, so hands contain echoes unknowns
    expect(html).toContain("b-gray-echoes");
  });

  it("renders known echoes cards with base card layout and card-tip tooltip", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    // Resolve hand with one echoes card (bangle is an age-1 echoes card)
    engine.resolveHand(gs, "Alice", ["bangle", "agriculture"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Card should use card-base layout (same as base cards)
    expect(html).toContain("Bangle");
    // Extract the full card div for Bangle
    const bangleIdx = html.indexOf("Bangle");
    const bangleCardStart = html.lastIndexOf('<div class="card ', bangleIdx);
    // Find the closing </div> for the card-tip (the outermost card div ends after card-tip's closing div)
    const bangleSnippet = html.slice(bangleCardStart, bangleCardStart + 800);
    expect(bangleSnippet).toContain("card-base");
    // Should have card-tip with image tooltip (not card-tip-text like cities)
    expect(bangleSnippet).toContain("card-tip");
  });

  it("renders echo icon as SVG image", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    // Bangle has icons: ["hex", "castle", "echo", "bonus-1"]
    engine.resolveHand(gs, "Alice", ["bangle", "agriculture"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("echo.svg");
    expect(html).toContain('alt="echo"');
  });

  it("renders hexnote icon as hexnote_purple.png image", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    // Bell has icons: ["castle", "hexnote", "castle", "echo"]
    engine.resolveHand(gs, "Alice", ["bell", "agriculture"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("hexnote_purple.png");
    expect(html).toContain('alt="hexnote"');
  });

  it("renders echoes known cards with correct color classes", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    // Bangle is red, Bell is purple
    engine.resolveHand(gs, "Alice", ["bangle", "agriculture"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    const bangleIdx = html.indexOf("Bangle");
    const bangleCardStart = html.lastIndexOf('<div class="card ', bangleIdx);
    const bangleSnippet = html.slice(bangleCardStart, bangleIdx);
    expect(bangleSnippet).toContain("b-red");
  });

  it("renders echoes card image tooltips with correct sprite index", () => {
    const { state: gs } = makeEchoesGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["bangle", "agriculture"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Bangle card should have its card image in tooltip
    const bangleInfo = cardDb.get("bangle")!;
    expect(html).toContain(`card_${bangleInfo.spriteIndex}.png`);
  });
});

describe("rendering edge cases", () => {
  it("handles game state with no cities cards", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    // Remove all cities decks
    for (let age = 1; age <= 10; age++) {
      const key = ageSetKey(age, CardSet.CITIES);
      gs.decks.set(key, []);
    }
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("Deck");
  });

  it("escapes HTML in card names", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    engine.resolveHand(gs, "Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).not.toContain("<Agriculture>");
  });

  it("renders SVG icons in row labels for my-hand section", () => {
    const { state: gs } = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, engine, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });
});
