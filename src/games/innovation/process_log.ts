// Raw BGA packets -> structured game log

import type { TransferEntry, MessageEntry, GameLogEntry, RawExtractionData } from "./types.js";
import type { TurnAction, ActionDetail } from "./turn_history.js";

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

/** Structured game log output from processRawLog. */
export interface GameLog {
  gameName: "innovation";
  players: Record<string, string>;
  currentPlayerId: string;
  myHand: string[];
  log: GameLogEntry[];
  actions: TurnAction[];
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
    const iconName = ICON_MAP[digit];
    if (!iconName) throw new Error(`Unknown icon digit "${digit}" in BGA message`);
    return "[" + iconName + "]";
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
// Action classification helpers
// ---------------------------------------------------------------------------

interface PendingAction {
  player: string;
  actionNumber: number;
  time: number | null;
  logIndex: number;
}

/** Try to classify a pending action from a transfer entry. Returns null if the transfer is not an action. */
function classifyTransfer(entry: TransferEntry): ActionDetail | null {
  if (entry.source === "achievements" && entry.dest === "achievements") {
    return { actionType: "achieve", cardName: null, cardAge: entry.cardAge, cardSet: null };
  }
  if (entry.meldKeyword && entry.source === "hand" && entry.dest === "board") {
    return { actionType: "meld", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet };
  }
  if (entry.source === "deck") {
    return { actionType: "draw", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet };
  }
  return null;
}

/** Try to classify a pending action from a logWithCardTooltips message. Returns null if not a dogma/endorse. */
function classifyMessage(entry: MessageEntry): ActionDetail | null {
  const dogmaMatch = entry.msg.match(/activates the dogma of (\d+) (.+?) with/);
  if (dogmaMatch) {
    return { actionType: "dogma", cardName: dogmaMatch[2].trim(), cardAge: null, cardSet: null };
  }
  const endorseMatch = entry.msg.match(/endorses the dogma of (\d+) (.+?) with/);
  if (endorseMatch) {
    return { actionType: "endorse", cardName: endorseMatch[2].trim(), cardAge: null, cardSet: null };
  }
  return null;
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
    if (!info?.name) throw new Error(`Card ID ${cardId} in initial hand has no name in gamedatas`);
    myHand.push(normalizeName(info.name));
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
  // Track pending player action: gameStateChange fires before the action's
  // entries arrive, so we classify the action from the first relevant entry
  // after the marker, then push the completed TurnAction.
  let hasEchoesTransfer = false;
  const actions: TurnAction[] = [];
  let pendingAction: PendingAction | null = null;
  let lastPending: { player: string; actionNumber: number; move: number } | null = null;
  let currentAction: TurnAction | null = null;

  for (const packet of packets) {
    const moveId = packet.move_id!;
    // gameStateChange has no _spectator suffix but appears in both channels.
    // Only process it from spectator-channel packets to preserve ordering with transfers/logs.
    const isSpectatorPacket = packet.data.some((n: { type: string }) => n.type.endsWith("_spectator"));

    for (const notif of packet.data) {
      const notifType = notif.type;

      if (notifType === "transferedCard_spectator") {
        const iterator = playerTransferIterators.get(moveId);
        if (!iterator) throw new Error(`No player transfer data for move ${moveId} to pair with spectator transfer`);
        const playerArgsResult = iterator.next();
        if (playerArgsResult.done) throw new Error(`Player transfer iterator exhausted for move ${moveId} — player/spectator transfer count mismatch`);
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

        // Classify pending action from first transfer after marker
        if (pendingAction) {
          const detail = classifyTransfer(entry);
          if (detail) {
            const turnAction: TurnAction = { player: pendingAction.player, actionNumber: pendingAction.actionNumber, time: pendingAction.time, logIndex: pendingAction.logIndex, actions: [detail] };
            actions.push(turnAction);
            currentAction = turnAction;
            pendingAction = null;
          }
        } else if (currentAction && entry.source === "forecast" && entry.dest === "board" && entry.meldKeyword) {
          currentAction.actions.push({ actionType: "promote", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet });
        }
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

        // Classify pending action from first dogma/endorse message after marker
        if (pendingAction && entry.type === "logWithCardTooltips") {
          const detail = classifyMessage(entry);
          if (detail) {
            const turnAction: TurnAction = { player: pendingAction.player, actionNumber: pendingAction.actionNumber, time: pendingAction.time, logIndex: pendingAction.logIndex, actions: [detail] };
            actions.push(turnAction);
            currentAction = turnAction;
            pendingAction = null;
          }
        } else if (currentAction && entry.type === "logWithCardTooltips") {
          const detail = classifyMessage(entry);
          if (detail && detail.actionType === "dogma" && currentAction.actions.some((a) => a.actionType === "promote")) {
            currentAction.actions.push(detail);
          }
        }
      }

      if (notifType === "gameStateChange" && isSpectatorPacket) {
        const stateArgs = notif.args;
        if (String(stateArgs.id) === "4" && stateArgs.args && typeof stateArgs.args === "object") {
          const innerArgs = stateArgs.args as Record<string, unknown>;
          if (innerArgs.action_number !== undefined) {
            const playerId = String(stateArgs.active_player);
            const playerName = playerNames[playerId] ?? playerId;
            const actionNumber = Number(innerArgs.action_number);
            // Deduplicate: gameStateChange fires in both player and spectator channels
            if (lastPending && lastPending.move === moveId && lastPending.player === playerName && lastPending.actionNumber === actionNumber) continue;
            // New action marker ends sub-action scanning for the previous action
            currentAction = null;
            // If previous action was never classified, it stays pending
            if (pendingAction) {
              actions.push({ player: pendingAction.player, actionNumber: pendingAction.actionNumber, time: pendingAction.time, logIndex: pendingAction.logIndex, actions: [{ actionType: "pending", cardName: null, cardAge: null, cardSet: null }] });
            }
            pendingAction = { player: playerName, actionNumber, time: packet.time ?? null, logIndex: log.length };
            lastPending = { player: playerName, actionNumber, move: moveId };
          }
        }
      }
    }
  }

  // Flush: if the last action was never classified, emit as pending
  if (pendingAction) {
    actions.push({ player: pendingAction.player, actionNumber: pendingAction.actionNumber, time: pendingAction.time, logIndex: pendingAction.logIndex, actions: [{ actionType: "pending", cardName: null, cardAge: null, cardSet: null }] });
  }

  return { gameName: "innovation", players: playerNames, currentPlayerId: rawData.currentPlayerId ?? "", myHand, log, actions, expansions: { echoes: hasEchoesTransfer } };
}
