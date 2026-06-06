# BGA Project Memory

## Workspace Structure
Three subprojects in `D:\projects\bga`:
- `themes/` — git repo (`bga-themes`), BGA custom CSS themes (has its own `scripts/browse.py`)
- `tracker/` — BGA game state tracker (Innovation), uses `src/` layout with `pyproject.toml`
- `assistant/` — BGA Assistant, TypeScript Chrome extension (Vite + vitest); multi-game (Innovation, Azul, Crew); git repo `AnotherSava/bga-assistant`
- Shared: `venv/` (legacy — may only exist under `themes/venv/`), `.chrome_bga_profile/`

## Browser Automation Setup
- **Module**: `src/browser/browse.py` — run via `python -m browser.browse`
- **Venv**: `venv/` with `playwright` and `Pillow` installed; `pip install -e .` for editable install
- **Communication**: File-based — write commands to `scripts/cmd.txt`, read from `output/result.txt`
- Uses real Chrome via `channel="chrome"` with persistent profile at `.chrome_bga_profile/`
- Do NOT use `taskkill /f /im chrome.exe` — it kills the user's real Chrome too

## browse.py Commands
- `screenshot [file]` / `fullscreenshot [file]` — capture page
- `html [selector]` / `children [selector]` / `classes [selector]` — inspect DOM
- `styles [selector]` — computed styles
- `url` / `goto <url>` — navigation
- `inject <css>` / `injectfile <path>` — inject CSS (client-side only, lost on reload)
- `fill <selector> ||| <text>` — fill a form field
- `click <selector>` — click an element
- `eval <js or filepath>` — run JS (if arg is a file path, reads and executes it)
- `wait [secs]` / `quit` — utility

## Themes (`themes/`)
- Git repo: `AnotherSava/bga-themes`
- `minimal.css` — minimalistic BGA theme
- Applied via BGA preferences → Advanced → Custom CSS

## Tracker (`tracker/`)
- Git repo: `AnotherSava/bga-tracker`
- `.env` — config: `PLAYER_NAME=AnotherSava` (gitignored)
- `pyproject.toml` — editable install, `pip install -e .`
- `src/bga_tracker/` — main package (exports `PROJECT_ROOT` from `__init__.py`)
  - `innovation/card.py` — Card class (candidate-set model) + CardDatabase loader; constants (SET_BASE, SET_CITIES, COLOR_ORDER)
  - `innovation/game_state.py` — GameState class (card locations, queries, serialization, to_json()); Action dataclass (no default field values)
  - `innovation/game_state_tracker.py` — GameStateTracker class (mutations, constraint propagation, meld icon filtering); wraps GameState
  - `innovation/process_log.py` — transforms raw BGA packets into structured game_log.json; passes meld_keyword/bottom_to
  - `innovation/game_log_processor.py` — GameLogProcessor class (log dispatch via match/case → Actions); wraps GameStateTracker
  - `innovation/track_state.py` — CLI entry point, delegates to GameLogProcessor
  - `innovation/format_state.py` — `SummaryFormatter` class + HTML summary (`python -m bga_tracker.innovation.format_state TABLE_ID`)
  - `innovation/config.py` — Config dataclass from .env
  - `innovation/paths.py` — shared path constants (DATA_DIR, ASSETS_DIR, CARD_INFO_PATH, TEMPLATE_DIR) + find_table()
  - `innovation/download_assets.py` — downloads BGA sprites, extracts icons & card images (Pillow)
- `src/browser/browse.py` — Playwright-based browser helper (`python -m browser.browse`)
- `scripts/fetch_full_history.js` — BGA notification history API fetch + player names (game-agnostic, auto-detects from URL)
- `.claude/skills/innovation/` — `/innovation <table-url>` skill, runs full workflow (8 steps)
- `assets/` — static game data and images (sprites/ gitignored)
  - `card_info.json` — shared card DB (sets 0+3, 210 cards, includes icons/dogma/color)
  - `icons/` — 271 PNGs: resource (30), hex (210), bonus (11), cities special (20)
  - `cards/` — 210 card face images (750x550 PNG, full resolution)
- `data/` — per-game data (gitignored), `<TABLE_ID> <opponent>/` folders
- `tests/innovation/` — test files + `fixtures/` directory
- Player names parsed from game log automatically (no hardcoding)
- Table ID is a required argument (no default)
- Both scripts use `find_table()` from `paths.py` to locate folders by TABLE_ID

