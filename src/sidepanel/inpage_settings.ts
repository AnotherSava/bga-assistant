// Persisted settings for the in-page game log, stored in chrome.storage.local.
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

export const INPAGE_LOG_KEY = "bgaa_inpage_log";

/**
 * Half-turns shown when a table opens.
 *
 * A constant, not a stored setting: the in-page "more..." control widens the window per tab for
 * the current table only, and nothing else can change it. Persisting it once meant every widen
 * silently became the new starting point for every table.
 */
export const INPAGE_LOG_HALF_TURNS = 9;

export interface InPageLogSettings {
  /** Render turn history into BGA's log column. */
  enabled: boolean;
  /** Show full player names rather than "you"/"opp". Mirrored from the panel's own toggle. */
  showPlayerNames: boolean;
}

export const INPAGE_LOG_DEFAULTS: InPageLogSettings = {
  enabled: false,
  showPlayerNames: false,
};

export async function loadInPageSettings(): Promise<InPageLogSettings> {
  try {
    const stored = await chrome.storage.local.get(INPAGE_LOG_KEY);
    return { ...INPAGE_LOG_DEFAULTS, ...(stored[INPAGE_LOG_KEY] ?? {}) };
  } catch {
    return { ...INPAGE_LOG_DEFAULTS };
  }
}

export async function saveInPageSettings(partial: Partial<InPageLogSettings>): Promise<InPageLogSettings> {
  const current = await loadInPageSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [INPAGE_LOG_KEY]: next });
  return next;
}

/** Call `callback` whenever the in-page log settings change in any context. */
export function subscribeInPageSettings(callback: (settings: InPageLogSettings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[INPAGE_LOG_KEY]) return;
    callback({ ...INPAGE_LOG_DEFAULTS, ...(changes[INPAGE_LOG_KEY].newValue ?? {}) });
  });
}
