// One-shot fixture migration: legacy `players: { id: name }` → `players: { id: PlayerInfo }`.
// Synthesizes colorHex from a fixed BGA palette cycled by player index.
// Usage:
//   npx tsx scripts/migrate-fixture.ts <file-or-dir>...
// Walks each path; rewrites in place any JSON whose top-level `players` is a
// Record<string, string>. Files without that shape are skipped with a note.

import { readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { join, extname } from "path";

const PALETTE = ["ff0000", "0000ff", "008000", "ffa500", "aa00aa"];

interface LegacyShape {
  players: Record<string, string>;
  currentPlayerId?: string;
}

interface MigratedShape {
  players: Record<string, { id: string; name: string; colorHex: string; isCurrent: boolean }>;
}

function isLegacy(data: unknown): data is LegacyShape {
  if (!data || typeof data !== "object") return false;
  const players = (data as { players?: unknown }).players;
  if (!players || typeof players !== "object") return false;
  const first = Object.values(players)[0];
  return typeof first === "string";
}

function migrate(data: LegacyShape): MigratedShape {
  const ids = Object.keys(data.players);
  const out: MigratedShape["players"] = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    out[id] = {
      id,
      name: data.players[id],
      colorHex: PALETTE[i % PALETTE.length],
      isCurrent: data.currentPlayerId === id,
    };
  }
  return { ...(data as object), players: out } as MigratedShape;
}

function walk(path: string, action: (filePath: string) => void): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), action);
  } else if (stat.isFile() && extname(path) === ".json") {
    action(path);
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Usage: npx tsx scripts/migrate-fixture.ts <file-or-dir>...");
  process.exit(1);
}

let migrated = 0;
let skipped = 0;
for (const target of targets) {
  walk(target, (file) => {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      return;
    }
    if (!isLegacy(data)) {
      skipped++;
      return;
    }
    const out = migrate(data as LegacyShape);
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    migrated++;
    console.log(`migrated: ${file}`);
  });
}
console.log(`Done: ${migrated} migrated, ${skipped} skipped (already-migrated or not legacy).`);
