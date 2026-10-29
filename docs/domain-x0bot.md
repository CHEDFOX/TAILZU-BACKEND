# Moving to x0bot.com: the owner's checklist

For the owner, on Windows. Written 2026-10-29 from the code in all four repos
and from what the public internet answered that day. Do the steps in order:
each one needs the ones before it. Nothing here prints a secret.

| what | address | where it runs |
| --- | --- | --- |
| the site | `https://x0bot.com` (`www.x0bot.com` redirects to it) | Vercel, from the site repo |
| the API | `https://api.x0bot.com` | the VPS, `root@91.108.104.168`, code in `~/tulmi` |
| app links | `https://app.x0bot.com` (`/s/*`, the AASA, `assetlinks.json`) | the same VPS |
| mail | `support@`, `privacy@`, `legal@`, `security@`, `hello@x0bot.com` | not set up yet (step 17) |

**tailzu.space keeps working** for the apps already installed: `api.tailzu.space`
and `app.tailzu.space` are the same server under their old names (never
redirected: a POST does not survive a redirect), and the site on tailzu.space
sends its pages to x0bot.com while still proxying `/v1/*`, `/downloads/*` and
`/.well-known/*` straight. What still says tailzu.space, and why, is at the end.

What the internet answered on 2026-10-29, which these steps start from:

| name | answered |
| --- | --- |
| `x0bot.com` | DNS at Hostinger, `A 216.198.79.1` (Vercel). Answers **308 to https://www.x0bot.com/** |
| `www.x0bot.com` | `CNAME fa746f8cf44d6236.vercel-dns-017.com` (Vercel), but **no TLS certificate** for it yet |
| `api.x0bot.com`, `app.x0bot.com` | no DNS record |
| `tailzu.space` | Vercel, answers **308 to https://www.tailzu.space/** (so its AASA is behind a redirect, which Apple refuses) |
| `www.tailzu.space` | Vercel, the site (200) |
| `api.tailzu.space` | `91.108.104.168`, served by **nginx/1.24.0 (Ubuntu)** |
| `app.tailzu.space` | **no DNS record** (its links do not work today) |
| mail for `tailzu.space` | `MX 10 mx.mail.xooteq.online`, `TXT "v=spf1 a mx include:spf.mail.xooteq.online ~all"` |

---

## 1. The site on Vercel: done, so check it

The site is already on Vercel at x0bot.com. Check that it is served at the
bare address, with no redirect. In PowerShell:

```powershell
curl.exe -sI https://x0bot.com/          # want: HTTP/1.1 200 (or HTTP/2 200), not 308
curl.exe -sI https://www.x0bot.com/      # want: 308, location: https://x0bot.com/
curl.exe -sI https://x0bot.com/privacy   # 200
curl.exe -sI https://x0bot.com/terms     # 200
curl.exe -sI https://x0bot.com/download  # 200
curl.exe -s  https://x0bot.com/v1/site | Select-Object -First 1                          # JSON (the /v1/* proxy)
curl.exe -sI https://x0bot.com/.well-known/apple-app-site-association                    # 200, content-type: application/json, no redirect
```

If `x0bot.com` answers 308 (it did on 2026-10-29) or `www.x0bot.com` fails on
its certificate: Vercel, the site's project, **Settings, Domains**:

1. `x0bot.com`: **Edit**, choose **Connect to an environment: Production** (not
   "Redirect to www.x0bot.com"). Save.
2. `www.x0bot.com`: if it is not in the list, **Add** it. Then **Edit**,
   **Redirect to `x0bot.com`**, status **308**. Save. Wait for both to show
   "Valid Configuration" (the certificate comes a minute later).
3. `tailzu.space` and `www.tailzu.space`: **Edit** each, choose **Connect to an
   environment: Production**, no redirect. The site repo's `vercel.json` now
   does the redirecting itself (step 10), path by path, so `/v1/*`,
   `/downloads/*` and `/.well-known/*` stay straight on both names.

## 2. DNS records

Both domains' DNS is at Hostinger (nameservers `*.dns-parking.com`): hPanel,
**Domains**, the domain, **DNS / Nameservers**, **DNS records**.

**x0bot.com**: add

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `api` | `91.108.104.168` | 3600 |
| A | `app` | `91.108.104.168` | 3600 |

and leave as they are: `A @ 216.198.79.1` and `CNAME www fa746f8cf44d6236.vercel-dns-017.com` (Vercel).
No AAAA records.

