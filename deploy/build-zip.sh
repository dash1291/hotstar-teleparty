#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
host=$(awk 'NR == 1 { print $1 }' deploy/Caddyfile)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive --format=tar HEAD extension | tar -x -C "$tmp"
printf "const HOTSTAR_PARTY_DEFAULTS = { server: 'wss://%s' };\n" "$host" > "$tmp/extension/defaults.js"
mkdir -p dist
rm -f dist/extension.zip
out="$PWD/dist/extension.zip"
(cd "$tmp" && python3 -m zipfile -c "$out" extension)
echo "wrote dist/extension.zip with relay wss://$host"
