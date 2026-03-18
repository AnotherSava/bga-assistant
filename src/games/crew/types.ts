// Suit constants matching BGA card.color encoding.
export const PINK = 1;
export const BLUE = 2;
export const GREEN = 3;
export const YELLOW = 4;
export const SUBMARINE = 5;

/** All suit numbers. */
export const ALL_SUITS = [PINK, BLUE, GREEN, YELLOW, SUBMARINE] as const;

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
