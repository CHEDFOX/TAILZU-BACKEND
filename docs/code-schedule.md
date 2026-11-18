# Scheduled code work: a project's standing job, started by the clock

"Every Monday, update the dependencies, run the tests, and open a pull request if they pass." Nobody has to be there. It is the thing a bot that
lives on a server can do and a bot that lives in a terminal cannot: the work outlives the person's attention.

It is `tulmi/src/code/schedule/`. No npm dependency was added.

```
tulmi/src/code/schedule/
  store.ts    the table (migration 0095, code_schedules): Supabase, with a memory twin and the one-store factory
  index.ts    CodeSchedules: create, list, update, remove, run now, and the tick that starts what is due; startCodeSchedules (every minute)
tulmi/src/routes/code/codeSchedules.ts   the five routes, and the deps that cut a branch and make a job
```

## 1. Why it is not a routine

A **routine** (`src/routines/`, migration 0062, `docs/routines.md`) runs a **bot's turn**: one ask, one answer, a few paise. Its own row says in so many
words that Xode is not one of them, because "its work is a job". A **job** is longer, spends real money, runs commands on a computer and ends in a pull
request. So this is routines' **sibling**, not a case of it: its own table, its own budget a run, and its own guards.

**What is reused** is the schedule itself (`routines/words.ts`: `Schedule`, `cleanSchedule`, `nextRun`, `scheduleWords`), because the maths of "every
Monday at 9 in the person's own time" is the same maths and was already right. **Nothing else is.** A run makes a job through the ordinary door, so the
policy, the budget, the staged changeset, the checks before the commit, the review (`docs/code-agent.md` section 4d) and the pull request are exactly a
person's job's.

## 2. What one run does

0. The run is **taken** first: the clock is moved on in one write that holds only while `next_at` is still what the tick read
   (`store.claim`, the row's own compare-and-set), so **two servers ticking the same minute start it once**. "Run now" is the person's own
   press and takes nothing.
1. The **project** is still there and still the person's, or the schedule pauses itself at once with the reason.
2. A run whose **last job is still working** is skipped: **one job at a time** a schedule, so a weekly job that takes two days cannot pile up.
3. A run more than **`LATE_MS`** (three hours, routines' own figure) late — the server was down — is **skipped**, not run long after it meant anything.
4. A **work branch** is cut (`createWorkBranch`: free, it changes nothing that exists) and a job is made with **this schedule's own budget**. The
   schedule remembers which job it was, so the list can link to it.
5. **Three runs in a row that could not start** pause it, with why.

**The clock moves whatever happens**, so one bad run never blocks the next; only a run that could not be *started* counts as a failure. Nobody is
there when it runs, so nothing is attended: a job that needs the person **parks and pushes them**, exactly as any job does. A schedule sends no
notification of its own — it would be a second voice for the same work.

## 3. The routes

All the owner's own rows only (another person's is `404 not_found`, never forbidden), and all `404 schedules_off` where `CODE_SCHEDULES` is false or
this server has no Xode.

```
POST   /v1/code/schedules { projectId, task, schedule, tz?, budgetPaise? }  -> { schedule }  kept, on, its first run worked out
GET    /v1/code/schedules                                                  -> { schedules }  the person's own, newest first
PATCH  /v1/code/schedules/:id { task?, schedule?, budgetPaise?, status? }  -> { schedule }  a new task, time or budget; paused or resumed
DELETE /v1/code/schedules/:id                                              -> { ok: true }
POST   /v1/code/schedules/:id/run                                          -> { schedule }  once now, its own time untouched
```

`schedule` is `{ every, minute, days?, monthDay? }` as routines keep it, the minute counted in the person's own time with `tz` their offset east of
UTC. Resuming a paused one works its next run out **from now** and forgets what failed before. A run's budget is between 100 and 100,000 paise, 3,000
(₹30) by default — the same as a job's.

## 4. Limits

| | |
| --- | --- |
| `SCHEDULES_MAX` | 20 a person |
| `DUE_PER_TICK` | 5 started in one pass, so one tick cannot flood the router |
| `FAILS_TO_PAUSE` | 3 runs in a row that could not start |
| `TICK_MS` | the clock is looked at every minute; a pass never starts while the one before is still going, and the timer never keeps the process alive |

## 5. Setting up

1. Run `tulmi/supabase/migrations/0100_code_schedules.sql`:
   `ssh root@91.108.104.168 "cd ~/tulmi && git pull --ff-only && ./deploy/migrate.sh 0095"`.
   Without it a server keeps its schedules in memory and a restart forgets them; the routes still work.
2. Set **`CODE_SCHEDULES=true`**. It is **off by default**: a standing job spends money with nobody watching, so it is a thing the owner turns on.
3. Nothing else: the clock starts with the server and stops when it closes.

## 6. Tests

`tulmi/tests/code-schedule.test.ts`: what is kept and refused, the owner's own rows only, a run's job and its budget, one job at a time, a run that is
hours late, three failures pausing it, a project that has gone, the cap on one pass, a store that is down, and every way one is steered.

## 7. What needs a live check

* **The app's screens.** The routes and the clock are here; the list, the card that makes one and the "Run now" are the app's to build (server-driven,
  as every other screen is). Until then a schedule is made over HTTP.
* **A real run end to end**: the branch cut, the job placed by the router, and the pull request it opens with nobody watching.
* **The clock across a restart.** Two servers with the same database are held by `store.claim`'s compare-and-set (step 0 above) and covered by a test
  over the memory twin; the same race against Supabase has not been seen, and one server is the shape today (`docker-compose.yml`).
