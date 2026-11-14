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

### Every script is a first-class script

No language is the one this was built for with the rest bolted on. The rules are about **writing systems**, and the
ones that are not alphabets get as much care as the ones that are.

**The vowels of an abugida or an abjad are marks, not letters.** Unicode files Devanagari matras, Tamil vowel signs
and Arabic harakat under `\p{M}`, so the obvious way to strip punctuation — keep `\p{L}`, `\p{N}` and spaces — eats
them. It turns "coffee" in Devanagari into two bare consonants and a vocalised Arabic word into single letters. Both
sides of a comparison are spoilt the same way, so **exact matches still pass and nothing looks broken**, while
different words quietly collapse onto each other and Arabic written the ordinary way, unvocalised, is marked wrong
against an answer that carries its harakat. `tidy` keeps every mark.

`fold` then takes away only the marks **a writer routinely leaves off** — Latin, Greek and Cyrillic accents, Arabic
harakat, Hebrew niqqud, the Indic nukta — listed as explicit code-point ranges in `grade.ts`, each with its reason.
The Indic **vowel signs are deliberately not in that list**: Unicode calls them marks and they are nothing of the
kind, since dropping one makes a different word.

**A script written a character at a time gets no slip budget at all.** Chinese, Japanese and Korean are not spelt
out letter by letter; each character is picked whole off a candidate list, so a slipped stroke is not something that
happens and a neighbouring character is simply a different word. `slipBudget` returns 0 for them, and `gradeSpoken`
gives them no extra room either — the machine in the middle does not slip a stroke.

The word-order check splits on spaces, so a script that does not put spaces between its words simply never matches
there, which is the right answer for it.

**Speech is marked more kindly than typing** (`gradeSpoken`). Speech-to-text drops the marks over letters, invents
punctuation and mishears small words, and none of that is the learner's fault; spelling is not what is being tested
out loud. It gets one slip more than the typed budget, and the first slip still passes outright.

## 5. The exercises

Seven kinds (`types.ts` `EXERCISE_KINDS`), and the order is the point:

| Kind | What it asks | Marked by |
| --- | --- | --- |
| `choose` | pick the meaning out of a few | `gradeChoice` |
| `write` | type it | `gradeText` |
| `listen` | it is spoken, they type what they heard | `gradeText` |
| `chips` | put the given words in order | `gradeChips` |
| `blank` | a real sentence with the word taken out, and put back | `gradeChoice` |
| `say` | say it out loud | `gradeSpoken` |
| `talk` | a turn of real conversation, the item expected in it | `gradeSpoken` |

The first five exist to get an item ready for the last two. They are the whole of most language apps.

## 6. A session

`session.ts`, pure like the rest. `plan(items, learner, now)` gives back what to do now.

**What is nearly forgotten comes first** — that is the whole point of scheduling. A few never-seen items are mixed in
behind them (at most a third of a session) so it is never only revision, and the ones the person reached for
themselves come before anything off a list. Length follows the minutes they asked for, about four exercises a minute.

**An item climbs.** Which shape it gets is decided by how well it is held, never at random (`shapeFor`):

| Where the item is | What it gets |
| --- | --- |
| never met, or just lost | `choose` — recognise it. Asking somebody to produce a word they have not met teaches nothing but frustration |
| going in | `listen`, then `chips` |
| held, but never said enough | **`say`**, and it stays there until it has been said enough times to count |
| held and said | `write`, or `chips` for a phrase |

That last row is the mechanism behind the whole idea. A tapping exercise is not the lesson; it is how a word gets
ready to be spoken, and an item that is never asked for out loud never finishes.

The same item on the same day is always offered the same way (a seeded shuffle), so a reload is not a different
question. The wrong answers offered in `choose` are taken from the person's own course, so they are plausible.

## 7. The doors

`routes/bots/lingo.ts`. Off unless `BOTS` and `LINGO` are both set, and then every route is 404 `lingo_off`.

```
GET    /v1/lingo/languages?q=     what the picker shows, and what a search in it finds
GET    /v1/lingo/courses          every course, the one opened last first, each with its progress
PUT    /v1/lingo/course           start or change one: { target, from, level?, goalMin?, calls?, voice? }
DELETE /v1/lingo/course/:target   the course and every word of it
POST   /v1/lingo/words            { target, items: [{ item, gloss, kind?, source? }] } -> { added }
POST   /v1/lingo/session          { target } -> { exercises, progress }
POST   /v1/lingo/answer           { target, item, kind, said? | picked? | chips? } -> { mark, dueMs, spoken, learned, streakDays }
```

**The app cannot mark itself.** `/v1/lingo/answer` takes what the person *did* — which option, what they typed, what
they said — and never whether it was right. The exercise is rebuilt on the server from the stored item, so what is
accepted comes from the table. An app that sends a verdict, its own list of right answers, or a count of times
spoken is simply not listened to, and there is a test that sends all of those at once and still gets "wrong".

