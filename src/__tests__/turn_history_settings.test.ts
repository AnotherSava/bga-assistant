// @vitest-environment jsdom
// Tests for the turn-history options every game with a history offers, and the two independent
// timestamp settings behind them: the panel's in localStorage, BGA's log column's in the shared
// chrome.storage.local object the service worker reads.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTurnHistoryOptions, applyTurnHistorySettings } from "../sidepanel/turn_history_settings.js";
import { INPAGE_LOG_KEY, INPAGE_DEFAULTS } from "../sidepanel/inpage_settings.js";

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  localStorage.clear();
  document.body.className = "";
  document.body.innerHTML = '<div id="section-selector"></div>';
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve(storage[key] !== undefined ? { [key]: storage[key] } : {})),
        set: vi.fn((items: Record<string, unknown>) => { Object.assign(storage, items); return Promise.resolve(); }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
});

function panel(): HTMLElement {
  return document.getElementById("section-selector")!;
}

function rows(): HTMLLabelElement[] {
  return Array.from(panel().querySelectorAll("label"));
}

/** The rows in the order they are appended: names, panel stamps, the log, the log's stamps. */
function row(index: number): { label: HTMLLabelElement; checkbox: HTMLInputElement } {
  const label = rows()[index];
  return { label, checkbox: label.querySelector("input")! };
}

const NAMES = 0, PANEL_TIMES = 1, LOG = 2, LOG_TIMES = 3;

function stored(): Record<string, unknown> {
  return (storage[INPAGE_LOG_KEY] ?? {}) as Record<string, unknown>;
}

/** Let the stored-settings read resolve. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Reopen the eye menu, the way each game's own builder does — it clears the panel, then appends.
 *  Rebuilding is how a stored setting is observed without reaching into the module for its getter. */
function reopen(options: Parameters<typeof buildTurnHistoryOptions>[1] = {}): void {
  panel().innerHTML = "";
  buildTurnHistoryOptions(panel(), options);
}

/** Flip a checkbox the way a click would, so its change handler runs. */
function toggle(index: number, checked: boolean): void {
  row(index).checkbox.checked = checked;
  row(index).checkbox.dispatchEvent(new Event("change"));
}

describe("turn-history menu rows", () => {
  it("offers names, the panel's stamps, the log and the log's own stamps, in that order", () => {
    buildTurnHistoryOptions(panel());
    expect(rows().map(l => l.textContent)).toEqual(["Show player names", "Show timestamps", "Show in BGA game log", "Show timestamps"]);
  });

  it("hangs the log's stamps under the log itself, one level deeper than its siblings", () => {
    buildTurnHistoryOptions(panel());
    expect(row(NAMES).label.className).toBe("");
    expect(row(PANEL_TIMES).label.className).toBe("");
    expect(row(LOG).label.className).toBe("");
    expect(row(LOG_TIMES).label.className).toBe("sub-option");
  });

  it("indents every row one level when nested under a turn-history checkbox", () => {
    buildTurnHistoryOptions(panel(), { nested: true });
    expect(row(NAMES).label.className).toBe("sub-option");
    expect(row(PANEL_TIMES).label.className).toBe("sub-option");
    expect(row(LOG).label.className).toBe("sub-option");
    expect(row(LOG_TIMES).label.className).toBe("sub-option-2");
  });
});

describe("the panel's own timestamps", () => {
  it("start on, since the panel has always stamped its rows", () => {
    buildTurnHistoryOptions(panel());
    expect(row(PANEL_TIMES).checkbox.checked).toBe(true);
  });

  it("survive a reopen, so the choice outlives the menu that made it", () => {
    buildTurnHistoryOptions(panel());
    toggle(PANEL_TIMES, false);

    reopen();
    expect(row(PANEL_TIMES).checkbox.checked).toBe(false);
  });

  it("mark the body when switched off, so the rows hide their stamps without re-rendering", () => {
    buildTurnHistoryOptions(panel());
    toggle(PANEL_TIMES, false);
    expect(document.body.classList.contains("hide-timestamps")).toBe(true);

    toggle(PANEL_TIMES, true);
    expect(document.body.classList.contains("hide-timestamps")).toBe(false);
  });

  it("are not mirrored into the shared store — the log keeps its own answer", async () => {
    buildTurnHistoryOptions(panel());
    await flush();
    toggle(PANEL_TIMES, false);
    await flush();
    // The log's own field must be untouched, and still readable as its default rather than absent.
    expect(stored().showTimestamps).toBeUndefined();
    reopen();
    await flush();
    expect(row(LOG_TIMES).checkbox.checked).toBe(true);
  });
});

