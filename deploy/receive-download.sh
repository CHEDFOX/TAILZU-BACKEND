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
#
# The build may send its version after the name ("Tailzu.dmg 0.2.2"). It is
# written beside the installer (Tailzu.dmg.version) once the file is in place,
# and the server reads it to tell every older install on that OS, in the
# window, that an update is ready (tulmi/src/experience/desktopRelease.ts).
set -euo pipefail
read -r name version extra <<< "${SSH_ORIGINAL_COMMAND:-}"
name="${name:-}"; version="${version:-}"
[ -z "${extra:-}" ] || { echo "refused: too many words" >&2; exit 2; }
if [ -n "$version" ] && ! [[ "$version" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$ ]]; then
  echo "refused: '$version' is not a version" >&2; exit 2
fi
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
# After the installer, never before: a version that names a file not yet in
# place would send people to download the old one.
if [ -n "$version" ]; then
  printf '%s\n' "$version" > "$dir/.$name.version.tmp"
  chmod 644 "$dir/.$name.version.tmp"
  mv -f "$dir/.$name.version.tmp" "$dir/$name.version"
fi
echo "published $name${version:+ $version} ($size bytes)"
