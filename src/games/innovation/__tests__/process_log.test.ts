import { describe, it, expect } from "vitest";
import {
  ICON_MAP,
  SET_MAP,
  expandTemplate,
  cleanHtml,
  normalizeName,
  processRawLog,
} from "../process_log.js";
import type { RawExtractionData, RawPacket } from "../types.js";

// ---------------------------------------------------------------------------
// ICON_MAP / SET_MAP
// ---------------------------------------------------------------------------

describe("ICON_MAP", () => {
  it("maps BGA digit strings to icon names", () => {
    expect(ICON_MAP["1"]).toBe("crown");
    expect(ICON_MAP["2"]).toBe("leaf");
    expect(ICON_MAP["3"]).toBe("lightbulb");
    expect(ICON_MAP["4"]).toBe("castle");
    expect(ICON_MAP["5"]).toBe("factory");
    expect(ICON_MAP["6"]).toBe("clock");
  });

  it("has exactly 6 entries", () => {
    expect(Object.keys(ICON_MAP).length).toBe(6);
  });
});

describe("SET_MAP", () => {
  it("maps BGA set type ids to labels", () => {
    expect(SET_MAP["0"]).toBe("base");
    expect(SET_MAP["2"]).toBe("cities");
    expect(SET_MAP["3"]).toBe("echoes");
  });
});

// ---------------------------------------------------------------------------
// expandTemplate
// ---------------------------------------------------------------------------

describe("expandTemplate", () => {
  it("replaces simple string placeholders", () => {
    expect(expandTemplate("${name} chose a card.", { name: "Alice" })).toBe("Alice chose a card.");
  });

  it("handles multiple placeholders", () => {
    expect(expandTemplate("${a} and ${b}", { a: "X", b: "Y" })).toBe("X and Y");
  });

  it("converts non-string values to strings", () => {
    expect(expandTemplate("Age ${age}", { age: 5 })).toBe("Age 5");
  });

  it("returns empty string for missing keys", () => {
    expect(expandTemplate("${missing} here", {})).toBe(" here");
  });

  it("handles null/undefined values", () => {
    expect(expandTemplate("${a}${b}", { a: null, b: undefined })).toBe("");
  });

  it("recursively expands dict sub-templates with HTML stripping", () => {
    const args = {
      card: {
        log: "<b>${name}</b>",
        args: { name: "Archery" },
      },
    };
    expect(expandTemplate("Played ${card}.", args)).toBe("Played Archery.");
  });

  it("handles nested sub-template with surrounding text", () => {
    const args = {
      info: {
        log: "card <span class='x'>${title}</span> age ${age}",
        args: { title: "Wheel", age: 1 },
      },
    };
    expect(expandTemplate("Drew ${info}!", args)).toBe("Drew card Wheel age 1!");
  });

  it("handles template with no placeholders", () => {
    expect(expandTemplate("No placeholders here.", {})).toBe("No placeholders here.");
  });

  it("handles dict without log/args keys (non-sub-template object)", () => {
    // Objects without log/args should be stringified
    const args = { data: { foo: "bar" } };
    const result = expandTemplate("${data}", args);
    // Falls through since no log key, returns String({foo: "bar"}) which is [object Object]
    expect(result).toBe("[object Object]");
  });
});

// ---------------------------------------------------------------------------
// cleanHtml
// ---------------------------------------------------------------------------

