// Shared toggle DOM functions.
// Used directly by the side panel and serialized via .toString() into
// standalone HTML downloads (SUMMARY_JS in render.ts).
// IMPORTANT: these functions must be self-contained (DOM APIs only, no imports)
// so that .toString() produces valid standalone JavaScript.

/** Apply a toggle mode to a section target element. */
export function applyToggleMode(toggle: HTMLElement, mode: string, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;

  toggle.querySelectorAll(".tri-opt").forEach((o) => o.classList.remove("active"));
  toggle.querySelector(`.tri-opt[data-mode="${mode}"]`)?.classList.add("active");

  // Only the primary (first) toggle for a target controls visibility and sibling display
  const allToggles = toggle.parentElement?.querySelectorAll(`.tri-toggle[data-target="${targetId}"]`);
  const isPrimary = !allToggles || allToggles[0] === toggle;

  if (isPrimary) {
    const siblingDisplay = mode === "none" ? "none" : "";
    allToggles?.forEach((sib) => {
      if (sib !== toggle) (sib as HTMLElement).style.display = siblingDisplay;
    });
  }

  if (mode === "none") {
    target.style.display = "none";
  } else if (mode === "base" || mode === "echoes" || mode === "cities" || mode === "artifacts") {
    target.style.display = "";
    target.querySelectorAll("[data-set]").forEach((el) => {
      (el as HTMLElement).style.display = el.getAttribute("data-set") === mode ? "" : "none";
    });
  } else if (mode === "all") {
    if (isPrimary) target.style.display = "";
    target.classList.remove("mode-unknown");
  } else if (mode === "unknown") {
    if (isPrimary) target.style.display = "";
    target.classList.add("mode-unknown");
  } else if (mode === "wide" || mode === "tall") {
    document.querySelectorAll(`.layout-wide[data-list="${targetId}"]`).forEach((el) => {
      (el as HTMLElement).style.display = mode === "wide" ? "" : "none";
    });
    document.querySelectorAll(`.layout-tall[data-list="${targetId}"]`).forEach((el) => {
      (el as HTMLElement).style.display = mode === "tall" ? "" : "none";
    });
  }
}
