// Tests for config, summary rendering, toggle state management

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import {
  DEFAULT_SECTION_CONFIG,
  SECTION_IDS,
  TALL_COLUMNS,
  visibilityToggle,
  layoutToggle,
  compositeToggle,
  type SectionId,
} from "../render/config.js";
import { renderSummary, renderFullPage, setAssetResolver, SUMMARY_JS } from "../render/summary.js";
import { CardDatabase, CardSet, Card, ageSetKey } from "../models/types.js";
import { GameState } from "../engine/game_state.js";

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

function makeGameState(players: string[], perspective: string): GameState {
  const gs = new GameState(cardDb, players, perspective);
  gs.initGame();
  return gs;
}

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

describe("Section Config", () => {
  it("has all 7 section IDs with configs", () => {
    expect(SECTION_IDS).toHaveLength(7);
    for (const id of SECTION_IDS) {
      expect(DEFAULT_SECTION_CONFIG[id]).toBeDefined();
    }
  });

  it("section order follows SECTION_IDS array", () => {
    expect(SECTION_IDS).toEqual([
      "hand-opponent", "hand-me", "score-opponent", "score-me",
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
  it("builds Hide/Base/Cities toggle with base default", () => {
    const toggle = compositeToggle("deck", "base");
    expect(toggle.targetId).toBe("deck");
    expect(toggle.defaultMode).toBe("base");
    expect(toggle.options).toHaveLength(3);
    expect(toggle.options[0]).toEqual({ mode: "none", label: "Hide", active: false });
    expect(toggle.options[1]).toEqual({ mode: "base", label: "Base", active: true });
    expect(toggle.options[2]).toEqual({ mode: "cities", label: "Cities", active: false });
  });

  it("builds Hide/Base/Cities toggle with none default", () => {
    const toggle = compositeToggle("cards", "none");
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true);
    expect(toggle.options[1].active).toBe(false);
    expect(toggle.options[2].active).toBe(false);
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
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("Hand &mdash; opponent");
    expect(html).toContain("Hand &mdash; me");
    expect(html).toContain("Score &mdash; opponent");
    expect(html).toContain("Score &mdash; me");
    expect(html).toContain("Achievements");
    expect(html).toContain("Deck");
    expect(html).toContain("Cards");
  });

  it("contains tri-toggle elements", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("tri-toggle");
    expect(html).toContain("tri-opt");
    expect(html).toContain("tri-sep");
  });

  it("renders unknown cards with b-gray-base class", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Hand cards should be unresolved -> gray cards
    expect(html).toContain("b-gray-base");
  });

  it("renders card-age elements", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('class="card-age"');
  });

  it("renders deck section with age labels", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("section-row");
    expect(html).toContain("row-label");
  });

  it("renders section divs with data-section attributes", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('data-section="hand-opponent"');
    expect(html).toContain('data-section="hand-me"');
    expect(html).toContain('data-section="deck"');
    expect(html).toContain('data-section="cards"');
    expect(html).toContain('data-section="achievements"');
  });

  it("renders section divs with IDs for toggle targeting", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('id="hand-opponent"');
    expect(html).toContain('id="deck"');
    expect(html).toContain('id="cards"');
  });

  it("cards section defaults to base with unknown filter", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Cards visible (no display:none), with mode-unknown class
    expect(html).toContain('id="cards" class="mode-unknown"');
  });

  it("deck section shows base set by default and hides cities", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract deck section content — use enough chars to include both sets
    const deckStart = html.indexOf('id="deck"');
    expect(deckStart).toBeGreaterThan(-1);
    // Find the end of the deck section (next <div class="section"> or end)
    const nextSectionStart = html.indexOf('<div class="section">', deckStart);
    const deckHtml = nextSectionStart > deckStart ? html.slice(deckStart, nextSectionStart) : html.slice(deckStart);

    expect(deckHtml).toContain('data-set="base"');
    expect(deckHtml).toContain('data-set="cities"');
    // Base visible (no style="display:none" on base set div)
    expect(deckHtml).toMatch(/data-set="base">/)
    // Cities hidden
    expect(deckHtml).toContain('data-set="cities" style="display:none"');
  });

  it("cards section contains both data-set containers", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);

    expect(cardsHtml).toContain('data-set="base"');
    expect(cardsHtml).toContain('data-set="cities"');
  });

  it("deck section has Hide/Base/Cities composite toggle", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Find the Deck section title area
    const deckTitleIdx = html.indexOf(">Deck");
    const deckTitleArea = html.slice(deckTitleIdx, deckTitleIdx + 500);

    expect(deckTitleArea).toContain('data-mode="none"');
    expect(deckTitleArea).toContain('data-mode="base"');
    expect(deckTitleArea).toContain('data-mode="cities"');
    expect(deckTitleArea).toContain(">Hide<");
    expect(deckTitleArea).toContain(">Base<");
    expect(deckTitleArea).toContain(">Cities<");
  });

  it("cards section has All/Unknown and Wide/Tall toggles alongside set toggle", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Find the Cards section title area
    const cardsTitleIdx = html.indexOf(">Cards");
    const cardsTitleArea = html.slice(cardsTitleIdx, cardsTitleIdx + 800);

    // Composite toggle: Hide/Base/Cities
    expect(cardsTitleArea).toContain(">Hide<");
    expect(cardsTitleArea).toContain(">Base<");
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
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Achievements defaults to "none" — its Wide/Tall toggle should be hidden
    const achTitleIdx = html.indexOf(">Achievements");
    const achTitleArea = html.slice(achTitleIdx, achTitleIdx + 500);
    // The layout toggle exists but is hidden
    expect(achTitleArea).toContain(">Wide<");
    expect(achTitleArea).toContain('style="display:none"');
  });

  it("shows extra toggles when section is visible", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Cards defaults to "base" — its extra toggles should be visible (no display:none)
    const cardsTitleIdx = html.indexOf(">Cards");
    const cardsTitleEnd = html.indexOf("</div>", cardsTitleIdx);
    const cardsTitleArea = html.slice(cardsTitleIdx, cardsTitleEnd);
    expect(cardsTitleArea).not.toContain('style="display:none"');
  });

  it("renders resolved cards with known card info", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("Agriculture");
    expect(html).toContain("Archery");
  });

  it("renders icon images for known base cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("assets/bga/innovation/icons/");
    expect(html).toContain('width="20"');
  });

  it("renders card tooltips for base cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("card-tip");
    expect(html).toContain("assets/bga/innovation/cards/card_");
  });

  it("classifies my cards by opponent knowledge", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("M12 7c2.76");
  });

  it("renders cards section with data-known attributes for resolved cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("data-known");
  });

  it("renders unresolved card-list cards face-up with card names", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract the cards section (base set)
    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);

    expect(cardsHtml).toContain("Metalworking");
    expect(cardsHtml).toContain("Oars");
    // Should NOT be gray placeholders in the card list
    const baseSetStart = cardsHtml.indexOf('data-set="base"');
    const citiesSetStart = cardsHtml.indexOf('data-set="cities"');
    const baseSetHtml = cardsHtml.slice(baseSetStart, citiesSetStart);
    expect(baseSetHtml).not.toContain("b-gray-base");
  });

  it("marks only resolved card-list cards with data-known", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    const cardsStart = html.indexOf('id="cards"');
    const cardsHtml = html.slice(cardsStart);
    const baseSetStart = cardsHtml.indexOf('data-set="base"');
    const citiesSetStart = cardsHtml.indexOf('data-set="cities"');
    const baseSetHtml = cardsHtml.slice(baseSetStart, citiesSetStart);

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
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("layout-wide");
    expect(html).toContain("layout-tall");
    expect(html).toContain("tall-grid");
  });

  it("renders empty card placeholder when section is empty", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("empty-card");
    expect(html).toContain("empty");
  });

  it("renders all-known class on fully resolved age rows in card lists", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("section-row");
  });
});

