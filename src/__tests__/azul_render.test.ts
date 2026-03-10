import { describe, it, expect, beforeEach } from "vitest";
import { renderAzulSummary, setAssetResolver } from "../azul/render.js";
import type { AzulGameState } from "../azul/game_state.js";
import { initGame } from "../azul/game_state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<AzulGameState> = {}): AzulGameState {
  return { ...initGame(), ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderAzulSummary", () => {
  beforeEach(() => {
    setAssetResolver((path: string) => path);
  });

  it("returns an HTML string wrapping div", () => {
    const html = renderAzulSummary(makeState());
    expect(html).toContain('class="azul-summary"');
  });

  it("renders a table with 5 tile icon column headers", () => {
    const html = renderAzulSummary(makeState());
    for (let t = 1; t <= 5; t++) {
      expect(html).toContain(`assets/bga/azul/tiles/tile_${t}.png`);
    }
    // 5 th elements with img tags
    const thMatches = html.match(/<th><img /g);
    expect(thMatches).toHaveLength(5);
  });

  it("renders Bag and Box row labels", () => {
    const html = renderAzulSummary(makeState());
    expect(html).toContain(">Bag<");
    expect(html).toContain(">Box<");
  });

  it("shows initial bag counts (20 each) and box counts (0 each)", () => {
    const html = renderAzulSummary(makeState());
    // Bag row: 5 cells with count 20
    const bagRow = html.match(/>Bag<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    const bagCounts = [...bagRow.matchAll(/azul-count[^"]*">(\d+)</g)].map((m) => Number(m[1]));
    expect(bagCounts).toEqual([20, 20, 20, 20, 20]);

    // Box row: 5 cells with count 0
    const boxRow = html.match(/>Box<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    const boxCounts = [...boxRow.matchAll(/azul-count[^"]*">(\d+)</g)].map((m) => Number(m[1]));
    expect(boxCounts).toEqual([0, 0, 0, 0, 0]);
  });

  it("applies azul-zero class to zero counts", () => {
    const state = makeState({ bag: [0, 5, 0, 10, 0, 3] });
    const html = renderAzulSummary(state);
    // Count zero cells in bag row
    const bagRow = html.match(/>Bag<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    const zeroCells = (bagRow.match(/azul-zero/g) ?? []).length;
    expect(zeroCells).toBe(2); // indices 2 and 4 are 0
  });

  it("does not apply azul-zero class to non-zero counts", () => {
    const state = makeState({ bag: [0, 5, 5, 5, 5, 5] });
    const html = renderAzulSummary(state);
    const bagRow = html.match(/>Bag<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    expect(bagRow).not.toContain("azul-zero");
  });

  it("shows correct counts after partial game state", () => {
    const state = makeState({
      bag: [0, 12, 15, 8, 18, 14],
      discard: [0, 3, 1, 5, 0, 2],
    });
    const html = renderAzulSummary(state);

    const bagRow = html.match(/>Bag<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    const bagCounts = [...bagRow.matchAll(/azul-count[^"]*">(\d+)</g)].map((m) => Number(m[1]));
    expect(bagCounts).toEqual([12, 15, 8, 18, 14]);

    const boxRow = html.match(/>Box<\/td>(.*?)<\/tr>/s)?.[1] ?? "";
    const boxCounts = [...boxRow.matchAll(/azul-count[^"]*">(\d+)</g)].map((m) => Number(m[1]));
    expect(boxCounts).toEqual([3, 1, 5, 0, 2]);
  });

  it("does not show refill note when no refills occurred", () => {
    const html = renderAzulSummary(makeState());
    expect(html).not.toContain("azul-refill-note");
    expect(html).not.toContain("refilled");
  });

  it("shows refill note for a single refill round", () => {
    const state = makeState({ refillRounds: [3] });
    const html = renderAzulSummary(state);
    expect(html).toContain('class="azul-refill-note"');
    expect(html).toContain("Bag refilled from box before round 3");
  });

  it("shows refill note for multiple refill rounds", () => {
    const state = makeState({ refillRounds: [3, 5] });
    const html = renderAzulSummary(state);
    expect(html).toContain("Bag refilled from box before rounds 3, 5");
  });

  it("uses asset resolver for tile image URLs", () => {
    setAssetResolver((path: string) => `chrome-extension://abc/${path}`);
    const html = renderAzulSummary(makeState());
    expect(html).toContain('src="chrome-extension://abc/assets/bga/azul/tiles/tile_1.png"');
    expect(html).toContain('src="chrome-extension://abc/assets/bga/azul/tiles/tile_5.png"');
  });

  it("renders valid table structure with thead and tbody", () => {
    const html = renderAzulSummary(makeState());
    expect(html).toContain("<thead>");
    expect(html).toContain("</thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("</tbody>");
  });

  it("renders exactly 2 data rows (Bag and Box)", () => {
    const html = renderAzulSummary(makeState());
    // Count <tr> in tbody only
    const tbody = html.match(/<tbody>(.*?)<\/tbody>/s)?.[1] ?? "";
    const rowMatches = tbody.match(/<tr>/g);
    expect(rowMatches).toHaveLength(2);
  });
});
