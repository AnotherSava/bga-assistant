// @vitest-environment jsdom
// Tests for simplifiedCardsFunction: the MAIN-world patch that swaps Innovation's table cards
// between BGA's illustrated ones and the side panel's compact ones. Exercises the real contract
// against a stand-in for the parts of `gameui` the layout is derived from.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { simplifiedCardsFunction, opponentHandHintsFunction } from "../games/innovation/simplified_cards.js";

const ENABLED = { enabled: true, scale: 100, echoText: false, opponentHands: false };
const DISABLED = { enabled: false, scale: 100, echoText: false, opponentHands: false };
const WITH_HANDS = { enabled: true, scale: 100, echoText: false, opponentHands: true };

const ROOT_CLASS = "bgaa-simplified-cards";

/** BGA's own numbers, as Innovation ships them. */
const BGA_CARD = { width: 182, height: 126 };
const BGA_HAND_DELTA = { x: 189, y: 133 };
const BGA_SPLAY = { compact: 3, expanded: 52 };

interface FakeGameui {
  card_dimensions: Record<string, { width: number; height: number }>;
  delta: Record<string, { x: number; y: number }>;
  overlap_for_splay: Record<string, { compact: number; expanded: number }>;
  zone?: {
    board: Record<string, Record<string, { container_div: string; items: { id: string }[] }>>;
    /** Every player's hand, mine included: BGA tells them apart by the zone's own `location`. */
    hand?: Record<string, Record<string, unknown>>;
  };
  num_cards_in_row?: Record<string, number>;
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

/** The element id BGA gives a card, as `zone.items` records it. */
function cardId(cardNumber: number): { id: string } {
  return { id: `item_${cardNumber}__age_1__type_0__is_relic_0__M__card` };
}

/** Ids of the cards currently crowned as their pile's top card. */
function topCardIds(zoneId: string): string[] {
  return Array.from(document.querySelectorAll(`#${zoneId} [data-bgaa-top]`)).map(el => el.id);
}

function cardTitle(zoneId: string): string | null {
  return document.querySelector(`#${zoneId} .card_title > span`)!.textContent;
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-bgaa-cards-on");
  document.documentElement.removeAttribute("data-bgaa-cards-watch");
  document.documentElement.style.removeProperty("--bgaa-card-scale");
  document.documentElement.classList.remove("bgaa-echo-text");
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
    // The icon band a splay reveals (2px inset + a 20px icon), plus the covered card's own border
    // edge — and no more, or an up splay would show a strip of the icon row above.
    expect(gameui.overlap_for_splay["M card"]).toEqual({ compact: 3, expanded: 23 });
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

    simplifiedCardsFunction({ enabled: true, scale: 200, echoText: false, opponentHands: false });

    expect(gameui.card_dimensions["M card"]).toEqual({ width: 186, height: 92 });
    expect(gameui.delta.my_hand).toEqual({ x: 200, y: 106 });
    // The band doubles; the border edge it opens with does not.
    expect(gameui.overlap_for_splay["M card"]).toEqual({ compact: 3, expanded: 45 });
  });

  it("publishes the multiplier for the stylesheet to derive its lengths from", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 150, echoText: false, opponentHands: false });
    expect(document.documentElement.style.getPropertyValue("--bgaa-card-scale")).toBe("1.5");

    simplifiedCardsFunction(DISABLED);
    expect(document.documentElement.style.getPropertyValue("--bgaa-card-scale")).toBe("");
  });

  it("restates the size on a slider-only change, without re-stashing", () => {
    // Dragging the slider re-injects with the feature already on. The originals must survive that,
    // and the new size must actually reach BGA rather than being skipped as "already enabled".
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 100, echoText: false, opponentHands: false });
    simplifiedCardsFunction({ enabled: true, scale: 200, echoText: false, opponentHands: false });

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

  it("marks the pile's top card from the stack order, not the DOM order", () => {
    // BGA appends a new node to the container and keeps the stack in a separate `items` array, so a
    // tuck — a card melded to the bottom, which Innovation does constantly — is last in the DOM
    // while lying at the bottom of the pile. Reading the DOM would crown the wrong card and hand
    // covered cards the layout that puts the age on the edge a splay reveals.
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("board_1234_0", 1, "FIRST");
    addCard("board_1234_0", 2, "SECOND");
    addCard("board_1234_0", 3, "TUCKED");
    gameui.zone!.board["1234"] = { "0": { container_div: "board_1234_0", items: [cardId(3), cardId(1), cardId(2)] } };

    simplifiedCardsFunction(ENABLED);

    expect(topCardIds("board_1234_0")).toEqual([cardId(2).id]);
  });

  it("re-crowns the pile when a card lands on top of it", () => {
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("board_1234_0", 1, "FIRST");
    gameui.zone!.board["1234"] = { "0": { container_div: "board_1234_0", items: [cardId(1)] } };
    simplifiedCardsFunction(ENABLED);
    expect(topCardIds("board_1234_0")).toEqual([cardId(1).id]);

    addCard("board_1234_0", 2, "MELDED");
    gameui.zone!.board["1234"]["0"].items = [cardId(1), cardId(2)];
    simplifiedCardsFunction(ENABLED);

    expect(topCardIds("board_1234_0")).toEqual([cardId(2).id]);
  });

  it("leaves no card crowned once the feature is switched off", () => {
    const gameui = fakeGameui();
    setGameui(gameui);
    addCard("board_1234_0", 1, "FIRST");
    gameui.zone!.board["1234"] = { "0": { container_div: "board_1234_0", items: [cardId(1)] } };

    simplifiedCardsFunction(ENABLED);
    simplifiedCardsFunction(DISABLED);

    expect(topCardIds("board_1234_0")).toEqual([]);
  });

  it("publishes the echo-text choice as a class for the stylesheet to key on", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 100, echoText: true, opponentHands: false });
    expect(document.documentElement.classList.contains("bgaa-echo-text")).toBe(true);

    // A toggle-only change re-injects with the feature already on, so it must still take effect.
    simplifiedCardsFunction({ enabled: true, scale: 100, echoText: false, opponentHands: false });
    expect(document.documentElement.classList.contains("bgaa-echo-text")).toBe(false);
  });

  it("drops the echo-text class when the cards are switched off", () => {
    const gameui = fakeGameui();
    setGameui(gameui);

    simplifiedCardsFunction({ enabled: true, scale: 100, echoText: true, opponentHands: false });
    simplifiedCardsFunction(DISABLED);

    expect(document.documentElement.classList.contains("bgaa-echo-text")).toBe(false);
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

// ---------------------------------------------------------------------------
// Opponents' hands
// ---------------------------------------------------------------------------

/**
 * A zone as Innovation builds it, placement function included.
 *
 * `setPlacementRules` puts its own `itemIdToCoordsGrid` on every zone, and that one reads the card's
 * box out of the shared `card_dimensions[HTML_class]` rather than off the zone — so this is the thing
 * that has to be replaced, and the thing these tests read back. BGA sizes the container from what it
 * returns.
 */
function fakeHandZone(playerId: string, location: string): Record<string, unknown> {
  const zone: Record<string, unknown> = { location, owner: playerId, container_div: `hand_${playerId}`, HTML_class: "S recto", item_width: 33, item_height: 47, item_margin: 5, items: [] };
  zone.itemIdToCoordsGrid = function (this: Record<string, any>, index: number, controlWidth: number): Record<string, number> {
    const gameui = (globalThis as unknown as { gameui: FakeGameui }).gameui;
    const size = gameui.card_dimensions[this.HTML_class];
    const delta = gameui.delta[this.location];
    const perRow = gameui.num_cards_in_row![this.location];
    return { x: delta.x * (index % perRow), y: delta.y * Math.floor(index / perRow), w: size.width, h: size.height };
  };
  return zone;
}

/** What BGA asks the zone for when it lays a card out — the box it then sizes the container from. */
function placementFor(gameui: FakeGameui, playerId: string, index: number = 0): Record<string, number> {
  const zone = gameui.zone!.hand![playerId] as Record<string, any>;
  return zone.itemIdToCoordsGrid.call(zone, index, 700);
}

/** BGA's face-down card: no children at all, with the age and set only in its id and classes. */
function addRecto(playerId: string, syntheticId: number, age: number, bgaType: number): HTMLElement {
  const recto = document.createElement("div");
  recto.id = `item_${syntheticId}__age_${age}__type_${bgaType}__is_relic_0__S__recto`;
  recto.className = `default_card_back item_${syntheticId} age_${age} type_${bgaType} S recto`;
  document.getElementById(`hand_${playerId}`)!.appendChild(recto);
  return recto;
}

/** A board with your own hand and an opponent's, which BGA distinguishes by the zone's location. */
function buildBoardWithHands(): FakeGameui {
  document.body.innerHTML = '<div id="leftright_page_wrapper" class="bgagame-innovation"></div><div id="hand_1234"></div><div id="hand_5678"></div><div id="board_1234_0"></div>';
  const gameui = fakeGameui();
  gameui.zone = { board: { "1234": {} }, hand: { "1234": fakeHandZone("1234", "my_hand"), "5678": fakeHandZone("5678", "opponent_hand") } } as FakeGameui["zone"];
  gameui.delta.opponent_hand = { x: 35, y: 49 };
  gameui.delta.my_hand_zone = { x: 189, y: 133 };
  gameui.num_cards_in_row = { opponent_hand: 5, my_hand: 4 };
  setGameui(gameui);
  return gameui;
}

function hintHtml(rectoId: string): string | null {
  const wrapper = document.getElementById(rectoId)!.querySelector(".bgaa-hint");
  return wrapper ? wrapper.innerHTML : null;
}

/** One group of knowledge, as the service worker renders and pushes it. */
function group(playerId: string, age: number, bgaSetId: string, runs: { html: string; count: number }[]): unknown {
  return { playerId, age, bgaSetId, runs };
}

describe("opponent hands", () => {
  it("reports the panel's card box to BGA, without touching the shared card size", () => {
    // "S recto" is one entry shared by the opponents' hands, all fifty deck piles, both achievement
    // rows, the relics and every forecast and score back, so it cannot move. Innovation's placement
    // function reads the box from there, which is why the function itself is what gets replaced —
    // and the box it returns is what BGA sizes the hand's container from.
    const gameui = buildBoardWithHands();

    simplifiedCardsFunction(WITH_HANDS);

    expect(placementFor(gameui, "5678")).toMatchObject({ w: 94, h: 47 });
    expect(gameui.card_dimensions["S recto"]).toEqual({ width: 33, height: 47 });
    // Your own hand is drawn face-up at "M card" size and is patched through card_dimensions.
    expect(placementFor(gameui, "1234")).toMatchObject({ w: 33, h: 47 });
    // BGA's own step between two hand cards, which the placement function reads back.
    expect(gameui.delta.opponent_hand).toEqual({ x: 101, y: 54 });
    expect(document.getElementById("hand_5678")!.hasAttribute("data-bgaa-opp-hand")).toBe(true);
    expect(document.getElementById("hand_1234")!.hasAttribute("data-bgaa-opp-hand")).toBe(false);
  });

  it("keeps BGA's own row and column arithmetic", () => {
    const gameui = buildBoardWithHands();

    simplifiedCardsFunction(WITH_HANDS);

    // Five per row, from BGA's own num_cards_in_row, stepping by BGA's own delta.
    expect(placementFor(gameui, "5678", 0)).toMatchObject({ x: 0, y: 0 });
    expect(placementFor(gameui, "5678", 2)).toMatchObject({ x: 202, y: 0 });
    expect(placementFor(gameui, "5678", 5)).toMatchObject({ x: 0, y: 54 });
  });

  it("scales the reported box with the size slider, border included", () => {
    const gameui = buildBoardWithHands();

    simplifiedCardsFunction({ ...WITH_HANDS, scale: 200 });

    // The whole box scales here, unlike a board card whose 1px border does not: the panel's card is
    // dropped in whole and scaled with a transform, so BGA is told what is actually painted.
    expect(placementFor(gameui, "5678")).toMatchObject({ w: 188, h: 94 });
  });

  it("draws what is known onto the cards of the matching age and set", () => {
    buildBoardWithHands();
    addRecto("5678", 10, 1, 0);
    addRecto("5678", 20, 1, 0);
    addRecto("5678", 30, 2, 3);

    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([
      group("5678", 1, "0", [{ html: "<i>age one</i>", count: 2 }]),
      group("5678", 2, "3", [{ html: "<i>echoes two</i>", count: 1 }]),
    ] as never);

    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBe("<i>age one</i>");
    expect(hintHtml("item_20__age_1__type_0__is_relic_0__S__recto")).toBe("<i>age one</i>");
    // BGA numbers its sets differently from us; the payload carries BGA's own id for this reason.
    expect(hintHtml("item_30__age_2__type_3__is_relic_0__S__recto")).toBe("<i>echoes two</i>");
  });

  it("draws a card the model has nothing to say about as the panel's placeholder", () => {
    // Fewer hints than cards is the normal case, not an error: a card whose candidates still span its
    // whole age is no information, and a card just drawn is not in the model until the next
    // extraction. Both still get a card — the age alone — because the slot is laid out at the panel's
    // width and BGA's own narrow back would float in a slot two and a half times its size.
    buildBoardWithHands();
    addRecto("5678", 10, 1, 0);
    addRecto("5678", 20, 3, 3);

    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>only one</i>", count: 1 }])] as never);

    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBe("<i>only one</i>");
    const blank = hintHtml("item_20__age_3__type_3__is_relic_0__S__recto")!;
    // Its own age, read off BGA's markup, and the panel's gray for that set — BGA's 3 is Echoes.
    expect(blank).toContain('<div class="card-age">3</div>');
    expect(blank).toContain("b-gray-echoes");
    expect(blank).not.toContain("cb-count");
    expect(blank).not.toContain("card-tip");
  });

  it("draws every card as a placeholder before any knowledge has arrived", () => {
    // Opening a table mid-game: the mount runs before the first extraction, so nothing is parked yet.
    buildBoardWithHands();
    addRecto("5678", 10, 2, 0);

    simplifiedCardsFunction(WITH_HANDS);

    expect(hintHtml("item_10__age_2__type_0__is_relic_0__S__recto")).toContain('<div class="card-age">2</div>');
  });

  it("assigns by BGA's own card id, so a count cannot hop between two cards that mean the same", () => {
    buildBoardWithHands();
    // Appended out of order, as a redraw or a re-sorted hand can leave them.
    addRecto("5678", 30, 1, 0);
    addRecto("5678", 10, 1, 0);

    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>first</i>", count: 1 }, { html: "<i>second</i>", count: 1 }])] as never);

    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBe("<i>first</i>");
    expect(hintHtml("item_30__age_1__type_0__is_relic_0__S__recto")).toBe("<i>second</i>");
  });

  it("writes nothing on a repeat pass, so the observer it runs from cannot loop", () => {
    buildBoardWithHands();
    const recto = addRecto("5678", 10, 1, 0);
    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>same</i>", count: 1 }])] as never);

    const wrapper = recto.querySelector(".bgaa-hint")!;
    const observer = new MutationObserver(() => {});
    observer.observe(recto, { childList: true, subtree: true, characterData: true });
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>same</i>", count: 1 }])] as never);

    expect(observer.takeRecords()).toHaveLength(0);
    // The very same node, not a replacement: replacing it would close an open tooltip on every push.
    expect(recto.querySelector(".bgaa-hint")).toBe(wrapper);
    observer.disconnect();
  });

  it("strips a card that has left the hand, which BGA moves rather than rebuilds", () => {
    buildBoardWithHands();
    const recto = addRecto("5678", 10, 1, 0);
    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>gone soon</i>", count: 1 }])] as never);
    expect(recto.querySelector(".bgaa-hint")).not.toBeNull();

    // A return to the deck reparents the very same node, which would carry the wrapper with it.
    document.getElementById("board_1234_0")!.appendChild(recto);
    opponentHandHintsFunction([] as never);

    expect(recto.querySelector(".bgaa-hint")).toBeNull();
  });

  it("puts BGA's own hands back when the sub-option alone is switched off", () => {
    const gameui = buildBoardWithHands();
    const recto = addRecto("5678", 10, 1, 0);
    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>knowledge</i>", count: 1 }])] as never);

    simplifiedCardsFunction(ENABLED);

    // BGA's own placement function is back, reporting its own card box again.
    expect(placementFor(gameui, "5678")).toMatchObject({ w: 33, h: 47 });
    expect(gameui.delta.opponent_hand).toEqual({ x: 35, y: 49 });
    expect(recto.querySelector(".bgaa-hint")).toBeNull();
    expect(document.getElementById("hand_5678")!.hasAttribute("data-bgaa-opp-hand")).toBe(false);
    // The cards themselves stay simplified: only the sub-option went.
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains("bgaa-opponent-hands")).toBe(false);
  });

  it("puts them back when the whole feature is switched off", () => {
    const gameui = buildBoardWithHands();
    const recto = addRecto("5678", 10, 1, 0);
    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>knowledge</i>", count: 1 }])] as never);

    simplifiedCardsFunction(DISABLED);

    expect(placementFor(gameui, "5678")).toMatchObject({ w: 33, h: 47 });
    expect(recto.querySelector(".bgaa-hint")).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-opponent-hands")).toBe(false);
  });

  it("draws knowledge that arrived before the mount did", () => {
    // The two injections race: a push can reach the page while the board is still being built.
    buildBoardWithHands();
    addRecto("5678", 10, 1, 0);

    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>early</i>", count: 1 }])] as never);
    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBeNull();

    simplifiedCardsFunction(WITH_HANDS);

    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBe("<i>early</i>");
  });

  it("draws nothing while the sub-option is off", () => {
    buildBoardWithHands();
    addRecto("5678", 10, 1, 0);

    simplifiedCardsFunction(ENABLED);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: "<i>unwanted</i>", count: 1 }])] as never);

    expect(hintHtml("item_10__age_1__type_0__is_relic_0__S__recto")).toBeNull();
  });
});

