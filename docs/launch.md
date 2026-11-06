# The phone's launch: motion from the server

The launch is what plays when the app opens: the splash's bot pulls himself up over his bar and is gone, hands and all;
half a second later his hands come back and grab the bar's middle, one from above and one from below, and twist as the
bar is pulled in to them. Its motion is **data the server sends**: a change reaches every phone without an app update.

| Piece | Where |
| --- | --- |
| The launch | `shared/launch/launch.json` |
| Checks, the served launch, a pushed one | `tulmi/src/experience/phone/launch.ts` |
| Routes | `tulmi/src/routes/app/launchMotion.ts`: `GET /v1/launch`, `PUT /v1/admin/launch[?dry=1]`, `DELETE /v1/admin/launch` |
| The bootstrap's word | `"app.launch"`: the launch, whole (phones only) |
| The app's compiler | TAILZU-FRONTEND `app/src/launch/launchMotion.ts` (the bots' motion language: `botTiles/core.ts` `compileWith`) |
| Playing it | TAILZU-FRONTEND `app/src/launch/LaunchCurtain.tsx` |
| The copy each build carries | TAILZU-FRONTEND `app/src/launch/launchStarter.ts`, written by `tulmi/scripts/gen-launch-starter.mjs` |

## How it flows

1. Every phone's bootstrap carries `"app.launch"`: the launch, whole (about 4 KB).
2. The app keeps it with the rest of the bootstrap. The launch plays before anything is fetched, so it plays the kept
   one: **a change shows from the start after the one that received it.**
3. A launch the app cannot compile is not played; the copy the build carries is.

## The format

```json
{
  "v": 2, "format": 1, "length": 2200, "fade": 220, "pinchAt": 1730,
  "macros": { "K": [["kv", "ka", "kb"], "clamp((kv - ka)/(kb - ka), 0, 1)"] },
  "let": [["comeL", "1400"]],
  "bar":    { "let": [], "dy": "..." },
  "head":   { "dy": "...", "sway": "...", "sq": "...", "shut": "...", "shown": "..." },
  "gloves": { "grip": "...", "dy": "...", "edge": "...", "lift": "...", "flip": "...", "gx": "...", "turn": "...", "size": "...", "shown": "..." },
  "strip":  { "dx": "...", "sx": "...", "sy": "...", "shown": "..." }
}
```

* `length` (ms): how long the motion is, then the app's white. `fade` (ms): the curtain fading onto the app.
  `pinchAt` (ms): the bar is drawn whole until then, and in strips (`strip`) from then.
* **Every field** is a number or an expression in the bots' motion language, of `t` (ms since the motion began):
  arithmetic, comparisons, `a ? b : c`, `&&`, `||`, `!`, and `sin cos tan abs sqrt floor ceil round exp log atan2 min max
  pow hypot clamp smooth lerp crest ramp run noise sign tri hash`, with `pi`, `tau` and `e`. Write `0.5`, not `.5`.
* **Names** every expression reads: `t`, and the art's geometry in points: `Z` (the art, 136), `U` (one art pixel),
  `barTop barMid barBottom barLeft barRight mid`. A glove's also read `side` (0 left, 1 right), `cx` and `half` (where the
  art has it and half its width); a strip's `i`, `n`, `x` (its middle) and `d` (0 at the bar's middle, 1 at its ends).
  The launch's `let`s are read by every part; a part's own after them. At most 32 names in one part.
* **The fields**:
  * `bar.dy`: how far the bar has dropped (points).
  * `head`: `dy` (points), `sway` (degrees), `sq` (his squash, 1 is none), `shut` (1: eyes shut), `shown` (0 to 1).
  * `gloves` (one spec, read with `side`): `grip` (a squeeze toward the bar, 0 is none), `dy` (how far it has gone up
    into the bar), `edge` (how far down the bar's face it is clipped; negative opens the clip above the bar), `lift`
    (how far it still is from the bar, screen points), `flip` (-1 turns it over about the bar's middle: grips the top),
    `gx` (from where the art has it), `turn` (degrees), `size`, `shown`.
  * `strip` (one spec, read with `i`, `x`, `d`): `dx`, `sx`, `sy`, `shown`.
  * A field left out is that part at rest.

## Pushing a new launch

```
curl -X PUT "https://api.x0bot.com/v1/admin/launch?dry=1" -H "x-admin-secret: $ADMIN_SECRET" \
     -H "content-type: application/json" --data @launch.json     # only checks it
curl -X PUT "https://api.x0bot.com/v1/admin/launch" -H "x-admin-secret: $ADMIN_SECRET" \
     -H "content-type: application/json" --data @launch.json     # serves it
curl -X DELETE "https://api.x0bot.com/v1/admin/launch" -H "x-admin-secret: $ADMIN_SECRET"   # back to the file's
```

Its `v` must be above the one served now. It is kept on the control volume, so a restart keeps it, until a deploy brings
a file with a higher `v`. For a release, change `shared/launch/launch.json` and run `node tulmi/scripts/gen-launch-starter.mjs`,
so the build carries it too (the app's test checks the two match).

## What still needs an app update

The art and its layers: the head, the bar and its strips, the two gloves, and what each field does to them. A new kind
of part (a third hand, a hat) or a new field is an app release.
