import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadInPageSettings, saveInPageSettings, subscribeInPageSettings, INPAGE_LOG_KEY, INPAGE_LOG_DEFAULTS } from "../sidepanel/inpage_settings.js";

let storage: Record<string, unknown>;
let changeListeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[];

beforeEach(() => {
  storage = {};
  changeListeners = [];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve(storage[key] !== undefined ? { [key]: storage[key] } : {})),
        set: vi.fn((items: Record<string, unknown>) => { Object.assign(storage, items); return Promise.resolve(); }),
      },
      onChanged: {
        addListener: vi.fn((fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => { changeListeners.push(fn); }),
      },
    },
  };
});

describe("in-page log settings", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await loadInPageSettings()).toEqual(INPAGE_LOG_DEFAULTS);
  });

  it("round-trips a saved value", async () => {
    await saveInPageSettings({ enabled: true, showPlayerNames: true });
    const loaded = await loadInPageSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.showPlayerNames).toBe(true);
  });

  it("merges partial saves over existing values", async () => {
    await saveInPageSettings({ enabled: true });
    await saveInPageSettings({ showPlayerNames: true });
    const loaded = await loadInPageSettings();
    expect(loaded).toEqual({ ...INPAGE_LOG_DEFAULTS, enabled: true, showPlayerNames: true });
  });

  it("fills in fields missing from stored data", async () => {
    storage[INPAGE_LOG_KEY] = { enabled: true };
    expect(await loadInPageSettings()).toEqual({ ...INPAGE_LOG_DEFAULTS, enabled: true });
  });

  it("falls back to defaults when storage rejects", async () => {
    (globalThis as any).chrome.storage.local.get = vi.fn(() => Promise.reject(new Error("no storage")));
    expect(await loadInPageSettings()).toEqual(INPAGE_LOG_DEFAULTS);
  });

  it("notifies subscribers on change, ignoring other keys and areas", () => {
    const seen: unknown[] = [];
    subscribeInPageSettings(s => seen.push(s));

    changeListeners[0]({ [INPAGE_LOG_KEY]: { newValue: { enabled: true } } }, "local");
    expect(seen).toEqual([{ ...INPAGE_LOG_DEFAULTS, enabled: true }]);

    changeListeners[0]({ bgaa_something_else: { newValue: 1 } }, "local");
    changeListeners[0]({ [INPAGE_LOG_KEY]: { newValue: { enabled: false } } }, "sync");
    expect(seen).toHaveLength(1);
  });
});

describe("view switch is not a stored preference", () => {
  it("has no collapsed field — it is per-tab session state in the service worker", () => {
    expect(INPAGE_LOG_DEFAULTS).not.toHaveProperty("collapsed");
  });

  it("has no halfTurns field — widening must never become the new starting point", () => {
    expect(INPAGE_LOG_DEFAULTS).not.toHaveProperty("halfTurns");
  });
});
