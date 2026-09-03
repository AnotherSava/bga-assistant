#!/usr/bin/env bash
# Frame 4 — the turn history, newest first, ending on the compound meld -> promote -> dogma turn
# that the frame exists to show (turn 53 of the fixture, so the window is turns 52-54).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode innovation-history --turns 55 --out "$WORK/history.html"
shoot --html "$WORK/history.html" --out "$REPO/docs/screenshots/innovation-history.png" --selector "#turn-history" --width 700
