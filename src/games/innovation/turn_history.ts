// Turn history: Innovation's action types, over the shared turn-history kernel.

import type { TurnAction as GenericTurnAction } from "../../engine/turn_history.js";

export { recentTurns } from "../../engine/turn_history.js";

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

/** An Innovation turn action — the shared shape carrying Innovation's own detail. */
export type TurnAction = GenericTurnAction<ActionDetail>;
