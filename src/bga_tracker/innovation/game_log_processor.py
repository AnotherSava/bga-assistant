"""GameLogProcessor: structured log processing for Innovation game state."""

import json
import re

from bga_tracker.innovation.card import CardDatabase, CardSet, AgeSet
from bga_tracker.innovation.game_state import GameState, Action
from bga_tracker.innovation.game_state_tracker import GameStateTracker


class GameLogProcessor:
    """Processes an Innovation game log and builds a GameState."""

    def __init__(self, card_db: CardDatabase, players: list[str], perspective: str):
        self.card_db = card_db
        self.players = players
        self.perspective = perspective
        self.game_state = GameState(players)
        self.tracker = GameStateTracker(self.game_state, card_db, players, perspective)
        self.tracker.init_game(len(players))
        self._player_pattern = "|".join(re.escape(player) for player in players)

    def process_log(self, game_log_path: str) -> "GameState":
        """Read game log JSON, process all entries, return GameState."""
        with open(game_log_path) as f:
            log_data = json.load(f)

        my_hand_names = log_data.get("my_hand", [])
        if my_hand_names:
            self.tracker.resolve_hand(self.perspective, my_hand_names)

        for entry in log_data["log"]:
            self._process_entry(entry)

        return self.game_state

    def _process_entry(self, entry: dict) -> None:
        """Process a single log entry."""
        match entry["type"]:
            case "logWithCardTooltips":
                if m := re.match(rf"^({self._player_pattern}) reveals his hand: (.+)\.$", entry["msg"]):
                    card_names = [part[part.index(" ") + 1:].lower() for part in m.group(2).split(", ")]
                    self.tracker.reveal_hand(m.group(1), card_names)

            case "log":
                if re.match(r"The revealed cards with a \[(\w+)\] will be kept", entry["msg"]):
                    self.tracker.confirm_meld_filter()

            case "transfer" if entry.get("dest") not in ("achievements", "claimed"):
                self._process_move_action(entry)

    def _process_move_action(self, entry: dict) -> None:
        card_name = entry.get("card_name")
        card_index = card_name.lower() if card_name else None
        group_key = AgeSet(entry["card_age"], CardSet.from_label(entry["card_set"])) if not card_index else None

        source = entry["source"]
        dest = entry["dest"]
        source_player = entry.get("source_owner") if source != "deck" else None
        dest_player = entry.get("dest_owner") if dest != "deck" else None

        action = Action(source=source, dest=dest, card_index=card_index, group_key=group_key, source_player=source_player, dest_player=dest_player, meld_keyword=bool(entry.get("meld_keyword")),
                        bottom_to=bool(entry.get("bottom_to")))

        self.tracker.move(action)