A course is a pair of language tags, checked against the shape of BCP-47 and nothing else. **There is no list of
languages anywhere in Lingo**, so any pair works the day somebody asks for it.

## 8. The bot

`bots/builtin.ts`, slug `lingo`, colour `stone`, listed only where `LINGO=true`. It has no tools: its chat runs the
ordinary bot loop with the course as its knowledge (`digest.ts`) — the pair, the level, the streak, the counts, and
the words due now with the ones never said marked. So "what should I practise?" is answered from the real table in
one model call, and the conversation can be steered onto what is about to be forgotten.

## 9. The sentence bank: not writing the exercises

A sentence pair IS an exercise. "Me gustaría un café" against "I would like a coffee" is already something to type,
something to hear, and a set of words to put in order — with nothing written by anybody. So the quickest way to a
good lesson is not to invent sentences but to pour in a public corpus and pick well from it.

`lingo_sentences` (migration 0089) is that bank, and it is **shared by everybody**: no `user_id`, nobody's data,
poured in once. `src/lingo/sentences.ts` reads it, `scripts/lingo-seed.ts` fills it:

```bash
npx tsx scripts/lingo-seed.ts --lang es --gloss en --file ~/tatoeba-es-en.tsv --licence CC0-1.0
```

The file comes from Tatoeba's **Custom exports → Sentence pairs**, which gives a TSV for any pair of languages.
Both shapes of that export are read, with usernames and without. Any TSV of a sentence and its translation works,
so this is not really tied to one corpus.

### The licence gate

This is the part worth being careful about. A corpus is thousands of people's writing, **each under whatever
licence that person chose**, and only some of it may appear in something people pay for. So the licence and the
author are kept PER ROW, and one function decides (`usable`):

| | |
| --- | --- |
| Allowed | `CC0-1.0`, `PD` — ask for nothing; `CC-BY-*` — allowed, must credit the author |
| Refused | non-commercial, share-alike, no-derivatives, **and a blank licence**, which in a corpus usually means nobody said |

A refused row is **never stored** — not stored and filtered later, never stored. `credits()` gathers who must be
named, by corpus, so a credits screen can be built from what was actually shown.

What that ruled out, after reading the licences rather than assuming them: **Tatoeba's audio** (licensed per clip,
some of it non-commercial, and a blank licence means it may not leave Tatoeba — the server's own speech is used
instead) and **kaikki.org / Wiktionary** (CC BY-SA, whose share-alike would reach anything derived from it).

### Finding one

`using(lang, gloss, word)` finds the sentences that use a word, **through the same folding that marks an answer**,
so the bank and the marking can never disagree about what a word is. It searches the folded text rather than
splitting on spaces, which is the only way that works in a script that has none.

`around(lang, gloss, maxWords)` finds sentences of about a length, for a level. How long a sentence is depends on
its SCRIPT, not on whether it happens to contain a space: words where the script separates them, characters where
it does not.

## 10. The order a session is put in

Which words to ask is the scheduler's business. **The order they are asked in is a different question with its own
answer**, and getting it wrong costs real learning while every other part looks right. `order.ts` decides it, and
five findings decide `order.ts`:

| | |
| --- | --- |
| **Interleaving** | Practising one kind in a block is easier in the moment and worse afterwards than mixing kinds. So no two exercises of the same kind sit next to each other while anything else could go between them. |
| **Desirable difficulty** | An answer that comes easily is remembered less well than one that was work. The middle runs hardest first, and an item climbs out of recognition as soon as it can bear it. |
| **Primacy and recency** | What comes first and last is remembered best and the middle sags, so the hard work goes early rather than being spread evenly. |
| **The peak-end rule** | A sitting is remembered by its best moment and its **last** one. End on the thing somebody just failed and the whole session is remembered as a bad one. So the last exercise is deliberately one they are likely to get right — and so is the first, because a person who fails the opening question often does not finish. |
| **The lag effect** | A word just missed and asked again immediately is copied, not recalled. A few exercises later, it is retrieved. So a miss comes back, but never next. |

**What this replaced was wrong on three counts.** The old order was `[...everything due, ...everything new]`: all the
revision in one block, then all the new words in another — and since every new word is a recognition question, every
session ended in a run of identical taps, in the one position a person actually remembers.

Two spoken exercises never sit back to back either: the microphone has to open twice, the room has to be quiet twice,
and somebody who cannot speak where they are is stopped dead. That rule is held against the ends — holding two quiet
exercises back for the opener and the closer can leave the middle with nothing to separate the spoken ones, so when
quiet exercises do not outnumber them, the opener is chosen on the odds alone.

