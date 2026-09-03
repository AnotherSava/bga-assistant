// Render a documentation screenshot's subject to a standalone HTML file.
//
// The panel's own renderers are driven from a committed fixture, so a capture needs no BGA login,
// no live table and no particular game in progress — which is what makes a screenshot reproducible
// rather than a one-off someone happened to take. The fixtures are the same ones the tests use.
//
// Usage: node --import tsx/esm docs/screenshots/capture/lib/render.ts --mode <mode> --out <file.html>

import { readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { processGameLog } from "../../../../src/pipeline.js";
import { CardDatabase, type RawExtractionData } from "../../../../src/models/types.js";
import { createGameState } from "../../../../src/games/innovation/game_state.js";
import { GameEngine } from "../../../../src/games/innovation/game_engine.js";
import { renderFullPage, renderTurnHistory, setAssetResolver } from "../../../../src/games/innovation/render.js";
import { recentTurns } from "../../../../src/games/innovation/turn_history.js";
import type { GameLog } from "../../../../src/games/innovation/process_log.js";
import { processCrewState } from "../../../../src/games/crew/game_engine.js";
import { renderCrewFullPage } from "../../../../src/games/crew/render.js";
import type { CrewGameLog } from "../../../../src/games/crew/process_log.js";
import { renderHelp } from "../../../../src/render/help.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const repoUrl = pathToFileURL(REPO + "/").href;

type Mode = "help" | "innovation-summary" | "innovation-history" | "crew-summary";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const mode = flag("mode") as Mode | undefined;
const outPath = flag("out");
if (!mode || !outPath) { console.error("Usage: render.ts --mode <help|innovation-summary|innovation-history|crew-summary> --out <file.html>"); process.exit(1); }

/**
 * The stylesheets the side panel itself loads, in its own order.
 *
 * Concatenated rather than imported: this script runs under tsx, which has no CSS loader, and the
 * standalone renderers take the sheet as a string anyway — the same string the panel hands them,
 * which it collects from `document.styleSheets` at download time.
 */
const CSS_FILES = [
  "src/sidepanel/sidepanel.css",
  "src/games/azul/styles.css",
  "src/games/crew/styles.css",
  "src/games/nucleum/styles.css",
  "src/games/innovation/mini_card.css",
  "src/games/innovation/card_tip.css",
  "src/render/turn_history.css",
];

/** Bundled fonts are declared relative to a path Vite rewrites at build time, so point them at the
 *  real files instead — a shot rendered in the wrong typeface documents a build nobody has. */
function loadCss(): string {
  return CSS_FILES.map(f => readFileSync(join(REPO, f), "utf-8")).join("\n")
    .replace(/url\(['"]?\.\.\/assets\/fonts\//g, `url('${repoUrl}assets/fonts/`);
}

function loadCardDb(): CardDatabase {
  return new CardDatabase(JSON.parse(readFileSync(join(REPO, "assets/bga/innovation/card_info.json"), "utf-8")));
}

function fixture(path: string): RawExtractionData {
  return JSON.parse(readFileSync(join(REPO, path), "utf-8")) as RawExtractionData;
}

/**
 * A processed game log rather than raw packets: the same game the original shots were taken from,
 * at 73 KB against 1.2 MB of the packets it was built from. Screenshots document the renderers, and
 * the parser that turns packets into this has its own tests.
 */
const INNOVATION_FIXTURE = "docs/screenshots/capture/fixtures/innovation-822304035.json";
const CREW_FIXTURE = "src/games/crew/__tests__/fixtures/last_mission.json";

/** Either shape is accepted — raw extraction data carries `packets`, a game log does not. */
function innovationLog(cardDb: CardDatabase): GameLog {
  const parsed = JSON.parse(readFileSync(join(REPO, flag("fixture") ?? INNOVATION_FIXTURE), "utf-8"));
  return parsed.packets ? processGameLog(parsed as RawExtractionData, "innovation", cardDb) as GameLog : parsed as GameLog;
}

/** Rebuild the live engine and state the renderers need. `processGameState` returns the serialized
 *  form, which the standalone renderer cannot take. */
function innovationState(): { state: ReturnType<typeof createGameState>; engine: GameEngine; log: GameLog; cardDb: CardDatabase } {
  const cardDb = loadCardDb();
  const log = innovationLog(cardDb);
  const players = Object.values(log.players);
  const perspective = log.currentPlayerId && log.players[log.currentPlayerId] ? log.currentPlayerId : players[0].id;
  const engine = new GameEngine(cardDb);
  const state = createGameState(players, perspective);
  engine.initGame(state, log.expansions, log.initialRelics);
  engine.processLog(state, log.log, log.myHand);
  return { state, engine, log, cardDb };
}

/** A `<base>` so the document's relative asset paths resolve from the repo root, as they do inside
 *  the extension. Injected rather than baked into the renderers, which must keep emitting the
 *  relative paths the downloaded ZIP relies on. */
function withBase(html: string): string {
  return html.replace("<head>", `<head>\n<base href="${repoUrl}">`);
}

let html: string;

if (mode === "help") {
  // Reuse the panel's real shell so the top-bar icons in the shot are the ones it actually renders,
  // rather than a copy here that drifts the moment a button is added.
  const shell = readFileSync(join(REPO, "sidepanel.html"), "utf-8");
  html = shell
    .replace(`<link rel="stylesheet" href="src/sidepanel/sidepanel.css">`, `<base href="${repoUrl}">\n<style>\n${loadCss()}\n</style>`)
    .replace(`<script type="module" src="src/sidepanel/sidepanel.ts"></script>`, "")
    .replace(`<div class="status">Waiting for game data...</div>`, renderHelp())
    // The auto-hide button's glyph is set by the panel at runtime; without it the shot shows an
    // empty control that exists in no real session.
    .replace(`<button id="btn-pin" title="Auto-hide settings"></button>`, `<button id="btn-pin" title="Auto-hide settings"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 5h18v14H3z" fill-opacity=".15"/><path fill="none" stroke="currentColor" stroke-width="2" d="M4 6h16v12H4z"/></svg></button>`);
} else if (mode === "innovation-summary") {
  const { state, engine, log, cardDb } = innovationState();
  setAssetResolver((p: string) => p);
  const players = Object.values(log.players);
  const perspective = state.perspective;
  html = withBase(renderFullPage(state, engine, cardDb, perspective, players, "823235522", loadCss(), { textTooltips: true, expansions: log.expansions }));
} else if (mode === "innovation-history") {
  const { log, cardDb } = innovationState();
  const players = Object.values(log.players);
  // `--turns N` ends the window at turn N, the way the panel would have looked while that turn was
  // the latest. Without it the last three turns of the game are whatever the game happened to end
  // on, which is rarely the compound turn this frame exists to show.
  const turns = flag("turns");
  const actions = turns ? log.actions.slice(0, Number(turns)) : log.actions;
  const rows = renderTurnHistory(recentTurns(actions, 3), cardDb, players, { newestFirst: true });
  html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="${repoUrl}">
<title>Turn history</title>
<style>
${loadCss()}
body { margin: 0; width: max-content; }
#turn-history { margin: 0; }
</style>
</head>
<body class="bgaa-cards">
<div id="turn-history">${rows}</div>
</body>
</html>`;
} else {
  const log = processGameLog(fixture(CREW_FIXTURE), "thecrewdeepsea") as CrewGameLog;
  // A finished mission has every suit proven void for every player, so the matrix reads as a wall of
  // X and shows neither "!" nor "?". Stopping part-way is what puts all three states in the frame —
  // and leaves a trick half-played, which is what the trick table's dashed separator documents.
  const at = flag("at");
  const sliced = at ? { ...log, log: log.log.slice(0, Number(at)) } : log;
  // Crew's sections stretch to fill their container, so a wide viewport frames each one with a slab
  // of empty background beside it. Sizing the body to its content is not enough on its own — the
  // body then takes the width of the *widest* section, and the narrower ones still stretch to match
  // it, which is what left the player-suit matrix with a third of its frame empty. Each section has
  // to shrink to its own table as well, so the shot's padding comes only from `--pad`.
  html = withBase(renderCrewFullPage(processCrewState(sliced), "816405832", loadCss()))
    .replace("</head>", "<style>body { width: max-content; } .crew-section { width: max-content; }</style>\n</head>");
}

writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
