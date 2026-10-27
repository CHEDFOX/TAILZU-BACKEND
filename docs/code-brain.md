# The Code bot's brain, layer 1: models, money, classifying and routing

The Code bot works on a person's repo in **jobs** (`docs/code-router.md`). Layer 1 of its brain is everything underneath the thinking: which model to ask, what it may cost, what kind of request this is, and which tier of model each step deserves. It lives in `tulmi/src/code/brain/`. **Layer 2, the loop that plans, writes and reviews, is the agent loop (`docs/code-agent.md`, layer 8)**; it calls the five things below and nothing else for a model.

```
tiers.ts      which OpenRouter models do which kind of step        (CODE_MODEL_TIERS)
gateway.ts    callModel(): the one door to a model                 (ladder, retry, JSON, budget, ledger)
classify.ts   classifyRequest(): what is being asked               (rules first, a tiny model if unsure)
route.ts      routeStep(): which tier and model for a step         (climbing, budget, learning)
stats.ts      recordOutcome(): what the router learns              (migration 0025)
money.ts      paise, before a call (worst case) and after it
spend.ts      a job's spend and budget, read and added to safely
```

Nothing in it reaches the network or a store unless it is called to, and every piece takes its dependencies as arguments (the OpenRouter client, the job store, the ledger, the clock), so the tests run all of it against a fake OpenRouter.

## 1. Tiers

The brain never names a model at a call site. It names a **tier**, the kind of job:

| Tier | For | Default ladder (tried in this order) | Thinks | Writes at most |
| --- | --- | --- | --- | --- |
| `tiny` | classify and route | `openai/gpt-6-luna`, `anthropic/claude-haiku-5.5` | none | 600 |
| `cheap` | search, summarise, index | `deepseek/deepseek-v4.1-flash`, `google/gemini-2.5-flash`, `anthropic/claude-haiku-5.5` | none | 2,000 |
| `code` | normal code writing | `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`, `anthropic/claude-haiku-5.5` | medium | 8,000 |
| `strong` | plans, architecture, hard or risky changes | `anthropic/claude-sonnet-5.5`, `openai/gpt-6.1-sol` | high | 16,000 |
| `review` | a second opinion on code | a **pool**, below | low | 4,000 |
| `vision` | reading a picture | `google/gemini-2.5-flash`, `anthropic/claude-haiku-5.5` | none | 2,000 |
| `indic` | wording in Indian languages | `CODE_INDIC_MODEL` if set (the cheap ladder behind it), else the cheap ladder | none | 2,000 |

**The slugs must be checked against OpenRouter's live model list before launch.** They are the intended picks, and so are the prices below; neither is a promise. A slug OpenRouter does not know fails with a 4xx before any output and the ladder moves on to the next, so a wrong name is slow and a little wasteful, never wrong.

Each tier also carries a timeout (15 s for tiny up to 120 s for strong) and a price estimate in US dollars per million tokens in and out, set to the **dearest model on the ladder** ($1 / $5 for the Haiku-class tiers, $3 / $15 for strong and review). The estimate is only for deciding, before a call, whether the job can afford it. What a call really cost is read off OpenRouter's answer.

**The review pool.** Review is always a different model family from the writer's, because two models of one family share blind spots. The pool is `anthropic/claude-haiku-5.5`, `google/gemini-2.5-flash`, `deepseek/deepseek-v4.1-flash`, `anthropic/claude-sonnet-5.5`, and the reviewer is the first whose family (the vendor prefix of the slug) differs from the writer's: a DeepSeek or GLM writer is reviewed by Haiku, a Haiku or Sonnet writer by Gemini, a Gemini writer by Haiku. If the pool has nothing of another family, the router answers `{ stop: "no_reviewer" }` and `callModel` throws `ModelUnavailable`; it never falls back to the writer's own kin.

### Changing them without a deploy

* `CODE_MODEL_TIERS`: a JSON object keyed by tier, each value any of `models`, `maxTokens`, `reasoning` (`none`, `low`, `medium`, `high`), `timeoutMs`, `usdPerMIn`, `usdPerMOut`, merged over that tier's defaults, field by field. A `models` list **replaces** the ladder.

  ```
  CODE_MODEL_TIERS={"code":{"models":["deepseek/deepseek-v4.1-flash","z-ai/glm-5.3-flash"],"reasoning":"high"},"tiny":{"timeoutMs":8000}}
  ```

  A value that is not JSON, a tier that does not exist, a field the code does not know, a value out of range: that tier (or the whole variable) is **ignored with one warning** at the first call. The defaults are always a working configuration, so a typo costs a warning, never the server.
