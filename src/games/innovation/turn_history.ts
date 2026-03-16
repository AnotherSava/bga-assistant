// Turn history: action types and recent-turns grouping.

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
  time: number | null;
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
    currentGroup.push(action);
  }
  if (currentGroup.length > 0 && halfTurns.length < count) {
    halfTurns.push(currentGroup);
  }

  // halfTurns is newest-first groups, each group is newest-action-first
  return halfTurns.flat();
}
