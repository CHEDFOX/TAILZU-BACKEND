# The front door and the overload guards

One entry point for a message, and the guards that keep the pipeline from being overloaded by it. Code: `tulmi/src/front/` (the entry point), `tulmi/src/guard/` (the guards), `tulmi/src/routes/front.ts` and `tulmi/src/routes/guarded.ts` (the doors to them). Migration: `tulmi/supabase/migrations/0033_front_decisions.sql`.

The front door **understands a message for nothing where it can**, sends it down **the cheapest road that can do it**, shows **a visual when one explains faster**, asks **one question only when a wrong guess would cost real work**, and **writes down what happened** (categories and numbers, never a word) so it can get a little better for each person. The guards make sure that however many messages arrive, **each costly thing runs once, under a limit, and a failing model stops being asked**.

It is **off unless `FRONT_DOOR=true`**. The guards are on whenever the routes they guard are.

* [1. The flow](#1-the-flow)
* [2. The request and what comes back](#2-the-request-and-what-comes-back)
* [3. Intents, roads, tiers and budgets](#3-intents-roads-tiers-and-budgets)
* [4. Visuals: the ladder and when to skip it](#4-visuals-the-ladder-and-when-to-skip-it)
* [5. When it asks a question](#5-when-it-asks-a-question)
* [6. Attachments](#6-attachments)
* [7. Dispatch](#7-dispatch)
* [8. The guards](#8-the-guards)
* [9. The decision log and what it learns](#9-the-decision-log-and-what-it-learns)
* [10. Costs](#10-costs)
* [11. Configuration](#11-configuration)
* [12. Tests, and what needs a live check](#12-tests-and-what-needs-a-live-check)

## 1. The flow

```
POST /v1/ask { message, device, mode, ... }
   │  resolveUser, the month's allowance (enforceQuota)
   ▼
 guard.run  ── Idempotency-Key, or a hash of (person, route, body): a double tap joins the run that is out, or is shown its answer
   │            a permit (global 64, 3 a person, 1 on the free plan) or 429 + Retry-After + place in the queue
   ▼
 decide(message, ctx) ──► Decision { intent, shape { length, visual }, route, tier, budgetPaise, confidence, clarify? }
   │   1. the rules read it for nothing (English, Hinglish, Hindi), reusing the Code bot's free classifier
   │   2. under 0.7 sure: the small model, once (role front_decide, the tiny tier, at most 100 paise)
   │   3. the shape: how long, and the cheapest visual that explains it (or none)
   │   4. the road: route, tier, budget
   │   5. under 0.45 sure AND a costly road (200 paise or more): one question, 2 or 3 options
   ▼
 dispatch(decision, message, ctx)
   │   a costly road (a job, a deep research) needs 0.7, else the question goes back and nothing starts
   │   reply | file | code_answer | code_job | artifact | research | plan   (streamed where the road streams)
   │   the visual beside the answer: an inline table, an offer, or an artifact made from the answer
   │   the decision is written down: intent, route, tier, visual kind, confidence, cost, latency, outcome
   ▼
 { id, decision, result }   or a stream of events ending in the result
```

`decide` and `dispatch` are separate on purpose: a client that already has a decision (the user took an offer, or answered the question) can send the answer back with the same message, and the tests drive each with fakes.

The main assistant (`src/pipeline/`, `src/agent/`, `assistPrompt.ts`) is **not changed**. Its Ask planner acts on a screen or the connected apps and answers a device in events, so no callable entry fits a chat reply. The default road for chat and answers is the cheap `front_reply` role, and `HandlerDeps.assistant` is the seam where the main assistant can be plugged in as one handler when it has a plain-text entry.

## 2. The request and what comes back

`POST /v1/ask`, authenticated.

```
{ message,                       the person's words (8,000 characters at most)
  device:  "phone" | "desktop" | "web",
  mode:    "voice" | "text",
  visuals?: "auto" (default) | "ask" | "off",
  projectId?,                    a Code bot project: lets code questions, tasks and designs have somewhere to go
  attachments?: [{ id, name, mime, bytes, sha256, kind?, data? }],     see section 6
  recent?: [{ said, did? }],     the last three turns, summarised by the client
  visual?: "table"|"diagram"|"chart"|"component"|"page",   takes an offer a result made
  bot?: "any" | a bot's slug,      "Ask any bot": the front door picks the best of the person's bots, or goes to the one named (`docs/bots.md`). Off unless `BOTS=true`: 404 `bots_off`
  stream?: boolean }             or Accept: application/x-ndjson
```

Answer (`200`): `{ id, decision, result }`. `id` is the decision's row in the log, for the feedback route. `result` is `{ text?, artifacts[], offers[], clarify?, job?, sources?, files?, notes[], paise, ms }`: `text` is Markdown (it may hold a table); `artifacts` are the visuals made (id, type, title, version, kind, paise); `offers` are one-tap buttons for a visual not made (`{ kind, label, request: { visual } }`, sent back with the same message to take it); `notes` say in plain words anything that was skipped, cut short or failed, so nothing is dropped silently.

With `stream: true`, NDJSON, one event a line: `decision`, `status` (reading, thinking, designing, ...), `text` (a piece, for roads that stream), `artifact`, and last `result` (or `error`). A joiner of a double tap sees the events it missed first.

Errors: `400 bad_request` (the body), `413` (a message over 8,000 characters), `401`, `404 front_door_off`, `429 quota_exceeded` (the month's allowance), `429 daily_limit` (section 7), `429 overloaded` with `Retry-After` and the place in the queue (section 8), `409 idempotency_key_reuse`, `504 timeout`, `5xx` with a sentence a person can read.

`POST /v1/ask/feedback { id, outcome }` records what the person did with an answer: `visual_closed`, `visual_kept`, `thumbs_up`, `thumbs_down`. `GET /v1/admin/guard` (`x-admin-secret`) shows the limiter, the idempotency store, coalescing and every circuit breaker.

**Ask any bot.** With `bot` in the body (and `BOTS=true`) the front door first picks a bot (`docs/bots.md` section 7): the Code bot and "none of them" go down the roads above exactly as they were, with `bot` in the answer saying which bot it was; any other bot answers with its own rules, skills, files and memory, and the answer is `{ id: null, decision, result, bot, answer }`. A body without `bot` is untouched.

**`POST /v1/ask` already existed**: the desktop's "ask about the screen" sends `{ question, screenContent }`. That is unchanged. `server.ts` hands a body to the front door only when it has a `message` and no `question`; with the flag off, such a body is `404 front_door_off`. The route's body limit is 8 MB while the flag is on (a 4 MB picture is about 5.5 MB of base64); the old ask keeps 1 MB either way.

## 3. Intents, roads, tiers and budgets

| Intent | Road | Tier | The work |
| --- | --- | --- | --- |
| `chat` | `reply` | tiny | small talk |
| `answer` | `reply` | cheap | general knowledge; a table inline when it helps |
| `code_question` | `code_answer` | cheap; strong for a deep why or "what would break" | `code/chat` (`docs/code-chat.md`): locate the code from the brain's index (no model when the words suffice), answer from the index alone when it is enough, else read at most three located spans; every claim with `path:line`, the ones that do not resolve taken out; a flow drawn from the import graph; a short summary of the thread kept for the follow-up |
| `code_task` | `code_job` | by risk (`baseTier`) | a Code bot job on a new work branch, driven by the agent loop; the result is a pull request. After a question about the code, "ok, change it" starts it with the place the conversation found (`decision.handoff`); an open-ended task (debug, investigate, find out why) is worked free-form (`decision.mode = "freeform"`, `docs/code-agent.md` section 14); "with a team", "use helpers" or "in parallel" sets `decision.team = "on"` and "no helpers" or "do it yourself" `"off"` (`docs/code-team.md` section 1) |
| `design` | `artifact` | code | in a project, a component in the project's look (`componentArtifact`); otherwise a page |
| `research` | `research` | cheap, code or strong for quick, standard, deep | the web layer's `research()` under the person's daily research runs |
| `plan` | `plan` | cheap (code in a project) | steps and a timeline; in a project the work core's plan |
| `file_question` | `file` | vision for a picture, cheap for text | read what is attached (section 6), then the reply |
| `unclear` | `reply` | tiny | says what it can do, in the person's language |

**Rules first, for nothing** (`rules.ts`). Patterns in English, Hinglish (Hindi in Latin letters) and Hindi, plus the Code bot's own free classifier (`classifyRequest`) for the code signals (a bug, a change, a question about code, an error pasted in), plus what only the front door knows: a project, an attachment, the last turns (a short follow-up inherits what the turn before it was about). Evidence combines the way the classifier's does; a rival intent that also scored takes away from the confidence. The same words always give the same answer, and no word of a message is kept: the signals are short ids.

**The small model only below 0.7** (`decide.ts`). The confidence is first adjusted by what this person's history says of the rules (section 9). If it is still under 0.7, `front_decide` is asked once, on the tiny tier, for at most 100 paise, with the message, whether there is a project, the device and the mode, and what the rules thought. It wins on the intent, the length and the question; its view of the visual is one more piece of evidence. A model that is down or over budget costs nothing but the rules' own, less certain answer: `decide` never throws for it. The model's reply is checked again against the schema, so a malformed one is the rules' answer.

**The budget** (`path.ts`) is the most the road's work may cost in the worst case, in paise: the worst case of each call at its tier (`money.ts`) plus the caps the artifact core already holds its calls to. The gateway refuses a call whose worst case would pass what is left, so the budget is kept, not hoped for.

## 4. Visuals: the ladder and when to skip it

A comparison is easier as a table, a flow as a diagram, a trend as a chart, and "how would it look" as the thing itself. So an answer comes with the **cheapest rung that explains it**:

| Rung | What it is | When the words call for it | About what it adds |
| --- | --- | --- | --- |
| 1 table | markdown, inline in the reply | comparisons, specs | next to nothing (9 paise) |
| 2 diagram | Mermaid, an artifact (`front_diagram`, cheap tier) | steps, flows, architecture, a plan or timeline, "how does X work" | 21 paise; **0 for a plan**, whose diagram is drawn from its steps by code |
| 3 chart | an artifact (React with recharts) | numbers over time, shares, trends, with three numbers or more | 61 paise |
| 4 component | `componentArtifact`: a component in the project's look (the project's design kit, the brain's index to find where it goes) | "how would X look", a new UI, in a project | 103 paise |
| 5 page | an artifact (HTML) | the same, with no project | 106 paise |

(The costs are what a typical rung costs at the tier table's prices; `visual.ts` computes them from the live table.)

**No visual when:**

* the answer is **a short fact** (a one-line answer does not get a chart);
* the reply is **spoken** (`mode: "voice"`): the visual is **offered** instead, one tap, and made only if taken;
* the person turned visuals **off** (`visuals: "off"`);
* the visual would **cost more than the answer it goes with**: it steps down to a cheaper rung that still explains it (a chart falls back to a table), or to nothing;
* the intent never carries one: small talk, an unclear message, a code task (its result is a pull request);
* the person has lately **closed the visuals they were given more than they kept them**: the evidence is moved by at most 0.6 to 1.4 times (section 9).

With `visuals: "ask"` the visual is **offered, not made**, in every case: a one-tap button in `result.offers`.

Two things are never skipped for those reasons: **what the person asked for in so many words** ("put it in a table", "draw a diagram", "chart this", in English, Hinglish or Hindi), and **a design** (`show me how a pricing card would look`), which is the answer itself rather than an addition to one. Taking an offer (`visual: "table"` with the same message) is also made whatever the preference.

## 5. When it asks a question

Rarely, and never for something cheap.

* **From `decide`:** the intent is under **0.45** sure **and** the road is **costly** (a budget of **200 paise or more**: a code task, a design, a long piece of research). The question has **two or three options** and is in the person's language; the small model's own is used when it is well-formed, otherwise a fixed one (`words.ts`, in English, Hinglish and Hindi). A cheap road is never asked about: an unclear message that would only be a chat reply is answered.
* **From `dispatch`, the self-check:** before a **job** or a **deep research** run, the confidence must be **0.7 or more**, else the question goes back and nothing starts. The money is spent only on a thing the front door is sure about.

A question is a result with `clarify` set and no road taken: no model call, no cost beyond the decision itself. The client sends the chosen option back as the next message.

## 6. Attachments

`attachments` is a list of `AttachmentRef { id, kind, mime, bytes, sha256, name }`. The bytes come with the request (`data`, base64) the first time; after that the ref alone is enough, because **what was read is kept by SHA-256, per person** (in memory, bounded). A checksum the client gives is checked against the bytes when there are bytes.

| Kind | What happens | Model |
| --- | --- | --- |
| `image` (PNG, JPEG, WebP, GIF) | described once, for the question asked (role `front_look`); the description is what the reply is made from | the **vision** tier |
| `text`, `code` | decoded as text, capped; **only the relevant part** goes on to the reply (the windows that share the most words with the question, with the head of the file for orientation and what was left out marked) | none to read it |
| `audio`, `video`, `pdf`, `document`, `data`, `archive`, anything else | **"coming soon"**, in the person's language, with nothing guessed, **until the media feature is on** (`MEDIA_INGEST`): it then registers a handler for each kind, and the kind comes from the file's bytes, not what the client said (`docs/media.md`) | none to read it; a picture goes to the vision tier once |

Caps: at most 4 files a message are read; images up to 4 MB; text and code up to 1 MB, of which the first 200,000 characters are read; at most 3,500 characters of one file reach a model; a text the secret scan flags is not sent at all. Handlers are a **registry** (`AttachmentRegistry.register`): the media feature (`docs/media.md`) adds the kinds above by registering one handler that has an `open` (it keeps its own files: read once by SHA-256 for good, a ref alone is enough in a later message, and only the chunks that answer the question come back, wrapped as untrusted data) and a typer (`useRetype`) that finds the kind from the bytes. The rows of a spreadsheet come back in `ReadResult.tables`, and `dispatch` offers a table and a chart with the answer.

## 7. Dispatch

`dispatch(decision, message, ctx)` calls the road the decision names, streams what streams (`text` events as a road writes), makes the visual beside the answer, and writes the decision down.

* **Time:** each road has a deadline (reply 45 s, file 60 s, reading an attachment 180 s, code answer 60 s, job 30 s, artifact 150 s, research 210 s, plan 90 s); a road that takes longer is `504 timeout` in words, "nothing was changed". A person who hangs up stops the road and the model calls under it.
* **Money:** each part gets its share of the decision's budget and what is left of the person's day. `FRONT_DAILY_PAISE` (default 1,500, fifteen rupees) is what the front door **itself** may spend on one person's messages in a day: the small model, replies, research, plans, attachments. Once it is spent, `429 daily_limit`. Artifacts and jobs keep their own daily caps (`ARTIFACT_DAILY_PAISE`, the job budget), so the front door does not count them twice.
* **A visual that fails does not fail the answer:** `result.notes` says "I left out the diagram: ...".
* **A message with something attached is about the attachment** (`file_question`, confidence 0.92 from the rules): a picture is described once and the reply is made from the description. A sketch to be *turned into* a component is the artifacts route's `image` field (`POST /v1/code/projects/:id/artifacts/component`); the front door does not hand it on.
* **A road that is not switched on** (no Code bot, no agent, no artifacts) answers with the reason in words, never silence.
* **Nothing is logged but categories and numbers.** A log that cannot be written is a warning in the server's log, never a failed message.

## 8. The guards

All in memory, **per process**. Nothing in `src/guard/` reads a store; the config is read once when the default guard is made.

### Limiter (`limiter.ts`)

| | Default | Config |
| --- | ---: | --- |
| permits out at once, everyone | 64 | `GUARD_GLOBAL_CONCURRENCY` |
| permits for one person | 3 | `GUARD_USER_CONCURRENCY` |
| permits for one person on the free plan | 1 | `GUARD_USER_CONCURRENCY_FREE` |
| waiting in the queue, in all | 256 | `GUARD_QUEUE_MAX` |
| waiting in the queue, one person | 4 | `GUARD_QUEUE_PER_USER` |
| the longest one request waits | 8,000 ms | `GUARD_QUEUE_WAIT_MS` |

A request that finds no permit **waits in a bounded queue**; past any bound it is **`429 overloaded`** with `Retry-After` (worked out from how long permits have been held lately) and **`position`**, the place it had or would have had. Who is next when a permit comes free: **paid before free** (a free request that has waited 10 seconds goes as if it were paid, so a busy hour cannot starve a free person), and within a priority **fair interleaving**: the person served least recently goes first, so one person with four waiting does not run all four before another person's one.

### Idempotency (`idempotency.ts`)

The key is the `Idempotency-Key` header (scoped to the person and the route), or a hash of (person, route, body), so a double tap with no header is caught too.

* **In flight:** a second request with the key **joins** the run and gets its answer, and its events if it streams.
* **Finished:** for **30 seconds** after a success the same key gets the same answer without running again (`idempotent-replayed: true`). A failure, or an error answer, is forgotten at once: trying again tries again.
* **A different request under the same key** is `409 idempotency_key_reuse`.
* **Stopping:** the run is stopped only when **every** request waiting on it has gone, so the first tap's connection dropping (the app sent the second) does not kill the run the second is waiting for.
* **Routes whose answer depends on what the server holds**, not only on the body (an artifact edit, "build it", the next step of an intake), still join a run that is out but **do not replay a finished one** unless the client sent a key: "make it bigger" twice is two edits.

### Coalescing (`coalesce.ts`)

Identical cheap reads **in flight at the same moment** make one trip: a web search, a page read, a project's design kit, the brain's file, symbol and text searches. It keeps nothing once a read has finished (that is the page cache's and the kit store's job). A search made with a person's own GitHub token is shared with no one else. A joiner of a read that was stopped by someone else reads it again for itself.

### Circuit breakers (`breaker.ts`, used inside `code/brain/gateway.ts`)

One breaker **per model slug and per provider**. **Open** at **50% or more failures over 8 or more calls in 60 seconds**; an open breaker is **skipped without a call** and the ladder climbs; after a **30 second** cooldown it is **half-open** and lets **one probe** through; the probe working closes it with a clean slate, failing opens it again. A model whose slug **or** provider is open is skipped. When every model of a ladder is cooling off, the call fails at once with `ModelUnavailable`, which is what a breaker is for. An answer that was bad JSON, a refusal for the budget, or a stopped caller does not count against a model; an empty answer and a timeout do. The trail of a call shows `skipped`. `GET /v1/admin/guard` lists every breaker, open ones first, with how long until a probe.

### Time (`timing.ts`) and budgets

`withTimeout`, `withFallback` and `retryJitter` replace the hand-written copies where that is safe (the run ledger's `within`, the project brain's fallback, the gateway's retry wait). Each costly request has a **per-request budget** from the decision, passed to `callModel`, and a **daily per-person cap** (`FRONT_DAILY_PAISE`).

### Where they are applied

`POST /v1/ask` (lane `ask`), artifact create, edit, component and "build it" (`artifact`, `job`), `POST /v1/code/jobs` (`job`), and the code doors that ask a model: `locate`, `intake` (`code`) and `resources` (`research`). A body that is wrong from the body alone is a 400 **before** a permit is taken.

### Scaling

The limits are **per process**. With several workers or servers each has its own count, so the real ceiling is their number times the limits above: size `GUARD_GLOBAL_CONCURRENCY` as the share of the provider's rate limit one process may use, not the whole of it. Idempotency and coalescing are per process too: two taps that land on two servers are two requests. Route a person's requests to one server (sticky by user) if that matters, or keep the `Idempotency-Key` client-side so a retry is at least recognised on the server that ran it. Moving the state to Redis (or the database) is a change inside `limiter.ts` and `idempotency.ts` only; their callers do not know where the state is.

## 9. The decision log and what it learns

**One row per answered message** in `front_decisions` (migration `0033`; owner-read RLS, written by the server with the service key only, deleted with the account): `user_id`, `at`, `intent`, `route`, `tier`, `visual` (the kind that came with the answer, or null), `confidence`, `cost_paise`, `latency_ms`, `outcome` (`ok`, `rephrased`, `visual_closed`, `visual_kept`, `thumbs_up`, `thumbs_down`) and `via` (`rules` or `model`, so the share of messages that needed the small model is measured). **No message, no reply, no file name.** Without Supabase the log is kept in memory and a restart forgets it, and what is learned from it.

The outcome starts as `ok` and changes when:

* the person **rephrases**: a new message from the same person within 60 seconds that shares half or more of its words with the last marks the last `rephrased`. The words are kept for those 60 seconds as a set of hashes, in memory, never the text;
* they **close or keep a visual**, or give a **thumbs up or down** (`POST /v1/ask/feedback`).

**Learning is small, bounded and explainable.** Two things, read from the last 30 days of counts (at most 300 rows), cached for a minute:

1. **A person's visual habit.** `(kept + 2) / (kept + closed + 4)`: 0.5 with no history, never 0 or 1. It moves the evidence for an *unasked* visual by **0.6 to 1.4 times at most**. It cannot turn off a visual the person asked for, or a design.
2. **A rule's trust, per intent.** When a message the rules were sure of is often followed by a rephrase or a thumbs-down, the rules' confidence **for that intent** is cut by up to **30%**, so the small model is asked more often there; a thumbs-up gives some of it back. With fewer than 5 messages of an intent there is no cut.

Every adjustment goes into the decision's `reasons` as a short id with a reason a person could read ("closed 5 of 7 visuals", "3 of 8 research messages were rephrased or marked down"). A bad week cannot make the front door unusable, and a good one cannot make it sure.

## 10. Costs

What a message costs, in paise: the budgets `decide()` gives these messages from the tier table at 88 rupees to the dollar (`DEFAULT_USD_INR`), with the rules deciding each. The **budget** is the worst case the road is held to; what was spent is in `result.paise`.

| Message | Intent / road | Tier | Budget (worst case) | Notes |
| --- | --- | --- | ---: | --- |
| "hi" | chat / reply | tiny | 31 | decided by the rules: no model call to decide |
| "what is the capital of France?" | answer / reply | cheap | 31 | a short fact: no visual |
| "compare Postgres and MySQL for a small shop" | answer / reply | cheap | 51 | a table inline, in the same call |
| "what is the latest version of Next.js?" | research quick | cheap | 150 | cited, from the web |
| "do a deep research on ..." | research deep | strong | 1,000 | needs 0.7 sure |
| "plan a 3 day trip to Jaipur" | plan | cheap | 120 | its diagram is drawn by code: 0 |
| "where is the session cookie set?" | code_answer | cheap | 111 | locate (up to 60) + the answer; with the brain's index enough, the answer is the only model call |
| "why is checkout slow under load?" | code_answer | strong | 211 | a deep why: the strong tier, and the reason (`code:deep`) is written down |
| "fix the crash when the cart is empty" | code_job | code | 3,000 | the default job budget, scaled by difficulty (0.4, 1, 1.5); needs 0.7 sure |
| "show me how a pricing card would look" | artifact (component) | code | 660 | in a project: the component, the project's kit and where it goes |

Plus, when the rules are under 0.7 sure, **at most 100 paise** for `front_decide`. A visual beside an answer adds the rung's cost from section 4, only when it is made. The decision, the learning and the guards cost nothing. The daily cap (default 1,500 paise) holds the front door's own spend on one person.

## 11. Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `FRONT_DOOR` | `false` | the smart entry point; off, a `message` body is `404 front_door_off` |
| `FRONT_DAILY_PAISE` | `1500` | what the front door may spend on one person's messages in a day |
| `GUARD_GLOBAL_CONCURRENCY` | `64` | permits out at once, everyone |
| `GUARD_USER_CONCURRENCY` | `3` | permits for one person |
| `GUARD_USER_CONCURRENCY_FREE` | `1` | permits for one person on the free plan |
| `GUARD_QUEUE_MAX` | `256` | requests waiting, in all |
| `GUARD_QUEUE_PER_USER` | `4` | requests waiting, one person |
| `GUARD_QUEUE_WAIT_MS` | `8000` | the longest one request waits before `429` |

The breakers' numbers (8 calls, 50%, 60 s, 30 s) and the idempotency window (30 s) are constants in `guard/breaker.ts` and `guard/idempotency.ts`: they are not a deployment's to tune.

## 12. Tests, and what needs a live check

Free tests (no network, no model, no database): `front-decide` (table-driven decisions, including Hinglish and Hindi, voice, visuals off and ask, an image attachment, an unclear message that is costly and asks, and one that is cheap and answers; the small model only below 0.7), `front-dispatch` (each road with fakes, the self-check, streaming, deadlines, the log), `front-handlers`, `front-attachments`, `front-learn` (the log, the habit, the trust, the migration), `front-routes` (the flag, the body, the stream, the double tap, the 429, feedback, the admin view), `guard-limiter` (priority, fairness, bounded queues, 429 with place), `guard-idempotency`, `guard-breaker` (open, half-open, close, and the gateway skipping an open model), `guard-timing`, `guard-sites` (coalescing at the web tools, the kit and the brain), `guard-routes` (the guards on the artifact, job and code routes), `tool-descriptions` (the agent's tool definitions, `docs/principles.md`), and the principles tests for the six new roles and four new principles.

**Needs a live check** (nothing here can know):

* the **real model slugs and prices** behind the tiers: the costs in section 10 are from the tier table, and the breakers act on the real providers' failures;
* **running `0033_front_decisions.sql`** in Supabase before turning the flag on if the log is to be kept (without it, the log is in memory);
* **Mermaid, chart and component artifacts** rendering in the viewer from the front door, and the **vision** tier reading a real picture;
* the **limits per instance**: the right `GUARD_*` numbers depend on how many instances run and on the providers' rate limits;
* the **real model on the code roads**: whether a cheap model keeps to `path:line` and to what it was shown (the citation check takes out what it invents, but a model that cites nothing is a poor answer), whether the "deep" words (`chat/question.ts`) send the right questions to the strong tier, and what a free-form job costs on a real model (`docs/code-chat.md`, `docs/code-agent.md`);
* the **main assistant** as a handler for chat: left as it is; the seam is `HandlerDeps.assistant`.
