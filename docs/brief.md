# The brief: the document the bot makes while a meeting runs

A meeting used to leave a **note** behind: a transcript, a summary, some to-dos. That is what was *said*. The **brief** is what the
meeting was *about* — written while it happens, by the one participant paying attention to all of it at once, and handed to
everyone afterwards instead of an hour of video.

It is not minutes. When they describe a flow, it draws the flow. When they compare three options, it makes the table. When
they say numbers, it charts them. The notes are one part of it.

```
          the meeting's words                     the brief
  ┌──────────────────────────────┐      ┌──────────────────────────┐
  │ Recall  (Meet, Zoom, Teams)  │─┐    │ overview                 │
  │ docs/meet.md                 │ │    │ pictures   (draw, steps) │
  └──────────────────────────────┘ ├──► │ numbers    (chart, table)│ ──► the meeting's page,
  ┌──────────────────────────────┐ │    │ what was said            │     the note, the people
  │ our own calls (docs/rooms.md)│─┘    │ who does what            │
  └──────────────────────────────┘      │ still open               │
                                        └──────────────────────────┘
```

`tulmi/src/brief/`: `types.ts` (what a document is), `edit.ts` (how a pass changes it), `role.ts` (the one model call).
Switched off until the owner turns it on: **`MEETING_BRIEF=true`**, and migration **0095** to keep a brief between restarts.

## 1. One brief, two kinds of meeting

A meeting the bot joined through Recall and one of our own calls differ only in how the words reach us. Everything in
`src/brief/` is fed lines and gives back a document, so both get the same thing and neither knows about the other. Today the
Recall feed is wired (`meet/service.ts`); our own rooms get their ears next (`docs/rooms.md` section 10).

## 2. What a document is made of

Parts. Each has an **id** the model chooses and keeps, a **kind**, a **title** and **blocks**:

| kind | what it holds |
|---|---|
| `overview` | what this meeting is, who is in it, where it has got to |
| `picture` | something they described, drawn: a flow, an architecture, a timeline |
| `numbers` | what they counted, compared or priced |
| `said` | the points so far, in the order they came up |
| `decisions` | what was decided, in the words they decided it |
| `todos` | who does what, and by when if they said |
| `open` | questions nobody answered |
| `other` | anything else the meeting needs |

The blocks are the ones **a bot already draws under its words** (`src/show/`, `docs/show.md`): text, callout, list, facts,
table, stat, progress, steps, chart, draw, and the boxes that hold them. So "illustrations, stats and sheets" need nothing new
in the phone or the window — whatever shows the brief draws them today, as monochrome dot art, and a block the checker will not
take is not drawn at all. The meeting's page renders them with `showNodes`, the same call a bot's answer goes through.

## 3. How it grows: in edits, never rewrites

Every pass (`MEETING_BRIEF_EVERY_S`, 3 minutes by default, on the meeting's own tick and only once enough has been said) the
model is shown **the meeting so far and the document as it stands**, and answers with the parts to write or replace, by id:

```json
{"parts":[{"id":"flow","kind":"picture","title":"How a refund moves","blocks":[…]}],"remove":["open"],"say":"I've drawn the refund flow."}
```

- A part nobody named is left exactly as it was, so the thing people are reading does not shuffle under them.
- A part written whole, never merged. The same blocks again is **not** a change, so a pass that restates itself does not make
  the document look new (`applyEdit` says `changed: false` and the version does not move).
- A part with no blocks left is a part gone, not an empty heading.
- The parts are drawn in their kinds' order whatever order they arrived in.
- A full document (14 parts) drops what nobody would miss first — the catch-all, then the oldest picture — and never what was
  just written.
- `say` is the one line for the meeting's own chat, and only when what it just wrote is worth saying now. Most passes say
  nothing. Nothing is said into a call that has ended.

**The last pass** runs when the meeting ends, with `live: false`: the model is told the meeting is over and finishes the
document — the overview made whole, the decisions and to-dos complete, the half-written taken out.

## 4. What keeps it honest

- **Only from the transcript.** Never a number, a name, a date, a decision or a to-do that was not said. Half-said goes under
  `open`, not under `decisions`.
- **Nothing private.** The call knows nothing of the owner's mail, notes, chats, files or calendar, as the meeting bot's other
  two calls do not (`meet/brain.ts`).
- **The meeting is data.** The transcript, the names and the document itself are fenced and cannot close their own fences
  (`briefPrompt` strips the tags), so a planted line on screen or in a title cannot become an instruction.
- **Every block is checked** on the way in by `show/check.ts` — the same checker a chat's drawing goes through, including its
  secret scan — and **again** when a kept document is read back (`keptBrief`), because a row is data too.
- **It never holds up the call.** A pass that fails is a warning in the log; the document stays as it was and the notes, which
  do not depend on it, are written as before.

## 5. What it costs

One model call a pass, on `MEET_MODEL` (a fast one — people are in the call), as the person and on their meter
(`privacy/aiGate.ts asPerson`, `usage/cost.ts chargedTo`). A pass reads the transcript (24,000 characters at most, newest
first) and the document (7,000), and answers with at most four parts. A one-hour meeting at the default cadence is about
twenty passes.

## 6. Where it shows

- **The meeting's page** (`experience/bots/screens/bots/meetScreens.ts`): "The document, so far" while the meeting runs, "The
  document" after, each part's title and its blocks drawn with `showNodes`.
- **The row** (`meetings.brief`, migration 0095), so it survives a restart and the page can be opened again later.
- Next: the note it belongs to, the call screen of our own rooms, and sharing it with everyone who was in the meeting.

## 7. Tests

`tulmi/tests/brief.test.ts` — a pass writes what it names and leaves the rest; a part is replaced whole; the same blocks again
is not a change; only what a bot may draw survives; the kinds' order; a full document; a kept document checked again; what the
prompt says (only from the transcript, nothing private, the fences hold); what is read from the answer.
`tulmi/tests/meet-service.test.ts` — the brief in a real meeting: written beside the notes, kept on the row, its line in the
call's chat, a last pass told the meeting has ended, a failed pass leaving both the document and the meeting alone, and a
server with the switch off writing none.
