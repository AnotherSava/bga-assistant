// Compact player panels: folds Nucleum's five resource counters onto one line in BGA's own
// player panels, and marks the first player with a wedge across the corner of theirs.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (ISOLATED world), so it must stay entirely self-contained — no imports, no module-scope
// references, no closures over anything in this file.

/**
 * Mount function injected into the page (ISOLATED world) to switch the compact panels on or off.
 *
 * Nearly all of it is CSS, and this carries the class that gates it. The game check lives here —
 * `.counterWrapper` and `.res` are Nucleum's own markup, not BGA framework, so no other game's
 * board may be touched.
 *
 * The one thing CSS cannot do is the first player's wedge. It was a `::before` on the panel, which
 * cannot hold a tooltip: a pseudo-element takes no attributes, and no selector can reveal one
 * pseudo-element from another's hover. So the wedge is a real element, put here and titled.
 */
export function playerPanelsFunction(opts: { enabled: boolean }): void {
  const ROOT_CLASS = "bgaa-compact-panels";
  const WEDGE_CLASS = "bgaa-first-player";
  const root = document.documentElement;

  // Unconditionally, and before anything else: this runs again on every navigation and every
  // settings change, so a wedge left from a previous run would otherwise stack up, or outlive the
  // player it marked if BGA rebuilt the panels with a different one going first.
  for (const stale of document.querySelectorAll("." + WEDGE_CLASS)) stale.remove();

  // Before the game check, so switching off reaches a frame whichever board it turned out to hold.
  if (!opts.enabled) {
    root.classList.remove(ROOT_CLASS);
    return;
  }

  // BGA puts the game's own class on the page wrapper. Absent in the shell and loader frames too,
  // which is the same bail every other injected mount here makes.
  if (!document.querySelector("#leftright_page_wrapper.bgagame-nucleum")) return;
  root.classList.add(ROOT_CLASS);

  // BGA marks the first player with a green disc carrying a "1", at the head of their score row. It
  // has no class and no id, and is the only unclassed `div` in any `.player_score` at the table — so
  // it is the one handle on that player, which is why the stylesheet hides it rather than this
  // removing it. Read here to find the panel the wedge belongs on.
  const disc = document.querySelector(".player_score > div:not([class]):not([id])");
  const panel = disc ? disc.closest(".player-board") : null;
  if (!panel) return;

  const wedge = document.createElement("div");
  wedge.className = WEDGE_CLASS;
  // Native `title` rather than a styled tooltip of our own: BGA's board carries transforms and
  // clipping that a positioned element has to fight — the in-page log needed the top layer to escape
  // them — while the browser draws this one outside the document entirely.
  wedge.title = "First player (fixed for the whole game)";
  panel.appendChild(wedge);
}