## format_state.py Details
- `SummaryFormatter` class stores `game_state`, `table_id`, `config`, `card_db`, `me`, `opponent`
- Methods: `_prepare_cards`, `_prepare_my_cards`, `_prepare_deck`, `_prepare_all_cards`, `_make_section`, `render`
- Module-level helpers: `_prepare`, `_visibility_toggle`, `_layout_toggle`
- Dataclasses: `TemplateCard`, `Row(cards, label="", all_known=False)`, `Section(title, section_id, ...column_count, arrange_by_columns)`
- Output: `summary.html` — dark-themed HTML with visual card elements
- Card colors: B=#4a9eff, R=#ff4444, G=#44bb44, Y=#ccaa00, P=#bb66ff
- Base cards: 2x3 CSS grid (hex icon + name top, resource icons + age bottom)
- Cities cards: 2x2 CSS grid (6 icons in two rows, age bottom-right, name in tooltip only)
- Unknown cards: gray with age number (blank in deck rows)
- Base card hover: full card face image (750px source, 375px CSS display)
- Cities card hover: text tooltip with name only
- Tooltips: JS mouse-following with viewport boundary detection (`position: fixed`)
- Fonts: Barlow Condensed (card names), Russo One (age numbers)
- Sections: Hand opponent, Hand me (eye icons for hidden/revealed), Score opponent/me (skip if empty), Achievements (ages 1-9), Base deck (visible), Cities deck (hidden), Base list (hidden), Cities list (hidden)
- Achievements: deduced from remaining hidden base cards; wide (1 row of 9) or tall (2 rows of 5+4) layout; env vars `DEFAULT_ACHIEVEMENTS` (show/none) and `DEFAULT_ACH_LAYOUT` (wide/tall)
- Jinja2 templates in `templates/innovation/`, SVG icons in `templates/innovation/icons/` (eye_open, eye_closed, question)
- Collapsible sections: eye icon toggle (open eye = hidden, closed eye = visible)
- Opponent cards sorted by (age, is_unknown) — known before unknown per age
- Icon positions from isotropic `Rg = [0, 5, 4, 1, 2, 3]`: top row [0,5,4], bottom row [1,2,3]
- Unknown hand AND score tracked as `{"age": int, "set": int}` objects
- All-known age rows: `all-known` CSS class hides entire age rows in unknown mode when all cards in that age are known

