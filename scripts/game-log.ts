// CLI: raw_data.json → game_log.json
// Usage: npx tsx scripts/game-log.ts <raw_data.json> [--game <name>]

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { processGameLog } from "../src/pipeline.js";
import { CardDatabase, type GameName, type RawExtractionData } from "../src/models/types.js";

const args = process.argv.slice(2);
const gameFlag = args.find((a, i) => i > 0 && args[i - 1] === "--game") as GameName | undefined;
const inputPath = args.find((a, i) => !a.startsWith("--") && (i === 0 || args[i - 1] !== "--game"));

if (!inputPath) {
  console.error("Usage: npx tsx scripts/game-log.ts <raw_data.json> [--game <name>]");
  process.exit(1);
}

const rawData: RawExtractionData = JSON.parse(readFileSync(inputPath, "utf-8"));
const firstPlayer = Object.values(rawData.players ?? {})[0];
if (typeof firstPlayer === "string") {
  console.error("Error: fixture uses legacy players shape (id→name). Regenerate via fresh extraction or run scripts/migrate-fixture.ts.");
  process.exit(1);
}
const gameName = (rawData.gameName ?? gameFlag) as GameName;

if (!gameName) {
  console.error("Error: raw_data.json has no gameName field. Specify --game <name> (e.g. --game innovation).");
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadCardDb(): CardDatabase {
  const raw = JSON.parse(readFileSync(join(scriptDir, "../assets/bga/innovation/card_info.json"), "utf-8"));
  return new CardDatabase(raw);
}

console.log(`Processing ${gameName} game log from ${inputPath}`);

const cardDb = gameName === "innovation" ? loadCardDb() : undefined;
const gameLog = processGameLog(rawData, gameName, cardDb);
const outputPath = join(dirname(inputPath), "game_log.json");
writeFileSync(outputPath, JSON.stringify(gameLog, null, 2) + "\n");

console.log(`Wrote ${outputPath}`);
