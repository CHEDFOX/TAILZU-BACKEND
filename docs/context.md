# The person's context (`tulmi/src/context`)

The one key's brain and Ask used to start every request nearly blank: the screen, the run's own steps, the last 3 asks the computer sent. The context is a short block of what X0 knows of the person, built on the server, so a follow-up ("send it to Dev too") and "message Riya" (which app) work from any of their computers.

| Section | What is in it | Where it comes from |
|---|---|---|
| You | name, language, time zone, what they told their bots; each marked `confirmed` (they said it), `found` (their settings, the device) or `guessed` | the profile (`profile/store.ts`), the request's offset, the bots' shared facts (`bots/shared.ts`), the script of their asks |
| People | who they message and through what, how often, when last | learned from `/v1/ask/decide` answers with `do: send` and `to` |
| This conversation | the last 6 asks in full (said, did, to, via, what it meant), older ones folded into one line before them | kept from `/v1/ask/decide` |
| Open work | routines on or needing them, Xode's questions, connected apps' calls waiting for a yes | read live (`routines/`, `code/jobs`, `connectors/tasks.ts`), never kept |
| Recent results | what X0 did lately: an Ask run's last words on the ask it came from, a routine's last run | `/v1/agent` when a step ends with DONE; the routines' rows |

## How it is built (Xode's way, `code/agent/context.ts`)
1. **One builder.** `contextFor(userId, { now, tz, about, max })` returns `{ text, parts, trimmed, turns }`. The sections are always in the order above, each only when it has something.
2. **A hard cap.** `CONTEXT_MAX_CHARS` (2,000). Over it, cut in this order: the folded summary, then the older asks (the newest two stay), then the guessed facts, then the people past the first three; still over, lines go from the end. What was cut is in `trimmed`.
3. **Never throws.** Each source is read on its own within 500 ms; one that fails or is slow leaves its section out.
4. **Data, never instructions.** Every value is one line, a secret is withheld (`forModel`), our fences are broken (`neutral`). The decide prompt fences it in `<<< >>>` ("What X0 keeps about them"); Ask's planner gets it in `<context>` with a line saying it is data.
5. **Folding is by rule.** An ask that leaves the last 6 becomes "send to Riya: the mockups…" in the summary, and the oldest pieces drop once it passes 400 characters. No model is called for it.

## Where it is used
- **`POST /v1/ask/decide`**: the block goes into the prompt; the computer's own `last` is used only while the server has kept no asks. The decided ask is kept after the answer (not for a private field, X0 Bot's own window or empty words). The body may carry `tz`.
- **`POST /v1/agent`**: at a run's first step only, the block goes into the planner's message (`agent/prompt.ts`); later steps have the run's history. A step that ends with DONE puts its SAY words on the matching ask from the last half hour.
- **`POST /v1/talk`** (docs/talk.md): the block goes to the brain and to the answering model; each turn is kept as an ask, and a spoken answer as its result, under the same rules. Clearing the context clears the person's talks too.

## What is never kept
Nothing from a private field, X0 Bot's own window, a sensitive app (`pipeline/sensitive.ts`) or a picture step; nothing that looks like a secret, a password or a code (`code/policy.ts` scanForSecrets, and the words by name); nothing at all while Settings › Privacy "Use what you've told your bots" is off (`privacy.personalise`), and then nothing learned is shown either.

## Kept and forgotten
Migration 0065 (`person_context`): one row per person, written with the service key only, gone with the account. Without it, memory. At most 30 people and 6 asks.

- `GET /v1/context?tz=` what is kept, and the block a model is shown now
- `DELETE /v1/context` everything; `DELETE /v1/context/people/:name` one person; `DELETE /v1/context/turns` the asks and their summary

All are the signed-in person's own. `CONTEXT=false` turns it off. What the bots were told has its own routes (Settings › Privacy).

Tests: `tulmi/tests/context.test.ts`.