**tailzu.space**: add (so links on `app.tailzu.space`, which installed apps
claim, open at last)

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `app` | `91.108.104.168` | 3600 |

Wait until all three answer with the VPS's address (usually minutes):

```powershell
nslookup api.x0bot.com 8.8.8.8
nslookup app.x0bot.com 8.8.8.8
nslookup app.tailzu.space 8.8.8.8
```

## 3. The VPS: the new names, and their certificate

The API is served by nginx on the VPS (it answers as nginx/1.24.0). The new
names are added to the very server block `api.tailzu.space` already has, so
they behave exactly as it does (WebSockets, upload size, timeouts). From
PowerShell:

```powershell
ssh root@91.108.104.168
```

then on the VPS:

```bash
F=$(grep -ln 'server_name api.tailzu.space;' /etc/nginx/sites-enabled/* | head -n1); echo "$F"
cp -L "$F" /root/nginx-before-x0bot.conf          # a copy to go back to
grep -n 'server_name' "$F"
sed -i --follow-symlinks 's/server_name api\.tailzu\.space;/server_name api.tailzu.space api.x0bot.com app.x0bot.com app.tailzu.space;/' "$F"
grep -n 'server_name' "$F"                          # every api.tailzu.space line now lists the four names
nginx -t && systemctl reload nginx
certbot --nginx --expand -d api.tailzu.space -d api.x0bot.com -d app.x0bot.com -d app.tailzu.space
```

`echo "$F"` must print a file (for example `/etc/nginx/sites-enabled/flow`);
if it prints nothing, run `grep -rn 'tailzu' /etc/nginx/` and edit the
`server_name` lines it shows by hand (`nano`), the same way. Certbot asks
nothing new; it widens the certificate and adds the http-to-https redirect
for the new names. To undo: `cp /root/nginx-before-x0bot.conf "$F" && nginx -t && systemctl reload nginx`.

(If `docker compose ps` in `~/tulmi` ever shows a `caddy` container instead,
the repo's `deploy/Caddyfile` already lists the four names: after step 9's
pull, `docker compose --profile https up -d --force-recreate caddy`.)

Check from PowerShell:

```powershell
curl.exe -s https://api.x0bot.com/healthz                                   # {"status":"ok",...}
curl.exe -s https://app.x0bot.com/.well-known/apple-app-site-association    # JSON with 6552H8HYA4.com.tulmi.app
curl.exe -s https://app.x0bot.com/.well-known/assetlinks.json               # JSON with com.tulmi.app and a real SHA-256
```

## 4. Supabase: where sign-ins may come back

Supabase dashboard, the project (`merzyohecmyfvlyahxaz`), **Authentication,
URL Configuration**:

- **Site URL:** `https://x0bot.com`
- **Redirect URLs**, add (keep every entry already there, including the
  tailzu.space ones and `http://127.0.0.1:8788/cb`):
  - `https://api.x0bot.com/auth/callback**` (Google on Android and mailed links: the phone and the server send this one now)
  - `https://x0bot.com/auth/callback**` (the desktop's sign-in window; it is caught before it loads, it only has to be allowed)

  Make sure these old ones are there too, for the apps already installed:
  `https://api.tailzu.space/auth/callback**` and `https://tailzu.space/auth/callback**`.

**Authentication, Email Templates**: paste `tulmi/supabase/email/confirm-signup.html`
into "Confirm signup" and `tulmi/supabase/email/magic-link.html` into "Magic
Link" (their logo now loads from `api.x0bot.com`). Nothing else changes.

## 5. Google Cloud

The project that holds Tailzu's Google sign-in, **Google Auth Platform**.

**First, is a verification review running?** (Verification Center says "in
review".) A branding change cancels it, and step 5c is one. If one is running,
skip 5b to 5d for now, and in step 9 add these two lines to the `.env` so
Connected apps keep the callback Google already knows:

```
CONNECTOR_REDIRECT_URL=https://api.tailzu.space/v1/connectors/callback
CONNECTOR_CLIENT_METADATA_URL=https://api.tailzu.space/oauth/client-metadata.json
```

Also hold step 10 (the site push turns tailzu.space's privacy page into a
redirect, which a reviewer may flag). Come back when the review ends: do 5b to
5d, delete those two lines, run `./deploy/ship.sh` again, then do step 10.

a. **Search Console** (search.google.com/search-console), with an Owner or
   Editor of the Cloud project: **Add property, Domain, `x0bot.com`**. Google
   shows a TXT value; add it in Hostinger (x0bot.com, `TXT`, name `@`) and
   press **Verify**.

b. **Branding, Authorized domains:** add `x0bot.com` (keep `tailzu.space`).
   Then: **App home page** `https://x0bot.com`, **Privacy policy**
   `https://x0bot.com/privacy`, **Terms of service** `https://x0bot.com/terms`.
   Save. Leave **Audience** alone: the publishing status does not change.

c. **Clients**, the web client for Connected apps (often "Tailzu Connected
   apps"): **Authorized redirect URIs**, add
   `https://api.x0bot.com/v1/connectors/callback` (keep the tailzu.space one).
   If **Authorized JavaScript origins** lists any tailzu.space origin, add the
   same with x0bot.com. Save.

d. The sign-in client Supabase uses: its redirect URI is Supabase's
   (`https://merzyohecmyfvlyahxaz.supabase.co/auth/v1/callback`) and does not
   change. Only if its JavaScript origins list tailzu.space, add the x0bot.com
   twins. Do not touch the iOS and Android clients.

## 6. Sign in with Apple

Nothing should need changing: the iPhone signs in natively, and the desktop
signs in through Supabase, whose return URL is Supabase's own. Check once:
developer.apple.com, **Certificates, Identifiers & Profiles, Identifiers,
Services IDs**, the one in Supabase's Apple provider, **Sign in with Apple,
Configure**. If **Domains and Subdomains** lists `tailzu.space` or
`api.tailzu.space`, add `x0bot.com` and `api.x0bot.com` beside them; leave
the **Return URLs** (Supabase's) as they are. The app's Associated Domains
capability is already on; the new build (step 12) carries the new names.

## 7. Cloudflare

a. **Turnstile** (only if a site key is set for `auth.turnstile.siteKey` in the
   control console): Cloudflare dashboard, **Turnstile**, the widget,
   **Hostname management**, add `x0bot.com` (keep `tailzu.space`). The app's
   hidden challenge page now names x0bot.com.

b. **The viewer** (`tailzu-viewer`) and **the jobs worker** (`tailzu-jobs`):
   their settings are in the repo now (`VIEWER_PARENT_ORIGINS`;
   `PUBLIC_ORIGIN=https://api.x0bot.com` and `PREVIEW_PARENT_ORIGINS`). Both
   lists hold x0bot.com and tailzu.space. Deploy both, from the backend repo
   on the machine where wrangler is signed in:

   ```powershell
   cd <backend repo>\viewer; npx wrangler deploy
   cd ..\jobs;               npx wrangler deploy
   ```

   Or by hand: Workers & Pages, the worker, **Settings, Variables and
   Secrets**: `VIEWER_PARENT_ORIGINS` =
   `https://x0bot.com,https://www.x0bot.com,https://tailzu.space,https://www.tailzu.space`
   on `tailzu-viewer`; `PUBLIC_ORIGIN` = `https://api.x0bot.com` and
   `PREVIEW_PARENT_ORIGINS` = the same list on `tailzu-jobs`; **Deploy**. The
   screenshot viewer (`tailzu-viewer-shots`, `null`) does not change.

## 8. Apps registered with a vendor for Connected apps

Only those in `CONNECTOR_OAUTH_CLIENTS` in the `.env` (skip if it is not set,
or if step 5 told you to keep the old callback):

- **GitHub** (`github`): github.com, Settings, Developer settings, OAuth Apps,
  the app: **Authorization callback URL** `https://api.x0bot.com/v1/connectors/callback`,
  **Homepage URL** `https://x0bot.com`. An OAuth App has one callback: change
  it in the same minute as step 9's deploy.
- **Asana** (`asana`): the app's OAuth settings, **Redirect URLs**, add
  `https://api.x0bot.com/v1/connectors/callback` (keep the old one).

Apps that sign in with our client document or register themselves (Notion,
Linear, Todoist, ...) need nothing: the server answers the old document at
the old address and the new one at the new. Atlassian's allow-list
(DEPLOY.md, "More MCP apps") now needs `api.x0bot.com`.

## 9. The server: settings, then deploy

```powershell
ssh root@91.108.104.168
```

See which lines name the old domain (names only, no values):

```bash
grep -n 'tailzu\.space' ~/tulmi/tulmi/.env | cut -d= -f1
grep -n 'tailzu\.space' ~/tulmi/.env 2>/dev/null | cut -d= -f1   # compose's own file, if there is one: fix any line it lists the same way
nano ~/tulmi/tulmi/.env
```

Set these (add the first three; change the others only if the grep listed
them; leave every other line alone):

```
PUBLIC_ORIGIN=https://api.x0bot.com
DEVICE_LINK_ORIGIN=https://app.x0bot.com
ARTIFACT_APP_ORIGIN=https://x0bot.com
REVENUECAT_WEB_PAYWALL_URL=https://x0bot.com/pay
MEDIA_PUBLIC_URL=https://api.x0bot.com/media
CONNECTOR_REDIRECT_URL=https://api.x0bot.com/v1/connectors/callback
CONNECTOR_CLIENT_METADATA_URL=https://api.x0bot.com/oauth/client-metadata.json
DEMO_ORIGINS=https://x0bot.com,https://www.x0bot.com,https://tailzu.space,https://www.tailzu.space
PLACES_CONTACT=https://x0bot.com
OPENROUTER_APP_URL=https://x0bot.com
```

(Step 5 may have told you to keep the two `CONNECTOR_` lines on tailzu.space
for now: then those two say tailzu.space.) Leave `REVIEW_EMAIL` and
`CODE_BOT_EMAIL` as they are: the first is the App Review account's sign-in,
the second the Code bot's commit author (change it once x0bot.com has mail,
step 17). Save (`Ctrl+O`, `Enter`, `Ctrl+X`), then deploy:

```bash
cd ~/tulmi && ./deploy/ship.sh
```

Every line should read PASS. New lines check the old address
(`api.tailzu.space/healthz`) and the app-links file on `app.x0bot.com` and on
`x0bot.com` (the latter passes once step 1 is right).

## 10. The site: push it

The site repo's `vercel.json` now proxies to `api.x0bot.com`, and redirects
every page on tailzu.space and www.tailzu.space to the same path on x0bot.com
(301), except `/v1/*`, `/downloads/*`, `/.well-known/*` and `/api/*`, which
stay straight. Push it (from SHIP.md):

```powershell
cd C:\Users\user\tailzu-web
git pull --rebase origin main
git push origin main
```

Then:

```powershell
curl.exe -sI https://www.tailzu.space/privacy                               # 301, location: https://x0bot.com/privacy
curl.exe -sI https://tailzu.space/.well-known/apple-app-site-association    # 200 (step 1.3 removed the domain redirect)
curl.exe -sI https://tailzu.space/downloads/Tailzu-Setup.exe                # 200, not a redirect (old desktops update from here)
```

## 11. Webhooks and payment pages

Both addresses answer, so these can be switched any time after step 3; do it
now so nothing is left on the old name.

- **RevenueCat**: the project, **Integrations, Webhooks**, the webhook: URL
  `https://api.x0bot.com/v1/billing/revenuecat`, same authorization value.
  **Send test event**: 200.
- **Razorpay**: Dashboard, **Account & Settings, Webhooks**, the webhook: URL
  `https://api.x0bot.com/v1/billing/razorpay`, same secret, same events.
  Under the business/website details, add `https://x0bot.com` as the website
  checkout runs on (Razorpay may review it; keep tailzu.space until it is
  approved).
- **GitHub App** (the Code bot): github.com, Settings, Developer settings,
  GitHub Apps, the app, **Edit**:
  - **Homepage URL** `https://x0bot.com`
  - **Callback URL**: **Add Callback URL** `https://api.x0bot.com/v1/code/github/callback`
    and move it to the **top** (the first one is used); keep the old one below it.
  - **Webhook URL** `https://api.x0bot.com/v1/code/github/webhook` (same secret).
  - Setup URL: stays off (OAuth during installation is on).
- **"Sign in with GitHub"** OAuth App (only if `CODE_GITHUB_OAUTH=true`):
  **Authorization callback URL** `https://api.x0bot.com/v1/code/github/signin/callback`,
  **Homepage URL** `https://x0bot.com`.

## 12. The phone apps: new store builds

The associated domains (iOS) and verified link hosts (Android) are native, so
they need a build; an over-the-air update cannot carry them. GitHub, the app
repo, **Actions, EAS Release, Run workflow** on `main`, tick **iOS** and
**Android** (SHIP.md, "Phones"). iOS goes on to TestFlight; upload the Android
`.aab` in Play Console. Ship them only after step 3 and step 1 pass: Android
checks every listed host's `assetlinks.json` when the app is installed.

## 13. The desktop: a new release

The next desktop release must be **0.4.5 or later** (raise `version` in the
desktop repo's `package.json`): the server offers builds up to 0.4.4 their
update on tailzu.space, which is all they trust, and every later build on
x0bot.com. Then **Actions, build, Run workflow**.

## 14. Store listings

- **App Store Connect**, the app: **App Information**, Privacy Policy URL
  `https://x0bot.com/privacy`; the version page: **Support URL**
  `https://x0bot.com`, **Marketing URL** `https://x0bot.com`. (Saved with the
  next version you submit.)
- **Google Play Console**, the app: **Store presence, Store settings, Store
  listing contact details**: Website `https://x0bot.com`; **Policy, App
  content, Privacy policy**: `https://x0bot.com/privacy`. Change the contact
  **email** only after step 17 (Play wants a working address).
- **Microsoft Partner Center**, the app, **Store listings** and **Properties**:
  Privacy policy URL `https://x0bot.com/privacy`, Website `https://x0bot.com`.

## 15. Search engines and ads

- **Google Search Console**: on the `x0bot.com` property, **Sitemaps**, add
  `https://x0bot.com/sitemap.xml`. On the old `tailzu.space` property,
  **Settings, Change of address**, pick `x0bot.com` (it checks the 301s from
  step 10).
- **Bing Webmaster Tools**: add `x0bot.com` (import from Search Console), then
  **Site Move** from tailzu.space. IndexNow already pings for x0bot.com on
  every deploy; its key file is in the site repo.
- **Meta Business Suite**: **Brand safety, Domains**, add and verify
  `x0bot.com` (DNS TXT at Hostinger). Events Manager, the pixel, **Settings**:
  if **Traffic permissions** has an allow list, add `x0bot.com`.
- **Google Analytics** (if the tag manager sends to GA4): **Admin, Data
  streams**, the web stream: URL `https://x0bot.com`.

## 16. Check everything

From PowerShell:

```powershell
foreach ($h in "api.x0bot.com","api.tailzu.space") { curl.exe -s -o NUL -w "$h %{http_code}`n" "https://$h/healthz" }       # 200, 200
foreach ($h in "app.x0bot.com","x0bot.com","app.tailzu.space","tailzu.space") {
  curl.exe -s -o NUL -w "$h AASA %{http_code} %{content_type}`n" "https://$h/.well-known/apple-app-site-association"           # 200 application/json, each
  curl.exe -s -o NUL -w "$h assetlinks %{http_code}`n" "https://$h/.well-known/assetlinks.json" }                              # 200, each
curl.exe -s -o NUL -w "%{http_code} %{redirect_url}`n" https://www.tailzu.space/terms                                        # 301 https://x0bot.com/terms
curl.exe -s https://api.x0bot.com/oauth/client-metadata.json                                                                  # client_id on api.x0bot.com
curl.exe -s https://api.tailzu.space/oauth/client-metadata.json                                                               # client_id on api.tailzu.space
```

Google's own check of the Android links:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.x0bot.com&relation=delegate_permission/common.handle_all_urls`.

Then by hand:

1. Phone (old build still installed): opens, signs in, dictates; Settings,
   Privacy policy opens x0bot.com/privacy.
2. Phone (new build): a link `https://app.x0bot.com/s/home` in Notes opens the
   app; a Spaces invite and the desktop's QR sign-in open the app.
3. Desktop: sign in with Google and with Apple; Settings, Updates still
   offers the update.
4. Sign in with Google on Android; a mailed sign-in link (if a template still
   sends one) comes back.
5. Connected apps: connect Google Calendar, and one MCP app, end to end.
6. RevenueCat **Send test event** and a Razorpay test webhook: both 200.
7. `ssh root@91.108.104.168 'cd ~/tulmi && CHECK=1 ./deploy/ship.sh'`: all PASS.

## 17. Later: mail for x0bot.com

The app, its pages and the policies now name `support@`, `privacy@`,
`legal@`, `security@` and `hello@x0bot.com`. **Mail to them bounces until
this is done**, so do it soon. If x0bot.com uses the same mail service as
tailzu.space, its records are the same shape (Hostinger, x0bot.com):

| Type | Name | Value |
| --- | --- | --- |
| MX | `@` | `mx.mail.xooteq.online`, priority 10 |
| TXT | `@` | `v=spf1 a mx include:spf.mail.xooteq.online ~all` |
| TXT | `<selector>._domainkey` | the DKIM key the mail service shows for x0bot.com |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@x0bot.com` |

Then create the mailboxes or aliases above (and `noreply@`, `blip@` if mail
should be sent from them), and afterwards:

- Supabase, **Authentication, SMTP settings**: if the sender is on
  tailzu.space, switch it to `noreply@x0bot.com` (after DKIM passes).
- Apple, **Services, Sign in with Apple for Email Communication**: if mail is
  sent to private-relay addresses, register `x0bot.com` and its sender
  addresses.
- Google Play contact email (step 14) and Google Auth Platform's developer
  contact: `support@x0bot.com` / `privacy@x0bot.com`.
- `CODE_BOT_EMAIL=blip@x0bot.com` is already the default; for the bot's
  avatar on GitHub, add that address to the bot's GitHub account.

---

## Every outside service that calls back into the code

| service | what it sends to us, or where it sends people | new address | step |
| --- | --- | --- | --- |
| Supabase Auth | sign-ins back to `/auth/callback` (phone, Android Google, mailed links), the desktop's window | `https://api.x0bot.com/auth/callback**`, `https://x0bot.com/auth/callback**` | 4 |
| Google (Connected apps client) | OAuth back to `/v1/connectors/callback` | `https://api.x0bot.com/v1/connectors/callback` | 5c |
| MCP apps (Notion, Linear, ...) | read our client document; OAuth back to the callback | `https://api.x0bot.com/oauth/client-metadata.json`, the callback | none (both served) |
| GitHub, Asana (pre-registered) | OAuth back to the callback | the callback | 8 |
| GitHub App (Code bot) | install/authorize back to `/v1/code/github/callback`; webhooks to `/v1/code/github/webhook` | `https://api.x0bot.com/...` | 11 |
| GitHub OAuth App (Sign in with GitHub) | back to `/v1/code/github/signin/callback` | `https://api.x0bot.com/...` | 11 |
| GitHub Actions (users' repos) | the runner's report to `$PUBLIC_ORIGIN/v1/code/runner/gh-result` | from `PUBLIC_ORIGIN` | 9 |
| RevenueCat | webhook `/v1/billing/revenuecat` | `https://api.x0bot.com/v1/billing/revenuecat` | 11 |
| Razorpay | webhook `/v1/billing/razorpay`; checkout on `/pay` | `https://api.x0bot.com/v1/billing/razorpay`, `https://x0bot.com/pay` | 11 |
| Cloudflare jobs worker | calls the VPS back at `PUBLIC_ORIGIN` | `https://api.x0bot.com` | 7b |
| Cloudflare viewer | framed only by our origins | the origin list | 7b |
| Cloudflare Turnstile | the challenge page's hostname | `x0bot.com` | 7a |
| Apple (Universal Links) | reads the AASA on each claimed host | `app.x0bot.com`, `x0bot.com` | 1, 3, 12 |
| Google (App Links) | reads `assetlinks.json` on each claimed host | `app.x0bot.com`, `x0bot.com` | 1, 3, 12 |
| Meta (pixel, Conversions API) | events for site pages | `x0bot.com` | 15 |
| Search engines, IndexNow | crawl and ping the site | `x0bot.com` | 15 |
| Desktop updater | downloads `/downloads/*` | `x0bot.com` (0.4.5 on), `tailzu.space` (up to 0.4.4) | 13 |
| The site's proxy (Vercel) | `/v1/*`, `/download(s)`, `/privacy`, `/terms`, `/.well-known/*` | `https://api.x0bot.com` | 10 |

## What still says tailzu.space, and why

- **`api.tailzu.space` and `app.tailzu.space`** stay served (step 3): installed
  phones and desktops have them built in, and links already sent name them.
- **tailzu.space and www.tailzu.space** stay on Vercel: pages redirect to
  x0bot.com; `/v1/*`, `/downloads/*`, `/.well-known/*` stay straight.
- **The phone app** claims both domains' links, and accepts both as its API.
- **The desktop updater** trusts both; builds up to 0.4.4 are offered their
  update on tailzu.space.
- **The server** accepts both in its allow-lists (`DEMO_ORIGINS`, the Meta
  event's page, the pay-page link), answers the connectors' client document
  under the old name too, and Supabase keeps both callbacks.
- **The Cloudflare workers' origin lists** hold both.

When the old builds are gone (no phone or desktop calls `api.tailzu.space`
for a few months; nginx's access log shows it), remove the tailzu.space
names from these lists in one change.
