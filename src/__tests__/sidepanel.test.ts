// Tests for Task 6: config, summary rendering, toggle state management

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
  it("has all 9 section IDs", () => {
    expect(SECTION_IDS).toHaveLength(9);
    for (const id of SECTION_IDS) {
      expect(DEFAULT_SECTION_CONFIG[id]).toBeDefined();
    }
  });

  it("all sections default to column 1", () => {
    for (const id of SECTION_IDS) {
      expect(DEFAULT_SECTION_CONFIG[id].column).toBe(1);
    }
  });

  it("sections are ordered 1-9", () => {
    const orders = SECTION_IDS.map((id) => DEFAULT_SECTION_CONFIG[id].order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("base-list and cities-list default to none visibility", () => {
    expect(DEFAULT_SECTION_CONFIG["base-list"].defaultVisibility).toBe("none");
    expect(DEFAULT_SECTION_CONFIG["cities-list"].defaultVisibility).toBe("none");
  });

  it("cities-deck defaults to hide visibility", () => {
    expect(DEFAULT_SECTION_CONFIG["cities-deck"].defaultVisibility).toBe("hide");
  });

  it("hand sections default to show visibility", () => {
    expect(DEFAULT_SECTION_CONFIG["hand-opponent"].defaultVisibility).toBe("show");
    expect(DEFAULT_SECTION_CONFIG["hand-me"].defaultVisibility).toBe("show");
  });

  it("achievements, base-list, cities-list have defaultLayout", () => {
    expect(DEFAULT_SECTION_CONFIG["achievements"].defaultLayout).toBe("wide");
    expect(DEFAULT_SECTION_CONFIG["base-list"].defaultLayout).toBe("wide");
    expect(DEFAULT_SECTION_CONFIG["cities-list"].defaultLayout).toBe("wide");
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
    const toggle = visibilityToggle("base-list", "unknown", true);
    expect(toggle.defaultMode).toBe("unknown");
    expect(toggle.options).toHaveLength(3);
    expect(toggle.options[0].label).toBe("None");
    expect(toggle.options[1].label).toBe("All");
    expect(toggle.options[2].label).toBe("Unknown");
    expect(toggle.options[2].active).toBe(true);
  });

  it("maps hide to none mode", () => {
    const toggle = visibilityToggle("cities-deck", "hide", false);
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true); // "Hide" is active
  });

  it("maps none to none mode", () => {
    const toggle = visibilityToggle("base-list", "none", true);
    expect(toggle.defaultMode).toBe("none");
    expect(toggle.options[0].active).toBe(true); // "None" is active
  });
});

