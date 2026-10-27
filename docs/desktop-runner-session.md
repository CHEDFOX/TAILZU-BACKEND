# The live session, for the desktop app

What the desktop app does so that a person's own computer is the first place the Code bot runs commands, with the jobs on Cloudflare (`docs/cloudflare-jobs.md` section 10) and without a 30-second wait for each command. The words below are the ones in `tulmi/src/code/live/protocol.ts`; if the two ever differ, that file is right. A runnable reference of the runner's half is `RUN_MJS` in `tulmi/src/code/jobs/runScript.ts` (`runSession`), which is what GitHub's computers run; `tulmi/tests/code-live-runner.test.ts` drives it against a fake room.

Nothing here changes the old HTTP runner (`docs/code-router.md`): with the jobs on the VPS (`CODE_JOBS_MODE=local`) the app keeps sending its heartbeat and long-polling `GET /v1/code/runner/next`. The app tries the new door first and uses the old one when the VPS says `live_off`.

## 1. The shape of it

```
 app ──POST /v1/code/runner/ticket {deviceId}──► VPS            (signed in as the person)
     ◄── { url, ticket, expiresAt }

 app ══ wss://<jobs>/v1/devices/connect?ticket=… ══► Worker ► the person's UserDevices object
        hello ► ack            "I am here, I may run commands, for these projects"
        … stays open all day; "ping" every 30 s gets "pong" …
        ◄ offer { …step…, session }       the router chose this computer for a live session

 app ══ session.url?ticket=session.ticket ══► Worker ► the job's room (one per job)
        hello ► ready
        ◄ exec { id, commands, timeoutSec, overlay }       the agent's command
        out { id, data } ►  …  done { id, exitCode, ms } ►  (about a second after the first command)
        ◄ exec …                                           the next one, at once
        ◄ close { reason }                                 idle, needs the person, job over, or the cap
 app ──POST /v1/code/runner/result {jobId, stepIdx, epoch, exitCode: 0, outputTail, minutes}──► VPS
```

Three sockets exist in all. The app uses the first two; the phone's live view is the third (section 7).

| Socket | Address | Ticket kind | Lives |
| --- | --- | --- | --- |
| Presence | `/v1/devices/connect` | `device` | all day |
| Runner session | `/v1/rooms/<jobId>/runner` | `runner` | while one job has commands to run (at most `CODE_SESSION_MAX_MIN`, 20 by default) |
| Live view | `/v1/rooms/<jobId>/watch` | `viewer` | while the person watches |

Every frame is a JSON text frame with a `t` (its type), at most 2 MB. A frame that does not parse, or has a field of the wrong kind, is answered with `{"t":"error","code":"bad_message","message":"…"}` and ignored: a socket is not closed for one bad frame.

## 2. Tickets

A WebSocket cannot carry the person's sign-in the way a request to the VPS does, so the VPS hands out a **ticket** and the Worker only checks that.

* `POST /v1/code/runner/ticket` `{ "deviceId": "<8 to 100 of A-Z a-z 0-9 . _ : ->" }` with the person's session. Answer `{ "url": "wss://…/v1/devices/connect", "ticket": "t1.…", "expiresAt": <epoch ms> }`. `404 live_off` when the jobs are not on Cloudflare: use the old HTTP runner. `deviceId` is the id the app made for this computer, the same one it sends to `heartbeat`.
* A ticket lasts **two minutes** and works **once**. Ask for a new one for every connection, reconnects included.
* Put it in the address as `?ticket=…` (or as `Authorization: Bearer …`; a browser cannot set that header on a WebSocket, the app can do either). The ticket is a string of the form `t1.<claims>.<mac>`; the app never needs to read it.
* Refusals come as an HTTP answer to the upgrade, `{ ok: false, code, message }`, never a value from the request: `401 bad_ticket`, `401 expired`, `401 wrong_kind`, `401 replayed` (used before), `401 wrong_job`, `429 too_many` (twenty computers of one person are connected), `426 upgrade_required`, `503 not_configured`.

