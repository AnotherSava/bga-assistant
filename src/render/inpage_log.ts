// In-page game log: mounts Innovation turn history into BGA's own log column.
//
// The exported function is serialized by chrome.scripting.executeScript and runs in the page
// (ISOLATED world), so it must stay entirely self-contained — no imports, no module-scope
// references, no closures over anything in this file.

/**
 * Mount function injected into the page (ISOLATED world) to render turn history into BGA's
 * game log column.
 *
 * Must be self-contained (no closures or external references) — Chrome serializes it for
 * injection. Rows arrive pre-rendered by the service worker, so the card database never
 * enters the page.
 */
export function inPageLogFunction(rows: { key: string; html: string }[], opts: { enabled: boolean; collapsed: boolean; showPlayerNames: boolean; halfTurns: number; hasMore: boolean }): void {
  const HIDE_CLASS = "bgaa-hide-bga-log";
  const logsWrap = document.querySelector("#logs_wrap");
  if (!logsWrap) return;  // Not the board frame (shell/loader frames), or BGA restructured the log area.

  const existingContainer = document.getElementById("bgaa-inpage-log");

  if (!opts.enabled) {
    // Unmount and restore BGA's log rather than leaving the column empty.
    if (existingContainer) existingContainer.remove();
    document.getElementById("bgaa-inpage-log-view")?.remove();
    document.documentElement.classList.remove(HIDE_CLASS);
    return;
  }

  // Re-mount when BGA has rebuilt the log area. A one-way "already mounted" latch would leave
  // the user with BGA's log hidden and nothing in its place.
  let container = existingContainer && existingContainer.isConnected ? existingContainer : null;
  let rowsEl: HTMLElement;

  if (!container) {
    container = document.createElement("div");
    container.id = "bgaa-inpage-log";

    // Header holds only the view switch; the window control belongs at the far end of the
    // history, where the oldest rows are.
    const header = document.createElement("div");
    header.id = "bgaa-inpage-log-header";
    container.appendChild(header);

    rowsEl = document.createElement("div");
    rowsEl.id = "bgaa-inpage-log-rows";
    container.appendChild(rowsEl);

    const footer = document.createElement("div");
    footer.id = "bgaa-inpage-log-footer";
    const earlier = document.createElement("button");
    earlier.id = "bgaa-inpage-log-earlier";
    earlier.textContent = "more...";
    // Reads the current window off the container rather than closing over `opts`: listeners are
    // attached once, but the container is reused on every push, so a captured value goes stale.
    earlier.addEventListener("click", () => {
      // No default here: the service worker owns the starting window and stamps it onto the
      // container every push, so a fallback constant could only ever drift out of sync with it.
      const current = Number(document.getElementById("bgaa-inpage-log")?.dataset.halfTurns);
      if (!Number.isFinite(current)) return;
      chrome.runtime.sendMessage({ type: "setInPageLog", patch: { halfTurns: current + 3 } }).catch(() => {});
    });
    footer.appendChild(earlier);
    container.appendChild(footer);

    // Sibling of #logs, never a child: the live watcher observes #logs with subtree:true, so
    // rendering inside it would be an infinite mutation loop.
    const logs = logsWrap.querySelector("#logs");
    if (logs) logsWrap.insertBefore(container, logs);
    else logsWrap.appendChild(container);

    // Card tips are promoted to the top layer so BGA's max-height on #logs cannot clip them.
    // Delegated because rows are reconciled — per-row listeners would be lost on replacement.
    const tipOf = (target: EventTarget | null): HTMLElement | null => {
      const el = target instanceof Element ? target.closest(".th-card") : null;
      return el ? el.querySelector<HTMLElement>(":scope > .card-tip") : null;
    };

    /**
     * Place the tip against its card in viewport coordinates.
     *
     * CSS anchor positioning drives this in the side panel, but it cannot be relied on here:
     * the tip is a descendant of its own anchor and is promoted into the top layer inside
     * BGA's transformed board, and when anchor() fails to resolve the insets collapse and the
     * tip lands against the viewport edge. The top layer already gives us the viewport as the
     * containing block, so plain fixed coordinates are both simpler and deterministic.
     */
    const placeTip = (card: Element, tip: HTMLElement): void => {
      const rect = card.getBoundingClientRect();
      const width = tip.offsetWidth || 375;
      const height = tip.offsetHeight || 275;
      const gap = 4;
      const below = rect.bottom + gap;
      // Flip above the card when it would overflow the bottom, and pull back from the right.
      const top = below + height > window.innerHeight ? Math.max(gap, rect.top - gap - height) : below;
      const left = Math.max(gap, Math.min(rect.left, window.innerWidth - width - gap));
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    };

    container.addEventListener("pointerover", (event) => {
      const card = event.target instanceof Element ? event.target.closest(".th-card") : null;
      const tip = tipOf(event.target);
      if (!card || !tip || tip.matches(":popover-open")) return;
      try { tip.showPopover(); } catch { /* already open */ }
      // After showing: the tip has no layout box until it is open, so its size is unknown.
      placeTip(card, tip);
    });
    container.addEventListener("pointerout", (event) => {
      const card = event.target instanceof Element ? event.target.closest(".th-card") : null;
      if (!card) return;
      // Ignore moves between children of the same card.
      const to = (event as PointerEvent).relatedTarget;
      if (to instanceof Node && card.contains(to)) return;
      const tip = card.querySelector<HTMLElement>(":scope > .card-tip");
      if (tip && tip.matches(":popover-open")) { try { tip.hidePopover(); } catch { /* already closed */ } }
    });
  } else {
    rowsEl = container.querySelector<HTMLElement>("#bgaa-inpage-log-rows")!;
  }

  let view = document.getElementById("bgaa-inpage-log-view") as HTMLButtonElement | null;
  if (!view) {
    // Flips `collapsed` rather than `enabled`: disabling the feature from here would remove the
    // only control able to bring the turn history back while the side panel is closed.
    view = document.createElement("button");
    view.id = "bgaa-inpage-log-view";
    view.type = "button";
    // An inline glyph rather than the extension's own bulb artwork: that art is drawn for a
    // light background — its base is dark purple and its glow is purple-pink — so at this size
    // on BGA's dark column it reads as a purple blob with no visible base. This takes its
    // colour from CSS, so lit/unlit is a colour change and the shape never moves.
    view.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>';
    view.addEventListener("click", () => {
      const isCollapsed = document.getElementById("bgaa-inpage-log")?.dataset.collapsed === "true";
      chrome.runtime.sendMessage({ type: "setInPageLog", patch: { collapsed: !isCollapsed } }).catch(() => {});
    });
  }
  const header = container.querySelector("#bgaa-inpage-log-header");
  if (header && view.parentElement !== header) header.appendChild(view);
  view.classList.toggle("collapsed", opts.collapsed);

  container.dataset.halfTurns = String(opts.halfTurns);
  // A class rather than an inline style: the collapsed rule also hides the footer, and an
  // inline `display` would override it and bring the control back in the wrong view.
  container.classList.toggle("at-end", !opts.hasMore);
  container.dataset.collapsed = String(opts.collapsed);
  container.classList.toggle("show-player-names", opts.showPlayerNames);
  container.classList.toggle("collapsed", opts.collapsed);

  // Exactly one log is shown at a time: ours, or BGA's.
  document.documentElement.classList.toggle(HIDE_CLASS, !opts.collapsed);

  // The bulb shows the current state (lit = our turn history is up), matching the toolbar icon.
  // Its label names the action, since the icon alone cannot say which way it goes.
  const viewButton = view;
  if (viewButton) {
    const label = opts.collapsed ? "Show turn history" : "Show BGA's log";
    viewButton.title = label;
    viewButton.setAttribute("aria-label", label);
    viewButton.setAttribute("aria-pressed", String(!opts.collapsed));
  }


  // Reconcile by key so untouched rows keep their identity — a wholesale innerHTML swap would
  // destroy hover state, in-progress text selection and any open popover on every update.
  const scrollTop = rowsEl.scrollTop;
  const existing = new Map<string, Element>();
  for (const child of Array.from(rowsEl.children)) {
    const key = child.getAttribute("data-row-key");
    if (key !== null) existing.set(key, child);
  }

  let cursor = rowsEl.firstChild;
  for (const row of rows) {
    let el = existing.get(row.key) ?? null;
    existing.delete(row.key);
    // Content can change under a stable key: a "pending" placeholder becomes a real action at
    // the same log position once it resolves.
    if (el && el.outerHTML !== row.html) el = null;
    if (!el) {
      const holder = document.createElement("div");
      holder.innerHTML = row.html;
      el = holder.firstElementChild;
      if (!el) continue;
    }
    if (cursor === el) cursor = cursor.nextSibling;
    else rowsEl.insertBefore(el, cursor);
  }
  for (const stale of existing.values()) stale.remove();
  // Anything past the reconciled prefix belongs to a previous render.
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.parentNode?.removeChild(cursor);
    cursor = next;
  }

  rowsEl.scrollTop = scrollTop;
}
