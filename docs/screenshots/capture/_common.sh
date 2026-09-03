# Shared setup for every capture script.
#
# Each script renders its subject from a committed fixture and shoots it headless, so a capture
# needs no BGA session and reruns identically on any machine.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
render() { node --import tsx/esm "$REPO/docs/screenshots/capture/lib/render.ts" "$@"; }
shoot() { python "$REPO/docs/screenshots/capture/lib/shoot.py" "$@"; }