describe("the log's timestamps", () => {
  it("read from the shared store the service worker pushes from", async () => {
    storage[INPAGE_LOG_KEY] = { ...INPAGE_DEFAULTS, enabled: true, showTimestamps: false };
    buildTurnHistoryOptions(panel());
    await flush();
    expect(row(LOG_TIMES).checkbox.checked).toBe(false);
  });

  it("write to that store rather than to the panel's localStorage", async () => {
    storage[INPAGE_LOG_KEY] = { ...INPAGE_DEFAULTS, enabled: true };
    buildTurnHistoryOptions(panel());
    await flush();

    toggle(LOG_TIMES, false);
    await flush();

    expect(stored().showTimestamps).toBe(false);
    // The panel's own answer is untouched: a reopened menu still shows it stamped.
    reopen();
    expect(row(PANEL_TIMES).checkbox.checked).toBe(true);
  });

  it("are disabled while the log is off, since there is nothing to stamp", async () => {
    buildTurnHistoryOptions(panel());
    await flush();
    expect(row(LOG_TIMES).checkbox.disabled).toBe(true);
    expect(row(LOG_TIMES).label.classList.contains("disabled")).toBe(true);
  });

  it("follow the log being switched without waiting for a reopen", async () => {
    buildTurnHistoryOptions(panel());
    await flush();

    toggle(LOG, true);
    expect(row(LOG_TIMES).checkbox.disabled).toBe(false);
    expect(row(LOG_TIMES).label.classList.contains("disabled")).toBe(false);
  });
});

describe("telling the game its history changed width", () => {
  it("fires for both panel toggles, with the class already applied so a measurement is not of the old layout", async () => {
    const seen: string[] = [];
    // Records the body's class at the moment of the call: a callback run before the class is
    // applied would measure the layout it is replacing, which is the bug this exists to stop.
    buildTurnHistoryOptions(panel(), { onLayoutChange: () => seen.push(document.body.className) });
    await flush();

    toggle(PANEL_TIMES, false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("hide-timestamps");

    toggle(NAMES, true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("show-player-names");
  });

  it("stays silent for the log's toggles, which change nothing in the panel", async () => {
    const seen: string[] = [];
    buildTurnHistoryOptions(panel(), { onLayoutChange: () => seen.push(document.body.className) });
    await flush();

    toggle(LOG, true);
    toggle(LOG_TIMES, false);
    await flush();

    expect(seen).toEqual([]);
  });

  it("is optional — a game that lays out nothing around the history passes none", async () => {
    buildTurnHistoryOptions(panel());
    await flush();
    row(PANEL_TIMES).checkbox.checked = false;
    expect(() => row(PANEL_TIMES).checkbox.dispatchEvent(new Event("change"))).not.toThrow();
  });
});

describe("player names still drive both surfaces", () => {
  it("mirrors into the shared store, unlike the timestamps beside it", async () => {
    buildTurnHistoryOptions(panel());
    await flush();

    toggle(NAMES, true);
    await flush();

    expect(stored().showPlayerNames).toBe(true);
    expect(document.body.classList.contains("show-player-names")).toBe(true);
  });
});

describe("applying the settings to a freshly rendered panel", () => {
  it("restores both classes from what is stored", () => {
    buildTurnHistoryOptions(panel());
    toggle(PANEL_TIMES, false);
    // As after a live update: the panel rebuilt its content and the classes have to go back on.
    document.body.className = "";

    applyTurnHistorySettings();
    expect(document.body.classList.contains("hide-timestamps")).toBe(true);
    expect(document.body.classList.contains("show-player-names")).toBe(false);

    toggle(PANEL_TIMES, true);
    document.body.className = "";
    applyTurnHistorySettings();
    expect(document.body.classList.contains("hide-timestamps")).toBe(false);
  });
});
