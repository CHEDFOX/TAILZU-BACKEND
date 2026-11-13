# Native looks

The Home Screen and Lock Screen widgets, the iOS Live Activity, the Android ongoing notice and the keyboard's printed keys
draw their APPEARANCE from data this server sends, interpreted by native code that is already in the store build. Layouts,
words, pictures, palettes, fonts, key prints and press effects become a deploy instead of a release.

Nothing downloaded is code (App Review 2.5.2, and Play's same rule). A design is a closed vocabulary — node types, style keys,
colour and type tokens, bind paths, condition keys — all compiled into the binary, with no expressions anywhere. Every action a
design can name already exists in the build: answer a needs item with the widget's own token, or open a vetted link.

The contract is `shared/types/nlook.ts` (widgets and the Live Activity) and `shared/types/keyboardFace.ts` (key faces and
skins). Read those two files before this one; they are the truth and this is the tour.

---

## The three rules that never bend

1. **Unknown degrades, never throws.** An unknown node draws its `fallback`, then nothing. An unknown style key is ignored. An
   unknown colour becomes `ink`. A design whose `format` is too new is skipped **alone**, and the catalog around it is served
   as usual.
2. **Checked three times.** The server cleans on publish (`experience/native/clean.ts`), the phone cleans again before it
   writes anything native, and native code clamps a third time.
3. **Anything missing, too new, too big or broken falls back to today's hand-written native view.** A limit is never a crash
   and never a blank widget.

The referee for all three is `shared/native/fixtures/`: one set of cases with the verdict every side must reach. When this
server and a phone disagree about a case, the fixture is right and both of them are wrong.

---

## Launch dark

Every switch below ships **off**. Until the owner's own phone has been through the device checklist, an old build and a new
build must see exactly what they see today, and turning a switch off again must put every phone back on its native view at its
next open with nothing to uninstall.

| Setting | What it turns on | Off means |
|---|---|---|
| `NATIVE_LOOKS` | the `native.looks` bootstrap flag, `GET /v1/native/looks`, and `look` on any glance | no flag, no catalog, no look: every widget draws the view compiled into its own build |
| `NATIVE_ACTIVITY` | Live Activity designs, on their own (needs `NATIVE_LOOKS`) | pushes carry no `look`, and the hand-drawn banner and island regions draw, region by region |
| `KEYBOARD_SKINS` | the keyboard's skin expansion and the Keybot skin picker | the key tree is exactly today's, whatever a keyboard says it can draw |
| `KEYBOARD_SKINS_USERS` | (not a switch) a comma-separated list of account ids: while it has any name in it, only those accounts get a skinned tree or the picker | empty: the switch alone decides. This is the keyboard's testers' stage, since a key tree has no `targets` the way a design does |
| `ACTIVITY_PUSH_START` | "Bots at work" may be started by a push while the app is shut (iOS 17.2+) | start tokens are not kept and nothing is pushed to them; the app still starts its own activity |
| `ANDROID_BOTS_NOTICE` | the Android ongoing "Bots at work" notice (needs `NATIVE_LOOKS`) | nothing is sent, and Android has no notice — which is what it has today |

**One predicate per switch, read by everything.** `nativeSwitches()` in `experience/native/catalog.ts` is the only place
that reads these, and both the bootstrap's `widgets.notice.enabled` and the notice pusher ask it. They did not always: the
pusher read `ANDROID_BOTS_NOTICE` alone while the flag also required `NATIVE_LOOKS`, so with the master switch off the phone
was told the feature was off and then sent notice pushes anyway. The Android side posts a notice from a push and ends it at
the next app open when the flag says off, so the two flapped against each other. A test drives all four combinations.

**There is a second gate, and it is deliberate.** Even with `NATIVE_LOOKS` on, a design is named for a person only when a
`targets` rule in the catalog names it for their surface. `targets` ships empty, so the first people to see a design are the
ones a rule lists by user id, and everyone else keeps the native view.

**The testers' path is a rule, not a query parameter.** There is no `?preview=`. An internal account goes in a rule's
`when.users`, which reaches all four surfaces — the two widget kinds, the Live Activity and the Android notice — because all
four ask through `pickDesign` with a `userId`. A parameter on the glance reached only the glance, and the server honoured it
for any signed-in account.

**The bootstrap flag follows the same gate.** `native.looks` is what starts the phone's whole sync: fetch the catalog, fetch
the art, draw the bot stills on the CPU, write a version folder. So it is sent only to someone a rule could name — a plain
rule (one with no `when`), or a rule whose `when.users` lists them. With `targets` empty, turning the master switch on starts
that on nobody; in the testers' stage, only the testers' phones sync.

**Migration 0088 before the deploy, not before the switch.** `widget_activity_tokens.nl` is read on every Live Activity
push. The store falls back to reading and writing the rows without it (the same shape as `push/store.ts`'s `capsMissing`),
and `nl` then reads as 0 — "this phone holds no catalog" — so no design is ever named, which is the safe direction. Run
0088 before the switch all the same: until it is run, no push can carry a `look`.

**Turning it on, per stage.** Each is one `PUT` and each is undone by one `DELETE`; neither needs a deploy.

1. **Testers.** Dry-run, then `PUT` a catalog whose rules all carry `when.users`. Turn on `NATIVE_LOOKS`, plus
   `NATIVE_ACTIVITY` and `ANDROID_BOTS_NOTICE` for those surfaces.
2. **Everyone, with no visible change.** A plain rule naming the parity designs (`x0.base`, `bots.base`, `board.base`), so
   the new renderers run at scale while people see exactly what they see today.
3. **A new design.** Point the plain rule at it.

The two push switches (`ACTIVITY_PUSH_START`, `ANDROID_BOTS_NOTICE`) are GLOBAL: unlike a design they have no `when.users`
stage, so their device checks come before they go on in production.

---

## The pieces

| File | What it is |
|---|---|
| `shared/types/nlook.ts` | the format: node types, style keys, tokens, `BIND_PATHS` with its `sensitive` marks, `WORD_SLOTS`, `NLOOK_LIMITS`, the per-surface subsets, the capability names |
| `shared/types/keyboardFace.ts` | key faces, marks, `PRESS_KINDS`, the skin block, `KEY_FACE_LIMITS`, and what a skin may never carry |
| `shared/native/looks.json` | the catalog: palettes and designs. One file, one `v` |
| `shared/native/skins/*.json` | keyboard skins. **Server-only**: they are never in the phone's catalog |
| `shared/native/fixtures/**` | the shared cases all five sides test against |
| `experience/native/clean.ts` | one design, cleaned. Every verdict here is a fixture case |
| `experience/native/catalog.ts` | load, check, publish, the high-water `v`, the per-build projection, the bootstrap flag, `legacyLookOf` |
| `experience/native/target.ts` | which design a surface gets, and the four rules a design must pass first |
| `experience/native/bind.ts` | `vars`, and the private rule applied where the server fills it |
| `experience/native/size.ts` | the Live Activity's 3.5 KB, and the exact order things are given up in |
| `experience/keyboard/skin.ts` | a skin expanded into the key tree `config.ts` already builds |
| `routes/app/nativeLooks.ts` | the catalog, the art and font files, and the admin publish |
| `scripts/native-render/` | the preview renderer: see a design before a phone has it |

---

## How a design reaches a phone

1. The bootstrap says `"native.looks": { "v": 7, "url": "/v1/native/looks?v=7" }`.
2. The app fetches the catalog when `v` differs from its copy, or when its own `drawsFormat` changed (an over-the-air update
   can raise it). It keys its copy on **(v, drawsFormat)**.
3. The app cleans every design **on its own**, downloads the art and fonts it is missing, renders the bot stills it needs, and
   writes the lot into a new versioned folder, then switches one small pointer file. Only after that may anything name the new
   ids.
4. The glance request carries `&nl=<the catalog v the phone holds>` and `&can=NativeLook1,…`. The answer gains
   `look: { "x0": …, "board": …, "bots": … }`, `palette`, `boards` and `vars`.
5. A Live Activity push names a design the same way, against the `nl` that phone sent when it registered its token.

**"Bots at work" is named on the GLANCE, on both phones** (`look.bots`): the Live Activity's design on iOS, the ongoing
notice's on Android. The glance request is the only place that knows one exact phone — its own `nl`, its own `can`, its
platform — while a data push has nothing of its own to ask on. On iOS the app's in-process updates can set it from nowhere
else, so without it every local update would clear what the last push named and the views would flap. On Android the binary
reads it from the stored glance and ignores anything in the push.

**When a new design actually shows.** iOS widgets: at the next app open, sometimes sooner through the nudge below. Android
widgets: the same. The Live Activity: on its next update push. The keyboard: on its next open after the 60-second TTL. Never
"the minute it is published".

**The nudge.** Once per publish, the server tells phones that said `NativeLook1` on their push token that a new catalog is
out: `{ kind: "native.looks", v }` and nothing else, data-only on Android at NORMAL priority (FCM deprioritizes an app whose
high-priority messages draw nothing, and a catalog can wait for Doze's next window) and content-available on iOS (Apple
requires priority 5 for a background push). Batches of 100 spread over about ten minutes, so the phones do not all fetch the
catalog and its art at once, and the same `when.users` gate as the bootstrap flag. `?nudge=0` on the admin call skips it.

---

## Publishing

**Normal:** edit `shared/native/looks.json`, raise `v` by one, open a PR. CI runs the check and renders the previews.

**One style for the file.** `looks.json` is pretty-printed down to the node and compacted wherever a node fits in 150
columns at its own indent. `npx tsx scripts/native-render/format.ts --write` puts it back in that style, and a test
(`native-looks.test.ts`) fails when the file is not already there, so an edit is ten lines and never a whole-file reformat.

**Hot:** `PUT /v1/admin/native/looks?dry=1` first — it answers with every problem and what each design would lose — then the
real `PUT`. `DELETE` rolls back to the file's catalog.

**The check refuses a design it would only CLAMP.** `cleanDesign` has two jobs, and only one of them is ours. For a design an
OLDER build cannot read, clamping is right: the unknown part is dropped and the rest still draws. For OUR OWN catalog it is
not, because `project()` hands out the design object **as written** — never `cleanDesign`'s copy — so a foreign link, an
unknown node or a prop over its cap would be served exactly as authored. `checkNativeLooks` therefore makes every issue an
error, and the per-design byte cap is measured on the design as written as well as on the cleaned copy.

**The check reads `targets` too.** They are server-only, so nothing downstream ever validates them: a rule naming a design
that does not exist, or an Activity design for a widget surface, used to publish silently and then draw nothing — which
reads on a Home Screen exactly like the feature being off. `when.users` must be a LIST: written as a string it would be
substring-matched, so `"abc"` would reach the account `b`.

**`v` never repeats.** The server keeps a high-water mark on the control volume, so a rollback re-serves the older content
under a **higher** number. Without that, a phone holding the first copy of `v: 7` would never refetch the second one.

The mark covers the DEPLOY path too, not only pushes. When the file's catalog wins and its own `v` has already gone out
carrying other content — push `v: 7`, `DELETE`, and then a PR raises `looks.json` to `v: 7` — the file is served as
`mark + 1`, and that number is written down beside the mark so it never moves again. The route, the ETag, the bootstrap
flag and the rollback's nudge all read the catalog through `activeNativeLooks()`, so they all say the one number.

`since` — the `v` a design's content first appeared under — is computed at publish (`stampSince`) and never written by an
author. **The deploy path writes none**, so a design with no `since` counts as the active catalog's own `v`: it first
appeared in the catalog being served, and a phone holding an older one has not downloaded it. Reading a missing `since` as
0 would skip rule 2 of the four on the path we actually publish by.

---

## Art and fonts

Both live **in the repo** (`shared/native/art/`, `shared/native/fonts/`) and are served by the API host itself:
`GET /v1/native/art/<sha256>@<1|2|3>.png` and `GET /v1/native/font/<sha256>`. Immutable, a year in the cache, no cookies and
nothing in the URL but the hash, which is what lets a design carry a picture at all.

There is no CDN and no separate art host, on purpose. Both keyboards and the widgets only ever fetch from a host compiled
into the binary — exactly `api.x0bot.com` or `api.tailzu.space`, https only — and a build is in the field for months and
cannot learn a new one. The image already ships `shared/`.

- **One hash per FILE, not per entry.** An art entry is `{ key, w, h, files: [{ scale, sha256, bytes }] }`. The @2 and @3
  copies are different bytes, so one hash for the whole entry could only ever match one scale; the others failed their
  check and silently drew their `alt`.
- **A font is the bare hash on disk, with no extension**, because that is what the phone asks for.
- **`cleanCatalog` refuses to publish a catalog whose files are not on disk under their own hash**, inside the cap, and (for
  art) a real PNG. So the hot path cannot add a file: a design whose art is new needs a PR and a deploy. That is the price of
  serving art from the image, and it is the right way round — a catalog naming a file nobody has would draw holes on Home
  Screens until someone noticed. A test walks both folders and checks every name against its own hash.
- A skin's `manifest.art` follows the same rule, and a face's `art` is the **bare manifest name**, never a URL.

---

## Privacy

The privacy rule lives in the renderer, not in any design, and a design cannot opt out of it.

- Bind paths that can carry private words (`needs.items[].question`, `question`, `job.task`, `lastDone.result`) are marked
  `sensitive` in `BIND_PATHS`, and the mark survives an index (`needs.items[0].question`) and an `it.`.
- On accessory families and on `activity.lock`, a sensitive path resolves to the lock-safe fill when the item is private; on
  iOS the text is also wrapped in `privacySensitive()`, so a locked phone redacts it.
- **`vars.*` is sensitive by default**, because a renderer cannot classify a free string. The server's own half of that rule is
  in `bind.ts`: a var whose words could be private is **not sent at all** while the thing is private.
- The Android notice is posted `VISIBILITY_PRIVATE` with a public version from the same lock-safe fill, and `clean.ts` refuses
  a `chip` that binds a sensitive path, because the chip is what the status bar and Always-On show.
- Bot stills are drawn **on the phone** from the bots' own catalog, so nothing personal is sent anywhere to render art.
- Art and fonts are fetched by content hash from our own host, with no cookies, no auth and no id in the URL. A design can
  never carry a tracking pixel.

**The keyboard, separately: no typed text ever leaves the device.** The config request carries the platform, the build stamp,
the can-list, the bad-skin id, the language and the person's token — never the field, the host app, the keystrokes or their
timing. Every fetch happens when the config arrives: the config, then one batch of everything in `skin.manifest`. Nothing is
fetched on a key press or a layout switch, so no request can be tied to a keystroke. There is no per-key press counting, ever.

---

## Keyboard skins

A skin is authored on the server and **expanded into the key tree** `config.ts` already builds: into `props.face`,
`style.fontFamily`, `style.press`, `themeDark` / `themeLight` and the existing `kb.*` flags. The phone ships primitives only —
no skin resolver, no precedence chain — and sees the expanded tree plus one small `skin` block (id, sha, budget, manifest).

Four laws, enforced on publish and again in the renderers:

1. A key never changes what it does. A face is paint: no `on`, no actions, no endpoints, no layout (guideline 4.4.1).
2. No typed text ever leaves the device.
3. Every fetch happens when the config arrives, in one batch.
4. Art and fonts come by content hash from our own compiled-in host.

A skin that names anything in `SKIN_FORBIDDEN_KEYS` is **refused**, not cleaned, because each one would be a 4.4.1 problem.

`shared/native/skins/clay-dusk.json` is the first one, and deliberately the cheapest that is still worth having: it fetches
nothing at all, so a session with it makes exactly the same requests as a session without it.

**The bundled snapshot stays unskinned.** `default-config.json` and `res/raw/tailzu_default_config.json` are what the keyboard
draws with no network and no Full Access, and what the crash guard falls back to after its last strike, so they must never
depend on code a skin brings. `scripts/export-keyboard-snapshots.ts` never calls the expansion.

---

## Seeing a design before a phone has it

```
cd tulmi
npx tsx scripts/native-render/preview.ts        # one page, a design picker and a day picker
npx tsx scripts/native-render/render.ts --all   # every design, every sample, as PNGs
npx tsx scripts/native-render/render.ts --design x0.dusk --data needs
KEYBOARD_SKINS=true npx tsx scripts/native-render/render.ts --skin clay-dusk   # a keyboard skin
npx tsx scripts/native-render/format.ts --write  # put looks.json back in the one style
```

A **keyboard skin** has no roots and is not a design, so `--skin` draws something else: the EXPANDED key tree, the one the
phone receives, from `buildKeyboardConfig` through `withKeySkin` — both appearances from the expanded `themeDark` and
`themeLight`, every print from the key node's own `props.face`, and a frame with one key held down so `style.press` is
something to look at rather than three numbers. The switch has to be on for the expansion to happen at all, which is why the
command carries `KEYBOARD_SKINS=true`.

Every root at its real point size, dark and light, plus the modes the system imposes and a design does not get to opt out of:
tinted, Always-On, StandBy and the Lock Screen's monochrome.

**It is a reference, not the truth.** A browser measures text differently from SwiftUI and differently again from
RemoteViews, so a line can break a word earlier or later. Colour, the palette roles, what a bound path resolves to, what hides
and what a word's slots fill with are the real rules, read from the same files the phones read. The device snapshot tests are
the truth.

---

## The designs in the catalog today

| id | surface | what it is |
|---|---|---|
| `x0.plain` | widget | the end of every widget fallback chain: a name and one line, in nothing but palette roles |
| `x0.base` | widget | what today's X0 widget draws, as data |
| `x0.dusk` | widget | the evening face: a bot still, a drawn horizon, the lead line in `display` |
| `x0.slab` | widget | numbers first. No picture of any kind — the cheap end of the format, and the one to reach for on a tight phone |
| `bots.plain` | activity | the end of the Live Activity chain |
| `bots.base` | activity | what today's "Bots at work" draws |
| `bots.night` | activity | a readable-across-the-room timer, the stage names, and the ETA from `vars` |
| `board.base` | widget | the bundled default board, so the "X0 Board" kind is never empty at review (2.3.1) |
| `board.night` | widget | the board in the evening palette: the week as beads, the count that waits, the people |
| `bu.base` | liveupdate | Android's ongoing notice: a template fill, not a canvas |

---

## When something goes wrong

- **A widget crashed on a design.** The widget writes a crash marker before it builds that design's root view and clears it
  after the snapshot pass; a marker from another launch is a strike, two strikes mark the design bad. The app reports the id to
  `POST /v1/widgets/looks/bad`, and this server stops naming it **for that person** — their other phone does not get to find
  out the hard way too.
- **A keyboard crashed on a skin.** Two strikes switch that config sha to plain mode (faces, press, fonts and art ignored; the
  tree and the colours stay) and send `X-Tulmi-Keyboard-Bad`, and the server answers with the unskinned tree. Two more, and it
  falls back to the bundled snapshot.
- **A push was dropped silently.** That is Apple above 4 KB. The body is measured in three places and `size.ts` writes down the
  order things are given up in: `vars`, then the stage names, then the long words. A body always ends under the cap.
- **Everything at once.** Turn `NATIVE_LOOKS` off. Every phone is back on its native view at its next open.
