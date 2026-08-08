// Simplified Innovation cards: the side panel's compact card look, applied to the cards on BGA's
// own table — your hand, every player's board, and the opponents' face-down hands, where the card
// drawn is what the tracker has deduced rather than anything BGA is showing.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (MAIN world), so it must stay entirely self-contained — no imports, no module-scope references,
// no closures over anything in this file.
//
// The type below is erased at compile time, so it costs the injected functions nothing.
import type { HandHintGroup } from "./render.js";

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
export function simplifiedCardsFunction(opts: { enabled: boolean; scale: number; echoText: boolean; opponentHands: boolean }): void {
  /** Every rule in simplified_cards.css hangs off this, so removing it is the whole restore path. */
  const ROOT_CLASS = "bgaa-simplified-cards";
  /** Print an Echo card's effect in full instead of marking its slot. Styling alone, so it is a class. */
  const ECHO_TEXT_CLASS = "bgaa-echo-text";
  /** Draw the opponents' face-down hands as the panel's cards too. Its own class, its own zones. */
  const HANDS_CLASS = "bgaa-opponent-hands";
  /**
   * The wanted state — the whole of it — published on the root rather than read from `opts`.
   *
   * The zones this relies on are built during Innovation's setup, so a toggle can arrive before
   * there is anything to lay out and has to be retried. A retry loop closing over its own `opts`
   * would go on to apply an intent the user has since changed — switching the feature off while
   * the board was still loading would end with it on. Every injection stamps its intent here and
   * the loop reads it back each tick, so the newest one always wins.
   *
   * All four fields, not just `enabled`: a later injection that also finds no zones turns back at the
   * watch guard below without starting a loop of its own, so whatever it wanted would otherwise be
   * lost. Unticking "Opponents' hands" while a board loads used to end with the hands resized and
   * marked but never drawn into — BGA's own card back already gone, and no knowledge coming, because
   * the service worker had stopped pushing it.
   */
  const STATE_ATTRIBUTE = "data-bgaa-cards-opts";
  /** Guards against a second retry loop when injections overlap. */
  const WATCH_ATTRIBUTE = "data-bgaa-cards-watch";
  /** Where the untouched originals are parked, so restoring never has to hardcode BGA's numbers. */
  const STASH_KEY = "__bgaaSimplifiedCardsOriginals";
  /** How long to keep waiting for Innovation to build its zones before giving up. */
  const WATCH_TIMEOUT_MS = 60000;
  const RETRY_INTERVAL_MS = 250;

  /**
   * The opponents'-hand card at 100%, in CSS pixels: the side panel's own size. It stays in step with
   * `.card` in mini_card.css. The board and own-hand cards use `CARD_BOARD` instead.
   */
  const CARD = { width: 92, height: 45 };
  /**
   * The board and own-hand card: 2px wider and 1px taller than `CARD`. The extra width holds a 2px gap
   * between the icon columns and the extra height a 2px gap between the two rows, so a splayed pile's
   * revealed strip clears the next icon with a pixel of room — without crowding any icon toward the
   * card edge. Only the boards splay, but BGA sizes every "M card" (your hand included) from one
   * `card_dimensions` entry, so the own hand comes along; the opponents' hands and the panel keep
   * `CARD`. Must stay in step with the `.card.M` box in simplified_cards.css.
   */
  const CARD_BOARD = { width: 94, height: 46 };
  /** The gutter BGA leaves between hand cards at 100% (its own 189 is a 182 box plus 7). */
  const HAND_GUTTER = 7;
  /**
   * How much of a covered card a splay leaves showing, at 100% — the icon and a full 2px gap to where
   * the next card overlaps: a 20px icon at a 2px inset, then the whole 2px gap to the next column/row.
   *
   * This equals `--col-centre` (24), and that is the point: the overlapping card's edge then lands
   * exactly on the next icon column (the border offsets cancel — `1 + 24*f` on both sides), so the
   * revealed icon gets the same 2px margin it has from the card's own border, and no sliver of the
   * next column shows. One figure serves every direction, because `CARD_BOARD` gives the icons a 2px
   * gap on both axes: the left or right column of a 94px-wide card, and the bottom row of a 46px-tall
   * one (46 = this 24 + a 2px inset + a 20px icon).
   *
   * It must not be generous. A band wider than 24 would bring a sliver of the next column into a right
   * splay, or the row above into an up splay. `CARD_BOARD`'s extra 2x1px over `CARD` is what buys this
   * 24 over the old 22 — which left the icon flush against the next card — without crowding the edge.
   *
   * simplified_cards.css lays a covered card out against this number — it gives the right-hand icons
   * the strip a left splay reveals and keeps the age out of it — so the two are a pair and neither
   * moves alone.
   */
  const SPLAY_REVEAL = 24;
  /**
   * BGA's own "show next to nothing" offset for its compact display mode, left unscaled: it is a
   * hairline standing in for a hidden card rather than a part of the card's proportions.
   */
  const SPLAY_COMPACT = 3;
  /** One edge of the card's border, which stays 1px at every size — so it is added after scaling. */
  const BORDER = 1;

  /**
   * The intent this pass is applying: the newest one published on the root, not the one this
   * injection was called with.
   *
   * Reading it back rather than closing over `opts` is what makes the retry loop honour a change made
   * while the board was still loading. The first injection's own values are the ones published a few
   * lines below, so nothing is lost when there is only one.
   */
  const readOpts = (): { enabled: boolean; scale: number; echoText: boolean; opponentHands: boolean } => {
    const published = document.documentElement.getAttribute(STATE_ATTRIBUTE);
    return published ? JSON.parse(published) : opts;
  };
  /**
   * Every number BGA lays a card out against, at one size.
   *
   * Derived per pass rather than once per injection, since the size the pass applies is read back
   * from the root and can be newer than the one this injection was called with.
   *
   * Deliberately unrounded. BGA is happy with fractional geometry — refreshSplay already divides its
   * way to a fractional overlap — and rounding here alone would put these a half-pixel out of step
   * with the stylesheet, which scales the same base numbers through calc().
   *
   * `hand` is the opponent-hand card, outer edge included, and the one place `CARD` (92x45) is still
   * used rather than `CARD_BOARD`: opponents' hands stay the panel's compact size. Its whole box
   * scales, border and all, because the panel's card is dropped into BGA's slot whole and scaled with
   * a transform rather than rebuilt at each size in CSS — so its 1px border grows with it, unlike the
   * board/own-hand card whose border stays 1px at every size. The zone is laid out against exactly
   * what gets painted.
   */
  const geometryAt = (scale: number) => {
    const factor = scale / 100;
    return {
      factor,
      card: { width: CARD_BOARD.width * factor + 2 * BORDER, height: CARD_BOARD.height * factor + 2 * BORDER },
      myHand: { x: (CARD_BOARD.width + HAND_GUTTER) * factor + 2 * BORDER, y: (CARD_BOARD.height + HAND_GUTTER) * factor + 2 * BORDER },
      // The step is between card boxes, so the strip it leaves showing opens with the covered card's
      // own border edge — one border, not two, and it is not part of the band the icons need.
      splay: { compact: SPLAY_COMPACT, expanded: SPLAY_REVEAL * factor + BORDER },
      hand: { width: (CARD.width + 2 * BORDER) * factor, height: (CARD.height + 2 * BORDER) * factor },
      gutter: HAND_GUTTER * factor,
    };
  };
  /** Published for the stylesheet, which derives every length inside the card from it. */
  const SCALE_PROPERTY = "--bgaa-card-scale";
  /** The one zone size that is rebuilt; BGA keys its dimension tables by this. */
  const ZONE_CLASS = "M card";
  /** Marks a container whose cards this owns, and the hook every rule and every sweep below keys on. */
  const HAND_ATTRIBUTE = "data-bgaa-opp-hand";
  /** Where the originals of the opponent-hand zones are parked, alongside the card stash above. */
  const HANDS_STASH_KEY = "__bgaaOpponentHandOriginals";
  /**
   * The knowledge to draw, parked on the game object by the service worker's own injection.
   *
   * Two injections rather than one: this mount rearranges the board and ends by asking BGA to lay it
   * out again, which animates every card it moves. The knowledge changes on every move of the game,
   * and re-running the mount that often would leave the board permanently in motion — so the push
   * that carries it is a separate, cheaper function that only writes into cards. It leaves the
   * payload here, and calls the applier below if this mount has already put one there.
   */
  const HINTS_KEY = "__bgaaHandHints";
  const APPLY_KEY = "__bgaaApplyHandHints";
  /** The wrapper this injects into each of BGA's hand cards, and the panel's own scope class. */
  const HINT_CLASS = "bgaa-hint";
  const CARDS_SCOPE_CLASS = "bgaa-cards";
  /** The markup a card is currently showing, kept on the node so a repeat pass writes nothing. */
  const HINT_HTML_KEY = "__bgaaHintHtml";
  /** Guards the one hover delegation per container. */
  const HOVER_ATTRIBUTE = "data-bgaa-hand-hover";
  /**
   * BGA's own id for a face-down card, which is the only place its age and set are stated together.
   *
   * `item_<id>__age_<age>__type_<type>__is_relic_<0|1>__S__recto`, where the id is synthetic — minted
   * once when the card is created and kept for the card's whole life, since BGA reparents the very
   * same node from the deck into a hand rather than building a new one. That makes it the stable sort
   * key this needs, and the age and set make the group.
   */
  const RECTO_ID = /^item_(\d+)__age_(\d+)__type_(\d+)__is_relic_(\d)__/;

  // Every frame of the tab receives the injection; only Innovation's board carries this marker,
  // which BGA writes on the layout wrapper. The /tableview shell, the loader frame and every other
  // game have none.
  if (!document.querySelector(".bgagame-innovation")) return;

  document.documentElement.setAttribute(STATE_ATTRIBUTE, JSON.stringify(opts));

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

  // -------------------------------------------------------------------------
  // Opponents' hands
  // -------------------------------------------------------------------------

  /** Every opponent-hand zone BGA built, which is the one kind of hand it draws face-down. */
  const opponentHandZones = (gameui: Record<string, any>): Record<string, any>[] => {
    const hands = gameui.zone?.hand;
    if (!hands) return [];
    // BGA decides this once, in createZone: your own hand is "my_hand", everyone else's is
    // "opponent_hand". Reading its own verdict rather than comparing player ids keeps a spectator —
    // who owns no hand at all and must see every hand as an opponent's — right for free.
    return Object.keys(hands).map(playerId => hands[playerId]).filter(zone => zone && zone.location === "opponent_hand");
  };

  /**
   * Lay the opponent hands out for a card of the panel's size, or put BGA's own numbers back.
   *
   * `card_dimensions["S recto"]` is deliberately untouched: BGA shares that one entry between the
   * opponents' hands, all fifty deck piles, every forecast and score back, the relics and both
   * achievement rows, so moving it would resize half the table.
   *
   * Which leaves the placement function as the only way in, because Innovation does not use the
   * framework's. `setPlacementRules` installs its own `itemIdToCoordsGrid` on every zone it builds,
   * and that one reports each card's box straight from the shared `card_dimensions[HTML_class]` —
   * ignoring `zone.item_width`/`item_height` entirely. Setting those did nothing: the cards were laid
   * out at the right spacing, because the spacing comes from `delta` and that we do patch, but every
   * card still measured 33x47 to BGA. The container is sized from that measurement — `autoheight`
   * takes the tallest `y + h` — so it stayed as tall as one of BGA's own cards while ours were half as
   * tall again, and the hand overflowed its box.
   *
   * So the function is replaced per zone, which is exactly what Innovation itself does to a board pile
   * when it splays. Everything but the size is BGA's own: the step between cards and the rows both
   * come from `delta[location]` and `num_cards_in_row[location]`, which are BGA's to compute and ours
   * only to feed. Hands are always laid out left to right (`setPlacementRules(zone, true)`; only the
   * score piles ask for the mirrored branch), so that is the one this reproduces.
   */
  const resizeHandZones = (gameui: Record<string, any>, enabled: boolean, size: ReturnType<typeof geometryAt>): void => {
    const stash = gameui[HANDS_STASH_KEY];
    if (enabled) {
      // Only ever taken once, and before the first replacement: a second injection would otherwise
      // stash our own function and leave nothing able to restore BGA's.
      if (!stash) {
        gameui[HANDS_STASH_KEY] = {
          delta: gameui.delta.opponent_hand,
          zones: opponentHandZones(gameui).map(zone => ({ zone, grid: zone.itemIdToCoordsGrid })),
        };
      }
      for (const zone of opponentHandZones(gameui)) {
        zone.itemIdToCoordsGrid = function (this: Record<string, any>, index: number): { x: number; y: number; w: number; h: number } {
          const delta = gameui.delta[this.location];
          // Guarded where BGA's own is not: it divides the board's width by a step four times the one
          // it was written for, so a narrow board that fits BGA's cards can round this to zero, and
          // `index % 0` places every card at NaN.
          const perRow = Math.max(1, gameui.num_cards_in_row[this.location]);
          return { x: delta.x * (index % perRow), y: delta.y * Math.floor(index / perRow), w: size.hand.width, h: size.hand.height };
        };
        const container = document.getElementById(zone.container_div);
        if (container) container.setAttribute(HAND_ATTRIBUTE, "1");
      }
      // BGA's own notion of the step between two hand cards, which the function above reads back: it
      // is also what `refreshLayout` divides the board's width by to decide how many fit a row.
      gameui.delta.opponent_hand = { x: size.hand.width + size.gutter, y: size.hand.height + size.gutter };
      return;
    }
    if (!stash) return;
    for (const entry of stash.zones) entry.zone.itemIdToCoordsGrid = entry.grid;
    gameui.delta.opponent_hand = stash.delta;
    for (const container of Array.from(document.querySelectorAll(`[${HAND_ATTRIBUTE}]`))) container.removeAttribute(HAND_ATTRIBUTE);
    delete gameui[HANDS_STASH_KEY];
  };

  /** Strip a card of everything this put on it, so a restore leaves BGA's own node behind. */
  const clearHint = (recto: HTMLElement): void => {
    const wrapper = recto.querySelector(`:scope > .${HINT_CLASS}`);
    if (wrapper) wrapper.remove();
    delete (recto as unknown as Record<string, unknown>)[HINT_HTML_KEY];
  };

  /** Every card this has drawn into, anywhere in the page — both teardown paths end here. */
  const clearAllHints = (): void => {
    for (const wrapper of Array.from(document.querySelectorAll<HTMLElement>(`.${HINT_CLASS}`))) {
      if (wrapper.parentElement) clearHint(wrapper.parentElement);
      else wrapper.remove();
    }
  };

  /**
   * The placeholder for a card nothing is known about, built here rather than pushed.
   *
   * Fewer hints than cards is the normal case: a card whose candidates still span its whole age is no
   * information, so the service worker sends nothing for it, and a card drawn a moment ago is not in
   * the model until the next extraction. Both still need to look like a card — the age alone, which
   * is exactly what the side panel shows for them, and which BGA has already stated on the element.
   *
   * The alternative was to leave those cards to BGA's own back, but the two do not sit together: the
   * zone lays every slot out at the panel's width, so BGA's narrow back would float in a slot two and
   * a half times its size, next to cards that fill theirs.
   *
   * The gray matches the panel's per-set placeholder. BGA's set numbering is its own — its 1 is
   * Artifacts where ours is Figures — and this reads BGA's markup, so it is keyed BGA's way.
   */
  const GRAY_BY_BGA_SET: Record<string, string> = { "0": "b-gray-base", "1": "b-gray-artifacts", "2": "b-gray-cities", "3": "b-gray-echoes", "4": "b-gray" };
  const blankCard = (age: number, bgaSetId: string): string => {
    const gray = GRAY_BY_BGA_SET[bgaSetId] ?? "b-gray";
    return `<div class="card card-base ${gray}"><div class="cb-tl"></div><div class="cb-name"></div><div class="cb-bl"></div><div class="cb-mid"></div><div class="card-age">${age}</div></div>`;
  };

  /**
   * Draw what is known about each face-down card onto the card itself.
   *
   * Cards are matched to knowledge by (age, set) — the two things BGA states on a face-down card, as
   * `age_N` and `type_N` — and never one by one, because there is no one-by-one to be had: within a
   * group the model holds a multiset of possibilities rather than an identity per card, so any
   * assignment inside a group says the same thing. Sorting both sides keeps that assignment steady
   * from one push to the next, so a count does not hop between two cards that mean the same.
   *
   * A card with no hint of its own gets the placeholder above, so every card in the hand is drawn.
   */
  const applyHints = (gameui: Record<string, any>): void => {
    const groups: { playerId: string; age: number; bgaSetId: string; runs: { html: string; count: number }[] }[] = gameui[HINTS_KEY] ?? [];
    const wanted = new Map<string, string[]>();
    for (const group of groups) {
      const expanded: string[] = [];
      for (const run of group.runs) for (let i = 0; i < run.count; i++) expanded.push(run.html);
      wanted.set(`${group.playerId}|${group.age}|${group.bgaSetId}`, expanded);
    }

    for (const zone of opponentHandZones(gameui)) {
      const container = document.getElementById(zone.container_div);
      if (!container) continue;
      const byGroup = new Map<string, HTMLElement[]>();
      for (const recto of Array.from(container.querySelectorAll<HTMLElement>(":scope > .recto"))) {
        const parsed = RECTO_ID.exec(recto.id);
        if (!parsed) continue;
        const key = `${zone.owner}|${Number(parsed[2])}|${parsed[3]}`;
        const bucket = byGroup.get(key);
        if (bucket) bucket.push(recto);
        else byGroup.set(key, [recto]);
      }
      for (const [key, rectos] of byGroup) {
        // By BGA's own id, which is a number it hands out in creation order: an order that exists
        // whatever the DOM does, and that a redraw or a re-sort of the hand cannot shuffle.
        rectos.sort((a, b) => Number(RECTO_ID.exec(a.id)![1]) - Number(RECTO_ID.exec(b.id)![1]));
        const html = wanted.get(key) ?? [];
        for (let i = 0; i < rectos.length; i++) {
          const recto = rectos[i];
          const parsed = RECTO_ID.exec(recto.id)!;
          const markup = i < html.length ? html[i] : blankCard(Number(parsed[2]), parsed[3]);
          // Only ever on a difference: this runs from an observer watching these very cards, so an
          // unconditional write would retrigger it for ever.
          if ((recto as unknown as Record<string, unknown>)[HINT_HTML_KEY] === markup) continue;
          (recto as unknown as Record<string, unknown>)[HINT_HTML_KEY] = markup;
          let wrapper = recto.querySelector<HTMLElement>(`:scope > .${HINT_CLASS}`);
          if (!wrapper) {
            wrapper = document.createElement("div");
            // The panel's own scope class rides on the wrapper: mini_card.css hangs every rule off it,
            // so that the same sheet cannot reach BGA's own cards, which are `.card` too.
            wrapper.className = `${HINT_CLASS} ${CARDS_SCOPE_CLASS}`;
            recto.appendChild(wrapper);
          }
          wrapper.innerHTML = markup;
        }
      }
    }

    // A card returned from a hand keeps the node it had — BGA reparents it into the deck rather than
    // rebuilding it — and would carry its wrapper out of the hand with it, where no rule reaches it
    // any more but the markup still sits. Nothing is stamped and then trusted.
    for (const wrapper of Array.from(document.querySelectorAll<HTMLElement>(`.${HINT_CLASS}`))) {
      const recto = wrapper.parentElement;
      if (recto && recto.closest(`[${HAND_ATTRIBUTE}]`)) continue;
      if (recto) clearHint(recto);
      else wrapper.remove();
    }
  };

  /**
   * Place a tooltip against its card, in viewport coordinates.
   *
   * The same reasoning as the in-page log's own `placeTip`, and deliberately a second copy of it: both
   * are injected functions that Chrome serializes, so neither can import from the other. It flips the
   * tip above the card when it would overflow the bottom, and pulls it back from the right edge.
   * Unlike the log's, this one needs no fallback size — a candidate list has no fixed dimensions, and
   * it is measured after being shown, when it has a box.
   */
  const placeTip = (card: Element, tip: HTMLElement): void => {
    const rect = card.getBoundingClientRect();
    const gap = 4;
    const below = rect.bottom + gap;
    const top = below + tip.offsetHeight > window.innerHeight ? Math.max(gap, rect.top - gap - tip.offsetHeight) : below;
    const left = Math.max(gap, Math.min(rect.left, window.innerWidth - tip.offsetWidth - gap));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  };

  /**
   * Reveal a card's tooltip on hover: the candidates it could be, or the face of the one it is.
   *
   * Delegated to the container, once, because the cards inside it come and go — a per-card listener
   * would be lost the moment BGA moved the card, and the wrapper is replaced whenever the knowledge
   * changes. The tip is a popover, so it opens in the top layer and cannot be clipped by BGA's board.
   */
  const watchHover = (container: HTMLElement): void => {
    if (container.hasAttribute(HOVER_ATTRIBUTE)) return;
    container.setAttribute(HOVER_ATTRIBUTE, "1");
    const tipOf = (target: EventTarget | null): { card: HTMLElement; tip: HTMLElement } | null => {
      const recto = target instanceof Element ? target.closest<HTMLElement>(".recto") : null;
      const tip = recto?.querySelector<HTMLElement>(`:scope > .${HINT_CLASS} .card-tip, :scope > .${HINT_CLASS} .card-tip-list`);
      return recto && tip ? { card: recto, tip } : null;
    };
    container.addEventListener("pointerover", (event) => {
      const found = tipOf(event.target);
      if (!found || found.tip.matches(":popover-open")) return;
      try { found.tip.showPopover(); } catch { /* already open */ }
      // After showing: the tip has no layout box until it is open, so its size is unknown before.
      placeTip(found.card, found.tip);
    });
    container.addEventListener("pointerout", (event) => {
      const found = tipOf(event.target);
      if (!found) return;
      const to = (event as PointerEvent).relatedTarget;
      if (to instanceof Node && found.card.contains(to)) return;
      if (found.tip.matches(":popover-open")) { try { found.tip.hidePopover(); } catch { /* already closed */ } }
    });
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
    const wanted = readOpts();
    const enabled = wanted.enabled;
    const size = geometryAt(wanted.scale);
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
            // And a card entering or leaving a hand takes its knowledge with it. BGA moves the very
            // same node between zones, so this is also what strips a wrapper off a card that has just
            // left a hand for the deck.
            if (document.documentElement.classList.contains(HANDS_CLASS)) applyHints(live);
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
      gameui.card_dimensions[ZONE_CLASS] = { ...size.card };
      gameui.delta.my_hand = { ...size.myHand };
      gameui.overlap_for_splay[ZONE_CLASS] = { ...size.splay };
      // Re-published on every enabling injection, not just the first: the slider changes nothing
      // else, so this is the only thing a size-only change has to carry through.
      document.documentElement.style.setProperty(SCALE_PROPERTY, String(size.factor));
      document.documentElement.classList.toggle(ECHO_TEXT_CLASS, wanted.echoText);

      // The opponents' hands are a sub-option, switched on and off under a feature that stays on, so
      // both directions have to be handled here rather than only alongside the feature's own.
      resizeHandZones(gameui, wanted.opponentHands, size);
      document.documentElement.classList.toggle(HANDS_CLASS, wanted.opponentHands);
      if (wanted.opponentHands) {
        // Parked for the push that carries the knowledge: it arrives on its own, on every move of the
        // game, and calls this rather than repeating any of it.
        gameui[APPLY_KEY] = (): void => applyHints(gameui);
        for (const zone of opponentHandZones(gameui)) {
          const container = document.getElementById(zone.container_div);
          if (container) watchHover(container);
        }
        applyHints(gameui);
      } else {
        delete gameui[APPLY_KEY];
        clearAllHints();
      }
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
      // The hands come back to BGA's own size and lose their wrappers, whatever the sub-option says:
      // the feature they belong to is going away with them.
      clearAllHints();
      resizeHandZones(gameui, false, size);
      delete gameui[APPLY_KEY];
      document.documentElement.classList.remove(HANDS_CLASS);
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

/**
 * Push what is known about the opponents' hands into the page (MAIN world).
 *
 * Deliberately tiny, and deliberately separate from the mount above: this arrives on every move of
 * the game, while the mount rearranges the board and ends by asking BGA to lay it out again — an
 * animation on every card it moves, which at this cadence would never stop. So this only leaves the
 * knowledge where the mount can find it, and asks the mount to draw it.
 *
 * Order between the two does not matter. Arriving first, this parks the payload and finds no applier,
 * and the mount draws it as it starts; arriving after, it draws immediately. Nothing is drawn while
 * the sub-option is off, because that is when no applier is parked.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for injection.
 */
export function opponentHandHintsFunction(groups: HandHintGroup[]): void {
  const gameui = (window as unknown as { gameui?: Record<string, any> }).gameui;
  if (!gameui) return;
  gameui.__bgaaHandHints = groups;
  const apply = gameui.__bgaaApplyHandHints;
  if (typeof apply === "function") apply();
}
