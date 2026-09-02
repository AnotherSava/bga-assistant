// @vitest-environment jsdom
// Tests for playerPanelsFunction: the ISOLATED-world mount behind Nucleum's compact player panels.
// The fold itself is CSS, so what is tested here is the one thing the function decides — which
// boards get the class the stylesheet hangs off — plus the stylesheet's own scoping, which jsdom
// lays out too little to catch by rendering.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { playerPanelsFunction } from "../games/nucleum/player_panels.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const CLASS = "bgaa-compact-panels";

const ENABLED = { enabled: true };
const DISABLED = { enabled: false };

/** BGA puts the game's own class on the page wrapper. */
function buildBoard(game: string): void {
  document.documentElement.className = "";
  document.body.innerHTML = `
    <div id="leftright_page_wrapper" class="bgagame-${game}">
      <div id="right-side"><div id="right-side-first-part"><div id="player_boards">
        <div class="player-board"><div class="player_board_content"><div class="player_score">
          <div>1</div><span class="player_score_value">18</span>
        </div></div><div class="player-board-game-specific-content">
          <div class="counterWrapper"><div class="res"></div><div id="worker-counter-1">3</div>
            <div class="counterWrapper">(<div id="workerSupply-counter-1">11</div>)</div>
          </div>
          <div class="counterWrapper"><div class="res"></div><div id="thaler-counter-1">12</div></div>
        </div></div>
      </div></div></div>
    </div>`;
}

/** A frame that is not a board at all — the /tableview shell, or a loader frame. */
function buildShell(): void {
  document.documentElement.className = "";
  document.body.innerHTML = '<div id="shell"></div>';
}

function marked(): boolean {
  return document.documentElement.classList.contains(CLASS);
}

beforeEach(() => {
  buildBoard("nucleum");
});

