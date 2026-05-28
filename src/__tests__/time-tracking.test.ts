import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseGameTableUrl, extractDisplayName, SessionTracker, exportSessionsCsv, importSessionsCsv, aggregateSessions, STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, type TimeSession } from "../time-tracking";

describe("parseGameTableUrl", () => {
  it("parses a standard game table URL", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/8/innovation?table=555")).toEqual({ gameId: 8, gameName: "innovation", tableId: 555 });
  });

  it("parses a URL with subdomain", () => {
    expect(parseGameTableUrl("https://en.boardgamearena.com/3/azul?table=123")).toEqual({ gameId: 3, gameName: "azul", tableId: 123 });
  });

  it("parses table param embedded in longer query string", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/12/carcassonne?table=789&other=1")).toEqual({ gameId: 12, gameName: "carcassonne", tableId: 789 });
  });

  it("parses table param as non-first query param", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/5/thecrewdeepsea?foo=bar&table=42")).toEqual({ gameId: 5, gameName: "thecrewdeepsea", tableId: 42 });
  });

  it("returns null for missing table param", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/8/innovation")).toBeNull();
  });

  it("returns null for a non-BGA URL", () => {
    expect(parseGameTableUrl("https://example.com/8/game?table=1")).toBeNull();
  });

  it("returns null for BGA lobby URL", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/lobby")).toBeNull();
  });

  it("returns null for undefined-like empty string", () => {
    expect(parseGameTableUrl("")).toBeNull();
  });

  it("handles multi-segment game IDs (large numbers)", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/1234/somegame?table=999999")).toEqual({ gameId: 1234, gameName: "somegame", tableId: 999999 });
  });

  it("returns null for URL with hash-only table reference", () => {
    expect(parseGameTableUrl("https://boardgamearena.com/8/innovation#table=555")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractDisplayName
// ---------------------------------------------------------------------------

describe("extractDisplayName", () => {
  it("extracts game name from full BGA title with notification", () => {
    expect(extractDisplayName("Chopsticks: Do you want to transfer the bottom 1 to the available achievements? • Innovation • Board Game Arena")).toBe("Innovation");
  });

  it("extracts game name from simple BGA title", () => {
    expect(extractDisplayName("Your turn • The Crew • Board Game Arena")).toBe("The Crew");
  });

  it("extracts game name when only two parts", () => {
    expect(extractDisplayName("Innovation • Board Game Arena")).toBe("Innovation");
  });

  it("returns null for undefined", () => {
    expect(extractDisplayName(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDisplayName("")).toBeNull();
  });

  it("returns null for title without bullet separators", () => {
    expect(extractDisplayName("Some random title")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SessionTracker
// ---------------------------------------------------------------------------

describe("SessionTracker", () => {
  let storage: Record<string, unknown>;
  let tracker: SessionTracker;
  let nowMs: number;

  beforeEach(() => {
    storage = {};
    nowMs = 1000000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((keys: string | string[]) => {
            const result: Record<string, unknown> = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              if (storage[key] !== undefined) result[key] = storage[key];
            }
            return Promise.resolve(result);
          }),
          set: vi.fn((items: Record<string, unknown>) => { Object.assign(storage, items); return Promise.resolve(); }),
          remove: vi.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
        },
      },
    };
    tracker = new SessionTracker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  it("records a table's real-time mode via setTableMode", async () => {
    tracker.setTableMode(100, true);
    await vi.waitFor(() => expect(storage["bgaa_time_modes"]).toEqual({ 100: true }));
  });

  it("records turn-based mode and ignores non-boolean values", async () => {
    tracker.setTableMode(200, false);
    tracker.setTableMode(300, null);
    tracker.setTableMode(400, undefined);
    await vi.waitFor(() => expect(storage["bgaa_time_modes"]).toEqual({ 200: false }));
  });

  it("keeps the first recorded mode and never overwrites it (mode is fixed per table)", async () => {
    tracker.setTableMode(100, true);
    await vi.waitFor(() => expect(storage["bgaa_time_modes"]).toEqual({ 100: true }));
    const setCalls = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    tracker.setTableMode(100, false); // a stray later read must not change a known table
    await new Promise((r) => setTimeout(r, 10));
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCalls);
    expect(storage["bgaa_time_modes"]).toEqual({ 100: true });
  });

  it("reuses a previously stored mode and skips re-writing it", async () => {
    storage["bgaa_time_modes"] = { 100: true };
    tracker.setTableMode(100, true);
    await new Promise((r) => setTimeout(r, 10));
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ "bgaa_time_modes": expect.anything() }));
  });

  it("starts and ends a session on focus change away", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    nowMs = 1005000;
    tracker.handleFocusChange(null);
    await vi.waitFor(() => expect(storage[STORAGE_KEY_SESSIONS]).toBeDefined());
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["innovation", 100, 1000000, 1005000]]);
  });

  it("does not create a session when re-focusing the same table", () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    nowMs = 1002000;
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ [STORAGE_KEY_SESSIONS]: expect.anything() }));
  });

  it("ends current and starts new session when switching tables", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    nowMs = 1003000;
    tracker.handleFocusChange("https://boardgamearena.com/3/azul?table=200");
    await vi.waitFor(() => expect(storage[STORAGE_KEY_SESSIONS]).toBeDefined());
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["innovation", 100, 1000000, 1003000]]);
    nowMs = 1006000;
    tracker.handleFocusChange(null);
    await vi.waitFor(() => expect((storage[STORAGE_KEY_SESSIONS] as unknown[]).length).toBe(2));
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["innovation", 100, 1000000, 1003000], ["azul", 200, 1003000, 1006000]]);
  });

  it("populates game map with display name extracted from title", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100", "Your turn • Innovation • Board Game Arena");
    await vi.waitFor(() => expect(storage[STORAGE_KEY_GAMES]).toBeDefined());
    expect(storage[STORAGE_KEY_GAMES]).toEqual({ innovation: "Innovation" });
  });

  it("does not store a game name when no title is provided", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    await vi.waitFor(() => expect(storage["bgaa_time_active"]).toBeDefined());
    expect(storage[STORAGE_KEY_GAMES]).toBeUndefined();
  });

  it("does not create orphan session on SW restart (no active session)", async () => {
    const freshTracker = new SessionTracker();
    freshTracker.handleFocusChange(null);
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("survives SW restart by restoring active session from storage", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100");
    await vi.waitFor(() => expect(storage["bgaa_time_active"]).toBeDefined());
    nowMs = 1005000;
    const freshTracker = new SessionTracker();
    freshTracker.handleFocusChange(null);
    await vi.waitFor(() => expect(storage[STORAGE_KEY_SESSIONS]).toBeDefined());
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["innovation", 100, 1000000, 1005000]]);
    expect(storage["bgaa_time_active"]).toBeUndefined();
  });

  it("re-persists game name after reset (e.g. after a Clear)", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100", "Your turn • Innovation • Board Game Arena");
    await vi.waitFor(() => expect(storage[STORAGE_KEY_GAMES]).toEqual({ innovation: "Innovation" }));
    delete storage[STORAGE_KEY_GAMES];
    delete storage[STORAGE_KEY_SESSIONS];
    delete storage["bgaa_time_active"];
    tracker.reset();
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=100", "Your turn • Innovation • Board Game Arena");
    await vi.waitFor(() => expect(storage[STORAGE_KEY_GAMES]).toEqual({ innovation: "Innovation" }));
  });

  it("handles rapid tab switching correctly", async () => {
    tracker.handleFocusChange("https://boardgamearena.com/8/innovation?table=1");
    nowMs = 1001000;
    tracker.handleFocusChange("https://boardgamearena.com/3/azul?table=2");
    nowMs = 1002000;
    tracker.handleFocusChange("https://boardgamearena.com/5/thecrewdeepsea?table=3");
    nowMs = 1003000;
    tracker.handleFocusChange(null);
    await vi.waitFor(() => expect((storage[STORAGE_KEY_SESSIONS] as unknown[])?.length).toBe(3));
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([
      ["innovation", 1, 1000000, 1001000],
      ["azul", 2, 1001000, 1002000],
      ["thecrewdeepsea", 3, 1002000, 1003000],
    ]);
  });

  it("does nothing for non-BGA URLs", () => {
    tracker.handleFocusChange("https://example.com/page");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("readSessions returns stored sessions", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["innovation", 100, 1000, 2000]];
    const sessions = await tracker.readSessions();
    expect(sessions).toEqual([["innovation", 100, 1000, 2000]]);
  });

  it("readSessions returns empty array when no data", async () => {
    const sessions = await tracker.readSessions();
    expect(sessions).toEqual([]);
  });

  it("readGameMap returns stored map", async () => {
    storage[STORAGE_KEY_GAMES] = { innovation: "Innovation" };
    const map = await tracker.readGameMap();
    expect(map).toEqual({ innovation: "Innovation" });
  });
});