The **runner ticket** (section 4) is made by the Worker, not asked for: it comes inside an offer. It is good for 15 minutes, works once, and is made for one step and one lease: a ticket for an earlier lease is refused with `409 superseded`.

## 3. Presence: `/v1/devices/connect`

Online **means the socket is open**. There is no heartbeat to forget. Closing the lid, losing the network or quitting the app ends it. While it is open and quiet it costs nothing (the Durable Object hibernates), so keep it open for as long as the app runs.

**Keepalive.** Send the plain text frame `ping` (not JSON) about every 30 seconds. Cloudflare answers `pong` itself, without waking anything. Treat 90 seconds without a `pong` as a dead socket and reconnect (a new ticket).

### App to Worker

```jsonc
{ "t": "hello", "v": 1, "deviceId": "laptop-0001", "name": "Work laptop", "allowRun": true,
  "projects": "all",            // or ["<projectId>", …] (at most 200)
  "busy": false, "app": "tailzu-desktop 1.4.0" }     // name ≤ 80 characters, app ≤ 60, both optional
```
Must be the first frame, and `deviceId` must be the one the ticket was made for (else `error wrong_device` and the socket is closed with 4003). Answered by `{"t":"ack","v":1,"deviceId":"…"}`. Until `hello`, the computer is not listed.

```jsonc
{ "t": "state", "allowRun": false, "busy": true, "name": "…", "projects": ["…"] }   // any of the four
```
Send it when the person changes "let Tailzu run commands here" or the project list, and `busy: true` while the app is doing something else on the computer's behalf. `busy: true` or `allowRun: false` means no offers. A change that makes the computer able again wakes the person's waiting jobs at once.

```jsonc
{ "t": "decline", "jobId": "…", "epoch": 3, "reason": "…" }   // informational
{ "t": "bye" }                                                   // closes the socket politely
```
A `decline` changes nothing by itself: the router moves a step that its computer does not take when the lease runs out (90 seconds). Say `bye`, or just close, to leave.

### Worker to app

```jsonc
{ "t": "offer", "offer": { /* section 4 */ } }      // a step for this computer
{ "t": "cancel", "jobId": "…", "epoch": 3 }          // let go of it: the router moved it, or the job ended
{ "t": "replaced" }                                  // another connection for the same deviceId took over; closed with 4000
{ "t": "error", "code": "…", "message": "…" }
```
After `replaced`, do **not** reconnect on your own: a second copy of the app has the computer now. On any other close, reconnect with a new ticket after 1, 2, 4 … up to 60 seconds, with a little jitter.

## 4. An offer

```jsonc
{
  "jobId": "3f9a1c2b-…", "stepIdx": 5, "epoch": 3,
  "commands": ["tailzu:live-session"],         // see below
  "timeoutSec": 1200,
  "repo": { "kind": "app", "cloneUrl": "https://github.com/acme/app.git", "branch": "tailzu/fix-login", "headSha": "…", "readToken": "…", "readTokenExpiresAt": 1793000000000 },
  "overlay": [ { "path": "src/a.ts", "content": "…" }, { "path": "old.ts", "content": null } ],
  "discard": true,
  "session": { "url": "wss://…/v1/rooms/3f9a1c2b-…/runner", "ticket": "t1.…", "expiresAt": 1793000000000, "idleSec": 120, "maxSec": 1200 }
}
```

`repo` is exactly what `GET /v1/code/runner/next` gives (`docs/code-router.md`): a token that can **read one repository and nothing else**, or for a project connected by sign-in a one-time `tarballUrl`. The person's own token is never in it.

