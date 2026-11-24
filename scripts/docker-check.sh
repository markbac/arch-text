#!/usr/bin/env bash
# Checks a built arch-text image the way CI and docs repositories use it: offline, as an
# arbitrary user, rendering every example to SVG and PNG, then checking a second run finds
# nothing to change. Usage: scripts/docker-check.sh [image] (default arch-text:dev).
set -euo pipefail
image=${1:-arch-text:dev}
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -r "$here/examples/." "$work/"
run() { docker run --rm --network none --user "$(id -u):$(id -g)" -v "$work:/work" "$image" "$@"; }

echo "== version"
run --version

echo "== render every example to SVG, PNG and .excalidraw, offline"
run render "*.archt" -f svg,png,excalidraw
count=$(find "$work" -maxdepth 1 \( -name '*.svg' -o -name '*.png' -o -name '*.excalidraw' \) | wc -l)
inputs=$(find "$work" -maxdepth 1 -name '*.archt' | wc -l)
test "$count" -eq $((inputs * 3)) || { echo "expected $((inputs * 3)) outputs, found $count"; exit 1; }
echo "$count outputs for $inputs inputs"

echo "== a second run changes nothing"
run render "*.archt" -f svg,png,excalidraw --check

echo "== the outputs belong to the calling user"
owner=$(stat -c %u "$work/meter.svg")
test "$owner" -eq "$(id -u)" || { echo "meter.svg is owned by $owner, not $(id -u)"; exit 1; }

echo "== a stale output is caught"
echo "system Extra" >> "$work/meter.archt"
if run render meter.archt --check; then echo "--check passed on a stale output"; exit 1; fi

echo "image $image: all checks passed"