describe("playerPanelsFunction", () => {
  it("is exported and can be serialized by executeScript", () => {
    expect(typeof playerPanelsFunction).toBe("function");
    expect(playerPanelsFunction.name).toBe("playerPanelsFunction");
  });

  it("marks a Nucleum board", () => {
    playerPanelsFunction(ENABLED);
    expect(marked()).toBe(true);
  });

  it("leaves every other game's board alone", () => {
    // `.counterWrapper` and `.res` are Nucleum's own markup, not BGA framework — the rules would
    // land on whatever another game happened to name the same way.
    buildBoard("innovation");
    playerPanelsFunction(ENABLED);
    expect(marked()).toBe(false);
  });

  it("does nothing in a frame that holds no board", () => {
    buildShell();
    playerPanelsFunction(ENABLED);
    expect(marked()).toBe(false);
  });

  it("unmarks on the way out", () => {
    playerPanelsFunction(ENABLED);
    playerPanelsFunction(DISABLED);
    expect(marked()).toBe(false);
  });

  it("unmarks a frame whatever board it turned out to hold", () => {
    // The game check sits after the disable branch on purpose: a tab that navigated from Nucleum to
    // another game would otherwise keep the class, and with it a stylesheet already in the document.
    playerPanelsFunction(ENABLED);
    buildBoard("innovation");
    document.documentElement.classList.add(CLASS);
    playerPanelsFunction(DISABLED);
    expect(marked()).toBe(false);
  });

  it("marks the first player's panel with a wedge, and titles it", () => {
    playerPanelsFunction(ENABLED);
    const wedge = document.querySelector(".bgaa-first-player");
    expect(wedge).not.toBeNull();
    expect(wedge!.closest(".player-board")).not.toBeNull();
    // A real element rather than a `::before`: a pseudo-element takes no attributes, so it could
    // carry no tooltip.
    expect((wedge as HTMLElement).title).toContain("First player");
  });

  it("clears a stale wedge before marking, so repeated pushes leave one", () => {
    // This runs again on every navigation and every settings change.
    playerPanelsFunction(ENABLED);
    playerPanelsFunction(ENABLED);
    playerPanelsFunction(ENABLED);
    expect(document.querySelectorAll(".bgaa-first-player")).toHaveLength(1);
  });

  it("moves the wedge when a rebuild puts a different player first", () => {
    playerPanelsFunction(ENABLED);
    const before = document.querySelector(".bgaa-first-player")!.closest(".player-board");
    // BGA rebuilds the panels; the disc is now in the second one.
    document.querySelector(".player_score > div:not([class]):not([id])")!.remove();
    const second = document.createElement("div");
    second.className = "player-board";
    second.innerHTML = '<div class="player_score"><div>1</div></div>';
    document.querySelector("#player_boards")!.appendChild(second);
    playerPanelsFunction(ENABLED);

    const after = document.querySelector(".bgaa-first-player")!.closest(".player-board");
    expect(document.querySelectorAll(".bgaa-first-player")).toHaveLength(1);
    expect(after).toBe(second);
    expect(after).not.toBe(before);
  });

  it("takes the wedge away on the way out", () => {
    playerPanelsFunction(ENABLED);
    playerPanelsFunction(DISABLED);
    expect(document.querySelector(".bgaa-first-player")).toBeNull();
  });

  it("marks nobody when BGA shows no first-player disc", () => {
    document.querySelector(".player_score > div:not([class]):not([id])")!.remove();
    playerPanelsFunction(ENABLED);
    expect(document.querySelector(".bgaa-first-player")).toBeNull();
    // The rest of the fold still applies.
    expect(marked()).toBe(true);
  });

  it("is idempotent across overlapping injections", () => {
    playerPanelsFunction(ENABLED);
    playerPanelsFunction(ENABLED);
    expect(document.documentElement.className.split(/\s+/).filter(c => c === CLASS)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Styling contract
// ---------------------------------------------------------------------------

describe("compact player panels stylesheet", () => {
  const css = readFileSync(resolve(thisDir, "../games/nucleum/player_panels.css"), "utf-8");
  /** Selectors only — the comments name the very patterns these guards forbid. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = rules.split("}").map(block => block.split("{")[0].trim()).filter(Boolean);
  /** [selector, declarations] per rule, so a guard can name the rules it applies to. */
  const parsed = rules.split("}").map(b => b.split("{")).filter(p => p.length === 2).map(([s, decls]) => [s.trim(), decls] as const);

  it("scopes every rule to the mount's class", () => {
    // Injected into BGA's own document, where an unscoped `.res` or `.counterWrapper` would reach
    // whatever else names them that way. The class is only ever added on a Nucleum board.
    expect(selectors.length).toBeGreaterThan(2);
    for (const selector of selectors) {
      for (const alternative of selector.split(",")) {
        expect(alternative.trim().startsWith("html.bgaa-compact-panels ")).toBe(true);
      }
    }
  });

  it("outweighs BGA's inline styles exactly where they collide, and nowhere else", () => {
    // BGA builds the first-player disc entirely from inline styles and writes
    // `background-position-x`/`-y` inline on every `.res`. An inline declaration beats any author
    // rule whatever its specificity, so those two need `!important` — and only those two. Every
    // other property this sheet sets is absent from BGA's inline styles, and marking one anyway
    // would make the sheet harder to reason about the next time BGA moves something.
    const important = [...rules.matchAll(/^\s*([a-z-]+)\s*:[^;]*!important;/gm)].map(m => m[1]);
    expect(important.sort()).toEqual(["background-position", "background-position", "display"]);
  });

  it("hides the beginner notice without taking its container with it", () => {
    // The notice costs 52px of a 74px panel and repeats all game. The status block holding it is BGA
    // framework and carries other things at other times, so it stays — but its own margins would
    // outlive an empty child, and only while the notice is all it holds.
    expect(rules).toContain(".doubletime_infos {");
    expect(rules).toContain(".player_table_status:has(> .doubletime_infos:only-child)");
    // Never the container itself, which would take unrelated statuses with it.
    expect(rules).not.toMatch(/\.player_table_status\s*\{/);
  });

  it("hides BGA's first-player disc rather than leaving both marks up", () => {
    // Hidden, never removed: it carries no class and no id, so it is the only handle the mount has
    // on that player. The mount reads it to place the wedge.
    expect(rules).toContain(".player_score > div:not([class]):not([id]) {");
    const disc = rules.slice(rules.indexOf(".player_score > div"));
    expect(disc.slice(0, disc.indexOf("}"))).toContain("display: none");
  });

  it("draws the wedge without costing any layout, and lets it be hovered", () => {
    // A permanent mark on one panel must not push the other panels around — and it has to take
    // pointer events, or its tooltip could never open.
    const wedge = rules.slice(rules.indexOf(".bgaa-first-player"));
    const decls = wedge.slice(0, wedge.indexOf("}"));
    expect(decls).toContain("position: absolute");
    expect(decls).toContain("clip-path: polygon(0 0, 100% 0, 0 100%)");
    expect(decls).toContain("cursor: help");
    expect(decls).not.toContain("pointer-events: none");
  });

  it("hides the worker reserve by its nesting, so the parentheses go with it", () => {
    // `( 11 )` is a counter nested in the workers' own, with the brackets as its text nodes.
    expect(rules).toContain(".counterWrapper .counterWrapper");
  });

  it("sizes the counters by zoom, never by the icons' own box", () => {
    // The four `.res` tiles position their sprite in percentages and survive a resized box; the
    // network counter positions its own in pixels against a percentage `background-size`, so
    // shrinking that box rescales the sheet under a fixed offset and lands on the wrong tile.
    // `zoom` leaves every value BGA authored alone and scales what is drawn.
    expect(rules).toContain("zoom: 0.57");
    for (const [selector, decls] of parsed) {
      if (!/\.res|\.networkCounter|\.counterWrapper/.test(selector)) continue;
      expect(decls).not.toMatch(/\bwidth:/);
      expect(decls).not.toMatch(/\bheight:/);
    }
  });

  it("leaves every icon at the box's own size, with nothing rescaling one against another", () => {
    // BGA's tiles fill their cell edge to edge and the two drawn here are built to fill theirs, so
    // all five come out the same height with no per-icon correction to keep in step. A `transform`
    // or a bespoke width would be that correction coming back.
    expect(rules).not.toMatch(/transform:/);
  });

  it("draws the two icons whose detail BGA loses at this size, filling the box so a frame survives", () => {
    expect(rules).toContain('.res:has(+ [id^="contracts-counter"])');
    expect(rules).toContain('.res:has(+ [id^="achievement-counter"])');
    // Both drawn icons scale to the box rather than sitting inside it.
    expect(rules.match(/background-size: contain/g) ?? []).toHaveLength(2);
  });

  it("puts a corner mark at each corner of the contract's inner rule, mirrored not translated", () => {
    // The mistake this guards is translating the top-left mark instead of mirroring it: the
    // right-hand pair then starts at the rule and runs outward, filling the gutter and welding the
    // inner rule to the outer frame, and the bottom pair's arm floats clear of the rule it should
    // thicken. Every subpath must start at a corner of the inner rule and turn inward.
    const card = rules.slice(rules.indexOf('[id^="contracts-counter"]'));
    const filigree = /%3Cpath fill='%23b9a582' d='([^']+)'/.exec(card);
    expect(filigree).not.toBeNull();

    const subpaths = filigree![1].split("M").filter(Boolean);
    expect(subpaths).toHaveLength(4);
    // The inner rule is `rect x=5.5 y=3.8 w=13 h=16.4`, so its corners are these four.
    const anchors = subpaths.map(sp => sp.trim().split(/[a-zA-Z]/)[0].trim()).sort();
    expect(anchors).toEqual(["18.5 20.2", "18.5 3.8", "5.5 20.2", "5.5 3.8"]);

    // And nothing may stray outside the rule it decorates, which is what the outward run did.
    for (const value of filigree![1].matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/g)) {
      expect(Number(value[1])).toBeLessThanOrEqual(20.2);
    }
  });

  it("keeps the contract frame and makes only the tick green", () => {
    // The frame is what says "contract"; the gold ring is what merges with the gold tick at 20px.
    const card = rules.slice(rules.indexOf('[id^="contracts-counter"]'));
    expect(card).toContain("%233f9142");
    // Outer edge, inner rule and a mark at each corner — BGA's arrangement, engraving removed.
    expect((card.match(/%3Crect/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("draws the achievement star itself, matched by the counter it labels", () => {
    // BGA bakes a heavy black disc into that sprite tile and the sheet has no bare-star tile, so
    // dropping the disc means supplying the glyph. Matched by sibling id rather than by position,
    // so a sixth counter could not shift it onto the wrong icon.
    expect(rules).toContain('.res:has(+ [id^="achievement-counter"])');
    expect(rules).toContain("background-image: url(\"data:image/svg+xml,");
  });

  it("references no url() that a host page could resolve, data: URIs aside", () => {
    // Chrome resolves relative URLs in injected CSS against the host page, so a relative one would
    // 404 against boardgamearena.com. A `data:` URI resolves to itself and is safe.
    //
    // Whole `url("data:…")` tokens come out first rather than being tested one by one: the SVG
    // payload has a `url(%23s)` of its own pointing at its gradient, which is not a CSS URL at all.
    const withoutDataUris = rules.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/g, "");
    expect(withoutDataUris).not.toContain("url(");
  });
});
