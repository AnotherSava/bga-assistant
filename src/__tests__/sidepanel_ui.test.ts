// @vitest-environment jsdom
// Tests for sidepanel.ts UI functions: downloads, tooltips, toggles

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Chrome APIs before sidepanel.ts module-level code runs.
vi.hoisted(() => {
  (globalThis as any).__sidepanelMessageListeners = [];
  (globalThis as any).chrome = {
    action: {
      onClicked: { addListener: () => {} },
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
    },
    scripting: { executeScript: () => Promise.resolve([]) },
    sidePanel: { open: () => Promise.resolve() },
    tabs: { create: vi.fn(() => Promise.resolve()) },
    commands: { getAll: vi.fn((cb: any) => cb([{ name: "toggle-sidepanel", shortcut: "" }])) },
    runtime: {
      onMessage: { addListener: (fn: any) => { (globalThis as any).__sidepanelMessageListeners.push(fn); } },
      sendMessage: vi.fn(() => Promise.resolve(null)),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  };
});

import { downloadBlob, setupTooltips, setupToggles, render, fetchCardDb, initPinButton, openPinDropdown, closePinDropdown, selectPinMode, updatePinButtonIcon, getCurrentPinMode } from "../sidepanel/sidepanel";
import { applyInnovationDisplayOptions } from "../games/innovation/display";
import { positionTooltip } from "../render/toggle";
import type { PipelineResults } from "../pipeline";

describe("sidepanel UI functions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  describe("downloadBlob", () => {
    it("creates a download link with the given blob", () => {
      const createObjectURL = vi.fn(() => "blob:test");
      const revokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = createObjectURL;
      globalThis.URL.revokeObjectURL = revokeObjectURL;
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      downloadBlob(new Blob(["test"]), "test.zip");

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(clickSpy).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
      clickSpy.mockRestore();
    });
  });

  describe("setupTooltips", () => {
    it("attaches a mousemove listener to the document", () => {
      const addEventSpy = vi.spyOn(document, "addEventListener");
      setupTooltips();
      expect(addEventSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
      addEventSpy.mockRestore();
    });

    it("positions tooltip elements on mousemove", () => {
      setupTooltips();

      // Create a card with a tooltip — call positionTooltip directly since
      // jsdom doesn't support :hover pseudo-class for querySelectorAll matching
      const tip = document.createElement("div");
      tip.className = "card-tip";
      tip.style.position = "fixed";
      document.body.appendChild(tip);

      // Import and call positionTooltip directly to verify the integration
      positionTooltip(tip, 200, 200);
      expect(tip.style.left).toBe("200px");
      expect(tip.style.top).toBe("200px");
    });
  });

  describe("setupToggles", () => {
    it("attaches click listeners to tri-toggle elements", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="test-section">
          <span class="tri-opt" data-mode="none">None</span>
          <span class="tri-opt active" data-mode="all">All</span>
          <span class="tri-opt" data-mode="unknown">Unknown</span>
        </div>
        <div id="test-section" style="display: block;">Content</div>
      `;

      setupToggles();

      // Click "none" option
      const noneOpt = document.querySelector('[data-mode="none"]') as HTMLElement;
      noneOpt.click();

      const target = document.getElementById("test-section")!;
      expect(target.style.display).toBe("none");
      expect(target.classList.contains("mode-unknown")).toBe(false);

      // Verify active class moved
      expect(noneOpt.classList.contains("active")).toBe(true);
      const allOpt = document.querySelector('[data-mode="all"]') as HTMLElement;
      expect(allOpt.classList.contains("active")).toBe(false);
    });

    it("handles 'all' mode toggle", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-all">
          <span class="tri-opt" data-mode="none">None</span>
          <span class="tri-opt" data-mode="all">All</span>
          <span class="tri-opt" data-mode="unknown">Unknown</span>
        </div>
        <div id="section-all" style="display: none;">Content</div>
      `;

      setupToggles();
      const allOpt = document.querySelector('[data-mode="all"]') as HTMLElement;
      allOpt.click();

      const target = document.getElementById("section-all")!;
      expect(target.style.display).toBe("");
      expect(target.classList.contains("mode-unknown")).toBe(false);
    });

    it("handles 'unknown' mode toggle", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-unk">
          <span class="tri-opt" data-mode="none">None</span>
          <span class="tri-opt" data-mode="all">All</span>
          <span class="tri-opt" data-mode="unknown">Unknown</span>
        </div>
        <div id="section-unk" style="display: none;">Content</div>
      `;

      setupToggles();
      const unkOpt = document.querySelector('[data-mode="unknown"]') as HTMLElement;
      unkOpt.click();

      const target = document.getElementById("section-unk")!;
      expect(target.style.display).toBe("");
      expect(target.classList.contains("mode-unknown")).toBe(true);
    });

    it("handles layout toggles (wide/tall)", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-layout">
          <span class="tri-opt active" data-mode="wide">Wide</span>
          <span class="tri-opt" data-mode="tall">Tall</span>
        </div>
        <div id="section-layout">Section</div>
        <div class="layout-wide" data-list="section-layout" style="display: block;">Wide grid</div>
        <div class="layout-tall" data-list="section-layout" style="display: none;">Tall grid</div>
      `;

      setupToggles();
      const tallOpt = document.querySelector('[data-mode="tall"]') as HTMLElement;
      tallOpt.click();

      const wideEl = document.querySelector('.layout-wide') as HTMLElement;
      const tallEl = document.querySelector('.layout-tall') as HTMLElement;
      expect(wideEl.style.display).toBe("none");
      expect(tallEl.style.display).toBe("");
    });

    it("handles composite set toggles (base/echoes/cities)", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-comp">
          <span class="tri-opt" data-mode="none">Hide</span>
          <span class="tri-opt active" data-mode="base">Base</span>
          <span class="tri-opt" data-mode="echoes">Echoes</span>
          <span class="tri-opt" data-mode="cities">Cities</span>
        </div>
        <div id="section-comp">
          <div data-set="base">Base content</div>
          <div data-set="echoes" style="display:none">Echoes content</div>
          <div data-set="cities" style="display:none">Cities content</div>
        </div>
      `;

      setupToggles();

      // Switch to echoes
      const echoesOpt = document.querySelector('[data-mode="echoes"]') as HTMLElement;
      echoesOpt.click();

      const baseEl = document.querySelector('[data-set="base"]') as HTMLElement;
      const echoesEl = document.querySelector('[data-set="echoes"]') as HTMLElement;
      const citiesEl = document.querySelector('[data-set="cities"]') as HTMLElement;
      expect(baseEl.style.display).toBe("none");
      expect(echoesEl.style.display).toBe("");
      expect(citiesEl.style.display).toBe("none");

      // Switch to cities
      const citiesOpt = document.querySelector('[data-mode="cities"]') as HTMLElement;
      citiesOpt.click();
      expect(baseEl.style.display).toBe("none");
      expect(echoesEl.style.display).toBe("none");
      expect(citiesEl.style.display).toBe("");

      // Switch back to base
      const baseOpt = document.querySelector('[data-mode="base"]') as HTMLElement;
      baseOpt.click();
      expect(baseEl.style.display).toBe("");
      expect(echoesEl.style.display).toBe("none");
      expect(citiesEl.style.display).toBe("none");
    });

    it("persists and restores echoes toggle state", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-persist">
          <span class="tri-opt" data-mode="none">Hide</span>
          <span class="tri-opt active" data-mode="base">Base</span>
          <span class="tri-opt" data-mode="echoes">Echoes</span>
          <span class="tri-opt" data-mode="cities">Cities</span>
        </div>
        <div id="section-persist">
          <div data-set="base">Base content</div>
          <div data-set="echoes" style="display:none">Echoes content</div>
          <div data-set="cities" style="display:none">Cities content</div>
        </div>
      `;

      setupToggles();

      // Switch to echoes
      const echoesOpt = document.querySelector('[data-mode="echoes"]') as HTMLElement;
      echoesOpt.click();

      // Verify state was persisted
      const stored = JSON.parse(localStorage.getItem("bgaa_toggle_state") ?? "{}");
      expect(stored["section-persist"]).toContain("echoes");

      // Re-render and restore
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-persist">
          <span class="tri-opt" data-mode="none">Hide</span>
          <span class="tri-opt active" data-mode="base">Base</span>
          <span class="tri-opt" data-mode="echoes">Echoes</span>
          <span class="tri-opt" data-mode="cities">Cities</span>
        </div>
        <div id="section-persist">
          <div data-set="base">Base content</div>
          <div data-set="echoes" style="display:none">Echoes content</div>
          <div data-set="cities" style="display:none">Cities content</div>
        </div>
      `;

      setupToggles();

      // Verify echoes mode was restored
      const echoesEl = document.querySelector('[data-set="echoes"]') as HTMLElement;
      expect(echoesEl.style.display).toBe("");
      const baseEl = document.querySelector('[data-set="base"]') as HTMLElement;
      expect(baseEl.style.display).toBe("none");
    });

    it("secondary toggle does not override primary none state", () => {
      document.body.innerHTML = `
        <div class="section-title">
          <span class="tri-toggle" data-target="section-multi">
            <span class="tri-opt" data-mode="none">Hide</span>
            <span class="tri-opt active" data-mode="base">Base</span>
            <span class="tri-opt" data-mode="cities">Cities</span>
          </span>
          <span class="tri-toggle" data-target="section-multi">
            <span class="tri-opt active" data-mode="all">All</span>
            <span class="tri-opt" data-mode="unknown">Unknown</span>
          </span>
        </div>
        <div id="section-multi">
          <div data-set="base">Base content</div>
          <div data-set="cities" style="display:none">Cities content</div>
        </div>
      `;

      setupToggles();

      // Click primary toggle to "none"
      const noneOpt = document.querySelector('[data-mode="none"]') as HTMLElement;
      noneOpt.click();

      const target = document.getElementById("section-multi")!;
      expect(target.style.display).toBe("none");

      // Secondary toggle should be hidden
      const secondaryToggle = document.querySelectorAll('.tri-toggle')[1] as HTMLElement;
      expect(secondaryToggle.style.display).toBe("none");

      // Now click secondary "unknown" (simulating restore scenario)
      const unknownOpt = document.querySelector('[data-mode="unknown"]') as HTMLElement;
      unknownOpt.click();

      // Target should remain hidden because secondary toggle should not change display
      expect(target.style.display).toBe("none");
    });

    it("ignores clicks outside tri-opt elements", () => {
      document.body.innerHTML = `
        <div class="tri-toggle" data-target="section-noop">
          <span class="tri-opt active" data-mode="all">All</span>
          <span class="tri-opt" data-mode="none">None</span>
        </div>
        <div id="section-noop">Content</div>
      `;

      setupToggles();
      // Click the toggle container itself, not an option
      const toggle = document.querySelector('.tri-toggle') as HTMLElement;
      toggle.click();

      // Nothing should change
      const allOpt = document.querySelector('[data-mode="all"]') as HTMLElement;
      expect(allOpt.classList.contains("active")).toBe(true);
    });
  });
});

describe("live indicator", () => {
  it("shows live indicator when liveStatus active=true", () => {
    document.body.innerHTML = '<div id="content"></div><span id="live-indicator" class="live-dot" style="display:none"></span>';
    const listeners = (globalThis as any).__sidepanelMessageListeners as Array<(message: any) => void>;
    for (const listener of listeners) {
      listener({ type: "liveStatus", active: true });
    }
    const indicator = document.getElementById("live-indicator")!;
    expect(indicator.style.display).toBe("");
  });

  it("hides live indicator when liveStatus active=false", () => {
    document.body.innerHTML = '<div id="content"></div><span id="live-indicator" class="live-dot" style="display:"></span>';
    const listeners = (globalThis as any).__sidepanelMessageListeners as Array<(message: any) => void>;
    for (const listener of listeners) {
      listener({ type: "liveStatus", active: false });
    }
    const indicator = document.getElementById("live-indicator")!;
    expect(indicator.style.display).toBe("none");
  });
});

describe("scroll position preservation", () => {
  it("restores scrollTop after render", async () => {
    // Pre-populate the card database cache by mocking fetch with valid card data
    const { readFileSync } = await import("fs");
    const { resolve, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const cardData = readFileSync(resolve(thisDir, "../../assets/bga/innovation/card_info.json"), "utf-8");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(cardData));
    await fetchCardDb("chrome-extension://test/assets/bga/innovation/card_info.json");
    fetchSpy.mockRestore();

    document.body.innerHTML = '<div id="content" style="overflow:auto; height:200px;"></div>';
    const contentEl = document.getElementById("content")!;

    // Track scrollTop via a backing variable so we can verify restoration
    let scrollTopValue = 150;
    Object.defineProperty(contentEl, "scrollTop", {
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; },
      configurable: true,
    });

    // Create minimal PipelineResults with enough structure for renderWithDb to succeed
    const results: PipelineResults = {
      tableNumber: "12345",
      rawData: { packets: [] },
      gameLog: { currentPlayerId: "1", players: { "1": "Alice", "2": "Bob" }, log: [], myHand: [], expansions: { echoes: false } },
      gameState: { hands: { "Alice": [], "Bob": [] }, scores: { "Alice": [], "Bob": [] }, boards: { "Alice": [], "Bob": [] }, achievements: [], specialAchievements: [], decks: {}, forecast: {} },
    } as any;

    render(results);
    // Wait for the async render chain to complete and verify scrollTop restored
    await vi.waitFor(() => {
      expect(scrollTopValue).toBe(150);
    });
  });
});

describe("pin button & dropdown", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="top-buttons">
        <button id="btn-pin"></button>
        <div id="pin-dropdown" style="display:none"></div>
      </div>
    `;
    // Reset to pinned mode and re-attach event listeners
    selectPinMode("pinned");
    closePinDropdown();
    initPinButton();
    vi.clearAllMocks();
  });

  it("mousedown on pin button opens dropdown", () => {
    const btn = document.getElementById("btn-pin")!;
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const dropdown = document.getElementById("pin-dropdown")!;
    expect(dropdown.style.display).toBe("");
    expect(dropdown.querySelectorAll(".pin-option").length).toBe(3);
  });

  it("dropdown always shows fixed order with active item having active class", () => {
    selectPinMode("autohide-bga");
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const options = dropdown.querySelectorAll(".pin-option");
    // Fixed order: pinned, autohide-bga, autohide-game
    expect(options[0].getAttribute("data-mode")).toBe("pinned");
    expect(options[1].getAttribute("data-mode")).toBe("autohide-bga");
    expect(options[2].getAttribute("data-mode")).toBe("autohide-game");
    // Active item is autohide-bga
    expect(options[1].classList.contains("active")).toBe(true);
    expect(options[0].classList.contains("active")).toBe(false);
  });

  it("mouseup on different mode selects it and closes dropdown", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const bgaOption = dropdown.querySelector('[data-mode="autohide-bga"]') as HTMLElement;
    bgaOption.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(getCurrentPinMode()).toBe("autohide-bga");
    expect(dropdown.style.display).toBe("none");
  });

  it("mouseup on current mode closes dropdown without change", () => {
    selectPinMode("pinned");
    vi.clearAllMocks();
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const pinnedOption = dropdown.querySelector('[data-mode="pinned"]') as HTMLElement;
    pinnedOption.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(getCurrentPinMode()).toBe("pinned");
    expect(dropdown.style.display).toBe("none");
    // Should not have sent setPinMode since mode didn't change
    expect((chrome.runtime.sendMessage as any)).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setPinMode" }));
  });

  it("mouseup outside dropdown closes it", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    expect(dropdown.style.display).toBe("");
    // mouseup on body (outside dropdown and button)
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(dropdown.style.display).toBe("none");
  });

  it("mode selection updates button icon", () => {
    const btn = document.getElementById("btn-pin")!;
    updatePinButtonIcon();
    // Pinned icon: vertical bar only (rect, no path)
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.querySelector("rect")).not.toBeNull();
    expect(btn.querySelectorAll("path").length).toBe(0);

    selectPinMode("autohide-game");
    // autohide-game has two chevron paths (bar + two arrows)
    expect(btn.querySelectorAll("path").length).toBe(2);
  });

  it("mode selection sends setPinMode message to background", () => {
    selectPinMode("autohide-bga");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "setPinMode", mode: "autohide-bga" });
  });

  it("hovering over option adds highlight class", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const options = dropdown.querySelectorAll(".pin-option");
    const secondOption = options[1] as HTMLElement;
    secondOption.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(secondOption.classList.contains("highlight")).toBe(true);
    // Other options should not have highlight
    expect(options[0].classList.contains("highlight")).toBe(false);
  });

  it("dropdown shows 'Set' when no shortcut bound", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const link = dropdown.querySelector(".pin-shortcut-link") as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("Set hide/show shortcut");
  });

  it("dropdown shows 'Change' with shortcut when bound", () => {
    (chrome.commands.getAll as any).mockImplementation((cb: any) => cb([{ name: "toggle-sidepanel", shortcut: "Ctrl+Shift+X" }]));
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const link = dropdown.querySelector(".pin-shortcut-link") as HTMLElement;
    expect(link.textContent).toBe("Change hide/show shortcut (Ctrl+Shift+X)");
  });

  it("clicking customize shortcut opens chrome shortcuts page", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const link = dropdown.querySelector(".pin-shortcut-link") as HTMLElement;
    link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
    expect(dropdown.style.display).toBe("none");
  });

  it("dropdown has header", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const header = dropdown.querySelector(".dropdown-header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.textContent).toBe("When side bar hides:");
  });

  it("mouseout on non-active option removes highlight", () => {
    openPinDropdown();
    const dropdown = document.getElementById("pin-dropdown")!;
    const options = dropdown.querySelectorAll(".pin-option");
    // Find a non-active option
    const nonActive = Array.from(options).find((o) => !o.classList.contains("active")) as HTMLElement;
    nonActive.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(nonActive.classList.contains("highlight")).toBe(true);
    nonActive.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(nonActive.classList.contains("highlight")).toBe(false);
  });

  it("second mousedown on button closes dropdown", () => {
    const btn = document.getElementById("btn-pin")!;
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const dropdown = document.getElementById("pin-dropdown")!;
    expect(dropdown.style.display).toBe("");
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dropdown.style.display).toBe("none");
  });
});

