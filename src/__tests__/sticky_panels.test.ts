// @vitest-environment jsdom
// Tests for stickyPanelsFunction: the ISOLATED-world mount behind the pinned right column. The
// pinning, and the choice between pinning the whole column and pinning the player panels alone, are
// CSS; what is tested here is what the mount contributes — the offset the pinned block sits under, the
// height ceiling past which the panels are left alone, and the page backdrop copied onto the block.
//
// jsdom lays nothing out, so every height the mount reads is stubbed: element boxes through
// getBoundingClientRect, the viewport through window.innerHeight.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { stickyPanelsFunction } from "../games/innovation/sticky_panels.js";

const thisDir = dirname(fileURLToPath(import.meta.url));

const ENABLED = { enabled: true };
const DISABLED = { enabled: false };

const ROOT_CLASS = "bgaa-sticky-panels";
const TALL_CLASS = "bgaa-panels-tall";

/** BGA's board-frame right column: player panels in the first part, the log column in the second. */
function buildBgaRightColumn(): void {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-bgaa-panels-watch");
  document.body.removeAttribute("style");
  document.body.innerHTML = `
    <div id="topbar" style="position: sticky"><div id="tableinfos">Table #890902538</div></div>
    <div id="leftright_page_wrapper" class="bgagame-innovation">
      <div id="left-side-wrapper"><div id="game_play_area"></div></div>
      <div id="right-side" style="margin-top: 5px">
        <div id="right-side-first-part">
          <div id="player_boards">
            <div id="overall_player_board_1" class="player-board">Alice</div>
            <div id="overall_player_board_2" class="player-board">Bob</div>
          </div>
        </div>
        <div id="right-side-second-part">
          <div id="logs_wrap"><div id="logs"></div></div>
        </div>
      </div>
    </div>`;
}