* `CODE_INDIC_MODEL`: the first model of the indic tier. The indic tier otherwise follows the cheap tier, overrides included. An `indic` entry in `CODE_MODEL_TIERS` beats this.
* `CODE_USD_INR`: rupees to the dollar for turning OpenRouter's charge into paise. 88 unless set.

Reasoning goes out in OpenRouter's form. For `none` it is exactly what the planner sends (`agent/llm.ts`): off where a model can be turned off (with Anthropic's explicit switch too), and `low` for the models whose thinking cannot be (they refuse `none` with a 400 before writing a word).

## 2. `callModel()`: the one door

```ts
const r = await callModel({
  tier: "code",                  // or model: "some/slug", or both (the model first, then the rest of the tier)
  messages, tools, toolChoice,   // the OpenAI chat shape
  json: PlanSchema,              // a zod schema, or true for any JSON
  maxTokens, timeoutMs,          // the tier's unless given
  jobId, userId, step,           // whose money, whose hash, which step
  purpose: "plan",               // a word for the log and the ledger
  budget: "job",                 // "job" | { maxPaise } | "none"
  writerModel,                   // the review tier only
}, deps?);
// r: { text, json, toolCalls, model, tier, promptTokens, completionTokens, costUsd, paise, costSource, truncated, ms, calls, trail }
```

* **Always through `openrouter()`**, asking only for providers that neither keep nor train on what they are sent (`provider.data_collection: "deny"`, as the planner does), with usage accounting on so the charge comes back with the answer. The person is sent as a **hash** (`user`), never their id.
* **The ladder.** The models are tried in order; the next is tried when a call fails before it answers: an HTTP error, a refused parameter, the tier's timeout, an answer with nothing in it, an error hidden in a 200's body, or JSON that could not be made valid. Unlike the planner's ladder, nothing is on a screen while it is written, so any failure may move on. The answer is read whole, not streamed. `r.trail` says what happened to each model (never any content).
* **One transient retry** per model: a 429 or a 5xx is tried again on the same model after a jittered wait (half to one and a half times 500 ms, or the `Retry-After` header, at most 5 s). A 400, a 404 or a timeout is not retried. Then the ladder climbs.
* **JSON.** The answer is parsed (a code fence or a line of preamble is tolerated) and, given a schema, validated. A bad answer gets **one repair**: the same model is shown what it wrote and what was wrong and asked again. If that fails too, the ladder moves on. `json` and `tools` cannot be used together.
* **Timeouts.** The tier's `timeoutMs` per call; the hung call is aborted. A caller's `AbortSignal` ends everything at once, climbing no further.
* **Errors the caller meets:** `BudgetExceeded` (below), `ModelUnavailable` (every model failed; carries the trail), `AbortError`, and a plain `Error` for things that are the caller's (no such job, the job store down: with the budget unchecked, no call is made).

### Money

Before **every** call, a retry or a repair included, the worst case is estimated: the input at about 3.5 characters a token (a picture counts as a flat 1,200 tokens), plus all of `maxTokens` written, at the tier's prices, converted to paise at `CODE_USD_INR` and rounded up. If the job's `spent_paise` plus that estimate would pass its `budget_paise`, the call is **refused with `BudgetExceeded`** before anything is sent; it carries `needPaise`, `spentPaise`, `budgetPaise` and `leftPaise`, so a caller can ask for less (a smaller `maxTokens`), or stop. A call that lands exactly on the budget is allowed.

`budget` says how a call is held:

| `budget` | Meaning |
| --- | --- |
| `"job"` | the job's own budget (needs `jobId`) |
| `{ maxPaise }` | this call, all its attempts and repairs together, may cost at most that; with a `jobId` the job's budget applies as well |
| `"none"` | no ceiling, for the bot's own housekeeping with no job behind it |

With a `jobId` the job's budget is **always** enforced; it is the person's money.

