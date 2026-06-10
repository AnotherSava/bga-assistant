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
export const STORAGE_KEY_TYPES = "bgaa_time_types";

// Idle / liveness tuning. The clock keeps running through short pauses (thinking on your turn) and only
// stops once you've genuinely walked away.
//
// - IDLE_DETECTION_SECONDS: how long with no keyboard/mouse input before the OS/browser reports "idle".
// - IDLE_GRACE_MS: how long to stay idle (after the idle report) before the session is actually ended.
//   Coming back to activity within this window resumes the session with no break recorded.
// - When a session ends for idleness, its end timestamp is the moment idle was *detected* (idleSince) —
//   so the detection interval counts as play but the grace window does not.
// - HEARTBEAT_MS: while active, a periodic tick refreshes the session's lastSeen stamp so an abrupt
//   shutdown can be detected and bounded on the next start (the clamp below), not stretched to "now".
// - STALE_SESSION_MS: on startup, an active session whose lastSeen is older than this (with no idle on
//   record) is treated as orphaned by a crash/quit and ended at lastSeen rather than extended to now.
export const IDLE_DETECTION_SECONDS = 60;
export const IDLE_GRACE_MS = 5 * 60 * 1000;
export const HEARTBEAT_MS = 60 * 1000;
export const STALE_SESSION_MS = 2 * HEARTBEAT_MS;

/** Map of table ID → true when the table is a real-time game (vs turn-based). */
export type ModeMap = Record<string, boolean>;

/** Table category — orthogonal to real-time mode. */
export type TableType = "tournament" | "arena" | "regular";
const VALID_TABLE_TYPES: ReadonlySet<string> = new Set<TableType>(["tournament", "arena", "regular"]);

/** Map of table ID → its category. */
export type TableTypeMap = Record<string, TableType>;

interface ActiveSession {
  slug: string;
  tableId: number;
  from: number;
  /** Last timestamp the user was confirmed present (focus landed, activity, or a heartbeat tick). */
  lastSeen: number;
  /** When the current idle stretch began, or null while the user is active. Used as the session end if idleness is confirmed. */
  idleSince: number | null;
}

export class SessionTracker {
  private active: ActiveSession | null = null;
  private knownSlugs = new Set<string>();
  private tableModes = new Map<number, boolean>();
  private tableTypes = new Map<number, TableType>();
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

