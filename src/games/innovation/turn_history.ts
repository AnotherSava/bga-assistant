// Turn history: classify player actions from game log entries.

import type { GameLogEntry, TurnMarkerEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionType = "meld" | "draw" | "dogma" | "endorse" | "achieve" | "pending";

export interface TurnAction {
  player: string;
  actionNumber: number;
  actionType: ActionType;
  cardName: string | null;
  cardAge: number | null;
  cardSet: string | null;
}

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

/** Classify the action for a turnMarker by inspecting subsequent entries in the same move. */
function classifyAction(marker: TurnMarkerEntry, entries: GameLogEntry[]): TurnAction {
  const base: TurnAction = {
    player: marker.player,
    actionNumber: marker.actionNumber,
    actionType: "pending",
    cardName: null,
    cardAge: null,
    cardSet: null,
  };

  for (const entry of entries) {
    if (entry.move !== marker.move) continue;

    // Dogma: logWithCardTooltips with "activates the dogma of"
    if (entry.type === "logWithCardTooltips") {
      const dogmaMatch = entry.msg.match(/activates the dogma of (\d+) (.+?) with/);
      if (dogmaMatch) {
        base.actionType = "dogma";
        base.cardName = dogmaMatch[2].trim();
        return base;
      }
      const endorseMatch = entry.msg.match(/endorses the dogma of (\d+) (.+?) with/);
      if (endorseMatch) {
        base.actionType = "endorse";
        base.cardName = endorseMatch[2].trim();
        return base;
      }
    }

    if (entry.type === "transfer") {
      // Achieve: source=achievements, dest=achievements
      if (entry.source === "achievements" && entry.dest === "achievements") {
        base.actionType = "achieve";
        base.cardAge = entry.cardAge;
        return base;
      }

      // Meld: meldKeyword, hand -> board
      if (entry.meldKeyword && entry.source === "hand" && entry.dest === "board") {
        base.actionType = "meld";
        base.cardName = entry.cardName;
        base.cardAge = entry.cardAge;
        base.cardSet = entry.cardSet;
        return base;
      }

      // Draw: source=deck
      if (entry.source === "deck") {
        base.actionType = "draw";
        base.cardName = entry.cardName;
        base.cardAge = entry.cardAge;
        base.cardSet = entry.cardSet;
        return base;
      }
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Build turn history
// ---------------------------------------------------------------------------

/**
 * Walk the game log and classify each turnMarker's action.
 * Returns actions in log order (oldest first).
 */
export function buildTurnHistory(log: GameLogEntry[]): TurnAction[] {
  const actions: TurnAction[] = [];

  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry.type !== "turnMarker") continue;

    // Collect subsequent entries in the same move (after this marker, before the next marker)
    const subsequent: GameLogEntry[] = [];
    for (let j = i + 1; j < log.length; j++) {
      if (log[j].type === "turnMarker") break;
      subsequent.push(log[j]);
    }

    actions.push(classifyAction(entry, subsequent));
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Recent turns
// ---------------------------------------------------------------------------

/**
 * Return actions from the last `count` half-turns, in reverse order (newest first).
 * A half-turn is a consecutive group of actions by the same player.
 */
export function recentTurns(actions: TurnAction[], count: number): TurnAction[] {
  if (count <= 0 || actions.length === 0) return [];

  // Walk backwards to identify half-turn boundaries
  const halfTurns: TurnAction[][] = [];
  let currentGroup: TurnAction[] = [];
  let currentPlayer: string | null = null;

  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    if (action.player !== currentPlayer && currentGroup.length > 0) {
      halfTurns.push(currentGroup);
      currentGroup = [];
      if (halfTurns.length >= count) break;
    }
    currentPlayer = action.player;
    currentGroup.unshift(action);
  }
  if (currentGroup.length > 0 && halfTurns.length < count) {
    halfTurns.push(currentGroup);
  }

  // halfTurns is already newest-first groups, each group is in chronological order
  // Flatten: newest half-turn first, within each half-turn oldest action first
  return halfTurns.flat();
}
