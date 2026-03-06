"""GameState class: card locations, queries, and serialization."""

import json
from dataclasses import dataclass
from collections import defaultdict

from bga_tracker.innovation.card import Card, CardSet, AgeSet


class GameStateEncoder(json.JSONEncoder):
    """JSON encoder that handles Card, set, and IntEnum types."""
    def default(self, obj: object) -> object:
        if isinstance(obj, Card):
            return {slot: getattr(obj, slot) for slot in Card.__slots__}
        if isinstance(obj, set):
            return sorted(obj)
        return super().default(obj)


@dataclass
class Action:
    """Uniform representation of any card movement."""
    source: str                             # "deck", "hand", "board", "score", "revealed"
    dest: str                               # "deck", "hand", "board", "score", "revealed"
    card_index: str | None                  # lowercase index name, None for hidden actions
    group_key: AgeSet | None                # (age, card_set), None for named actions
    source_player: str | None               # owner at source, None for decks
    dest_player: str | None                 # owner at dest, None for decks
    meld_keyword: bool                      # meld (not tuck)
    bottom_to: bool                         # tuck (bottom of board stack)


class GameState:
    """Innovation game state: card locations, queries, and serialization.

    Stores card locations (decks, hands, boards, scores, achievements)
    as lists of Card objects. Mutation and constraint propagation live
    in GameStateTracker.
    """

    def __init__(self, players: list[str]) -> None:
        self.decks: defaultdict[AgeSet, list[Card]] = defaultdict(list)  # (age, card_set) -> [Card], index 0 = top
        self.hands: dict[str, list[Card]] = {player: [] for player in players}
        self.boards: dict[str, list[Card]] = {player: [] for player in players}
        self.scores: dict[str, list[Card]] = {player: [] for player in players}
        self.revealed: dict[str, list[Card]] = {player: [] for player in players}  # transient zone for draw-and-reveal
        self.achievements: list[Card] = []    # 9 slots (ages 1-9)

        # All Card objects per (age, card_set) group — for propagation
        self._groups: dict[AgeSet, list[Card]] = defaultdict(list)

        # Incremental resolution tracking
        self._resolved_indices: set[str] = set()
        self._resolved_counts: defaultdict[AgeSet, int] = defaultdict(int)

    def mark_resolved(self, card: Card, group_key: AgeSet) -> None:
        """Track a newly resolved card. Idempotent."""
        if card.card_index not in self._resolved_indices:
            self._resolved_indices.add(card.card_index)
            self._resolved_counts[group_key] += 1

    def unmark_resolved(self, card_index: str, group_key: AgeSet) -> None:
        """Remove a card from resolved tracking (it became ambiguous again)."""
        if card_index in self._resolved_indices:
            self._resolved_indices.discard(card_index)
            self._resolved_counts[group_key] -= 1

    def is_resolved(self, card_index: str) -> bool:
        """Check if a card_index has been resolved anywhere. O(1)."""
        return card_index in self._resolved_indices

    def resolved_count(self, age: int, card_set: CardSet) -> int:
        """Return how many cards are resolved in an (age, card_set) group. O(1)."""
        return self._resolved_counts[AgeSet(age, card_set)]

    def create_card(self, group_key: AgeSet, index_names: set[str]) -> Card:
        """Create a Card and register it in the propagation group."""
        card = Card(*group_key, index_names)
        self._groups[group_key].append(card)
        return card

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def opponent_has_partial_information(self, card: Card) -> bool:
        """True if the opponent has a partial (but not exact) suspect list for this card."""
        if card.opponent_knows_exact or not card.opponent_might_suspect:
            return False
        hidden_count = sum(1 for other in self._groups[card.group_key] if not other.opponent_knows_exact)
        return len(card.opponent_might_suspect) < hidden_count

    def opponent_knows_nothing(self, card: Card) -> bool:
        """True if the opponent has no information about this card's identity."""
        return not card.opponent_knows_exact and not self.opponent_has_partial_information(card)


    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_json(self) -> dict:
        """Serialize full game state to dict."""
        return {
            "decks": {f"{age}/{card_set.label}": stack for (age, card_set), stack in self.decks.items() if stack},
            "boards": self.boards,
            "hands": self.hands,
            "scores": self.scores,
            "achievements": self.achievements,
        }

    @classmethod
    def from_json(cls, data: dict) -> "GameState":
        """Deserialize game_state.json back into a fully functional GameState.

        Reconstructs Card objects, _groups, _resolved_indices, and
        _resolved_counts so that query methods work correctly.
        """
        players = list(data["hands"].keys())
        state = cls(players)

        def _load_card(d: dict) -> Card:
            card = Card(d["age"], CardSet(d["card_set"]), set(d["candidates"]))
            card.opponent_knows_exact = d["opponent_knows_exact"]
            card.opponent_might_suspect = set(d["opponent_might_suspect"])
            card.suspect_list_explicit = d["suspect_list_explicit"]
            group_key = card.group_key
            state._groups[group_key].append(card)
            if card.is_resolved:
                state.mark_resolved(card, group_key)
            return card

        def _load_cards(card_dicts: list[dict]) -> list[Card]:
            return [_load_card(d) for d in card_dicts]

        for key, card_dicts in data.get("decks", {}).items():
            age_str, set_label = key.split("/")
            state.decks[AgeSet(int(age_str), CardSet.from_label(set_label))] = _load_cards(card_dicts)

        for player in players:
            state.hands[player] = _load_cards(data["hands"][player])
            state.boards[player] = _load_cards(data["boards"][player])
            state.scores[player] = _load_cards(data["scores"][player])

        state.achievements = _load_cards(data.get("achievements", []))
        return state
