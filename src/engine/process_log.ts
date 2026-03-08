// Raw BGA packets -> structured game log

import type { TransferEntry, MessageEntry, GameLogEntry } from "../models/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** BGA icon span index -> readable icon name. */
export const ICON_MAP: Record<string, string> = {
  "1": "crown",
  "2": "leaf",
  "3": "lightbulb",
  "4": "castle",
  "5": "factory",
  "6": "clock",
};

/** BGA set type id -> lowercase set label. */
export const SET_MAP: Record<string, string> = {
  "0": "base",
  "2": "cities",
  "3": "echoes",
};

/** Known BGA expansion type ids not yet supported -> display names. */
const UNSUPPORTED_EXPANSION_NAMES: Record<string, string> = {
  "1": "Figures",
};

// ---------------------------------------------------------------------------
// Raw BGA data types
// ---------------------------------------------------------------------------

/** A single BGA notification inside a packet. */
export interface RawNotification {
  type: string;
  args: Record<string, unknown>;
}

/** A BGA notification packet (one move can span multiple packets). */
export interface RawPacket {
  move_id: number | null;
  time: number;
  data: RawNotification[];
}

/** Shape of the raw extraction data sent from the content script. */
export interface RawExtractionData {
  players: Record<string, string>;
  packets: RawPacket[];
  currentPlayerId?: string;
  gamedatas?: {
    my_hand?: Array<{ id: number | string }>;
    cards?: Record<string, { name?: string }>;
  };
}

/** Structured game log output from processRawLog. */
export interface GameLog {
  players: Record<string, string>;
  currentPlayerId: string;
  myHand: string[];
  log: GameLogEntry[];
  expansions: { echoes: boolean };
}

// ---------------------------------------------------------------------------
// Template expansion
// ---------------------------------------------------------------------------

/**
 * Resolve `${key}` placeholders in a BGA log template.
 *
 * Dict values with `log` + `args` keys are recursive sub-templates,
 * expanded and stripped of HTML.
 */
export function expandTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
    const val = args[key];
    if (val === undefined || val === null) return "";
    if (typeof val === "object" && !Array.isArray(val)) {
      const sub = val as Record<string, unknown>;
      if (typeof sub.log === "string" && sub.args && typeof sub.args === "object") {
        const expanded = expandTemplate(sub.log, sub.args as Record<string, unknown>);
        return expanded.replace(/<[^>]+>/g, "").trim();
      }
    }
    return String(val);
  });
}

// ---------------------------------------------------------------------------
// HTML cleaning
// ---------------------------------------------------------------------------

/**
 * Convert BGA HTML log markup to plain text.
 *
 * Icon spans become `[name]`, age spans become `[N]`, all other HTML is
 * stripped, and whitespace is collapsed.
 */