// ---------------------------------------------------------------------------
// backupToBga / restoreFromBga
// ---------------------------------------------------------------------------

describe("SessionTracker BGA backup/restore", () => {
  let storage: Record<string, unknown>;
  let tracker: SessionTracker;

  beforeEach(() => {
    storage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((...keys: string[]) => {
            const result: Record<string, unknown> = {};
            for (const key of keys.flat()) {
              if (storage[key] !== undefined) result[key] = storage[key];
            }
            return Promise.resolve(result);
          }),
          set: vi.fn((items: Record<string, unknown>) => { Object.assign(storage, items); return Promise.resolve(); }),
          remove: vi.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
        },
      },
      scripting: {
        executeScript: vi.fn(() => Promise.resolve([{ result: null }])),
      },
    };
    tracker = new SessionTracker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  it("restoreFromBga populates empty extension storage from BGA localStorage", async () => {
    const bgaData = { sessions: [["innovation", 1, 1000, 2000] as TimeSession], games: { innovation: "Innovation" } };
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ result: bgaData }]);
    await tracker.restoreFromBga(1);
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["innovation", 1, 1000, 2000]]);
    expect(storage[STORAGE_KEY_GAMES]).toEqual({ innovation: "Innovation" });
  });

  it("restoreFromBga skips when extension storage already has sessions", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["azul", 2, 5000, 6000]];
    await tracker.restoreFromBga(1);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("restoreFromBga does nothing when BGA localStorage is empty", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ result: null }]);
    await tracker.restoreFromBga(1);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("backupToBga writes current sessions to BGA page localStorage", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["innovation", 1, 1000, 2000]];
    storage[STORAGE_KEY_GAMES] = { innovation: "Innovation" };
    await tracker.backupToBga(5);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    const call = (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0].target).toEqual({ tabId: 5 });
    expect(call[0].args[0]).toBe(JSON.stringify({ sessions: [["innovation", 1, 1000, 2000]], games: { innovation: "Innovation" } }));
  });
});

