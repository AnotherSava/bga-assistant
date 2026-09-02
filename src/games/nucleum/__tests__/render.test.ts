import { describe, it, expect } from "vitest";
import { formatNucleumActionDetail, renderNucleumTurnHistoryRows, renderNucleumSummary, renderNucleumFullPage } from "../render.js";
import type { NucleumActionDetail, NucleumActionType, NucleumTurnAction } from "../types.js";
import type { PlayerInfo } from "../../../models/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAYERS: Record<string, PlayerInfo> = {
  "100": { id: "100", name: "Alice", colorHex: "06b69e", isCurrent: true },
  "200": { id: "200", name: "Bob", colorHex: "ffa500", isCurrent: false },
};

function mkDetail(actionType: NucleumActionType, overrides: Partial<NucleumActionDetail> = {}): NucleumActionDetail {
  return { actionType, player: "100", city: null, link: null, count: null, label: null, ...overrides };
}

function mkAction(player: string, details: NucleumActionDetail[], overrides: Partial<NucleumTurnAction> = {}): NucleumTurnAction {
  return { player, actionNumber: 1, time: null, logIndex: 0, actions: details, ...overrides };
}

/** Row text as a reader sees it: both name forms are always in the markup and CSS shows one,
 *  so drop the long form before stripping tags. */