`againAfter(verdict)` says how many exercises later a word comes back this sitting: a miss after `LAG`, a near miss
twice that (they knew it — that is worth correcting, not drilling), a right answer never. **The server decides it**,
so the app never has to work out what a miss is worth.

## 11. Picking a language

A card with a search box at the top, the suggested few, then all of them. `src/lingo/languages.ts` holds the list
and the search; `GET /v1/lingo/languages?q=` serves it.

**The list lives on the server, and that is the point of it being a list at all.** The picker is a screen the server
draws and the search runs here, so adding a language, fixing a name or reordering the suggestions is a **deploy and
never an app release**. Nothing about it is compiled into a phone.

**Every language is named twice** — in itself and in English — because somebody looks for the word they call their
own language by, not the word English calls it by. "Deutsch" has to be findable as Deutsch.

**Where one name covers two languages, there are two rows.** Mandarin and Cantonese, Português (Brasil) and
Português (Portugal), Norsk bokmål and Nynorsk. A picker can simply show both, which beats asking afterwards: the
choice is made where it is visible, and it changes every sentence the person will ever be taught.

**Search folds both sides through `grade.ts` `fold()`** — the very function that decides whether a typed answer was
right — so "espanol" finds Español, "turkce" finds Türkçe, "francais" finds Français, and **the picker and the
marking can never disagree about what a word is**. It matches the language's own name, the English name, the other
names people use (`mandarin`, `farsi`, `castellano`, `tagalog`, `bangla`) and the tag. Ranked, because a picker that
puts the right answer third is a worse picker: the exact tag, then a name that starts with what was typed, then a
word inside a longer name, then anything containing it — alphabetical inside each band, so the list does not jitter
between keystrokes.

The language they already speak is never offered as one to learn, and it is not asked for: the server knows it from
`profile.language`, or from their newest course.

**The list is not a gate.** A course is still a pair of tags and `routes/bots/lingo.ts` checks only the SHAPE of a
tag, so a language nobody has added still works if it is asked for by tag.

## 12. A word put back into a sentence

The seventh kind, `blank`, and the one the sentence bank was for. A real sentence that uses the word, with the word
taken out:

> Quiero un ——— con leche · **café** · perro · libro

It sits in the ladder **after hearing the word and before writing it alone**, because a word is not learned as a
translation pair — it is learned where it is used. The wrong answers are other words from the person's own course, so
they are words they might really confuse it with rather than obvious filler: a choice nobody could learn from is not
a question.

`gapIn()` takes out a **whole word only** — a gap in the middle of a longer word teaches nothing — and compares
through the same folding that marks an answer, so an accent or a capital does not hide the match. In a script that
puts no spaces between its words it takes the run of characters out where it sits.

When the bank holds no sentence for a word, **the ladder closes over the gap** and the word is written instead,
rather than showing a hole with nothing round it. A server with no bank at all never reaches this kind, and nothing
breaks.

## 13. Sets, and learning that keeps going

Learning is **continuous**, not a session that ends: a set of a dozen exercises, then what the bot makes of it, then
Continue. Each set is built from the one before, so the difficulty follows the person instead of a tree. `set.ts`
decides all of it, on the server.

### How a set went, in four bands

| | |
| --- | --- |
| **flying** | nearly all right, **and** some of it said out loud — speaking is what flying has to mean here |
| **solid** | mostly right, little wrong |
| **shaky** | more *close* than wrong: they nearly had it |
| **struggling** | a lot wrong |

Coarse on purpose. A person can feel the difference between four bands, and no honest reading of twelve answers
supports more than that.

### The celebration is scaled, and a bad set gets none

| Performance | What the bot does | Scale |
| --- | --- | --- |
| flying | `celebrate`, the big one | 1 |
| solid | `cheer()`, smaller | 0.5 |
| shaky | settles. **No cheer** | 0.15 |
| struggling | settles. **Nothing at all** | 0 |

Confetti for everything is the commonest mistake in this kind of app. It makes the celebration worthless, and it
tells somebody who has just failed half a set that they did well — which they can see is untrue. **The bot is warm
about a bad set and does not lie about it.** A test asserts the scale never rises when the performance falls.

### The next set follows the person

`shapeNext()` returns the shape of what comes next, and the app asks for it rather than deciding anything:

| | New words | Hardest allowed | |
| --- | --- | --- | --- |
| flying | 40% of the set | no cap | push for the spoken kinds |
| solid | 25% | no cap | |
| shaky | 10% | `blank` | not asked to produce what they nearly lost |
| struggling | **none** | `listen` | and a shorter set |

A cap only ever makes an exercise **gentler**, never harder (`underCap`). And the words that went wrong last set come
back **first** in the next one, ahead of everything else due: they are the most recent evidence about this person,
and a set that ignores them is not following them at all.

### Mastery