// ---------------------------------------------------------------------------
// exportSessionsCsv
// ---------------------------------------------------------------------------

describe("exportSessionsCsv", () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((keys: string | string[]) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, unknown> = {};
            for (const key of keyArr) {
              if (storage[key] !== undefined) result[key] = storage[key];
            }
            return Promise.resolve(result);
          }),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  it("exports CSV with header and data rows", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["innovation", 100, 1716800000000, 1716803600000]];
    storage[STORAGE_KEY_GAMES] = { innovation: "Innovation" };
    const csv = await exportSessionsCsv();
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("game,table_id,from,to,minutes");
    expect(lines[1]).toMatch(/^Innovation,100,\d{4}-.*,\d{4}-.*,60\.0$/);
  });

  it("falls back to the slug for games without a display name", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["mysterygame", 200, 1000, 2000]];
    storage[STORAGE_KEY_GAMES] = {};
    const csv = await exportSessionsCsv();
    const lines = csv.trimEnd().split("\n");
    expect(lines[1]).toMatch(/^mysterygame,200,/);
  });

  it("returns header only when no sessions", async () => {
    const csv = await exportSessionsCsv();
    expect(csv.trimEnd()).toBe("game,table_id,from,to,minutes");
  });

  it("calculates minutes correctly", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["test", 1, 0, 90000]];
    storage[STORAGE_KEY_GAMES] = { test: "Test" };
    const csv = await exportSessionsCsv();
    expect(csv).toContain(",1.5\n");
  });

  it("sanitizes commas in game names", async () => {
    storage[STORAGE_KEY_SESSIONS] = [["x", 1, 0, 60000]];
    storage[STORAGE_KEY_GAMES] = { x: "A,B,C" };
    const csv = await exportSessionsCsv();
    expect(csv.trimEnd().split("\n")[1]).toMatch(/^A B C,1,/);
  });
});

