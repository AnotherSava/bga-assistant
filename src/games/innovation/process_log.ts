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
  "1": "artifacts",
  "2": "cities",
  "3": "echoes",
  "4": "figures",
};

/** Structured game log output from processRawLog. */
export interface GameLog {
  gameName: "innovation";
  players: Record<string, string>;
  currentPlayerId: string;
  myHand: string[];
  log: GameLogEntry[];
  actions: TurnAction[];
  expansions: { echoes: boolean; artifacts: boolean; relics: boolean };
  /** Names (as cardIndex) of cards flagged is_relic in gamedata.cards at game start.
   *  Drives deck-init adjustment: relic cards start in the relics zone, not in their deck. */
  initialRelics: string[];
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

interface DisplayCard {
  cardName: string | null;
  cardAge: number | null;
  cardSet: string;
}

interface ArtifactWindow {
  player: string;
  time: number | null;
  logIndex: number;
}

/** Try to classify a pending action from a transfer entry. Returns null if the transfer is not an action. */
function classifyTransfer(entry: TransferEntry): ActionDetail | null {
  // Regular achievement claim: anonymous card movement within the achievements pool.
  // Relic seizes involving achievements always name the card — those fall through.
  if (entry.source === "achievements" && entry.dest === "achievements" && entry.cardName === null) {
    return { actionType: "achieve", cardName: null, cardAge: entry.cardAge, cardSet: null };
  }
  if (entry.meldKeyword && entry.source === "hand" && entry.dest === "board") {
    return { actionType: "meld", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet };
  }
  if (entry.source === "deck") {
    return { actionType: "draw", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet };
  }
  if (entry.source === "relics") {
    return { actionType: "seize", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet };
  }
  return null;
}

/** Match the BGA dogma log line, extracting (age, cardName). Null if not a dogma message. */
function matchDogma(msg: string): { cardAge: number; cardName: string } | null {
  const m = msg.match(/activates the dogma of (\d+) (.+?) with/);
  if (!m) return null;
  return { cardAge: Number(m[1]), cardName: m[2].trim() };
}

/** Try to classify a pending action from a logWithCardTooltips message. Returns null if not a dogma/endorse. */
function classifyMessage(entry: MessageEntry): ActionDetail | null {
  const dogma = matchDogma(entry.msg);
  if (dogma) {
    return { actionType: "dogma", cardName: dogma.cardName, cardAge: null, cardSet: null };
  }
  const endorseMatch = entry.msg.match(/endorses the dogma of (\d+) (.+?) with/);
  if (endorseMatch) {
    return { actionType: "endorse", cardName: endorseMatch[2].trim(), cardAge: null, cardSet: null };
  }
  return null;
}

/** Match the "chooses not to return or dogma" pass log line, extracting the player name. */
function matchArtifactPass(msg: string): string | null {
  const m = msg.match(/^(.+?) chooses not to return or dogma (?:his|her) Artifact on display\.$/);
  return m ? m[1] : null;
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

  // Scan gamedatas.cards for relic cards (public knowledge — placed in the
  // "relics" zone at game start when the with-relics variant is active).
  // Each age 3-7 has exactly one relic, so (age) is a unique key used later
  // to resolve anonymous relic transfers (BGA omits the card name on re-seizes).
  const initialRelics: string[] = [];
  const relicNameByAge = new Map<number, string>();
  let hasRelicsZone = false;
  for (const info of Object.values(gdCards)) {
    if (info && String(info.is_relic) === "1" && typeof info.name === "string") {
      hasRelicsZone = true;
      const name = normalizeName(info.name);
      initialRelics.push(name);
      relicNameByAge.set(Number(info.age), name);
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
  // Track pending player action: gameStateChange fires before the action's
  // entries arrive, so we classify the action from the first relevant entry
  // after the marker, then push the completed TurnAction.
  let hasEchoesTransfer = false;
  let hasArtifactsTransfer = false;
  const actions: TurnAction[] = [];
  let pendingAction: PendingAction | null = null;
  let lastPending: { player: string; actionNumber: number; move: number } | null = null;
  let currentAction: TurnAction | null = null;
  const displaysByPlayer = new Map<string, DisplayCard>();
  let artifactWindow: ArtifactWindow | null = null;
  let lastArtifactOpen: { player: string; move: number } | null = null;

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

        const rawAge = playerArgs.age;
        const cardAge = rawAge !== null && rawAge !== undefined ? Number(rawAge) : null;
        let cardName = playerArgs.name ? normalizeName(String(playerArgs.name)) : null;
        // BGA omits the card name on some relic transfers (e.g. relics→achievements,
        // achievements→hand re-seizes). The is_relic flag + age uniquely identifies
        // the card, so fill the name in from the known relic roster.
        if (!cardName && String(playerArgs.is_relic) === "1" && cardAge !== null) {
          const resolved = relicNameByAge.get(cardAge);
          if (resolved) cardName = resolved;
        }

        const setTypeId = String(notif.args.type);
        const cardSet = SET_MAP[setTypeId];
        if (cardSet === undefined) {
          const expansionName = UNSUPPORTED_EXPANSION_NAMES[setTypeId];
          if (expansionName) throw new Error(`This table uses the "${expansionName}" expansion, which is not yet supported.`);
          throw new Error(`Unknown card set type ID: ${setTypeId}`);
        }

        if (cardSet === "echoes") hasEchoesTransfer = true;
        if (cardSet === "artifacts") hasArtifactsTransfer = true;

        const dest = String(playerArgs.location_to);
        const bto = playerArgs.bottom_to;
        const isBottom = bto === true || bto === 1 || String(bto) === "1";
        const entry: TransferEntry = {
          type: "transfer",
          move: moveId,
          cardSet,
          source: String(playerArgs.location_from),
          dest,
          cardName,
          cardAge,
          sourceOwner: playerNames[String(playerArgs.owner_from)] ?? null,
          destOwner: playerNames[String(playerArgs.owner_to)] ?? null,
          meldKeyword: Boolean(playerArgs.meld_keyword),
          topOfDeck: dest === "deck" && !isBottom,
        };
        log.push(entry);

        // Track artifact display occupancy for later pass-message attribution
        if (entry.dest === "display" && entry.destOwner) {
          displaysByPlayer.set(entry.destOwner, { cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet });
        }
        if (entry.source === "display" && entry.sourceOwner) {
          displaysByPlayer.delete(entry.sourceOwner);
        }

        // Artifact-step: return-from-display inside an open artifact window
        if (artifactWindow && entry.source === "display" && entry.dest === "deck" && entry.sourceOwner === artifactWindow.player) {
          actions.push({ player: artifactWindow.player, actionNumber: 0, time: artifactWindow.time, logIndex: artifactWindow.logIndex, actions: [{ actionType: "artifact_return", cardName: entry.cardName, cardAge: entry.cardAge, cardSet: entry.cardSet }] });
          artifactWindow = null;
          continue;
        }

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

        // Artifact-step: pass message inside an open artifact window
        if (artifactWindow && entry.type === "log") {
          const passPlayer = matchArtifactPass(entry.msg);
          if (passPlayer && passPlayer === artifactWindow.player) {
            const display = displaysByPlayer.get(artifactWindow.player) ?? { cardName: null, cardAge: null, cardSet: "artifacts" };
            actions.push({ player: artifactWindow.player, actionNumber: 0, time: artifactWindow.time, logIndex: artifactWindow.logIndex, actions: [{ actionType: "artifact_pass", cardName: display.cardName, cardAge: display.cardAge, cardSet: display.cardSet }] });
            artifactWindow = null;
            continue;
          }
        }

        // Artifact-step: FAD dogma inside an open artifact window
        if (artifactWindow && entry.type === "logWithCardTooltips") {
          const dogma = matchDogma(entry.msg);
          if (dogma && entry.msg.startsWith(`${artifactWindow.player} activates the dogma`)) {
            actions.push({ player: artifactWindow.player, actionNumber: 0, time: artifactWindow.time, logIndex: artifactWindow.logIndex, actions: [{ actionType: "artifact_dogma", cardName: dogma.cardName, cardAge: dogma.cardAge, cardSet: "artifacts" }] });
            artifactWindow = null;
            continue;
          }
        }

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

      if (notifType === "gameStateChange") {
        const stateArgs = notif.args;
        const stateId = String(stateArgs.id);
        if (stateId === "15") {
          // id:15 fires on artifact-decision turns. Process from any channel
          // (sometimes only the player channel emits it) and dedup by (player, move).
          const playerId = String(stateArgs.active_player);
          const playerName = playerNames[playerId] ?? playerId;
          if (lastArtifactOpen && lastArtifactOpen.move === moveId && lastArtifactOpen.player === playerName) continue;
          artifactWindow = { player: playerName, time: packet.time ?? null, logIndex: log.length };
          lastArtifactOpen = { player: playerName, move: moveId };
          continue;
        }
        if (stateId === "4" && isSpectatorPacket && stateArgs.args && typeof stateArgs.args === "object") {
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
            // Clear any still-open artifact window (should have classified already)
            artifactWindow = null;
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

  return {
    gameName: "innovation",
    players: playerNames,
    currentPlayerId: rawData.currentPlayerId ?? "",
    myHand,
    log,
    actions,
    expansions: { echoes: hasEchoesTransfer, artifacts: hasArtifactsTransfer, relics: hasRelicsZone },
    initialRelics,
  };
}
