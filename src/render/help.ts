// Help page content for the side panel.

import { escapeHtml, ICON_ZOOM_OUT, ICON_ZOOM_IN, ICON_EYE, ICON_DOWNLOAD, ICON_STOPWATCH, ICON_DOT_GREEN, ICON_DOT_RED, ICON_PANEL, ICON_PANEL_1, ICON_PANEL_2 } from "./icons.js";
import type { GameName } from "../models/types.js";

export function renderHelp(errorMessage?: string, gameName?: GameName): string {
  const errorNote = errorMessage
    ? `<div class="help-note"><span class="help-note-icon">&#x26A0;</span> Failed to process game log for this table.<br><span class="help-note-hint">${escapeHtml(errorMessage)}</span></div>`
    : "";

  return `${errorNote}
<div class="help">
  <div class="help-hero">
    <div class="help-hero-title">BGA Assistant</div>
    <div class="help-hero-sub">Game assistant for <a href="https://boardgamearena.com" target="_blank">Board Game Arena</a></div>
  </div>

  <p>Turn-based games on BGA can last for days or even weeks. By the time it's your turn,
  you might have forgotten what was drawn, returned, transferred, or scored several moves ago.</p>
  <p>BGA Assistant reads the game log and reconstructs the full game state so you can focus
  on strategy instead of trying to remember what happened.</p>

  <div class="help-section">
    <div class="help-section-title">How to use</div>
    <ol class="help-steps">
      <li>Open a supported game table on <a href="https://boardgamearena.com" target="_blank">Board Game Arena</a>.</li>
      <li>The toolbar icon brightens up to indicate a supported game is detected. Click it to open the side panel with the game summary.</li>
      <li>When you switch to another supported game tab, the side panel updates automatically.</li>
    </ol>
  </div>

  <div class="help-section">
    <div class="help-section-title">Top bar</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn help-btn-text">#</span> ${ICON_DOT_GREEN}<span style="color:#888;margin:0 1px">/</span>${ICON_DOT_RED}</span><span> Table number and connection status (green\u00a0=\u00a0connected, red\u00a0=\u00a0connection lost)</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_ZOOM_OUT}</span> <span class="help-btn">${ICON_ZOOM_IN}</span></span><span> Zoom out / in (also <b>Ctrl</b>+<b>\u2212</b> / <b>Ctrl</b>+<b>=</b>)<br>Zoom level is saved per game and for the help page independently</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_EYE}</span></span><span> Toggle visible sections (settings persist across sessions). On this page it holds the settings that apply to every BGA table rather than to one game \u2014 see below</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_PANEL}</span><span style="color:#888;margin:0 1px">/</span><span class="help-btn">${ICON_PANEL_1}</span><span style="color:#888;margin:0 1px">/</span><span class="help-btn">${ICON_PANEL_2}</span></span><span> Auto-hide side bar: never/when leaving BGA/leaving supported game tables</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_DOWNLOAD}</span></span><span> Download a ZIP archive with raw packets, game log, game state, and summary</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn">${ICON_STOPWATCH}</span></span><span> Play time stats (see below); click again to return to the game summary</span></div>
      <div class="help-grid-item"><span class="help-grid-label"><span class="help-btn help-btn-text">?</span></span><span> This help page</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Play time</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>Time spent on BGA is tracked automatically for every game and table, not just the supported ones. The clock runs only while a game table tab is focused and pauses when you step away. The stats page shows daily, weekly, and monthly charts per game, plus a session list and per-table totals — turn-based sessions far above the game's average length are tinted yellow (over 3&times;) or red (over 10&times;). A stopwatch marks real-time tables, a trophy tournaments, crossed swords arena games. The ${ICON_EYE} menu holds display settings, and sessions can be exported to and imported from CSV.</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">On BGA\u2019s pages</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>\u201CCompact BGA header\u201D in this page\u2019s ${ICON_EYE} menu folds BGA\u2019s table header into a single row: the table number, move and progression keep the topbar, and the current prompt with its action buttons moves up beside them, so the bar below them goes away. The bar is then trimmed to what is actually in it \u2014 about 36 pixels against BGA\u2019s fixed 62 \u2014 everything in it lines up on one row, and it stays frozen at the top while the board scrolls underneath \u2014 letting go once a long prompt or a game\u2019s own content grows it past a fixed height, where a frozen bar would cost more room than it saves. A few prompts too long for one line are said shorter \u2014 on Ark Nova \u201cYou must choose an action card\u201d becomes \u201cChoose:\u201d \u2014 which keeps the action buttons beside the prompt instead of below it. Only prompts named for a specific game are touched, and only on English tables, since BGA translates its own.</span></div>
      <div class="help-grid-item"><span>It applies to every table on BGA, including games with no support here, since the header it folds is BGA\u2019s own and is the same everywhere. Games this extension knows get a little more, described in their tabs below. Turning it off puts every element back where BGA had it \u2014 nothing is copied or re-drawn, so BGA keeps updating its own elements throughout.</span></div>
      <div class="help-grid-item"><span>\u201CProgression only\u201D underneath it pares the corner down further: the table number and move count go, leaving the percentage alone in the same type as the prompt across the bar from it.</span></div>
      <div class="help-grid-item"><span>\u201CPin player panels\u201D keeps the top of BGA\u2019s right column in place while the board scrolls past, so the scores, hand counts and clocks stay readable wherever you are on a long board. It sits under the folded header bar when that is frozen, and at the very top of the page when it is not. What stays depends on what the column holds: with the turn history in it, the whole column is pinned \u2014 panels, history and the switch between the two logs \u2014 and a column taller than the window gets a scrollbar of its own rather than running off the bottom edge, with the panels pinned at the top of that too. With BGA\u2019s own log in the column, the panels alone are pinned and the log scrolls away as BGA intended. The panels take on the page\u2019s own background while pinned, so the log travelling behind them does not read up through the gaps.</span></div>
      <div class="help-grid-item"><span>Panels tall enough to take half the window are left alone \u2014 a four-player table on a short screen \u2014 since pinning them would wall off the top of the board rather than keep a reference in view; that is re-judged as they grow and as the window is resized. The pinned column needs no such limit, being capped to the window and scrollable inside itself. Like the compact header, this applies to every BGA table, and BGA\u2019s stacked narrow-window layout is left as it is: there the column sits above the board with nothing to scroll past.</span></div>
    </div>
  </div>

  <div class="help-tabs">
    <button class="help-tab${gameName !== "azul" && gameName !== "thecrewdeepsea" ? " active" : ""}" data-help-tab="innovation">Innovation</button>
    <button class="help-tab${gameName === "azul" ? " active" : ""}" data-help-tab="azul">Azul</button>
    <button class="help-tab${gameName === "thecrewdeepsea" ? " active" : ""}" data-help-tab="thecrewdeepsea">The Crew</button>
  </div>

  <div class="help-tab-content${gameName !== "azul" && gameName !== "thecrewdeepsea" ? " active" : ""}" data-help-panel="innovation">
  <div class="help-section">
    <div class="help-section-title">Sections</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">Hands</span><span> Your cards and what your opponent knows about them, and vice versa</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Scores</span><span> Same for the score piles</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Deck</span><span> Cards remaining in each deck, shown in draw order</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Cards</span><span> All cards from each set, with an option to show <i>unknown</i> cards only</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Achievements</span><span> Cards sidelined as standard achievements for Ages 1–9</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Toggles</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">Hide / Show</span> Collapse or expand a section</div>
      <div class="help-grid-item"><span class="help-grid-label">Base / Cities / Artifacts</span> Switch between Base, Echoes, Cities, and Artifacts card sets (Deck and Cards sections)</div>
      <div class="help-grid-item"><span class="help-grid-label">All / Unknown</span> Show all cards or only unaccounted ones (Cards section)</div>
      <div class="help-grid-item"><span class="help-grid-label">Wide / Tall</span> Display one row per age, or a columnar grid grouped by color</div>
    </div>
    <div style="margin-top: 6px; font-size: 11px; color: #888;">All toggle states persist across sessions.</div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Card tooltips</div>
    <div class="help-sections-grid">
      <div class="help-grid-item">Hover over any known card to see its full image.</div>
      <div class="help-grid-item">Once an unknown card is narrowed below its full age group, it shows the number of remaining candidates; hover to see them as mini card icons.</div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Action history</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>Recent player actions (meld, draw, dogma, endorse, achieve) are shown in the top-right corner, newest first. Each player\u2019s row renders in their actual BGA-assigned color, and your own row is highlighted with a subtle background tint of that color so it stays distinguishable. Each action includes a timestamp. Turns that begin with an Artifact on display also show the pre-turn choice (pass, return, or dogma) as an italicized line above the regular actions. Toggle visibility via the ${ICON_EYE} menu.</span></div>
      <div class="help-grid-item"><span>The same history can render in BGA\u2019s own game log instead, where it stays visible and keeps updating with the side panel closed \u2014 enable \u201CShow in BGA game log\u201D in the ${ICON_EYE} menu. There it reads newest-first to match BGA\u2019s log. The column shows one log or the other, never both. A lightbulb in the header switches between them \u2014 lit while the turn history is up, dim while BGA\u2019s log is. \u201CMore...\u201D below the history widens the window, and disappears once the whole game is shown. Both that and the switch only last for the current table; opening a table starts from the ${ICON_EYE} menu setting again.</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Simplified cards on the table</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>The compact card used above can replace BGA\u2019s illustrated one on the table itself \u2014 enable \u201CSimplified cards on BGA\u2019s table\u201D in the ${ICON_EYE} menu. It covers your hand and every player\u2019s board \u2014 the places Innovation shows cards face up at full size \u2014 and, as a sub-option below, the opponents\u2019 face-down hands. The illustration and the dogma text go; the colour, icons, name and age stay, at about a quarter of the area, so a board that needed scrolling tends to fit the window. The rules text is still a hover away on BGA\u2019s own tooltip.</span></div>
      <div class="help-grid-item"><span>The top card of a pile \u2014 and every card in your hand, which is never stacked \u2014 uses the layout above, spot for spot: first icon top-left, the rest along the bottom, name across the top, age in the bottom-right corner. Cities cards fill all six icon spots and so show no name, as they do above.</span></div>
      <div class="help-grid-item"><span>Cards under the top one use a second layout, since a splay leaves them showing only a strip and the icons in it are the point. There they take the real card\u2019s geometry \u2014 the right-hand icons out on the right-hand edge, the age moved inboard \u2014 so splaying left reveals the last icon, right the two left-hand ones, and up the whole bottom row, each as on BGA\u2019s own cards. The age follows from that with no rule of its own: hidden on a pile splayed left or right, carried along by one splayed up, and always shown on the top card.</span></div>
      <div class="help-grid-item"><span>“Opponents’ hands” fills in the one place BGA shows nothing at all. Their hands are face-down backs — no name, no age, no colour — and this draws each as the same card, carrying what has been deduced about it: a card that has been identified shows its name and icons, one that has not shows the placeholder with a count of how many cards it could still be. Hovering opens the panel’s own tooltip: every remaining candidate as a mini card, or the full face of a card that is known. A card nothing has been learnt about shows its age alone, as it does in the panel, and one the tracker has not caught up with stays blank for a few seconds until the next update. Which of two equally-known cards carries which count is arbitrary — the tracker knows an opponent’s age-1 cards as a group, not which is which — so a draw can shuffle the counts between them. These cards take more room than BGA’s small backs, so a hand can wrap onto a second row.</span></div>
      <div class="help-grid-item"><span>A <b>Size</b> slider under the checkbox scales the cards from 100% to 200% in 10% steps. The whole card scales as one — box, icons, name and age — and so does the strip a splay reveals, so a splayed pile reads the same at every size. An Echo card carries its effect as running text in one of its icon spots, which no card this small can show; that spot is marked with lines of writing instead, and the effect stays a hover away on BGA’s tooltip. “Echo effects as text” prints it on the card after all — set in Tahoma, drawn for small screen text, and clipped so a long effect cannot spill over its neighbours; deliberately tiny at 100%, so turn the slider up or use the browser’s own zoom to read it. Names show in their own capitalisation, as above: BGA writes them into the page already uppercased, so the original is put back from the game's own card data, which also keeps a table played in another language on its translated names. BGA has a simplified layout of its own under its game preferences; that one keeps the usual card size, and this does not need it on.</span></div>
    </div>
  </div>

  <div class="help-section">
    <div class="help-section-title">Compact table header</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>On top of what the compact header does on every BGA table \u2014 described under \u201COn BGA\u2019s pages\u201D above \u2014 an Innovation table gets its own board controls handled too.</span></div>
      <div class="help-grid-item"><span>\u201CShow compact\u201D and \u201CBrowse all cards\u201D are hidden too \u2014 the first only changes how far splayed stacks overlap, and the card list here already shows what the second does. BGA\u2019s \u201CThis player is not playing: what can I do?\u201D link goes as well. \u201CLook at all cards in piles\u201D stays, redrawn as an eye icon in the left corner beside the table info, and the go-to-next-table control moves to the right to join BGA\u2019s sound and menu icons \u2014 it grows into \u201CN tables are waiting for you\u201D once your turn ends, and there is room for that there. The eye is dimmed until you hover it; that one keeps its full strength, since it is telling you something. This is on by default; \u201CCompact BGA header\u201D in the ${ICON_EYE} menu puts everything back where BGA had it.</span></div>
    </div>
  </div>
  </div>

  <div class="help-tab-content${gameName === "azul" ? " active" : ""}" data-help-panel="azul">
  <div class="help-section">
    <div class="help-section-title">Tile tracking</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">Bag</span><span> Estimated tiles remaining in the bag by color</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Box lid</span><span> Tiles discarded to the box lid (returned to bag on refill)</span></div>
      <div class="help-grid-item"><span class="help-grid-label">Wall</span><span> Tiles placed on player walls</span></div>
    </div>
  </div>
  </div>

  <div class="help-tab-content${gameName === "thecrewdeepsea" ? " active" : ""}" data-help-panel="thecrewdeepsea">
  <div class="help-section">
    <div class="help-section-title">Card grid</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>All 40 cards (9 cards of each of the 4 coloured suits and 4 submarine trumps) with visual states: dimmed for played cards, neutral for cards in your hand, and bright for cards still in opponents\u2019 hands.</span></div>
    </div>
  </div>
  <div class="help-section">
    <div class="help-section-title">Player\u2013Suit matrix</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span class="help-grid-label">X</span><span> Player is void in this suit (played off-suit when it was led)</span></div>
      <div class="help-grid-item"><span class="help-grid-label">!</span><span> Player confirmed to have cards of this suit (via communication or deduction)</span></div>
      <div class="help-grid-item"><span class="help-grid-label">?</span><span> No definitive information</span></div>
      <div class="help-grid-item"><span>Each player’s name renders in their BGA-assigned color; your own row is highlighted with a subtle background tint.</span></div>
    </div>
  </div>
  <div class="help-section">
    <div class="help-section-title">Trick history</div>
    <div class="help-sections-grid">
      <div class="help-grid-item"><span>Shows each trick with cards played per player. Each player’s column header renders in their BGA color, and your own column is tinted. The lead card is highlighted and the trick winner is bold. The current in-progress trick is shown at the bottom.</span></div>
    </div>
  </div>
  </div>
</div>`;
}