function textOf(html: string): string {
  return html.replace(/<span class="th-name-full">.*?<\/span>/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// formatNucleumActionDetail
// ---------------------------------------------------------------------------

describe("formatNucleumActionDetail", () => {
  it("names the city a building, mine or turbine went in", () => {
    expect(formatNucleumActionDetail(mkDetail("urbanize", { city: 4 }), PLAYERS)).toBe("urbanize Riesa");
    expect(formatNucleumActionDetail(mkDetail("mine", { city: 12 }), PLAYERS)).toBe("mine Brüx");
    expect(formatNucleumActionDetail(mkDetail("turbine", { city: 1 }), PLAYERS)).toBe("turbine Zittau");
  });

  it("names the power plant that fed an energize", () => {
    expect(formatNucleumActionDetail(mkDetail("energize", { city: 3 }), PLAYERS)).toBe("energize Grimma");
  });

  it("drops the city when it is out of the board's range", () => {
    expect(formatNucleumActionDetail(mkDetail("energize", { city: 99 }), PLAYERS)).toBe("energize");
    expect(formatNucleumActionDetail(mkDetail("energize", { city: null }), PLAYERS)).toBe("energize");
  });

  it("names the two cities a railway joined, and says nothing when it joined none", () => {
    expect(formatNucleumActionDetail(mkDetail("railway", { link: [1, 18] }), PLAYERS)).toBe("railway Zittau–Görlitz");
    expect(formatNucleumActionDetail(mkDetail("railway"), PLAYERS)).toBe("railway");
  });

  it("spells out the remaining choices", () => {
    expect(formatNucleumActionDetail(mkDetail("contract"), PLAYERS)).toBe("take contract");
    expect(formatNucleumActionDetail(mkDetail("fulfill"), PLAYERS)).toBe("fulfil contract");
    expect(formatNucleumActionDetail(mkDetail("tech"), PLAYERS)).toBe("unlock tech");
    expect(formatNucleumActionDetail(mkDetail("recharge"), PLAYERS)).toBe("recharge");
    expect(formatNucleumActionDetail(mkDetail("milestone"), PLAYERS)).toBe("milestone");
    expect(formatNucleumActionDetail(mkDetail("tile"), PLAYERS)).toBe("plays a tile");
  });

  it("counts a repeated action but leaves a single one unmarked", () => {
    expect(formatNucleumActionDetail(mkDetail("sell", { count: 3 }), PLAYERS)).toBe("sell uranium ×3");
    expect(formatNucleumActionDetail(mkDetail("sell", { count: 1 }), PLAYERS)).toBe("sell uranium");
    expect(formatNucleumActionDetail(mkDetail("develop", { count: 2 }), PLAYERS)).toBe("develop ×2");
  });

  it("renders the experiment choice as its own label", () => {
    expect(formatNucleumActionDetail(mkDetail("experiment", { label: "Experiment C" }), PLAYERS)).toBe("Experiment C");
  });

  it("renders a turn in progress as nothing at all", () => {
    expect(formatNucleumActionDetail(mkDetail("pending"), PLAYERS)).toBe("");
  });

  it("names the player when an action was taken during someone else's turn", () => {
    const action = mkAction("100", []);
    const html = formatNucleumActionDetail(mkDetail("urbanize", { player: "200", city: 5 }), PLAYERS, action);
    expect(html).toContain('class="nucleum-actor"');
    expect(html).toContain("--player-color: #ffa500");
    expect(textOf(html)).toBe("Bob urbanize Leipzig");
  });

  it("does not name the player when the action is the turn owner's own", () => {
    const action = mkAction("100", []);
    expect(formatNucleumActionDetail(mkDetail("urbanize", { player: "100", city: 5 }), PLAYERS, action)).toBe("urbanize Leipzig");
  });

  it("escapes a hostile experiment label", () => {
    const html = formatNucleumActionDetail(mkDetail("experiment", { label: "<script>x</script>" }), PLAYERS);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a hostile player name in the actor prefix", () => {
    const players: Record<string, PlayerInfo> = { ...PLAYERS, "200": { id: "200", name: "<img src=x>", colorHex: "ffa500", isCurrent: false } };
    const html = formatNucleumActionDetail(mkDetail("contract", { player: "200" }), players, mkAction("100", []));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

// ---------------------------------------------------------------------------
// renderNucleumTurnHistoryRows
// ---------------------------------------------------------------------------

describe("renderNucleumTurnHistoryRows", () => {
  const alice = mkAction("100", [mkDetail("urbanize", { city: 4 }), mkDetail("fulfill")], { logIndex: 3 });
  const bob = mkAction("200", [mkDetail("recharge", { player: "200" })], { logIndex: 9 });

  it("puts the primary action on the row and the rest under it", () => {
    const rows = renderNucleumTurnHistoryRows([alice], PLAYERS);
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0].html)).toBe("you: urbanize Riesa");
    expect(rows[1].html).toContain("th-sub");
    expect(textOf(rows[1].html)).toBe("→ fulfil contract");
  });

  it("keys rows by log position rather than array index", () => {
    const rows = renderNucleumTurnHistoryRows([alice, bob], PLAYERS, { rowKeys: true });
    expect(rows.map(r => r.key)).toEqual(["3.0:0", "3.0:1", "sep:9.0:0", "9.0:0"]);
    // The same turn keeps its keys when an earlier one drops out of the window.
    expect(renderNucleumTurnHistoryRows([bob], PLAYERS, { rowKeys: true })[0].key).toBe("9.0:0");
  });

  it("separates half-turns and reverses them for BGA's newest-first log", () => {
    const chronological = renderNucleumTurnHistoryRows([alice, bob], PLAYERS);
    const reversed = renderNucleumTurnHistoryRows([alice, bob], PLAYERS, { newestFirst: true });
    expect(textOf(chronological[0].html)).toBe("you: urbanize Riesa");
    expect(textOf(reversed[0].html)).toBe("opp: recharge");
  });

  it("tints the observer's own row and colours every row by its player", () => {
    const rows = renderNucleumTurnHistoryRows([alice, bob], PLAYERS);
    expect(rows[0].html).toContain("th-me");
    expect(rows[0].html).toContain("--player-color: #06b69e");
    expect(rows[rows.length - 1].html).not.toContain("th-me");
    expect(rows[rows.length - 1].html).toContain("--player-color: #ffa500");
  });

  it("carries both name forms so the panel can switch between them", () => {
    const html = renderNucleumTurnHistoryRows([alice], PLAYERS)[0].html;
    expect(html).toContain('<span class="th-name-short">you:</span>');
    expect(html).toContain('<span class="th-name-full">Alice:</span>');
  });

  it("shows a time only when the action has one, and drops the date on request", () => {
    const timed = mkAction("100", [mkDetail("recharge")], { time: 1788203467 });
    expect(renderNucleumTurnHistoryRows([timed], PLAYERS)[0].html).toContain("th-time");
    expect(renderNucleumTurnHistoryRows([timed], PLAYERS, { timeOnly: true })[0].html).not.toMatch(/th-time">[A-Z]/);
    expect(renderNucleumTurnHistoryRows([alice], PLAYERS)[0].html).not.toContain("th-time");
  });

  it("renders a turn in progress as the player's name alone", () => {
    const rows = renderNucleumTurnHistoryRows([mkAction("200", [mkDetail("pending", { player: "200" })])], PLAYERS);
    expect(textOf(rows[0].html)).toBe("opp:");
  });

  it("throws on an action whose player is not at the table", () => {
    expect(() => renderNucleumTurnHistoryRows([mkAction("999", [mkDetail("recharge")])], PLAYERS)).toThrow(/unknown player id/);
  });

  it("renders nothing for no actions", () => {
    expect(renderNucleumTurnHistoryRows([], PLAYERS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderNucleumSummary / renderNucleumFullPage
// ---------------------------------------------------------------------------

describe("renderNucleumSummary", () => {
  it("wraps the history and shows the newest turn first", () => {
    const state = {
      players: PLAYERS,
      actions: [mkAction("100", [mkDetail("contract")], { logIndex: 1 }), mkAction("200", [mkDetail("recharge", { player: "200" })], { logIndex: 5 })],
    };
    const html = renderNucleumSummary(state);
    expect(html).toContain('class="nucleum-history"');
    expect(html.indexOf("recharge")).toBeLessThan(html.indexOf("take contract"));
  });

  it("says so when no turn has been played", () => {
    const html = renderNucleumSummary({ players: PLAYERS, actions: [] });
    expect(html).toContain("nucleum-empty");
    expect(textOf(html)).toBe("No turns played yet.");
  });
});

describe("renderNucleumFullPage", () => {
  const state = { players: PLAYERS, actions: [mkAction("100", [mkDetail("contract")])] };

  it("produces a standalone document with the passed stylesheet inlined", () => {
    const html = renderNucleumFullPage(state, "907048482", ".nucleum-history { color: red }");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Nucleum &mdash; 907048482</title>");
    expect(html).toContain(".nucleum-history { color: red }");
    expect(html).toContain("take contract");
  });

  it("escapes a hostile table id", () => {
    const html = renderNucleumFullPage(state, "<script>x</script>", "");
    expect(html).not.toContain("<script>x</script>");
  });
});
