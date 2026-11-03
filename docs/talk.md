# Talk: the voice chat (`tulmi/src/talk`)

The person holds or double-taps one key anywhere and talks, turn after turn, like a chat app with no app. X0 knows where they are (the app, the window, the address, the selection, and the whole page or document, not only what is on screen) and can act. The desktop records, shows and speaks; the server decides, thinks and streams the answer.

`POST /v1/talk` (signed in) takes `{ talkId, turn, words, tz?, app?, title?, url?, field?, ours?, page?, grants? }` and answers NDJSON (`application/x-ndjson`), one event a line, written as it is known. Types: `shared/types/api.ts` (`TalkRequest`, `TalkEvent`, `PageText`).

| Event | When |
|---|---|
| `route` `{ kind, depth, lang }` | first, as soon as the one key's brain has answered |
| `mood` `{ mood }` | any time: `ponder` while a think-tier model works, then the answer's own |
| `text` `{ text }` | the answer's words as they come, in whole words |
| `handoff` `{ to, goal, trusted, bot?, notes? }` | for what the device does instead of a spoken answer |
| `done` `{ text, found? }` | last: the whole answer (what was said, after a stop), or empty after a handoff; `found` is what it rested on |
| `error` `{ code, message }` | last, instead of done: `private`, `budget`, `model_down`, `internal` |

`POST /v1/talk/stop { talkId }` stops the turn in flight for this person; its stream ends with `done`. A new turn of the same talk stops the one before it, and so does a dropped connection.

## The roads (`road.ts`, a table in the tests)

| kind | road | tier | |
|---|---|---|---|
| `chat` | reply | cheap | small talk, a joke, a small question about nothing on screen (the tiny tier is slower to speak: 1.1 s against 0.4 s) |
| `answer` | reply | cheap | a question; read-only lookups first when it needs fresh facts |
| `think` | reply | strong, reasoning on | maths, a deep why or how, a comparison, a plan, code; `ponder` first |
| `task`, `send` | handoff to `agent` | | Ask does it on the screen; `trusted` unless it moves money or deletes |
| `write` | handoff to `write` | | typed into the text box in front |
| `routine`, `notes`, `bot` | handoff to theirs | | |

The turn's language (`pipeline/lang.ts`) picks the voice: Korean, Japanese and Chinese, Urdu, Persian and Arabic, Ukrainian and Russian are told apart by their letters, and the Latin-script languages by letters only some use (ß, ñ, ã, ğ…) and everyday words.

The kind comes from the one key's brain (docs/ask-decide.md), which reads `chat` and `depth` beside its `do`. A decision under 0.7 sure starts one tier up. A reply's cap is its worst case at its tier; the day's front-door allowance is read before any model and charged after.

## A turn
1. **Gates, for nothing.** Empty words, X0 Bot's own window, a password field, a sensitive app (`pipeline/sensitive.ts`): no model, nothing kept. A text box in front: typed (`handoff write`). A sensitive app with none: `error private`.
2. **Decide.** The person's context (docs/context.md) and this talk's last turns, with what each answer found, go to the brain in one call, which is asked to make a short follow-up whole in its goal.
3. **Handoff**, or **answer**. Ask gets a `task` or `send` only when the brain was at least 0.45 sure and more than one word was said; a lone "Riya", or a guess, is a chat turn that asks what they meant (`ask_back`). A handoff whose words point back ("send that to Riya", "isse bhej do", "इसे भेजो") and whose goal carries none of the last answer's figures (numbers of three digits or more) is handed to Ask with that answer and what it found (`followup.ts`), with no call made. An answer: lookups first when it needs fresh facts, picked on the cheap tier whatever tier answers (`look.ts`: the bots' `web_search`, the everyday tools' `weather` and `currency_convert`; one call, at most 3 lookups, 4,500 characters; a lookup slower than 4 s is answered without, so a hanging search never holds the voice), then one streamed call (role `talk_reply`).
4. **Keep.** The turn goes into the talk and into the person's context (`keepAsk`, `keepResult`), under the context's privacy rules.

## Streaming and the mood
The answering model starts with one tag in square brackets, `[talk|laugh|ponder|done|sorry|surprised|shy|nope]`, then its words. The server reads the tag before any word goes (the bracketed head may run to 160 characters: a note a model wrote before its tag, "[answer nahi — पहले mood tag] [nope]", is dropped and never said), says it as a `mood` event and drops it from the words; no tag, or one it does not know, is `talk`. The words go out whole, never cut inside a word (`live/askStream.ts` `sendable`), and stop once they look like they hold a secret (`bots/run.ts` `scrub`).

A model that fails before a word was said is replaced by the next on its tier's ladder, then by the tier above, once. So is one that has said nothing by its first-words deadline (`answer.ts` `firstWordsMs`: 4 s, 12 s on the strong tier, which thinks first): measured, one model of the cheap tier sometimes takes 13 s to start, and a voice cannot wait for it. After words were said there is no second voice: the turn ends with a short apology in the turn's language (mood `sorry`).

## What the answering model is told (`prompt.ts`)
The role's stable block, then one message: today's date and time, `<context>`, `<talk>` (the folded summary and the last turns whole), `<where>` (app, window, address without its query, selection), `<page>`, `<found_now>`, `<said>` and `<meant>`. All of it is fenced as data, each part under its own cap; together under 20,000 characters. The answer is for the ear: short, no markdown, in the language of this turn's words.

## The page (`page.ts`)
The desktop sends the whole page or document already reduced (`text` at most 20,000 characters; more is cut, not refused). A model is shown, under `PAGE_MAX_CHARS` (4,000): the outline (a quarter at most), the part around `where`, and the parts whose words match what was said, best first, in page order; with nothing matched and nothing around them, the start of the page. A page that fits is shown whole. With the setup card's `read` not on, the page and the selection are not used.

Ask uses the same: `POST /v1/agent` takes a top-level `page` at a run's first step only (not with a picture), reduced the same way, in `<page>` after a line saying it is data (`agent/prompt.ts`).

## The talk (`session.ts`)
In memory, per person and `talkId`, gone after 30 minutes idle: the last 8 turns whole (said, answer, kind, found), older ones folded by code into a summary of at most 600 characters. A turn sent again with the same number replaces the first. Clearing the person's context (`DELETE /v1/context`, `/turns`, Settings › Privacy) clears their talks too.

Evals: `tulmi/evals/talk_reply.jsonl`. Tests: `tulmi/tests/talk.test.ts`, `tulmi/tests/talk-turn.test.ts`.
