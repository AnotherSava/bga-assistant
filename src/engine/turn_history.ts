// Game-agnostic turn history: the shape every game's action stream takes, and the sliding
// window the two rendering surfaces read from.
//
// The detail carried by each action is the one game-specific part, so it stays a type
// parameter — Innovation's is a card action, Nucleum's is a board action.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnAction<TDetail> {
  /** Player id of whoever the turn belongs to. */
  player: string;
  /** Which of the turn's actions this is. Games with one action per turn always use 1. */
  actionNumber: number;
  /** Unix seconds from the packet the action arrived in, or null when unknown. */
  time: number | null;
  /** Index of the action's entry in the game log — the stable half of every row key. */
  logIndex: number;
  /** `[0]` is the primary action; the rest render as sub-actions under it. */
  actions: TDetail[];
}

// ---------------------------------------------------------------------------
// Recent turns
// ---------------------------------------------------------------------------

/**
 * Return actions from the last `count` half-turns, in chronological order
 * (oldest half-turn first, oldest action first within each group).
 * A half-turn is a consecutive group of actions by the same player.
 */
export function recentTurns<T extends { player: string }>(actions: T[], count: number): T[] {
  if (count <= 0 || actions.length === 0) return [];

  // Walk backwards to identify half-turn boundaries
  const halfTurns: T[][] = [];
  let currentGroup: T[] = [];
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
