#!/usr/bin/env bash
# Frame 6 — the deck section, Base, with the full five-option set toggle.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode innovation-summary --out "$WORK/summary.html"
shoot --html "$WORK/summary.html" --out "$REPO/docs/screenshots/innovation-deck.png" --selector '.section[data-section="deck"]' --width 1060