// ---------------------------------------------------------------------------
// importSessionsCsv
// ---------------------------------------------------------------------------

describe("importSessionsCsv", () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((keys: string | string[]) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, unknown> = {};
            for (const key of keyArr) {
              if (storage[key] !== undefined) result[key] = storage[key];
            }
            return Promise.resolve(result);
          }),
          set: vi.fn((items: Record<string, unknown>) => { Object.assign(storage, items); return Promise.resolve(); }),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  it("imports sessions from a CSV produced by export", async () => {
    const csv = "game,table_id,from,to,minutes\nInnovation,100,2026-05-27T19:00:00.000Z,2026-05-27T19:30:00.000Z,30.0\n";
    const added = await importSessionsCsv(csv);
    expect(added).toBe(1);
    expect(storage[STORAGE_KEY_SESSIONS]).toEqual([["Innovation", 100, Date.parse("2026-05-27T19:00:00.000Z"), Date.parse("2026-05-27T19:30:00.000Z")]]);
  });

  it("merges with existing sessions and dedups by start timestamp", async () => {
    const from = Date.parse("2026-05-27T19:00:00.000Z");
    storage[STORAGE_KEY_SESSIONS] = [["Innovation", 100, from, from + 1000]];
    const csv = `game,table_id,from,to,minutes\nInnovation,100,${new Date(from).toISOString()},${new Date(from + 1000).toISOString()},0.0\nAzul,200,2026-05-27T20:00:00.000Z,2026-05-27T20:10:00.000Z,10.0\n`;
    const added = await importSessionsCsv(csv);
    expect(added).toBe(1);
    expect((storage[STORAGE_KEY_SESSIONS] as TimeSession[]).length).toBe(2);
  });

  it("sorts sessions chronologically after import", async () => {
    const csv = "game,table_id,from,to,minutes\nLater,1,2026-05-27T20:00:00.000Z,2026-05-27T20:01:00.000Z,1.0\nEarlier,2,2026-05-27T18:00:00.000Z,2026-05-27T18:01:00.000Z,1.0\n";
    await importSessionsCsv(csv);
    const sessions = storage[STORAGE_KEY_SESSIONS] as TimeSession[];
    expect(sessions[0][0]).toBe("Earlier");
    expect(sessions[1][0]).toBe("Later");
  });

  it("returns 0 for header-only or empty input", async () => {
    expect(await importSessionsCsv("game,table_id,from,to,minutes\n")).toBe(0);
    expect(await importSessionsCsv("")).toBe(0);
  });

  it("skips malformed rows", async () => {
    const csv = "game,table_id,from,to,minutes\n,100,2026-05-27T19:00:00.000Z,2026-05-27T19:30:00.000Z,30.0\nGood,1,2026-05-27T19:00:00.000Z,2026-05-27T19:30:00.000Z,30.0\nBad,notanumber,x,y,z\n";
    const added = await importSessionsCsv(csv);
    expect(added).toBe(1);
    expect((storage[STORAGE_KEY_SESSIONS] as TimeSession[])[0][0]).toBe("Good");
  });
});

// ---------------------------------------------------------------------------
// aggregateSessions
// ---------------------------------------------------------------------------

