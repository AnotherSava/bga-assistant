// Compact table header: folds BGA's status bar and Innovation's board buttons into the topbar,
// so table id, move number, progression, the current prompt and its actions share one row.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (ISOLATED world), so it must stay entirely self-contained — no imports, no module-scope
// references, no closures over anything in this file.

/**
 * Mount function injected into the page (ISOLATED world) to fold BGA's header rows into one.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for
 * injection. It moves BGA's own nodes rather than copying them, so everything BGA writes by id
 * (the prompt text, the action buttons, the move counter) keeps updating in their new home.
 */
export function compactHeaderFunction(opts: { enabled: boolean; progressionOnly: boolean }): void {
  const HEADER_CLASS = "bgaa-compact-header";
  /** Paring the table info down to the progression figure is styling alone, so it rides on a class. */
  const PROGRESSION_CLASS = "bgaa-progression-only";
  const ROW_ID = "bgaa-compact-header-row";
  const SLOT_ATTRIBUTE = "data-bgaa-slot";
  const WATCH_ATTRIBUTE = "data-bgaa-header-watch";
  /**
   * The game's own slug, stamped on the root so the stylesheet can single one out.
   *
   * Games put their own art and controls in BGA's title bar — Ark Nova's break cup, card icons —
   * sized and nudged for the 62px bar this replaces. Nothing here can anticipate each of them, so
   * the slug is exposed and per-game corrections live in CSS next to the shared rules.
   */
  const GAME_ATTRIBUTE = "data-bgaa-game";
  /** How long to keep waiting for Innovation to build its board buttons before giving up. */
  const WATCH_TIMEOUT_MS = 60000;
  /**
   * Freezing the bar is worth it while it is one row; a bar that has grown to several is a wall
   * across the top of the board, so past this height it scrolls away like BGA's own instead. CSS
   * cannot ask how tall an element is, so this is measured here and published as a class. Toggling
   * it changes `position` alone, which does not affect the height it was measured from — so there
   * is no feedback loop to guard against.
   *
   * Fixed rather than learned from what the bar has held: a game that puts its own bulky content —
   * a piece picker, board art — inside what gets folded can be tall from the very first measurement,
   * with nothing smaller ever recorded to compare against. A baseline built from "the smallest
   * height seen so far" never catches that: the first reading becomes the baseline, so the bar is
   * never taller than itself. Sized a little over double BGA's own fixed 62px bar, generous enough
   * for a genuinely wrapped prompt or a game's own inline art, tight enough to still let go of
   * something that never was one row.
   */
  const STICKY_MAX_HEIGHT_PX = 130;
  const TALL_CLASS = "bgaa-header-tall";
  const RESIZE_ATTRIBUTE = "data-bgaa-bar-watch";
  /**
   * BGA nodes folded into the row, in the order they take there.
   *
   * Both title wrappers move, not just the visible one: BGA shows the prompt or the action status
   * by flipping their `display`, and it does that by id, wherever the element happens to live.
   * `pagemaintitle_wrap` carries `#generalactions` with it, so the state's action buttons stay
   * attached to the prompt they belong to.
   */
  const ROW_IDS = ["pagemaintitle_wrap", "gameaction_status_wrap"];
  /**
   * Innovation's "look at all cards in piles" toggle, which goes to the far left rather than the
   * row — it is a view control, not one of the turn's actions. Its label is replaced by an icon in
   * CSS, because `toggle_view` rewrites the button's innerHTML on every click and would wipe any
   * markup put there from here.
   */
  const VIEW_FULL_ID = "change_view_full_button";
  /**
   * The go-to-next-table control, which joins BGA's icon strip rather than the row.
   *
   * The whole wrapper moves, not the arrow alone: BGA keeps two buttons in here — a labelled one
   * for when you are not the active player and a bare arrow for when you are — and shows whichever
   * fits the state. Moving one would strand the other beside the prompt.
   */
  const NEXT_TABLE_ID = "gotonexttable_wrap";
  const MOVED_IDS = [...ROW_IDS, NEXT_TABLE_ID, VIEW_FULL_ID];

  const slotFor = (id: string): Element | null => document.querySelector(`[${SLOT_ATTRIBUTE}="${id}"]`);

  /** Put every moved node back where its placeholder is waiting, and drop our own additions. */
  const restore = (): void => {
    for (const id of MOVED_IDS) {
      const node = document.getElementById(id);
      const slot = slotFor(id);
      if (node && slot && slot.parentNode) slot.parentNode.insertBefore(node, slot);
      slot?.remove();
    }
    document.getElementById(ROW_ID)?.remove();
    document.documentElement.classList.remove(HEADER_CLASS);
    document.documentElement.classList.remove(PROGRESSION_CLASS);
    document.documentElement.removeAttribute(WATCH_ATTRIBUTE);
    document.documentElement.removeAttribute(GAME_ATTRIBUTE);
    document.documentElement.classList.remove(TALL_CLASS);
  };

  // Every frame of the tab receives the injection; only a game board carries this marker, which BGA
  // writes on the layout wrapper as `bgagame-<slug>`. The /tableview shell and the loader frame have
  // none, and neither does any other page on the site.
  const board = document.querySelector('[class*="bgagame-"]');
  if (!board) return;

  if (!opts.enabled) {
    restore();
    return;
  }

  const topbarContent = document.getElementById("topbar_content");
  if (!topbarContent) return;  // Not the board frame, or BGA restructured its topbar.

  const apply = (): void => {
    // The middle column is the only part of the topbar that grows; the fallback keeps a future
    // layout without it from losing the header entirely.
    const host = topbarContent.querySelector(".topbar_middle_content") ?? topbarContent;

    // Re-created rather than latched: BGA rebuilding its topbar would otherwise leave the status
    // bar hidden with nothing in its place.
    let row = document.getElementById(ROW_ID);
    if (!row || !row.isConnected) {
      row = document.createElement("div");
      row.id = ROW_ID;
    }
    if (row.parentElement !== host) host.insertBefore(row, host.firstChild);

    // A placeholder marks where a node came from, since a later injection carries no memory of the
    // DOM an earlier one changed — it is the whole restore path. Only ever placed once per node.
    const leaveSlot = (id: string, node: Element): void => {
      if (slotFor(id)) return;
      const slot = document.createElement("span");
      slot.setAttribute(SLOT_ATTRIBUTE, id);
      slot.style.display = "none";
      node.parentNode?.insertBefore(slot, node);
    };

    for (const id of ROW_IDS) {
      const node = document.getElementById(id);
      if (!node || node.parentElement === row) continue;
      leaveSlot(id, node);
      row.appendChild(node);
    }

    // The view toggle lands at the far left, between the logo and the table info. It is a view
    // control rather than one of the turn's actions, and as a fixed-size icon it can sit in that
    // corner without ever pushing the table info across the bar.
    const tableInfos = document.getElementById("tableinfos");
    const viewFull = document.getElementById(VIEW_FULL_ID);
    if (tableInfos && viewFull && viewFull.nextElementSibling !== tableInfos) {
      leaveSlot(VIEW_FULL_ID, viewFull);
      tableInfos.parentNode?.insertBefore(viewFull, tableInfos);
    }

    // The go-to-next-table control joins BGA's icon strip instead. It is not always the bare arrow
    // it looks like mid-turn: once your turn is over and other tables are waiting, BGA relabels it
    // "N tables are waiting…", and there is room for that on the right where the strip can simply
    // widen. It travels inside `pagemaintitle_wrap`, so this runs after the row is filled and takes
    // it back out.
    const rightMenu = document.getElementById("upperrightmenu");
    const nextTable = document.getElementById(NEXT_TABLE_ID);
    if (rightMenu && nextTable && nextTable.parentElement !== rightMenu) {
      leaveSlot(NEXT_TABLE_ID, nextTable);
      rightMenu.insertBefore(nextTable, rightMenu.firstChild);
    }

    // The class is what hides BGA's status bar, so it goes on under two conditions.
    //
    // The prompt has to be genuinely in the row: were BGA to rebuild its topbar, the moved nodes
    // would go with it, and hiding a status bar we can no longer fill would leave the page with no
    // prompt at all.
    //
    // And the status bar has to hold nothing but the wrappers we moved out and the placeholders they
    // left behind. This runs on every game BGA hosts, most of which nobody here has ever looked at;
    // one that keeps a banner or a control of its own down there would otherwise have it hidden with
    // no way to reach it. Structural rather than measured, so it reads the same once already hidden.
    const promptInRow = document.getElementById("pagemaintitle_wrap")?.parentElement === row;
    const titleBar = document.getElementById("page-title");
    const titleBarIsSpent = !titleBar || Array.from(titleBar.children).every((el) => el.hasAttribute(SLOT_ATTRIBUTE) || (el.children.length === 0 && !el.textContent?.trim()));
    const folded = promptInRow && titleBarIsSpent;
    document.documentElement.classList.toggle(HEADER_CLASS, folded);
    const slug = Array.from(board.classList).find((name) => name.startsWith("bgagame-"))?.slice("bgagame-".length);
    if (folded && slug) document.documentElement.setAttribute(GAME_ATTRIBUTE, slug);
    else document.documentElement.removeAttribute(GAME_ATTRIBUTE);
    // Only ever alongside the fold: on BGA's own header the table info is a caption in the corner,
    // and stripping it to a bare number there would read as a stray figure.
    document.documentElement.classList.toggle(PROGRESSION_CLASS, folded && opts.progressionOnly);
  };

  /** Judge the bar's height against the fixed ceiling, and publish the verdict as a class. */
  const gaugeBar = (): void => {
    const bar = document.getElementById("topbar");
    if (!bar) return;
    document.documentElement.classList.toggle(TALL_CLASS, bar.getBoundingClientRect().height > STICKY_MAX_HEIGHT_PX);
  };

  apply();
  gaugeBar();

  // Re-judge whenever the bar changes size: a prompt long enough to wrap, a game's own art, or the
  // window narrowing until the buttons drop to a second row. Guarded by an attribute so repeated
  // injections leave one observer, and it retires itself once the header is no longer folded —
  // it belongs to the run that started it and cannot be reached from a later one.
  if (typeof ResizeObserver !== "undefined" && !document.documentElement.hasAttribute(RESIZE_ATTRIBUTE)) {
    const topbar = document.getElementById("topbar");
    if (topbar) {
      document.documentElement.setAttribute(RESIZE_ATTRIBUTE, "1");
      const sizeWatcher = new ResizeObserver(() => {
        if (!document.documentElement.classList.contains(HEADER_CLASS)) {
          sizeWatcher.disconnect();
          document.documentElement.removeAttribute(RESIZE_ATTRIBUTE);
          return;
        }
        gaugeBar();
      });
      sizeWatcher.observe(topbar);
    }
  }

  // Innovation builds its board buttons during setup, which runs after the frame reports loaded —
  // so the first pass usually folds in the header alone and this catches the button afterwards.
  if (document.getElementById("change_view_full_button")) return;
  if (document.documentElement.hasAttribute(WATCH_ATTRIBUTE)) return;
  document.documentElement.setAttribute(WATCH_ATTRIBUTE, "1");

  const stop = (): void => {
    observer.disconnect();
    document.documentElement.removeAttribute(WATCH_ATTRIBUTE);
  };
  const observer = new MutationObserver(() => {
    // A later injection may have turned the feature off; this observer belongs to the run that
    // turned it on and cannot be reached from there, so it retires itself.
    if (!document.documentElement.classList.contains(HEADER_CLASS)) { stop(); return; }
    if (!document.getElementById("change_view_full_button")) return;
    apply();
    stop();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // A table watched as a spectator, or any future BGA change that drops the button, would
  // otherwise leave the observer running for the life of the page.
  setTimeout(stop, WATCH_TIMEOUT_MS);
}
