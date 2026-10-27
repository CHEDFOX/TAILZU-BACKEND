# Talking about code: asking a project questions

A developer asks the Code bot about their own project: "where is the session cookie set?", "how does login work?", "what would break if I rename `startSession`?", "why is checkout slow?". The answer has to be **quick** (it is a chat, not a job), **cheap** (most of these are lookups), and **true** (a made-up file or line number does more harm than no answer). This is `tulmi/src/code/chat/`; the front door's `code_answer` road calls it (`docs/front-door.md`, `src/front/handlers.ts codeAnswerDefault`). No npm dependency was added.

```
tulmi/src/code/chat/
  question.ts   what kind of question it is, and whether it is a deep one, read for nothing
  answer.ts     the brain first, a few reads only when it must; one call of the front_code_answer role
  cite.ts       every path:line in the answer is checked against what was seen; the rest is taken out
  flow.ts       a flow drawn from the import graph, as Mermaid, by code
  threads.ts    the conversation's rolling summary, and what the last answer found (migration 0034)
  handoff.ts    "ok, change it": a job that starts with the place the conversation found
  index.ts      CodeChat: the object the front door holds
```

## 1. The roads an answer can take

```
 the question ─► readQuestion (kind, deep, wantsCode, flow)         free: patterns in English, Hinglish and Hindi
              ─► locate (work/locate.ts)  from the brain's INDEX ALONE: no file is read to find out where
                    │
                    ├─ sure of the files, and the index says enough about each ───► FAST: the model is sent FACTS (summaries, symbols, the graph, the tests)
                    │       a "where" and a "what" nearly always; a "how" when the graph shows the flow;
                    │       NO FILE IS READ
                    │
                    ├─ not sure, or a "why", or the code itself was asked for ────► READ: the located spans only, 3 files and 5,000 characters at the most,
                    │       through the job's room (grep + read, no GitHub call) when the person has one open, else through GitHub.
                    │       A sentence in the notes when it was not sure which part of the code it is
                    │
                    └─ nothing matched ───────────────────────────────────────────► OVERVIEW: the project's overview is the basis, and the answer says so
              ─► one call of the front_code_answer role, at the tier the front door's decision named
              ─► every path:line in the answer is checked; what does not resolve is taken out
              ─► a flow diagram, drawn from the graph, when the decision planned one
              ─► the thread keeps one more line, and where this answer found the code
```

**Never read:** a secret file (`.env`, keys, credentials: `isSecretPath`), a file nothing pointed at, a file the secret scan flags. What the person typed goes through the same scan before the model sees it. Everything sent to the model is data, fenced, in the role's one stable block plus the question; the answer role is told to change nothing and to propose no edit unless asked.

**"Sure"** is `CONFIDENT` (0.75) from the locate scores, with the files named and no question to ask. A question that only mentions a feature ("where is the session cookie set?") is often not sure: it takes the READ road and says so. A question that names a symbol ("where is `startSession` defined?") is.

## 2. Kinds, and which tier

`readQuestion` (pure, free):

| Kind | Looks like | Road |
| --- | --- | --- |
| `where` | where, which file, kahan, कहाँ | FAST when sure |
| `what` | what is/does, summarise, overview | FAST when sure |
| `how` | how does, flow, walk me through, kaise | FAST if the graph shows the flow, else READ; draws a diagram |
| `why` | why, root cause, kyun | READ always: the reason is in the code, not in a summary |
| `impact` | what would break, who uses, safe to rename | FAST from the graph and the test map (`work/impact.ts`): importers, routes, tests to run, what no test covers |

`wantsCode` ("show me the exact code", "line by line") also takes the READ road. **Cheap by default.** The **strong** tier only for a **deep** question: an `impact` question, or a why that is about performance, memory, races, timeouts, flakiness or regressions (`deepCodeQuestion`). Those are where a cheap model's answer is most often confidently wrong. The front door's `decide` asks `deepCodeQuestion` and writes the reason (`code:deep`) in the decision, so the tier and the budget are the decision's and not the chat's.

## 3. Every claim cites `path:line`, and a citation that does not resolve is stripped

The role is told to cite the files and lines the answer rests on (principle `code.cite`). A model sometimes cites a line that is not there, or a file the project does not have. After the answer is written, **every `path:line` (or `path:a-b`) in it is checked against what Tailzu actually saw**:

* a file it **read**: the path, and the file's exact line count (a line past the end is not a line);
* a file the **brain knows**: the path, and a line the brain itself named (a symbol's, a visible text's) or any line a file of that many bytes could have; line 1 always.

A citation that resolves stays. One that does not is taken out of the text, with the brackets it was in, and the answer's `notes` say "I took out 2 references to code I could not find." Nothing is dropped silently, and the citations that stayed are listed (`cites`) for the app to link.

## 4. A flow, drawn by code

