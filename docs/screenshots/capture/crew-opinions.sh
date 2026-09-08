#!/usr/bin/env bash
# The task opinions grid and the legend under it. Deliberately unnumbered: the neighbouring scripts
# name a frame position that the manifest has since moved twice, so this one names its subject only.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
render --mode crew-summary --at 52 --out "$WORK/crew.html"
shoot --html "$WORK/crew.html" --out "$REPO/docs/screenshots/crew-opinions.png" --selector '[data-section=opinions]' --width 560
