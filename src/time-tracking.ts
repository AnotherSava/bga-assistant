// Time tracking — session types, storage keys, URL parser, and session tracker.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A completed play session: [gameSlug, tableId, from, to] (timestamps in ms). */
export type TimeSession = [gameSlug: string, tableId: number, from: number, to: number];

/** Map of game slug → human-readable display name. */
export type GameMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

export const STORAGE_KEY_SESSIONS = "bgaa_time_sessions";
export const STORAGE_KEY_GAMES = "bgaa_time_games";
export const BGA_STORAGE_KEY = "bgaa_time_sessions";

// ---------------------------------------------------------------------------
// URL parsing (shared — used by both time tracking and classifyNavigation)
// ---------------------------------------------------------------------------

export interface GameTableInfo {
  gameId: number;
  gameName: string;
  tableId: number;
}

const GAME_TABLE_RE = /^https:\/\/([a-z0-9]+\.)?boardgamearena\.com\/(\d+)\/(\w+)/;

/** Extract the human-readable game name from a BGA tab title like "action • Innovation • Board Game Arena". */
export function extractDisplayName(title: string | undefined): string | null {
  if (!title) return null;
  const parts = title.split(" • ");
  if (parts.length >= 3) return parts[parts.length - 2].trim() || null;
  if (parts.length === 2) return parts[0].trim() || null;
  return null;
}

/** Parse a BGA game table URL into its numeric game ID, game slug, and table ID. Returns null if the URL doesn't match. */
export function parseGameTableUrl(url: string): GameTableInfo | null {
  const match = url.match(GAME_TABLE_RE);
  if (!match) return null;
  const tableMatch = url.match(/[?&]table=(\d+)/);
  if (!tableMatch) return null;
  return { gameId: Number(match[2]), gameName: match[3], tableId: Number(tableMatch[1]) };
}

// ---------------------------------------------------------------------------
// Session tracker
// ---------------------------------------------------------------------------

export const STORAGE_KEY_ACTIVE = "bgaa_time_active";
export const STORAGE_KEY_MODES = "bgaa_time_modes";

/** Map of table ID → true when the table is a real-time game (vs turn-based). */
export type ModeMap = Record<string, boolean>;

interface ActiveSession {
  slug: string;
  tableId: number;
  from: number;
}

export class SessionTracker {
  private active: ActiveSession | null = null;
  private knownSlugs = new Set<string>();
  private tableModes = new Map<number, boolean>();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  handleFocusChange(url: string | null, title?: string): void {
    const now = Date.now();
    this.writeQueue = this.writeQueue.then(() => this.doHandleFocusChange(url, now, title));
  }

  /** Record whether a table is real-time (vs turn-based). A table's mode is fixed for its lifetime, so the first known value wins and is never overwritten. */
  setTableMode(tableId: number, realTime: unknown): void {
    if (typeof realTime !== "boolean") return;
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      if (this.tableModes.has(tableId)) return;
      this.tableModes.set(tableId, realTime);
      await this.persistTableMode(tableId, realTime);
    });
  }

  /** Drop in-memory state so the next focus change reloads from (now-cleared) storage. */
  reset(): void {
    this.writeQueue = this.writeQueue.then(() => {
      this.active = null;
      this.knownSlugs.clear();
      this.tableModes.clear();
      this.loaded = false;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const result = await chrome.storage.local.get([STORAGE_KEY_ACTIVE, STORAGE_KEY_GAMES, STORAGE_KEY_MODES]);
    this.active = (result[STORAGE_KEY_ACTIVE] as ActiveSession | undefined) ?? null;
    const map = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
    for (const slug in map) this.knownSlugs.add(slug);
    const modes = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
    for (const id in modes) this.tableModes.set(Number(id), modes[id]);
    this.loaded = true;
  }

  private async doHandleFocusChange(url: string | null, now: number, title?: string): Promise<void> {
    await this.ensureLoaded();
    const info = url ? parseGameTableUrl(url) : null;
    if (info && !this.knownSlugs.has(info.gameName)) {
      const displayName = extractDisplayName(title);
      if (displayName) await this.persistGameName(info.gameName, displayName);
    }
    if (this.active) {
      if (info && info.gameName === this.active.slug && info.tableId === this.active.tableId) return;
      const session: TimeSession = [this.active.slug, this.active.tableId, this.active.from, now];
      this.active = null;
      await this.writeActive();
      await this.appendSession(session);
    }
    if (info) {
      this.active = { slug: info.gameName, tableId: info.tableId, from: now };
      await this.writeActive();
    }
  }

  async readSessions(): Promise<TimeSession[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    return (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  }

  async readGameMap(): Promise<GameMap> {
    const result = await chrome.storage.local.get(STORAGE_KEY_GAMES);
    return (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
  }

  async backupToBga(tabId: number): Promise<void> {
    const sessions = await this.readSessions();
    const games = await this.readGameMap();
    await writeBgaLocalStorage(tabId, sessions, games);
  }

  async restoreFromBga(tabId: number): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    if ((result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined)?.length) return;
    const bgaData = await readBgaLocalStorage(tabId);
    if (!bgaData) return;
    await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: bgaData.sessions, [STORAGE_KEY_GAMES]: bgaData.games });
  }

  private async writeActive(): Promise<void> {
    if (this.active) {
      await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: this.active });
    } else {
      await chrome.storage.local.remove(STORAGE_KEY_ACTIVE);
    }
  }

  private async appendSession(session: TimeSession): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
    sessions.push(session);
    await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
  }

  private async persistGameName(slug: string, displayName: string): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_GAMES);
    const map: GameMap = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
    map[slug] = displayName;
    this.knownSlugs.add(slug);
    await chrome.storage.local.set({ [STORAGE_KEY_GAMES]: map });
  }

  private async persistTableMode(tableId: number, realTime: boolean): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_MODES);
    const modes: ModeMap = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
    modes[tableId] = realTime;
    await chrome.storage.local.set({ [STORAGE_KEY_MODES]: modes });
  }
}