* **No `session`: an ordinary step.** Run `commands` as before, honouring `overlay` and `discard`, and report with `POST /v1/code/runner/result`. Everything in `docs/code-router.md` applies unchanged.
* **`session` present (and `commands` is exactly `["tailzu:live-session"]`): a live session.** That command is a mark, **not a program to run**. Do not pass it to a shell.

On any offer: send `POST /v1/code/runner/progress` `{ jobId, epoch }` within 90 seconds and about every 30 seconds after, until the step ends. This keeps the lease, and is the same call as for any step. A computer that goes quiet loses the step and the router chooses again.

For a session: make a checkout of `repo` at `headSha` (a shallow one is enough: `git clone --depth 1`, then `git fetch --depth 1 origin <headSha>`; with `readToken` as `https://x-access-token:<token>@github.com/...` kept out of the remote config, or with `tarballUrl`). The checkout must be a **git repository** (the reset between commands uses git). Then open the runner socket.

## 5. The runner session: `/v1/rooms/<jobId>/runner`

Connect to `session.url` with `?ticket=<session.ticket>`, within `expiresAt`. The room is waiting for exactly this step; an unexpected runner is refused (`409 no_session`, `409 superseded`, `409 already_connected`, `401 used`).

### Runner to room

```jsonc
{ "t": "hello", "v": 1, "kind": "desktop", "name": "Work laptop", "os": "darwin", "node": "v22.4.0" }   // first; name ≤ 80, os ≤ 40, node ≤ 40
{ "t": "out",  "id": "<exec id>", "data": "…" }       // what a command printed, complete lines, redacted; ≤ 256 KB a frame, aim for ≤ 16 KB
{ "t": "done", "id": "<exec id>", "exitCode": 0, "ms": 4210, "timedOut": false, "note": "…" }   // note ≤ 500 characters, optional
{ "t": "found", "id": "<search id>", "ok": true, "text": "…", "matches": 12, "files": 4, "partial": false }   // grep
{ "t": "found", "id": "<search id>", "ok": true, "text": "…", "paths": ["…"], "total": 40, "partial": false }  // glob
{ "t": "found", "id": "<search id>", "ok": false, "error": "…" }
{ "t": "error", "id": "<exec or search id>", "code": "busy", "message": "…" }                      // id optional
{ "t": "pong", "at": 123 }
{ "t": "bye", "reason": "…" }                                                                         // the runner is leaving; the room closes the session
```

### Room to runner

```jsonc
{ "t": "ready", "v": 1, "jobId": "…", "idleSec": 120, "maxSec": 1180 }     // answers hello. maxSec: what is left of the job's session time
{ "t": "exec", "id": "e-12", "commands": ["npm test"], "timeoutSec": 600, "overlay": [ … ], "discard": true }
{ "t": "cancel", "id": "e-12" }
{ "t": "grep", "id": "g-3", "pattern": "slug", "path": "src", "glob": "*.ts", "ignoreCase": false, "context": 0, "filesOnly": false, "maxResults": 100 }
{ "t": "glob", "id": "g-4", "pattern": "src/**/*.test.ts" }
{ "t": "ping", "at": 123 }                                                  // answer with pong, same `at`
{ "t": "close", "reason": "idle", "message": "…" }                         // reasons: idle, cap, needs_you, job_end, superseded, expired, error
```

Ids match `[A-Za-z0-9._:/@-]{1,200}`; give back the id you were sent. `exec` has 1 to 20 commands of at most 2,000 characters each, `timeoutSec` from 1 to 3,600, at most 200 overlay files.

### What the runner does with `exec`

One at a time. If an `exec` arrives while one runs, answer `{"t":"error","id":"<the new id>","code":"busy","message":"…"}` and carry on with the first.

