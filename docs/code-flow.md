# The Xode flow: read, agree a plan, work to it

What a person sees when they open a project in Xode, and the rules behind it (`tulmi/src/code/flow/`, `tulmi/src/routes/bots/botsXode.ts`,
screens in `tulmi/src/experience/bots/screens/codeWork/flow.ts`).

## 1. The gate

The chat opens only when both are true (`gate.ts`):

* **Xode has read the project**: the project brain's build is done (`ready`, or `stale` while it catches up with a push).
* **Xode knows where the owner wants it to go**: their vision, in their own words (saved with the book's answers as `vision`, plus what
  must not change as `keep`), or they chose **Let Xode suggest one** (`skipped`).

The two happen side by side: the person writes their vision while Xode reads. The screen shows the read's progress and the vision form,
then "Check again" once both are in.

## 2. The plan, before any work

When the chat opens, Xode's first message is a plan (`plan.ts openingPlan`, role `code_plan_open`, cheap tier):

* where the project stands, from the book;
* where it is heading: the owner's words, or Xode's suggestion, marked as one;
* the next piece of work toward it, and its steps (3 to 6).

Every message after that is answered by Xode as in any chat (it reads the code; it **cannot** start work from here), and then the plan
is kept or revised (`keepPlan`, role `code_plan_keep`). A question, thanks, or a detail that fits leaves it the same; asking for different
or more work makes the next version (`v`), with what changed. Only the latest version can be approved.

Asking to see it first ("show me a mockup") makes a mockup in the project's own look (the ask road's design), kept with the plan.

## 3. Approve

One tap. A job starts on the approved plan with `planFirst: false`, so it does not stop to ask again; the task is the goal, the steps in
order and what must not change (`planTask`). A plan with a mockup is built from the design (`/v1/artifacts/:id/build`, which checks the
result against it), and the job is told the plan it serves.

## 4. During the work

Every message (and every picture: read first by the vision tier) is judged against the plan (`triage.ts`, role `code_triage`):

| Kind | What happens | The work |
| --- | --- | --- |
| question | answered now, from the plan and what the job is doing | goes on |
| addon | a detail or extra that fits (a colour, a name, a picture to follow): handed to the job | goes on |
| change | different or more work, or undoes or reorders a step: the next version of the plan, for a yes | only the steps it touches wait |
| mockup | a mockup is made beside the work and opened | goes on |
| stop | the person is asked to confirm; never stopped on a guess | goes on until they confirm |
| note | thanks, ok: said back to | goes on |

When unsure between addon and change, it is addon: nothing stops on a guess. A model that cannot answer passes the words on to the job.
The yes to a changed plan tells the same job its new plan; it does not start another.

## 5. When it is done

The plan reads "Done"; the next message plans the next piece. The job's own report (and its pull request) are on the job's page.

## Routes

| Route | |
| --- | --- |
| `GET /v1/bots/code/flow/:project/gate` | the read's progress and whether a direction was given |
| `POST /v1/bots/code/flow/:project/vision { vision?, keep?, skip? }` | the owner's direction, or "let Xode suggest" |
| `GET /v1/bots/code/flow/:project/plan?thread=` | the gate, the plan (made the first time), the job |
| `POST /v1/bots/code/flow/:project/say { thread, text, attachments? }` | before the work: the answer, the plan, whether it changed, a mockup |
| `POST /v1/bots/code/flow/:project/approve { thread, v }` | the yes: a job starts, or a running job is told its new plan |
| `POST /v1/bots/code/flow/:project/work { thread, text, attachments? }` | during the work: the kind, what Xode says, a new plan, a mockup, a stop to confirm |

Everything is stored with the chat thread (`code_chat_threads.last_located`, no migration) and the book's owner answers.