// ---------------------------------------------------------------------------
// BGA page localStorage backup/restore helpers
// ---------------------------------------------------------------------------

interface BgaStorageData {
  sessions: TimeSession[];
  games: GameMap;
}

function readBgaScript(): BgaStorageData | null {
  const raw = localStorage.getItem("bgaa_time_sessions");
  if (!raw) return null;
  return JSON.parse(raw) as BgaStorageData;
}

function writeBgaScript(data: string): void {
  localStorage.setItem("bgaa_time_sessions", data);
}

async function readBgaLocalStorage(tabId: number): Promise<BgaStorageData | null> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: readBgaScript, world: "MAIN" });
  return results[0]?.result ?? null;
}

async function writeBgaLocalStorage(tabId: number, sessions: TimeSession[], games: GameMap): Promise<void> {
  const data = JSON.stringify({ sessions, games });
  await chrome.scripting.executeScript({ target: { tabId }, func: writeBgaScript, args: [data], world: "MAIN" } as chrome.scripting.ScriptInjection);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const CSV_HEADER = "game,table_id,from,to,minutes";

export async function exportSessionsCsv(): Promise<string> {
  const result = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES]);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const gameMap: GameMap = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
  const rows = sessions.map(([slug, tableId, from, to]) => {
    const minutes = ((to - from) / 60000).toFixed(1);
    const game = (gameMap[slug] ?? slug).replace(/,/g, " ");
    return `${game},${tableId},${new Date(from).toISOString()},${new Date(to).toISOString()},${minutes}`;
  });
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/** Parse a previously exported CSV and merge its sessions into storage, deduplicating by start timestamp. Returns the number of newly added sessions. */
export async function importSessionsCsv(text: string): Promise<number> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return 0;
  const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const seen = new Set(sessions.map((session) => session[2]));
  let added = 0;
  for (const line of lines.slice(1)) {
    const [game, tableIdStr, fromStr, toStr] = line.split(",");
    const tableId = Number(tableIdStr);
    const from = Date.parse(fromStr);
    const to = Date.parse(toStr);
    if (!game || Number.isNaN(tableId) || Number.isNaN(from) || Number.isNaN(to) || seen.has(from)) continue;
    seen.add(from);
    sessions.push([game, tableId, from, to]);
    added++;
  }
  sessions.sort((a, b) => a[2] - b[2]);
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
  return added;
}

// ---------------------------------------------------------------------------
// Chart aggregation
// ---------------------------------------------------------------------------

/** Hour (0–23) at which a play-time "day" begins; sessions before it count toward the previous day. */
export const DAY_START_HOUR = 6;

/** Day of the week (0 = Sunday … 6 = Saturday) on which a play-time "week" begins. */
export const WEEK_START_DAY = 1;

export type Granularity = "day" | "week" | "month";

