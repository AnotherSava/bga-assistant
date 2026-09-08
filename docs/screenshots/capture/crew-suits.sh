#!/usr/bin/env bash
# Frame 9 — the player-suit matrix, stopped part-way so X, ! and ? are all present.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode crew-summary --at 52 --out "$WORK/crew.html"
shoot --html "$WORK/crew.html" --out "$REPO/docs/screenshots/crew-suits.png" --selector '[data-section=suits]' --width 520
