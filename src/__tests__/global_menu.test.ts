// @vitest-environment jsdom
// Tests for the help page's eye menu: the settings that apply across BGA rather than to one game.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildGlobalDisplayMenu } from "../sidepanel/global_menu.js";
import { INPAGE_LOG_KEY, INPAGE_DEFAULTS } from "../sidepanel/inpage_settings.js";

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
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

function checkbox(): HTMLInputElement {
  return document.getElementById("setting-compact-header") as HTMLInputElement;
}

/** Let the stored-settings read resolve. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("global display menu", () => {
  it("offers the compact header setting", () => {
    buildGlobalDisplayMenu(panel());
    expect(checkbox()).not.toBeNull();
    expect(panel().textContent).toContain("Compact BGA header");
  });

  it("says the setting reaches every game, since the panel cannot show its effect", () => {
    buildGlobalDisplayMenu(panel());
    expect(panel().querySelector(".dropdown-note")!.textContent).toContain("every game");
  });

  it("reflects the stored value", async () => {
    storage[INPAGE_LOG_KEY] = { ...INPAGE_DEFAULTS, compactHeader: false };
    buildGlobalDisplayMenu(panel());
    await flush();
    expect(checkbox().checked).toBe(false);
  });

  it("is off when nothing is stored, since it changes BGA's own page", async () => {
    buildGlobalDisplayMenu(panel());
    await flush();
    expect(checkbox().checked).toBe(false);
  });

  it("writes the shared store, so the in-page header and the game menus stay in step", async () => {
    buildGlobalDisplayMenu(panel());
    await flush();

    checkbox().checked = false;
    checkbox().dispatchEvent(new Event("change"));
    await flush();

    expect((storage[INPAGE_LOG_KEY] as Record<string, unknown>).compactHeader).toBe(false);
  });

  it("rebuilds cleanly, leaving one checkbox per open", () => {
    buildGlobalDisplayMenu(panel());
    buildGlobalDisplayMenu(panel());
    expect(panel().querySelectorAll("#setting-compact-header")).toHaveLength(1);
  });
});

describe("progression-only sub-option", () => {
  function progression(): HTMLInputElement {
    return document.getElementById("setting-progression-only") as HTMLInputElement;
  }

  it("is offered under the compact header", () => {
    buildGlobalDisplayMenu(panel());
    expect(progression()).not.toBeNull();
    expect(progression().closest("label")!.className).toContain("sub-option");
  });

  it("is off by default, leaving BGA's table info as it is", async () => {
    buildGlobalDisplayMenu(panel());
    await flush();
    expect(progression().checked).toBe(false);
  });

  it("writes the shared store", async () => {
    buildGlobalDisplayMenu(panel());
    await flush();

    progression().checked = true;
    progression().dispatchEvent(new Event("change"));
    await flush();

    expect((storage[INPAGE_LOG_KEY] as Record<string, unknown>).progressionOnly).toBe(true);
  });

  it("is disabled while the compact header is off, since there is nothing to pare down", async () => {
    storage[INPAGE_LOG_KEY] = { ...INPAGE_DEFAULTS, compactHeader: false };
    buildGlobalDisplayMenu(panel());
    await flush();
    expect(progression().disabled).toBe(true);
  });

  it("follows the compact header being switched without waiting for a reopen", async () => {
    storage[INPAGE_LOG_KEY] = { ...INPAGE_DEFAULTS, compactHeader: true };
    buildGlobalDisplayMenu(panel());
    await flush();
    expect(progression().disabled).toBe(false);

    checkbox().checked = false;
    checkbox().dispatchEvent(new Event("change"));
    expect(progression().disabled).toBe(true);
  });
});
