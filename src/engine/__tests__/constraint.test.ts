import { describe, it, expect } from "vitest";
import { propagate, nakedSingles, hiddenSinglesPerPlaceholder, hiddenSinglesPerContainer, nakedTuples, type Placeholder } from "../constraint.js";

interface TestSlot extends Placeholder<string> {
  container: string;
}

function slot(container: string, ...cards: string[]): TestSlot {
  return { container, candidates: new Set(cards) };
}

const containerOf = (s: TestSlot): string => s.container;

// ---------------------------------------------------------------------------
// nakedSingles
// ---------------------------------------------------------------------------

describe("nakedSingles", () => {
  it("removes a singleton's card from all peers", () => {
    const a = slot("p1", "X");
    const b = slot("p1", "X", "Y");
    const c = slot("p2", "X", "W");
    const changed = nakedSingles([a, b, c]);
    expect(changed).toBe(true);
    expect([...b.candidates]).toEqual(["Y"]);
    expect([...c.candidates]).toEqual(["W"]);
  });

  it("chains until stable", () => {
    const a = slot("p1", "X");
    const b = slot("p1", "X", "Y");
    const c = slot("p2", "X", "Y", "Z");
    nakedSingles([a, b, c]);
    // a={X} eliminates X from b,c → b={Y}, c={Y,Z}. Then b={Y} eliminates Y from c → c={Z}.
    expect([...b.candidates]).toEqual(["Y"]);
    expect([...c.candidates]).toEqual(["Z"]);
  });

  it("returns false on stable input", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "X", "Y");
    expect(nakedSingles([a, b])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hiddenSinglesPerPlaceholder
// ---------------------------------------------------------------------------

describe("hiddenSinglesPerPlaceholder", () => {
  it("resolves a card present in only one placeholder", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "Y", "Z");
    const c = slot("p2", "Y");
    const changed = hiddenSinglesPerPlaceholder([a, b, c]);
    expect(changed).toBe(true);
    // X only in `a` → `a` resolves to {X}
    expect([...a.candidates]).toEqual(["X"]);
    // Z only in `b` → `b` resolves to {Z}
    expect([...b.candidates]).toEqual(["Z"]);
  });

  it("does not fire when card appears in multiple placeholders", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p2", "X", "Y");
    expect(hiddenSinglesPerPlaceholder([a, b])).toBe(false);
    expect([...a.candidates]).toEqual(["X", "Y"]);
  });

  it("does not modify an already-resolved placeholder", () => {
    // X is in a only (per-placeholder hidden single), but a is already resolved.
    const a = slot("p1", "X");
    const b = slot("p1", "Y", "Z");
    hiddenSinglesPerPlaceholder([a, b]);
    expect([...a.candidates]).toEqual(["X"]);
  });
});

// ---------------------------------------------------------------------------
// hiddenSinglesPerContainer
// ---------------------------------------------------------------------------

