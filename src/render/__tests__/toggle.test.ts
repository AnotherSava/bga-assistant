// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { applyToggleMode } from "../toggle.js";
import { SUMMARY_JS } from "../../games/innovation/render.js";

describe("applyToggleMode", () => {
  let container: HTMLElement;

  function buildToggle(targetId: string, modes: string[], activeMode?: string): HTMLElement {
    const toggle = document.createElement("span");
    toggle.className = "tri-toggle";
    toggle.setAttribute("data-target", targetId);
    for (const mode of modes) {
      const opt = document.createElement("span");
      opt.className = "tri-opt" + (mode === activeMode ? " active" : "");
      opt.setAttribute("data-mode", mode);
      opt.textContent = mode;
      toggle.appendChild(opt);
    }
    return toggle;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("activates the correct tri-opt and deactivates others", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    document.body.appendChild(target);

    const toggle = buildToggle("test-section", ["all", "none"], "all");
    container.appendChild(toggle);

    applyToggleMode(toggle, "none", "test-section");

    const opts = toggle.querySelectorAll(".tri-opt");
    expect(opts[0].classList.contains("active")).toBe(false);
    expect(opts[1].classList.contains("active")).toBe(true);
  });

  it("hides target when mode is none", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    document.body.appendChild(target);

    const toggle = buildToggle("test-section", ["all", "none"]);
    container.appendChild(toggle);

    applyToggleMode(toggle, "none", "test-section");
    expect(target.style.display).toBe("none");
  });

  it("shows target and filters data-set children for composite modes", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    const baseDiv = document.createElement("div");
    baseDiv.setAttribute("data-set", "base");
    const echoesDiv = document.createElement("div");
    echoesDiv.setAttribute("data-set", "echoes");
    target.appendChild(baseDiv);
    target.appendChild(echoesDiv);
    document.body.appendChild(target);

    const toggle = buildToggle("test-section", ["base", "echoes", "none"]);
    container.appendChild(toggle);

    applyToggleMode(toggle, "echoes", "test-section");
    expect(target.style.display).toBe("");
    expect(baseDiv.style.display).toBe("none");
    expect(echoesDiv.style.display).toBe("");
  });

  it("toggles mode-unknown class for all/unknown modes", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    document.body.appendChild(target);

    const toggle = buildToggle("test-section", ["all", "unknown"]);
    container.appendChild(toggle);

    applyToggleMode(toggle, "unknown", "test-section");
    expect(target.classList.contains("mode-unknown")).toBe(true);

    applyToggleMode(toggle, "all", "test-section");
    expect(target.classList.contains("mode-unknown")).toBe(false);
  });

  it("switches wide/tall layout elements", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    document.body.appendChild(target);

    const wide = document.createElement("div");
    wide.className = "layout-wide";
    wide.setAttribute("data-list", "test-section");
    const tall = document.createElement("div");
    tall.className = "layout-tall";
    tall.setAttribute("data-list", "test-section");
    document.body.appendChild(wide);
    document.body.appendChild(tall);

    const toggle = buildToggle("test-section", ["wide", "tall"]);
    container.appendChild(toggle);

    applyToggleMode(toggle, "tall", "test-section");
    expect(wide.style.display).toBe("none");
    expect(tall.style.display).toBe("");

    applyToggleMode(toggle, "wide", "test-section");
    expect(wide.style.display).toBe("");
    expect(tall.style.display).toBe("none");
  });

  it("hides sibling toggles when primary toggle sets none", () => {
    const target = document.createElement("div");
    target.id = "test-section";
    document.body.appendChild(target);

    const primary = buildToggle("test-section", ["all", "none"]);
    const secondary = buildToggle("test-section", ["wide", "tall"]);
    container.appendChild(primary);
    container.appendChild(secondary);

    applyToggleMode(primary, "none", "test-section");
    expect(secondary.style.display).toBe("none");

    applyToggleMode(primary, "all", "test-section");
    expect(secondary.style.display).toBe("");
  });

  it("does nothing when target does not exist", () => {
    const toggle = buildToggle("nonexistent", ["all", "none"]);
    container.appendChild(toggle);
    // Should not throw
    applyToggleMode(toggle, "none", "nonexistent");
  });
});

describe("SUMMARY_JS", () => {
  it("is valid standalone JavaScript", () => {
    // new Function() parses the code; throws SyntaxError if invalid
    expect(() => new Function(SUMMARY_JS)).not.toThrow();
  });

  it("contains the serialized shared functions", () => {
    expect(SUMMARY_JS).toContain("applyToggleMode");
  });
});
