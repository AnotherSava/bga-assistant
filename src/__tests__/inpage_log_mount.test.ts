// @vitest-environment jsdom
// Tests for inPageLogFunction: the ISOLATED-world mount that renders turn history into BGA's
// game log column. Exercises the real DOM contract against a fixture of BGA's log markup.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { inPageLogFunction } from "../render/inpage_log.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const thisDir = dirname(fileURLToPath(import.meta.url));

const OPTS = { enabled: true, collapsed: false, showPlayerNames: false, halfTurns: 3, hasMore: true };

function row(key: string, text: string) {
  return { key, html: `<div class="turn-action" data-row-key="${key}">${text}</div>` };
}

/** A row carrying a card tooltip, for the hover tests. jsdom implements neither showPopover nor
 *  :popover-open, so those are stubbed per-test; what is exercised here is our own half. */
function cardRow(key: string) {
  return { key, html: `<div class="turn-action" data-row-key="${key}">meld <span class="th-card">Agriculture<div class="card-tip" popover="manual"></div></span></div>` };
}

/** BGA's board-frame log markup: #right-side > #right-side-second-part > #logs_wrap > #logs. */
function buildBgaLogDom(): void {
  document.documentElement.className = "";
  document.body.innerHTML = `
    <div id="right-side">
      <div id="right-side-second-part">
        <div id="logs_wrap">
          <div id="chatinput"></div>
          <div id="logs">
            <div class="log notif_simpleNote" id="log_2"><div class="roundedbox">newest</div></div>
            <div class="log notif_simpleNote" id="log_1"><div class="roundedbox">oldest</div></div>
          </div>
          <div id="seemorelogs"></div>
        </div>
      </div>
    </div>`;
}

function rowsContainer(): HTMLElement {
  return document.getElementById("bgaa-inpage-log-rows")!;
}

function renderedKeys(): string[] {
  return Array.from(rowsContainer().children).map(el => el.getAttribute("data-row-key")!);
}

beforeEach(() => {
  buildBgaLogDom();
  (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } };
});