1. **Reset the checkout to the branch**, then **lay the overlay**. The overlay is the agent's **whole** set of staged edits every time, not a difference, so each command sees "the branch plus the staged edits": `git checkout -- .` (tracked files restored), remove the files the **previous** overlay created that git does not track, then write `content` for each entry, or delete the file when `content` is `null`. Leave untracked and ignored files (`node_modules`, build output, caches): that is what makes the second command fast. Never write a path that is absolute, contains `..` or `\`, is under `.git/`, is `.tailzu/…`, is under `.github/workflows/`, or goes through a symbolic link out of the checkout; name what was skipped in the output (`[Tailzu: could not lay …]`).
2. **Run the commands in order**, each in a login shell in the checkout (`bash -lc` on macOS and Linux; the shell the app uses for steps on Windows), stopping at the first that exits non-zero. Each gets the time the step has left, not the full `timeoutSec` again. Print a line `$ <command>` before each. Keep the process group so a timeout or a cancel can kill all of it.
3. **Stream the output** as `out` frames: complete lines, every 100 ms or 16 KB, a half line held until its end or the flush at the command's end. **Before sending, replace secrets with `[redacted]`**: GitHub, AWS, Slack, JWT and `Authorization` values, `password=`/`token=`/`api_key=`-style values, the exact values of the computer's own secret-named environment variables, and every line of a private key from its `BEGIN` line to its `END` line. The reference is `redact` and `lineStreamer` in `runScript.ts`. The room scans again; that is a second guard, not the first.
4. **Hide the way to write from the commands**: do not give them the app's own tokens or sign-in. The only credential on the machine for the session is the read-only one used to make the checkout, and it should not be left in the checkout's git config.
5. **End** with `done`: `exitCode` (0 for success; 124 and `timedOut: true` when the time ran out, with `[Tailzu: stopped after N seconds, the time this step had]` in the output; 130 after `cancel`, with `[Tailzu: stopped]`), and `ms` for the whole `exec`.
6. A command that leaves a process in the background must not hold the `exec` up: finish when the shell exits and its output has been read (give a short grace, then stop reading).

`cancel` for the running id kills its process group and ends with `done` 130. A `cancel` for any other id does nothing.

### What the runner does with `grep` and `glob`

Only sent when the repository is too big for the room's own copy (over 50 MB of text, `remote`); otherwise the room answers by itself. Answer from the checkout, never listing or searching a secret file (`.env` and `.env.*` except `.example`, `.sample`, `.template`, `.dist`, `.defaults`, `.schema`; `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`-style keys, `.npmrc`, `.netrc`, `credentials*.json`, `secrets.{json,yaml,toml}`, `*.tfstate`; the list is `secretish` in `runScript.ts`).

* `grep`: ripgrep's form, `path:line:text` for a match and `path-line-text` for a context line, `--` between groups; `filesOnly` gives one path a line. `git grep -n -I` does it (PCRE with `-P` where git has it, else `-E`); ripgrep is fine too. At most `maxResults` matches (default 100, at most 500) then `partial: true`; `context` at most 5; a line longer than 300 characters is cut.
* `glob`: tracked files that match, the **most recently changed first**, at most 500 paths (`partial: true` over that), `total` the number matched. A pattern with no `/` matches in any folder.
* If it cannot be done (a pattern git will not run) answer `ok: false` with a sentence in `error`. A search the room has waited 60 seconds for is given up on.

### Leaving