export function cleanHtml(msg: string): string {
  // Icon spans: <span ... icon_N ...></span> -> [iconName]
  msg = msg.replace(/<span[^>]*icon_(\d)[^>]*><\/span>/g, (_m, digit: string) => {
    return "[" + (ICON_MAP[digit] ?? "icon" + digit) + "]";
  });
  // Age spans: <span ... age ...>N</span> -> [N]
  msg = msg.replace(/<span[^>]*age[^>]*>(\d+)<\/span>/g, "[$1]");
  // Strip all remaining HTML tags
  msg = msg.replace(/<[^>]+>/g, "");
  // Collapse whitespace
  return msg.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize BGA card names to match card_info.json entries.
 *
 * Replaces non-breaking hyphens with regular hyphens, decomposes Unicode
 * to NFD form, and strips combining diacritical marks.
 */
export function normalizeName(text: string): string {
  // Replace non-breaking hyphen U+2011 with regular hyphen
  text = text.replace(/\u2011/g, "-");
  // Decompose to NFD and strip combining marks (U+0300..U+036F covers common combining diacriticals)
  text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return text;
}

// ---------------------------------------------------------------------------
// Raw log processing
// ---------------------------------------------------------------------------

/**
 * Transform raw BGA packets into structured game log entries.
 *
 * Two-pass processing:
 * 1. Collect player-view `transferedCard` args grouped by move_id
 * 2. Iterate spectator notifications, pairing with player-view data
 */
export function processRawLog(rawData: RawExtractionData): GameLog {
  const playerNames: Record<string, string> = rawData.players ?? {};
  const allPackets = rawData.packets ?? [];
  const packets = allPackets.filter((p) => p.move_id !== null && p.move_id !== undefined);
  const log: GameLogEntry[] = [];

  // Extract initial hand from gamedatas
  const gamedatas = rawData.gamedatas ?? {};
  const gdHand = gamedatas.my_hand ?? [];
  const gdCards = gamedatas.cards ?? {};
  const myHand: string[] = [];
  for (const card of gdHand) {
    const cardId = String(card.id);
    const info = gdCards[cardId];
    if (info?.name) {
      myHand.push(normalizeName(info.name));
    }
  }

  // Pass 1: collect player-view transferedCard args, grouped by move_id.
  // Accumulate across all packets sharing the same move_id.
  const playerTransfersByMove = new Map<number, Record<string, unknown>[]>();
  for (const packet of packets) {
    const moveId = packet.move_id!;
    for (const notif of packet.data) {
      if (notif.type === "transferedCard") {
        let transfers = playerTransfersByMove.get(moveId);
        if (!transfers) {
          transfers = [];
          playerTransfersByMove.set(moveId, transfers);
        }
        transfers.push(notif.args);
      }
    }
  }
  const playerTransferIterators = new Map<number, Iterator<Record<string, unknown>>>();
  for (const [moveId, transfers] of playerTransfersByMove) {
    playerTransferIterators.set(moveId, transfers[Symbol.iterator]());
  }

  // Pass 2: iterate spectator notifications (the canonical ordering).
  let hasEchoesTransfer = false;
  for (const packet of packets) {
    const moveId = packet.move_id!;

    for (const notif of packet.data) {
      const notifType = notif.type;

      if (notifType === "transferedCard_spectator") {
        const iterator = playerTransferIterators.get(moveId);
        const playerArgsResult = iterator?.next();
        if (!playerArgsResult || playerArgsResult.done) continue;
        const playerArgs = playerArgsResult.value;

        const cardName = playerArgs.name ? normalizeName(String(playerArgs.name)) : null;
        const rawAge = playerArgs.age;
        const cardAge = rawAge !== null && rawAge !== undefined ? Number(rawAge) : null;

        const setTypeId = String(notif.args.type);
        const cardSet = SET_MAP[setTypeId];
        if (cardSet === undefined) {
          const expansionName = UNSUPPORTED_EXPANSION_NAMES[setTypeId];
          if (expansionName) throw new Error(`This table uses the "${expansionName}" expansion, which is not yet supported.`);
          throw new Error(`Unknown card set type ID: ${setTypeId}`);
        }

        if (cardSet === "echoes") hasEchoesTransfer = true;

        const entry: TransferEntry = {
          type: "transfer",
          move: moveId,
          cardSet,
          source: String(playerArgs.location_from),
          dest: String(playerArgs.location_to),
          cardName,
          cardAge,
          sourceOwner: playerNames[String(playerArgs.owner_from)] ?? null,
          destOwner: playerNames[String(playerArgs.owner_to)] ?? null,
          meldKeyword: Boolean(playerArgs.meld_keyword),
        };
        log.push(entry);
        continue;
      }

      if (notifType === "log_spectator" || notifType === "logWithCardTooltips_spectator") {
        const args = notif.args;
        const logTemplate = String(args.log ?? "");
        if (logTemplate === "<!--empty-->") continue;
        const logMsg = cleanHtml(expandTemplate(logTemplate, args as Record<string, unknown>));
        const entry: MessageEntry = {
          move: moveId,
          type: notifType.replace("_spectator", "") as "log" | "logWithCardTooltips",
          msg: logMsg,
        };
        log.push(entry);
      }
    }
  }

  return { players: playerNames, currentPlayerId: rawData.currentPlayerId ?? "", myHand, log, expansions: { echoes: hasEchoesTransfer } };
}
