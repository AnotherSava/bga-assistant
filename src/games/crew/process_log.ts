// Raw BGA packets -> structured Crew game log

import type { PlayerInfo, RawExtractionData, RawPacket } from "../../models/types.js";
import type { BgaText, CrewCard, CrewTask, TaskBundle } from "./types.js";

// ---------------------------------------------------------------------------
// Crew log entry types — discriminated union
// ---------------------------------------------------------------------------

/** New mission started. */
export interface MissionStartEntry {
  type: "missionStart";
  missionId: number;
  missionNumber: number;
}

/** Observer's hand dealt at mission start. */
export interface HandDealtEntry {
  type: "handDealt";
  cards: CrewCard[];
}

/** Captain identified — this player holds Submarine 4. */
export interface CaptainEntry {
  type: "captain";
  playerId: string;
}

/** A new trick begins. */
export interface TrickStartEntry {
  type: "trickStart";
}

/** A card was played. */
export interface CardPlayedEntry {
  type: "cardPlayed";
  playerId: string;
  card: CrewCard;
}

/** A trick was won. */
export interface TrickWonEntry {
  type: "trickWon";
  winnerId: string;
}

/** A player communicated a card via sonar token. */
export interface CommunicationEntry {
  type: "communication";
  playerId: string;
  card: CrewCard;
  position: "top" | "bottom" | "middle" | "hidden";
}

/** Distress signal: observer gave a card to a specific player and received one back. */
export interface CardExchangeEntry {
  type: "cardExchange";
  givenCard: CrewCard;
  givenToPlayerId: string;
  receivedCard: CrewCard;
}

/**
 * The free-allocation phase as BGA states it on entering: every task on offer, in the order that
 * fixes their letters, and every player's bundles so far. A whole snapshot, so it replaces what
 * the incremental entries below have built up rather than adding to it.
 */
export interface FreeAllocationEntry {
  type: "freeAllocation";
  tasks: CrewTask[];
  bundles: Record<string, TaskBundle[]>;
}

/** A player rated a group of tasks, or changed a rating they had already given. */
export interface BundleEntry {
  type: "bundle";
  playerId: string;
  bundle: TaskBundle;
}

/** A player withdrew one of their bundles. */
export interface BundleRemovedEntry {
  type: "bundleRemoved";
  playerId: string;
  bundleId: number;
}

export type CrewLogEntry =
  | MissionStartEntry
  | HandDealtEntry
  | CaptainEntry
  | TrickStartEntry
  | CardPlayedEntry
  | TrickWonEntry
  | CommunicationEntry
  | CardExchangeEntry
  | FreeAllocationEntry
  | BundleEntry
  | BundleRemovedEntry;

// ---------------------------------------------------------------------------
// Crew game log
// ---------------------------------------------------------------------------

/** Structured Crew game log output from processCrewLog. */
export interface CrewGameLog {
  gameName: "thecrewdeepsea";
  players: Record<string, PlayerInfo>;
  playerOrder: string[];
  playerCardCounts: Record<string, number>;
  currentPlayerId: string;
  log: CrewLogEntry[];
}

// ---------------------------------------------------------------------------
// BGA notification shapes (internal)
// ---------------------------------------------------------------------------

interface BgaCard {
  id: string;
  color: string;
  value: string;
  location: string;
  pId: string;
}

interface BgaPlayer {
  id: string;
  name: string;
  no: string;
  nCards: number;
}

interface BgaTask {
  id: string | number;
  difficulty: number;
  text: BgaText;
  subtext: string | null;
}

interface BgaBundle {
  id: number | string;
  opinion: number | string;
  tasks: (string | number)[];
}

/**
 * Args of a `gameStateChange`, whose own `args` carry whatever that state needs.
 *
 * A player's bundles arrive as an object rather than an array once they have withdrawn one: BGA
 * spells a PHP array as a JSON array only while its keys still run 0..n-1, and a delete leaves a
 * hole. `tasks` and a bundle's own `tasks` are built fresh and never index-deleted, so both stay
 * arrays — checked across a whole table's history, not assumed.
 */
interface BgaStateChange {
  args?: { tasks?: BgaTask[]; bundles?: Record<string, BgaBundle[] | Record<string, BgaBundle>> };
}

// ---------------------------------------------------------------------------
// Log processing
// ---------------------------------------------------------------------------

function parseCard(bgaCard: BgaCard): CrewCard {
  return { suit: Number(bgaCard.color), value: Number(bgaCard.value) };
}

/** Task ids arrive as numbers in one field and strings in another, so everything is keyed as a string. */
function parseTask(task: BgaTask): CrewTask {
  return { id: String(task.id), difficulty: Number(task.difficulty), text: task.text, subtext: task.subtext };
}

function parseBundle(bundle: BgaBundle): TaskBundle {
  return { id: Number(bundle.id), taskIds: bundle.tasks.map(String), opinion: Number(bundle.opinion) };
}

/** One player's bundles, in either spelling BGA gives them (see `BgaStateChange`). */
function parseBundleList(bundles: BgaBundle[] | Record<string, BgaBundle>): TaskBundle[] {
  return (Array.isArray(bundles) ? bundles : Object.values(bundles)).map(parseBundle);
}

