"""Card class and CardDB loader for Innovation game state tracking."""

import json
from dataclasses import dataclass

SET_BASE = 0
SET_CITIES = 3
SET_LABEL = {SET_BASE: "base", SET_CITIES: "cities"}
LABEL_TO_SET = {"base": SET_BASE, "cities": SET_CITIES}
COLOR_ORDER = {"blue": 0, "red": 1, "green": 2, "yellow": 3, "purple": 4}


class Card:
    """A card with a set of possible identities (candidates).

    Each Card tracks age/set (always known from draw context), a mutable set
    of candidate names that shrinks as information is revealed, and flags for
    opponent knowledge tracking.
    """

    __slots__ = (
        "age",                    # int — card age (1-10), always known from draw context
        "card_set",               # int — 0=base, 3=cities, always known from draw context
        "candidates",             # set[str] — possible lowercase card names; size 1 = resolved
        "opponent_knows_exact",   # bool — opponent definitely knows this card's identity
        "opponent_might_suspect", # set[str] — names we know opponent could associate; empty = no info
        "suspect_list_explicit",  # bool — True = suspect list is closed/complete
    )

    def __init__(self, age, card_set, candidates=None):
        self.age = age
        self.card_set = card_set
        self.candidates = set(candidates) if candidates else set()
        self.opponent_knows_exact = False
        self.opponent_might_suspect = set()
        self.suspect_list_explicit = False

    @property
    def group_key(self) -> tuple[int, int]:
        return self.age, self.card_set

    @property
    def is_resolved(self):
        return len(self.candidates) == 1

    @property
    def card_index(self):
        if self.is_resolved:
            return next(iter(self.candidates))
        return None

    def remove_candidates(self, names):
        """Remove names from candidates. Returns True if candidates changed."""
        before = len(self.candidates)
        self.candidates -= names
        return len(self.candidates) < before

    def resolve(self, name):
        """Resolve this card to a single known identity."""
        self.candidates = {name}

    def mark_public(self):
        """Mark this card as publicly known to opponent."""
        self.opponent_knows_exact = True
        self.opponent_might_suspect = {self.card_index}
        self.suspect_list_explicit = True

    def __repr__(self):
        if self.is_resolved:
            flags = []
            if self.opponent_knows_exact:
                flags.append("opp_knows")
            return f"Card({self.card_index}, age={self.age}, set={self.card_set}" + \
                   (f", {' '.join(flags)}" if flags else "") + ")"
        return f"Card(age={self.age}, set={self.card_set}, {len(self.candidates)} candidates)"


@dataclass(frozen=True, slots=True)
class CardInfo:
    """Static card metadata from the card database."""

    name: str
    index_name: str
    age: int
    color: str
    card_set: int
    cardnum: int
    icons: tuple[str, ...]
    dogmas: tuple[str, ...]

    @property
    def group_key(self) -> tuple[int, int]:
        return self.age, self.card_set

class CardDB:
    """Card database loaded from cardinfo.json."""

    def __init__(self, path):
        with open(path) as f:
            raw = json.load(f)

        self._cards = {}

        for idx, item in enumerate(raw):
            if item is None or "age" not in item or "color" not in item:
                continue
            s = item.get("set")
            if s not in (SET_BASE, SET_CITIES):
                continue
            index_name = item["name"].lower()
            self._cards[index_name] = CardInfo(
                name=item["name"],
                index_name=index_name,
                age=item["age"],
                color=item["color"],
                card_set=s,
                cardnum=idx,
                icons=tuple(item.get("icons", ())),
                dogmas=tuple(item.get("dogmas", ())),
            )

    def __getitem__(self, name_lower):
        return self._cards[name_lower]

    def __contains__(self, name_lower):
        return name_lower in self._cards

    def __len__(self):
        return len(self._cards)

    def __iter__(self):
        return iter(self._cards)

    def keys(self):
        return self._cards.keys()

    def values(self):
        return self._cards.values()

    def items(self):
        return self._cards.items()

    def display_name(self, name_lower):
        return self._cards[name_lower].name

    def sort_key(self, name_lower):
        info = self._cards[name_lower]
        return info.age, COLOR_ORDER.get(info.color, 99), name_lower
