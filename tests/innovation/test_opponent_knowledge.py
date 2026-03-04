"""Unit tests for opponent knowledge model in Innovation game state tracking.

Tests the opponent_knows_exact, opponent_might_suspect, suspect_list_explicit
flags and suspect propagation in GameStateTracker._propagate().
"""

import json

import pytest

from bga_tracker.innovation.card import Card, CardDatabase, CardSet, AgeSet
from bga_tracker.innovation.game_state import GameState, Action
from bga_tracker.innovation.game_state_tracker import GameStateTracker

ME = "Me"
OPP = "Opponent"
PLAYERS = [ME, OPP]


@pytest.fixture
def card_db(tmp_path):
    """Minimal CardDatabase with five age-3 base cards — one propagation group."""
    cards = [
        {"name": "Paper", "age": 3, "color": "green", "set": 0},
        {"name": "Compass", "age": 3, "color": "blue", "set": 0},
        {"name": "Education", "age": 3, "color": "yellow", "set": 0},
        {"name": "Alchemy", "age": 3, "color": "purple", "set": 0},
        {"name": "Translation", "age": 3, "color": "red", "set": 0},
    ]
    path = tmp_path / "cardinfo.json"
    path.write_text(json.dumps(cards))
    return CardDatabase(str(path))


ALL_NAMES = {"paper", "compass", "education", "alchemy", "translation"}


def make_tracker(card_db):
    """Create empty GameState wrapped in GameStateTracker for testing."""
    return GameStateTracker(GameState(PLAYERS), card_db, PLAYERS, ME)


def make_action(source: str, dest: str, card_index: str | None = None, group_key: AgeSet | None = None, source_player: str | None = None, dest_player: str | None = None, meld_keyword: bool = False, bottom_to: bool = False) -> Action:
    """Create an Action with sensible defaults for tests."""
    return Action(source=source, dest=dest, card_index=card_index, group_key=group_key, source_player=source_player, dest_player=dest_player, meld_keyword=meld_keyword, bottom_to=bottom_to)


def make_card(name, age=3, card_set=0, candidates=None,
              opp_knows=False, suspect=None, explicit=False):
    """Create a Card with specified opponent knowledge state."""
    card = Card(age, card_set, candidates or {name})
    card.opponent_knows_exact = opp_knows
    card.opponent_might_suspect = set(suspect) if suspect else set()
    card.suspect_list_explicit = explicit
    return card