/**
 * Transform raw BGA packets into a structured Crew game log.
 *
 * Extracts notification types relevant to card tracking:
 * - startNewMission: mission boundary
 * - newHand: observer's cards
 * - captain: who holds Submarine 4
 * - newTrick: trick boundary + player seat order (first occurrence)
 * - playCard: card played
 * - trickWin: trick winner
 * - endComm: sonar communication
 * - giveCard + receiveCard: distress signal card exchange
 * - gameStateChange: the free-allocation phase, when its args carry the tasks and the bundles
 * - newBundle / updateBundle / deleteBundle: one player's opinion of a group of tasks
 */
export function processCrewLog(rawData: RawExtractionData): CrewGameLog {
  const players: Record<string, PlayerInfo> = rawData.players ?? {};
  const allPackets: RawPacket[] = rawData.packets ?? [];
  const log: CrewLogEntry[] = [];
  let playerOrder: string[] = [];
  let playerCardCounts: Record<string, number> = {};
  let playerOrderExtracted = false;

  let pendingGive: { card: CrewCard; toPlayerId: string } | null = null;
  let pendingReceive: { card: CrewCard } | null = null;

  for (const packet of allPackets) {
    for (const notif of packet.data) {
      switch (notif.type) {
        case "startNewMission": {
          const args = notif.args;
          const mission = args.mission as { id: number } | undefined;
          log.push({
            type: "missionStart",
            missionId: mission ? mission.id : (args.mission_nbr as number),
            missionNumber: args.mission_nbr as number,
          });
          // Re-extract player order and card counts from next newTrick.
          playerOrderExtracted = false;
          playerCardCounts = {};
          break;
        }

        case "newHand": {
          const hand = notif.args.hand as BgaCard[];
          log.push({
            type: "handDealt",
            cards: hand.map(parseCard),
          });
          break;
        }

        case "captain": {
          const playerId = String(notif.args.player_id);
          log.push({ type: "captain", playerId });
          break;
        }

        case "newTrick": {
          if (!playerOrderExtracted) {
            const players = notif.args.players as Record<string, BgaPlayer> | undefined;
            if (players) {
              const sorted = Object.entries(players).sort(([, a], [, b]) => Number(a.no) - Number(b.no));
              playerOrder = sorted.map(([pid]) => pid);
              playerCardCounts = Object.fromEntries(sorted.map(([pid, p]) => [pid, p.nCards]));
              playerOrderExtracted = true;
            }
          }
          log.push({ type: "trickStart" });
          break;
        }

        case "playCard": {
          const card = notif.args.card as BgaCard;
          log.push({
            type: "cardPlayed",
            playerId: String(notif.args.player_id),
            card: parseCard(card),
          });
          break;
        }

        case "trickWin": {
          log.push({
            type: "trickWon",
            winnerId: String(notif.args.player_id),
          });
          break;
        }

        case "endComm": {
          const card = notif.args.card as BgaCard;
          log.push({
            type: "communication",
            playerId: String(notif.args.player_id),
            card: parseCard(card),
            position: notif.args.comm_status as "top" | "bottom" | "middle" | "hidden",
          });
          break;
        }

        case "giveCard": {
          const card = notif.args.card as BgaCard;
          pendingGive = { card: parseCard(card), toPlayerId: String(notif.args.player_id) };
          if (pendingReceive) {
            log.push({ type: "cardExchange", givenCard: pendingGive.card, givenToPlayerId: pendingGive.toPlayerId, receivedCard: pendingReceive.card });
            pendingGive = null;
            pendingReceive = null;
          }
          break;
        }

        case "receiveCard": {
          const card = notif.args.card as BgaCard;
          pendingReceive = { card: parseCard(card) };
          if (pendingGive) {
            log.push({ type: "cardExchange", givenCard: pendingGive.card, givenToPlayerId: pendingGive.toPlayerId, receivedCard: pendingReceive.card });
            pendingGive = null;
            pendingReceive = null;
          }
          break;
        }

        case "gameStateChange": {
          // The free-allocation state states the whole phase in its args. Recognised by that pair
          // of keys rather than by the state's number, which is BGA's to renumber.
          const stateArgs = (notif.args as BgaStateChange).args;
          if (!stateArgs?.tasks || !stateArgs.bundles) break;
          const bundles: Record<string, TaskBundle[]> = {};
          for (const [playerId, playerBundles] of Object.entries(stateArgs.bundles)) {
            bundles[playerId] = parseBundleList(playerBundles);
          }
          log.push({ type: "freeAllocation", tasks: stateArgs.tasks.map(parseTask), bundles });
          break;
        }

        // A bundle arrives whole whether it is new or edited, so both say the same thing.
        case "newBundle":
        case "updateBundle": {
          log.push({ type: "bundle", playerId: String(notif.args.player_id), bundle: parseBundle(notif.args.bundle as BgaBundle) });
          break;
        }

        case "deleteBundle": {
          log.push({ type: "bundleRemoved", playerId: String(notif.args.player_id), bundleId: Number((notif.args.bundle as BgaBundle).id) });
          break;
        }
      }
    }
  }

  return {
    gameName: "thecrewdeepsea" as const,
    players,
    playerOrder,
    playerCardCounts,
    currentPlayerId: rawData.currentPlayerId ?? (() => { throw new Error("currentPlayerId missing from extraction data"); })(),
    log,
  };
}
