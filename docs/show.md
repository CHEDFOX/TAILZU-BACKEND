# What a bot draws: building blocks, not a list of widgets

A bot writes words. Some answers are clearer drawn: a **selector** when the bot asks the person to pick, a **box for the one thing they must not miss**, the **steps** of a plan, a **table** or a **chart** of the numbers, a few **next questions** to tap, a small **form** when it needs several details, a **drawing** of a shape. No list of components could cover every answer, and none is kept. The pipeline decides, answer by answer, what helps, and draws it from a few building blocks that fit together, the way a page is made of a handful of tags. Whatever it draws wears **one look**: monochrome, minimal dot art whose dots obey physics, with Blip beside it now and then (sections 5 to 7).

Code: `tulmi/src/show/` (the blocks, the checker, the designer, picks back into words, every picture as dots), `tulmi/src/experience/bots/show.ts` (the drawing), `tulmi/src/experience/bots/screens/bots/parts.ts` (the chat), `tulmi/src/botsBots/chat.ts` and `routes/bots/botsBots.ts` (kept, answered). The role is `bot_show` in `tulmi/src/principles/roles.ts`, its evals `tulmi/evals/bot_show.jsonl`.

* [1. The building blocks](#1-the-building-blocks)
* [2. Who decides, and when](#2-who-decides-and-when)
* [3. Answering a drawing](#3-answering-a-drawing)
* [4. On the screen](#4-on-the-screen)
* [5. The look: monochrome dot art](#5-the-look-monochrome-dot-art)
* [6. The motion: physics](#6-the-motion-physics)
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

It is asked only where the answer is drawn: the app's chat asks for it (`draw` on the ask, `botsBots/chat.ts`), so a routine, the front door, a voice call and an API caller pay for none. Never over a change waiting for the owner's yes (the approval card is that answer's drawing); never for words cut for a secret. The bot's own prompt and tools are not touched, so "the skills are the gate" stays true.

It runs after the words are whole, so the words stream as before; the drawing comes with the chat's refresh at the end.

## 3. Answering a drawing

* A one-tap **choice** or a **suggestion** sends its own words, as if typed (`POST /v1/botsapp/bots/chat/:slug { message }`).
* A **choice of several** or a **form** keeps what is picked and typed on the screen, under `show.<key>` (the checker gives each its `k0`, `k1`...), and Send posts `{ picks: { turn, values } }`. The chat finds that turn among the person's own with that bot, and `show/answer.ts` turns the values back into words from the labels it kept: picks joined with commas, a field as "Label: value". A value that names no option is left out. Those words are the person's message: the bot, the history, Activity and the chat read them like anything typed.

## 4. On the screen

`experience/bots/show.ts` draws every block with the kit's own Stack, Text, SVG, Image, Grid and TextField, so **every build that draws the Bots app draws these today, with no release** (`lint.ts` holds it to that); a build that declares `DotArt` gets its pictures as living dots (section 6), and one that declares `BotBuddy` gets Blip alive (section 7). A box hands its children the room it has, so a chart, a drawing or a picture fits the box it is in.

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

A picture is five numbers a dot (home x, home y, radius, tone, group), held to `MAX_PIC_DOTS` (1,400) by spacing a busy drawing's dots wider. Paths are read in the SVG grammar the checker lets through (M L H V C S Q T A Z), flattened and dotted, so a drawing reads the same at any scale. Photos (`image`) are shown as they are.

## 6. The motion: physics

A picture goes to the **DotArt** node (`shared/types/sdui.ts` 3k) on a build that declares it. Every dot is a point mass, and nothing moves it but forces, stepped on a fixed 1/120 s clock (semi-implicit Euler):

* **a damped spring** to its home (Hooke's law, damping ratio 0.45: a dot overshoots a little and settles, as a weight on a spring does);
* **gravity**, for a dot falling in, until it reaches home and its spring catches it, still moving, and takes the fall;
* **an impulse** where a finger lands (a click in the window), fading with distance: the dots near it scatter, and the springs bring them back;
* **a push** while a finger stays on the picture (the window: while the pointer rests over it, gently);
* **heat**: a thermal jitter with the damping it needs to stay at one temperature (fluctuation–dissipation), so a picture trembles about its home by a point or so.

How each picture comes in suits what it is (`show.ts MOTION`): bars and a meter **grow**, their dots let go left to right from the left edge; a line's dots **fall** onto it from above; a drawing **gathers** from scattered places and stays a little warm. Only the newest answer comes in; an older one, and Reduce Motion, are drawn at home and still. A picture sleeps once every dot is home and still, so a settled chat costs nothing, and it is kept by its key (turn and block) while the app runs, so a refresh never brings it in again.

The rules are one file, `TAILZU-FRONTEND/app/src/sdui/bots/dotArtCore.ts`, run by the phone (`DotArt.tsx`, on the tiles' Skia surface and their one frame loop) and generated into the window's `TAILZU-DESKTOP/dotArt.js` (`genDotArt.mjs`; the window's node is `src/app/sdui/dots.js`). A build without `DotArt` gets the very same dots as an SVG's circles, still. The render check draws a build that has it with `--with DotArt`.

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

Rarely needed: try it as a composition, or as `draw`, first. When one is worth it: its shape in `show/types.ts`, its check in `show/check.ts`, its drawing in `experience/bots/show.ts` from the kit's parts in the look of section 5 (a picture as dots through `show/dots.ts` and `dotsNode`, with a `MOTION` that suits it), one line in the `bot_show` contract, a case in `tests/show-blocks.test.ts`, `tests/show-dots.test.ts` and `tests/bots-show.test.ts`, and the role's size in `tests/principles.test.ts`.

## 11. Settings

`BOT_SHOW=false` turns it off: the words alone, as before. On by default.

## 12. Tests, and what needs a live check

`tests/show-blocks.test.ts` (the blocks, the caps, the links rule, secrets, the keys, Blip's acts, picks back into words), `tests/show-dots.test.ts` (every picture as dots: shares, tones, the path grammar, fills, the budget), `tests/show-design.test.ts` (whether to ask, what the model reads, the call and its cap, a model that fails), `tests/bots-show.test.ts` (in the run, in the chat and its route, on the screen on both clients: the kit's parts, one monochrome look, DotArt or still dots, the motion by kind, Blip, the actions, live and still). The physics is tested where it runs: `TAILZU-FRONTEND app/src/sdui/bots/dotArtCore.test.ts` (springs, a fall caught and overshooting, an impulse, a push, heat at its temperature, sleep, still, same seed same frames, the window's copy current) and `TAILZU-DESKTOP src/app/dots.test.js` (the node, the one loop, a click, the pointer, a repaint, Reduce Motion, the generated copy untouched). The role is in `tests/principles.test.ts` and `tests/principles-evals.test.ts`.

The render check draws it with the apps' real renderers: a chat whose turns carry `show` (`npx tsx scripts/bots-render/render.ts bots.chat --params '{"slug":"travel"}' --api '...'`). What needs a real model: how often the role draws, and how well, on `evals/bot_show.jsonl` (`cd tulmi && npm run eval:prompts -- bot_show`, costs money).