/** Give an element a height, which jsdom otherwise reports as zero for everything. */
function setHeight(id: string, height: number): void {
  const element = document.getElementById(id)!;
  element.getBoundingClientRect = () => ({ height, width: 240, top: 0, left: 0, right: 240, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
}

function property(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(() => {
  buildBgaRightColumn();
  window.innerHeight = 800;
  setHeight("topbar", 34);
  setHeight("right-side-first-part", 200);
});

// Balance every mount with an unmount, as a real page does when the setting is switched off: the
// resize listener the mount registers outlives the DOM it measured otherwise.
afterEach(() => {
  stickyPanelsFunction(DISABLED);
});

describe("stickyPanelsFunction", () => {
  it("bails silently in frames that are not a game board", () => {
    // The /tableview shell and the loader frame get the injection too, and have no right column.
    document.getElementById("right-side")!.remove();
    expect(() => stickyPanelsFunction(ENABLED)).not.toThrow();
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
  });

  it("pins under a frozen header bar, at the gap BGA already leaves below it", () => {
    stickyPanelsFunction(ENABLED);

    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(false);
    // The bar's 34px plus the column's own 5px top margin. Pinning at the bar's height alone would
    // leave the block to travel that margin before it stuck — visibly nudging once the page moves.
    expect(property("--bgaa-sticky-top")).toBe("39px");
  });

  it("pins at the very top when the bar scrolls away, gap included", () => {
    // BGA's own bar, and the folded one the compact header judged too tall to freeze: both scroll off
    // with the page, so there is nothing left up there to sit under or to keep separation from.
    document.getElementById("topbar")!.style.position = "relative";

    stickyPanelsFunction(ENABLED);

    expect(property("--bgaa-sticky-top")).toBe("0px");
  });

  it("leaves the panels alone when they would take half the screen", () => {
    // A four-player stack on a short window: pinning it walls off the top of the board instead of
    // keeping a reference in view.
    setHeight("right-side-first-part", 420);

    stickyPanelsFunction(ENABLED);

    // Read by the panels-alone mode only: the pinned column of the other one is capped to the window
    // and scrolls inside itself, so height cannot put anything out of reach there.
    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(true);
  });

  it("copies the page's own backdrop onto the block", () => {
    document.documentElement.style.backgroundImage = 'url("felt.jpg")';
    document.documentElement.style.backgroundColor = "rgb(10, 20, 30)";

    stickyPanelsFunction(ENABLED);

    expect(property("--bgaa-panels-backdrop-image")).toBe('url("felt.jpg")');
    expect(property("--bgaa-panels-backdrop-color")).toBe("rgb(10, 20, 30)");
  });

  it("takes the backdrop from body when the root paints nothing", () => {
    // Which of the two carries the table felt is a theme's choice.
    document.documentElement.style.background = "transparent";
    document.body.style.backgroundColor = "rgb(40, 50, 60)";

    stickyPanelsFunction(ENABLED);

    expect(property("--bgaa-panels-backdrop-color")).toBe("rgb(40, 50, 60)");
  });

  it("puts everything back when switched off", () => {
    stickyPanelsFunction(ENABLED);
    setHeight("right-side-first-part", 420);
    stickyPanelsFunction(ENABLED);
    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(true);

    stickyPanelsFunction(DISABLED);

    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(false);
    expect(property("--bgaa-sticky-top")).toBe("");
    expect(property("--bgaa-panels-backdrop-image")).toBe("");
    expect(property("--bgaa-panels-backdrop-color")).toBe("");
  });

  it("re-measures on a window resize", () => {
    stickyPanelsFunction(ENABLED);
    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(false);

    // The panels are unchanged; the window is now short enough that they are past the ceiling.
    window.innerHeight = 300;
    window.dispatchEvent(new Event("resize"));

    expect(document.documentElement.classList.contains(TALL_CLASS)).toBe(true);
  });

  it("keeps a single resize listener across overlapping injections", () => {
    stickyPanelsFunction(ENABLED);
    stickyPanelsFunction(ENABLED);
    expect(document.documentElement.getAttribute("data-bgaa-panels-watch")).toBe("1");

    // The listener stands down on the first event after the feature is switched off, rather than
    // being unregistered from an injection that cannot reach it.
    stickyPanelsFunction(DISABLED);
    window.dispatchEvent(new Event("resize"));

    expect(document.documentElement.hasAttribute("data-bgaa-panels-watch")).toBe(false);
    expect(property("--bgaa-sticky-top")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Styling contract
// ---------------------------------------------------------------------------

describe("pinned column stylesheet", () => {
  const css = readFileSync(resolve(thisDir, "../games/innovation/sticky_panels.css"), "utf-8");
  /** Selectors and declarations only — the comments name the very patterns these guards forbid. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations inside the first rule whose selector contains `needle`. */
  function blockFor(needle: string): string {
    const at = rules.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    const open = rules.indexOf("{", at);
    return rules.slice(open, rules.indexOf("}", open));
  }

  it("suppresses the page's rubber-band under both pinned modes", () => {
    // Chrome drags a stuck sticky element along with the macOS elastic bounce past the top of the
    // page and springs it back — the pinned column visibly unsticking. It is a compositor
    // transform, so `scrollY` stays 0 and no layout assertion can catch it; guarded structurally.
    // Deliberately not borrowed from compact_header.css: that sheet is injected only when the
    // compact header is on, and it drops its own rule once a long prompt makes the bar tall.
    expect(rules).toMatch(/html\.bgaa-sticky-panels\.bgaa-hide-bga-log,\s*html\.bgaa-sticky-panels:not\(\.bgaa-hide-bga-log\):not\(\.bgaa-panels-tall\)\s*\{[^}]*overscroll-behavior-y:\s*none/);
  });

  it("suppresses it inside the pinned column too, which is its own scrollport", () => {
    // With the turn history in it the column scrolls internally and the panels are stuck to *it*,
    // so it has a second rubber-band of its own.
    expect(blockFor("html.bgaa-sticky-panels.bgaa-hide-bga-log #right-side")).toContain("overscroll-behavior-y: none");
  });

  it("never uses `contain`, which stops the chaining but leaves the bounce", () => {
    expect(rules).not.toContain("overscroll-behavior-y: contain");
  });

  it("stays on the vertical axis, so the swipe-back gesture survives", () => {
    // The two-finger back gesture rides the horizontal axis; the unsuffixed shorthand would take it.
    expect(rules).not.toMatch(/overscroll-behavior:/);
    expect(rules).not.toMatch(/overscroll-behavior-x:/);
  });
});
