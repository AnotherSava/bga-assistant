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

  it("exposes card faces and nothing else", () => {
    // Every additional glob widens the page-reachable surface; keep this deliberate. Notably the
    // simplified cards add nothing here: BGA's Content-Security-Policy would refuse a font served
    // from the extension anyway, so that stylesheet inlines its assets as `data:` URIs instead.
    const resources = manifest.web_accessible_resources.flatMap((e: { resources: string[] }) => e.resources);
    expect(resources).toEqual(["assets/bga/innovation/cards/*.webp"]);
  });
});
