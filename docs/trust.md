# Abuse and fraud prevention: what the server's half does

Fake accounts, free-plan abuse, automated traffic and stolen sign-ins, and nothing else. While `FREE_FOR_ALL` is on every
account gets Lite's five stretches — about $35 a month of real model spend — accounts are made on the phone straight at
Supabase Auth, and **deleting an account resets the free plan**. Before this, nothing anywhere looked at the device, the
network or the app's own realness.

This is the server's half, which needs no app update. The phone's half (Apple's App Attest and DeviceCheck, Google's Play
Integrity) is in build 8.9.1 and dark until `TRUST_ATTEST` is moved. The whole design is in the perms2 SPEC; this file is so
the next person to touch `src/trust/**` can see what holds it together.

## It is not a fingerprint, and the word is not used

Apple's licence agreement forbids "deriving data from a device for the purpose of uniquely identifying it", and names **the
user's network connection** among its examples. There is no fraud exception. Google's Play Integrity terms forbid using it to
"fingerprint or track individual users or devices". So:

- A network is described by its **kind** (home, mobile, data centre, VPN, Tor, iCloud Private Relay) and by **counts**.
- No stable per-device or per-person key is ever built from network or device traits.
- The per-device answer ("this phone already started a free account") comes only from the tools Apple and Google built for
  it: DeviceCheck's two bits, App Attest's key count, Play Integrity's verdicts and device recall.
- In code, in docs and in review notes this is called **abuse and fraud prevention signals**. Never "fingerprint".

## The ten rules this code keeps

1. **Signals, never an identity.** Kind and counts. On iPhone, per-device signals come only from Apple's own tools.
2. **Push tokens are not a device signal** on either platform. The existing "token moved accounts" drop (`push/tokens.ts`)
   stays exactly as it was.
3. **No raw address is stored, and no place is ever worked out from one.** No country, no city, no region: the lists'
   country columns are dropped as they are read (`lists.ts parseRelayCsv`, `parseAsnTsv`), which is why Location stays off
   the store labels.
4. **Nothing reaches ads, analytics or Meta.** `tests/trust-scan.test.ts` fails if `ads/meta.ts`, or anything it imports,
   imports `trust/*`.
5. **Never acted on:** anyone with a payment, the review account (`REVIEW_EMAIL`), `QUOTA_EXEMPT_USER_IDS`, the desktop's
   `static-*` ids, and requests carrying `x-vercel-forwarded-for` (not collected at all: it is forgeable on a direct call).
   Apple's own network (AS714, 17.0.0.0/8) scores nothing either way.
6. **A missing answer is never a penalty.** Simulators, old phones, phones without Google Play services, custom ROMs and our
   own internal builds are "no signal". What scores is a build that **claimed** it can attest and then failed.
7. **The trust code reads almost nothing.** From a request: the address (only as a keyed hash), the user agent, the coarse
   `X-Tz-Tls-*` hints and the `X-App-*` headers. From the bootstrap: `platform`, `bundle`, `appVersion` and whether
   `capabilities` is present. Not the permission states, the keyboard state, the scheme probes, the locale, the time zone or
   the screen — and **nothing about the phone's own network** (no NetInfo, Wi-Fi or carrier name, SSID, local address or
   interface list). The app reads some of those for its own screens (`src/sdui/device/facts.ts`); neither the phone's trust
   code nor this folder may. A scan test holds the list.
8. **Everything starts log-only.** `TRUST=off` is the default; `shadow` writes rows and scores and logs the action it would
   have taken; `on` takes only the actions whose own switch is true, and all three are false in the defaults.
9. **Counted, never joined.** A key's count feeds the scored account's own score and nothing else. No query, admin route or
   log line lists the other accounts behind a network key, an install key or an email hash; no export returns a list of user
   ids; an action on one account never spreads to the accounts that shared a key with it. There is no "ban the cluster".
10. **Calls to Apple and Google carry only what their API needs**: the device or integrity token, our challenge hash, our key
    id and team or package. Never a user id, an email, an address or a score.

And the one that is not negotiable: **no account is ever closed on this.** The strongest action is to hold free use.

## The files