## Side panel & settings
- [Settings surface](project_settings_surface.md) — no options page; settings persist via settings.ts localStorage + eye-icon menu (#section-selector), dispatched by statsPageOpen() then game

## User Preferences
- [No defensive fallbacks](feedback_no_defensive_fallbacks.md) — let invalid data surface naturally
- [Tests must not read from data/](feedback_tests_no_gitignored_data.md) — data/ is gitignored; inline reproducers or copy into committed __tests__/fixtures/

## Claude Code Settings
- User-level `~/.claude/settings.json` has a `PreToolUse` hook blocking Bash commands starting with `cd` AND commands containing absolute paths to the project folder (Windows `D:/...` or Unix `/d/...` style)
- Project `.claude/settings.json` is a symlink to user-level settings (gitignored)
- `.claude/settings.local.json` has personal auto-approved permissions (gitignored)
- On Windows, use `cmd //c mklink` for symlinks (Git Bash `ln -s` creates copies)
- `jq` is NOT available — use `python -c` for JSON parsing in hooks
- Skill `allowed-tools` patterns: always use colon before wildcard — `Bash(git reset HEAD:*)` not `Bash(git reset HEAD*)`
- Skill `allowed-tools` may NOT override built-in safety checks for destructive git commands (e.g. `git reset`). If a skill pattern doesn't work, add the pattern to `settings.local.json` instead.

## Kitty Terminal (WSL)
- VBS launcher: `C:\programming\other\kitty.vbs`
- System kitty (`/usr/bin/kitty`) is 0.32.2; updated kitty at `~/.local/kitty.app/bin/kitty` is 0.45.0
- WSLg 1.0.71 broke Wayland rendering (ZINK/Mesa errors, `50000x50000` stride error)
- Try `LIBGL_ALWAYS_SOFTWARE=1` or updated kitty binary as workaround

## Player metadata (multi-game)
- [BGA player metadata source-of-truth](project_bga_player_metadata.md) — gameui.gamedatas.players[pid] is canonical; .color is bare 6-char hex
- [BGA mode detection + extraction quirks](project_bga_mode_detection.md) — gameui.bRealtime (1/0) universal; gamedatas.realTime game-specific; title format; my_hand can lag the log
- [BGA table type detection](project_bga_table_type.md) — tournament via gameui.tournament_id; arena via tableinfos `options["201"]` (Game mode) value==="2" — NOT `table_matchmaking` (also "1" for matchmade "Play now" games); probed by a SEPARATE gameui.ajaxcall page injection (SW fetch rejected w/o session token)

## BGA Azul Notes
- All information is public — no player/spectator distinction needed
- Tile types: `0`=first player marker, `1`=Black, `2`=Cyan, `3`=Blue, `4`=Yellow, `5`=Red
- Factories per player count: `2×players + 1` (5/7/9 for 2/3/4)
- 100 tiles: 20 each of 5 colors
- Key BGA notifications: `factoriesFilled`, `tilesSelected`, `tilesPlacedOnLine`, `placeTileOnWall`, `emptyFloorLine`, `firstPlayerToken`
- `TileCounts` = `number[6]` array indexed by tile type (0-5)
- Sample data in `data/bgaa_816402832/` and `data/bgaa_816405832/`

## BGA Innovation Notes
- BGA `args.type` IDs: `"0"`=base, `"1"`=artifacts, `"2"`=cities, `"3"`=echoes, `"4"`=figures
- `card_info.json` set IDs differ from BGA: 0=base, 1=figures, 2=cities, 3=echoes, 4=artifacts (historical convention from Python tracker)
- Initial deal (2 base age 1 cards per player) is NOT logged as transfer notifications
- Icons: `1=crown, 2=leaf, 3=lightbulb, 4=castle, 5=factory, 6=clock`, cities specials `8=whiteflag, 9=blackflag, 11=left, 12=right, 13=up, 14=plus`, echoes special `7=echo, 10=hexnote`, bonus-N encoded as `10N` (102..111)
- BGA shows game content to logged-out users — must check `#connect_status` element to detect login
- Game URLs can be `/<N>/innovation?table=ID` (2 segments) — `fetch_full_history.js` handles both formats
- Standard color order: BRGYP (B=0, R=1, G=2, Y=3, P=4) — used in sorting, display columns, card lists
- 7 city names fixed from BGA defaults: Mohenjo-Daro, Nineveh, Constantinople, Hoi An, Rio de Janeiro, Munich (B7), Montreal (R7)
- `gameStateChange id:4` with `args.action_number` = regular action marker (1 or 2); fires in BOTH channels, dedupe by `(move, player, actionNumber)`
- `gameStateChange id:15` = artifact-decision turn marker (fires when player has an Artifact on display at turn start, BEFORE the first `id:4 action_number:1`). Sometimes fires in the player-channel packet only (e.g. move 17 in table 839716682), so process from any channel and dedupe by `(move, player)` — do NOT gate on `isSpectatorPacket` the way `id:4` does.

### Cities of Destiny
- [Upstream cities images sorted by cardnum](project_innovation_cities_images.md) — `Print_CitiesCards_front-N` maps to card with cardnum `(335+N)`; same shape as echoes downloader, simpler sort key

### Artifacts of History + Relics variant
- Upstream artifact card images (`Print_ArtifactsCards_front-NNN.png` at micahstairs/bga-innovation main-dev) are sorted by (age, color R/Y/G/B/P, ascending BGA id). Images 001-105 are non-relic artifacts (including Battleship Yamato which has incomplete BGA data — `spot_1`/`dogma_icon` are null). Images 106-110 are the 5 relics in order: Complex Numbers, Safety Pin, Timbuktu, Newton-Wickins, Ching Shih.
- BGA `transferedCard` packets carry an explicit `is_relic: "1"` flag — reliable signal for relic transfers, independent of zone pattern. Name is often `null` in BOTH player and spectator channels on relic re-seizes (`relics→achievements` AND `achievements→hand`). Resolve the name upstream in `process_log` via a `relicNameByAge` map built from `gdCards`: ages 3-7 each have exactly one relic, so age alone is a unique key. Engine retains `(age, cardSet)` match in `takeFromRelicList` as defensive fallback.
- Relics can be returned from ANY zone (hand, board, score, achievements) back to the Available Relics pool — not just from achievements. Transfer pattern: `* → relics`.
- Ching Shih (age 6, BGA id 218) is a Figures-expansion relic but appears in Artifacts-with-Relics games even when Figures isn't "played" — must be in card_info and CardDatabase lookups.
- Relic cards (Timbuktu, Complex Numbers, Newton-Wickins Telescope, Ching Shih, Safety Pin) are extra cards that only exist in the with-relics variant — not part of any expansion's standard 105-card pool. Flagged `is_relic: true` in card_info.json, loaded into CardDatabase._cards for lookups, but excluded from _groups so they don't inflate deck candidate counts in non-relics games.
- [Artifact display→board meld is a regular action](project_innovation_artifact_meld_action.md) — player choice, any action slot; classifier accepts source ∈ {hand, display}
- [Innovation Maps keyed by player ID](project_innovation_id_keyed_maps.md) — hands/boards/scores/etc. and state.perspective use IDs; log regexes still match names, convert via _idByName

## Engine architecture (multi-game)
- [Shared constraint kernel](project_constraint_kernel.md) — src/engine/constraint.ts; per-game opt-ins for containerOf, isContainerOrdered, enableNakedTuples
- [Innovation candidate per-pool classes](project_innovation_candidate_invariant.md) — candidates are per-pool-equivalence-class, not per-group; explains why naked-N is dead code in Innovation
- [Innovation deck-order handling](project_innovation_deck_order.md) — deck is ordered; meld-filter uses discard-aware pooling (May 2026 rewrite) to preserve keeps' resolutions
- [Innovation opponent-knowledge merge](project_innovation_opponent_merge.md) — mergeSuspects pools only partial-kind cards; exact/none stay; suspect set must contain its true card
