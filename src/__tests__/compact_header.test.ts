// @vitest-environment jsdom
// Tests for compactHeaderFunction: the ISOLATED-world mount that folds BGA's status bar and
// Innovation's board button into the topbar. Exercises the real DOM contract against a fixture of
// BGA's board markup — topbar, status bar and player panel in the positions BGA renders them.

import { describe, it, expect, beforeEach } from "vitest";
import { compactHeaderFunction } from "../games/innovation/compact_header.js";

const ENABLED = { enabled: true, progressionOnly: false };
const DISABLED = { enabled: false, progressionOnly: false };
const PROGRESSION_ONLY = { enabled: true, progressionOnly: true };

/** BGA's board-frame header: #topbar (table info, timer) above #page-title (prompt, actions). */
function buildBgaBoardDom(): void {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-bgaa-header-watch");
  document.documentElement.removeAttribute("data-bgaa-game");
  document.body.innerHTML = `
    <div id="topbar" class="ingame topbar_new_version hide-alpha-banner">
      <div id="topbar_content" class="flex">
        <div class="topbar_left_content flex items-center">
          <div id="site-logo"></div>
          <div id="tableinfos" class="flex flex-col">
            <div id="table_ref_item_table_id" class="table_ref_item">Table #890902538</div>
            <div class="table_ref_item">Move #<span id="move_nbr">16</span></div>
            <div class="table_ref_item">Progression <span id="pr_gameprogression">1</span>%</div>
          </div>
        </div>
        <div class="topbar_middle_content flex justify-center">
          <div id="alpha_beta_banner"></div>
          <div id="current_header_infos_wrap"><div id="reflexiontime"></div></div>
        </div>
        <div id="upperrightmenu" class="flex">
          <div class="upperrightmenu_item"><a id="toggleSound"></a></div>
          <div class="upperrightmenu_item"><a id="globalaction_fullscreen"></a></div>
          <div id="ingame_menu" class="upperrightmenu_item"><div id="ingame_menu_wheel"></div></div>
        </div>
      </div>
    </div>
    <div id="leftright_page_wrapper" class="bgagame-innovation">
      <div id="left-side-wrapper">
        <div id="left-side">
          <div id="page-title" class="roundedbox bga-game-zoom">
            <div id="pagemaintitle_wrap" class="roundedboxinner w-full">
              <div id="maintitlebar_content">
                <div>
                  <span id="pagemaintitletext">You must take a first action</span><div id="generalactions"></div>
                  <span id="gotonexttable_wrap">
                    <a id="go_to_next_table_inactive_player" class="bgabutton bgabutton_red">Go to next table</a>
                    <a id="go_to_next_table_active_player" class="bgabutton bgabutton_gray"><i class="fa fa-arrow-right"></i></a>
                  </span>
                </div>
              </div>
            </div>
            <div id="gameaction_status_wrap" class="roundedboxinner" style="display:none"><span id="gameaction_status"></span></div>
          </div>
          <div id="game_play_area">
            <div id="main_area_wrapper">
              <div id="main_area">
                <div id="player_1" class="player">
                  <p id="name_1" class="player_name">Alice</p>
                  <div id="board_1" class="board"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Innovation builds its board buttons during setup, after the frame reports loaded. */
function addInnovationButtons(): void {
  const name = document.getElementById("name_1")!;
  name.insertAdjacentHTML("afterend", `
    <i id="change_view_full_button" class="bgabutton bgabutton_gray">Look at all cards in piles</i>
    <i id="change_display_mode_button" class="bgabutton bgabutton_gray">&lt;&lt; &gt;&gt; Show compact</i>
    <i id="browse_all_cards_button" class="bgabutton bgabutton_gray">Browse all cards</i>`);
}

function row(): HTMLElement | null {
  return document.getElementById("bgaa-compact-header-row");
}

function rowChildIds(): string[] {
  return Array.from(row()!.children).map(el => el.id);
}

/** Let a MutationObserver callback and any queued microtasks run. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  buildBgaBoardDom();
});

describe("compactHeaderFunction mounting", () => {
  it("bails silently in frames that are not a game board", () => {
    // The /tableview shell and the loader frame get the injection too, and carry no game marker.
    document.getElementById("leftright_page_wrapper")!.className = "";
    expect(() => compactHeaderFunction(ENABLED)).not.toThrow();
    expect(row()).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
    expect(document.getElementById("pagemaintitle_wrap")!.parentElement!.id).toBe("page-title");
  });

  it("folds the header of any game, not just Innovation", () => {
    // The bar it folds is BGA's framework, identical on every table; only the board buttons it
    // hides are Innovation's, and those simply do not exist elsewhere.
    document.getElementById("leftright_page_wrapper")!.className = "bgagame-azul";
    compactHeaderFunction(ENABLED);

    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(true);
  });

  it("leaves the status bar alone when the game keeps something else in it", () => {
    // Unknown games may put a banner or a control of their own in #page-title; hiding the bar would
    // take it with them, with no way to reach it.
    document.getElementById("leftright_page_wrapper")!.className = "bgagame-somegame";
    document.getElementById("page-title")!.insertAdjacentHTML("beforeend", '<div id="game_own_banner">Something this game shows</div>');
    compactHeaderFunction(ENABLED);

    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
  });

  it("bails silently when BGA has restructured its topbar away", () => {
    document.getElementById("topbar")!.remove();
    expect(() => compactHeaderFunction(ENABLED)).not.toThrow();
    expect(row()).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
  });

  it("moves both title wrappers into a row in the topbar's middle column", () => {
    addInnovationButtons();
    compactHeaderFunction(ENABLED);

    expect(row()!.parentElement!.className).toContain("topbar_middle_content");
    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
    // Both wrappers move, not just the visible one: BGA swaps between them by flipping `display`.
    expect(document.getElementById("gameaction_status_wrap")!.getAttribute("style")).toBe("display:none");
  });

  it("puts the go-to-next-table control at the head of BGA's icon strip", () => {
    // Not the left corner: once your turn ends and other tables are waiting, BGA relabels this
    // "N tables are waiting…", and a button that can grow that wide would shove the table info
    // across the bar. On the right the strip simply widens.
    compactHeaderFunction(ENABLED);

    const strip = document.getElementById("upperrightmenu")!;
    const nextTable = document.getElementById("gotonexttable_wrap")!;
    expect(nextTable.parentElement).toBe(strip);
    expect(strip.firstElementChild).toBe(nextTable);
    // It travels inside the prompt wrapper, so it has to be taken back out of the row.
    expect(row()!.contains(nextTable)).toBe(false);
  });

  it("moves the whole wrapper, so both of BGA's variants travel together", () => {
    // BGA shows the labelled button when you are not the active player and the bare arrow when you
    // are; moving one would strand the other beside the prompt.
    compactHeaderFunction(ENABLED);
    const nextTable = document.getElementById("gotonexttable_wrap")!;
    expect(nextTable.contains(document.getElementById("go_to_next_table_inactive_player"))).toBe(true);
    expect(nextTable.contains(document.getElementById("go_to_next_table_active_player"))).toBe(true);
  });

  it("leaves the go-to-next-table control alone on repeated injections", () => {
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);

    const strip = document.getElementById("upperrightmenu")!;
    expect(strip.firstElementChild!.id).toBe("gotonexttable_wrap");
    expect(document.querySelectorAll("[data-bgaa-slot='gotonexttable_wrap']")).toHaveLength(1);
  });

  it("puts the view toggle between the logo and the table info", () => {
    addInnovationButtons();
    compactHeaderFunction(ENABLED);

    const viewFull = document.getElementById("change_view_full_button")!;
    const tableInfos = document.getElementById("tableinfos")!;
    expect(viewFull.parentElement).toBe(tableInfos.parentElement);
    expect(viewFull.nextElementSibling).toBe(tableInfos);
    expect(viewFull.previousElementSibling!.id).toBe("site-logo");
    // It is a view control, not one of the turn's actions, so it does not belong in the row.
    expect(row()!.contains(viewFull)).toBe(false);
  });

  it("leaves BGA's own icons in order behind the control it adds to the strip", () => {
    compactHeaderFunction(ENABLED);
    const strip = document.getElementById("upperrightmenu")!;
    expect(Array.from(strip.children).slice(1).map(el => el.id || el.className)).toEqual(["upperrightmenu_item", "upperrightmenu_item", "ingame_menu"]);
  });

  it("carries the state's action buttons along with the prompt", () => {
    // #generalactions holds "Draw a 1", "Achieve 1", "Pass" and the rest — they belong with the
    // prompt they answer, and BGA nests them inside the wrapper that moves.
    compactHeaderFunction(ENABLED);
    expect(row()!.contains(document.getElementById("generalactions"))).toBe(true);
  });

  it("sits ahead of the reflexion timer, which keeps its place in the row", () => {
    compactHeaderFunction(ENABLED);
    const middle = row()!.parentElement!;
    const timer = document.getElementById("current_header_infos_wrap")!;
    expect(row()!.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timer.parentElement).toBe(middle);
  });

  it("hides BGA's status bar via a root class, leaving #page-title itself untouched", () => {
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(true);
    expect(document.getElementById("page-title")!.getAttribute("style")).toBeNull();
  });

  it("is idempotent across repeated injections", () => {
    addInnovationButtons();
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);

    expect(document.querySelectorAll("#bgaa-compact-header-row")).toHaveLength(1);
    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
    expect(document.querySelectorAll("[data-bgaa-slot='pagemaintitle_wrap']")).toHaveLength(1);
  });

  it("re-mounts the row when BGA rebuilds its topbar", () => {
    compactHeaderFunction(ENABLED);
    // A rebuilt topbar takes the row with it, so the mount cannot latch on "already mounted".
    document.querySelector(".topbar_middle_content")!.innerHTML = "";
    compactHeaderFunction(ENABLED);

    expect(row()).not.toBeNull();
    expect(row()!.parentElement!.className).toContain("topbar_middle_content");
  });

  it("gives BGA's status bar back when a topbar rebuild took the prompt with it", () => {
    compactHeaderFunction(ENABLED);
    document.querySelector(".topbar_middle_content")!.innerHTML = "";
    compactHeaderFunction(ENABLED);

    // The prompt is gone with the old topbar, so keeping #page-title hidden would leave the page
    // with no prompt at all.
    expect(document.getElementById("pagemaintitle_wrap")).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
  });

  it("leaves the status bar visible in a layout without the prompt wrapper", () => {
    // Defensive: hiding #page-title is only ever right when its content is in the row instead.
    document.getElementById("pagemaintitle_wrap")!.remove();
    compactHeaderFunction(ENABLED);

    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
  });
});

describe("compactHeaderFunction restoring", () => {
  it("puts every moved node back exactly where it came from", () => {
    addInnovationButtons();
    const before = document.body.innerHTML;

    compactHeaderFunction(ENABLED);
    compactHeaderFunction(DISABLED);

    expect(document.body.innerHTML).toBe(before);
    expect(row()).toBeNull();
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
    expect(document.querySelectorAll("[data-bgaa-slot]")).toHaveLength(0);
  });

  it("restores a header folded before Innovation built its buttons", async () => {
    compactHeaderFunction(ENABLED);
    addInnovationButtons();
    await flush();
    expect(document.getElementById("change_view_full_button")!.nextElementSibling!.id).toBe("tableinfos");

    compactHeaderFunction(DISABLED);
    expect(document.getElementById("change_view_full_button")!.parentElement!.id).toBe("player_1");
    expect(document.getElementById("pagemaintitle_wrap")!.parentElement!.id).toBe("page-title");
  });

  it("drops the progression-only class along with the fold", () => {
    compactHeaderFunction(PROGRESSION_ONLY);
    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(true);

    compactHeaderFunction(DISABLED);
    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(false);
  });

  it("does nothing when disabled without ever having been applied", () => {
    const before = document.body.innerHTML;
    compactHeaderFunction(DISABLED);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe("compactHeaderFunction watching for Innovation's buttons", () => {
  it("folds in the button once game setup creates it", async () => {
    // Setup runs after the frame reports loaded, so the first pass folds in the header alone.
    compactHeaderFunction(ENABLED);
    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);

    addInnovationButtons();
    await flush();

    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
    // The other two buttons stay put — hiding them is the stylesheet's job, not a DOM move.
    expect(document.getElementById("change_display_mode_button")!.parentElement!.id).toBe("player_1");
    expect(document.getElementById("browse_all_cards_button")!.parentElement!.id).toBe("player_1");
  });

  it("starts only one watcher across repeated injections", async () => {
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.getAttribute("data-bgaa-header-watch")).toBe("1");

    addInnovationButtons();
    await flush();

    expect(document.querySelectorAll("[data-bgaa-slot='change_view_full_button']")).toHaveLength(1);
    expect(document.documentElement.hasAttribute("data-bgaa-header-watch")).toBe(false);
  });

  it("retires the watcher when the feature is turned off first", async () => {
    // The observer belongs to the run that started it and cannot be reached from a later
    // injection, so it has to notice the feature is off and stop re-applying.
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(DISABLED);

    addInnovationButtons();
    await flush();

    expect(row()).toBeNull();
    expect(document.getElementById("pagemaintitle_wrap")!.parentElement!.id).toBe("page-title");
    expect(document.documentElement.hasAttribute("data-bgaa-header-watch")).toBe(false);
  });

  it("stops watching once the button is in the row", async () => {
    compactHeaderFunction(ENABLED);
    addInnovationButtons();
    await flush();
    expect(document.documentElement.hasAttribute("data-bgaa-header-watch")).toBe(false);

    // Any later DOM churn — cards moving, log rows arriving — must not reach a disconnected
    // observer, so the row stays as it is.
    document.getElementById("main_area")!.insertAdjacentHTML("beforeend", "<div id='noise'></div>");
    await flush();
    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
  });
});

describe("compactHeaderFunction progression-only", () => {
  it("marks the root when asked for it", () => {
    compactHeaderFunction(PROGRESSION_ONLY);
    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(true);
  });

  it("leaves the table info alone by default", () => {
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(false);
  });

  it("turns back off without unfolding the header", () => {
    compactHeaderFunction(PROGRESSION_ONLY);
    compactHeaderFunction(ENABLED);

    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(false);
    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(true);
    expect(rowChildIds()).toEqual(["pagemaintitle_wrap", "gameaction_status_wrap"]);
  });

  it("never marks the root while the header is not folded", () => {
    // The table info is a caption in the corner of BGA's own header; a bare figure there would read
    // as a stray number.
    document.getElementById("page-title")!.insertAdjacentHTML("beforeend", '<div id="game_own_banner">Something</div>');
    compactHeaderFunction(PROGRESSION_ONLY);

    expect(document.documentElement.classList.contains("bgaa-compact-header")).toBe(false);
    expect(document.documentElement.classList.contains("bgaa-progression-only")).toBe(false);
  });
});

describe("compactHeaderFunction per-game hook", () => {
  it("stamps the game's slug on the root, so per-game CSS has something to key on", () => {
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.getAttribute("data-bgaa-game")).toBe("innovation");
  });

  it("reads the slug from whichever game is open", () => {
    document.getElementById("leftright_page_wrapper")!.className = "bgagame-arknova";
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.getAttribute("data-bgaa-game")).toBe("arknova");
  });

  it("clears the slug when the header is restored", () => {
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(DISABLED);
    expect(document.documentElement.hasAttribute("data-bgaa-game")).toBe(false);
  });

  it("does not stamp a slug on a header it decided not to fold", () => {
    document.getElementById("page-title")!.insertAdjacentHTML("beforeend", '<div id="game_own_banner">Something</div>');
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.hasAttribute("data-bgaa-game")).toBe(false);
  });
});

describe("compactHeaderFunction height limit", () => {
  /** jsdom lays nothing out, so the bar's height is dictated per test. */
  function setBarHeight(height: number): void {
    const bar = document.getElementById("topbar")!;
    bar.getBoundingClientRect = () => ({ height, top: 0, bottom: height, left: 0, right: 0, width: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  /** jsdom ships no ResizeObserver; this one exposes its callback so resizes can be driven. */
  function stubResizeObserver(): { fire: () => void; disconnected: () => boolean } {
    let callback: (() => void) | null = null;
    let disconnected = false;
    (globalThis as any).ResizeObserver = class {
      constructor(cb: () => void) { callback = cb; }
      observe(): void { /* the element is irrelevant; the callback is what matters */ }
      disconnect(): void { disconnected = true; }
    };
    return { fire: () => callback?.(), disconnected: () => disconnected };
  }

  function isTall(): boolean {
    return document.documentElement.classList.contains("bgaa-header-tall");
  }

  beforeEach(() => {
    delete (globalThis as any).ResizeObserver;
    document.documentElement.classList.remove("bgaa-header-tall");
    document.documentElement.removeAttribute("data-bgaa-bar-watch");
  });

  it("stays sticky at its usual height", () => {
    setBarHeight(36);
    compactHeaderFunction(ENABLED);
    expect(isTall()).toBe(false);
  });

  it("unsticks once the bar grows past the ceiling", () => {
    const observer = stubResizeObserver();
    setBarHeight(36);
    compactHeaderFunction(ENABLED);
    expect(isTall()).toBe(false);

    setBarHeight(131);          // the ceiling is 130, so this is over
    observer.fire();
    expect(isTall()).toBe(true);
  });

  it("holds on at exactly the ceiling, and lets go past it", () => {
    const observer = stubResizeObserver();
    setBarHeight(36);
    compactHeaderFunction(ENABLED);

    setBarHeight(130);
    observer.fire();
    expect(isTall()).toBe(false);

    setBarHeight(130.5);
    observer.fire();
    expect(isTall()).toBe(true);
  });

  it("sticks again when the bar comes back down", () => {
    const observer = stubResizeObserver();
    setBarHeight(36);
    compactHeaderFunction(ENABLED);
    setBarHeight(200);
    observer.fire();
    expect(isTall()).toBe(true);

    setBarHeight(36);
    observer.fire();
    expect(isTall()).toBe(false);
  });

  it("unsticks a bar that is tall from the very first measurement", () => {
    // The regression this guards against: a game whose own bulky content (a piece picker, board
    // art) lives inside what gets folded can be tall before anything ever resizes. A baseline
    // learned from "the smallest height seen so far" would record that first reading as normal and
    // never catch it — height > height * 3 is never true. The fixed ceiling catches it immediately,
    // with no resize needed at all.
    setBarHeight(200);
    compactHeaderFunction(ENABLED);
    expect(isTall()).toBe(true);
  });

  it("starts one watcher across repeated injections", () => {
    stubResizeObserver();
    setBarHeight(36);
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(ENABLED);
    expect(document.documentElement.getAttribute("data-bgaa-bar-watch")).toBe("1");
  });

  it("retires the watcher once the header is restored", () => {
    const observer = stubResizeObserver();
    setBarHeight(36);
    compactHeaderFunction(ENABLED);
    compactHeaderFunction(DISABLED);

    expect(isTall()).toBe(false);
    observer.fire();
    expect(observer.disconnected()).toBe(true);
    expect(document.documentElement.hasAttribute("data-bgaa-bar-watch")).toBe(false);
  });

  it("runs without a ResizeObserver, judging the bar as it stands", () => {
    setBarHeight(36);
    expect(() => compactHeaderFunction(ENABLED)).not.toThrow();
    expect(isTall()).toBe(false);
  });
});