class TestBoardPlacement:
    """Board placement sets opponent knowledge."""

    def test_meld_sets_opponent_knowledge(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state
        paper = make_card("paper")
        game_state.hands[ME].append(paper)
        game_state._groups[AgeSet(3, CardSet.BASE)].append(paper)

        tracker.move(make_action(
            source="hand", dest="board",
            card_index="paper",
            source_player=ME, dest_player=ME))

        assert paper.opponent_knows_exact is True
        assert paper.opponent_might_suspect == {"paper"}
        assert paper.suspect_list_explicit is True


class TestDrawAndReveal:
    """Draw-and-reveal sets opponent knowledge."""

    def test_draw_and_reveal(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state
        card = Card(3, 0, ALL_NAMES)
        game_state.decks[AgeSet(3, CardSet.BASE)] = [card]
        game_state._groups[AgeSet(3, CardSet.BASE)].append(card)

        tracker.move(make_action(
            source="deck", dest="revealed",
            card_index="paper",
            dest_player=ME))

        assert card.opponent_knows_exact is True
        assert card.opponent_might_suspect == {"paper"}
        assert card.suspect_list_explicit is True


class TestHiddenDrawToOpponent:
    """Hidden draw to opponent's hand."""

    def test_hidden_draw_opponent_knows(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state
        card = Card(3, 0, ALL_NAMES)
        game_state.decks[AgeSet(3, CardSet.BASE)] = [card]
        game_state._groups[AgeSet(3, CardSet.BASE)].append(card)

        tracker.move(make_action(
            source="deck", dest="hand",
            group_key=AgeSet(3, CardSet.BASE),
            dest_player=OPP))

        assert card.opponent_knows_exact is True
        assert card.opponent_might_suspect == set()
        assert card.suspect_list_explicit is False


class TestNamedDrawNoReveal:
    """Named draw to our hand (no reveal)."""

    def test_named_draw_no_opponent_knowledge(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state
        card = Card(3, 0, ALL_NAMES)
        game_state.decks[AgeSet(3, CardSet.BASE)] = [card]
        game_state._groups[AgeSet(3, CardSet.BASE)].append(card)

        tracker.move(make_action(
            source="deck", dest="hand",
            card_index="paper",
            dest_player=ME))

        assert card.opponent_knows_exact is False
        assert card.opponent_might_suspect == set()


class TestTransferBetweenPlayers:
    """Transfer between players sets reveal."""

    def test_transfer_reveals_card(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state
        paper = make_card("paper")
        game_state.hands[ME].append(paper)
        game_state._groups[AgeSet(3, CardSet.BASE)].append(paper)

        tracker.move(make_action(
            source="hand", dest="hand",
            card_index="paper",
            source_player=ME, dest_player=OPP))

        assert paper.opponent_knows_exact is True
        assert paper.opponent_might_suspect == {"paper"}
        assert paper.suspect_list_explicit is True


class TestRevealHand:
    """reveal_hand sets full opponent knowledge."""

    def test_reveal_hand_resolves_and_marks(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state

        paper = make_card("paper")
        game_state.hands[ME].append(paper)
        game_state._groups[AgeSet(3, CardSet.BASE)].append(paper)

        # Unknown card with compass + education as candidates
        unknown = Card(3, 0, {"compass", "education"})
        game_state.hands[ME].append(unknown)
        game_state._groups[AgeSet(3, CardSet.BASE)].append(unknown)

        # Remaining cards resolved elsewhere — complete group prevents
        # hidden singles from misfiring on the incomplete 5-name group.
        for name in ["education", "alchemy", "translation"]:
            card = make_card(name)
            game_state.boards[OPP].append(card)
            game_state._groups[AgeSet(3, CardSet.BASE)].append(card)

        tracker.reveal_hand(ME, ["paper", "compass"])

        # Paper (was already known)
        assert paper.opponent_knows_exact is True
        assert paper.opponent_might_suspect == {"paper"}
        assert paper.suspect_list_explicit is True

        # Compass (was unknown, now resolved)
        assert unknown.opponent_knows_exact is True
        assert unknown.opponent_might_suspect == {"compass"}
        assert unknown.suspect_list_explicit is True
        assert unknown.candidates == {"compass"}


class TestReturnAllKnown:
    """Named return to deck — opponent knew all matching cards."""

    def test_return_merges_suspects(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state

        paper = make_card("paper", opp_knows=True,
                          suspect={"paper"}, explicit=True)
        compass = make_card("compass", opp_knows=True,
                            suspect={"compass"}, explicit=True)
        game_state.hands[ME].extend([paper, compass])
        game_state.decks[AgeSet(3, CardSet.BASE)] = []
        game_state._groups[AgeSet(3, CardSet.BASE)].extend([paper, compass])

        tracker.move(make_action(
            source="hand", dest="deck",
            card_index="paper",
            source_player=ME))

        # Suspects merged, certainty lost
        for card in [paper, compass]:
            assert card.opponent_knows_exact is False
            assert card.opponent_might_suspect == {"paper", "compass"}
            assert card.suspect_list_explicit is True

        # Candidates unchanged — we know which card was returned
        assert paper.candidates == {"paper"}
        assert compass.candidates == {"compass"}


class TestReturnPartialKnowledge:
    """Named return to deck — opponent knew some matching cards."""

    def test_return_partial_suspects(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state

        paper = make_card("paper", opp_knows=True,
                          suspect={"paper"}, explicit=True)
        unknown = Card(3, 0, {"compass", "education"})
        # unknown has opp_knows=False, suspect=None by default

        game_state.hands[ME].extend([paper, unknown])
        game_state.decks[AgeSet(3, CardSet.BASE)] = []
        game_state._groups[AgeSet(3, CardSet.BASE)].extend([paper, unknown])

        tracker.move(make_action(
            source="hand", dest="deck",
            card_index="paper",
            source_player=ME))

        for card in [paper, unknown]:
            assert card.opponent_knows_exact is False
            assert card.opponent_might_suspect == {"paper"}
            assert card.suspect_list_explicit is False


class TestSuspectPropagation:
    """Suspect propagation: the full Oars -> discard -> re-reveal scenario."""

    def test_reveal_triggers_suspect_deduction(self, card_db):
        tracker = make_tracker(card_db)
        game_state = tracker.game_state

        # Post-named-return state: candidates known, suspects merged
        card_a = Card(3, 0, {"compass"})
        card_a.opponent_knows_exact = False
        card_a.opponent_might_suspect = {"paper", "compass"}
        card_a.suspect_list_explicit = True

        card_b = Card(3, 0, {"paper"})
        card_b.opponent_knows_exact = False
        card_b.opponent_might_suspect = {"paper", "compass"}
        card_b.suspect_list_explicit = True

        game_state.hands[ME].append(card_a)
        game_state.decks[AgeSet(3, CardSet.BASE)] = [card_b]
        game_state._groups[AgeSet(3, CardSet.BASE)].extend([card_a, card_b])

        # Reveal shows card_a is Compass; suspect propagation deduces card_b
        tracker.reveal_hand(ME, ["compass"])

        # Card A: revealed as Compass
        assert card_a.candidates == {"compass"}
        assert card_a.opponent_knows_exact is True
        assert card_a.opponent_might_suspect == {"compass"}
        assert card_a.suspect_list_explicit is True

        # Card B: deduced via suspect propagation
        assert card_b.candidates == {"paper"}
        assert card_b.opponent_knows_exact is True
        assert card_b.opponent_might_suspect == {"paper"}
        assert card_b.suspect_list_explicit is True
