// CLI: game_log.json → game_state.json (+ optional --debug snapshots)
// Usage: npx tsx scripts/game-state.ts <game_log.json> [--debug]

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { processGameState, detectEchoes } from "../src/pipeline.js";
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
const firstPlayer = Object.values(gameLog.players ?? {})[0];
if (typeof firstPlayer === "string") {
  console.error("Error: game_log uses legacy players shape (id→name). Regenerate via fresh extraction or run scripts/migrate-fixture.ts.");
  process.exit(1);
}
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

const cardDb = gameName === "innovation" ? loadCardDb() : new CardDatabase([]);

interface Snapshot { turn: number; entry: number; state: unknown; }

// Write final state
const outputPath = join(outputDir, "game_state.json");

if (!debug) {
  // Non-debug: compute final state directly (avoids generating all intermediate snapshots)
  const finalState = processGameState(gameLog, gameName, cardDb);
  writeFileSync(outputPath, JSON.stringify(finalState, null, 2) + "\n");
  console.log(`Wrote ${outputPath}`);
} else {
  // Debug: generate per-entry snapshots
  let snapshots: Snapshot[];
  if (gameName === "innovation") {
    snapshots = innovationSnapshots(gameLog as GameLog, cardDb);
  } else if (gameName === "azul") {
    snapshots = azulSnapshots(gameLog as AzulGameLog);
  } else if (gameName === "thecrewdeepsea") {
    snapshots = crewSnapshots(gameLog as CrewGameLog);
  } else {
    console.error(`Unsupported game: ${gameName}`);
    process.exit(1);
  }

  if (snapshots.length === 0) {
    console.error("No log entries to process.");
    process.exit(1);
  }

  writeFileSync(outputPath, JSON.stringify(snapshots[snapshots.length - 1].state, null, 2) + "\n");
  console.log(`Wrote ${outputPath}`);

  const snapshotDir = join(outputDir, "game_states");
  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });
  for (const snap of snapshots) {
    const name = `${String(snap.turn).padStart(4, "0")}_${String(snap.entry).padStart(4, "0")}.json`;
    writeFileSync(join(snapshotDir, name), JSON.stringify(snap.state, null, 2) + "\n");
  }
  console.log(`Wrote ${snapshots.length} snapshots to ${snapshotDir}/`);
}

// ---------------------------------------------------------------------------
// Debug snapshot generators
// ---------------------------------------------------------------------------

function innovationSnapshots(log: GameLog, cardDb: CardDatabase): Snapshot[] {
  const snapshots: Snapshot[] = [];
  const players = Object.values(log.players);
  const perspective = log.currentPlayerId && log.players[log.currentPlayerId] ? log.currentPlayerId : players[0].id;

  detectEchoes(log, cardDb);

  const engine = new GameEngine(cardDb);
  const state = createGameState(players, perspective);
  engine.initGame(state, log.expansions);
  engine.initLog(state, log.log, log.myHand);

  // Build entry→turn map from actions' logIndex
  const entryToTurn = new Map<number, number>();
  let turnNum = 0;
  for (const action of log.actions) {
    if (action.logIndex != null) {
      turnNum++;
      entryToTurn.set(action.logIndex, turnNum);
    }
  }

  let currentTurn = 0;
  for (let i = 0; i < log.log.length; i++) {
    if (entryToTurn.has(i)) currentTurn = entryToTurn.get(i)!;
    try {
      engine.processEntry(state, log.log[i]);
    } catch (err) {
      console.error(`Error at entry ${i} (turn ${currentTurn}): ${(err as Error).message}`);
      snapshots.push({ turn: currentTurn, entry: i, state: innovationToJSON(state) });
      break;
    }
    snapshots.push({ turn: currentTurn, entry: i, state: innovationToJSON(state) });
  }

  return snapshots;
}

function azulSnapshots(log: AzulGameLog): Snapshot[] {
  const snapshots: Snapshot[] = [];
  let turn = 0;
  for (let i = 0; i < log.log.length; i++) {
    if (log.log[i].type === "factoriesFilled") turn++;
    const slicedLog = { ...log, log: log.log.slice(0, i + 1) };
    const state = processGameState(slicedLog, "azul", new CardDatabase([]));
    snapshots.push({ turn, entry: i, state });
  }
  return snapshots;
}

function crewSnapshots(log: CrewGameLog): Snapshot[] {
  const snapshots: Snapshot[] = [];
  let turn = 0;
  for (let i = 0; i < log.log.length; i++) {
    if (log.log[i].type === "trickStart") turn++;
    const slicedLog = { ...log, log: log.log.slice(0, i + 1) };
    const state = processCrewState(slicedLog);
    snapshots.push({ turn, entry: i, state: crewToJSON(state) });
  }
  return snapshots;
}
