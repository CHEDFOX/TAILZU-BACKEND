# Lingo: the language bot

Lingo teaches a language the way the rest of Tailzu works: the server decides everything, the screens are JSON, and
the person talks instead of tapping. Code: `tulmi/src/lingo/`. Migration: `tulmi/supabase/migrations/0087_lingo.sql`.

## 1. What it is for

Most language apps are tapping games. Somebody finishes the whole tree and still cannot order a coffee, because
tapping the right tile out of four was never the thing they needed to practise. Lingo is built the other way round:

**Conversation is the lesson. Everything else is how an item gets ready to be said.**

That is why `spoken` is a column of its own (`lingo_items`) and why `learned()` refuses to call a word learned until
it has been said right, out loud, twice — however confident the scheduler is. A word only ever read is not a word
somebody has.

It also decides where the marking happens. Duolingo marks in the app and believes the answer the app sends back,
which is why a few hundred lines of script can farm its XP all day. **Nothing in Lingo is marked on a phone.** The app
sends what the person did; `grade.ts` works out what it was worth. There is no message the app can send that says
"I was right".

## 2. What is kept

Two tables, and neither of them holds a course. A course is the person's own items, so a new language is rows, never
a table or a release.

| | |
| --- | --- |
| `lingo_learners` | one row per person per language: the pair (`target`, `from_lang`), their level, the minutes a day they asked for, whether the bot may ring them, the voice that speaks the language, and the streak. Somebody may learn several at once; the app opens the one they used last |
| `lingo_items` | one row per word or phrase they are learning, in one of their courses, with where the scheduler has got to: `stability`, `difficulty`, `reps`, `lapses`, `steps`, `state`, `due_ms`, and `spoken` |

A person may read their own rows (owner-only RLS); the server writes with the service key. Both go with the account.

`source` says how they met the item — `seed` off the course's list, `said` they used it, `asked` they asked about it,
`heard` it came up while talking. A session reaches for the last three first: a word somebody went looking for
themselves is worth more than the next one down a frequency list.

## 3. When to ask again (`schedule.ts`)

The scheduler is **FSRS** (`ts-fsrs`, MIT, no dependencies of its own). A memory is two numbers — how long it would
hold (stability) and how hard this person finds it (difficulty) — and from those and the mark it works out the day
they would be about as likely as not to have lost it. That is the day to ask.

The mark is read like this, and the reasoning matters:

| Mark | As the scheduler reads it | Why |
| --- | --- | --- |
| `wrong` | Again | they did not have it |
| `close` | Hard | they knew the word and missed the accent or a letter: sooner, but not back to the start |
| `right`, tapped | Good | |
| `right`, **out loud** | Easy | saying it unprompted is the strongest evidence there is that it is theirs |

**`steps` is kept on purpose.** It is the learning step the item is on. A scheduler that forgets it walks the learner
round the same step for ever, every session, and nothing about the app looks broken while it happens. There is a test
for it both ways round (`tests/lingo-schedule.test.ts`).

Everything in this file is pure — an item, a mark and a clock in, an item out — so a test can walk somebody through a
year of reviews in a few lines.

## 4. Marking an answer (`grade.ts`)

Also pure, also server-side, and it returns **no English**: the reason is a code (`MarkReason`) that the screens word
in whatever language the person reads.

The band that decides whether a language app feels fair is `close`:

- **the marks over the letters missing** — `close`/`accent`. They knew the word.
- **one slipped letter**, in an answer long enough for a slip to be obviously a slip — `close`/`spelling`. Two
  neighbours swapped counts as **one** slip, not two: it is the commonest typing mistake there is, and plain
  edit distance counts it as two, which puts it outside every budget a short answer has.
- **a short answer one letter away is a different word** — `wrong`. In most languages "gato" and "pato" are a cat and
  a duck, and forgiving that would teach the wrong one. Under five letters gets no budget at all (`slipBudget`).
- **the right words in the wrong order** — `close`/`order`, which is its own mistake and worth saying.
- **nothing typed or nothing heard** — `wrong`/`silence`, not a wrong word.

Every prompt is marked against a **list** of accepted answers, not one. A grader that knows only one right answer is
the single most common reason a learner is told they are wrong when they are not.

**Speech is marked more kindly than typing** (`gradeSpoken`). Speech-to-text drops the marks over letters, invents
punctuation and mishears small words, and none of that is the learner's fault; spelling is not what is being tested
out loud. It gets one slip more than the typed budget, and the first slip still passes outright.

## 5. The exercises

Six kinds (`types.ts` `EXERCISE_KINDS`), and the order is the point:

| Kind | What it asks | Marked by |
| --- | --- | --- |
| `choose` | pick the meaning out of a few | `gradeChoice` |
| `write` | type it | `gradeText` |
| `listen` | it is spoken, they type what they heard | `gradeText` |
| `chips` | put the given words in order | `gradeChips` |
| `say` | say it out loud | `gradeSpoken` |
| `talk` | a turn of real conversation, the item expected in it | `gradeSpoken` |

The first four exist to get an item ready for the last two. They are the whole of most language apps.

## 6. What is built

Built, tested and typechecked: the tables, the shapes (`types.ts`), the scheduler (`schedule.ts`) and the marking
(`grade.ts`), with 39 tests over the two pure modules.

Not built yet: the store, the routes, the bot's definition in `bots/builtin.ts`, its page, the session builder, the
seeding of a new course, and the call that rings somebody to talk. They come next, in that order.

## 7. Tests

`tulmi/tests/lingo-schedule.test.ts` and `tulmi/tests/lingo-grade.test.ts`. Both are pure: no store, no model, no
clock of their own, and nothing in them needs a key.
