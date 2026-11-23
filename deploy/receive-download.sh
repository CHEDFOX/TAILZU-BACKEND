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
#
# The installer's SHA-512 is written beside it too (Tailzu.dmg.sha512), before
# the version: a build that updates itself checks what it downloaded against
# it, so an announced version always has a checksum to be held to.
#
# THE DESKTOP'S UI BUNDLE comes the same way ("ui <v> <minApp>", the bundle on stdin; desktop
# scripts/ui-bundle.js, .github/workflows/ui.yml): it lands as downloads/ui/<v>.json, and only then is
# downloads/ui/latest.json written with the SHA-256 of the bytes received, which the bootstrap hands every
# desktop to check the bundle against (tulmi/src/experience/desktopUiBundle.ts). The last ten are kept.
set -euo pipefail
read -r name version extra more <<< "${SSH_ORIGINAL_COMMAND:-}"
if [ "${name:-}" = "ui" ]; then
  v="${version:-}"; minapp="${extra:-}"
  [ -z "${more:-}" ] || { echo "refused: too many words" >&2; exit 2; }
  [[ "$v" =~ ^[0-9]{14}-[0-9a-f]{7,40}$ ]] || { echo "refused: '$v' is not a UI bundle version" >&2; exit 2; }
  [[ "$minapp" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$ ]] || { echo "refused: '$minapp' is not a version" >&2; exit 2; }
  dir="$(dirname "$(readlink -f "$0")")/../downloads/ui"
  mkdir -p "$dir"
  tmp="$(mktemp "$dir/.incoming.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  head -c 16000001 > "$tmp"
  size=$(stat -c %s "$tmp")
  [ "$size" -le 16000000 ] || { echo "refused: the UI bundle is over 16 MB" >&2; exit 3; }
  [ "$size" -ge 1000 ] || { echo "refused: the UI bundle is only $size bytes" >&2; exit 3; }
  [ "$(head -c 1 "$tmp")" = "{" ] || { echo "refused: the UI bundle is not JSON" >&2; exit 3; }
  chmod 644 "$tmp"
  sha="$(sha256sum "$tmp" | cut -d' ' -f1)"
  exec 9>"$dir/.publish.lock"
  flock 9
  mv -f "$tmp" "$dir/$v.json"
  trap - EXIT
  printf '{"format":1,"v":"%s","sha256":"%s","size":%s,"minApp":"%s"}\n' "$v" "$sha" "$size" "$minapp" > "$dir/.latest.json.tmp"
  chmod 644 "$dir/.latest.json.tmp"
  mv -f "$dir/.latest.json.tmp" "$dir/latest.json"
  ls -1t "$dir"/[0-9]*.json 2>/dev/null | tail -n +11 | xargs -r rm -f
  echo "published ui $v ($size bytes, sha256 $sha, minApp $minapp)"
  exit 0
fi
[ -z "${more:-}" ] || { echo "refused: too many words" >&2; exit 2; }
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
# One byte past the cap, so an oversized upload is REFUSED: `head -c` at the
# cap alone cut it short in silence, and the truncated installer went out with
# a checksum that matched it.
head -c 2000000001 > "$tmp"
size=$(stat -c %s "$tmp")
[ "$size" -le 2000000000 ] || { echo "refused: $name is over 2 GB" >&2; exit 3; }
[ "$size" -ge 5000000 ] || { echo "refused: $name is only $size bytes" >&2; exit 3; }
chmod 644 "$tmp"
# The checksum is of the bytes being published, taken before they are, and
# the rename, checksum and version go out under one lock: two uploads of one
# name at once could otherwise leave one build's checksum beside the other's
# installer, and the updater would refuse it.
sha="$(sha512sum "$tmp" | cut -d' ' -f1)"
exec 9>"$dir/.publish.lock"
flock 9
mv -f "$tmp" "$dir/$name"
trap - EXIT
printf '%s\n' "$sha" > "$dir/.$name.sha512.tmp"
chmod 644 "$dir/.$name.sha512.tmp"
mv -f "$dir/.$name.sha512.tmp" "$dir/$name.sha512"
# After the installer and its checksum, never before: a version that names a
# file not yet in place would send people to download the old one.
if [ -n "$version" ]; then
  printf '%s\n' "$version" > "$dir/.$name.version.tmp"
  chmod 644 "$dir/.$name.version.tmp"
  mv -f "$dir/.$name.version.tmp" "$dir/$name.version"
fi
echo "published $name${version:+ $version} ($size bytes)"
