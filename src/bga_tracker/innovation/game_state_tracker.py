"""GameStateTracker: applies game actions and constraint propagation to a GameState."""

from itertools import combinations

from bga_tracker.innovation.card import Card, CardDatabase, CardSet, AgeSet, card_index
from bga_tracker.innovation.game_state import GameState, Action


REGULAR_ICONS = {"crown", "leaf", "lightbulb", "castle", "factory", "clock"}


class GameStateTracker:
    """Applies game actions and constraint propagation to a GameState."""

    def __init__(self, game_state: GameState, card_db: CardDatabase, players: list[str], perspective: str):
        self.game_state = game_state
        self.card_db = card_db
        self.players = players
        self.perspective = perspective
        self._meld_icon: str | None = None
        self._discard_names: set[str] = set()
        self._remaining_returns: int = 0

    def init_game(self, num_players: int) -> None:
        """Set up initial game state: all cards in decks, then deal."""
        game_state = self.game_state

        # Create all cards in decks
        for group_key, index_names in self.card_db.groups().items():
            game_state.decks[group_key] = [game_state.create_card(group_key, index_names) for _ in range(len(index_names))]

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
        """Resolve initial hand cards right after init_game."""
        game_state = self.game_state
        hand = game_state.hands[player]
        for i, name in enumerate(card_names):
            idx = card_index(name)
            card = hand[i]
            group_key = self.card_db[idx].group_key
            card.resolve(idx)
            game_state.mark_resolved(card, group_key)
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
            game_state.mark_resolved(card, group_key)
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

    def move(self, action: Action) -> Card:
        """Move a card from one location to another."""
        group_key = self.card_db[action.card_index].group_key if action.card_index else action.group_key

        # Detect city meld with a regular icon at position 5
        if action.meld_keyword and action.source == "hand" and action.dest == "board":
            info = self.card_db[action.card_index]
            if info.card_set == CardSet.CITIES and info.icons[5] in REGULAR_ICONS:
                self._meld_icon = info.icons[5]
                self._discard_names = set()
                self._remaining_returns = 0

        # Track draws (draw phase: meld icon set, not yet confirmed)
        if self._meld_icon and self._remaining_returns == 0:
            if action.source == "deck" and action.dest == "revealed":
                if self._meld_icon not in self.card_db[action.card_index].icons:
                    self._discard_names.add(action.card_index)
            elif action.source != "revealed" and action.dest != "board":
                self._meld_icon = None

        card = self._take_from_source(action, group_key)
        self._cards_at(action.dest, action.dest_player, group_key).append(card)
        self._update_opponent_knowledge(card, action)

        # Filter returns (return phase: remaining > 0)
        if self._remaining_returns > 0:
            assert action.source == "hand" and action.dest == "deck"
            self.restrict_candidates(card, self._discard_names)
            self._remaining_returns -= 1
            if self._remaining_returns == 0:
                self._meld_icon = None

        return card

    def confirm_meld_filter(self, icon: str) -> None:
        """Confirm meld icon filtering — transition from draw phase to return phase."""
        assert icon == self._meld_icon, f"Meld filter icon mismatch: log says '{icon}', card_info says '{self._meld_icon}'"
        self._remaining_returns = len(self._discard_names)
        if self._remaining_returns == 0:
            self._meld_icon = None

    def _merge_candidates(self, card: Card, remaining_source: list[Card]) -> None:
        """Merge candidate sets when we can't tell which card moved.

        The moved card and remaining same-group cards at the source all
        become ambiguous: each gets the union of all their candidates.
        """
        affected = [card] + [other for other in remaining_source if other.group_key == card.group_key]
        if len(affected) <= 1:
            return
        was_resolved = [(c, c.card_index) for c in affected if c.is_resolved]
        union = {name for other in affected for name in other.candidates}
        for other in affected:
            other.candidates = set(union)
        for c, resolved_index in was_resolved:
            self.game_state.unmark_resolved(resolved_index, c.group_key)

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

    def restrict_candidates(self, card: Card, allowed_names: set[str]) -> None:
        """Restrict card candidates and suspects to a known set of possible names."""
        was_resolved_index = card.card_index  # None if already unresolved
        card.candidates = set(allowed_names)
        if was_resolved_index and not card.is_resolved:
            self.game_state.unmark_resolved(was_resolved_index, card.group_key)
        elif card.is_resolved:
            self.game_state.mark_resolved(card, card.group_key)
        card.opponent_might_suspect &= allowed_names
        if card.suspect_list_explicit and len(card.opponent_might_suspect) == 1:
            card.opponent_knows_exact = True
        self._propagate(card.group_key)

    def reveal_hand(self, player: str, card_indices: list[str]) -> None:
        """Handle 'reveals his hand' — resolve and mark cards without moving them."""
        game_state = self.game_state
        for idx in card_indices:
            group_key = self.card_db[idx].group_key

            card: Card = next(other for other in game_state.hands[player] if idx in other.candidates)
            card.resolve(idx)
            game_state.mark_resolved(card, group_key)
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
                                game_state.mark_resolved(other, group_key)
                                changed = True

            # 2. Hidden singles
            for candidate_name in {name for card in group if not card.is_resolved for name in card.candidates}:
                holders = [card for card in group if candidate_name in card.candidates and not card.is_resolved]
                if len(holders) == 1:
                    holders[0].resolve(candidate_name)
                    game_state.mark_resolved(holders[0], group_key)
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
                                        game_state.mark_resolved(other, group_key)
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
