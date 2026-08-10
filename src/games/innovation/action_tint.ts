// Action-required top-bar tint: amber-highlights BGA's #topbar when the viewer must act DURING
// another player's turn — a reaction/interrupt, not their own turn.
//
// Runs in the MAIN world (it reads window.gameui) and is serialized by chrome.scripting.executeScript,
// so it must stay entirely self-contained — no imports, no module-scope references, no closures over
// anything in this file.
//
// BGA exposes no single live "whose turn is it" field, and the viewer is "active" in BOTH their own
// turn and a forced reaction — worse, Innovation routes a reaction AND the launcher's own dogma choices
// through the same `selectionMove` state, so isCurrentPlayerActive() and the state name alone cannot
// tell them apart. So the turn OWNER is reconstructed live from the state machine: every turn-
// establishing state (playerTurn and the artifact/relic/promote variants) publishes its active player
// as the owner, and the tint fires only while the viewer is active in a `selectionMove` the owner is
// someone else in. Reading gameui live keeps the owner fresh (no extraction lag), so the viewer's own
// turn can never tint. All state names are Innovation's, verified against gameui.gamedatas.gamestates.

/**
 * Mount function injected into the page (MAIN world) to toggle the action-required tint.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for injection.
 */
export function actionTintFunction(opts: { enabled: boolean; speed: number }): void {
  const CLASS = "bgaa-action-required";
  const WATCH_ATTR = "data-bgaa-tint-watch";
  const STATE_KEY = "__bgaaActionTint";
  /** How often to re-read gameui. Cheap — a state-name lookup and a boolean. */
  const POLL_MS = 500;
  /** Innovation states that establish whose turn it is: the owner is that state's active player. */
  const TURN_STATES = ["playerTurn", "artifactPlayerTurn", "relicPlayerTurn", "promoteCardPlayerTurn", "dogmaPromotedPlayerTurn"];
  /** Innovation's within-turn choice state: the viewer is active, but the turn may be an opponent's. */
  const REACTION_STATES = ["selectionMove"];

  const root = document.documentElement;

  type TintState = { poll: ReturnType<typeof setInterval> | null; owner: string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = window as any;

  const teardown = (): void => {
    const state = store[STATE_KEY] as TintState | undefined;
    if (state && state.poll !== null) clearInterval(state.poll);
    store[STATE_KEY] = undefined;
    root.classList.remove(CLASS);
    root.removeAttribute(WATCH_ATTR);
    root.style.removeProperty("--bgaa-tape-play");
    root.style.removeProperty("--bgaa-tape-duration");
    root.style.removeProperty("--bgaa-tape-direction");
  };

  // Only an Innovation board: the state names are Innovation's, and only Innovation has cross-turn
  // reactions. Every frame of the tab receives the injection; the shell/loader and other games bail
  // (and, if this frame previously had it on, tear it down).
  if (!opts.enabled || !document.querySelector(".bgagame-innovation")) { teardown(); return; }

  // Publish the stripes' scroll for the stylesheet (every injection, so a settings change updates it):
  // magnitude 1–5 sets the duration, 0 pauses it (static), and the sign flips the direction.
  const DURATIONS = ["1s", "2.4s", "1.5s", "1s", "0.6s", "0.35s"]; // index 0 unused; 1..5 = magnitude
  const magnitude = Math.max(0, Math.min(5, Math.abs(Math.round(opts.speed))));
  root.style.setProperty("--bgaa-tape-play", magnitude === 0 ? "paused" : "running");
  root.style.setProperty("--bgaa-tape-duration", DURATIONS[magnitude] || "1s");
  root.style.setProperty("--bgaa-tape-direction", opts.speed < 0 ? "reverse" : "normal");

  const sync = (): void => {
    const state = store[STATE_KEY] as TintState | undefined;
    if (!state) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gui = (window as any).gameui;
    const gamestate = gui && gui.gamedatas && gui.gamedatas.gamestate;
    const name = gamestate && typeof gamestate.name === "string" ? gamestate.name : null;
    // Seed the owner from the load-time top-level active player until a turn state supplies it, so
    // opening straight into a pending reaction already knows the turn is the opponent's (that field
    // holds the launcher, not the reactor, at load). Retried each tick until gameui is ready.
    if (state.owner === null && gui && gui.gamedatas && gui.gamedatas.active_player != null) {
      state.owner = String(gui.gamedatas.active_player);
    }
    // Track the owner live from every turn-establishing state — fresh, with no extraction lag, so the
    // viewer's own turn (a turn state, owner = you) can never be mistaken for a reaction.
    if (name !== null && TURN_STATES.indexOf(name) !== -1 && gamestate.active_player != null) {
      state.owner = String(gamestate.active_player);
    }
    const active = !!(gui && typeof gui.isCurrentPlayerActive === "function" && gui.isCurrentPlayerActive() === true);
    const me = gui && gui.player_id != null ? String(gui.player_id) : null;
    const tint = active && name !== null && REACTION_STATES.indexOf(name) !== -1 && state.owner !== null && me !== null && state.owner !== me;
    root.classList.toggle(CLASS, tint);
  };

  // One-time setup: a poll re-reads gameui directly, so it depends on nothing about BGA's DOM. A later
  // injection reuses this same poll (guarded here) and only re-syncs.
  if (!root.hasAttribute(WATCH_ATTR)) {
    root.setAttribute(WATCH_ATTR, "1");
    const state: TintState = { poll: null, owner: null };
    store[STATE_KEY] = state;
    state.poll = setInterval(sync, POLL_MS);
  }

  sync();
}
