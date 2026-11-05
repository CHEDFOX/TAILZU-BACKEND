# Blip on the desktop: moves and poses from the server

Blip's moves (wake, listen, think, celebrate, the quirks he does while he waits, the ones he does when you point at him),
the poses he peeks over Ask's card in, and the poses he stands in on the ground are **data the server sends**. A new move,
or a change to one, reaches every desktop without an app update and without a deploy.

| Piece | Where |
| --- | --- |
| The catalog | `shared/bots/blip.json` |
| Checks, the served catalog, a pushed one | `tulmi/src/experience/bots/blip.ts` |
| Routes | `tulmi/src/routes/bots/blipCatalog.ts`: `GET /v1/blip`, `PUT /v1/admin/blip[?dry=1]`, `DELETE /v1/admin/blip` |
| The bootstrap's word | `"desktop.blip": { v, url }` (desktop only) |
| The desktop's compiler | TAILZU-DESKTOP `src/shared/blipCatalog.js` (the bots' motion language: `botTiles.js` `compileWith`) |
| Fetching and keeping it | TAILZU-DESKTOP `src/main/blipSync.js` (kept in the app's data as `blip.json`) |
| Playing it | TAILZU-DESKTOP `src/shared/blip.js` `useCatalog` (every window that draws Blip) |
| The copy each build carries | TAILZU-DESKTOP `src/shared/blipStarter.js`, written by `tulmi/scripts/gen-blip-starter.mjs` |

## How it flows

1. The desktop's bootstrap carries `"desktop.blip": { v, url }`.
2. When `v` is not the one it has, the main process fetches `url`, compiles it, keeps it on disk and hands it to every
   window with the knobs. Each window swaps Blip's moves in place: a Blip already on screen plays the new ones from his next
   frame.
3. A catalog that does not compile is not used, and the one before it stays. A move that does not compile is left out while
   the rest load. With no network, the last kept catalog plays, or the copy the build carries.

## The format

```json
{
  "v": 2, "format": 1,
  "macros": { "io": [["k"], "(k < 0.5 ? 2*k*k : 1 - pow(-2*k + 2, 2)/2)"] },
  "gestures": {
    "wiggle": {
      "length": 1.2, "hover": true, "quirk": true,
      "let": [["w", "sin(t*20)*exp(-t*2)"]],
      "pose": { "spin": "0.2*w", "ra": [2.6, "-0.3 + 0.4*w"], "la": [2.6, -0.3], "mouth": "grin", "eye": "wide", "lid": 0 }
    }
  },
  "card": { "peek": { "rise": 1, "tilt": 0.04, "brows": 0.1, "lid": 0.18, "hands": 0, "hop": 0, "neck": 0 } },
  "ground": { "present": { "ra0": 1.22, "ra1": 0.4, "...": 0 }, "key": "carry" },
  "groundGlow": { "listen": 1 }
}
```

* **A move** is a `pose`, or `steps`: the first step whose `until` (seconds: `t` below it) or `when` (an expression that
  is true) holds is used, and a step with neither is the rest. A step may be `as` another move, at the same `t`.
* **Numbers** are a number or an expression in the bots' motion language (the one the tiny bots' moments use): arithmetic,
  comparisons, `a ? b : c`, and `sin cos tan abs sqrt floor ceil round exp log atan2 min max pow hypot clamp smooth lerp
  crest ramp run noise sign tri hash`, with `pi`, `tau` and `e`. Write `0.5`, not `.5`.
* **Names** an expression may read: `t` (seconds into the move), `v` (the voice, 0 to 1), and the move's and its step's
  `let`s, each able to read the ones before it. `macros` are small formulas spelled out where they are used.
* **A pose's fields**: `tilt brows headLift headSpin antSpin antLen lid sqx sqy spin hop bob glow mouthOpen antWob thumb
  point`; the pairs `ra la look`; `legs` (two `{ th, lift }`); `mouth` (`smile grin flat o`) and `eye` (`wide tiny
  spiral`), either one a name or `{ "if": expr, "then": name, "else": name }`; and `handsOver`, `noBlink` (true or false).
  A field not set is his resting value.
* `length` (seconds) for a move that ends (the rest loop); `quirk: true` to do it at random while he waits;
  `hover: true` to do it when the pointer is on him in the pill.

## Pushing a new catalog

```
curl -X PUT "https://api.x0bot.com/v1/admin/blip?dry=1" -H "x-admin-secret: $ADMIN_SECRET" \
     -H "content-type: application/json" --data @blip.json     # only checks it
curl -X PUT "https://api.x0bot.com/v1/admin/blip" -H "x-admin-secret: $ADMIN_SECRET" \
     -H "content-type: application/json" --data @blip.json     # serves it
curl -X DELETE "https://api.x0bot.com/v1/admin/blip" -H "x-admin-secret: $ADMIN_SECRET"   # back to the file's
```

Its `v` must be above the one served now. It is kept on the control volume, so a restart keeps it, until a deploy brings
a file with a higher `v`. For a release, change `shared/bots/blip.json` and run `node tulmi/scripts/gen-blip-starter.mjs`,
so the build carries it too (the desktop's test checks the two match).

## What still needs an app update

How Blip is drawn: his shape, his parts and the dotted look (`blip.js` `walkerFigure`, `walkerDots`). A move can only use
the parts and fields listed above. A new kind of part (a hat, a third antenna) or a new field is a desktop release.
