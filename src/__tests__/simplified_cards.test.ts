// @vitest-environment jsdom
// Tests for simplifiedCardsFunction: the MAIN-world patch that swaps Innovation's table cards
// between BGA's illustrated ones and the side panel's compact ones. Exercises the real contract
// against a stand-in for the parts of `gameui` the layout is derived from.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { simplifiedCardsFunction } from "../games/innovation/simplified_cards.js";

const ENABLED = { enabled: true, scale: 100 };
const DISABLED = { enabled: false, scale: 100 };

const ROOT_CLASS = "bgaa-simplified-cards";

/** BGA's own numbers, as Innovation ships them. */
const BGA_CARD = { width: 182, height: 126 };
const BGA_HAND_DELTA = { x: 189, y: 133 };
const BGA_SPLAY = { compact: 3, expanded: 52 };

interface FakeGameui {
  card_dimensions: Record<string, { width: number; height: number }>;
  delta: Record<string, { x: number; y: number }>;
  overlap_for_splay: Record<string, { compact: number; expanded: number }>;
  zone?: { board: Record<string, unknown> };
  refreshLayout: () => void;
  [key: string]: unknown;
}

/** A `gameui` carrying only what the layout patch reads. `withZones` false stands in for the
 *  window between the frame loading and Innovation's setup building its zones. */
function fakeGameui(withZones: boolean = true): FakeGameui {
  const gameui: FakeGameui = {
    card_dimensions: { "M card": { ...BGA_CARD }, "S recto": { width: 33, height: 47 } },
    delta: { my_hand: { ...BGA_HAND_DELTA }, score: { x: 35, y: 49 } },
    overlap_for_splay: { "M card": { ...BGA_SPLAY } },
    refreshLayout: vi.fn(),
    // BGA's card database, and the parser it reads a card id back out of an element id with.
    cards: { 42: { name: "Code of Laws" } } as Record<number, { name: string }>,
    getCardIdFromHTMLId: (htmlId: string) => parseInt(htmlId.split("__")[0].substr(5)),
  };
  if (withZones) gameui.zone = { board: { "1234": {} } };
  return gameui;
}

function setGameui(gameui: FakeGameui | undefined): void {
  (globalThis as unknown as { gameui?: FakeGameui }).gameui = gameui;
}

/** The marker BGA writes on the layout wrapper of an Innovation board, plus the two zone kinds. */
function buildInnovationBoard(): void {
  document.body.innerHTML = '<div id="leftright_page_wrapper" class="bgagame-innovation"></div><div id="hand_1234"></div><div id="board_1234_0"></div>';
}

/** A card as BGA builds it: the id it parses the card id back out of, and an uppercased title. */
function addCard(zoneId: string, cardId: number, title: string): void {
  const card = document.createElement("div");
  card.id = `item_${cardId}__age_1__type_0__is_relic_0__M__card`;
  card.className = `item_${cardId} age_1 type_0 M card color_0`;
  card.innerHTML = `<div class="card_title M type_0"><span class="font_size_11">${title}</span></div>`;
  document.getElementById(zoneId)!.appendChild(card);
}

