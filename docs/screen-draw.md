# A screen nobody built, drawn by a model

Every screen in the Bots app is hand-written TypeScript, listed in `BOTS_SCREENS`. Ask for an id that has no
builder and the app says "This part is on its way" (`comingSoon`, `experience/bots/kit.ts`). This is the other
answer: the model picks the **blocks** for that screen, and the kit draws them.

It is the same arrangement as everything else here — **the model proposes, code decides** — and the same one
`src/show` uses under a bot's answer (`docs/show.md`) and `src/cinema/scene` uses for a 3D scene. The reasoning
chooses what belongs on the screen; code chooses how every pixel of it looks.

Code: `tulmi/src/drawn/draw.ts`, the role `screen_draw` in `tulmi/src/principles/roles.ts`, its
fixtures `tulmi/evals/screen_draw.jsonl`. Switch `SCREEN_DRAW` / `SCREEN_DRAW_USERS`, off.
Tests: `tulmi/tests/screen-draw.test.ts`.

* [1. Why it picks blocks and not nodes](#1-why-it-picks-blocks-and-not-nodes)
* [2. The path](#2-the-path)
* [3. What it may not draw](#3-what-it-may-not-draw)
* [4. Where it is asked](#4-where-it-is-asked)
* [5. Money](#5-money)
* [6. Settings](#6-settings)
* [7. What is built, and what is not](#7-what-is-built-and-what-is-not)

## 1. Why it picks blocks and not nodes

`sdui2/design.ts` exists so that a screen a model *writes as nodes* can be checked: a pressable inside a
pressable, a border written the CSS way, text under 4.5 to 1 (`docs/renderer.md` section 5a). That gate is real
and it stays. But a model that writes nodes has to get styles, contrast and touch sizes right on every screen,
and every screen is then a gate it can fail.

So it does not write nodes. It answers the **20 blocks a bot already draws under its words** (`show/types.ts`),
and `showNodes` turns them into the kit's own nodes. The model cannot break a design rule, because it never
writes a style.

`checkDesign` still runs over the finished tree, with `drawn: true`, but as an **assertion over our own
renderer** rather than a retry loop: an error there means the kit emitted something the kit's rules refuse,
which is a bug in us, not a bad drawing. Asking the model again would not fix it, so the screen falls back
instead. That is why there is no second call here and no `designWords` round trip.

## 2. The path

1. **Is it on** (`drawnOn`, free): `SCREEN_DRAW`, staged by `SCREEN_DRAW_USERS`. Off, or the settings
   unreadable, and nothing happens.
2. **One call**: the `screen_draw` role on the **cheap** tier reads the screen id, its params and which client
   is asking, each fenced as data, and answers `{"title":…,"blocks":[…]}`. The id is all it has, which is why
   the role is told to invent no numbers and no names: with only an id to go on, words are honest and a chart
   is not.
3. **The checker** (`show/check.ts`, the chat's own): an unknown type, a field of the wrong kind or a value out
   of range drops that block alone; long text is cut; the caps hold (8 at the top, 48 in all). It is given an
   **empty `Seen`**, which is what drops every address (section 3).
4. **The asking blocks come out** (`withoutAsking`), at any depth, and a box they emptied goes with them.
5. **The kit draws it**: `showNodes` for the body, `page()` for the screen.
6. **The design rules**, as an assertion. Errors: not served.
7. Anything short of a screen that survives all of that is the `comingSoon` it was before.

## 3. What it may not draw

- **Nothing to tap, type or send.** `choice`, `suggest` and `form` are dropped wherever they are. Their Send
  posts into a bot's chat turn (`show/answer.ts`), and a screen has no turn to post into — a control that looks
  right and does nothing is worse than one that is plainly not there. The role is told this too, so it should
  not draw them; the filter is what makes it true.
- **No address, and no picture.** The checker's rule is that a `link` or an `image` must be an https address
  **this turn read**, character for character (`show/links.ts`). A screen read nothing, so its `Seen` is empty
  and every one of them is dropped. This is not a new rule, it is the existing rule meeting a turn with no
  reading in it, and it is the reason a drawn screen cannot be talked into building an address with somebody's
  details in it.
- **No secret.** Inherited: a drawing with anything that looks like a secret, or one of our keys, is dropped
  whole by the checker.

## 4. Where it is asked

One place, `buildBotsScreen` (`experience/bots/index.ts`):

```ts
const def = BOTS_SCREENS.get(screenId);
if (!def) { /* drawn, or comingSoon */ }
```

**A built screen never reaches it.** Every id in `BOTS_SCREENS` is answered by its own builder, exactly as it is
today, and `tests/screen-draw.test.ts` holds that: Home with a model door present asks no model.

It needs a door to a model, `deps.drawn` (`experience/bots/live.ts` `BotsDeps`). Every caller that has not been
given one — the tests, the render check, `emptyDeps()` — behaves as before, which is how this landed without
touching any existing screen.

## 5. Money

`DRAW_CAP_PAISE` (60) at most, and never with under 6 paise left on the request, taken as the smaller of the
two. Nothing is retried, so one screen is one call. The answer is capped at 900 tokens and the input at the id,
400 characters of params and one word for the client.

## 6. Settings

Off by default. `SCREEN_DRAW=true` turns it on; `SCREEN_DRAW_USERS` (comma-separated account ids), while it
names anyone, is the stage before everyone.

```
ssh root@<server> 'cd ~/tulmi && ./deploy/set-env.sh SCREEN_DRAW=true SCREEN_DRAW_USERS=<your account id> && ./deploy/ship.sh'
```

## 7. What is built, and what is not

**Built:** the role and its fixtures, the whole path of section 2, the switch and its stage, the wiring in
`buildBotsScreen`, and `tests/screen-draw.test.ts` (18 cases: the switch, the asking blocks at depth, the
addresses, the tree against the app's own design rules and `lintTree`, the call's role, tier and cap, a model
that is down or answers rubbish, and a built screen never being drawn).

**Not built yet:**

* **Nothing caches it.** A screen is drawn on every request for it. That is fine for an id nobody opens twice
  and wrong for anything else, and it is the first thing to fix before this is pointed at a surface people
  visit: key it on the screen id, the person and the shape of the data behind it, serve the built screen while
  the first draw runs, and revalidate behind.
* **It is told nothing but the id.** No data is loaded for a screen nobody built — there is no `load` to run —
  so the model draws from the id and its params alone. Giving it the person's own facts would make it far more
  useful and is a real decision about what a drawing may see, not a small change.
* **Vocabulary 1 only.** By construction: `showNodes` emits what every build draws. Once `SDUI_V2` is on, a
  drawn screen could use the blocks a client declares (`hasBlock`, `BotsCtx.blocks`) — a real list, a real
  input, real motion — and a client without them would still get `comingSoon` rather than a broken screen.
* **No eval run against a real model.** The fixtures are written and the known-good answer is held to the
  checker, but how often the role draws something worth serving is unmeasured
  (`npm run eval:prompts -- screen_draw`, costs money).
