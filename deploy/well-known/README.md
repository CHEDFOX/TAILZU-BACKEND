# Universal Links / App Links — hosted JSON

Put these two files behind `https://tailzu.space/.well-known/` (exact path required):

- `apple-app-site-association` — iOS Universal Links. **No `.json` extension.**
  Must be served over HTTPS with `Content-Type: application/json`.
- `assetlinks.json` — Android App Links.

## Nginx snippet

Add to the `tailzu.space` server block, above any catch-all `location /`:

```nginx
location = /.well-known/apple-app-site-association {
    default_type application/json;
    alias /var/www/tailzu.space/well-known/apple-app-site-association;
}
location = /.well-known/assetlinks.json {
    default_type application/json;
    alias /var/www/tailzu.space/well-known/assetlinks.json;
}
```

Then upload the files:

```bash
scp deploy/well-known/apple-app-site-association \
    deploy/well-known/assetlinks.json \
    root@YOUR_VPS:/var/www/tailzu.space/well-known/
nginx -t && systemctl reload nginx
```

## Verification

```bash
# iOS
curl -sI https://tailzu.space/.well-known/apple-app-site-association | head
curl -s  https://tailzu.space/.well-known/apple-app-site-association | jq .

# Android
curl -sI https://tailzu.space/.well-known/assetlinks.json | head
curl -s  https://tailzu.space/.well-known/assetlinks.json | jq .
```

Apple validates automatically on next app install. Google validates via
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://tailzu.space&relation=delegate_permission/common.handle_all_urls`.

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

- `https://tailzu.space/s/home` on iOS/Android → opens the app → SduiApp
  routes to screen `"home"` via `deeplinks/router.ts`.
- `tulmi://screen/home` (custom scheme) → same routing path.
- Notification tap with `data.screenId = "history"` → same routing path.

No app build needed to add new deep-link targets; the backend can generate any
`/s/<newScreenId>` URL and it will work as long as `<newScreenId>` is a valid
SDUI screen id.
