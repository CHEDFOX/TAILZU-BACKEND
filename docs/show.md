# What a bot draws: building blocks, not a list of widgets

A bot writes words. Some answers are clearer drawn: a **selector** when the bot asks the person to pick, a **box for the one thing they must not miss**, the **steps** of a plan, a **table** or a **chart** of the numbers, a few **next questions** to tap, a small **form** when it needs several details, a **drawing** of a shape. No list of components could cover every answer, and none is kept. The pipeline decides, answer by answer, what helps, and draws it from a few building blocks that fit together, the way a page is made of a handful of tags.

Code: `tulmi/src/show/` (the blocks, the checker, the designer, picks back into words), `tulmi/src/experience/bots/show.ts` (the drawing), `tulmi/src/experience/bots/screens/bots/parts.ts` (the chat), `tulmi/src/botsBots/chat.ts` and `routes/bots/botsBots.ts` (kept, answered). The role is `bot_show` in `tulmi/src/principles/roles.ts`, its evals `tulmi/evals/bot_show.jsonl`.

* [1. The building blocks](#1-the-building-blocks)
* [2. Who decides, and when](#2-who-decides-and-when)
* [3. Answering a drawing](#3-answering-a-drawing)
* [4. On the screen](#4-on-the-screen)
* [5. Safety](#5-safety)
* [6. Money](#6-money)
* [7. Adding a block](#7-adding-a-block)
* [8. Settings](#8-settings)
* [9. Tests, and what needs a live check](#9-tests-and-what-needs-a-live-check)

## 1. The building blocks

`show/types.ts`. Every block is plain data. Boxes hold any block, boxes included, three deep.

| Group | Blocks | Drawn as |
| --- | --- | --- |
| words | `text` (title, heading, body, label, meta, big, mono), `callout` (info, tip, warn, good, bot), `list` (bullet, number, check), `facts`, `table`, `stat`, `steps` (done, now, next), `divider` | the kit's text, a card with a coloured edge, a list card, the kit's table (cards on a phone when it has more than three columns), the bead timeline |
| numbers | `chart` (bar or line), `progress` | bars from Stacks; a line, its dots and its low and high as an SVG; the kit's meter |
| pictures | `draw` (circles and SVG paths on a canvas of its own), `image`, `link` | an SVG with shapes, sized to its box and captioned; a picture; an outline button that opens the page |
| boxes | `row`, `grid`, `card` | a wrapping row, the kit's grid, a card (a tone colours its edge) |
| asking | `choice` (one tap, or several and Send), `suggest` (next questions in the person's voice), `form` (text, number and choice fields, and Send) | outlined chips, or rows with a note; filled grey chips; a card with fields |

`draw` is the way out for anything the rest cannot say (a floor plan, a route, a diagram): the model writes the shapes, so a new kind of picture needs no new block. Colours are a hex or a name of the kit's (`ink`, `grey`, `bot`, and the natural palette).

## 2. Who decides, and when

After a bot has its words, in `bots/run.ts` (step 7), beside its memory:

1. **Whether to ask at all** (`show/design.ts worthDrawing`, free): a question back, two list lines, three numbers, 280 characters, or a link the turn read. A greeting or "Done, it's on your calendar." is never asked about.
2. **One small call**: the `bot_show` role on the tiny tier reads the person's words, the answer and the links the turn read, each fenced as data, and answers `{"blocks":[...],"lists":"drawn"|null}`. The role is told what the blocks are and when each helps, and that most answers need nothing; it is never given an example to copy.
3. **The checker** (`show/check.ts`) reads what came back (section 5), and the answer carries it as `show`.

It is asked only where the answer is drawn: the app's chat asks for it (`draw` on the ask, `botsBots/chat.ts`), so a routine, the front door, a voice call and an API caller pay for none. Never over a change waiting for the owner's yes (the approval card is that answer's drawing); never for words cut for a secret. The bot's own prompt and tools are not touched, so "the skills are the gate" stays true.

It runs after the words are whole, so the words stream as before; the drawing comes with the chat's refresh at the end.

## 3. Answering a drawing

* A one-tap **choice** or a **suggestion** sends its own words, as if typed (`POST /v1/botsapp/bots/chat/:slug { message }`).
* A **choice of several** or a **form** keeps what is picked and typed on the screen, under `show.<key>` (the checker gives each its `k0`, `k1`...), and Send posts `{ picks: { turn, values } }`. The chat finds that turn among the person's own with that bot, and `show/answer.ts` turns the values back into words from the labels it kept: picks joined with commas, a field as "Label: value". A value that names no option is left out. Those words are the person's message: the bot, the history, Activity and the chat read them like anything typed.

## 4. On the screen

`experience/bots/show.ts` draws every block with the kit's own Stack, Text, SVG, Image, Grid and TextField, so **every build that draws the Bots app draws these today, with no release** (`lint.ts` holds it to that). A box hands its children the room it has, so a chart, a drawing or a picture fits the box it is in.

Only the chat's **latest** turn is live. An older turn draws the same blocks still: a choice shows what the person picked (read off the turn after it), and its suggestions and form, which were for that moment, are left out. When the drawing shows the answer's own lists (`lists: "drawn"`), the chat leaves those lists out of the words so nothing is shown twice; the words are kept whole for the history, Share and Report.

## 5. Safety

* **The blocks are data.** An unknown type, a field of the wrong kind or a value out of range drops that block alone; a long text is cut; caps on everything (`SHOW_LIMITS`: 8 at the top, 48 in all, 12 items, 8 options, 6 links). Three asking blocks and one suggestion row at most.
* **No made-up addresses.** A picture loads by itself and a link carries whatever is in its address, so a page could otherwise talk the model into building one with the person's details in it. A `link` or `image` must be an https address **this turn read**, character for character: the person's words, what they attached, the bot's files, a tool's result (`show/links.ts`). The bot's own answer does not count. No user name or password in an address.
* **No secrets.** A drawing with anything that looks like a secret, or one of our keys, is dropped whole.
* **Kept rows are read again.** A drawing read back from the chat goes through the checker again before it is drawn or answered.

## 6. Money

The call goes through the request's meter, so it comes off the bot's own request and day like every other call of the turn: at most `SHOW_CAP_PAISE` (40, as the memory note), never with under 4 paise left, and the memory step is given what is left after the drawing's share. The input is capped (600 characters of the ask, 2,400 of the answer, 8 links) and the answer at 600 tokens.

## 7. Adding a block

Rarely needed: try it as a composition, or as `draw`, first. When one is worth it: its shape in `show/types.ts`, its check in `show/check.ts`, its drawing in `experience/bots/show.ts` from the kit's parts (no new node type), one line in the `bot_show` contract, a case in `tests/show-blocks.test.ts` and `tests/bots-show.test.ts`, and the role's size in `tests/principles.test.ts`.

## 8. Settings

`BOT_SHOW=false` turns it off: the words alone, as before. On by default.

## 9. Tests, and what needs a live check

`tests/show-blocks.test.ts` (the blocks, the caps, the links rule, secrets, the keys, picks back into words), `tests/show-design.test.ts` (whether to ask, what the model reads, the call and its cap, a model that fails), `tests/bots-show.test.ts` (in the run, in the chat and its route, on the screen on both clients: the kit's parts, the actions, live and still). The role is in `tests/principles.test.ts` and `tests/principles-evals.test.ts`.

The render check draws it with the apps' real renderers: a chat whose turns carry `show` (`npx tsx scripts/bots-render/render.ts bots.chat --params '{"slug":"travel"}' --api '...'`). What needs a real model: how often the role draws, and how well, on `evals/bot_show.jsonl` (`cd tulmi && npm run eval:prompts -- bot_show`, costs money).
