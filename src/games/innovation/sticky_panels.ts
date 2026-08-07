// Pinned right column: what stays at the top of the column while the board scrolls past — the whole
// column while the turn history is the column's content, and BGA's player panels alone otherwise.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (ISOLATED world), so it must stay entirely self-contained — no imports, no module-scope
// references, no closures over anything in this file.
//
// The pinning itself, and the choice between the two modes, is CSS in sticky_panels.css — the mode is
// keyed on the class the in-page log already puts on the root to hide BGA's own log. What cannot be
// written in CSS is what the pinned block sits under (a height, which no selector can ask for) and
// whether the panels are too tall to pin at all (a measurement, likewise). This does both, and
// publishes the answers as a custom property and a class for the stylesheet to read.

/**
 * Mount function injected into the page (ISOLATED world) to pin the right column's top.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for injection.
 */
export function stickyPanelsFunction(opts: { enabled: boolean }): void {
  /** Every rule in sticky_panels.css hangs off this, so removing it is the whole restore path. */
  const ROOT_CLASS = "bgaa-sticky-panels";
  /**
   * Set when the panels are too tall to be worth pinning, which turns their own rule off.
   *
   * A panel stack is as tall as the table has players, and a four-player game's is over twice a
   * two-player game's — so the ceiling is a share of the viewport rather than a pixel count. Past it,
   * pinning walls off the top of the screen instead of keeping a reference in view.
   *
   * Only the panels-alone mode reads this. The pinned column of the other one is capped to the window
   * and scrolls inside itself, so nothing there can be out of reach however tall it grows.
   *
   * Toggling it changes `position` alone, which cannot change the height it was measured from, so
   * there is no feedback loop to guard against.
   */
  const TALL_CLASS = "bgaa-panels-tall";
  const MAX_VIEWPORT_SHARE = 0.5;
  /**
   * What the pinned block sits under: the frozen header bar and the gap BGA leaves below it, or
   * nothing at the top of the page.
   *
   * The gap is why the bar's height alone is the wrong answer. BGA gives the column a 5px top margin,
   * so a block pinned at exactly the bar's height has to travel those 5px before it sticks — it looks
   * settled under the bar from the first frame, then nudges up as soon as the page moves. Pinning it
   * where it already sits removes the movement and keeps BGA's own separation.
   *
   * Taken from the column's own margin rather than from the distance measured between the two, which
   * cannot be read back once the block is stuck: the measurement would return the stuck position and
   * collapse the gap to nothing. A computed margin is a static property, unmoved by any of this.
   *
   * One offset serves both modes. The pinned column takes it directly; the panels inside that column
   * take zero, since the column standing at the offset has already accounted for it.
   */
  const TOP_PROPERTY = "--bgaa-sticky-top";
  /**
   * The page's own background, copied onto the pinned block so nothing shows through it.
   *
   * BGA leaves the gaps between panels transparent, which is invisible until the block is pinned and
   * the game log starts travelling behind it — at which point log lines read through the stack. The
   * page's own backdrop is the one fill that hides them without inventing a colour of its own, and it
   * has to be read from the page: it is a table felt that BGA themes, and the user's own custom CSS,
   * are free to change.
   */
  const BACKDROP_IMAGE_PROPERTY = "--bgaa-panels-backdrop-image";
  const BACKDROP_COLOR_PROPERTY = "--bgaa-panels-backdrop-color";
  /** Guards against a second set of observers when injections overlap. */
  const WATCH_ATTRIBUTE = "data-bgaa-panels-watch";
  /** BGA's own wrapper around the panel stack — the block this pins, framework-wide. */
  const PANELS_ID = "right-side-first-part";
  /** The column itself, pinned whole in the other mode, and the one carrying the gap under the bar. */
  const COLUMN_ID = "right-side";

  const root = document.documentElement;
  const panels = document.getElementById(PANELS_ID);
  // Every frame of the tab receives the injection; only a board frame has a right column. The
  // /tableview shell and the loader frame have none.
  if (!panels) return;

  if (!opts.enabled) {
    // The observers below read the class back on every callback and retire themselves once it is
    // gone, so dropping it is all the teardown this needs.
    root.classList.remove(ROOT_CLASS, TALL_CLASS);
    root.style.removeProperty(TOP_PROPERTY);
    root.style.removeProperty(BACKDROP_IMAGE_PROPERTY);
    root.style.removeProperty(BACKDROP_COLOR_PROPERTY);
    return;
  }

  /**
   * Copy the page's backdrop onto the root for the stylesheet to paint the pinned block with.
   *
   * Read from the root element and then from `body`, since which of the two carries the table felt is
   * a theme's choice: BGA's own puts the image on the root, and `body` is where a custom stylesheet
   * most often overrides it. Whichever paints something wins, and a page painting nothing leaves both
   * properties unset, so the block stays as transparent as BGA left it.
   */
  const publishBackdrop = (): void => {
    for (const element of [root, document.body]) {
      const style = getComputedStyle(element);
      // "Paints nothing" has more than one spelling, and an unset property does not always serialise
      // to its initial value, so each is named rather than compared against a single string.
      const image = style.backgroundImage !== "" && style.backgroundImage !== "none";
      const colour = style.backgroundColor !== "" && style.backgroundColor !== "transparent" && style.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (!image && !colour) continue;
      root.style.setProperty(BACKDROP_IMAGE_PROPERTY, style.backgroundImage);
      root.style.setProperty(BACKDROP_COLOR_PROPERTY, style.backgroundColor);
      return;
    }
  };

  /** Read the offset and the panels' height off the page, and publish what the stylesheet needs. */
  const measure = (): void => {
    const bar = document.getElementById("topbar");
    // Only a bar that stays put is an offset. BGA's own scrolls away, and so does the folded one
    // once the compact header judges it too tall to freeze — in both cases the panels belong at the
    // very top. Read from the computed style rather than from our own settings: the compact header
    // owns that decision and can change it mid-game without re-running this.
    const frozen = bar !== null && getComputedStyle(bar).position === "sticky";
    // The gap only counts under a frozen bar, where it is what the block is already sitting at. With
    // the bar gone from the top of the window there is nothing to keep separation from, and the block
    // has a whole page of travel ahead of it either way.
    const column = document.getElementById(COLUMN_ID);
    const gap = frozen && column !== null ? parseFloat(getComputedStyle(column).marginTop) || 0 : 0;
    const top = frozen ? bar!.getBoundingClientRect().height + gap : 0;
    const height = panels.getBoundingClientRect().height;
    // Measured against what is left of the viewport under the bar, which is the space the pinned
    // panels actually compete with the board for.
    const tall = height > (window.innerHeight - top) * MAX_VIEWPORT_SHARE;
    root.classList.toggle(TALL_CLASS, tall);
    root.style.setProperty(TOP_PROPERTY, `${top}px`);
  };

  root.classList.add(ROOT_CLASS);
  // Once per injection rather than from `measure`: a theme is chosen between page loads, so this
  // cannot change under a table the way either of the measured heights can.
  publishBackdrop();
  measure();

  if (root.hasAttribute(WATCH_ATTRIBUTE)) return;
  root.setAttribute(WATCH_ATTRIBUTE, "1");

  /** True once the feature has been switched off, at which point every watcher below stands down. */
  const done = (): boolean => {
    if (root.classList.contains(ROOT_CLASS)) return false;
    root.removeAttribute(WATCH_ATTRIBUTE);
    return true;
  };

  // Both measurements move during a game: a player panel grows as its owner's board does, BGA
  // collapses and expands panels on click, and the folded bar changes height with the prompt in it.
  if (typeof ResizeObserver !== "undefined") {
    const sizes = new ResizeObserver(() => {
      if (done()) { sizes.disconnect(); return; }
      measure();
    });
    sizes.observe(panels);
    const bar = document.getElementById("topbar");
    if (bar) sizes.observe(bar);
  }

  // The viewport's height is the other half of the ceiling, and no element resizes when only the
  // window's height changes. Removes itself rather than being unregistered from elsewhere: a later
  // injection is a fresh function with none of this one's variables, so this handler is the only
  // thing able to reach itself.
  const onResize = (): void => {
    if (done()) { window.removeEventListener("resize", onResize); return; }
    measure();
  };
  window.addEventListener("resize", onResize);
}