describe("cleanHtml", () => {
  it("converts icon spans to [iconName]", () => {
    expect(cleanHtml('<span class="icon_1"></span>')).toBe("[crown]");
    expect(cleanHtml('<span class="icon_6"></span>')).toBe("[clock]");
  });

  it("converts all six icons", () => {
    for (const [digit, name] of Object.entries(ICON_MAP)) {
      expect(cleanHtml(`<span class="icon_${digit}"></span>`)).toBe(`[${name}]`);
    }
  });

  it("falls back for unknown icon digits", () => {
    expect(cleanHtml('<span class="icon_9"></span>')).toBe("[icon9]");
  });

  it("converts age spans to [N]", () => {
    expect(cleanHtml('<span class="age">3</span>')).toBe("[3]");
    expect(cleanHtml('<span class="card_age">10</span>')).toBe("[10]");
  });

  it("strips all remaining HTML tags", () => {
    expect(cleanHtml("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  it("collapses whitespace", () => {
    expect(cleanHtml("  hello   world  ")).toBe("hello world");
    expect(cleanHtml("line1\n\nline2")).toBe("line1 line2");
  });

  it("handles mixed icon, age, and HTML content", () => {
    const input = '<b>Alice</b> melded <span class="icon_1"></span> age <span class="age">3</span>';
    expect(cleanHtml(input)).toBe("Alice melded [crown] age [3]");
  });

  it("handles empty string", () => {
    expect(cleanHtml("")).toBe("");
  });

  it("handles plain text with no HTML", () => {
    expect(cleanHtml("just plain text")).toBe("just plain text");
  });

  it("handles icon spans with extra attributes", () => {
    expect(cleanHtml('<span class="foo icon_2 bar"></span>')).toBe("[leaf]");
  });
});

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------

describe("normalizeName", () => {
  it("passes through plain ASCII names unchanged", () => {
    expect(normalizeName("Archery")).toBe("Archery");
    expect(normalizeName("The Wheel")).toBe("The Wheel");
  });

  it("replaces non-breaking hyphens with regular hyphens", () => {
    expect(normalizeName("Chang\u2011An")).toBe("Chang-An");
  });

  it("strips combining diacritical marks", () => {
    // é (e + combining acute) -> e
    expect(normalizeName("Caf\u00e9")).toBe("Cafe");
  });

  it("handles already-decomposed characters", () => {
    // e + combining acute accent
    expect(normalizeName("Cafe\u0301")).toBe("Cafe");
  });

  it("handles multiple diacritics", () => {
    expect(normalizeName("\u00c9lys\u00e9e")).toBe("Elysee");
  });

  it("handles text with no special characters", () => {
    expect(normalizeName("Simple Name")).toBe("Simple Name");
  });
});

// ---------------------------------------------------------------------------
// processRawLog
// ---------------------------------------------------------------------------

describe("processRawLog", () => {
  function makePacket(moveId: number | null, data: Array<{ type: string; args: Record<string, unknown> }>, time = 1000): RawPacket {
    return { move_id: moveId, time, data };
  }

  it("returns empty log for empty packets", () => {
    const result = processRawLog({ players: { "1": "Alice" }, packets: [] });
    expect(result.players).toEqual({ "1": "Alice" });
    expect(result.myHand).toEqual([]);
    expect(result.log).toEqual([]);
  });

  it("filters out packets with null move_id", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(null, [{ type: "log_spectator", args: { log: "hello" } }]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toEqual([]);
  });

  it("processes log_spectator messages", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(1, [{ type: "log_spectator", args: { log: "${name} chose a card.", name: "Alice" } }]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(1);
    expect(result.log[0]).toEqual({ move: 1, type: "log", msg: "Alice chose a card." });
  });

  it("processes logWithCardTooltips_spectator messages", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(2, [{ type: "logWithCardTooltips_spectator", args: { log: "Drew a card." } }]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(1);
    expect(result.log[0]).toEqual({ move: 2, type: "logWithCardTooltips", msg: "Drew a card." });
  });

  it("skips empty log templates (<!--empty-->)", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [
        makePacket(1, [{ type: "log_spectator", args: { log: "<!--empty-->" } }]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toEqual([]);
  });

  it("pairs transferedCard_spectator with player-view transferedCard", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice", "200": "Bob" },
      packets: [
        makePacket(5, [
          // Player-view transfer
          { type: "transferedCard", args: { name: "Archery", age: 1, location_from: "hand", location_to: "board", owner_from: "100", owner_to: "100", meld_keyword: false } },
          // Spectator-view transfer
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(1);
    const entry = result.log[0];
    expect(entry.type).toBe("transfer");
    if (entry.type === "transfer") {
      expect(entry.move).toBe(5);
      expect(entry.cardName).toBe("Archery");
      expect(entry.cardAge).toBe(1);
      expect(entry.cardSet).toBe("base");
      expect(entry.source).toBe("hand");
      expect(entry.dest).toBe("board");
      expect(entry.sourceOwner).toBe("Alice");
      expect(entry.destOwner).toBe("Alice");
      expect(entry.meldKeyword).toBe(false);
    }
  });

  it("handles cities card set", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(3, [
          { type: "transferedCard", args: { name: "Jerusalem", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "2" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(1);
    if (result.log[0].type === "transfer") {
      expect(result.log[0].cardSet).toBe("cities");
    }
  });

  it("handles null card name (unnamed transfers)", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(4, [
          { type: "transferedCard", args: { name: null, age: 3, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "transfer") {
      expect(result.log[0].cardName).toBeNull();
      expect(result.log[0].cardAge).toBe(3);
    }
  });

  it("handles null card age", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(4, [
          { type: "transferedCard", args: { name: "Wheel", age: null, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "transfer") {
      expect(result.log[0].cardAge).toBeNull();
    }
  });

  it("handles meld_keyword flag", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(6, [
          { type: "transferedCard", args: { name: "Code of Laws", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: true } },
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "transfer") {
      expect(result.log[0].meldKeyword).toBe(true);
    }
  });

  it("skips spectator transfers without matching player-view data", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(7, [
          // No player-view transferedCard, only spectator
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(0);
  });

  it("handles multiple transfers in a single move", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice", "2": "Bob" },
      packets: [
        makePacket(10, [
          { type: "transferedCard", args: { name: "Archery", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard", args: { name: "Pottery", age: 1, location_from: "hand", location_to: "board", owner_from: "2", owner_to: "2", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(2);
    if (result.log[0].type === "transfer" && result.log[1].type === "transfer") {
      expect(result.log[0].cardName).toBe("Archery");
      expect(result.log[1].cardName).toBe("Pottery");
    }
  });

  it("interleaves transfers and messages correctly", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(1, [
          { type: "transferedCard", args: { name: "Wheel", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
          { type: "log_spectator", args: { log: "Alice melded Wheel." } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.log).toHaveLength(2);
    expect(result.log[0].type).toBe("transfer");
    expect(result.log[1].type).toBe("log");
  });

  it("cleans HTML in log messages", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [
        makePacket(1, [
          { type: "log_spectator", args: { log: "<b>Alice</b> melded <span class=\"icon_1\"></span>." } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "log") {
      expect(result.log[0].msg).toBe("Alice melded [crown].");
    }
  });

  it("normalizes card names in transfers", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(1, [
          { type: "transferedCard", args: { name: "Chang\u2011An", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "2" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "transfer") {
      expect(result.log[0].cardName).toBe("Chang-An");
    }
  });

  it("extracts initial hand from gamedatas", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [],
      gamedatas: {
        my_hand: [{ id: 10 }, { id: 20 }],
        cards: {
          "10": { name: "Archery" },
          "20": { name: "Caf\u00e9" },
        },
      },
    };
    const result = processRawLog(raw);
    expect(result.myHand).toEqual(["Archery", "Cafe"]);
  });

  it("handles missing gamedatas gracefully", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [],
    };
    const result = processRawLog(raw);
    expect(result.myHand).toEqual([]);
  });

  it("skips hand cards without name in cards lookup", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [],
      gamedatas: {
        my_hand: [{ id: 10 }, { id: 99 }],
        cards: {
          "10": { name: "Archery" },
          // card 99 not in cards map
        },
      },
    };
    const result = processRawLog(raw);
    expect(result.myHand).toEqual(["Archery"]);
  });

  it("processes a full multi-move sequence", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice", "2": "Bob" },
      packets: [
        makePacket(1, [
          { type: "log_spectator", args: { log: "Alice chooses a card." } },
        ]),
        makePacket(2, [
          { type: "log_spectator", args: { log: "Bob chooses a card." } },
        ]),
        makePacket(3, [
          { type: "transferedCard", args: { name: "Clothing", age: 1, location_from: "hand", location_to: "board", owner_from: "1", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard", args: { name: "The Wheel", age: 1, location_from: "hand", location_to: "board", owner_from: "2", owner_to: "2", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
          { type: "transferedCard_spectator", args: { type: "0" } },
          { type: "log_spectator", args: { log: "Alice melded first." } },
        ]),
      ],
      gamedatas: {
        my_hand: [{ id: 1 }, { id: 2 }],
        cards: {
          "1": { name: "Clothing" },
          "2": { name: "Archery" },
        },
      },
    };
    const result = processRawLog(raw);
    expect(result.players).toEqual({ "1": "Alice", "2": "Bob" });
    expect(result.myHand).toEqual(["Clothing", "Archery"]);
    expect(result.log).toHaveLength(5);
    // Move 1: log message
    expect(result.log[0]).toEqual({ move: 1, type: "log", msg: "Alice chooses a card." });
    // Move 2: log message
    expect(result.log[1]).toEqual({ move: 2, type: "log", msg: "Bob chooses a card." });
    // Move 3: two transfers + log
    expect(result.log[2].type).toBe("transfer");
    expect(result.log[3].type).toBe("transfer");
    expect(result.log[4]).toEqual({ move: 3, type: "log", msg: "Alice melded first." });
    if (result.log[2].type === "transfer") {
      expect(result.log[2].cardName).toBe("Clothing");
      expect(result.log[2].sourceOwner).toBe("Alice");
    }
    if (result.log[3].type === "transfer") {
      expect(result.log[3].cardName).toBe("The Wheel");
      expect(result.log[3].sourceOwner).toBe("Bob");
    }
  });

  it("handles template expansion in log messages during processing", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [
        makePacket(1, [{
          type: "log_spectator",
          args: {
            log: "${player_name} draws a <span class=\"age\">${age}</span> card.",
            player_name: "Alice",
            age: "5",
          },
        }]),
      ],
    };
    const result = processRawLog(raw);
    if (result.log[0].type === "log") {
      expect(result.log[0].msg).toBe("Alice draws a [5] card.");
    }
  });

  it("detects echoes expansion from transfers with type 3", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(1, [
          { type: "transferedCard", args: { name: "Bangle", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "3" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.expansions.echoes).toBe(true);
  });

  it("does not detect echoes when only base and cities transfers present", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [
        makePacket(1, [
          { type: "transferedCard", args: { name: "Archery", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "0" } },
        ]),
        makePacket(2, [
          { type: "transferedCard", args: { name: "Jerusalem", age: 1, location_from: "deck", location_to: "hand", owner_from: "0", owner_to: "1", meld_keyword: false } },
          { type: "transferedCard_spectator", args: { type: "2" } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.expansions.echoes).toBe(false);
  });

  it("returns expansions.echoes false for empty packets", () => {
    const raw: RawExtractionData = {
      players: { "1": "Alice" },
      packets: [],
    };
    const result = processRawLog(raw);
    expect(result.expansions.echoes).toBe(false);
  });

  it("emits pending action for gameStateChange with state id 4", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice", "200": "Bob" },
      packets: [
        makePacket(10, [
          { type: "log_spectator", args: { log: "test" } },
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: { action_number: 1, qualified_action: "a first action" } } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ player: "Alice", actionNumber: 1, actionType: "pending" });
  });

  it("emits action with action_number 2", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice" },
      packets: [
        makePacket(15, [
          { type: "log_spectator", args: { log: "test" } },
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: { action_number: 2 } } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ actionNumber: 2, actionType: "pending" });
  });

  it("ignores gameStateChange with non-4 state id", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice" },
      packets: [
        makePacket(10, [
          { type: "gameStateChange", args: { id: 2, active_player: "100", args: { action_number: 1 } } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(0);
  });

  it("ignores gameStateChange state 4 without action_number", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice" },
      packets: [
        makePacket(10, [
          { type: "log_spectator", args: { log: "test" } },
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: {} } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(0);
  });

  it("uses player ID as fallback when player name not found", () => {
    const raw: RawExtractionData = {
      players: {},
      packets: [
        makePacket(10, [
          { type: "log_spectator", args: { log: "test" } },
          { type: "gameStateChange", args: { id: 4, active_player: "999", args: { action_number: 1 } } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ player: "999" });
  });

  it("classifies meld from transfer after gameStateChange", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice" },
      packets: [
        makePacket(20, [
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: { action_number: 1 } } },
          { type: "transferedCard", args: { name: "Archery", age: 1, location_from: "hand", location_to: "board", owner_from: "100", owner_to: "100", meld_keyword: true } },
          { type: "transferedCard_spectator", args: { type: "0" } },
          { type: "log_spectator", args: { log: "Alice melded Archery." } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ player: "Alice", actionType: "meld", cardName: "Archery" });
  });

  it("deduplicates gameStateChange from player and spectator channels", () => {
    const raw: RawExtractionData = {
      players: { "100": "Alice" },
      packets: [
        // Player channel packet (no _spectator types) — gameStateChange skipped
        makePacket(10, [
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: { action_number: 1 } } },
        ]),
        // Spectator channel packet — gameStateChange processed
        makePacket(10, [
          { type: "log_spectator", args: { log: "test" } },
          { type: "gameStateChange", args: { id: 4, active_player: "100", args: { action_number: 1 } } },
        ]),
      ],
    };
    const result = processRawLog(raw);
    expect(result.actions).toHaveLength(1);
  });
});
