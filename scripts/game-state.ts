// CLI: game_log.json → game_state.json (+ optional --debug snapshots)
// Usage: npx tsx scripts/game-state.ts <game_log.json> [--debug]

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { processGameState } from "../src/pipeline.js";
import { CardDatabase, type GameName } from "../src/models/types.js";
import type { GameLog } from "../src/games/innovation/process_log.js";
import type { AzulGameLog } from "../src/games/azul/process_log.js";
import type { CrewGameLog } from "../src/games/crew/process_log.js";
import { createGameState } from "../src/games/innovation/game_state.js";
import { GameEngine } from "../src/games/innovation/game_engine.js";
import { toJSON as innovationToJSON } from "../src/games/innovation/serialization.js";
import { processLog as processAzulState, toJSON as azulToJSON } from "../src/games/azul/game_state.js";
import { processCrewState } from "../src/games/crew/game_engine.js";
import { crewToJSON } from "../src/games/crew/serialization.js";

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const gameFlag = args.find((a, i) => i > 0 && args[i - 1] === "--game") as GameName | undefined;
const inputPath = args.find((a, i) => !a.startsWith("--") && (i === 0 || args[i - 1] !== "--game"));

if (!inputPath) {
  console.error("Usage: npx tsx scripts/game-state.ts <game_log.json> [--debug] [--game <name>]");
  process.exit(1);
}

const gameLog = JSON.parse(readFileSync(inputPath, "utf-8"));
const gameName = (gameLog.gameName ?? gameFlag) as GameName;

if (!gameName) {
  console.error("Error: game_log.json has no gameName field. Specify --game <name> (e.g. --game innovation).");
  process.exit(1);
}
const outputDir = dirname(inputPath);

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadCardDb(): CardDatabase {
  const raw = JSON.parse(readFileSync(join(scriptDir, "../assets/bga/innovation/card_info.json"), "utf-8"));
  return new CardDatabase(raw);
}

console.log(`Processing ${gameName} game state from ${inputPath}${debug ? " (debug mode)" : ""}`);

// Full state
const cardDb = gameName === "innovation" ? loadCardDb() : new CardDatabase([]);
const gameState = processGameState(gameLog, gameName, cardDb);
const outputPath = join(outputDir, "game_state.json");
writeFileSync(outputPath, JSON.stringify(gameState, null, 2) + "\n");
console.log(`Wrote ${outputPath}`);

// Debug snapshots
if (debug) {
  const snapshotDir = join(outputDir, "game_states");
  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });
  let snapshots: unknown[];

  if (gameName === "innovation") {
    snapshots = innovationDebugSnapshots(gameLog as GameLog, cardDb);
  } else if (gameName === "azul") {
    snapshots = azulDebugSnapshots(gameLog as AzulGameLog);
  } else if (gameName === "thecrewdeepsea") {
    snapshots = crewDebugSnapshots(gameLog as CrewGameLog);
  } else {
    console.error(`Debug snapshots not supported for game: ${gameName}`);
    process.exit(1);
  }

  for (let i = 0; i < snapshots.length; i++) {
    const name = String(i + 1).padStart(4, "0") + ".json";
    writeFileSync(join(snapshotDir, name), JSON.stringify(snapshots[i], null, 2) + "\n");
  }
  console.log(`Wrote ${snapshots.length} snapshots to ${snapshotDir}/`);
}

// ---------------------------------------------------------------------------
// Debug snapshot generators
// ---------------------------------------------------------------------------

function innovationDebugSnapshots(log: GameLog, cardDb: CardDatabase): unknown[] {
  const snapshots: unknown[] = [];
  const players = Object.values(log.players);
  const perspective = log.currentPlayerId && log.players[log.currentPlayerId] ? log.players[log.currentPlayerId] : players[0];

  // Expansion detection already performed by processGameState() above
  const engine = new GameEngine(cardDb);
  const state = createGameState(players, perspective);
  engine.initGame(state, log.expansions);
  engine.initLog(state, log.log, log.myHand);

  const hasLogIndex = log.actions.length > 0 && log.actions[0].logIndex != null;

  if (log.actions.length === 0 || !hasLogIndex) {
    // No actions or actions lack logIndex (older/external game_log.json) — process all entries and return a single snapshot
    for (const entry of log.log) engine.processEntry(state, entry);
    snapshots.push(innovationToJSON(state));
    return snapshots;
  }

  // Process entries action-by-action, snapshotting after each action's entries
  let logPos = 0;
  for (let i = 0; i < log.actions.length; i++) {
    const nextAction = i + 1 < log.actions.length ? log.actions[i + 1] : null;
    const nextStart = nextAction && nextAction.logIndex != null ? nextAction.logIndex : log.log.length;
    while (logPos < nextStart) {
      engine.processEntry(state, log.log[logPos]);
      logPos++;
    }
    snapshots.push(innovationToJSON(state));
    if (nextAction && nextAction.logIndex == null) break;
  }


  return snapshots;
}

function azulDebugSnapshots(log: AzulGameLog): unknown[] {
  const snapshots: unknown[] = [];
  // Snapshot after each round (wallPlacement or floorClear marks end of round processing)
  // Re-process incrementally, snapshotting after each factoryFill (start of round)
  // Actually, snapshot after wallPlacement entries (round completion)
  for (let i = 0; i < log.log.length; i++) {
    if (log.log[i].type === "wallPlacement") {
      // Process log up to and including this entry + any following floorClear
      let end = i + 1;
      if (end < log.log.length && log.log[end].type === "floorClear") end++;
      const slicedLog = { ...log, log: log.log.slice(0, end) };
      const state = processGameState(slicedLog, "azul", new CardDatabase([]));
      snapshots.push(state);
    }
  }
  return snapshots;
}

function crewDebugSnapshots(log: CrewGameLog): unknown[] {
  const snapshots: unknown[] = [];
  for (let i = 0; i < log.log.length; i++) {
    if (log.log[i].type === "trickWon") {
      const slicedLog = { ...log, log: log.log.slice(0, i + 1) };
      const state = processCrewState(slicedLog);
      snapshots.push(crewToJSON(state));
    }
  }
  return snapshots;
}
