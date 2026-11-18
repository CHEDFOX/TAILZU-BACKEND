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
`src/brief/` is fed lines and gives back a document, so both get the same thing and neither knows about the other.

**Recall's meetings** (`meet/service.ts`): Recall sits in the call and sends us the words; the brief's pass runs on the
meeting's own tick.

**Our own calls** (`rooms/scribe.ts`, `rooms/ears.ts`): there is nobody to send, because we are the SFU's customer — so
Cloudflare sends us the sound itself.

| | |
|---|---|
| it takes its seat | with the first person in. The call's note is made then, so the first words have somewhere to go |
| it hears | one **WebSocket adapter a person** (`sfu.listen`): Cloudflare decodes that one track's Opus and dials a `wss://` of ours with 48 kHz stereo PCM. No WebRTC on this side, no headless browser |
| who said what | free: the track is theirs, so the words are theirs. Nothing is diarized |
| what it keeps | every ~25 seconds of sound written down and appended to the note, under that person's name |
| what it costs | the sound is taken to 16 kHz mono before anything is kept, so a speaker-minute is ~2 MB rather than 11.5; Cloudflare bills it as ordinary egress ($0.05/GB, the first 1,000 GB free) |
| it answers | a question asked in the call — typed (`POST /v1/rooms/seat/ask`) or **said out loud**: a line that starts with its name ("X0, what did we decide?") is a question, a name in the middle of a sentence is somebody talking about it. From what was said in this call and nothing private, at most one answer every 20 seconds |
| it speaks | the answer is read aloud **in the call** as well as written on every screen (`rooms/speaker.ts`) |
| the last person out | the ears closed, the last pass written, the note organised like any other recording |

### Its voice

The same adapter the other way round. The bot takes **a session of its own** at the SFU and publishes one track on it fed
from a socket Cloudflare dials (`sfu.speak`, `location: "local"`, `inputCodec: "pcm"`), and it takes **a seat in the room**
— so every app pulls its voice exactly as it pulls a person's microphone, and **nothing in any app had to learn about it**.

Its seat differs from a person's in three ways, all of them in `Seat.bot`: it never beats (so it is never dropped for going
quiet), it does not count towards the call's size, and a call with nobody in it but the bot is an empty call.

The words are read by the speech service as 24 kHz mono PCM (`pipeline/tts.ts`, format `pcm`), lifted to the 48 kHz stereo
the SFU takes (`up48`: each sample becomes itself and the midpoint to the next, in both ears), and handed to the **mouth**,
which lets them out in 20 ms frames on a clock. That pacing is the point: a call is a live thing, a second of speech written
in one go is a second of speech the SFU would throw away, and a queue that is let out a frame at a time is also a queue that
can be dropped the moment it should stop talking. A frame is only taken off the queue once it has gone out, so words spoken
before Cloudflare dialled wait for it instead of vanishing. Sound going **into** the SFU is not charged.

**The ear is not a person's route.** `GET /v1/rooms/ears/:token` is the socket the SFU dials. There is no sign-in because
there is nobody to sign in: the authority is a token this server minted a moment earlier for one track of one call, held in
memory, told to nobody but Cloudflare. An unknown token is closed at once and nothing is ever sent back down it.

**It sits in a call only where it can**: `MEETING_BRIEF` on, the SFU set up, and a public `wss://` address for Cloudflare to
dial (`sitsIn()`). Otherwise a call is exactly the call it was, and nothing is listened to.

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

- **The meeting's page** (`meetScreens.ts`): "The document, so far" while the meeting runs, "The document" after.
- **The call itself** (`callRoom.ts`): in a window, beside the people; on a phone, under them. The line "X0 is in this call ·
  listening and writing", whatever it last said, and the document as it grows. It is the server's own data on the room, so
  the page redraws when the document changes (the room's live topic) and **nothing in the apps had to learn any of it**.
- **Everyone who was in the call**: the link they joined by shows the document once the call is over
  (`GET /v1/rooms/guest/:code`), so a guest with no account reads the same thing the host reads.
- **The rows**: `meetings.brief` (0095) and `rooms.brief` with `rooms.note_id` (0096), so a restart loses nothing.

## 7. Tests

`tulmi/tests/brief.test.ts` — a pass writes what it names and leaves the rest; a part is replaced whole; the same blocks again
is not a change; only what a bot may draw survives; the kinds' order; a full document; a kept document checked again; what the
prompt says (only from the transcript, nothing private, the fences hold); what is read from the answer.
`tulmi/tests/meet-service.test.ts` — the brief in a real meeting: written beside the notes, kept on the row, its line in the
call's chat, a last pass told the meeting has ended, a failed pass leaving both the document and the meeting alone, and a
server with the switch off writing none.
`tulmi/tests/rooms-pcm.test.ts` — the adapter's protobuf messages, stereo to mono, 48 kHz to 16, the WAV, and knowing a voice
from an empty room.
`tulmi/tests/rooms-ears.test.ts` — one ear a person, a stretch gathered and written down under their name, where a late
joiner starts, silence never sent, a speech service that fails losing one stretch and nothing else, and every ear closed at
the end.
`tulmi/tests/rooms-scribe.test.ts` — the five seams: its seat, a microphone on, a pass, a question answered (and not twice in
a breath), and the last person out.
`tulmi/tests/rooms-page.test.ts` — the bot and its document on the call screen, and a call with no bot saying nothing about
one.
`tulmi/tests/rooms-voice.test.ts` — 24 kHz mono to 48 kHz stereo, a sentence let out a frame at a time at the speed it is
spoken, the last frame padded rather than cut, words held while nothing is listening, hushed at once, and a voice per call.
`tulmi/tests/rooms-speaker.test.ts` — the session, the track, the seat nobody counts, the words reaching the socket the SFU
dialled, and everything taken away when the call ends.