describe("inPageLogFunction mounting", () => {
  it("bails silently when #logs_wrap is absent", () => {
    document.body.innerHTML = "<div id='something-else'></div>";
    expect(() => inPageLogFunction([row("a", "x")], OPTS)).not.toThrow();
    expect(document.getElementById("bgaa-inpage-log")).toBeNull();
  });

  it("mounts as a sibling before #logs, never inside it", () => {
    inPageLogFunction([row("a", "x")], OPTS);
    const container = document.getElementById("bgaa-inpage-log")!;
    const logs = document.getElementById("logs")!;
    expect(container.parentElement!.id).toBe("logs_wrap");
    expect(logs.contains(container)).toBe(false);
    expect(container.compareDocumentPosition(logs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides BGA's log via a root class, leaving #logs untouched", () => {
    inPageLogFunction([row("a", "x")], OPTS);
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(true);
    expect(document.getElementById("logs")!.getAttribute("style")).toBeNull();
  });

  it("removes the container and restores BGA's log when disabled", () => {
    inPageLogFunction([row("a", "x")], OPTS);
    inPageLogFunction([], { ...OPTS, enabled: false });
    expect(document.getElementById("bgaa-inpage-log")).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(false);
    expect(document.getElementById("logs")!.children).toHaveLength(2);
  });

  it("re-mounts after BGA rebuilds the log area", () => {
    inPageLogFunction([row("a", "x")], OPTS);
    buildBgaLogDom();  // BGA replaces the column wholesale
    inPageLogFunction([row("a", "x")], OPTS);
    expect(document.getElementById("bgaa-inpage-log")).not.toBeNull();
    expect(renderedKeys()).toEqual(["a"]);
  });

  it("does not mount twice on repeated calls", () => {
    inPageLogFunction([row("a", "x")], OPTS);
    inPageLogFunction([row("a", "x")], OPTS);
    expect(document.querySelectorAll("#bgaa-inpage-log")).toHaveLength(1);
  });

  it("toggles the player-names class on the container, not on body", () => {
    inPageLogFunction([row("a", "x")], { ...OPTS, showPlayerNames: true });
    expect(document.getElementById("bgaa-inpage-log")!.classList.contains("show-player-names")).toBe(true);
    expect(document.body.classList.contains("show-player-names")).toBe(false);
  });
});

describe("inPageLogFunction reconcile", () => {
  it("renders rows in order", () => {
    inPageLogFunction([row("a", "1"), row("b", "2"), row("c", "3")], OPTS);
    expect(renderedKeys()).toEqual(["a", "b", "c"]);
  });

  it("preserves node identity for unchanged rows", () => {
    inPageLogFunction([row("a", "1"), row("b", "2")], OPTS);
    const before = rowsContainer().children[0];
    inPageLogFunction([row("a", "1"), row("b", "2")], OPTS);
    expect(rowsContainer().children[0]).toBe(before);
  });

  it("keeps existing nodes when a new row is prepended (newest-first growth)", () => {
    inPageLogFunction([row("a", "1"), row("b", "2")], OPTS);
    const oldA = rowsContainer().children[0];
    inPageLogFunction([row("new", "0"), row("a", "1"), row("b", "2")], OPTS);
    expect(renderedKeys()).toEqual(["new", "a", "b"]);
    expect(rowsContainer().children[1]).toBe(oldA);
  });

  it("drops rows that fall out of the window", () => {
    inPageLogFunction([row("a", "1"), row("b", "2"), row("c", "3")], OPTS);
    inPageLogFunction([row("a", "1"), row("b", "2")], OPTS);
    expect(renderedKeys()).toEqual(["a", "b"]);
  });

  it("replaces a row whose content changed under a stable key", () => {
    // A "pending" placeholder resolving into a real action keeps its log position.
    inPageLogFunction([row("a", "pending")], OPTS);
    inPageLogFunction([row("a", "meld Agriculture")], OPTS);
    expect(rowsContainer().children).toHaveLength(1);
    expect(rowsContainer().textContent).toContain("meld Agriculture");
    expect(rowsContainer().textContent).not.toContain("pending");
  });

  it("reorders rows without duplicating them", () => {
    inPageLogFunction([row("a", "1"), row("b", "2"), row("c", "3")], OPTS);
    inPageLogFunction([row("c", "3"), row("a", "1"), row("b", "2")], OPTS);
    expect(renderedKeys()).toEqual(["c", "a", "b"]);
    expect(rowsContainer().children).toHaveLength(3);
  });

  it("clears all rows when given an empty list", () => {
    inPageLogFunction([row("a", "1"), row("b", "2")], OPTS);
    inPageLogFunction([], OPTS);
    expect(rowsContainer().children).toHaveLength(0);
  });

  it("leaves the header intact across reconciles", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    inPageLogFunction([row("b", "2")], OPTS);
    expect(document.getElementById("bgaa-inpage-log-header")).not.toBeNull();
  });
});

describe("inPageLogFunction header controls", () => {
  it("asks the background to widen the window", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    const earlier = document.querySelector<HTMLButtonElement>("#bgaa-inpage-log-earlier")!;
    earlier.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "setInPageLog", patch: { halfTurns: 6 } });
  });

  it("switches to BGA's log without disabling the feature", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    document.querySelector<HTMLButtonElement>("#bgaa-inpage-log-view")!.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "setInPageLog", patch: { collapsed: true } });
  });

  it("switches back to the turn history from the collapsed state", () => {
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    document.querySelector<HTMLButtonElement>("#bgaa-inpage-log-view")!.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "setInPageLog", patch: { collapsed: false } });
  });
});

describe("inPageLogFunction stale-closure guard", () => {
  it("widens from the current window, not the one captured at mount", () => {
    inPageLogFunction([row("a", "1")], { ...OPTS, halfTurns: 3 });
    // A later push raises the window; the listener was attached on the first push only.
    inPageLogFunction([row("a", "1")], { ...OPTS, halfTurns: 12 });
    document.querySelector<HTMLButtonElement>("#bgaa-inpage-log-earlier")!.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "setInPageLog", patch: { halfTurns: 15 } });
  });
});

