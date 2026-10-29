# Universal Links / App Links — hosted JSON

The backend serves both files itself (`tulmi/src/server.ts`, any Host header),
so every host that reaches it answers them, straight, with no redirect:

| host | how it reaches the backend |
| --- | --- |
| `app.x0bot.com`, `app.tailzu.space` | the VPS's proxy (nginx, or `deploy/Caddyfile`) |
| `x0bot.com`, `tailzu.space` | the site on Vercel: `vercel.json` rewrites `/.well-known/*` to the API |

These two files are the same JSON, kept as a reference:

- `apple-app-site-association` — iOS Universal Links. **No `.json` extension.**
  Served with `Content-Type: application/json`.
- `assetlinks.json` — Android App Links. The server fills the fingerprint from
  `ANDROID_SIGNING_SHA256` in `tulmi/.env`.

The phone app claims all four hosts (`associatedDomains` and the Android
`intentFilters` in `app/app.config.ts`); tailzu.space stays for the builds
already installed (docs/domain-x0bot.md).

## Verification

Each must be `200` and JSON on the first answer — Apple and Google follow no
redirect for these files:

```bash
for h in app.x0bot.com x0bot.com app.tailzu.space tailzu.space; do
  curl -s -o /dev/null -w "$h %{http_code} %{content_type}\n" "https://$h/.well-known/apple-app-site-association"
  curl -s -o /dev/null -w "$h %{http_code} %{content_type}\n" "https://$h/.well-known/assetlinks.json"
done
```

Apple validates automatically on next app install (its CDN:
`https://app-site-association.cdn-apple.com/a/v1/app.x0bot.com`). Google validates via
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.x0bot.com&relation=delegate_permission/common.handle_all_urls`.

## Android — filling the SHA-256

The placeholder in `assetlinks.json` needs the SHA-256 fingerprint of the
**production signing certificate** you use to sign the Play Store bundle.
For EAS builds, get it from Google Play Console:

    Setup → App signing → App signing key certificate → SHA-256 certificate fingerprint

Copy that colon-separated hex (e.g. `1A:2B:3C:…`) into
`sha256_cert_fingerprints[0]`. If you have BOTH an upload key and an app-
signing key (Play App Signing), list BOTH fingerprints as separate array
entries.

## Tap flow after this ships

- `https://app.x0bot.com/s/home` on iOS/Android → opens the app → SduiApp
  routes to screen `"home"` via `deeplinks/router.ts`.
- `tulmi://screen/home` (custom scheme) → same routing path.
- Notification tap with `data.screenId = "history"` → same routing path.

No app build needed to add new deep-link targets; the backend can generate any
`/s/<newScreenId>` URL and it will work as long as `<newScreenId>` is a valid
SDUI screen id.
