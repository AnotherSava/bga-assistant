import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const thisDir = dirname(fileURLToPath(import.meta.url));

describe("smoke tests", () => {
  it("imports from models/types without errors", async () => {
    const module = await import("../models/types");
    expect(module).toBeDefined();
  });

  it("imports from innovation/process_log without errors", async () => {
    const module = await import("../games/innovation/process_log");
    expect(module).toBeDefined();
  });

  it("imports from innovation/game_state without errors", async () => {
    const module = await import("../games/innovation/game_state");
    expect(module).toBeDefined();
  });

  it("imports from innovation/render without errors", async () => {
    const module = await import("../games/innovation/render");
    expect(module).toBeDefined();
  });

  it("imports from innovation/config without errors", async () => {
    const module = await import("../games/innovation/config");
    expect(module).toBeDefined();
  });

  it("loads card_info.json asset", () => {
    const cardInfoPath = resolve(thisDir, "../../assets/bga/innovation/card_info.json");
    const data = JSON.parse(readFileSync(cardInfoPath, "utf-8"));
    expect(data).toBeDefined();
    expect(Array.isArray(data) || typeof data === "object").toBe(true);
  });

  it("verifies build output exists after vite build", () => {
    const distDir = resolve(thisDir, "../../dist");
    expect(existsSync(resolve(distDir, "background.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "extract.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "sidepanel.html"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("manifest web_accessible_resources", () => {
  const manifest = JSON.parse(readFileSync(resolve(thisDir, "../../manifest.json"), "utf-8"));

  it("exposes Innovation card faces to BGA pages", () => {
    // The in-page game log renders card tooltips inside BGA's document, so the face images are
    // fetched by boardgamearena.com rather than by an extension page. Without this the tooltip
    // silently shows an empty box.
    const entry = manifest.web_accessible_resources?.find((e: { resources: string[] }) =>
      e.resources.some((r: string) => r.includes("innovation/cards")));
    expect(entry).toBeDefined();
    expect(entry.matches).toContain("https://boardgamearena.com/*");
    expect(entry.matches).toContain("https://*.boardgamearena.com/*");
  });

  it("matches the cards subdirectory, not just the innovation directory", () => {
    // Regression guard for the glob removed in 0c699b7: `assets/bga/innovation/*` does not
    // match subdirectories, so it would never have exposed the card faces.
    const resources = manifest.web_accessible_resources.flatMap((e: { resources: string[] }) => e.resources);
    expect(resources).toContain("assets/bga/innovation/cards/*.webp");
    expect(resources).not.toContain("assets/bga/innovation/*");
  });

  it("exposes card faces and card icons, and nothing else", () => {
    // Every additional glob widens the page-reachable surface; keep this deliberate.
    //
    // Card faces are the tooltips the in-page log and the opponents' hands open. The icons are the
    // cards themselves: an opponent's hand is drawn with the side panel's own card, whose icons are
    // `<img>` elements that BGA's document fetches. Fonts are the exception that stays out — BGA's
    // Content-Security-Policy refuses the extension scheme for `font-src`, so the injected stylesheet
    // inlines those as `data:` URIs instead. `img-src` has no such objection.
    const resources = manifest.web_accessible_resources.flatMap((e: { resources: string[] }) => e.resources);
    expect(resources).toEqual(["assets/bga/innovation/cards/*.webp", "assets/bga/innovation/icons/*"]);
  });
});

describe("the compact card's scope class", () => {
  const root = resolve(thisDir, "../..");

  it("is carried by every surface that renders the card", () => {
    // mini_card.css hangs every rule off `:where(.bgaa-cards)`, so that injecting it into BGA's page
    // cannot restyle BGA's own `.card` elements. That makes the class load-bearing on our side: drop
    // it from a surface and every card there loses its box, grid and colour at once.
    expect(readFileSync(resolve(root, "sidepanel.html"), "utf-8")).toContain('<body class="bgaa-cards">');
    // The exported page, which carries the same markup and collects the same stylesheets.
    expect(readFileSync(resolve(root, "src/games/innovation/render.ts"), "utf-8")).toContain('<body class="bgaa-cards">');
    // And the wrapper the simplified cards inject into each of BGA's own hand cards.
    expect(readFileSync(resolve(root, "src/games/innovation/simplified_cards.ts"), "utf-8")).toContain('const CARDS_SCOPE_CLASS = "bgaa-cards"');
  });

  it("scopes every rule in the shared sheet, so none of it can reach BGA's cards", () => {
    // A real class, not `:where()`: BGA's own `.card { display: inline-block }` is a single class, and
    // an injected sheet loses that tie — the card's grid never applied and every card stacked into a
    // column. The scope has to be worth a point of its own.
    const css = readFileSync(resolve(root, "src/games/innovation/mini_card.css"), "utf-8");
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map(block => block.split("{")[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      for (const alternative of selector.split(",")) {
        expect(alternative.trim().startsWith(".bgaa-cards ")).toBe(true);
      }
    }
  });
});
