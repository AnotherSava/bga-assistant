// Turn history: action types and recent-turns grouping.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionType = "meld" | "draw" | "dogma" | "endorse" | "achieve" | "promote" | "pending" | "seize" | "artifact_dogma" | "artifact_return" | "artifact_pass";

export interface ActionDetail {
  actionType: ActionType;
  cardName: string | null;
  cardAge: number | null;
  cardSet: string | null;
}

export interface TurnAction {
  player: string;
  actionNumber: number;
  time: number | null;
  logIndex: number;
  actions: ActionDetail[];  // [0] = primary, [1..] = sub-actions
}

// ---------------------------------------------------------------------------
// Recent turns
// ---------------------------------------------------------------------------

/**
 * Return actions from the last `count` half-turns, in chronological order
 * (oldest half-turn first, oldest action first within each group).
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
    currentGroup.push(action);
  }
  if (currentGroup.length > 0 && halfTurns.length < count) {
    halfTurns.push(currentGroup);
  }

  // halfTurns is newest-first groups, each group is newest-action-first
  // Reverse both levels to get chronological order
  halfTurns.reverse();
  for (const group of halfTurns) group.reverse();
  return halfTurns.flat();
}
