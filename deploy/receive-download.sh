#!/usr/bin/env bash
# THE ONLY THING THE BUILD'S KEY CAN DO.
#
# The desktop-build workflow (frontend repo) publishes each installer straight
# to this server:  ssh root@server Tailzu.dmg < Tailzu.dmg
# Its key is pinned in ~/.ssh/authorized_keys to this script
# (restrict,command="/root/tulmi/deploy/receive-download.sh"), so it cannot
# open a shell, forward anything, or write anywhere else: stdin is one
# installer, the requested command is its name, and the name must be one of
# the three the /download page serves. It lands under a temporary name and
# is renamed into place, so a half-sent file is never what someone downloads.
set -euo pipefail
name="${SSH_ORIGINAL_COMMAND:-}"
case "$name" in
  Tailzu-Setup.exe|Tailzu.dmg|Tailzu.AppImage) ;;
  *) echo "refused: '$name' is not an installer name" >&2; exit 2 ;;
esac
dir="$(dirname "$(readlink -f "$0")")/../downloads"
mkdir -p "$dir"
tmp="$(mktemp "$dir/.incoming.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
head -c 2000000000 > "$tmp"
size=$(stat -c %s "$tmp")
[ "$size" -ge 5000000 ] || { echo "refused: $name is only $size bytes" >&2; exit 3; }
chmod 644 "$tmp"
mv -f "$tmp" "$dir/$name"
trap - EXIT
echo "published $name ($size bytes)"