* The room sends `close`. Answer by closing the socket with code 1000. Whatever is running when the room closes is stopped. `reason` says why and is for the log: `idle` (no command for `idleSec`), `cap` (the job's session time is used up), `needs_you` (the agent is asking the person something; a session is never left open while a person thinks), `job_end`, `superseded` (the step moved to another computer), `expired`, `error`.
* **Then report the step**, as for any step: `POST /v1/code/runner/result` `{ "jobId", "stepIdx", "epoch", "exitCode": 0, "outputTail": "[Tailzu: live session ended (<reason>); <n> command(s) run]", "minutes": <minutes the session lasted, decimals allowed>, "changes": [] }`. The minutes are what is counted against the person's GitHub or compute allowance; send the real figure. Exit code 0 for an end the room asked for, 1 for a socket that dropped. A `409 stale_lease` means the step was given to another computer meanwhile: that is not the app's failure.
* If the socket drops by itself, the room treats the runner as gone: a command that was running is reported to the agent as lost and the session is closed. Report the step with exit code 1.
* If the room has said nothing for `idleSec` plus 90 seconds **between commands**, leave (the room's own alarm should have closed it). The silence is not counted while a command runs.
* Close codes the room uses: 1000 normal, 1009 a frame over 2 MB, 4001 superseded by a later lease of the same step.

### Rules the session keeps (so the app need not)

Opened late: the first time the agent runs a command, not at the start of the job. Closed after `CODE_SESSION_IDLE_SEC` (120) without a command, always before the person is asked anything, and at the latest `CODE_SESSION_MAX_MIN` (20) minutes of session in all for the job. A command after a close opens a new session, which costs the same ~1 minute the first did, and is placed again: the person's computer first.

## 6. Order of preference

The router places a session step like any other: this computer if it is online, allows the project, has "run commands" on, is not `busy` and holds no other step; else GitHub's free computers (a live session on a workflow run, while the month's Actions minutes are under 95% of `CODE_ACTIONS_MONTHLY_MIN`); else paid compute if the person allowed it; else it waits. So a computer that sends `hello` and keeps the socket open gets the work.

## 7. The live view (the phone and the desktop app showing a job)

* `POST /v1/code/jobs/:id/live` (the owner's session) answers `{ url: "wss://…/v1/rooms/<id>/watch", ticket, expiresAt }`. Only the job's owner gets one (anyone else gets `404 not_found`). Two minutes, once.
* After connecting the room sends `{ "t": "snapshot", "jobId", "session": { "state": "none|opening|open|closed", "kind"?: "github|desktop" }, "remote", "ready", "events": [ … the last 100 … ], "tail"?: "<the end of the output of the command running now>" }`, then events as they happen:

```jsonc
{ "t": "phase",  "phase": "work", "at": 1793000000000 }
{ "t": "tool",   "id": "call_1", "name": "grep", "brief": "slug", "at": … }          // brief ≤ 120 characters, scrubbed of secrets
{ "t": "result", "id": "call_1", "ok": true, "brief": "src/util.ts:1:export function slug…", "at": … }
{ "t": "out",    "id": "e-12", "data": "…", "at": … }                                // at most 2,000 characters at a time
{ "t": "cost",   "spentPaise": 14, "budgetPaise": 3000, "at": … }
{ "t": "session","state": "open", "kind": "desktop", "reason"?: "idle", "at": … }
{ "t": "said",   "text": "…", "at": … }                                              // the person's own words, echoed
{ "t": "end",    "why": "finished", "at": … }                                        // the job is over; the room closes viewers with 1000 "over"
```

* The person can answer back mid-task on this socket, `{ "t": "message", "text": "…" }` (at most 4,000 characters), or with `POST /v1/code/jobs/:id/message` `{ "text": "…" }`. Either way it reaches the agent's next model turn as the person's words (it never changes what Tailzu may do). `{ "t": "ping" }` is answered with a `pong`.
* At most 8 views of one job are open at once.

## 8. Checklist for the app

1. Ask for a device ticket; on `404 live_off`, keep to the HTTP runner.
2. Connect, `hello`, keep `ping` going, keep `state` current (`allowRun`, `projects`, `busy`).
3. On an `offer`: keep the lease with `progress`; for an ordinary step run it as before; for a `session`, make a git checkout and open the runner socket.
4. In the session: reset, lay the overlay, run, stream redacted lines, `done`; `grep` / `glob` only when asked; leave on `close`.
5. Report the step with `POST /v1/code/runner/result`, with the real minutes.
6. Never run the string `tailzu:live-session`, never keep a write token on the machine for this, never send an unredacted line.