describe("inPageLogFunction collapsed view", () => {
  it("shows BGA's log and keeps the switch-back control mounted", () => {
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(false);
    expect(document.getElementById("bgaa-inpage-log")).not.toBeNull();
    expect(document.getElementById("bgaa-inpage-log-view")).not.toBeNull();
  });

  it("labels the control by what it switches to", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.getElementById("bgaa-inpage-log-view")!.title).toBe("Show BGA's log");
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.getElementById("bgaa-inpage-log-view")!.title).toBe("Show turn history");
  });

  it("reflects the current state on the bulb, not the target state", () => {
    // The icon is lit while our log is up, matching the toolbar icon's own metaphor.
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.getElementById("bgaa-inpage-log-view")!.getAttribute("aria-pressed")).toBe("true");
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.getElementById("bgaa-inpage-log-view")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("carries an accessible name, since the control is icon-only", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    const view = document.getElementById("bgaa-inpage-log-view")!;
    expect(view.getAttribute("aria-label")).toBe("Show BGA's log");
    expect(view.textContent).toBe("");
  });

  it("puts the window control after the rows, not in the header", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    const earlier = document.getElementById("bgaa-inpage-log-earlier")!;
    expect(earlier.textContent).toBe("more...");
    expect(earlier.parentElement!.id).toBe("bgaa-inpage-log-footer");
    const rows = rowsContainer();
    // Newest-first, so the oldest rows are at the bottom — the control belongs below them.
    expect(rows.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows exactly one log at a time", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(true);
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(false);
  });

  it("round-trips between the two views", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(true);
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(false);
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.documentElement.classList.contains("bgaa-hide-bga-log")).toBe(true);
  });

  it("keeps rows in the DOM while collapsed so switching back is instant", () => {
    inPageLogFunction([row("a", "1"), row("b", "2")], { ...OPTS, collapsed: true });
    expect(rowsContainer().children).toHaveLength(2);
    expect(document.getElementById("bgaa-inpage-log")!.classList.contains("collapsed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Styling contract
// ---------------------------------------------------------------------------

describe("in-page log stylesheet", () => {
  const css = readFileSync(resolve(thisDir, "../render/inpage_log.css"), "utf-8");
  /** Selectors only — comments mention the very patterns these guards forbid. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("never applies an all:unset reset to header buttons", () => {
    // `#bgaa-inpage-log-header button { all: unset }` is (1,0,1) and resets every property,
    // out-specifying the bulb's own id rule (1,0,0) and leaving a zero-size, image-less button
    // — invisible, since the control has no text. jsdom does not implement `all: unset`, so
    // this cannot be caught by rendering; it is asserted structurally instead.
    expect(rules).not.toMatch(/#bgaa-inpage-log-header button/);
  });

  it("lets rows wrap, since BGA's column is far narrower than the panel overlay", () => {
    // The shared stylesheet sets `white-space: nowrap` for the panel's floating overlay; left
    // as-is, every row is clipped by the right edge of BGA's log column.
    expect(css).toContain("#bgaa-inpage-log .turn-action");
    expect(css).toContain("white-space: normal;");
  });

  it("distinguishes the bulb states by colour only, so the glyph cannot shift", () => {
    expect(rules).toContain("#bgaa-inpage-log-view.collapsed { color:");
    // A geometry change between states would read as the icon jumping on every switch.
    const collapsed = rules.slice(rules.indexOf("#bgaa-inpage-log-view.collapsed {"));
    const block = collapsed.slice(0, collapsed.indexOf("}"));
    expect(block).not.toMatch(/width|height|padding|margin|transform/);
  });

  it("keeps the container's padding across the switch, so the bulb does not move", () => {
    // The bulb lives in the header, so any box change on the container shifts the icon —
    // visible as the two states being misaligned when toggling.
    const collapsed = rules.slice(rules.indexOf("#bgaa-inpage-log.collapsed {"));
    const block = collapsed.slice(0, collapsed.indexOf("}"));
    expect(block).not.toMatch(/padding/);
    expect(block).not.toMatch(/margin/);
    expect(block).not.toMatch(/border/);
  });

  it("hides the window control at the end of the history", () => {
    expect(css).toContain("#bgaa-inpage-log.at-end #bgaa-inpage-log-footer { display: none; }");
  });

  it("hides the rows and the window control while collapsed", () => {
    // Lost once to a careless edit: without these the collapsed view still showed our rows
    // over BGA's log.
    expect(css).toContain("#bgaa-inpage-log.collapsed #bgaa-inpage-log-rows,");
    expect(css).toContain("#bgaa-inpage-log.collapsed #bgaa-inpage-log-footer { display: none; }");
  });

  it("right-aligns both the header switch and the footer control", () => {
    expect(css.match(/justify-content: flex-end/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Card tooltips
// ---------------------------------------------------------------------------

describe("card tooltip listeners", () => {
  function stubTip(tip: HTMLElement) {
    let open = false;
    (tip as any).showPopover = vi.fn(() => { open = true; });
    (tip as any).hidePopover = vi.fn(() => { open = false; });
    tip.matches = ((sel: string) => sel === ":popover-open" ? open : Element.prototype.matches.call(tip, sel)) as typeof tip.matches;
    return tip;
  }

  /** jsdom gives every element a zero rect, so anchor geometry is stubbed explicitly. */
  function stubRect(el: Element, rect: Partial<DOMRect>) {
    el.getBoundingClientRect = (() => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect })) as typeof el.getBoundingClientRect;
  }

  it("opens the hovered card's tip", () => {
    inPageLogFunction([cardRow("a")], OPTS);
    const card = document.querySelector(".th-card")!;
    const tip = stubTip(card.querySelector(".card-tip") as HTMLElement);

    card.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect((tip as any).showPopover).toHaveBeenCalled();
  });

  it("closes it when the pointer leaves the card entirely", () => {
    inPageLogFunction([cardRow("a")], OPTS);
    const card = document.querySelector(".th-card")!;
    const tip = stubTip(card.querySelector(".card-tip") as HTMLElement);
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));

    const out = new Event("pointerout", { bubbles: true }) as any;
    out.relatedTarget = document.body;
    card.dispatchEvent(out);

    expect((tip as any).hidePopover).toHaveBeenCalled();
  });

  it("ignores pointer moves within the same card", () => {
    inPageLogFunction([cardRow("a")], OPTS);
    const card = document.querySelector(".th-card")!;
    const tip = stubTip(card.querySelector(".card-tip") as HTMLElement);
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));

    const out = new Event("pointerout", { bubbles: true }) as any;
    out.relatedTarget = tip;  // moving onto a child, still inside the card
    card.dispatchEvent(out);

    expect((tip as any).hidePopover).not.toHaveBeenCalled();
  });

  it("survives a reconcile, since listeners are delegated", () => {
    inPageLogFunction([cardRow("a")], OPTS);
    inPageLogFunction([cardRow("b"), cardRow("a")], OPTS);
    const card = document.querySelectorAll(".th-card")[0];
    const tip = stubTip(card.querySelector(".card-tip") as HTMLElement);

    card.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect((tip as any).showPopover).toHaveBeenCalled();
  });
});

