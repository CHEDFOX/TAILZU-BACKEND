# What a bot draws: building blocks, not a list of widgets

A bot writes words. Some answers are clearer drawn: a **selector** when the bot asks the person to pick, a **box for the one thing they must not miss**, the **steps** of a plan, a **table** or a **chart** of the numbers, a few **next questions** to tap, a small **form** when it needs several details, a **drawing** of a shape. No list of components could cover every answer, and none is kept. The pipeline decides, answer by answer, what helps, and draws it from a few building blocks that fit together, the way a page is made of a handful of tags. Whatever it draws wears **one look**: monochrome, minimal dot art whose dots spring in, with Blip beside it now and then (sections 5 to 7), all of it from the server, with nothing new in the apps.

Code: `tulmi/src/show/` (the blocks, the checker, the designer, picks back into words, every picture as dots), `tulmi/src/experience/bots/show.ts` (the drawing), `tulmi/src/experience/bots/screens/bots/parts.ts` (the chat), `tulmi/src/botsBots/chat.ts` and `routes/bots/botsBots.ts` (kept, answered). The role is `bot_show` in `tulmi/src/principles/roles.ts`, its evals `tulmi/evals/bot_show.jsonl`.

* [1. The building blocks](#1-the-building-blocks)
* [2. Who decides, and when](#2-who-decides-and-when)
* [3. Answering a drawing](#3-answering-a-drawing)
* [4. On the screen](#4-on-the-screen)
* [5. The look: monochrome dot art](#5-the-look-monochrome-dot-art)
* [6. The motion: springs, with nothing new in the apps](#6-the-motion-springs-with-nothing-new-in-the-apps)
* [7. Blip](#7-blip)
* [8. Safety](#8-safety)
* [9. Money](#9-money)
* [10. Adding a block](#10-adding-a-block)
* [11. Settings](#11-settings)
* [12. Tests, and what needs a live check](#12-tests-and-what-needs-a-live-check)

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

It is asked only where the answer is drawn: the app's chat asks for it (`draw` on the ask, `botsBots/chat.ts`), so a routine, the front door, a voice call and an API caller pay for none. A reply typed into a bot's **notification** (`NOTIFY_REPLY`, `routes/bots/botsNotifyReply.ts`) goes through that same chat door, so its answer is drawn too and waits in the chat; the push itself carries the words only. A bot turn no message asked for (a routine's answer, a call's opening line: `chat.note`) is never drawn. Never over a change waiting for the owner's yes (the approval card is that answer's drawing); never for words cut for a secret. The bot's own prompt and tools are not touched, so "the skills are the gate" stays true.

It runs after the words are whole, so the words stream as before; the drawing comes with the chat's refresh at the end.

## 3. Answering a drawing

* A one-tap **choice** or a **suggestion** sends its own words, as if typed (`POST /v1/botsapp/bots/chat/:slug { message }`).
* A **choice of several** or a **form** keeps what is picked and typed on the screen, under `show.<key>` (the checker gives each its `k0`, `k1`...), and Send posts `{ picks: { turn, values } }`. The chat finds that turn among the person's own with that bot, and `show/answer.ts` turns the values back into words from the labels it kept: picks joined with commas, a field as "Label: value". A value that names no option is left out. Those words are the person's message: the bot, the history, Activity and the chat read them like anything typed.

## 4. On the screen

`experience/bots/show.ts` draws every block with the kit's own Stack, Text, SVG, Image, Grid, TextField and Rise, so **every build that draws the Bots app draws these today, with no release** (`lint.ts` holds it to that); one that moves (BotsMotion) gets its pictures springing in (section 6), and one that has `BotBuddy` gets Blip alive (section 7). A box hands its children the room it has, so a chart, a drawing or a picture fits the box it is in.

Only the chat's **latest** turn is live. An older turn draws the same blocks still: a choice shows what the person picked (read off the turn after it), and its suggestions and form, which were for that moment, are left out. When the drawing shows the answer's own lists (`lists: "drawn"`), the chat leaves those lists out of the words so nothing is shown twice; the words are kept whole for the history, Share and Report.

## 5. The look: monochrome dot art

Whatever a bot draws, it is drawn **one way**: ink on paper, greys for what matters less, **no colour**, and dots wherever there is a picture. The model chooses the blocks, never the look: the renderer gives every block the same style, so a choice, a chart and a drawing made weeks apart still belong together.

| Block | Drawn as |
| --- | --- |
| `chart` bar | a row of dots a number, as many inked as its share of the largest (the last one partly), on a faint dotted track (`show/dots.ts barsPic`) |
| `chart` line | dotted along its length, its values bigger inked dots, on a faint dotted baseline (`linePic`) |
| `progress` | a row of dots, inked for the share done (`meterPic`) |
| `draw` | every outline dotted along its length at an even pitch, every fill a hex grid of dots inside it; a paint is a tone (ink, grey, soft, faint), never a colour (`drawPic`, `toneOf`) |
| `steps` | a bead each (done inked, now a ring round a dot, next a faint ring) on a thread of tiny dots |
| `callout` | a small dotted mark (a warning's !, a note's i, a tip's spark, a good thing's tick: `glyphPic`) and a dotted edge, ink for a warning |
| `list`, `choice`, `suggest` | dots for bullets, a ring for a check, a ring filled when picked; a suggestion a grey pill with a small dot |
| `card`, `stat`, `form` | a dotted edge |
| `divider` | a row of faint dots |

A picture is five numbers a dot (home x, home y, radius, tone, group), drawn as an SVG's circles, held to `MAX_PIC_DOTS` (1,400) by spacing a busy drawing's dots wider. Paths are read in the SVG grammar the checker lets through (M L H V C S Q T A Z), flattened and dotted, so a drawing reads the same at any scale. Photos (`image`) are shown as they are.

## 6. The motion: springs, with nothing new in the apps

Nothing here asks the apps for anything new: the motion is made from the **Rise** node the apps already draw (the sign-in and Home come in with it). A picture's dots are cut into pieces (`show.ts piecesOf`), the pieces are stacked on one canvas, and each piece is a Rise with its own delay, its own travel and the spring that suits the picture (`show.ts SPRING`):

| Picture | Cut into | How a piece comes in |
| --- | --- | --- |
| bars | runs of five dots along each bar, left to right, bar after bar | rising a little and growing from small, quick and lively |
| a meter | runs of four dots, left to right | the same |
| a line | its segments, left to right | dropping in from above and settling |
| a drawing | its shapes, in order | gathering from the picture's middle, softer |

On the **phone** a Rise is a real damped spring (stiffness, damping and mass, all from the server: it overshoots a little and settles, as a weight on a spring does). The **window** plays the same delay and the same travel eased in CSS; it has no spring of its own, and giving it one would be an app change.

Only an answer that has **just come in** springs in (the chat's newest turn, within two minutes: `parts.ts FRESH_MS`); a refresh later, or an older answer, draws the picture at home, so scrolling the chat never replays it. On the newest answer a **tap** on a picture brings its dots in again on their springs: the picture holds two faces, as it came and one that springs in, and the tap swaps them (`toggleState` on `taps.<key>`, `visibleIf` on each face), so a tap mounts the other face. A picture of more than 400 dots does not answer taps (it would be sent once more), and none is cut into more than 12 pieces. A build without BotsMotion gets the same dots, still. Reduce Motion is the apps' own: a Rise lands in place.

It keeps to `docs/renderer.md`:

* **Today's kit only** (section 2): Stack, SVG, Rise, BotBuddy, the actions `toggleState` and `callEndpoint`, `visibleIf`. None of the blocks that are not reachable yet (section 3).
* **A fallback on every node a client might not have** (section 4): every Rise carries its piece's dots, still, and Blip's BotBuddy his pose's picture, so a client that has either switched off (`sdui.off`) draws the picture all the same.
* **The screen limits** (section 5): a chat screen hands its turns one dot budget (`parts.ts SCREEN_DOTS`, 5,000 dots, every copy counted, about 275 KB at most), the newest answer first; an older picture is thinned to what is left (`dots.ts thinPic`), and one that would keep fewer than 24 dots leaves only its words (labels, values, caption). Only the newest answer sends a picture twice (the tap's face) or with its fallbacks.
* **Launch dark** (section 6): `BOT_SHOW` off, staged by `BOT_SHOW_USERS`.
* **Vocabulary 1, on purpose.** The blocks landed on 14 Nov behind `SDUI_V2` (section 3), and `motion` (SPEC 2.5) would express these springs better than `Rise` does. The drawings still do not use it, because `needs` is worked out per **screen** and a client missing a block is served "Open X0 again" in place of the screen, never a lowered one (`sdui2/gate.ts`). A chat must not do that for decoration. So the chat stays vocabulary 1 and every build draws it.

  **When to move them** (worth doing, not yet): once `SDUI_V2` is on and the store build carrying the blocks is out. Then emit the motion form **only for a client that declares the `motion` block**, so the screen is vocabulary 2 for those clients alone and the gate passes, and keep the `Rise` form for everyone else. It needs `blocks` on `BotsCtx` (`experience/bots/kit.ts`, `registry.ts`, `experience/screens.ts`), which nothing here touches today. What it buys: the **window gets real springs** (its v2 `motion` simulates one — `TAILZU-DESKTOP/src/app/sdui/v2/motion.js`; a `Rise` there is only a CSS ease), fewer nodes, and `Rise` is on section 7.1's list of single-feature nodes being undone.

## 7. Blip

Now and then Blip, the app's little bot, stands beside the first picture (or callout, choice, form, stat or box) of an answer: the designer asks for him with `"blip"`, one of `survey` (numbers or a drawing to look at), `read` (a note), `think` (a choice to make), `wave` (good news). Most answers have no Blip. On the newest answer of a build that has him alive (`BotBuddy`), he is the engine's own bot, in ink, his motion its physics, standing right beside the picture on its baseline; on an older answer, or an older build, his pose's picture (`hello`, `listen`, `think`, `done`). He is dot art himself: his body is dotted.

## 8. Safety

* **The blocks are data.** An unknown type, a field of the wrong kind or a value out of range drops that block alone; a long text is cut; caps on everything (`SHOW_LIMITS`: 8 at the top, 48 in all, 12 items, 8 options, 6 links). Three asking blocks and one suggestion row at most.
* **No made-up addresses.** A picture loads by itself and a link carries whatever is in its address, so a page could otherwise talk the model into building one with the person's details in it. A `link` or `image` must be an https address **this turn read**, character for character: the person's words, what they attached, the bot's files, a tool's result (`show/links.ts`). The bot's own answer does not count. No user name or password in an address.
* **No secrets.** A drawing with anything that looks like a secret, or one of our keys, is dropped whole.
* **Kept rows are read again.** A drawing read back from the chat goes through the checker again before it is drawn or answered.

## 9. Money

The call goes through the request's meter, so it comes off the bot's own request and day like every other call of the turn: at most `SHOW_CAP_PAISE` (40, as the memory note), never with under 4 paise left, and the memory step is given what is left after the drawing's share. The input is capped (600 characters of the ask, 2,400 of the answer, 8 links) and the answer at 600 tokens.

## 10. Adding a block

Rarely needed: try it as a composition, or as `draw`, first. When one is worth it: its shape in `show/types.ts`, its check in `show/check.ts`, its drawing in `experience/bots/show.ts` from the kit's parts in the look of section 5 (a picture as dots through `show/dots.ts` and `dotsNode`, with a `SPRING` that suits it), one line in the `bot_show` contract, a case in `tests/show-blocks.test.ts`, `tests/show-dots.test.ts` and `tests/bots-show.test.ts`, and the role's size in `tests/principles.test.ts`.

## 11. Settings

Off by default: `BOT_SHOW=true` turns it on. `BOT_SHOW_USERS` (comma-separated account ids) is the stage before everyone: while it names anyone, only they get drawings. Off, the words alone, as before.

```
ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/set-env.sh BOT_SHOW=true BOT_SHOW_USERS=<your account id> && ./deploy/ship.sh'
```

## 12. Tests, and what needs a live check

`tests/show-blocks.test.ts` (the blocks, the caps, the links rule, secrets, the keys, Blip's acts, picks back into words), `tests/show-dots.test.ts` (every picture as dots: shares, tones, the path grammar, fills, the budget), `tests/show-design.test.ts` (whether to ask, what the model reads, the call and its cap, a model that fails), `tests/bots-show.test.ts` (in the run, in the chat and its route, on the screen on both clients: the kit's parts, one monochrome look, the pieces and their springs by kind, fresh and older answers, a tap's three faces, Blip, the actions, live and still). The role is in `tests/principles.test.ts` and `tests/principles-evals.test.ts`.

The render check draws it with the apps' real renderers: a chat whose turns carry `show` (`npx tsx scripts/bots-render/render.ts bots.chat --params '{"slug":"travel"}' --api '...'`; `--motion` lets the springs run). What needs a real model: how often the role draws, and how well, on `evals/bot_show.jsonl` (`cd tulmi && npm run eval:prompts -- bot_show`, costs money).
