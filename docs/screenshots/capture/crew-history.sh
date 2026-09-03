#!/usr/bin/env bash
# Frame 10 — the trick history, stopped mid-trick so the in-progress separator shows.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode crew-summary --at 34 --out "$WORK/crew.html"
shoot --html "$WORK/crew.html" --out "$REPO/docs/screenshots/crew-history.png" --selector '.crew-section:nth-of-type(3)' --width 620
