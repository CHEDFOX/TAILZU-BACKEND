# Xode in the terminal (`xode`)

`xode` is Xode, the coding bot, used from a terminal. This document is the server's side of it.

## Sign in

### The flow

1. `xode login` asks the server for a sign-in request: `POST /v1/auth/link` with `{ kind: "cli", deviceName, platform }`.
   It shows the short code and the link `x0bot.com/device`, and waits.
2. The person approves it in the X0 Bot app, on the phone or on the computer:
   - from the link: `x0bot.com/device?c=<code>` shows the code and a button that opens the approval screen in the app;
   - or by typing the code: Settings, Terminal sign-ins (`bots.devices`), or You, Link a computer (`bots.link`).

   The approval screen (`bots.link`, server-built, both apps) says plainly what is being approved: "Xode in the terminal on
   <computer>", that it can work on the person's projects from that terminal, and that it can be removed any time in
   Settings. Approve or Not me.
3. The terminal's poll gets, once, a **device token** of its own. It keeps it (never prints or logs it) and sends it as
   `Authorization: Bearer xdt_…` from then on.

It is the same request as "sign in on a computer with the phone" (the desktop app's QR sign-in), with `kind: "cli"`: the
same codes, hashing, time limits, rate limits and one-time exchange (`tulmi/src/auth/deviceLink.ts`). The difference is
what the approved poll gives: a device token instead of a Supabase session, so no email address is needed, and an account
that signs in with a phone number can approve a terminal too. A window's sign-in is still approved from the phone only; a
terminal's can also be approved in the desktop app.

### The routes

The request (`tulmi/src/routes/account/deviceLink.ts`):

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /v1/auth/link` | the terminal, signed out | `{ kind: "cli", deviceName, platform }` (`platform`: `mac`, `windows`, `linux`) | `{ token, secret, code: "ABCD-EFGH", url, qr, expiresAt, ttlMs, pollMs, deviceUrl: "https://x0bot.com/device", deviceUrlWithCode: "https://x0bot.com/device?c=ABCDEFGH" }` |
| `POST /v1/auth/link/poll` | the terminal | `{ token, secret, wait }` (`wait` in seconds, at most 25) | `{ status: "pending", expiresAt }`, or `{ status: "denied" \| "expired" \| "used" \| "failed" }`, or once `{ status: "approved", deviceToken: "xdt_…", deviceId }`; 404 `not_found` for a wrong token or secret |
| `POST /v1/auth/link/view` | the app, signed in | `{ token }` or `{ code }` | `{ kind, deviceName, platform, status, createdAt, expiresAt, canApprove, account? }` |
| `POST /v1/auth/link/approve`, `/deny` | the app, signed in | `{ token }` or `{ code }` | `{ ok: true, deviceName }`; 404 `not_found`, 410 `expired`, 409 `decided` |

Without `kind` (or with `kind: "app"`) everything is as it was for the desktop app's window. The page's address comes from
`DEVICE_PAGE_ORIGIN` (default `https://x0bot.com`). A request lasts 5 minutes; once approved, the terminal has 60 seconds to
take its token, or it reads `expired`.

The terminal's own (`tulmi/src/routes/account/devices.ts`), with `Authorization: Bearer xdt_…`:

| Route | Answer |
|---|---|
| `GET /v1/auth/device` | `{ id, name, platform, createdAt, lastUsedAt, user: { email?, name? } }` (for `xode status`); 401 once removed |
| `POST /v1/auth/device/revoke` | `{ ok: true }` (for `xode logout`): removes the token it was sent with |

The person's (any ordinary session):

| Route | Answer |
|---|---|
| `GET /v1/auth/devices` | `{ devices: [{ id, name, platform, kind: "cli", createdAt, lastUsedAt }] }`, not removed, newest first |
| `DELETE /v1/auth/devices/:id` | `{ ok: true }`; 404 `not_found` for someone else's, or one already removed |

Times are epoch milliseconds; `lastUsedAt` is null until first use. All of them are rate-limited like the link routes, and
answer with `Cache-Control: no-store`.

The page: `GET /device` (`tulmi/src/routes/site/devicePage.ts`, x0bot.com/device through the website's proxy). With
`?c=<code>` it shows the code and "Open in X0 Bot" (the app link `https://app.x0bot.com/s/bots.link?c=<code>`, which opens
the approval screen); without one, a field to type it. The code is only checked for its shape, never looked up, and the page
holds no secret.

### The token

`xdt_` and 32 random bytes in base64url (47 characters). The server keeps only its SHA-256. `resolveUser`
(`tulmi/src/auth/supabase.ts`) sees the prefix and checks it against the server's own table before any Supabase call, with
a timing-safe compare (`tulmi/src/auth/deviceTokens.ts`). The person it signs in comes with `deviceId` set. What a token
names is cached in memory for 60 seconds; `last_used_at` is written at most every 10 minutes.

### Scope

A device token is only for Xode. One hook for the whole app (`tulmi/src/http/deviceScope.ts`) lets a request with
`Bearer xdt_…` reach only routes under `/v1/code/`, `/v1/bots/code/`, `/v1/auth/device` (singular) and `/v1/rooms/`;
everything else answers `403 { code: "device_scope", message: "This sign-in is only for Xode in the terminal." }`. It reads
the route the request matched, so an odd spelling of a path cannot pass for another.

WebSockets: the runner's and the live job view's sockets go to the jobs Worker with a short ticket, and the tickets come
from `POST /v1/code/runner/ticket` and `POST /v1/code/jobs/:id/live`, which are in scope, so a terminal gets them with its
device token as the desktop app does with its session. The server's own sockets that take a sign-in in a message rather
than a header (`/v1/live`, the live dictation) turn a device token away themselves.

### Revoke

The person removes a terminal in Settings, Terminal sign-ins (`bots.devices`: each with its name, system, when it was added
and last used, and Remove, which asks first), or the terminal removes itself with `xode logout`. A removed token fails at
once on the server instance that removed it, and within 60 seconds on any other (their cache). The row stays, marked
removed, as the record of that terminal.

### Storage

Migration `0066_device_tokens.sql`: the table `device_tokens` (`id`, `user_id`, `token_hash` unique, `name`, `platform`,
`kind` default `'cli'`, `created_at`, `last_used_at`, `revoked_at`), written and read only by the server with the service
key (row-level security on, no policies); a person's rows go with their account. It also adds `kind text not null default
'app'` to `device_links`. A server with no database keeps device tokens in memory. The window's sign-in keeps working on a
database without 0066 (its rows do not write `kind`); a terminal's needs it.

Run it: `ssh root@91.108.104.168 "cd ~/tulmi && git pull --ff-only && ./deploy/migrate.sh 0066"`.