describe("tooltip stylesheet", () => {
  const css = readFileSync(resolve(thisDir, "../render/inpage_log.css"), "utf-8");

  it("does not cancel :hover, which would out-specify the open rule", () => {
    // `.th-card:hover > .card-tip { display: none }` is (0,3,0) and beat the reveal rule,
    // forcing the tip hidden at exactly the moment it was open. The hover reveal it tried to
    // cancel only exists in sidepanel.css, which is never injected into the page.
    expect(css).not.toContain(".th-card:hover");
  });

  it("scopes the open rule above the shared hide rule", () => {
    expect(css).toContain(".th-card > .card-tip:popover-open { display: block; }");
  });

  it("neutralises anchor positioning, which JS placement replaces in-page", () => {
    // Left in place, the anchor insets and try-fallbacks fight the inline coordinates.
    const reset = css.slice(css.indexOf(".card-tip[popover]"));
    expect(reset).toContain("position-anchor: none;");
    expect(reset).toContain("position-try-fallbacks: none;");
    expect(reset).not.toMatch(/^\s*width:/m);
    expect(reset).not.toMatch(/^\s*height:/m);
    // `background:` shorthand would wipe the inline background-image carrying the card face.
    expect(reset).not.toMatch(/^\s*background:/m);
  });
});