describe("aggregateSessions", () => {
  // Build a session using local-time components so bucketing is timezone-stable.
  const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo, d, h).getTime();
  const session = (slug: string, start: number, minutes: number): TimeSession => [slug, 1, start, start + minutes * 60000];

  it("returns empty result for no sessions", () => {
    const chart = aggregateSessions([], {}, "day");
    expect(chart).toEqual({ buckets: [], games: [], maxTotalMinutes: 0 });
  });

  it("groups sessions by day and sums minutes", () => {
    const sessions = [
      session("innovation", at(2026, 4, 27, 10), 30),
      session("innovation", at(2026, 4, 27, 14), 20),
      session("innovation", at(2026, 4, 28, 10), 15),
    ];
    const chart = aggregateSessions(sessions, { innovation: "Innovation" }, "day");
    expect(chart.buckets).toHaveLength(2);
    expect(chart.buckets[0].totalMinutes).toBe(50);
    expect(chart.buckets[1].totalMinutes).toBe(15);
    expect(chart.maxTotalMinutes).toBe(50);
  });

  it("splits a bucket's minutes per game using display names", () => {
    const sessions = [
      session("innovation", at(2026, 4, 27, 10), 30),
      session("azul", at(2026, 4, 27, 12), 10),
    ];
    const chart = aggregateSessions(sessions, { innovation: "Innovation", azul: "Azul" }, "day");
    expect(chart.buckets).toHaveLength(1);
    expect(chart.buckets[0].minutesByGame).toEqual({ Innovation: 30, Azul: 10 });
    expect(chart.buckets[0].totalMinutes).toBe(40);
  });

  it("orders games by total time descending", () => {
    const sessions = [
      session("a", at(2026, 4, 27, 10), 10),
      session("b", at(2026, 4, 27, 11), 50),
      session("c", at(2026, 4, 27, 12), 30),
    ];
    const chart = aggregateSessions(sessions, {}, "day");
    expect(chart.games).toEqual(["b", "c", "a"]);
  });

  it("groups sessions in the same Mon–Sun week", () => {
    // 2026-05-25 is a Monday; 2026-05-27 (Wed) is the same week.
    const sessions = [
      session("x", at(2026, 4, 25, 10), 10),
      session("x", at(2026, 4, 27, 10), 20),
      session("x", at(2026, 5, 1, 10), 5),
    ];
    const chart = aggregateSessions(sessions, {}, "week");
    expect(chart.buckets).toHaveLength(2);
    expect(chart.buckets[0].totalMinutes).toBe(30);
    expect(chart.buckets[1].totalMinutes).toBe(5);
  });

  it("groups sessions by month", () => {
    const sessions = [
      session("x", at(2026, 4, 3, 10), 10),
      session("x", at(2026, 4, 28, 10), 20),
      session("x", at(2026, 5, 2, 10), 5),
    ];
    const chart = aggregateSessions(sessions, {}, "month");
    expect(chart.buckets).toHaveLength(2);
    expect(chart.buckets[0].totalMinutes).toBe(30);
    expect(chart.buckets[1].totalMinutes).toBe(5);
  });

  it("orders buckets chronologically", () => {
    const sessions = [
      session("x", at(2026, 4, 28, 10), 5),
      session("x", at(2026, 4, 26, 10), 5),
    ];
    const chart = aggregateSessions(sessions, {}, "day");
    expect(chart.buckets[0].label).toBe("5/26");
    expect(chart.buckets[1].label).toBe("5/28");
  });

  it("counts early-morning sessions toward the previous day (default 6am start)", () => {
    const sessions = [
      session("x", at(2026, 4, 27, 23), 10), // late evening May 27
      session("x", at(2026, 4, 28, 2), 20),  // 2am May 28 → still May 27's "day"
      session("x", at(2026, 4, 28, 7), 5),   // 7am May 28 → new day
    ];
    const chart = aggregateSessions(sessions, {}, "day");
    expect(chart.buckets).toHaveLength(2);
    expect(chart.buckets[0].label).toBe("5/27");
    expect(chart.buckets[0].totalMinutes).toBe(30);
    expect(chart.buckets[1].label).toBe("5/28");
    expect(chart.buckets[1].totalMinutes).toBe(5);
  });

  it("respects a custom day-start hour", () => {
    const sessions = [
      session("x", at(2026, 4, 28, 2), 10), // 2am
      session("x", at(2026, 4, 28, 5), 10), // 5am
    ];
    // Day starts at 3am: 2am → previous day (5/27), 5am → 5/28.
    const chart = aggregateSessions(sessions, {}, "day", 3);
    expect(chart.buckets.map((b) => b.label)).toEqual(["5/27", "5/28"]);
  });
});
