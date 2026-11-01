# Long jobs: Ask taking a job of many steps to the end

Ask on the computer (src/agent, the desktop's agent.js) used to stop after 8 steps or a minute. That is enough for "turn on captions", not for "find the cheapest flight to Goa on Friday, book it and put it in my calendar". A **long job** keeps going until the job is done, a step needs the person, or they stop it.

## How it works

1. **The plan.** On a do-run, the planner writes `STEPS` at the start (now up to 12 steps). A plan of two or more steps makes the run a job.
2. **The ledger.** The desktop keeps the job's ledger (`AgentJob`: the goal, the plan, the steps finished, and up to 8 facts worth keeping) and sends it with **every step** (`AgentStepRequest.job`). The server keeps nothing between steps, and the history holds only the last 16 turns, so the ledger is how the 40th step still knows what the first one was for.
3. **Progress.** The planner reads the ledger as `<job>`, fenced like the screen (it was written from screens, so it is data, never instructions): each step numbered, `[done]` or `[now]`, then what was kept. When the history shows a step finished it writes `PROGRESS 2 | Cheapest: ₹5,320 at 17:45` before its action; the desktop ticks the step off on the guide's checklist and keeps the fact.
4. **Done means done.** `DONE` only once the screen shows the whole goal reached; until then, the next step.
5. **Their turn.** A password, a one-time code, a CAPTCHA, card details or a choice only they can make: `HANDOVER login | Type your password and sign in, then press Continue.` The guide shows a "Your turn" card with **Continue** and **Stop**; the run's clock stops while it waits (up to 10 minutes). Continue reads the screen again and goes on; Stop or silence ends the job. Ask never types those things.

The job's rules reach the planner only while a job runs (`JOB_NOTE`, a line at the head of the step's message), so the stable block every step pays for grew by one line (HANDOVER) and stays inside its budget.

## Limits

| | small run | long job |
| --- | --- | --- |
| steps (desktop) | `desktop.agent.maxSteps` 8 | `desktop.agent.jobMaxSteps` 60 |
| steps (server) | `AGENT_MAX_STEPS` 8 | `AGENT_JOB_MAX_STEPS` 60 (a step carrying a ledger) |
| time | `desktop.agent.deadlineMs` 60 s | `desktop.agent.jobDeadlineMs` 20 min (a "Your turn" card does not count) |

Every other lock stays: the risk of each action is worked out on the computer and asks for a yes; the same step twice to no effect stops it; Esc stops it; private windows and sensitive apps are never read.

## Tests

Server: `tulmi/tests/agent-jobs.test.ts` (the ledger read off a device, PROGRESS and HANDOVER, the message the planner reads). Desktop: the "long jobs" tests at the end of `agent.test.js` (the ledger on every step, ticks, the limits, a handover continued and stopped).

## Next

The phone as the remote for these jobs: say it on the phone, the computer does it, progress and "Your turn" come back to the phone.
