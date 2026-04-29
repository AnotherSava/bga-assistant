// Raw BGA packets -> structured Crew game log

import type { PlayerInfo, RawExtractionData, RawPacket } from "../../models/types.js";
import type { CrewCard } from "./types.js";

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

export type CrewLogEntry =
  | MissionStartEntry
  | HandDealtEntry
  | CaptainEntry
  | TrickStartEntry
  | CardPlayedEntry
  | TrickWonEntry
  | CommunicationEntry
  | CardExchangeEntry;

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

// ---------------------------------------------------------------------------
// Log processing
// ---------------------------------------------------------------------------

function parseCard(bgaCard: BgaCard): CrewCard {
  return { suit: Number(bgaCard.color), value: Number(bgaCard.value) };
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