  /** Record a table's category (tournament/arena/regular). Fixed for the table's lifetime, so the first known value wins and is never overwritten (classification is done once, then remembered). Non-enum values (e.g. null when undetermined) are ignored. */
  setTableType(tableId: number, type: unknown): void {
    if (typeof type !== "string" || !VALID_TABLE_TYPES.has(type)) return;
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      if (this.tableTypes.has(tableId)) return;
      this.tableTypes.set(tableId, type as TableType);
      await this.persistTableType(tableId, type as TableType);
    });
  }

  /** Whether this table's category is already classified, so callers can skip re-probing it. */
  async isTableTypeKnown(tableId: number): Promise<boolean> {
    await this.ensureLoaded();
    return this.tableTypes.has(tableId);
  }

  /** Drop in-memory state so the next focus change reloads from (now-cleared) storage. */
  reset(): void {
    this.writeQueue = this.writeQueue.then(() => {
      this.active = null;
      this.knownSlugs.clear();
      this.tableModes.clear();
      this.tableTypes.clear();
      this.loaded = false;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const result = await chrome.storage.local.get([STORAGE_KEY_ACTIVE, STORAGE_KEY_GAMES, STORAGE_KEY_MODES, STORAGE_KEY_TYPES]);
    this.active = (result[STORAGE_KEY_ACTIVE] as ActiveSession | undefined) ?? null;
    if (this.active) {
      // Backfill fields absent from sessions persisted before idle/liveness tracking existed.
      if (typeof this.active.lastSeen !== "number") this.active.lastSeen = this.active.from;
      if (this.active.idleSince === undefined) this.active.idleSince = null;
    }
    const map = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
    for (const slug in map) this.knownSlugs.add(slug);
    const modes = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
    for (const id in modes) this.tableModes.set(Number(id), modes[id]);
    const types = (result[STORAGE_KEY_TYPES] as TableTypeMap | undefined) ?? {};
    for (const id in types) this.tableTypes.set(Number(id), types[id]);
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
      if (info && info.gameName === this.active.slug && info.tableId === this.active.tableId) {
        // Re-focusing the same table means the user is back — clear any pending idle and refresh liveness.
        let changed = false;
        if (this.active.idleSince !== null) { this.active.idleSince = null; changed = true; }
        if (now > this.active.lastSeen) { this.active.lastSeen = now; changed = true; }
        if (changed) await this.writeActive();
        return;
      }
      // Leaving while idle ends the session at the moment idleness was detected, not "now".
      const endAt = this.active.idleSince ?? now;
      const session: TimeSession = [this.active.slug, this.active.tableId, this.active.from, endAt];
      this.active = null;
      await this.writeActive();
      await this.appendSession(session);
    }
    if (info) {
      this.active = { slug: info.gameName, tableId: info.tableId, from: now, lastSeen: now, idleSince: null };
      await this.writeActive();
    }
  }

  /** The user went idle or locked the screen. Marks the start of an idle stretch without ending the session (it ends only if idleness persists past the grace window — see finalizeIdle). First idle wins, so the recorded end stays at the true onset. */
  markAway(): void {
    const now = Date.now();
    this.writeQueue = this.writeQueue.then(() => this.doMarkAway(now));
  }

  /** Periodic liveness tick while active — refreshes lastSeen so an abrupt shutdown can be bounded later. No-op while idle. */
  touch(): void {
    const now = Date.now();
    this.writeQueue = this.writeQueue.then(() => this.doTouch(now));
  }

  /** Grace window elapsed while still idle: end the active session at the moment idleness was detected. */
  finalizeIdle(): void {
    this.writeQueue = this.writeQueue.then(() => this.doFinalizeIdle());
  }

  /** On startup, close out a session orphaned by a crash/quit: end it at the idle onset (if it was idle past the grace) or at its last confirmed-active stamp, rather than extending it to now. Normal short service-worker restarts (lastSeen still fresh, no idle) leave the session running. */
  async recoverStaleSession(): Promise<void> {
    const now = Date.now();
    this.writeQueue = this.writeQueue.then(() => this.doRecoverStaleSession(now));
    return this.writeQueue;
  }

  /** Whether a session is currently open. Settles the write queue first so the answer reflects all queued mutations. */
  async hasActiveSession(): Promise<boolean> {
    await this.writeQueue;
    await this.ensureLoaded();
    return this.active !== null;
  }

  private async doMarkAway(now: number): Promise<void> {
    await this.ensureLoaded();
    if (!this.active || this.active.idleSince !== null) return;
    this.active.idleSince = now;
    await this.writeActive();
  }

  private async doTouch(now: number): Promise<void> {
    await this.ensureLoaded();
    if (!this.active || this.active.idleSince !== null) return;
    if (now > this.active.lastSeen) {
      this.active.lastSeen = now;
      await this.writeActive();
    }
  }

  private async doFinalizeIdle(): Promise<void> {
    await this.ensureLoaded();
    if (!this.active || this.active.idleSince === null) return;
    const session: TimeSession = [this.active.slug, this.active.tableId, this.active.from, this.active.idleSince];
    this.active = null;
    await this.writeActive();
    await this.appendSession(session);
  }

  private async doRecoverStaleSession(now: number): Promise<void> {
    await this.ensureLoaded();
    if (!this.active) return;
    if (this.active.idleSince !== null) {
      // Was idle when interrupted — end it only if the grace window already elapsed during the downtime.
      if (now - this.active.idleSince < IDLE_GRACE_MS) return;
      const session: TimeSession = [this.active.slug, this.active.tableId, this.active.from, this.active.idleSince];
      this.active = null;
      await this.writeActive();
      await this.appendSession(session);
      return;
    }
    // Never went idle: a fresh lastSeen means a normal restart (leave it running); a stale one means a crash/quit.
    if (now - this.active.lastSeen < STALE_SESSION_MS) return;
    const session: TimeSession = [this.active.slug, this.active.tableId, this.active.from, this.active.lastSeen];
    this.active = null;
    await this.writeActive();
    await this.appendSession(session);
  }

  async backupToBga(tabId: number): Promise<void> {
    // Reuse the CSV export so the backup carries everything export does (sessions, game names,
    // real-time modes, table types) through a single serialization path.
    const csv = await exportSessionsCsv();
    await writeBgaLocalStorage(tabId, csv);
  }

  async restoreFromBga(tabId: number): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    if ((result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined)?.length) return;
    const raw = await readBgaLocalStorage(tabId);
    if (!raw) return;
    await importSessionsCsv(raw);
  }

  private async writeActive(): Promise<void> {
    if (this.active) {
      await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: this.active });
    } else {
      await chrome.storage.local.remove(STORAGE_KEY_ACTIVE);
    }
  }

  private async appendSession(session: TimeSession): Promise<void> {
    // A session with no elapsed time is not real play (e.g. open-then-immediately-leave, or a startup/crash
    // race that finalizes at the same instant it began) — drop it rather than litter history with 0-length rows.
    if (session[3] <= session[2]) return;
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

  private async persistTableType(tableId: number, type: TableType): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY_TYPES);
    const types: TableTypeMap = (result[STORAGE_KEY_TYPES] as TableTypeMap | undefined) ?? {};
    types[tableId] = type;
    await chrome.storage.local.set({ [STORAGE_KEY_TYPES]: types });
  }
}