describe("opponent hand tooltips", () => {
  /** jsdom implements neither showPopover nor :popover-open, so both are stubbed per test — the same
   *  shape inpage_log_mount.test.ts uses for the tip logic this one is a second copy of. */
  function stubTip(tip: HTMLElement) {
    let open = false;
    (tip as any).showPopover = vi.fn(() => { open = true; });
    (tip as any).hidePopover = vi.fn(() => { open = false; });
    tip.matches = ((sel: string) => sel === ":popover-open" ? open : Element.prototype.matches.call(tip, sel)) as typeof tip.matches;
    return tip;
  }

  /** jsdom gives every element a zero rect and no offset size, so both are stubbed explicitly. */
  function stubRect(el: Element, rect: Partial<DOMRect>): void {
    el.getBoundingClientRect = (() => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect })) as typeof el.getBoundingClientRect;
  }
  function stubSize(el: HTMLElement, width: number, height: number): void {
    Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
  }

  /** A hand with one card carrying a candidate-list tip, mounted and drawn. */
  function handWithTip(): { recto: HTMLElement; tip: HTMLElement } {
    buildBoardWithHands();
    const recto = addRecto("5678", 10, 1, 0);
    simplifiedCardsFunction(WITH_HANDS);
    opponentHandHintsFunction([group("5678", 1, "0", [{ html: '<div class="card"><div class="card-tip-list" popover="manual">candidates</div></div>', count: 1 }])] as never);
    return { recto, tip: stubTip(recto.querySelector(".card-tip-list") as HTMLElement) };
  }

  beforeEach(() => {
    window.innerHeight = 800;
    window.innerWidth = 1200;
  });

  it("opens the hovered card's candidate list", () => {
    const { recto, tip } = handWithTip();

    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect((tip as any).showPopover).toHaveBeenCalled();
  });

  it("closes it when the pointer leaves the card entirely", () => {
    const { recto, tip } = handWithTip();
    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    const out = new Event("pointerout", { bubbles: true }) as any;
    out.relatedTarget = document.body;
    recto.dispatchEvent(out);

    expect((tip as any).hidePopover).toHaveBeenCalled();
  });

  it("keeps it open while the pointer moves within the card", () => {
    const { recto, tip } = handWithTip();
    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    const out = new Event("pointerout", { bubbles: true }) as any;
    out.relatedTarget = recto.querySelector(".card");
    recto.dispatchEvent(out);

    expect((tip as any).hidePopover).not.toHaveBeenCalled();
  });

  it("places the tip under the card", () => {
    const { recto, tip } = handWithTip();
    stubRect(recto, { top: 100, bottom: 147, left: 200 });
    stubSize(tip, 300, 60);

    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect(tip.style.top).toBe("151px");
    expect(tip.style.left).toBe("200px");
  });

  it("flips it above a card near the bottom of the board", () => {
    const { recto, tip } = handWithTip();
    stubRect(recto, { top: 700, bottom: 747, left: 200 });
    stubSize(tip, 300, 200);

    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    // 747 + 4 + 200 would run past the 800px viewport, so it opens above: 700 - 4 - 200.
    expect(tip.style.top).toBe("496px");
  });

  it("pulls it back from the right edge", () => {
    const { recto, tip } = handWithTip();
    stubRect(recto, { top: 100, bottom: 147, left: 1100 });
    stubSize(tip, 300, 60);

    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    // 1100 + 300 would overflow 1200, so it is clamped to 1200 - 300 - 4.
    expect(tip.style.left).toBe("896px");
  });

  it("measures the tip only after opening it, which is when it has a size", () => {
    // Placing before showing measures a tip with no layout box, so the flip above never triggers and
    // a candidate list near the bottom of a tall board opens off-screen.
    const { recto, tip } = handWithTip();
    stubRect(recto, { top: 700, bottom: 747, left: 200 });
    const order: string[] = [];
    (tip as any).showPopover = vi.fn(() => { order.push("show"); });
    Object.defineProperty(tip, "offsetHeight", { get: () => { order.push("measure"); return 200; }, configurable: true });
    Object.defineProperty(tip, "offsetWidth", { get: () => 300, configurable: true });

    recto.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect(order[0]).toBe("show");
    expect(order).toContain("measure");
  });
});