describe("card tooltip placement", () => {
  function setup(rect: Partial<DOMRect>) {
    inPageLogFunction([cardRow("a")], OPTS);
    const card = document.querySelector(".th-card")!;
    const tip = card.querySelector(".card-tip") as HTMLElement;
    (tip as any).showPopover = vi.fn();
    (tip as any).hidePopover = vi.fn();
    tip.matches = ((sel: string) => sel === ":popover-open" ? false : Element.prototype.matches.call(tip, sel)) as typeof tip.matches;
    card.getBoundingClientRect = (() => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect })) as typeof card.getBoundingClientRect;
    Object.defineProperty(tip, "offsetWidth", { value: 375, configurable: true });
    Object.defineProperty(tip, "offsetHeight", { value: 275, configurable: true });
    return { card, tip };
  }

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("places the tip just below its card", () => {
    const { card, tip } = setup({ top: 100, bottom: 120, left: 500 });
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(tip.style.top).toBe("124px");
    expect(tip.style.left).toBe("500px");
  });

  it("flips above the card when it would overflow the bottom", () => {
    const { card, tip } = setup({ top: 700, bottom: 720, left: 500 });
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    // 720 + 4 + 275 > 800, so it goes above: 700 - 4 - 275.
    expect(tip.style.top).toBe("421px");
  });

  it("pulls back from the right edge", () => {
    const { card, tip } = setup({ top: 100, bottom: 120, left: 1100 });
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    // 1100 + 375 > 1200, so clamp to 1200 - 375 - 4.
    expect(tip.style.left).toBe("821px");
  });

  it("never positions off the left or top edge", () => {
    const { card, tip } = setup({ top: 2, bottom: 790, left: -50 });
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(parseInt(tip.style.left, 10)).toBeGreaterThanOrEqual(4);
    expect(parseInt(tip.style.top, 10)).toBeGreaterThanOrEqual(4);
  });

  it("positions only after the popover is open, so the tip has a size", () => {
    const { card, tip } = setup({ top: 100, bottom: 120, left: 500 });
    const order: string[] = [];
    (tip as any).showPopover = vi.fn(() => order.push("show"));
    Object.defineProperty(tip.style, "top", {
      set() { order.push("place"); },
      get() { return ""; },
      configurable: true,
    });
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(order).toEqual(["show", "place"]);
  });
});

describe("end of history", () => {
  it("hides the window control once the whole history is shown", () => {
    inPageLogFunction([row("a", "1")], { ...OPTS, hasMore: false });
    const container = document.getElementById("bgaa-inpage-log")!;
    expect(container.classList.contains("at-end")).toBe(true);
  });

  it("shows it again when there is more to reveal", () => {
    inPageLogFunction([row("a", "1")], { ...OPTS, hasMore: false });
    inPageLogFunction([row("a", "1")], OPTS);
    expect(document.getElementById("bgaa-inpage-log")!.classList.contains("at-end")).toBe(false);
  });

  it("uses a class, so the collapsed rule still wins", () => {
    // An inline `display` would override the collapsed rule and show the control in that view.
    inPageLogFunction([row("a", "1")], { ...OPTS, hasMore: true, collapsed: true });
    const footer = document.getElementById("bgaa-inpage-log-footer")!;
    expect(footer.style.display).toBe("");
  });
});

describe("view switch glyph", () => {
  it("renders an inline svg that takes its colour from CSS", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    const view = document.getElementById("bgaa-inpage-log-view")!;
    const svg = view.querySelector("svg");
    expect(svg).not.toBeNull();
    // No text content, so the accessible name has to come from aria-label.
    expect(view.textContent).toBe("");
    expect(view.getAttribute("aria-label")).toBeTruthy();
  });

  it("keeps the same glyph in both states", () => {
    inPageLogFunction([row("a", "1")], OPTS);
    const lit = document.querySelector("#bgaa-inpage-log-view svg")!.innerHTML;
    inPageLogFunction([row("a", "1")], { ...OPTS, collapsed: true });
    expect(document.querySelector("#bgaa-inpage-log-view svg")!.innerHTML).toBe(lit);
  });
});