// ---------------------------------------------------------------------------
// BGA page localStorage backup/restore helpers
// ---------------------------------------------------------------------------

// The backup payload is the CSV produced by exportSessionsCsv, stored under the BGA page's localStorage
// so it survives extension reinstalls.
function readBgaScript(): string | null {
  return localStorage.getItem("bgaa_time_sessions");
}

function writeBgaScript(data: string): void {
  localStorage.setItem("bgaa_time_sessions", data);
}

async function readBgaLocalStorage(tabId: number): Promise<string | null> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: readBgaScript, world: "MAIN" });
  return results[0]?.result ?? null;
}

async function writeBgaLocalStorage(tabId: number, payload: string): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: writeBgaScript, args: [payload], world: "MAIN" } as chrome.scripting.ScriptInjection);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

// game = display name, game_id = the URL slug (so export→import is lossless: the original session slug
// and the slug→name map are both recoverable). realtime: "1"/"0"/"" ; type: tournament|arena|regular|"".
// realtime + type are per-table, inlined on every row like the game name. Parsed by column name on import,
// so adding/reordering columns stays backward-compatible.
const CSV_HEADER = "game,game_id,table_id,from,to,minutes,realtime,type";

export async function exportSessionsCsv(): Promise<string> {
  const result = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, STORAGE_KEY_MODES, STORAGE_KEY_TYPES]);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const gameMap: GameMap = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
  const modeMap: ModeMap = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
  const typeMap: TableTypeMap = (result[STORAGE_KEY_TYPES] as TableTypeMap | undefined) ?? {};
  const clean = (value: string): string => value.replace(/,/g, " ");
  const rows = sessions.map(([slug, tableId, from, to]) => {
    const minutes = ((to - from) / 60000).toFixed(1);
    const game = clean(gameMap[slug] ?? slug);
    const realtime = modeMap[tableId] === true ? "1" : modeMap[tableId] === false ? "0" : "";
    const type = typeMap[tableId] ?? "";
    return `${game},${clean(slug)},${tableId},${new Date(from).toISOString()},${new Date(to).toISOString()},${minutes},${realtime},${type}`;
  });
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/** Parse a CSV produced by exportSessionsCsv and merge it into storage, deduplicating sessions by start timestamp. Restores the session slug + game name and each table's real-time mode and category (first value wins, so live data isn't clobbered). Columns are read by header name; game/game_id/table_id/from/to are required, realtime/type optional. Returns the number of newly added sessions. */
export async function importSessionsCsv(text: string): Promise<number> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return 0;
  const header = lines[0].split(",");
  const col = (name: string): number => header.indexOf(name);
  const iGame = col("game"), iGameId = col("game_id"), iTable = col("table_id"), iFrom = col("from"), iTo = col("to"), iRealtime = col("realtime"), iType = col("type");
  if (iGame < 0 || iGameId < 0 || iTable < 0 || iFrom < 0 || iTo < 0) return 0;
  const result = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_GAMES, STORAGE_KEY_MODES, STORAGE_KEY_TYPES]);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const gameMap: GameMap = (result[STORAGE_KEY_GAMES] as GameMap | undefined) ?? {};
  const modeMap: ModeMap = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
  const typeMap: TableTypeMap = (result[STORAGE_KEY_TYPES] as TableTypeMap | undefined) ?? {};
  const seen = new Set(sessions.map((session) => session[2]));
  let added = 0;
  for (const line of lines.slice(1)) {
    const fields = line.split(",");
    const name = fields[iGame];
    const slug = fields[iGameId];
    const tableId = Number(fields[iTable]);
    const from = Date.parse(fields[iFrom]);
    const to = Date.parse(fields[iTo]);
    if (!name || !slug || Number.isNaN(tableId) || Number.isNaN(from) || Number.isNaN(to)) continue;
    // Per-table / per-game data (handled for every valid row, even duplicate sessions); first value wins.
    if (name !== slug && !(slug in gameMap)) gameMap[slug] = name;
    const realtimeStr = iRealtime >= 0 ? fields[iRealtime] : "";
    const typeStr = iType >= 0 ? fields[iType] : "";
    if (!(tableId in modeMap) && (realtimeStr === "1" || realtimeStr === "0")) modeMap[tableId] = realtimeStr === "1";
    if (!(tableId in typeMap) && (typeStr === "tournament" || typeStr === "arena" || typeStr === "regular")) typeMap[tableId] = typeStr;
    if (seen.has(from)) continue;
    seen.add(from);
    sessions.push([slug, tableId, from, to]);
    added++;
  }
  sessions.sort((a, b) => a[2] - b[2]);
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions, [STORAGE_KEY_GAMES]: gameMap, [STORAGE_KEY_MODES]: modeMap, [STORAGE_KEY_TYPES]: typeMap });
  return added;
}

