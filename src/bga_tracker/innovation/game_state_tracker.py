"""GameStateTracker: applies game actions and constraint propagation to a GameState."""

from itertools import combinations

from bga_tracker.innovation.card import Card, CardDatabase, CardSet, AgeSet
from bga_tracker.innovation.game_state import GameState, Action


class GameStateTracker:
    """Applies game actions and constraint propagation to a GameState."""

    def __init__(self, game_state: GameState, card_db: CardDatabase, players: list[str], perspective: str):
        self.game_state = game_state
        self.card_db = card_db
        self.players = players
        self.perspective = perspective

    def init_game(self, num_players: int) -> None:
        """Set up initial game state: all cards in decks, then deal."""
        game_state = self.game_state

        # Create all cards in decks
        for group_key, index_names in self.card_db.groups().items():
            game_state.decks[group_key] = [game_state._create_card(group_key, index_names) for _ in range(len(index_names))]

        # Move 1 card per base age 1-9 to achievements
        for age in range(1, 10):
            deck = game_state.decks[AgeSet(age, CardSet.BASE)]
            game_state.achievements.append(deck.pop())

        # Deal 2 base age-1 cards per player
        deck = game_state.decks[AgeSet(1, CardSet.BASE)]
        for player in self.players:
            for _ in range(2):
                game_state.hands[player].append(deck.pop())

    def resolve_hand(self, player: str, card_names: list[str]) -> None:
        """Resolve hand cards using known card names (e.g. from gamedatas)."""
        game_state = self.game_state
        for name in card_names:
            card_index = name.lower()
            if card_index not in self.card_db:
                continue
            matching = [card for card in game_state.hands[player] if not card.is_resolved and card_index in card.candidates]
            if not matching:
                continue
            card = matching[0]
            group_key = self.card_db[card_index].group_key
            card.resolve(card_index)
            game_state._mark_resolved(card, group_key)
            self._propagate(group_key)

    # ------------------------------------------------------------------
    # Location helpers
    # ------------------------------------------------------------------

    def _cards_at(self, loc_type: str, player: str | None, group_key: AgeSet) -> list[Card]:
        """Return the card list for a location type."""
        game_state = self.game_state
        match loc_type:
            case "deck":
                return game_state.decks[group_key]
            case "hand":
                return game_state.hands[player]
            case "board":
                return game_state.boards[player]
            case "score":
                return game_state.scores[player]
            case "revealed":
                return game_state.revealed[player]
            case _:
                raise ValueError(f"Unknown location type: {loc_type}")

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def _take_from_source(self, action: Action, group_key: AgeSet) -> Card:
        """Find, resolve, remove, and merge at the source location."""
        game_state = self.game_state
        if action.source == "deck":
            source_cards = game_state.decks[group_key]
            card = source_cards[0]
        else:
            source_cards = self._cards_at(action.source, action.source_player, group_key)
            if action.card_index:
                card: Card = next(other for other in source_cards if action.card_index in other.candidates)
            else:
                card: Card = next(other for other in source_cards if other.group_key == group_key)

        if action.card_index and not card.is_resolved:
            card.resolve(action.card_index)
            game_state._mark_resolved(card, group_key)
            self._propagate(group_key)

        source_cards.remove(card)

        # Hidden action from private zone: we can't tell which card moved
        if not action.card_index and action.source in ("hand", "score"):
            self._merge_candidates(card, source_cards)

        self._merge_suspects(card, source_cards, action)

        return card

    def _update_opponent_knowledge(self, card: Card, action: Action) -> None:
        """Update opponent knowledge flags after a move."""
        is_visible_to_both = (action.dest in ("board", "revealed")
                              or (action.source_player is not None
                                  and action.dest_player is not None
                                  and action.source_player != action.dest_player))
        if is_visible_to_both:
            card.mark_public()
            return

        is_visible_to_opponent = action.dest in ("hand", "score") and action.dest_player != self.perspective
        if is_visible_to_opponent:
            card.opponent_knows_exact = True

    def move(self, action: Action) -> None:
        """Move a card from one location to another."""
        group_key = self.card_db[action.card_index].group_key if action.card_index else action.group_key

        card = self._take_from_source(action, group_key)
        self._cards_at(action.dest, action.dest_player, group_key).append(card)
        self._update_opponent_knowledge(card, action)

    def _merge_candidates(self, card: Card, remaining_source: list[Card]) -> None:
        """Merge candidate sets when we can't tell which card moved.

        The moved card and remaining same-group cards at the source all
        become ambiguous: each gets the union of all their candidates.
        """
        affected = [card] + [other for other in remaining_source if other.group_key == card.group_key]
        if len(affected) <= 1:
            return
        union = {name for other in affected for name in other.candidates}
        for other in affected:
            other.candidates = set(union)

    def _merge_suspects(self, card: Card, remaining_source: list[Card], action: Action) -> None:
        """Merge suspect lists when opponent can't tell which card moved.

        The moved card and remaining same-group cards at the source all
        lose opponent certainty: each gets the union of all their suspects.
        """
        # Only relevant when our card moves between private zones —
        # opponent can't see which card left, so they lose certainty.
        if not (action.source in ("hand", "score")
                and action.dest in ("deck", "hand", "score")
                and action.source_player == self.perspective
                and action.dest_player in (None, self.perspective)):
            return

        affected = [card] + [other for other in remaining_source if other.group_key == card.group_key]
        if len(affected) == 1:
            return

        # Collect all names the opponent could associate with these cards.
        suspect_union = {name for other in affected for name in other.opponent_might_suspect}

        # The merged suspect list is "explicit" (closed/complete) only if
        # every card's suspect list was already closed before the merge.
        all_explicit = all(other.suspect_list_explicit for other in affected)

        # All cards lose certainty — opponent can't tell which one moved
        for other in affected:
            other.opponent_knows_exact = False
            other.opponent_might_suspect = set(suspect_union)
            other.suspect_list_explicit = all_explicit

    def reveal_hand(self, player: str, card_indices: list[str]) -> None:
        """Handle 'reveals his hand' — resolve and mark cards without moving them."""
        game_state = self.game_state
        for card_index in card_indices:
            group_key = self.card_db[card_index].group_key

            card: Card = next(other for other in game_state.hands[player] if card_index in other.candidates)
            card.resolve(card_index)
            game_state._mark_resolved(card, group_key)
            card.mark_public()
            self._propagate(group_key)

    # ------------------------------------------------------------------
    # Constraint propagation
    # ------------------------------------------------------------------

    def _propagate(self, group_key: AgeSet) -> None:
        """Propagate constraints within an (age, card_set) group to fixed-point.

        1. Singleton propagation: resolved card's index removed from all others.
        2. Hidden singles: name in only 1 card's candidates → resolve.
        3. Naked subsets: N cards with exactly N candidates → remove from others.
        4. Suspect propagation: publicly-known names removed from suspect lists.
           If explicit suspect list → 1 element → opponent_knows_exact.
        """
        game_state = self.game_state
        group = game_state._groups[group_key]
        changed = True
        while changed:
            changed = False

            # 1. Singleton propagation
            for card in group:
                if card.is_resolved:
                    for other in group:
                        if other is not card and card.card_index in other.candidates:
                            other.candidates.discard(card.card_index)
                            if other.is_resolved:
                                game_state._mark_resolved(other, group_key)
                                changed = True

            # 2. Hidden singles
            for candidate_name in {name for card in group if not card.is_resolved for name in card.candidates}:
                holders = [card for card in group if candidate_name in card.candidates and not card.is_resolved]
                if len(holders) == 1:
                    holders[0].resolve(candidate_name)
                    game_state._mark_resolved(holders[0], group_key)
                    changed = True

            # 3. Naked subsets (only for small groups — max 15)
            unresolved = [card for card in group if not card.is_resolved]
            if len(unresolved) > 3:
                for size in range(2, len(unresolved)):
                    for subset in combinations(unresolved, size):
                        union = {name for card in subset for name in card.candidates}
                        if len(union) == size:
                            for other in unresolved:
                                if other not in subset:
                                    other.candidates -= union
                                    if other.is_resolved:
                                        game_state._mark_resolved(other, group_key)
                                        changed = True
                            break  # restart after changes

            # 4. Suspect propagation: remove publicly-known names from
            #    other cards' suspect lists within the same group.
            for card in group:
                if card.opponent_knows_exact and card.is_resolved:
                    for other in group:
                        if other is not card and card.card_index in other.opponent_might_suspect:
                            other.opponent_might_suspect.discard(card.card_index)
                            if other.suspect_list_explicit and len(other.opponent_might_suspect) == 1:
                                other.opponent_knows_exact = True
                                changed = True