describe("renderFullPage", () => {
  it("produces complete standalone HTML document", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const css = "body { background: #000; }";
    const html = renderFullPage(gs, cardDb, "Alice", ["Alice", "Bob"], "12345", css);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("Innovation &mdash; 12345");
    expect(html).toContain(css);
    expect(html).toContain("Russo+One");
    expect(html).toContain("</html>");
  });

  it("includes interactive JavaScript", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderFullPage(gs, cardDb, "Alice", ["Alice", "Bob"], "12345", "");

    expect(html).toContain("<script>");
    expect(html).toContain("mousemove");
    expect(html).toContain("tri-toggle");
  });

  it("includes the inline CSS", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const css = ".test-class { color: red; }";
    const html = renderFullPage(gs, cardDb, "Alice", ["Alice", "Bob"], "12345", css);

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
    expect(SUMMARY_JS).toContain("mode === 'none'");
    expect(SUMMARY_JS).toContain("mode === 'all'");
    expect(SUMMARY_JS).toContain("mode === 'unknown'");
  });

  it("handles composite modes: base, cities", () => {
    expect(SUMMARY_JS).toContain("mode === 'base'");
    expect(SUMMARY_JS).toContain("mode === 'cities'");
    expect(SUMMARY_JS).toContain("data-set");
  });

  it("handles layout modes: wide, tall", () => {
    expect(SUMMARY_JS).toContain("mode === 'wide'");
    expect(SUMMARY_JS).toContain("mode === 'tall'");
  });
});

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe("rendering edge cases", () => {
  it("handles game state with no cities cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    // Remove all cities decks
    for (let age = 1; age <= 10; age++) {
      const key = ageSetKey(age, CardSet.CITIES);
      gs.decks.set(key, []);
    }
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("Deck");
  });

  it("escapes HTML in card names", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).not.toContain("<Agriculture>");
  });

  it("renders SVG icons in row labels for my-hand section", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });
});