// ---------------------------------------------------------------------------
// Session deletion
// ---------------------------------------------------------------------------

/** Remove a single recorded session, identified by its start timestamp (unique per session, as used for import dedup). Returns true if a session was removed. */
export async function deleteSession(from: number): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const remaining = sessions.filter((session) => session[2] !== from);
  if (remaining.length === sessions.length) return false;
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: remaining });
  return true;
}

/** Remove every recorded session for a table, along with that table's now-orphaned real-time mode and category metadata. Returns the number of sessions removed. */
export async function deleteTableSessions(tableId: number): Promise<number> {
  const result = await chrome.storage.local.get([STORAGE_KEY_SESSIONS, STORAGE_KEY_MODES, STORAGE_KEY_TYPES]);
  const sessions: TimeSession[] = (result[STORAGE_KEY_SESSIONS] as TimeSession[] | undefined) ?? [];
  const remaining = sessions.filter((session) => session[1] !== tableId);
  const modeMap: ModeMap = (result[STORAGE_KEY_MODES] as ModeMap | undefined) ?? {};
  const typeMap: TableTypeMap = (result[STORAGE_KEY_TYPES] as TableTypeMap | undefined) ?? {};
  delete modeMap[tableId];
  delete typeMap[tableId];
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: remaining, [STORAGE_KEY_MODES]: modeMap, [STORAGE_KEY_TYPES]: typeMap });
  return sessions.length - remaining.length;
}