| file | what it is |
|---|---|
| `trust/defaults.ts` | every weight, threshold, action switch, ramp and list address. The control plane's **"trust" surface** edits it live, so a weight or turning an action on is a console change, never a deploy. No imports, so the console can preview it |
| `trust/netKey.ts` | the keyed hash (`HMAC-SHA256(TRUST_HASH_KEY, "n1\|" + address)`, 16 bytes), and the address maths: IPv4 whole, IPv6 /64, coarse /24 and /48 for bursts. Also the email and install keys, and the 12 characters a log line may carry |
| `trust/lists.ts` | the public lists, downloaded to `TRUST_LISTS_DIR` daily, last good copy kept: iptoasn's ASN ranges, AWS/GCP/Oracle/Cloudflare prefixes, Tor's exit list, iCloud Private Relay's egress. Sorted ranges, binary search; the ASN table is in typed arrays because it has about half a million rows |
| `trust/netClass.ts` | the kind of network, and the three short ASN lists kept in the repo (India's carriers, data centres not in a prefix file, a handful of VPN exits). **The relay is checked first**, because its egress runs inside Akamai's, Cloudflare's and Fastly's ranges |
| `trust/email.ts` | the normalised address (lower case, no `+tag`, no dots on Gmail), its keyed hash, and the throwaway-domain list (a short one in the repo, plus `disposable.txt` on the volume if you drop one there) |
| `trust/signals.ts` | the request's own shape (a script-shaped user agent, claims that do not fit each other), the write-once-a-day gate, the session-moved check, and `collect()` |
| `trust/store.ts` | the five tables (migration `0093_trust_signals.sql`), a memory twin, and `tombstoneAccount()` |
| `trust/score.ts` | pure: reasons in, one number and an action out |
| `trust/actions.ts` | the mode, the surface, who is never acted on, the hold and slow registries, `look()` for one request and `lookAtLaunch()` for a bootstrap |
| `trust/sweeper.ts` | the 30 days, every six hours, whatever the mode: the rows, Apple's and Google's answers on a score row (each stamped with when it was given), and blanking `device_links`' address and user agent |
| `trust/ask.ts` | when a phone is asked to attest, and the one-use five-minute challenge |
| `trust/apple/**` | App Attest (with a small CBOR/DER reader; Apple's root is a **string** in `appleRoot.ts`, fingerprint pinned, because the image carries only compiled JavaScript) and DeviceCheck |
| `trust/google/playIntegrity.ts` | the standard Play Integrity request, decoded server side and checked |
| `routes/trust/trust.ts` | the five routes the phone posts to. Every one answers 204: nothing comes back to act on |
| `routes/admin/trust.ts` | `GET /v1/admin/trust/:userId` (counts only) and `POST .../clear` |

## Where it is wired in

- `http/hooks.ts` — an `onRequest` hook: a signed-in app request, once an hour per account, writes **the row and nothing
  else**. No action (rule 5: it knows the account id and nothing else), and no score either — it cannot see the email, a
  tombstone, the install, the account's age or Apple's and Google's answers, so a score written from it would overwrite
  the launch's. The bootstrap is skipped outright: it does the whole pass itself. Fires and forgets.
- `routes/app/appScreens.ts` — the bootstrap. The one request that has already read the entitlement and the address, so this
  is where an action is decided, where a `trust` ask is added to the answer, and where the `trust.installId` flag is sent
  (the app sends its install number only while that flag is true, and it is false in the defaults).
- `guard/limiter.ts` and `http/plugins.ts` — a slowed account takes the free plan's single slot and a quarter of the rate
  limit. Both read an **installed** check (`installSlowCheck`), so neither file imports any of this.
- `you/usage.ts` and `usage/allowance.ts` — a held account gets the free month's one allowance instead of Lite's five
  stretches, and earns no words. Also an installed check (`installHoldCheck`). The refusal is the existing 429
  `quota_exceeded` the apps already show, so there is no new screen and no app update.
- `routes/account/account.ts` — the tombstones, written inside `eraseAccount` just before the auth record goes, because
  both ways out go through it: the seven-day sweep (`you/deletion.ts`) and the immediate `DELETE /v1/account` the phone's
  delete screen calls. Nothing is written while `TRUST=off`.
- `observability.ts` — the request log line carries the keyed network hash instead of the address.
- `server.ts` — `trustProxy` is a list of **addresses** (`TRUST_PROXY_CIDRS`), not a hop count. The sweeper starts here
  **whatever the mode is**, because it only deletes and the 30 days have to hold after a kill switch too; only the list
  downloads are behind the mode. The authed tiers' rate limit `max` is the slow-aware function from `http/plugins.ts`: a
  plain number on a route wins over the plugin's own, so the quarter-rate would never apply.

## The score

Additive and explainable. Up: Tor +40, data centre +25, VPN +15, the 3rd **new** account on one non-mobile network +10 and
the 5th +25 (new means the account was under a week old when it was seen there: `trust_net_seen.new_acct`, so a shared
home, an office or a mobile operator is not scored for being busy, and the honest new sign-up in that house is not scored
for its neighbours), a throwaway email +30, a tombstone match +40, a script-shaped request +20, claims that do not fit +20, an install
with 3+ accounts +25 and 5+ +40, a session seen from a data centre and a home line within the hour +25; and from 8.9.1,
DeviceCheck bit0 on a new account +30, bit1 +60, more than 3 App Attest keys on one device +20 (Apple's own per-device metric, from the attestation receipt — not our
count of this account's keys, which is a different number, so nothing is scored for it until the receipt is read), Play Integrity
`UNRECOGNIZED_VERSION` on a build that claimed it +30, no device-integrity label +15, an attestation claimed and failed +40.
Down: Apple or Google sign-in −10, a settled account with real use −20, a passed attestation −15. An account under 24 hours
old has its score multiplied by 1.5.

Then: 30+ is logged, 50+ slowed, 70+ holds free use (only accounts under 7 days old with no payment), 85+ would ask for
Apple or Google sign-in — designed, and off until that screen exists. The bands are a **ladder**: a score that reaches a
band whose switch is off falls back to the strongest band below it that is on, so an 85+ account is held or slowed rather
than left alone while `ask` has no screen.

## What is kept, and for how long

| what | how long | how |
|---|---|---|
| `trust_net_seen`, `trust_device_seen`, `trust_tombstones` | 30 days | the sweeper, by day or by last-seen |
| `trust_attest_keys` | 30 days after the key's last use | the sweeper |
| **Apple's and Google's answers** (`trust_scores.verdicts`) | 30 days from each answer | each is stamped in `verdicts.at`; `verdicts_at` holds the oldest, so the sweeper finds the rows that are due without reading every account's. `updated_at` cannot be used: every launch refreshes it |
| the score row itself (number, reasons, action) | while the account exists | recomputed on every launch; it goes with the account |

## DeviceCheck's two bits, and clearing a second-hand phone

bit0 means "a free account was already started on this phone"; bit1 means "abuse confirmed" and is **only** ever set by an
admin. Apple keeps them on the device, beyond any account of ours, so two rules follow:

- **We never score an account for a bit we set for it.** Apple hands back whatever we last wrote, so the account whose own
  pass set bit0 would read it on its next launch and flag itself. The write is remembered per account
  (`verdicts.deviceCheck.setByUs`) and the score ignores bit0 for that account only — the next account to sign in on that
  phone has no such mark, which is the whole point of the bit.
- **Only an account that may be acted on at all marks a device** (rule 5): never a payer, never the review account, never
  an exempt id, and never while the mode is `shadow`.
- bit0 counts only while Apple's own `last_update_time` is inside the last 12 months.

`POST /v1/admin/trust/:userId/clear` clears what we hold and leaves one instruction on the account
(`verdicts.deviceReset`). The next DeviceCheck pass from that phone is the only moment we hold a token for the device, so
that is where Apple's bits are set back to false and the instruction is spent. Google's device recall is not implemented,
so there is nothing to clear there yet.

## Operating it

1. Make the key on the server, straight into `.env` so it is never printed:
   `printf 'TRUST_HASH_KEY=%s\n' "$(openssl rand -hex 32)" >> ~/tulmi/tulmi/.env`, then
   `./deploy/set-env.sh --show TRUST_HASH_KEY` (it prints only "set").
2. Deploy with `TRUST=off`, run migration `0093`, then set `TRUST=shadow`.
3. Read the shadow lines for about two weeks (`trust: a score, shadow only`). Then, from the console's **trust** surface,
   turn on `actions.hold` — and only that — for new free accounts.
4. Check which proxy fronts the API. The bundled Caddy writes no access log; a host nginx keeps every client address for
   weeks unless `access_log off;` is set on the API block (`DEPLOY.md`). Keep `FLOW_BIND` at `127.0.0.1`.

## What is not here, and why

- **No reputation or geolocation API.** Both would mean sending somebody's address to a third party.
- **No JA3/JA4 fingerprint.** It needs a third-party Caddy module or Cloudflare Enterprise, and it is a device fingerprint by
  another name. Caddy forwards three coarse hints instead (`X-Tz-Tls-*`), never stored, and read for exactly one thing: a
  caller claiming to be one of our phone apps over TLS 1.0 or 1.1, which neither app can do, scores as a mismatch
  (`signals.ts shapeOf`). The cipher and protocol hints are forwarded and read by nothing yet.
- **No Turnstile, no Supabase Attack Protection** in this build (owner's decision): Cloudflare would see the sign-in screen's
  address and browser signals, the desktop app sends no captcha token yet, and the web deletion page needs
  `TURNSTILE_SITE_KEY` first.
- **`getAndroidId()` (SSAID), the advertising id, and anything derived from either**: never.
- **The session-moved signal is written and tested but not yet wired** to a request: it needs Supabase's `session_id` claim,
  which is not confirmed on the live version. Wire it in `http/hooks.ts` once it is.
- **The keyboard** still carries the full bearer token in the shared Keychain and cannot attest. Its traffic is scored by
  network signals like anything else; the keyboard token it needs is a build of its own.
