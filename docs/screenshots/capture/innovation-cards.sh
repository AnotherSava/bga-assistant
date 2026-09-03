#!/usr/bin/env bash
# Frame 5 — the card list, Base / All / Wide, with the full five-option set toggle.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode innovation-summary --out "$WORK/summary.html"
shoot --html "$WORK/summary.html" --out "$REPO/docs/screenshots/innovation-cards.png" --selector '.section[data-section="cards"]' --width 1060
