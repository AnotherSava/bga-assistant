// Content script: BGA data extraction, MAIN world.
// Built as a standalone script (not ES module) for injection via chrome.scripting.executeScript.
// The Vite build strips ES module exports so this runs as a plain script in the page context.
// The last expression (extractGameData()) returns a Promise whose resolved value becomes
// the injection result.

/**
 * Extract Innovation game data from a BGA game page.
 *
 * Runs in MAIN world, accessing gameui and BGA's ajaxcall API.
 * Returns {players, gamedatas, packets} on success or {error, msg} on failure.
 *
 * IMPORTANT: this function MUST remain fully self-contained — no references to
 * module-level variables or imports from other modules. Chrome serializes the
 * script for injection and external references would be undefined.
 */
export async function extractGameData(): Promise<Record<string, unknown>> {
  // Resolves with { error, msg } instead of rejecting because Chrome's
  // executeScript wraps rejections in generic errors, losing the message.
  const tableMatch = window.location.search.match(/table=(\d+)/);
  if (!tableMatch) return { error: true, msg: "No table= param in URL" };
  const tableId = parseInt(tableMatch[1]);

  // BGA URLs: /<N>/<game> or /<N>/<game>/<game> — endpoint always uses /<N>/<game>/<game>/
  const parts = window.location.pathname.split("/");
  const endpoint = "/" + parts[1] + "/" + parts[2] + "/" + parts[2] + "/notificationHistory.html";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gui = (globalThis as any).gameui;
  if (!gui || !gui.ajaxcall) {
    return { error: true, msg: "gameui not available — is this a BGA game page?" };
  }

  return new Promise<Record<string, unknown>>((resolve) => {
    gui.ajaxcall(
      endpoint,
      { table: tableId, from: 0, privateinc: 1, history: 1 },
      gui,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result: any) => {
        const currentPlayerId = gui.player_id != null ? String(gui.player_id) : undefined;
        const players: Record<string, { id: string; name: string; colorHex: string; isCurrent: boolean }> = {};
        if (gui.gamedatas?.players) {
          for (const pid in gui.gamedatas.players) {
            const p = gui.gamedatas.players[pid];
            if (typeof p.color !== "string") {
              resolve({ error: true, msg: `BGA player color missing for player ${pid}` });
              return;
            }
            players[pid] = { id: pid, name: p.name, colorHex: p.color, isCurrent: pid === currentPlayerId };
          }
        }

        let gamedatas = null;
        if (gui.gamedatas) {
          gamedatas = {
            my_hand: gui.gamedatas.my_hand || [],
            cards: gui.gamedatas.cards || {},
          };
        }

        if (!result?.data) {
          resolve({ error: true, msg: "BGA API returned no notification data" });
          return;
        }

        resolve({ gameName: parts[2], players, gamedatas, packets: result.data, currentPlayerId });
      },
      (_isError: boolean, errorMsg: string) => {
        resolve({ error: true, msg: errorMsg });
      },
    );
  });
}

// Self-invoking: when injected as a standalone script via chrome.scripting.executeScript,
// the return value of this expression becomes the injection result.
// Guard: only run in browser context (skip in Node/vitest).
if (typeof window !== "undefined") extractGameData();