`mastery(items, now)` is what they can do, not a percentage of a course — there is no course to be a percentage of.
It is how much of what they have met they would still have right now, how much they have ever **said**, and how much
has crossed into learned, with **speaking weighted double** because it is the thing being taught.

## 14. The territory, and leaving a language

Coming back to Lingo does **not** drop somebody into where they left off. The first screen is a territory: a card per
language they are learning, each with its progress, a **Continue** on it, and **Add a language** beside them. Several
at once, by choice. `GET /v1/lingo/courses` carries `progress` and `mastery` per course, so the territory draws from
one call.

**Leaving one** is a bin icon on its card. It opens a card with a box to write why, and a button that says **Just
clean up** — which removes it with no reason given, because a person who does not want to explain themselves must
not be made to.

`DELETE /v1/lingo/course/:target` takes an optional `reason`. The course and every word of it go; one line is kept
(`lingo_left`, migration 0092) with the reason and the counts they had reached, so a reason can be read against
something — a language given up in week one is not the same as one given up at two hundred words. Not one word of
what they were learning is kept. And writing that line is never allowed to stop the removal: somebody who asked to
be rid of a language is rid of it whether or not the note got written.

Why keep it at all: **why people stop is the most useful thing a learning app can be told, and the one thing it is
never told**, because stopping is silent.

## 15. The screens

`experience/bots/screens/bots/lingoPage.ts`, four of them, **vocabulary 1** — every node is one each installed build
already draws, so none of this needs a release. A lesson must never be the screen that answers "Open X0 again",
which is what the gate sends a client missing a block.

| | |
| --- | --- |
| `bots.lingo` | the territory: a card per language with its own meter, counts, Continue and a bin; Add a language beside them |
| `bots.lingo.set` | a set, one exercise at a time, with the verdict under it |
| `bots.lingo.add` | the picker: search at the top, the suggested few, then all of them |
| `bots.lingo.leave` | stop learning one: a box for why, and **Just clean up** |

Lingo's tile in the bots list opens the first of these: `ids.ts` `botRoute` now has `lingo` among the built-ins with
a page of their own. Everyone's own bots still go to the shared bot page.

**A verdict is said with the app's own marks, not with colour.** The palette has no green and no red
(`kit.ts` `C`), which is right: `right` is the `done` mark, `close` is `waiting` — *not* `failed`, because it is not
a failure — and `wrong` is `needs`. The words for the five reasons live here (`whyWords`), because the grader
returns a code and no English.

### The answer is not in the exercise

Marking on the server is worth nothing if the word is readable in what the server sent: somebody could open the
payload and simply see it. So an exercise goes to a client through `wire()`, which takes out **the item's own text,
the answers we accept, and which option is right**, and puts in `ref` — an opaque 16-hex name for the item
(`refOf`, a hash of the person, the course and the word). The answer route finds which item a `ref` is by hashing
that person's own items, so one learner's ref says nothing about anybody else's.

`choose` and `blank` keep their options, because the options **are** the question — but not which one is right.
`listen` is the one exception and cannot be helped: the word has to reach the phone to be spoken aloud.

The route tests had to be rewritten for this, which is the strongest thing about it: **they can no longer read the
answer either.** A test works out which exercise a word is by computing its `ref` the way the route does, then
answers with the option it knows to be right because it seeded it.

## 16. What is built

Built, tested and typechecked: the tables, the shapes (`types.ts`), the scheduler (`schedule.ts`), the marking
(`grade.ts`), what is kept (`store.ts`), a session (`session.ts`), the chat's knowledge (`digest.ts`), the doors
(`routes/bots/lingo.ts`) and the bot itself. 79 tests, seven of them on scripts that are not alphabets.

Turn it on with `LINGO=true` in the server's `.env` and Lingo is in the bots list, with the standard bot page and
chat. Every exercise is drawn with node kinds the apps ALREADY draw — `Chip`, `TextField`, `WordChips`, `AudioPlay`,
`VoiceButton`, `VoiceLive`, `BotCall` — so none of this needs an app release, now or later.

Not built yet: drawing a session's sentences from the bank rather than from the person's own items, and the call
that rings somebody to talk.

There is no seeded course and there is not going to be one. A course cannot be hand-written a hundred times over, so
the items come from the model and from use: `source` records which, and the table fills with what this person
actually reaches for. A word list for a particular pair can be poured in later where one exists, but nothing waits
on it and no pair is anybody's first.

## 17. Tests

`lingo-schedule.test.ts`, `lingo-grade.test.ts`, `lingo-session.test.ts`, `lingo-order.test.ts` and
`lingo-sentences.test.ts` and `lingo-languages.test.ts` and `lingo-set.test.ts` are pure: no store, no model, no clock of their own, and nothing in them needs a key.
`lingo-routes.test.ts` runs the real routes over the memory store.
