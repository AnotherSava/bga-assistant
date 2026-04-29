// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractGameData } from "../extract";

describe("extractGameData", () => {
  let originalLocation: Location;

  beforeEach(() => {
    // Save original location
    originalLocation = window.location;
    // Clean up gameui
    delete (globalThis as any).gameui;
  });

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true });
    delete (globalThis as any).gameui;
  });

  function setLocation(search: string, pathname: string): void {
    Object.defineProperty(window, "location", {
      value: { search, pathname, href: `https://boardgamearena.com${pathname}${search}` },
      writable: true,
      configurable: true,
    });
  }

  it("returns error when no table= param in URL", async () => {
    setLocation("", "/123/innovation");
    const result = await extractGameData();
    expect(result).toEqual({ error: true, msg: "No table= param in URL" });
  });

  it("returns error when gameui is not available", async () => {
    setLocation("?table=456", "/123/innovation");
    const result = await extractGameData();
    expect(result).toEqual({ error: true, msg: "gameui not available — is this a BGA game page?" });
  });

  it("returns error when gameui has no ajaxcall", async () => {
    setLocation("?table=456", "/123/innovation");
    (globalThis as any).gameui = { gamedatas: {} };
    const result = await extractGameData();
    expect(result).toEqual({ error: true, msg: "gameui not available — is this a BGA game page?" });
  });

  it("returns error when ajaxcall returns no data", async () => {
    setLocation("?table=456", "/123/innovation");
    (globalThis as any).gameui = {
      gamedatas: { players: {} },
      ajaxcall: (_endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        successCb({ data: null });
      },
    };
    const result = await extractGameData();
    expect(result).toEqual({ error: true, msg: "BGA API returned no notification data" });
  });

  it("returns error when ajaxcall fails", async () => {
    setLocation("?table=456", "/123/innovation");
    (globalThis as any).gameui = {
      gamedatas: { players: {} },
      ajaxcall: (_endpoint: string, _params: any, _context: any, _successCb: any, errorCb: (e: boolean, msg: string) => void) => {
        errorCb(true, "Network failure");
      },
    };
    const result = await extractGameData();
    expect(result).toEqual({ error: true, msg: "Network failure" });
  });

  it("extracts player info (name + BGA color + isCurrent) from gamedatas", async () => {
    setLocation("?table=789", "/42/innovation");
    const mockPackets = [{ move_id: 1, data: [] }];
    (globalThis as any).gameui = {
      player_id: "100",
      gamedatas: {
        players: {
          "100": { name: "Alice", color: "ff0000" },
          "200": { name: "Bob", color: "0000ff" },
        },
        my_hand: [],
        cards: {},
      },
      ajaxcall: (_endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        successCb({ data: mockPackets });
      },
    };
    const result = await extractGameData();
    expect(result.error).toBeUndefined();
    expect(result.players).toEqual({
      "100": { id: "100", name: "Alice", colorHex: "ff0000", isCurrent: true },
      "200": { id: "200", name: "Bob", colorHex: "0000ff", isCurrent: false },
    });
    expect(result.packets).toBe(mockPackets);
  });

  it("returns an error when BGA player color is missing", async () => {
    setLocation("?table=789", "/42/innovation");
    (globalThis as any).gameui = {
      gamedatas: {
        players: { "100": { name: "Alice" } },
        my_hand: [],
        cards: {},
      },
      ajaxcall: (_endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        successCb({ data: [] });
      },
    };
    const result = await extractGameData();
    expect(result.error).toBe(true);
    expect(String(result.msg)).toContain("BGA player color missing");
  });

  it("extracts gamedatas with hand and cards", async () => {
    setLocation("?table=789", "/42/innovation");
    const hand = [{ id: 1 }, { id: 2 }];
    const cards = { "1": { name: "Pottery" }, "2": { name: "Tools" } };
    (globalThis as any).gameui = {
      gamedatas: { players: {}, my_hand: hand, cards },
      ajaxcall: (_endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        successCb({ data: [{ move_id: 1, data: [] }] });
      },
    };
    const result = await extractGameData();
    expect(result.gamedatas).toEqual({ my_hand: hand, cards });
  });

  it("handles missing gamedatas gracefully", async () => {
    setLocation("?table=789", "/42/innovation");
    (globalThis as any).gameui = {
      gamedatas: null,
      ajaxcall: (_endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        successCb({ data: [{ move_id: 1, data: [] }] });
      },
    };
    const result = await extractGameData();
    expect(result.gamedatas).toBeNull();
    expect(result.players).toEqual({});
  });

  it("constructs correct BGA endpoint from URL path", async () => {
    setLocation("?table=789", "/42/innovation");
    let capturedEndpoint = "";
    (globalThis as any).gameui = {
      gamedatas: { players: {} },
      ajaxcall: (endpoint: string, _params: any, _context: any, successCb: (r: any) => void) => {
        capturedEndpoint = endpoint;
        successCb({ data: [{ move_id: 1, data: [] }] });
      },
    };
    await extractGameData();
    // BGA endpoint doubles the game name: /<N>/<game>/<game>/notificationHistory.html
    expect(capturedEndpoint).toBe("/42/innovation/innovation/notificationHistory.html");
  });

  it("passes correct parameters to ajaxcall", async () => {
    setLocation("?table=789", "/42/innovation");
    let capturedParams: any = null;
    (globalThis as any).gameui = {
      gamedatas: { players: {} },
      ajaxcall: (_endpoint: string, params: any, _context: any, successCb: (r: any) => void) => {
        capturedParams = params;
        successCb({ data: [{ move_id: 1, data: [] }] });
      },
    };
    await extractGameData();
    expect(capturedParams).toEqual({ table: 789, from: 0, privateinc: 1, history: 1 });
  });

  it("extracts table ID from middle of search string", async () => {
    setLocation("?game=innovation&table=555&foo=bar", "/42/innovation");
    let capturedParams: any = null;
    (globalThis as any).gameui = {
      gamedatas: { players: {} },
      ajaxcall: (_endpoint: string, params: any, _context: any, successCb: (r: any) => void) => {
        capturedParams = params;
        successCb({ data: [{ move_id: 1, data: [] }] });
      },
    };
    await extractGameData();
    expect(capturedParams.table).toBe(555);
  });
});