// ---------------------------------------------------------------------------
// Session normalization
// ---------------------------------------------------------------------------

/** Duration (ms) below which a session counts as a "stray glance" — a forgotten table reopened and immediately closed on the way back to the lobby. */
export const STRAY_GLANCE_MS = 20 * 1000;

/** A real sitting is at least this many times longer than a stray glance that belongs to it. */
export const STRAY_GLANCE_RATIO = 5;

/** Drop stray glances: sub-{@link STRAY_GLANCE_MS} sessions sitting in a run of consecutive same-table sessions that also contains a session at least {@link STRAY_GLANCE_RATIO}× longer. These come from revisiting a forgotten table for a few seconds before returning to the lobby; left in, they litter the session list and dilute a table's per-session average. Sessions are walked in chronological order — a different table's session between two same-table sessions breaks the run, so only back-to-back same-table sessions are grouped. A lone short session, or a cluster of short sessions with no much-longer sitting alongside, is kept untouched. Read-time only: storage and export stay raw. */
export function mergeStrayGlances(sessions: TimeSession[]): TimeSession[] {
  const sorted = sessions.slice().sort((a, b) => a[2] - b[2]);
  const kept: TimeSession[] = [];
  let runStart = 0;
  const flushRun = (runEnd: number): void => {
    const run = sorted.slice(runStart, runEnd);
    const longest = Math.max(...run.map(([, , from, to]) => to - from));
    for (const session of run) {
      const duration = session[3] - session[2];
      const isStray = run.length > 1 && duration < STRAY_GLANCE_MS && longest >= duration * STRAY_GLANCE_RATIO;
      if (!isStray) kept.push(session);
    }
    runStart = runEnd;
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] !== sorted[i - 1][1]) flushRun(i);
  }
  if (sorted.length > 0) flushRun(sorted.length);
  return kept;
}

// ---------------------------------------------------------------------------
// Chart aggregation
// ---------------------------------------------------------------------------

/** Hour (0–23) at which a play-time "day" begins; sessions before it count toward the previous day. */
export const DAY_START_HOUR = 6;

/** Day of the week (0 = Sunday … 6 = Saturday) on which a play-time "week" begins. */
export const WEEK_START_DAY = 1;

export type Granularity = "day" | "week" | "month";

/** Format a duration given in minutes as hours and minutes, with a thin space (U+2009) separating each value from its unit letter, e.g. "1 h 15 m", "45 m", "2 h", "0 m". */
export function formatDuration(minutes: number): string {
  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours} h ${mins} m`;
  if (hours > 0) return `${hours} h`;
  return `${mins} m`;
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

export interface TablePlaytime {
  slug: string;
  tableId: number;
  /** End timestamp (ms) of the most recent session at this table. */
  lastTo: number;
  totalMinutes: number;
  sessionCount: number;
}

/** Group sessions by game table, summing total minutes, counting sessions, and tracking the end of the most recent session. Tables are ordered by most-recent-session end, descending. A table is always one game, so the slug is invariant per table. */
export function aggregateByTable(sessions: TimeSession[]): TablePlaytime[] {
  const byTable = new Map<number, TablePlaytime>();
  for (const [slug, tableId, from, to] of sessions) {
    let entry = byTable.get(tableId);
    if (!entry) {
      entry = { slug, tableId, lastTo: to, totalMinutes: 0, sessionCount: 0 };
      byTable.set(tableId, entry);
    }
    entry.totalMinutes += (to - from) / 60000;
    entry.sessionCount++;
    if (to > entry.lastTo) entry.lastTo = to;
  }
  return [...byTable.values()].sort((a, b) => b.lastTo - a.lastTo);
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
