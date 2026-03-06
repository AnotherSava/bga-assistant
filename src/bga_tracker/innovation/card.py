"""Card class and CardDatabase loader for Innovation game state tracking."""

import json
from collections import defaultdict
from dataclasses import dataclass
from enum import IntEnum
from typing import NamedTuple


class CardSet(IntEnum):
    BASE = 0
    CITIES = 3

    @property
    def label(self) -> str:
        return self.name.lower()

    @classmethod
    def from_label(cls, label: str) -> "CardSet":
        return cls[label.upper()]


class Color(IntEnum):
    BLUE = 0
    RED = 1
    GREEN = 2
    YELLOW = 3
    PURPLE = 4

    def __str__(self) -> str:
        return self.name.lower()


class AgeSet(NamedTuple):
    """(age, card_set) pair identifying a group of cards with the same age and set."""
    age: int
    card_set: CardSet


def card_index(name: str) -> str:
    """Convert a display card name to a lowercase card index key."""
    return name.lower()


class Card:
    """A card with a set of possible identities (candidates).

    Each Card tracks age/set (always known from draw context), a mutable set
    of candidate names that shrinks as information is revealed, and flags for
    opponent knowledge tracking.
    """

    __slots__ = (
        "age",                    # int — card age (1-10), always known from draw context
        "card_set",               # CardSet — BASE=0, CITIES=3, always known from draw context
        "candidates",             # set[str] — possible lowercase card names; size 1 = resolved
        "opponent_knows_exact",   # bool — opponent definitely knows this card's identity
        "opponent_might_suspect", # set[str] — names we know opponent could associate; empty = no info
        "suspect_list_explicit",  # bool — True = suspect list is closed/complete
    )

    def __init__(self, age: int, card_set: CardSet, candidates: set[str] | None = None):
        self.age = age
        self.card_set = card_set
        self.candidates = set(candidates) if candidates else set()
        self.opponent_knows_exact = False
        self.opponent_might_suspect = set()
        self.suspect_list_explicit = False

    @property
    def group_key(self) -> AgeSet:
        return AgeSet(self.age, self.card_set)

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

    name: str                    # display name as shown in BGA UI
    index_name: str              # lowercase name, used as lookup key
    age: int                     # card age (1-10)
    color: Color                 # BRGYP — used for sorting and CSS class
    card_set: CardSet            # BASE or CITIES
    sprite_index: int            # index into BGA sprite sheet, used for asset filenames
    icons: tuple[str, ...]       # resource icon names in positional order
    dogmas: tuple[str, ...]      # dogma effect descriptions

    @property
    def group_key(self) -> AgeSet:
        return AgeSet(self.age, self.card_set)

class CardDatabase:
    """Card database loaded from card_info.json."""

    def __init__(self, path):
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)

        self._cards = {}

        for idx, item in enumerate(raw):
            if item is None or "age" not in item or "color" not in item:
                continue
            s = item.get("set")
            if s not in (CardSet.BASE, CardSet.CITIES):
                continue
            index_name = card_index(item["name"])
            self._cards[index_name] = CardInfo(
                name=item["name"],
                index_name=index_name,
                age=item["age"],
                color=Color[item["color"].upper()],
                card_set=CardSet(s),
                sprite_index=idx,
                icons=tuple(item.get("icons", ())),
                dogmas=tuple(item.get("dogmas", ())),
            )

        self._groups: dict[AgeSet, set[str]] = defaultdict(set)
        for info in self._cards.values():
            self._groups[info.group_key].add(info.index_name)

        self._group_infos: dict[AgeSet, list[CardInfo]] = {}
        for group_key, names in self._groups.items():
            self._group_infos[group_key] = sorted([self._cards[name] for name in names], key=lambda info: (info.color, info.name))

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

    def groups(self) -> dict[AgeSet, set[str]]:
        """Return index names grouped by (age, card_set)."""
        return self._groups

    def group_infos(self, age: int, card_set: CardSet) -> list[CardInfo]:
        """Return CardInfo objects for an (age, card_set) group, sorted by color and name."""
        return self._group_infos.get(AgeSet(age, card_set), [])

    def sort_key(self, name_lower):
        info = self._cards[name_lower]
        return info.age, info.color, name_lower
