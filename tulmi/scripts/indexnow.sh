#!/usr/bin/env bash
# Tell the search engines that share IndexNow (Bing — and through it ChatGPT
# search and Copilot — Yandex, Seznam, Naver) that tailzu.space's pages have
# changed, instead of waiting for a crawl. deploy/ship.sh runs it on every
# deploy; by hand:
#
#   ./tulmi/scripts/indexnow.sh
#
# The key is public by design: it is the file tailzu.space serves at
# /c455af44ba9aea2225f72d0744ccd725.txt (tailzu-web), which is how the engines know the ping is ours.
set -eu
KEY=c455af44ba9aea2225f72d0744ccd725
SITE=https://tailzu.space
API=${API:-http://127.0.0.1:8770}
locs(){ grep -o '<loc>[^<]*</loc>' | sed -e 's/<loc>//' -e 's#</loc>##'; }
# The list comes from the backend, which writes the sitemap. Fetched through
# tailzu.space it passes Vercel's edge, which can answer a server's curl with
# something that is not the sitemap (a bot check) while browsers and crawlers
# get the real one; the engines fetch the key file themselves, not this list.
URLS=$(curl -fsS "$API/sitemap.xml" 2>/dev/null | locs || true)
[ -n "$URLS" ] || URLS=$(curl -fsS "$SITE/sitemap.xml" 2>/dev/null | locs || true)
[ -n "$URLS" ] || { echo "no sitemap at $API/sitemap.xml or $SITE/sitemap.xml"; exit 1; }
# Still worth knowing if the public copy is not the sitemap: Search Console
# reads that one.
PUB=$(curl -sS -A 'Mozilla/5.0 (compatible; Googlebot/2.1)' -o /tmp/tz-sitemap.$$ -w '%{http_code} %{content_type}' "$SITE/sitemap.xml" 2>&1 || true)
if ! grep -q '<loc>' /tmp/tz-sitemap.$$ 2>/dev/null; then
  echo "note: $SITE/sitemap.xml answered '$PUB' without the sitemap: $(head -c 120 /tmp/tz-sitemap.$$ 2>/dev/null | tr -d '\n')"
fi
rm -f /tmp/tz-sitemap.$$
BODY=$(printf '%s\n' "$URLS" | python3 -c '
import json, sys
urls = [u.strip() for u in sys.stdin if u.strip()]
print(json.dumps({"host": "tailzu.space", "key": sys.argv[1], "keyLocation": "https://tailzu.space/" + sys.argv[1] + ".txt", "urlList": urls}))
' "$KEY")
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST https://api.indexnow.org/indexnow \
  -H 'content-type: application/json; charset=utf-8' --data "$BODY")
n=$(printf '%s\n' "$URLS" | wc -l)
case "$code" in
  200|202) echo "IndexNow: $n pages sent ($code)" ;;
  *)       echo "IndexNow: refused ($code) — is https://tailzu.space/$KEY.txt live?"; exit 1 ;;
esac