/** Format a duration given in minutes as hours and minutes (e.g. 75 → "1h 15m", 45 → "45m", 120 → "2h", 0 → "0m"). */
export function formatDuration(minutes: number): string {
  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

/** Format a duration given in milliseconds as a clock string with no leading zeros or separator: "1:22:07", "22:07", "17", "0". */
export function formatDurationClock(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
  return clock.replace(/^[0:]+/, "") || "0";
}

export interface ChartBucket {
  key: string;
  label: string;
  /** Minutes per game name, in the same order as ChartData.games. */
  minutesByGame: Record<string, number>;
  totalMinutes: number;
}

export interface ChartData {
  buckets: ChartBucket[];
  /** Distinct game display names, ordered by total time descending. */
  games: string[];
  maxTotalMinutes: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function bucketFor(ts: number, granularity: Granularity, dayStartHour: number, weekStartDay: number): { key: string; label: string } {
  // Shift back by the day-start hour so e.g. a 2am session counts toward the previous day.
  const d = new Date(ts - dayStartHour * 3600000);
  if (granularity === "month") {
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    return { key, label: d.toLocaleString(undefined, { month: "short" }) };
  }
  let target = d;
  if (granularity === "week") {
    const weekOffset = (d.getDay() - weekStartDay + 7) % 7;
    target = new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekOffset);
  }
  const key = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
  return { key, label: `${target.getMonth() + 1}/${target.getDate()}` };
}

/** Group sessions into time buckets, summing minutes per game. Used to render the stacked-column chart. `dayStartHour` shifts the day boundary (e.g. 6 = a day runs 6am–6am); `weekStartDay` sets which weekday a week begins on. */
export function aggregateSessions(sessions: TimeSession[], gameMap: GameMap, granularity: Granularity, dayStartHour = DAY_START_HOUR, weekStartDay = WEEK_START_DAY): ChartData {
  const buckets = new Map<string, ChartBucket>();
  const gameTotals = new Map<string, number>();
  for (const [slug, , from, to] of sessions) {
    const game = gameMap[slug] ?? slug;
    const minutes = (to - from) / 60000;
    const { key, label } = bucketFor(from, granularity, dayStartHour, weekStartDay);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, minutesByGame: {}, totalMinutes: 0 };
      buckets.set(key, bucket);
    }
    bucket.minutesByGame[game] = (bucket.minutesByGame[game] ?? 0) + minutes;
    bucket.totalMinutes += minutes;
    gameTotals.set(game, (gameTotals.get(game) ?? 0) + minutes);
  }
  const orderedBuckets = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  const games = [...gameTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([game]) => game);
  const maxTotalMinutes = orderedBuckets.reduce((max, bucket) => Math.max(max, bucket.totalMinutes), 0);
  return { buckets: orderedBuckets, games, maxTotalMinutes };
}

/** Total minutes across sessions falling in the same time bucket as `now` — used for the "today" and "this week" summary figures. */
export function minutesInCurrentBucket(sessions: TimeSession[], granularity: Granularity, now: number, dayStartHour = DAY_START_HOUR, weekStartDay = WEEK_START_DAY): number {
  const targetKey = bucketFor(now, granularity, dayStartHour, weekStartDay).key;
  let total = 0;
  for (const [, , from, to] of sessions) {
    if (bucketFor(from, granularity, dayStartHour, weekStartDay).key === targetKey) total += (to - from) / 60000;
  }
  return total;
}

/** Which sessions to list on the stats page: nothing, the current day, the current week, or everything. */
export type SessionFilter = "off" | "today" | "week" | "all";

/** Start (inclusive) and end (exclusive) timestamps of the day/week bucket that `now` falls into, honoring the day-start hour and week-start day. */
export function currentBucketRange(granularity: "day" | "week", now: number, dayStartHour = DAY_START_HOUR, weekStartDay = WEEK_START_DAY): { start: number; end: number } {
  const shifted = new Date(now - dayStartHour * 3600000);
  let date = shifted.getDate();
  let span = 1;
  if (granularity === "week") {
    date -= (shifted.getDay() - weekStartDay + 7) % 7;
    span = 7;
  }
  const start = new Date(shifted.getFullYear(), shifted.getMonth(), date, dayStartHour).getTime();
  const end = new Date(shifted.getFullYear(), shifted.getMonth(), date + span, dayStartHour).getTime();
  return { start, end };
}

/** Sessions that overlap [start, end) — any session whose span intersects the range, even partially (starts before and ends inside, or starts inside and ends after). */
export function sessionsOverlapping(sessions: TimeSession[], start: number, end: number): TimeSession[] {
  return sessions.filter(([, , from, to]) => from < end && to > start);
}
