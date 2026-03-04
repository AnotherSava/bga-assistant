"""Process raw BGA notification packets into a structured game log.

Reads the raw JSON produced by fetch_full_history.js (packets + player names)
and writes structured game_log.json consumed by game_log_processor.py.

CLI: python -m bga_tracker.innovation.process_log <input_path> <output_path>
"""

import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ICON_MAP = {"1": "crown", "2": "leaf", "3": "lightbulb", "4": "castle", "5": "factory", "6": "clock"}
SET_MAP = {"0": "base", "2": "cities"}


@dataclass
class TransferEntry:
    move: int
    card_set: str
    source: str
    dest: str
    card_name: str | None = None
    card_age: int | None = None
    source_owner: str | None = None
    dest_owner: str | None = None
    meld_keyword: bool = False
    bottom_to: bool = False


def expand_template(template: str, args: dict) -> str:
    """Resolve ``${key}`` placeholders in a BGA log template.

    Dict values are recursive sub-templates (with ``log`` + ``args`` keys),
    expanded and stripped of HTML.
    """
    def replacer(match: re.Match) -> str:
        val = args.get(match.group(1), "")
        if isinstance(val, dict):
            return re.sub(r"<[^>]+>", "", expand_template(val["log"], val["args"])).strip()
        return str(val)

    return re.sub(r"\$\{([^}]+)\}", replacer, template)


def clean_html(msg: str) -> str:
    """Convert BGA HTML log markup to plain text.

    Icon spans become ``[name]``, age spans become ``[N]``, all other HTML is
    stripped, and whitespace is collapsed.
    """
    msg = re.sub(r'<span[^>]*icon_(\d)[^>]*></span>', lambda m: "[" + ICON_MAP.get(m.group(1), "icon" + m.group(1)) + "]", msg)
    msg = re.sub(r'<span[^>]*age[^>]*>(\d+)</span>', r'[\1]', msg)
    msg = re.sub(r'<[^>]+>', '', msg)
    return re.sub(r'\s+', ' ', msg).strip()


def normalize_hyphens(text: str) -> str:
    """Replace U+2011 (non-breaking hyphen) with ASCII hyphen."""
    return text.replace("\u2011", "-")


def process_raw_log(raw_data: dict) -> dict:
    """Transform raw BGA packets into structured game log entries.

    Parameters
    ----------
    raw_data:
        Dict with ``players`` (pid→name map) and ``packets`` (list of BGA
        notification packets from ``window.__full_history.data``).

    Returns
    -------
    dict
        ``{players: {pid: name, ...}, log: [entry, ...]}`` where each entry is
        either a transfer (structured fields) or a log message (plain text).
    """
    player_names: dict[str, str] = raw_data.get("players", {})
    packets: list[dict] = [packet for packet in raw_data.get("packets", []) if packet["move_id"] is not None]
    log: list[dict] = []

    gamedatas = raw_data.get("gamedatas") or {}
    gd_hand = gamedatas.get("my_hand", [])
    gd_cards = gamedatas.get("cards", {})
    my_hand: list[str] = []
    for card in gd_hand:
        info = gd_cards.get(str(card["id"]), {})
        name = info.get("name")
        if name:
            my_hand.append(normalize_hyphens(name))

    # Pass 1: collect player-view transferedCard args, grouped by move_id.
    # move_ids are sequential integers — use a list indexed by move_id.
    # Each move can span multiple packets (player-view + spectator-view).
    max_move = max((int(packet["move_id"]) for packet in packets), default=0)
    player_transfer_iters: list[iter] = [iter(())] * (max_move + 1)
    for packet in packets:
        transfers = [notif["args"] for notif in packet["data"] if notif["type"] == "transferedCard"]
        if transfers:
            player_transfer_iters[int(packet["move_id"])] = iter(transfers)

    # Pass 2: iterate spectator notifications (the canonical ordering).

    for packet in packets:
        move_id = int(packet["move_id"])

        for notif in packet["data"]:
            notif_type = notif["type"]

            if notif_type == "transferedCard_spectator":
                player_args = next(player_transfer_iters[move_id], None)
                if not player_args:
                    continue

                entry = TransferEntry(
                    move=move_id,
                    card_set=SET_MAP[notif["args"]["type"]],
                    source=player_args["location_from"],
                    dest=player_args["location_to"],
                    card_name=normalize_hyphens(player_args["name"]) if player_args.get("name") else None,
                    card_age=int(player_args["age"]) if player_args["age"] is not None else None,
                    source_owner=player_names.get(player_args["owner_from"]),
                    dest_owner=player_names.get(player_args["owner_to"]),
                    meld_keyword=bool(player_args.get("meld_keyword")),
                    bottom_to=bool(player_args.get("bottom_to")),
                )
                log.append({"type": "transfer", **asdict(entry)})
                continue

            if notif_type in ("log_spectator", "logWithCardTooltips_spectator"):
                args = notif["args"]
                log_template = args["log"]
                if log_template == "<!--empty-->":
                    continue
                log_msg = clean_html(expand_template(log_template, args))
                log.append({
                    "move": move_id,
                    "type": notif_type.replace("_spectator", ""),
                    "msg": log_msg,
                })

    return {"players": player_names, "my_hand": my_hand, "log": log}


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python -m bga_tracker.innovation.process_log <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    raw_data = json.loads(input_path.read_text(encoding="utf-8"))
    result = process_raw_log(raw_data)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(result['log'])} log entries to {output_path}")


if __name__ == "__main__":
    main()