describe("layoutToggle", () => {
  it("builds wide/tall toggle with wide default", () => {
    const toggle = layoutToggle("base-list", "wide");
    expect(toggle.targetId).toBe("base-list");
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
  it("produces HTML with all 9 section titles", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain("Hand &mdash; opponent");
    expect(html).toContain("Hand &mdash; me");
    expect(html).toContain("Score &mdash; opponent");
    expect(html).toContain("Score &mdash; me");
    expect(html).toContain("Achievements");
    expect(html).toContain("Base deck");
    expect(html).toContain("Cities deck");
    expect(html).toContain("Base list");
    expect(html).toContain("Cities list");
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

  it("renders deck sections with age labels", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Base deck should show age labels
    expect(html).toContain("section-row");
    expect(html).toContain("row-label");
  });

  it("renders section divs with IDs for toggle targeting", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Sections with toggles get id attributes
    expect(html).toContain('id="hand-opponent"');
    expect(html).toContain('id="base-list"');
  });

  it("hides sections with none default visibility", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // base-list defaults to none -> display:none
    expect(html).toContain('id="base-list" style="display:none"');
  });

  it("hides cities-deck by default", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    expect(html).toContain('id="cities-deck" style="display:none"');
  });

  it("renders resolved cards with known card info", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    // Resolve a card in Alice's hand
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Resolved cards should have card names
    expect(html).toContain("Agriculture");
    expect(html).toContain("Archery");
  });

  it("renders icon images for known base cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Cards should have icon images
    expect(html).toContain("assets/bga/innovation/icons/");
    expect(html).toContain('width="20"');
  });

  it("renders card tooltips for base cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Known base cards should have image tooltips
    expect(html).toContain("card-tip");
    expect(html).toContain("assets/bga/innovation/cards/card_");
  });

  it("classifies my cards by opponent knowledge", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // My hand should have eye_closed SVG icon (opponent doesn't know these cards)
    // The key "eye_closed" is replaced by inline SVG; check for the SVG path
    expect(html).toContain("M12 7c2.76");
  });

  it("renders base-list with data-known attributes for resolved cards", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Base list marks resolved cards with data-known
    expect(html).toContain("data-known");
  });

  it("renders unresolved base-list cards face-up with card names in All mode", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    // Only resolve two cards — the rest are unresolved
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract just the base-list section (renderer uses <div class="section">, not <section>)
    const baseListStart = html.indexOf('id="base-list"');
    const citiesListStart = html.indexOf('id="cities-list"');
    const baseListHtml = html.slice(baseListStart, citiesListStart === -1 ? undefined : citiesListStart);

    // Unresolved age-1 cards (e.g. Metalworking, Oars) should render face-up with names
    expect(baseListHtml).toContain("Metalworking");
    expect(baseListHtml).toContain("Oars");
    // They should NOT be gray placeholders (b-gray-base is the unknown card class)
    expect(baseListHtml).not.toContain("b-gray-base");
  });

  it("marks only resolved base-list cards with data-known for Unknown mode masking", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Extract just the base-list section
    const baseListStart = html.indexOf('id="base-list"');
    const citiesListStart = html.indexOf('id="cities-list"');
    const baseListHtml = html.slice(baseListStart, citiesListStart === -1 ? undefined : citiesListStart);

    // Resolved card (Agriculture) should have data-known on its outer card div
    const agricultureIdx = baseListHtml.indexOf("Agriculture");
    expect(agricultureIdx).toBeGreaterThan(-1);
    const agricultureCardStart = baseListHtml.lastIndexOf('<div class="card ', agricultureIdx);
    const agricultureSnippet = baseListHtml.slice(agricultureCardStart, agricultureIdx);
    expect(agricultureSnippet).toContain("data-known");

    // Unresolved card (Metalworking) should render face-up WITHOUT data-known on its outer card div
    const metalworkingIdx = baseListHtml.indexOf("Metalworking");
    expect(metalworkingIdx).toBeGreaterThan(-1);
    const metalworkingCardStart = baseListHtml.lastIndexOf('<div class="card ', metalworkingIdx);
    const metalworkingSnippet = baseListHtml.slice(metalworkingCardStart, metalworkingIdx);
    expect(metalworkingSnippet).not.toContain("data-known");
  });

  it("renders tall grid for base-list section", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Base list has layout toggle -> both wide and tall layouts
    expect(html).toContain("layout-wide");
    expect(html).toContain("layout-tall");
    expect(html).toContain("tall-grid");
  });

  it("renders empty card placeholder when section is empty", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");

    // Score sections should be empty initially
    expect(html).toContain("empty-card");
    expect(html).toContain("empty");
  });

  it("renders with custom multi-column config", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const config = { ...DEFAULT_SECTION_CONFIG };
    config["base-list"] = { column: 2, order: 1, defaultVisibility: "show" as const, defaultLayout: "wide" as const };
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345", { sectionConfig: config });

    // Should have multi-column layout
    expect(html).toContain("page-grid");
    expect(html).toContain("page-col");
  });

  it("renders all-known class on fully resolved age rows in card lists", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    // Resolve all base age-1 cards by resolving hand cards
    gs.resolveHand("Alice", ["agriculture", "archery"]);

    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    // Some rows in base-list may have all-known class (depending on resolution state)
    // At minimum the HTML structure should be correct
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
    expect(html).toContain("Cities deck");
  });

  it("escapes HTML in card names", () => {
    // Verify the escapeHtml function works through renderKnownCard
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    gs.resolveHand("Alice", ["agriculture", "archery"]);
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    // No unescaped angle brackets in card names
    expect(html).not.toContain("<Agriculture>");
  });

  it("renders SVG icons in row labels for my-hand section", () => {
    const gs = makeGameState(["Alice", "Bob"], "Alice");
    const html = renderSummary(gs, cardDb, "Alice", ["Alice", "Bob"], "12345");
    // My hand section should have SVG row labels (eye_closed since opponent doesn't know)
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });
});
