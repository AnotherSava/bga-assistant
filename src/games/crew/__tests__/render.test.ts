import { describe, it, expect } from "vitest";
import { renderCrewSummary, renderCrewFullPage } from "../render.js";
import { createCrewGameState, type CrewGameState } from "../game_state.js";
import { cardKey, PINK, BLUE, GREEN, YELLOW, SUBMARINE } from "../types.js";
import type { PlayerInfo } from "../../../models/types.js";

const COLORS = ["ff0000", "0000ff", "008000", "ffa500"];

function mkPlayers(names: Record<string, string>, currentId: string): Record<string, PlayerInfo> {
  const out: Record<string, PlayerInfo> = {};
  let i = 0;
  for (const id in names) {
    out[id] = { id, name: names[id], colorHex: COLORS[i % COLORS.length], isCurrent: id === currentId };
    i++;
  }
  return out;
}

function makeState(): CrewGameState {
  const players = mkPlayers({ "1": "Alice", "2": "Bob", "3": "Carol", "4": "Dave" }, "1");
  const playerOrder = ["1", "2", "3", "4"];
  const state = createCrewGameState(players, playerOrder, "1");

  // Give the observer some resolved card slots
  state.hands["1"] = [
    { candidates: new Set([cardKey(PINK, 3)]) },
    { candidates: new Set([cardKey(BLUE, 7)]) },
    { candidates: new Set([cardKey(SUBMARINE, 2)]) },
  ];

  // Give opponents some slots (with candidates to test matrix)
  state.hands["2"] = [
    { candidates: new Set([cardKey(BLUE, 4)]) },
  ];
  state.hands["3"] = [
    { candidates: new Set([cardKey(BLUE, 4), cardKey(GREEN, 6)]) },
  ];
  state.hands["4"] = [
    { candidates: new Set([cardKey(GREEN, 2), cardKey(YELLOW, 5)]) },
  ];

  // Add a completed trick (cards are played, not in hands)
  state.tricks.push({
    cards: [
      { playerId: "1", card: { suit: PINK, value: 1 } },
      { playerId: "2", card: { suit: GREEN, value: 5 } },
      { playerId: "3", card: { suit: PINK, value: 6 } },
      { playerId: "4", card: { suit: YELLOW, value: 9 } },
    ],
    winnerId: "4",
  });

  // Add a current in-progress trick
  state.tricks.push({
    winnerId: null,
    cards: [
      { playerId: "1", card: { suit: BLUE, value: 7 } },
      { playerId: "2", card: { suit: BLUE, value: 3 } },
    ],
  });

  state.missionNumber = 5;
  return state;
}

describe("renderCrewSummary", () => {
  it("returns HTML with all three sections", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    expect(html).toContain("crew-summary");
    expect(html).toContain("Cards");
    expect(html).toContain("Player\u2013Suit");
    expect(html).toContain("Tricks");
  });

  it("renders card grid with correct state classes", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    // Pink 1 was played (in tricks)
    expect(html).toContain("crew-played");
    // Pink 3 is in my hand (resolved slot)
    expect(html).toContain("crew-myhand");
    // Other cards are hidden
    expect(html).toContain("crew-hidden");
  });

  it("renders empty cells for submarine values 5-9", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    // Count empty cells — submarine column has 5 empty cells (values 5-9)
    const emptyMatches = html.match(/crew-grid-empty/g);
    expect(emptyMatches).toHaveLength(5);
  });

  it("renders suit icons in card grid headers", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    // Should have SVG icons in header
    expect(html).toContain("crew-grid-suit-header");
    expect(html).toContain("<svg");
  });

  it("renders player-suit matrix with correct statuses", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    // Should have void, has, and unknown statuses
    expect(html).toContain("crew-matrix-void");
    expect(html).toContain("crew-matrix-has");
    expect(html).toContain("crew-matrix-unknown");
  });

  it("renders observer name with crew-matrix-me class", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    expect(html).toContain("crew-matrix-me");
    // Alice is the observer
    expect(html).toContain("Alice");
  });

  it("renders completed tricks with lead and winner highlights", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    expect(html).toContain("crew-lead");
    expect(html).toContain("crew-winner");
    // Trick number
    expect(html).toContain("crew-trick-num");
  });

  it("renders current trick as partial row", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    expect(html).toContain("crew-trick-current");
  });

  it("renders all player names in trick history header", () => {
    const state = makeState();
    const html = renderCrewSummary(state);

    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Carol");
    expect(html).toContain("Dave");
  });

  it("escapes HTML in player names", () => {
    const players = mkPlayers({ "1": "Al<script>ice", "2": "Bob", "3": "Carol" }, "1");
    const state = createCrewGameState(players, ["1", "2", "3"], "1");
    const html = renderCrewSummary(state);

    expect(html).not.toContain("<script>");
    expect(html).toContain("Al&lt;script&gt;ice");
  });

  it("handles empty state with no tricks", () => {
    const players = mkPlayers({ "1": "A", "2": "B", "3": "C" }, "1");
    const state = createCrewGameState(players, ["1", "2", "3"], "1");
    const html = renderCrewSummary(state);

    expect(html).toContain("crew-summary");
    expect(html).toContain("crew-card-grid");
    expect(html).toContain("crew-matrix");
    expect(html).toContain("crew-tricks");
    // No trick rows
    expect(html).not.toContain("crew-trick-num");
  });

  it("emits per-player BGA colors and observer-row class in matrix", () => {
    const state = makeState();
    const html = renderCrewSummary(state);
    // Each of the 4 distinct BGA colors appears at least once
    for (const c of COLORS) expect(html).toContain(`--player-color: #${c}`);
    // Observer row carries crew-matrix-me
    expect(html).toContain("crew-matrix-me");
  });
});

describe("renderCrewFullPage", () => {
  it("returns a full HTML document", () => {
    const state = makeState();
    const html = renderCrewFullPage(state, "12345", "body { color: red; }");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>The Crew &mdash; 12345</title>");
    expect(html).toContain("body { color: red; }");
    expect(html).toContain("crew-summary");
  });

  it("escapes table ID in title", () => {
    const state = makeState();
    const html = renderCrewFullPage(state, "test<xss>", "");

    expect(html).toContain("test&lt;xss&gt;");
    expect(html).not.toContain("test<xss>");
  });
});