When the decision planned a diagram ("how does login work" is a flow), `flow.ts` follows the import graph from the files the question is about: who calls the entry (one hop up), what the files call (a hop or two down, best connected first), never a test or a secret, **at most 10 boxes** (the diagram role's own limit is 12). Each box is a file and the most telling thing it exports (a route, a component, a class, a function); each arrow reads "uses". It is `flowchart TD` Mermaid text, the app draws it. **No model is asked and it costs nothing**; a graph that shows fewer than two files, or no edge, draws nothing.

## 5. The conversation

Each chat has a **thread** (an id the app makes, `threadId` on the front door's context). A thread keeps, per person and per project:

* a **short rolling summary**: one line per turn, "the question (the files its answer rested on)", the last 5 turns, at most 1,200 characters, the oldest line falling off first. It holds questions and paths, not code and not the answers' words. The model is shown it as data (`<thread>`), so "and where is the logout?" means something;
* the **last question**, the **citations** that stayed, and **where the answer found the code** (`located`, the same shape the agent's locate phase produces).

A short follow-up ("and where is it cleared?", "what about the tests?") is looked up **together with the question before it** (`isFollowUp`), so the search is for the right thing; a question that stands alone is looked up as it is. Without a `threadId` nothing is kept. Another person's thread id, or another project's, is simply not found.

The table is `code_chat_threads` (migration `0034_code_chat_and_care.sql`; run it after `0033` before turning code answers on for people who will ask follow-ups). Behind one interface with a **memory twin**, as the other stores are: Supabase when the service client exists, else memory (tests, local runs; a restart forgets). Written with the service key only; a person's own token can read their own rows. The summary is cut to the column's limit of 2,000 characters.

## 6. "Ok, change it"

Talking about code ends, often, in "ok, change it". Started as an ordinary job, that would **look for the place again** (the locate phase) and might not find the one the conversation did.

The front door's rules see that a short "ok, change it" / "go ahead and fix that" / "haan, isko badal do" follows a question about the code and make it a `code_task` with `decision.handoff` and the earlier question as its follow-up base. The job handler then asks `CodeChat.handoff(userId, projectId, threadId, message)`:

* the **task** says what the person now asks (their own words), what they asked about before, and the file names the conversation found, and tells the job not to look again; none of the answer's prose goes into it;
* the **located** files go to the job as `located`, marked `locatedFrom: "chat"`. The agent's locate phase takes them **as they are** (`state.handoff`), exactly as it does for a design the person approved: no search, no question, straight to the plan.

A thread that found nothing hands over nothing: the job looks for the place as any job does.

## 7. What it costs

One model call at the tier the decision named, plus the locate call when the words alone do not settle it (up to 60 paise). The FAST road is **one** call: the facts are about 400 to 1,500 characters. The READ road sends at most 5,000 characters of excerpts. The diagram and the citation check are free. The budget is the decision's (`docs/front-door.md` section 10): a cheap answer about 111 paise in the worst case, a strong one 211; the gateway refuses a call whose worst case would pass what is left, so the cap is kept and not hoped for.

## 8. Tests, and what needs a live check

`tests/code-chat.test.ts` holds down: the fast path (facts to the model, no file read, citations that were seen); the read path (only located spans, never a secret or an unpointed file, the job's room instead of GitHub); citations stripped (a missing file, a line past the end) with the note; the flow from the graph with no model call; the follow-up (the thread's summary as data, the search together with the earlier question, the rolling limit); "ok, change it" (the located files go to the job as the chat's, and the agent runs without asking `work.locate`); the tier. `code-care-stores.test.ts` has the thread store (memory and Supabase twins) and migration 0034. `front-decide.test.ts` has the deep tier and the hand-off words; `front-handlers.test.ts` the road. The prompt: the `front_code_answer` role and its fixtures in `evals/front_code_answer.jsonl` (`docs/principles.md`).

**Needs a live check** (nothing here can know):

* **A real model keeping to `path:line` and to what it was shown.** The check takes out what it invents; a model that cites nothing, or only line 1, is a poorer answer than the test can see. Run `scripts/eval-prompts.ts` with a key, and read real transcripts.
* **The deep-question words** (`DEEP_WHY`, `IMPACT`) against real questions, in Hinglish and Hindi especially: a deep question sent to the cheap tier is a wrong answer said confidently; a plain one sent to the strong tier is money.
* **`CONFIDENT` (0.75)** and the FAST road on a big real project: how often the index is enough, and how often a FAST answer was wrong where a READ would have been right.
* **The job's room** (`rooms` port): reading and grepping through a live session's copy of the code, on a real desktop and on GitHub's computers. The chat's side is tested against the room's own shapes.
* **Running migration `0034`** before relying on threads; until then a restart forgets the conversation (and "ok, change it" starts a job that looks for the place itself).
