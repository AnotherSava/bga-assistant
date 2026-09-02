// Persisted settings for what the extension changes on BGA's own page, stored in
// chrome.storage.local.
//
// These are defaults, re-applied every time a game table is opened. The in-page view switch is
// deliberately NOT here: it is a temporary, per-tab override held in the service worker, so
// flipping to BGA's log lasts for that table rather than becoming a new preference.
//
// Deliberately separate from settings.ts, which is synchronous localStorage. Two contexts need
// these values that localStorage cannot serve: the service worker has no localStorage at all,
// and a content script's localStorage belongs to boardgamearena.com rather than the extension.
// chrome.storage.local is the only store all three surfaces share.
//
// The existing 17 bgaa_ localStorage keys stay where they are — they are read inline from
// render paths, so converting them to async would be a large unrelated refactor.

/** Storage key. Still named for the log alone, which was the first of these settings: renaming it
 *  would silently drop what every existing user has already chosen. */
export const INPAGE_LOG_KEY = "bgaa_inpage_log";

/**
 * Half-turns shown when a table opens.
 *
 * A constant, not a stored setting: the in-page "more..." control widens the window per tab for
 * the current table only, and nothing else can change it. Persisting it once meant every widen
 * silently became the new starting point for every table.
 */
export const INPAGE_LOG_HALF_TURNS = 9;

export interface InPageSettings {
  /** Render turn history into BGA's log column. Named before this store held anything else. */
  enabled: boolean;
  /** Show full player names rather than "you"/"opp". Mirrored from the panel's own toggle. */
  showPlayerNames: boolean;
  /** Fold BGA's status bar and Innovation's board buttons into the topbar, as a single row. */
  compactHeader: boolean;
  /** Leave the progression figure alone in the folded header, without the table id and move number. */
  progressionOnly: boolean;
  /** Keep BGA's player panels, and the turn history's view switch, at the top of their column. */
  stickyPanels: boolean;
  /** Draw Innovation's own hand and every board with the side panel's compact card. */
  simplifiedCards: boolean;
  /** Size of those cards, as a percentage of the side panel's own. Only `CARD_SCALE_STEP` steps. */
  cardScale: number;
  /** Print an Echo card's effect in full on the card, rather than marking the slot as holding text. */
  echoText: boolean;
  /** Draw the opponents' face-down hands as those cards too, with what is known about each. */
  opponentHands: boolean;
  /** Fold Nucleum's five resource counters onto one line in BGA's own player panels. */
  compactPlayerPanels: boolean;
  /** Tint BGA's top bar when the viewer must act during another player's turn (a reaction). */
  actionTint: boolean;
  /** Scroll of the action-tint stripes: 0 = static, sign = direction, magnitude 1–5 = speed. */
  actionTintSpeed: number;
}

/** Bounds of the simplified cards' size slider, in percent. */
export const CARD_SCALE_MIN = 100;
export const CARD_SCALE_MAX = 200;
export const CARD_SCALE_STEP = 10;

/**
 * The size a local build starts the simplified cards at.
 *
 * Larger than the store default (`CARD_SCALE_MIN`) so the cards are legible while they are being
 * worked on, without turning the slider up after every reload — the same reasoning that has a local
 * build switch the in-page features on. A valid slider step (100 + 5×10), so it lands on a notch.
 */
export const CARD_SCALE_LOCAL_DEFAULT = 150;

/** Bounds of the action-tint movement slider: −5…+5, with 0 (static) at centre and ±5 magnitudes. */
export const ACTION_TINT_SPEED_MIN = -5;
export const ACTION_TINT_SPEED_MAX = 5;
export const ACTION_TINT_SPEED_STEP = 1;
/** The scroll speed the stripes shipped with, placed at the middle magnitude so there is room both ways. */
export const ACTION_TINT_SPEED_DEFAULT = 3;

export const INPAGE_DEFAULTS: InPageSettings = {
  enabled: false,
  showPlayerNames: false,
  compactHeader: false,
  progressionOnly: false,
  stickyPanels: false,
  simplifiedCards: false,
  cardScale: CARD_SCALE_MIN,
  echoText: false,
  opponentHands: false,
  compactPlayerPanels: false,
  actionTint: false,
  actionTintSpeed: ACTION_TINT_SPEED_DEFAULT,
};

/**
 * The id Chrome assigns the published build. Mirrors `cws-publish.json`, which is the record of what
 * was uploaded; it is repeated here rather than imported so store-listing data stays out of the
 * shipped bundle.
 */
const PUBLISHED_EXTENSION_ID = "idjijmafngfkkbppkgopldomfhdcedig";

/**
 * Whether this is an unpacked build loaded from disk rather than the store one.
 *
 * Chrome derives an unpacked extension's id from its path, so only the published build carries the
 * id above. `chrome.management.getSelf()` would answer this outright but costs the "management"
 * permission and its warning on the listing, for something a string comparison settles.
 */
export function isUnpackedBuild(): boolean {
  try {
    return chrome.runtime.id !== PUBLISHED_EXTENSION_ID;
  } catch {
    return false;
  }
}

/**
 * The defaults as they apply to this build.
 *
 * The settings that put something on BGA's own page — the in-page log, the compact header, the pinned
 * panels, the simplified cards, the compact player panels and the opponents' hands among them — differ: a store build leaves all
 * of them to be asked for, while a local build has them on, since that is where they are being worked
 * on and switching them back on after every reload is friction with no purpose. `echoText` rides
 * along on a local build too — it restyles the simplified cards, which are on there — so an Echo card's
 * effect is legible while it is being worked on. `showPlayerNames` and `progressionOnly` stay off
 * either way, only restyling what the others already turned on. A local build also starts the
 * simplified cards at `CARD_SCALE_LOCAL_DEFAULT` rather than the store's 100%, for the same reason.
 */
function buildDefaults(): InPageSettings {
  const unpacked = isUnpackedBuild();
  return { ...INPAGE_DEFAULTS, enabled: unpacked, compactHeader: unpacked, stickyPanels: unpacked, simplifiedCards: unpacked, opponentHands: unpacked, compactPlayerPanels: unpacked, actionTint: unpacked, echoText: unpacked, cardScale: unpacked ? CARD_SCALE_LOCAL_DEFAULT : INPAGE_DEFAULTS.cardScale };
}

export async function loadInPageSettings(): Promise<InPageSettings> {
  try {
    const stored = await chrome.storage.local.get(INPAGE_LOG_KEY);
    return { ...buildDefaults(), ...(stored[INPAGE_LOG_KEY] ?? {}) };
  } catch {
    return buildDefaults();
  }
}

export async function saveInPageSettings(partial: Partial<InPageSettings>): Promise<InPageSettings> {
  const current = await loadInPageSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [INPAGE_LOG_KEY]: next });
  return next;
}

/** Call `callback` whenever the in-page settings change in any context. */
export function subscribeInPageSettings(callback: (settings: InPageSettings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[INPAGE_LOG_KEY]) return;
    callback({ ...buildDefaults(), ...(changes[INPAGE_LOG_KEY].newValue ?? {}) });
  });
}
