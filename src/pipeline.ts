// Pure pipeline logic: game log processing and state computation.
// Shared by background.ts (Chrome extension) and CLI scripts.

import { processRawLog, type GameLog } from "./games/innovation/process_log.js";
import { createGameState } from "./games/innovation/game_state.js";
import { GameEngine } from "./games/innovation/game_engine.js";
import { toJSON as innovationToJSON, type SerializedGameState } from "./games/innovation/serialization.js";
import { processAzulLog, type AzulGameLog } from "./games/azul/process_log.js";
import { processLog as processAzulState, toJSON as azulToJSON, type SerializedAzulGameState } from "./games/azul/game_state.js";
import { processCrewLog, type CrewGameLog } from "./games/crew/process_log.js";
import { processCrewState } from "./games/crew/game_engine.js";
import { crewToJSON, type SerializedCrewGameState } from "./games/crew/serialization.js";
import { CardDatabase, CardSet, type GameName, type RawExtractionData } from "./models/types.js";

/** Supplement transfer-based Echoes detection with myHand-based detection. */
export function detectEchoes(log: GameLog, cardDb: CardDatabase): void {
  if (!log.expansions.echoes) {
    for (const name of log.myHand) {
      const info = cardDb.get(name.toLowerCase());
      if (info && info.cardSet === CardSet.ECHOES) {
        log.expansions.echoes = true;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialized pipeline results for side panel consumption. */
export type PipelineResults =
  | { gameName: "innovation"; tableNumber: string; rawData: RawExtractionData; gameLog: GameLog; gameState: SerializedGameState }
  | { gameName: "azul"; tableNumber: string; rawData: RawExtractionData; gameLog: AzulGameLog; gameState: SerializedAzulGameState }
  | { gameName: "thecrewdeepsea"; tableNumber: string; rawData: RawExtractionData; gameLog: CrewGameLog; gameState: SerializedCrewGameState }
  | { gameName: string; tableNumber: string; rawData: RawExtractionData; gameLog: null; gameState: null };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check if a player count is valid for a given game.
 * Innovation requires exactly 2 players; Azul accepts 2-4; Crew accepts 3-5.
 */
export function isValidPlayerCount(gameName: GameName, playerCount: number): boolean {
  if (gameName === "azul") return playerCount >= 2 && playerCount <= 4;
  if (gameName === "thecrewdeepsea") return playerCount >= 3 && playerCount <= 5;
  return playerCount === 2;
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

/** Process raw extraction data into a structured game log. */
export function processGameLog(rawData: RawExtractionData, gameName: GameName, cardDb?: CardDatabase): GameLog | AzulGameLog | CrewGameLog {
  if (gameName === "thecrewdeepsea") return processCrewLog(rawData);
  if (gameName === "azul") return processAzulLog(rawData);
  if (gameName === "innovation") {
    const gameLog = processRawLog(rawData);
    if (cardDb) detectEchoes(gameLog, cardDb);
    return gameLog;
  }
  throw new Error(`Log processing not implemented for game: ${gameName}`);
}

/** Process a game log into serialized game state. */
export function processGameState(gameLog: GameLog | AzulGameLog | CrewGameLog, gameName: GameName, cardDb: CardDatabase): SerializedGameState | SerializedAzulGameState | SerializedCrewGameState {
  if (gameName === "thecrewdeepsea") {
    const crewState = processCrewState(gameLog as CrewGameLog);
    return crewToJSON(crewState);
  }

  if (gameName === "azul") {
    const azulLog = gameLog as AzulGameLog;
    const azulState = processAzulState(azulLog.log);
    return azulToJSON(azulState);
  }

  if (gameName === "innovation") {
    const innovationLog = gameLog as GameLog;
    detectEchoes(innovationLog, cardDb);
    const players = Object.values(innovationLog.players);
    const perspective = innovationLog.currentPlayerId && innovationLog.players[innovationLog.currentPlayerId] ? innovationLog.currentPlayerId : players[0].id;
    const engine = new GameEngine(cardDb);
    const state = createGameState(players, perspective);
    engine.initGame(state, innovationLog.expansions, innovationLog.initialRelics);
    engine.processLog(state, innovationLog.log, innovationLog.myHand);
    return innovationToJSON(state);
  }

  throw new Error(`State processing not implemented for game: ${gameName}`);
}

// ---------------------------------------------------------------------------
// Combined pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full analysis pipeline on raw extraction data.
 */
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "innovation"): Extract<PipelineResults, { gameName: "innovation" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "azul"): Extract<PipelineResults, { gameName: "azul" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: "thecrewdeepsea"): Extract<PipelineResults, { gameName: "thecrewdeepsea" }>;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: GameName): PipelineResults;
export function runPipeline(rawData: RawExtractionData, database: CardDatabase, tableNumber: string, gameName: GameName): PipelineResults {
  const playerCount = Object.keys(rawData.players).length;
  if (!isValidPlayerCount(gameName, playerCount)) {
    throw new Error(`${gameName} does not support ${playerCount}-player games`);
  }

  const gameLog = processGameLog(rawData, gameName, database);
  const gameState = processGameState(gameLog, gameName, database);

  return { gameName, tableNumber, rawData, gameLog, gameState } as PipelineResults;
}
