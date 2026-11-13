# The call judge

An AI reads every item added to or changed on a person's Plan and decides whether it is important enough for a **phone call** ("X0 is
calling", `docs/plan-ease.md` "Calls"), and when. Everything it judges necessary gets the call. This page is for the owner: what it
judges, the rules that stay as a floor, the prompt, the table, the logs, and how to roll it out.

It is **off** (`PLAN_CALL_JUDGE=false`) and works for nobody until `PLAN_CALL_JUDGE_ALLOW` names people (comma-separated user ids; empty
is nobody, `*` is everyone). Nothing in the code turns it on.

Code: `tulmi/src/botsBots/planCallJudge.ts` (the service), `planCallJudgeWords.ts` (the prompt, the answer, the timing: pure),
`planCallJudgeStore.ts` (the table), `routes/bots/planCallJudge.ts` (boot wiring, no routes), migration
`tulmi/supabase/migrations/0086_plan_call_judge.sql`, tests `tests/plan-call-judge-words.test.ts` and `tests/plan-call-judge.test.ts`,
the eval `tulmi/scripts/plan-call-judge-eval.ts`. The one file the judge and the call service share is `botsBots/planCallSeam.ts`.

## There is no money limit

The owner's answer: the AI reasons about everything added, calls only what it judges important enough, and **there are no limits**.

- A judged call is **not** counted against Plan Ease's day budget (the 8 rupee budget), the person's spend gate or their plan, and it is
  never refused, shortened or stopped for money. The judge's own reads are not charged to anyone either.
- What each judgement cost is **recorded** on its row (`usd`) for the owner to read, and nowhere else. No code reads it back to decide
  anything.
- There is **no cap on how many judged calls a person gets in a day**: everything the judge finds necessary rings. The only limits are
  technical: the call's idle end, a hard maximum length against a stuck session (15 minutes), the person's AI permission (no session
  without a yes), and no second call about the same item inside an hour (`item_recent`).

## Who it works for

For a person only when **all** of these hold, checked before every model read and again before every ring:

1. `PLAN_CALL_JUDGE` is on and they are on `PLAN_CALL_JUDGE_ALLOW`.
2. Calls are switched on (`BOT_CALLS` with Plan Ease's app and reminders steps).
3. **Their own Calls setting is on** (You, What pings you). It is their choice: with Calls off nothing is judged and nothing rings.
4. **They said yes to AI.** Without a yes the judge sends nothing anywhere and keeps nothing. Taking the yes back deletes every judgement
   of theirs at once (the seam's `onAiConsentOff`).

## What it judges

The person's own events and to-dos (to-do, bill, waiting on someone), whatever wrote them: the chat, the app, "Plan something", a
capture, the box, a meeting's to-do, a space's task landed on their days. One hook in `calendar/service.ts` hears every write
(`setChangeHook`); nothing in the callers changed.

- Not sent to the AI: a to-do with no day (stored `off`, "no time"), an item that is done, a one-off whose time has passed (`past`).
- A repeating event is judged **once per series** and rings each start.
- A burst of writes ("Plan something" adds then sets Who; a capture's five rows) is one judgement per item: it runs 15 seconds after
  the last change, and never later than 60 seconds after the first. **Done and Add never wait for the judge.**
- Once per change: a hash of the judged fields (kind, title, time and day, all-day, repeat, place, amount, payee, importance, people,
  done, the first 200 characters of notes, tz). A snooze, a reminder, an update time is not a change.

## The AI's answer

Reasoning first, the verdict after:

```json
{"reasoning": "...", "call": true, "at": "leave_by", "why": "A flight they can't miss; a call when it's time to leave."}
```

- `call`: whether this item gets a call.
- `at`: `leave_by` (10 minutes after the leave-by reminder, or 30 minutes before when no leave-by is known), `due` (the item's own time;
  10:00 on its day with no time), or `before:<5..1440>` minutes before.
- `why`: one line, at most 160 characters. Kept with the verdict and given to the call's bot as "Why it matters"; never said word for
  word, never in a push or a log.
- `reasoning` is thrown away: never stored, never logged.

The prompt is `JUDGE_SYSTEM` in `planCallJudgeWords.ts`. It names what deserves a call (money, health, travel, a hard-to-get
appointment, a child or older person waiting, must-not-miss, others counting on them) and what does not (routine and flexible things),
and says plainly that there is no limit on calls a day. Plan Ease's own cheap text tier reads it (`serverReaders().text`, the same
OpenRouter route captures use), with the person's AI gate, in its own cost tally.

## The floor stays

Today's rules still ring for everyone, with or without the judge: a leave-by, and a bill due today. A judged ring is skipped when it
would land within 15 minutes of a rule's own ring for the same start (the leave-by reminder's moment; 10:00 and 18:00 on a bill's due
day), checked when the verdict is written and again at ring time. **A verdict never refuses a floor or follow ring**: through the seam
a `call: true` only makes that ring `judged`, which skips the 3-a-day limit. The judge adds calls and picks their time; it never turns
a rule's call off.

## When a judged call rings

Every minute the tick finds rows with a due `next_ring_ms`, claims each (so two servers or two ticks never both ring), checks the person
again, reads the item again (gone or done: marked; changed since the verdict: no ring until it is judged again), checks the floor with
fresh leave-bys, and calls the seam's `ringItem` with the item's seed and lock-safe words (no amount, a health title is "Appointment").
`busy` and `too_soon` are tried again every 2 minutes for up to 20 minutes after the moment (and never past the item's time);
`item_recent` and every other `none` are not retried. No ringer installed (the call service not deployed yet): logged `none: no_ringer`,
nothing rings. A series then moves on to its next start.

Never right after a change (at least 10 minutes), never more than 5 minutes late.

On a live call the bot opens with a short, mild "Hello" in English and then follows whatever language the person speaks; that is the
call service's (`docs/plan-ease.md` "Calls"), not the judge's, and a turn call opens on the moment itself as it always has.

## The table (`plan_call_judgements`, migration 0086)

One row per item (`e:<event id>` once per series, `t:<task id>`) while the judge works for the person: the verdict, a one-line reason
and a hash; **never the item's text**. States: `judging`, `set`, `off`, `failed`, `done`, `gone`, `past`. Columns: `sig`, `call`, `at`,
`why`, `usd` (cost so far), `tries`, `next_ring_ms`, `ring_key` (the occurrence `next_ring_ms` is for, then the one it rang:
`plan_calls.source_key`), `changed_ms`, `judged_ms`, `updated_ms` (every write after the insert is a compare-and-swap on it).
RLS on, no policies: only the server. Deleted with the account, when the person takes back their AI yes, and 30 days after an item
went. **Run migration 0086 before turning the judge on** (it needs 0081 and can be run again).

## Failure

A model error, a timeout or bad JSON leaves the item `failed`; the fill tries again after 10 minutes, 3 times at most per change. A
crash in the hook never touches the write. A restart loses only settles still waiting: the **fill** (every 15 minutes) judges anything
in the next 36 hours it has no verdict for, retries failed ones, and deletes old `done`/`gone`/`past` rows. Meanwhile the floor rings
as always. Failure never costs a call the rules would make.

## Privacy and logs

- What leaves the server: only with the person's AI yes, inside `asPerson` (the fetch guard asks too), to the same text services Plan
  Ease's chat and captures use: the item's facts and its day, fenced as information (a title cannot close a fence or give an order).
- What is kept: the verdict, one line of reason, a hash. Not the item.
- Logs never hold a title, place, name, amount, note, `why` or `reasoning`. Lines: `[judge] set|off|failed|past` with `{item:
  sha256(user+item)[0..8], kind, call, at, ms, usd, sig[0..8]}`, `[judge] rang|none|floor` with `{item, lead, none?}`, `[judge] fill` with
  `{people, items, queued, failed, cleaned}`. A test spies the logger.

## Rollout

1. Run migration 0086. Deploy after the call service (it installs the ringer).
2. `PLAN_CALL_JUDGE=true` and `PLAN_CALL_JUDGE_ALLOW=<team ids>` for a week.
3. Watch the `[judge]` lines: the share of judged items that get `call` (expected 5 to 20 percent), judged rings per person per day
   (median 2 or fewer), the `none` mix, `failed` under 2 percent, and `usd` per judgement.
4. Run `npx tsx scripts/plan-call-judge-eval.ts` on a dev box with the key in `.env` after any prompt change: it passes at 28 of 30
   clear items right and 13 of 15 call times inside their window, with every answer parsing. It prints counts only.
5. Then `PLAN_CALL_JUDGE_ALLOW=*`.
