// Simplified Innovation cards: the side panel's compact card look, applied to the cards on BGA's
// own table — your hand and every player's board.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (MAIN world), so it must stay entirely self-contained — no imports, no module-scope references,
// no closures over anything in this file.
//
// MAIN world rather than ISOLATED, unlike the in-page log and the compact header, because shrinking
// a card is a layout change and not only a restyle. BGA gives every card an inline `left`/`top` it
// computes from `gameui.card_dimensions`, and recomputes them on every move, splay and resize — so
// a card made smaller in CSS alone would keep its old slot and leave a hole. Patching the few
// constants that layout is derived from and letting BGA's own zone engine re-run is what makes the
// new size stick: splay direction, the echo-effect visibility rules and the pile-width clamping all
// keep working, none of it reimplemented here.

/**
 * Mount function injected into the page (MAIN world) to switch Innovation's table cards between
 * BGA's illustrated cards and the side panel's compact ones.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for injection.
 */
export function simplifiedCardsFunction(opts: { enabled: boolean; scale: number; echoText: boolean }): void {
  /** Every rule in simplified_cards.css hangs off this, so removing it is the whole restore path. */
  const ROOT_CLASS = "bgaa-simplified-cards";
  /** Print an Echo card's effect in full instead of marking its slot. Styling alone, so it is a class. */
  const ECHO_TEXT_CLASS = "bgaa-echo-text";
  /**
   * The wanted state, published on the root rather than read from `opts`.
   *
   * The zones this relies on are built during Innovation's setup, so a toggle can arrive before
   * there is anything to lay out and has to be retried. A retry loop closing over its own `opts`
   * would go on to apply an intent the user has since changed — switching the feature off while
   * the board was still loading would end with it on. Every injection stamps its intent here and
   * the loop reads it back each tick, so the newest one always wins.
   */
  const STATE_ATTRIBUTE = "data-bgaa-cards-on";
  /** Guards against a second retry loop when injections overlap. */
  const WATCH_ATTRIBUTE = "data-bgaa-cards-watch";
  /** Where the untouched originals are parked, so restoring never has to hardcode BGA's numbers. */
  const STASH_KEY = "__bgaaSimplifiedCardsOriginals";
  /** How long to keep waiting for Innovation to build its zones before giving up. */
  const WATCH_TIMEOUT_MS = 60000;
  const RETRY_INTERVAL_MS = 250;

  /**
   * The card at 100%, in CSS pixels: the side panel's own. Everything below is this scaled, and it
   * must stay in step with `.card.M` in simplified_cards.css.
   */
  const CARD = { width: 92, height: 45 };
  /** The gutter BGA leaves between hand cards at 100% (its own 189 is a 182 box plus 7). */
  const HAND_GUTTER = 7;
  /**
   * How much of a covered card a splay leaves showing, at 100%.
   *
   * It has to clear the icon band it exists to reveal, which reaches 24px in from the edge (a 20px
   * icon at a 2px inset, plus the card's own border), so one figure serves every direction: 26px of
   * a 92px-wide card exposes the left or right icon column, and 26px of a 45px-tall card exposes the
   * bottom row. simplified_cards.css lays a covered card out against this number — it gives the
   * right-hand icons the strip a left splay reveals and keeps the age out of it — so the two are a
   * pair and neither moves alone.
   */
  const SPLAY_REVEAL = 26;
  /**
   * BGA's own "show next to nothing" offset for its compact display mode, left unscaled: it is a
   * hairline standing in for a hidden card rather than a part of the card's proportions.
   */
  const SPLAY_COMPACT = 3;
  /** The border stays 1px at every size, so it is added after scaling rather than through it. */
  const BORDER = 2;

  /** The multiplier the size slider asks for. */
  const factor = opts.scale / 100;
  // Deliberately unrounded. BGA is happy with fractional geometry — refreshSplay already divides its
  // way to a fractional overlap — and rounding here alone would put these a half-pixel out of step
  // with the stylesheet, which scales the same base numbers through calc().
  const CARD_DIMENSIONS = { width: CARD.width * factor + BORDER, height: CARD.height * factor + BORDER };
  const HAND_DELTA = { x: (CARD.width + HAND_GUTTER) * factor + BORDER, y: (CARD.height + HAND_GUTTER) * factor + BORDER };
  const SPLAY_OVERLAP = { compact: SPLAY_COMPACT, expanded: SPLAY_REVEAL * factor };
  /** Published for the stylesheet, which derives every length inside the card from it. */
  const SCALE_PROPERTY = "--bgaa-card-scale";
  /** The one zone size that is rebuilt; BGA keys its dimension tables by this. */
  const ZONE_CLASS = "M card";

  // Every frame of the tab receives the injection; only Innovation's board carries this marker,
  // which BGA writes on the layout wrapper. The /tableview shell, the loader frame and every other
  // game have none.
  if (!document.querySelector(".bgagame-innovation")) return;

  document.documentElement.setAttribute(STATE_ATTRIBUTE, opts.enabled ? "1" : "0");

  /** The zones this restyles: your own hand, and every player's board pile. */
  const ZONE_SELECTOR = '[id^="hand_"], [id^="board_"]';
  /**
   * Marks the top card of a board pile, which is the one that gets the side panel's full layout.
   *
   * Not derivable in CSS. The obvious `:has(~ .card.M)` — "every card with another after it" — reads
   * DOM order, and BGA's is not stack order: `createAndAddToZone` appends the node and takes the
   * card's height in the pile from a separate `items` array, so a tuck (a card melded to the
   * *bottom*, which Innovation does constantly) arrives last in the DOM while sitting at the bottom
   * of the stack. That mislabels the pile and hands covered cards the layout that puts the age on
   * the very edge a splay reveals. `items` is the authority — BGA's own splay code calls
   * `i == items.length - 1` the top card.
   */
  const TOP_ATTRIBUTE = "data-bgaa-top";

  /** Stamp `TOP_ATTRIBUTE` on the top card of every board pile, and clear it from the rest. */
  const markTopCards = (gameui: Record<string, any>): void => {
    const boards = gameui.zone?.board;
    if (!boards) return;
    for (const playerId of Object.keys(boards)) {
      for (const color of Object.keys(boards[playerId])) {
        const zone = boards[playerId][color];
        const container = zone?.container_div ? document.getElementById(zone.container_div) : null;
        if (!container || !Array.isArray(zone.items)) continue;
        const topId = zone.items.length > 0 ? zone.items[zone.items.length - 1].id : null;
        for (const card of Array.from(container.querySelectorAll<HTMLElement>(".card.M"))) {
          card.toggleAttribute(TOP_ATTRIBUTE, card.id === topId);
        }
      }
    }
  };

  /**
   * Put the card names back in the case they were written in.
   *
   * BGA uppercases a name when it builds the card — `_(card_data.name).toUpperCase()` — so the DOM
   * text really is "MONOTHEISM" and no stylesheet can undo it; `text-transform: lowercase` with a
   * capitalised first letter would give "Code of laws", which is wrong for a good part of the deck.
   * The untouched name is still on `gameui.cards`, which is the only place true title case survives,
   * and reaching it is the reason this runs in the page's own world.
   *
   * `uppercase` puts BGA's own rendering back, so switching the feature off leaves no trace.
   */
  const retitleCards = (gameui: Record<string, any>, uppercase: boolean): void => {
    // BGA's own translation hook, applied before it uppercases — so a translated table keeps its
    // translated names rather than reverting to the English the card data is written in.
    const translate = (window as unknown as { _?: (text: string) => string })._;
    for (const zone of Array.from(document.querySelectorAll(ZONE_SELECTOR))) {
      for (const card of Array.from(zone.querySelectorAll<HTMLElement>(".card.M"))) {
        const span = card.querySelector<HTMLElement>(":scope > .card_title > span");
        if (!span) continue;
        const data = gameui.cards[gameui.getCardIdFromHTMLId(card.id)];
        if (!data) continue;
        const name = typeof translate === "function" ? translate(data.name) : data.name;
        const wanted = uppercase ? name.toUpperCase() : name;
        // Only ever on a difference. This is driven by an observer watching the same subtree, so an
        // unconditional write would retrigger it for ever.
        if (span.textContent !== wanted) span.textContent = wanted;
      }
    }
  };

  /** Swap the layout constants and hand the relayout back to BGA. True once it has been done. */
  const apply = (): boolean => {
    const enabled = document.documentElement.getAttribute(STATE_ATTRIBUTE) === "1";
    const gameui = (window as unknown as { gameui?: Record<string, any> }).gameui;

    // Nothing to undo before the game object exists, so switching off can always finish here.
    if (!gameui || !gameui.card_dimensions || !gameui.delta || !gameui.overlap_for_splay) {
      if (enabled) return false;
      document.documentElement.classList.remove(ROOT_CLASS);
      return true;
    }
    // The zones are what gets re-laid-out; they arrive with Innovation's setup, later than the
    // frame's load event that triggers the first injection.
    if (!gameui.zone || !gameui.zone.board || typeof gameui.refreshLayout !== "function") {
      if (enabled) return false;
      document.documentElement.classList.remove(ROOT_CLASS);
      return true;
    }

    const stash = gameui[STASH_KEY];
    if (enabled) {
      // Only ever taken once: a second injection would otherwise stash the patched values and
      // leave nothing able to restore BGA's own.
      if (!stash) {
        // BGA rebuilds a card's markup whenever it moves one between zones, which puts the
        // uppercase name back. Watching the zones is what keeps the rename from being a one-shot
        // that the first meld undoes. Coalesced to a frame, since a single move can arrive as a
        // burst of mutations, and the scan itself writes nothing when there is nothing to change.
        let queued = false;
        const watcher = new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            const live = (window as unknown as { gameui?: Record<string, any> }).gameui;
            if (!live || !document.documentElement.classList.contains(ROOT_CLASS)) return;
            retitleCards(live, false);
            // A card entering or leaving a pile can change which one is on top.
            markTopCards(live);
          });
        });
        for (const zone of Array.from(document.querySelectorAll(ZONE_SELECTOR))) {
          watcher.observe(zone, { childList: true, subtree: true });
        }
        gameui[STASH_KEY] = {
          card: gameui.card_dimensions[ZONE_CLASS],
          hand: gameui.delta.my_hand,
          splay: gameui.overlap_for_splay[ZONE_CLASS],
          watcher,
        };
      }
      gameui.card_dimensions[ZONE_CLASS] = { ...CARD_DIMENSIONS };
      gameui.delta.my_hand = { ...HAND_DELTA };
      gameui.overlap_for_splay[ZONE_CLASS] = { ...SPLAY_OVERLAP };
      // Re-published on every enabling injection, not just the first: the slider changes nothing
      // else, so this is the only thing a size-only change has to carry through.
      document.documentElement.style.setProperty(SCALE_PROPERTY, String(factor));
      document.documentElement.classList.toggle(ECHO_TEXT_CLASS, opts.echoText);
    } else {
      if (!stash) {
        document.documentElement.classList.remove(ROOT_CLASS);
        return true;
      }
      gameui.card_dimensions[ZONE_CLASS] = stash.card;
      gameui.delta.my_hand = stash.hand;
      gameui.overlap_for_splay[ZONE_CLASS] = stash.splay;
      // Before the observer goes, so its own writes cannot race the restore.
      stash.watcher.disconnect();
      retitleCards(gameui, true);
      for (const card of Array.from(document.querySelectorAll(`[${TOP_ATTRIBUTE}]`))) card.removeAttribute(TOP_ATTRIBUTE);
      document.documentElement.style.removeProperty(SCALE_PROPERTY);
      document.documentElement.classList.remove(ECHO_TEXT_CLASS);
      delete gameui[STASH_KEY];
    }

    // Before the relayout, not after: BGA measures the board while re-placing the cards, and the
    // stylesheet is what gives them their new size.
    document.documentElement.classList.toggle(ROOT_CLASS, enabled);
    // Recomputes how many cards fit a hand row and re-runs refreshSplay over every board pile —
    // the same path BGA takes when the window is resized.
    gameui.refreshLayout();
    // After the relayout, which is what puts the cards where they belong; the rename only touches
    // their text. The restore path has already done its own pass, above.
    if (enabled) {
      retitleCards(gameui, false);
      markTopCards(gameui);
    }
    return true;
  };

  if (apply()) return;

  if (document.documentElement.hasAttribute(WATCH_ATTRIBUTE)) return;
  document.documentElement.setAttribute(WATCH_ATTRIBUTE, "1");
  const startedAt = Date.now();
  const timer = setInterval(() => {
    // A table watched as a spectator of a game that never starts, or any future BGA change that
    // drops these zones, would otherwise leave this running for the life of the page.
    if (apply() || Date.now() - startedAt > WATCH_TIMEOUT_MS) {
      clearInterval(timer);
      document.documentElement.removeAttribute(WATCH_ATTRIBUTE);
    }
  }, RETRY_INTERVAL_MS);
}