describe("hiddenSinglesPerContainer", () => {
  it("resolves a card present in only one container", () => {
    // X appears in slots a, b — both in container p1. Not in p2.
    const a = slot("p1", "X", "Y", "Z");
    const b = slot("p1", "X", "Y", "Z");
    const c = slot("p2", "Y", "Z");
    const d = slot("p2", "Y", "Z");
    const changed = hiddenSinglesPerContainer([a, b, c, d], containerOf);
    expect(changed).toBe(true);
    // One of {a, b} should be resolved to X
    const aResolved = a.candidates.size === 1 && a.candidates.has("X");
    const bResolved = b.candidates.size === 1 && b.candidates.has("X");
    expect(aResolved || bResolved).toBe(true);
  });

  it("does not fire when card spans containers", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p2", "X", "Y");
    expect(hiddenSinglesPerContainer([a, b], containerOf)).toBe(false);
  });

  it("picks smallest candidate set as resolution target (tiebreak)", () => {
    // X appears in two slots of p1: a (3 candidates), b (2 candidates).
    // Should resolve `b` (smaller candidate set).
    const a = slot("p1", "X", "Y", "Z");
    const b = slot("p1", "X", "Y");
    const c = slot("p2", "Y", "Z");
    hiddenSinglesPerContainer([a, b, c], containerOf);
    expect([...b.candidates]).toEqual(["X"]);
    expect([...a.candidates]).toEqual(["X", "Y", "Z"]);
  });

  it("does not commit in ordered containers (deduction unsound when position is observable)", () => {
    // X only in container "deck". All 3 deck slots have X.
    // With deck marked ordered, no slot gets committed — candidates remain unchanged.
    const a = slot("deck", "X", "Y");
    const b = slot("deck", "X", "Y");
    const c = slot("deck", "X", "Y");
    const isOrdered = (c: string): boolean => c === "deck";
    const changed = hiddenSinglesPerContainer([a, b, c], containerOf, isOrdered);
    expect(changed).toBe(false);
    expect(a.candidates.size).toBe(2);
    expect(b.candidates.size).toBe(2);
    expect(c.candidates.size).toBe(2);
  });

  it("commits in unordered containers but skips ordered ones in the same pass", () => {
    // X only in "deck" (ordered) — must NOT be committed.
    // Y only in "hand" (unordered) — must be committed to b or c.
    const a = slot("deck", "X");
    const b = slot("hand", "Y", "Z");
    const c = slot("hand", "Y", "Z");
    const isOrdered = (cid: string): boolean => cid === "deck";
    hiddenSinglesPerContainer([a, b, c], containerOf, isOrdered);
    // Deck slot untouched (still {X}; size 1 was already singleton — verify it didn't get rewritten)
    expect([...a.candidates]).toEqual(["X"]);
    // One of b, c must be committed to a unique hand-only name (Y or Z).
    const committedCount = [b, c].filter(s => s.candidates.size === 1).length;
    expect(committedCount).toBeGreaterThanOrEqual(1);
  });

  it("skips a card whose container already has a singleton holding it", () => {
    // X only in container p1, slots a (resolved) and b. Should NOT re-resolve b to {X}.
    // (Other cards Y, Z appear in p2 also, so no other hidden-single fires.)
    const a = slot("p1", "X");
    const b = slot("p1", "X", "Y", "Z");
    const c = slot("p2", "Y", "Z");
    hiddenSinglesPerContainer([a, b, c], containerOf);
    expect([...a.candidates]).toEqual(["X"]);
    // b still has X as a candidate (naked-single is a separate pass)
    expect(b.candidates.has("X")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nakedTuples
// ---------------------------------------------------------------------------

describe("nakedTuples", () => {
  it("naked pair: prunes shared candidates from other placeholders", () => {
    // C1, C2 both have {X, Y}. The pair confines X, Y to themselves.
    // D has {X, Y, Z} — X, Y must be pruned, leaving D = {Z}.
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "X", "Y");
    const d = slot("p2", "X", "Y", "Z");
    const changed = nakedTuples([a, b, d]);
    expect(changed).toBe(true);
    expect([...d.candidates]).toEqual(["Z"]);
    expect([...a.candidates]).toEqual(["X", "Y"]); // untouched
    expect([...b.candidates]).toEqual(["X", "Y"]);
  });

  it("naked pair across containers (the case per-container can't reach)", () => {
    // X, Y in two placeholders across DIFFERENT containers — per-container can't fire.
    // Naked-pair still prunes from third placeholder.
    const alice = slot("hand:Alice", "X", "Y");
    const bob = slot("hand:Bob", "X", "Y");
    const d = slot("deck", "X", "Y", "Z");
    nakedTuples([alice, bob, d]);
    expect([...d.candidates]).toEqual(["Z"]);
  });

  it("naked triple with mixed candidate sizes", () => {
    // Three placeholders with candidates ⊆ {X, Y, Z}: union still has size 3.
    // Should prune X, Y, Z from D.
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "X", "Z");
    const c = slot("p1", "Y", "Z");
    const d = slot("p2", "X", "Y", "Z", "W");
    nakedTuples([a, b, c, d]);
    expect([...d.candidates]).toEqual(["W"]);
  });

  it("does not fire when union size exceeds subset size", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "Y", "Z");
    const d = slot("p2", "X", "Y", "Z", "W");
    expect(nakedTuples([a, b, d])).toBe(false);
  });

  it("naked-N for arbitrary N (e.g. 4)", () => {
    // 4 placeholders with candidates exactly {W, X, Y, Z}; one outsider has W..Z + V.
    const a = slot("p1", "W", "X");
    const b = slot("p1", "X", "Y");
    const c = slot("p1", "Y", "Z");
    const d = slot("p1", "W", "Z");
    const e = slot("p2", "W", "X", "Y", "Z", "V");
    nakedTuples([a, b, c, d, e]);
    expect([...e.candidates]).toEqual(["V"]);
  });

  it("returns false when nothing to prune", () => {
    const a = slot("p1", "X", "Y");
    const b = slot("p1", "X", "Y");
    expect(nakedTuples([a, b])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// propagate driver
// ---------------------------------------------------------------------------

describe("propagate", () => {
  it("alternates rules until fixed-point", () => {
    // a = {X} → naked single eliminates X from b, c, d
    // After: b = {Y, Z}, c = {Y, Z, W}, d = {Y, Z, W}
    // W only in c, d (both p2) → per-container hidden single: one of {c, d} = {W}
    const a = slot("p1", "X");
    const b = slot("p1", "X", "Y", "Z");
    const c = slot("p2", "X", "Y", "Z", "W");
    const d = slot("p2", "X", "Y", "Z", "W");
    propagate([a, b, c, d], { containerOf });
    expect([...a.candidates]).toEqual(["X"]);
    expect(b.candidates.has("X")).toBe(false);
    const cHasW = c.candidates.size === 1 && c.candidates.has("W");
    const dHasW = d.candidates.size === 1 && d.candidates.has("W");
    expect(cHasW || dHasW).toBe(true);
  });

  it("returns false on stable input", () => {
    // Different containers, no singletons, no card unique to any placeholder or container.
    const a = slot("p1", "X", "Y");
    const b = slot("p2", "X", "Y");
    expect(propagate([a, b], { containerOf })).toBe(false);
  });

  it("returns true when any rule fires", () => {
    const a = slot("p1", "X");
    const b = slot("p2", "X", "Y");
    expect(propagate([a, b], { containerOf })).toBe(true);
  });

  it("mutates candidates Sets in place (caller's reference sees changes)", () => {
    const candidatesA = new Set(["X"]);
    const candidatesB = new Set(["X", "Y"]);
    const a: TestSlot = { container: "p1", candidates: candidatesA };
    const b: TestSlot = { container: "p1", candidates: candidatesB };
    propagate([a, b], { containerOf });
    // Caller's Set references must still be the same instances
    expect(a.candidates).toBe(candidatesA);
    expect(b.candidates).toBe(candidatesB);
    // And reflect the propagation
    expect([...candidatesB]).toEqual(["Y"]);
  });

  it("is idempotent on already-stable input", () => {
    const a = slot("p1", "X");
    const b = slot("p1", "Y");
    propagate([a, b], { containerOf });
    expect(propagate([a, b], { containerOf })).toBe(false);
  });
});
