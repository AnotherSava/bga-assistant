#!/usr/bin/env bash
# Frame 2 — the built-in help page, Innovation tab, sections at their defaults.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode help --out "$WORK/help.html"
shoot --html "$WORK/help.html" --out "$REPO/docs/screenshots/help.png" --width 873 --height 400