After a call the cost is read from `usage.cost` (OpenRouter's own charge, in dollars); only if that is missing is it estimated from the tokens reported and the tier's prices, and failing even that, from the characters written (`costSource` says which). A call that was billed and then thrown away (an empty answer, a JSON answer that did not hold up) is still counted. The paise are added to the job's `spent_paise` with a compare-and-set on the spend itself, so two calls finishing together both count (`spend.ts`).

> **One number covers a job's money.** `budget_paise` and `spent_paise` already carry what the person allows for paid compute (`docs/code-router.md`, section 2). Model calls draw from the same budget. A job created with a budget of 0 sent on purpose refuses every model call; a job created with no budget at all gets the server's default (`CODE_JOB_DEFAULT_BUDGET_PAISE`, 3,000 paise), so that it can do its work (`docs/code-agent.md`).

### What is logged and kept

A log line has the **model, the purpose, the tokens, the milliseconds and the paise**. Never a message, an answer, or the words of an error (an error is logged by its status and kind). When the run ledger is on (`AGENT_RUN_LEDGER`), every call, failed ones too, is also written to `agent_calls` as a `CallRecord` under the run id `code:<jobId>` (`code:<purpose>` with no job), the same rows the Ask runs write: model, time, tokens, charge, never content. The surface column only allows `phone` and `desktop`, so these say `desktop`; the run id tells them apart.

## 3. The classifier

`classifyRequest(text, { repoEmpty, projectSummary?, recentFailures? })` answers:

```
type        question | small_edit | bug_fix | feature | refactor | plan_project | research | find_resource | web_task | other
difficulty  low | medium | high           risk  low | medium | high
needs       { web, exec, vision, indic }  language  en | hinglish | hi | other
confidence  0..1 (how sure the type is)   signals  short ids, never the text
```

**It decides cheapest first.**

1. **Rules, for nothing.** English, Hinglish and Hindi keyword patterns ("fix", "error", "bug", "add", "banao", "website", "from scratch", "library", "package", "research", "compare", "book", "fill the form", "ठीक करो", "फॉर्म भरो", and so on). Evidence for a type combines, and a rival type that also scored takes away from the confidence: "how do I add dark mode?" is a question and a feature at once, and the classifier says it is not sure.
   * A **stack trace or error text** is a bug, and the web is plausibly needed to look it up (`needs.web`; `needs.exec` too, to reproduce it).
   * An **empty repo plus a request to build** is `plan_project`, however it is worded.
   * **Devanagari** is Hindi, and needs Indian-language wording (`needs.indic`). Hinglish (Hindi in Latin letters) is `hinglish`; other scripts are `other`.
   * **Sensitive words** raise the risk: payment, password and secrets, a database migration (high); login and auth, delete, production (medium); two different kinds at once, or deleting something big, is high.
   * Code blocks are not read as words, so a `throws` or a `password` inside a snippet decides nothing (error text is still looked for in the raw text, snippet and all).
2. **A tiny model, only when the rules are not sure.** Below **0.7** the `tiny` tier is asked, held to a strict JSON schema (a field it was not asked for is a bad answer, and gets the gateway's one repair), and the two are merged: **the model wins on the type, the difficulty and the confidence; the rules can only raise the risk; the needs are what either found; a language the rules could see in the letters stands.** The request is sent fenced as data, with a line about the project and the last failures, so a request that says "ignore your instructions" can do no more than choose a category. A model that is down, over budget or will not produce valid JSON costs only certainty: the rules' own answer comes back, flagged `model_failed`. `classifyRequest` never throws.
3. **A cache.** The same request (and the same empty-repo state) within **ten minutes** is answered from memory. The key is a SHA-256 of the text and that state; the text is never kept.

Without a `jobId`, one classification may cost at most 100 paise (the tiny tier's worst case is about 40). With one, it is charged to the job.

## 4. The router

`routeStep(step, classification, history, opts?)` is a pure function of what it is given and answers `{ tier, model?, reason }` or `{ stop, reason }`.

| Step | Tier |
| --- | --- |
| `classify` | `tiny` |
| `search`, `summarize`, `index` | `cheap` |
| `research` | `cheap` when difficulty is low, else `code` |
| `plan` | `strong` when difficulty **or** risk is high, or the request is a `plan_project`; else `code` |
| `write_code` | `strong` when risk is high; else `code` |
| `review` | `review`, with `model` the first pool model of a different family from `history.writerModel` |
| `vision` | `vision` |
| `indic_text` | `indic` |

(`research` was not in the first design's table; it reads and weighs several things, which suits code's thinking, and an easy lookup does not need it.)

**Climbing.** A step that is going badly moves **up one tier** on the ladder `tiny, cheap, code, strong` when `history.failures >= 2`, or `lowConfidence`, or `filesTouched > 10`. It climbs one tier from the higher of the step's own tier and `history.lastTier`, so a step that failed twice on code goes to strong and then stays there. It never climbs past strong. Review, vision and indic are not on the ladder and do not climb. (Tiny climbing to cheap is an addition to the cheap, code, strong ladder that was asked for.)

**Budget.** With `opts.budget = { remainingPaise, inputChars?, fx? }`, if the remaining budget cannot afford the chosen tier's worst case, the router takes the **cheapest tier that can still do the step**: a plan or write_code never goes below `code`, a classify may go to `tiny`, a search never below `cheap`. If even that cannot be afforded, it answers `{ stop: "budget" }`, and the caller ends the job or asks for more money. Review, vision and indic have no cheaper tier that can do the same job, so they stop. The router never chooses a call the gateway would refuse.

**Learning.** See below. `planRoute()` is `routeStep()` with the record read from the store first; a store that cannot be read means the default order.

## 5. Learning

After a step, `recordOutcome({ taskType, step, model, success, paise, ms })` adds to one row of **`code_route_stats`** (migration `0025_code_route_stats.sql`, also in `full_schema.sql`): `task_type` (the classifier's type), `step`, `model`, `successes`, `failures`, `paise_total`, `ms_total`, `updated_at`. What counts as a success is the caller's to say (the tests passed, the reviewer accepted it); this only counts. It never throws and never holds a job up: a store that is down (or the migration not run) costs the router its learning, not the job its step.

Within the chosen tier, `routeStep` may reorder the ladder: the **cheapest** model (paise a try) whose success rate is **at least 0.85 with at least 20 tries** is named first in `model`. Below that, or when no model has earned it, the default order stands and `model` is left out. Only models on the tier's ladder count, and for review only those of a different family from the writer. Both thresholds live in `stats.ts` (`MIN_SAMPLES`, `MIN_SUCCESS_RATE`).

The table keeps only counts, the same for everyone: nothing about who asked or what was asked. Row-level security is on with **no policy**, and the function that adds an outcome (`code_record_route_outcome`, one statement, so two steps ending together both count) is closed to everyone but the service key.

## 6. Setting up

1. Optionally run `tulmi/supabase/migrations/0025_code_route_stats.sql` (or `full_schema.sql`) after 0024. Without it the router keeps its default order and logs that an outcome was not recorded; nothing else depends on it.
2. Set `OPENROUTER_API_KEY` (already needed). Optionally `CODE_MODEL_TIERS`, `CODE_INDIC_MODEL`, `CODE_USD_INR` (`.env.example`).
3. **Before launch, check every slug and price above against OpenRouter's live model list.**
4. Privacy policy: OpenRouter is sent the messages of a job (to providers that do not keep or train on them) and a hash of the person's id. Tailzu keeps no message or answer; per call it logs the model, purpose, tokens, time and paise, writes the same to `agent_calls` when the run ledger is on, and adds the paise to the job's `spent_paise`. `code_route_stats` holds only counts per request type, step and model.

## 7. Known limits

* The slugs and prices are unchecked (above), and the estimate is one price per tier, the dearest on its ladder: a cheap model's call is reserved at the dearest model's worst case. That is safe, not exact.
* Calls are not streamed. Tier timeouts stay at or under two minutes; a model that takes longer needs streaming, which a later layer can add without changing the callers.
* The job router writes `spent_paise` as an absolute number when a paid step reports its result (`jobs/router.ts`), so a model call that finishes in that same instant can be lost from the total: at most one call's price, in the person's favour.
* Costs round up to the paise per call, so a job's spend can read a few paise high, never low.
* The classifier's rules are keyword rules; the tiny model is what reads what they cannot. The rules table in `tests/code-brain-classify.test.ts` is where a miss is added as a case.

Tests: `tulmi/tests/code-brain-{tiers,gateway,classify,route,stats}.test.ts`.