function cardTitle(zoneId: string): string | null {
  return document.querySelector(`#${zoneId} .card_title > span`)!.textContent;
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-bgaa-cards-on");
  document.documentElement.removeAttribute("data-bgaa-cards-watch");
  document.documentElement.style.removeProperty("--bgaa-card-scale");
  document.body.innerHTML = "";
  setGameui(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("simplifiedCardsFunction frame targeting", () => {
  it("does nothing outside an Innovation board frame", () => {
    // Every frame of the tab receives the injection — the /tableview shell, the loader, and any
    // other game's board. Only Innovation's carries the marker.
    document.body.innerHTML = '<div id="leftright_page_wrapper" class="bgagame-arknova"></div>';
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);

    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
    expect(gameui.refreshLayout).not.toHaveBeenCalled();
  });
});

describe("simplifiedCardsFunction patching", () => {
  beforeEach(buildInnovationBoard);

  it("shrinks the card box and hands the relayout back to BGA", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);

    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(true);
    expect(gameui.card_dimensions["M card"]).toEqual({ width: 94, height: 47 });
    expect(gameui.delta.my_hand).toEqual({ x: 101, y: 54 });
    expect(gameui.overlap_for_splay["M card"]).toEqual({ compact: 3, expanded: 26 });
    expect(gameui.refreshLayout).toHaveBeenCalledTimes(1);
  });

  it("leaves the other zone sizes alone", () => {
    // Only the one size key Innovation draws hands and boards at is rebuilt; the face-down card
    // zones keep theirs.
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);

    expect(gameui.card_dimensions["S recto"]).toEqual({ width: 33, height: 47 });
    expect(gameui.delta.score).toEqual({ x: 35, y: 49 });
  });

  it("puts BGA's own numbers back when switched off", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(DISABLED);

    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
    expect(gameui.delta.my_hand).toEqual(BGA_HAND_DELTA);
    expect(gameui.overlap_for_splay["M card"]).toEqual(BGA_SPLAY);
    expect(gameui.refreshLayout).toHaveBeenCalledTimes(2);
  });

  it("still restores BGA's numbers after repeated enabling injections", () => {
    // Regression guard: stashing on every injection rather than only the first would park the
    // already-patched values and leave nothing able to bring BGA's own back.
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(DISABLED);

    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
    expect(gameui.delta.my_hand).toEqual(BGA_HAND_DELTA);
    expect(gameui.overlap_for_splay["M card"]).toEqual(BGA_SPLAY);
  });

  it("scales BGA's layout constants by the size slider", () => {
    // 200%: the card doubles, the hand gutter with it, and the splay strip too — the strips and the
    // icons they reveal have to grow together or a covered card stops showing the right one.
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 200 });

    expect(gameui.card_dimensions["M card"]).toEqual({ width: 186, height: 92 });
    expect(gameui.delta.my_hand).toEqual({ x: 200, y: 106 });
    expect(gameui.overlap_for_splay["M card"]).toEqual({ compact: 3, expanded: 52 });
  });

  it("publishes the multiplier for the stylesheet to derive its lengths from", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 150 });
    expect(document.documentElement.style.getPropertyValue("--bgaa-card-scale")).toBe("1.5");

    simplifiedCardsFunction(DISABLED);
    expect(document.documentElement.style.getPropertyValue("--bgaa-card-scale")).toBe("");
  });

  it("restates the size on a slider-only change, without re-stashing", () => {
    // Dragging the slider re-injects with the feature already on. The originals must survive that,
    // and the new size must actually reach BGA rather than being skipped as "already enabled".
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 100 });
    simplifiedCardsFunction({ enabled: true, scale: 200 });

    expect(gameui.card_dimensions["M card"]).toEqual({ width: 186, height: 92 });
    expect(document.documentElement.style.getPropertyValue("--bgaa-card-scale")).toBe("2");

    simplifiedCardsFunction(DISABLED);
    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
  });

  it("puts card names back in the case they were written in", () => {
    // BGA uppercases the name into the markup, so the only mixed-case copy left is on gameui.cards.
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("hand_1234", 42, "CODE OF LAWS");

    simplifiedCardsFunction(ENABLED);

    expect(cardTitle("hand_1234")).toBe("Code of Laws");
  });

  it("hands the uppercase names back when switched off", () => {
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("hand_1234", 42, "CODE OF LAWS");

    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(DISABLED);

    expect(cardTitle("hand_1234")).toBe("CODE OF LAWS");
  });

  it("renames cards on the boards as well as in hand", () => {
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("board_1234_0", 42, "CODE OF LAWS");

    simplifiedCardsFunction(ENABLED);

    expect(cardTitle("board_1234_0")).toBe("Code of Laws");
  });

  it("leaves a card it has no data for alone", () => {
    // A relic or a card from an expansion this build does not know must not be blanked out.
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("hand_1234", 999, "SOMETHING ELSE");

    simplifiedCardsFunction(ENABLED);

    expect(cardTitle("hand_1234")).toBe("SOMETHING ELSE");
  });

  it("is inert when switched off without ever having been on", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction(DISABLED);

    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
  });
});

describe("simplifiedCardsFunction waiting for setup", () => {
  beforeEach(() => {
    buildInnovationBoard();
    vi.useFakeTimers();
  });

  it("waits for Innovation to build its zones", () => {
    // The injection fires when the frame reports loaded, which is before setup has run.
    const gameui = fakeGameui(/*withZones=*/ false);
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);
    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);

    gameui.zone = { board: { "1234": {} } };
    vi.advanceTimersByTime(300);

    expect(gameui.card_dimensions["M card"]).toEqual({ width: 94, height: 47 });
    expect(gameui.refreshLayout).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than polling for the life of the page", () => {
    // A table watched as a spectator of a game that never starts would otherwise keep this running.
    const gameui = fakeGameui(/*withZones=*/ false);
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);
    vi.advanceTimersByTime(61000);
    expect(document.documentElement.hasAttribute("data-bgaa-cards-watch")).toBe(false);

    gameui.zone = { board: { "1234": {} } };
    vi.advanceTimersByTime(5000);
    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
  });

  it("applies the newest intent, not the one the wait started with", () => {
    // Switching off while the board is still loading must not be overtaken by the pending retry
    // that was started to switch it on.
    const gameui = fakeGameui(/*withZones=*/ false);
    setGameui(gameui);

    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(DISABLED);

    gameui.zone = { board: { "1234": {} } };
    vi.advanceTimersByTime(300);

    expect(gameui.card_dimensions["M card"]).toEqual(BGA_CARD);
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
  });
});
