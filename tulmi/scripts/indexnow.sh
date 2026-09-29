#!/usr/bin/env bash
# Tell the search engines that share IndexNow (Bing — and through it ChatGPT
# search and Copilot — Yandex, Seznam, Naver) that tailzu.space's pages have
# changed, instead of waiting for a crawl. Run after a deploy that changes
# what a page says.
#
#   ./tulmi/scripts/indexnow.sh
#
# The key is public by design: it is the file tailzu.space serves at
# /c455af44ba9aea2225f72d0744ccd725.txt (tailzu-web), which is how the engines know the ping is ours.
set -eu
KEY=c455af44ba9aea2225f72d0744ccd725
SITE=https://tailzu.space
URLS=$(curl -fsS "$SITE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed -e 's/<loc>//' -e 's#</loc>##')
[ -n "$URLS" ] || { echo "sitemap is empty or unreachable"; exit 1; }
BODY=$(printf '%s\n' "$URLS" | python3 -c '
import json, sys
urls = [u.strip() for u in sys.stdin if u.strip()]
print(json.dumps({"host": "tailzu.space", "key": sys.argv[1], "keyLocation": "https://tailzu.space/" + sys.argv[1] + ".txt", "urlList": urls}))
' "$KEY")
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST https://api.indexnow.org/indexnow \
  -H 'content-type: application/json; charset=utf-8' --data "$BODY")
echo "IndexNow: $code for $(printf '%s\n' "$URLS" | wc -l) pages (200 or 202 is accepted)"
