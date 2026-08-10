// @vitest-environment jsdom
// Tests for actionTintFunction: the MAIN-world mount that tints #topbar when the viewer must act
// during another player's turn. Whose turn it is comes from a faked gameui (seed + live turn states);
// the tint fires only in a reaction state (selectionMove) the viewer does not own.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { actionTintFunction } from "../games/innovation/action_tint.js";

const CLASS = "bgaa-action-required";

interface GameuiOpts { active: boolean; me: string; state: string; stateActive?: string | null; topLevel?: string | null }
function setGameui(o: GameuiOpts): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).gameui = {
    isCurrentPlayerActive: () => o.active,
    player_id: o.me,
    gamedatas: { active_player: o.topLevel ?? null, gamestate: { name: o.state, active_player: o.stateActive ?? null } },
  };
}

function tinted(): boolean {
  return document.documentElement.classList.contains(CLASS);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-bgaa-tint-watch");
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = '<div class="bgagame-innovation"></div>';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__bgaaActionTint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).gameui;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("actionTintFunction", () => {
  it("is exported and can be serialized by executeScript", () => {
    expect(typeof actionTintFunction).toBe("function");
    expect(actionTintFunction.name).toBe("actionTintFunction");
  });

  it("publishes the scroll speed, direction, and pause from the speed setting", () => {
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    const style = document.documentElement.style;

    actionTintFunction({ enabled: true, speed: 3 });
    expect(style.getPropertyValue("--bgaa-tape-play")).toBe("running");
    expect(style.getPropertyValue("--bgaa-tape-direction")).toBe("normal");
    expect(style.getPropertyValue("--bgaa-tape-duration")).toBe("1s");

    actionTintFunction({ enabled: true, speed: -5 }); // fastest, reversed
    expect(style.getPropertyValue("--bgaa-tape-direction")).toBe("reverse");
    expect(style.getPropertyValue("--bgaa-tape-duration")).toBe("0.35s");

    actionTintFunction({ enabled: true, speed: 0 }); // static
    expect(style.getPropertyValue("--bgaa-tape-play")).toBe("paused");

    actionTintFunction({ enabled: false, speed: 0 });
    expect(style.getPropertyValue("--bgaa-tape-play")).toBe("");
  });

  it("tints on opening straight into a pending reaction (owner seeded from the launcher)", () => {
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    expect(tinted()).toBe(true); // seed owner = 200 (launcher) != me → tint at once, no debounce
  });

  it("does not tint on the viewer's own dogma choice (same selectionMove, but they own the turn)", () => {
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "100" });
    actionTintFunction({ enabled: true, speed: 3 });
    expect(tinted()).toBe(false);
  });

  it("does not tint on the viewer's own normal turn", () => {
    setGameui({ active: true, me: "100", state: "playerTurn", stateActive: "100", topLevel: "100" });
    actionTintFunction({ enabled: true, speed: 3 });
    vi.advanceTimersByTime(1000);
    expect(tinted()).toBe(false);
  });

  it("tracks the owner live: a reaction after the opponent's turn tints", () => {
    // The opponent's turn first — establishes the owner from the live turn state.
    setGameui({ active: false, me: "100", state: "playerTurn", stateActive: "200", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    expect(tinted()).toBe(false);
    // Opponent dogmas and forces you: selectionMove, you are active; the owner stays the opponent.
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    vi.advanceTimersByTime(500);
    expect(tinted()).toBe(true);
  });

  it("never tints on your own dogma even if the seed was a stale opponent (the live turn state wins)", () => {
    // The forbidden false-positive the lagging log-owner risked: your turn begins with a dogma while a
    // stale owner still names the opponent. The live turn state must reset the owner to you first.
    setGameui({ active: true, me: "100", state: "playerTurn", stateActive: "100", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 }); // seed = 200, then playerTurn sets owner = 100
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    vi.advanceTimersByTime(1000);
    expect(tinted()).toBe(false);
  });

  it("does not tint when the viewer is not active", () => {
    setGameui({ active: false, me: "100", state: "selectionMove", stateActive: "200", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    vi.advanceTimersByTime(1000);
    expect(tinted()).toBe(false);
  });

  it("bails in a frame that is not an Innovation board", () => {
    document.body.innerHTML = '<div class="bgagame-azul"></div>';
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    vi.advanceTimersByTime(1000);
    expect(tinted()).toBe(false);
    expect(document.documentElement.hasAttribute("data-bgaa-tint-watch")).toBe(false);
  });

  it("tears down and clears its attributes when disabled", () => {
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    expect(tinted()).toBe(true);
    actionTintFunction({ enabled: false, speed: 3 });
    expect(tinted()).toBe(false);
    expect(document.documentElement.hasAttribute("data-bgaa-tint-watch")).toBe(false);
  });

  it("clears the tint the moment the reaction resolves into the viewer's own turn", () => {
    setGameui({ active: true, me: "100", state: "selectionMove", stateActive: "100", topLevel: "200" });
    actionTintFunction({ enabled: true, speed: 3 });
    expect(tinted()).toBe(true);
    setGameui({ active: true, me: "100", state: "playerTurn", stateActive: "100", topLevel: "100" });
    vi.advanceTimersByTime(500);
    expect(tinted()).toBe(false);
  });
});
