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

## In the terminal

The tool lives in TAILZU-DESKTOP `cli/` (its own npm package, `@xooteqlab/xode`, Node 20+, no runtime dependencies). The name
`xode` on npm belongs to someone else, so the package is scoped; the command it installs is still `xode`.

```
xode                     # in a project's folder: all a person needs (signs in first when nobody is)
xode "fix the cart"      # the same, with that as the first message; the session stays open after the job
xode -p "question"       # one answer printed as plain text, then out (cat err.log | xode -p "why does this fail")
xode doctor              # checks the setup, one line each
xode update              # the command that updates, this version and the newest
```

`npx @xooteqlab/xode` works too, or `npm i -g @xooteqlab/xode`. `xode login`, `status`, `stop` and `logout` still work but are not
advertised: inside the session they are `/login`, `/status`, `/stop`, `/logout`. Flags: `--new` (a chat of its own instead of
the app's), `--project <id>`, `--no-runner` (do not offer this computer). Env: `XODE_SERVER` (default https://api.x0bot.com),
`XODE_PROJECT`, `XODE_RUNNER=0`, `NO_COLOR`, `XODE_NO_UPDATE_CHECK=1`. Exit codes: 0 normal, 1 an error, 2 bad usage.

### What a session does

1. **One command.** Not signed in (or the sign-in was switched off): the code and the link are shown, xode waits for the
   approval, then goes straight on; Ctrl+C cancels. The project comes from the folder without a word; xode only speaks when
   something is wrong. Then a small welcome box (Xode, owner/name, the folder) with one tip, and the `>` prompt.
2. **The folder decides the project.** Outside a git repository xode says so and stops. It reads the remote (origin, else the
   only one), matches owner/repo to the person's Xode projects (`GET /v1/code/projects`, `fullName`), and offers the GitHub
   connect link the app uses when the repo is not connected yet (`GET /v1/code/github`, `POST /v1/code/github/connect` or
   `/signin`), adding the repo as a project once GitHub can see it (`POST /v1/code/projects`, asked first).
3. **The chat is the app's.** The same thread as the app's Xode chat for this person and project
   (`screens/codeWork/parts.ts threadFor`, from `user.id` in `GET /v1/auth/device`); `/clear` (or `--new`) starts a fresh one
   for the folder. A message goes to `POST /v1/bots/code/flow/:project/say` (Esc or Ctrl+C cancels it while Xode thinks). A new
   plan is shown as numbered steps and a picker, "Start this plan? 1. Yes 2. No, tell Xode what to change" (arrows and Enter,
   or the number; Esc is No); yes is `/approve` by its version.
4. **The job, quietly.** Its live room (`POST /v1/code/jobs/:id/live`, the room's WebSocket), else polling `GET /v1/code/jobs/:id`
   and `/log`. One line per stage ("● Build", stages as the job screen derives them, `botsCodeWork/read.ts stageOf`), dim
   lines for what it does, and on a terminal one status line redrawn at the bottom: spinner, stage, time, "esc to stop". The
   prompt stays open: what is typed goes to `/work`. Its questions come up as the same picker, with "Type your own answer"
   last (`/answer`); yeses too. Esc shows "Press Esc again to stop the job", and again stops it (`/stop`); Ctrl+C does the same
   first step. Leaving (Ctrl+C twice, Ctrl+D twice, `/exit`) never stops a job: "Xode keeps working. Run xode here to follow
   it." The next `xode` in the folder follows it again, or, if it ended meanwhile, reports it and brings its work in.
5. **This computer does the work.** While xode is open it runs the desktop's runner (`src/runner`) headless, named
   "<hostname> (terminal)", offering this folder's project only (`onlyProject`), so the router can place the job here. Its
   guards, audit log and workspace rules are the desktop's. It is mentioned only when it matters: "Working on this computer."
   when a job starts here, or a problem (paused for the battery, taken over, signed out).
6. **The changes come back.** When the job ends (done, or failed after pushing), its branch is fetched into the folder and
   switched to, then git's own `diff --stat` and the pull request link; `/diff` shows the whole diff later. With uncommitted
   changes in the folder nothing is fetched or touched: xode prints the two git commands instead. Never a force, a reset of
   the person's branch or a stash.

At the prompt: `/` lists the commands (`/help`, `/clear`, `/plan`, `/diff`, `/status`, `/stop`, `/login`, `/logout`, `/exit`);
`!cmd` runs a shell command in the project's folder, shows its output dim and puts "I ran: cmd / exit code / its last lines"
in front of the next message; `@` and Tab complete a file from `git ls-files`; Up and Down go through what was typed in this
folder; a line ending in `\` (or Ctrl+J) goes on to the next line, and a paste is one message. Without a terminal (a pipe)
there is no redrawing: plain lines, and pickers become a numbered list answered with a number.

`xode -p` never approves a plan, starts a job or offers this computer. Signed out it ends with "Not signed in: run xode"
(exit 1). Piped text is added after the question, up to 20 KB (cut with a note).

Once a day at most, in the background (1.5 s at most, never holding up the start), xode asks npm for the newest version
(`GET https://registry.npmjs.org/@xooteqlab/xode/latest`) and says in one dim line when there is a newer one.

### Files kept on the computer

- The sign-in: the keychain (macOS, `security`, fed on stdin), the secret service (Linux, `secret-tool`), else
  `~/.config/xode/credentials.json` (folder 700, file 600).
- `~/.config/xode/state.json`: per server and folder, the project, a fresh chat's id and the last job.
- `~/.config/xode/history.json`: what was typed at the prompt, per folder (the last 200; a line mentioning a token, a
  password, a secret or `key=` is never kept).
- `~/.config/xode/update.json`: when npm was last asked, and its answer.
- `~/.config/xode/runner/` and `~/.cache/xode/runner/`: the runner's state and its workspaces.

### Develop and test

```
cd TAILZU-DESKTOP/cli && npm test                 # node --test, a fake server, real git in temp folders
node dev/demo-server.js 4545                       # a fake server with a slow, realistic session; prints a folder to cd into
cd <that folder> && XODE_SERVER=http://127.0.0.1:4545 node <cli>/bin/xode.js
```

The tests type keys through a pipe with `XODE_KEYS=1` (and draw as a terminal would with `XODE_TTY=1 COLUMNS=60`), and read
the screen back with a small terminal of their own (`test/screen.js`). A local backend with no database
(`DEV_SKIP_AUTH=true`) signs a terminal in from memory, so the sign-in can be tried end to end on one machine.

### Publish

`npm pack` first copies the runner into `cli/runner/` (`scripts/bundle-runner.js`, gitignored), so the package stands alone.
Publishing needs the npm organisation `xooteqlab` (it exists) and two-factor sign-in on the account that publishes.

```
cd TAILZU-DESKTOP/cli
npm test
npm pack --dry-run
npm login
npm publish --access public --otp=<the 6-digit code from the authenticator app>
```

Each release: raise `version` in `cli/package.json` first (`npm version patch`).