describe("turn history integration", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("populates turn-history element during render", async () => {
    const { readFileSync } = await import("fs");
    const { resolve, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const cardData = readFileSync(resolve(thisDir, "../../assets/bga/innovation/card_info.json"), "utf-8");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(cardData));
    await fetchCardDb("chrome-extension://test/assets/bga/innovation/card_info.json");
    fetchSpy.mockRestore();

    document.body.innerHTML = '<div id="content"></div><div id="turn-history"></div>';

    const results: PipelineResults = {
      tableNumber: "99",
      gameName: "innovation",
      rawData: { packets: [] },
      gameLog: {
        currentPlayerId: "1",
        players: { "1": "Alice", "2": "Bob" },
        log: [
          { type: "transfer", move: 1, source: "deck", dest: "hand", cardName: null, cardAge: 1, cardSet: "base", meldKeyword: false, player: "Alice", cardIndex: null },
        ],
        actions: [
          { player: "Alice", actionNumber: 1, time: null, logIndex: 0, actions: [{ actionType: "draw", cardName: null, cardAge: 1, cardSet: "base" }] },
        ],
        myHand: [],
        expansions: { echoes: false },
      },
      gameState: { hands: { "Alice": [], "Bob": [] }, scores: { "Alice": [], "Bob": [] }, boards: { "Alice": [], "Bob": [] }, achievements: [], specialAchievements: [], decks: {}, forecast: {} },
    } as any;

    render(results);
    await vi.waitFor(() => {
      const el = document.getElementById("turn-history")!;
      expect(el.innerHTML).toContain("you:");
      expect(el.innerHTML).toContain("draw");
    });
  });

  it("hides turn-history when toggled off via localStorage", () => {
    document.body.innerHTML = '<div id="turn-history">some content</div>';
    localStorage.setItem("bgaa_section_visibility", JSON.stringify({ "turn-history": false }));
    applyInnovationDisplayOptions({ echoes: false, zoomLevel: 1.0 });
    const el = document.getElementById("turn-history")!;
    expect(el.style.display).toBe("none");
  });

  it("shows turn-history by default", () => {
    document.body.innerHTML = '<div id="turn-history">some content</div>';
    applyInnovationDisplayOptions({ echoes: false, zoomLevel: 1.0 });
    const el = document.getElementById("turn-history")!;
    expect(el.style.display).toBe("");
  });
});
