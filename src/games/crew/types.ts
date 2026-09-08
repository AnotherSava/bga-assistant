// Suit constants matching BGA card.color encoding.
export const BLUE = 1;
export const GREEN = 2;
export const PINK = 3;
export const YELLOW = 4;
export const SUBMARINE = 5;

/** All suit numbers in display order (matches BGA card grid). */
export const ALL_SUITS = [BLUE, GREEN, PINK, YELLOW, SUBMARINE] as const;

/** Valid values for each suit: color suits have 1-9, submarine has 1-4. */
export const SUIT_VALUES: Record<number, number[]> = {
  [PINK]: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [BLUE]: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [GREEN]: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [YELLOW]: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [SUBMARINE]: [1, 2, 3, 4],
};

/** A single crew card with suit and value. */
export interface CrewCard {
  suit: number;
  value: number;
}

/** Build a card key string from suit and value for use in Sets/Maps. */
export function cardKey(suit: number, value: number): string {
  return `${suit}:${value}`;
}

// ---------------------------------------------------------------------------
// Task distribution — free allocation
// ---------------------------------------------------------------------------

/**
 * One of BGA's text templates: a finished value, or a `log` string whose `${name}` slots are
 * filled from `args`. Task descriptions arrive in this form, nested several deep, with the card
 * symbols at the leaves. `args` is an empty array rather than an object when there is nothing to
 * substitute.
 */
export type BgaText = string | number | { log: string; args: Record<string, BgaText> | BgaText[] };

/**
 * A task on offer this mission. Its position in the offered list is what BGA turns into the letter
 * printed on the task card, so the order this arrives in is the order it has to be shown in.
 */
export interface CrewTask {
  id: string;
  difficulty: number;
  text: BgaText;
  subtext: string | null;
}

/**
 * One player's rating of a group of tasks, from BGA's five-smiley scale: 0 is the willing end
 * (a grin) and 4 the unwilling one (a frown). A bundle may hold several tasks rated together.
 */
export interface TaskBundle {
  id: number;
  taskIds: string[];
  opinion: number;
}

/** The letter BGA prints on the task sitting at this position in the offered list. */
export function taskLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
