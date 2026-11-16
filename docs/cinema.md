# The cinema bot's 3D: a scene is data, and the loop looks at its own work

A person asks for a thing in three dimensions — a product shot, a turntable, a title, a room — and the cinema bot builds it, renders it, **looks at what came out**, fixes what is wrong, and renders the real one. The loop is whole on its own: it is handed a way to run Blender and a way to keep bytes, and it hands back a scene, the script that makes it again, and the pictures.

**It is wired to nothing yet.** `CINEMA` is off, no route reaches it and no bot calls it. The stages, the progress and the decision cards that make it part of the cinema bot come after, and nothing in here needs to change for them.

Code: `tulmi/src/cinema/`. Tests: `tulmi/tests/cinema-scene.test.ts`, `cinema-script.test.ts`, `cinema-make.test.ts`.

* [1. The one decision: a scene is data](#1-the-one-decision-a-scene-is-data)
* [2. The loop](#2-the-loop)
* [3. Where it renders](#3-where-it-renders)
* [3a. With no app anywhere: the backend on its own](#3a-with-no-app-anywhere-the-backend-on-its-own)
* [4. What is kept, and what is not](#4-what-is-kept-and-what-is-not)
* [5. What it costs](#5-what-it-costs)
* [6. Settings](#6-settings)
* [7. Fitting it to the bot, later](#7-fitting-it-to-the-bot-later)
* [8. What it does not do yet](#8-what-it-does-not-do-yet)

## 1. The one decision: a scene is data

A model never writes Blender code. It answers with a **scene** — shapes, materials, lights, a camera, a move — as plain data (`types.ts`); the checker reads every field and drops or clamps what it cannot have (`check.ts`); and we write the Python (`script.ts`).

That single decision is what makes the rest work:

* **Nothing a model writes is executed.** It chooses from seven shapes, seven kinds of light and seven modifiers; names are held to a charset, colours to six hex digits, text is escaped, and an asset is a NAME the runner looks up — a scene can never reach a path, a flag or a line of its own.
* **The same scene is the same picture.** The script is written to the same bytes every time, with a fixed seed, so a render can be cached and "the same, but at dusk" is a diff.
* **It is small.** A scene is kilobytes. It travels to whatever machine is going to render it, and it is the thing worth keeping forever.
* **A fix is three lines.** The eye says the box is sinking through the floor; the next round changes that object's `at` and leaves everything else alone, because objects have names.

The caps (`CAPS`) are clamps, never refusals: 80 objects, 8 lights, 24 materials, 512 samples, 1920 px, 20 seconds. A scene asking for 400 objects comes back with 80 and a note, because half a scene a person can look at beats an error they cannot.

## 2. The loop

```
ask ─► build the scene ─► check ─► write the script ─► render a PREVIEW (480×360, 24 samples)
                             ▲                                        │
                             └──── what the eye saw ◄── look at it ◄──┘
                                                                      │  the eye is happy, or the rounds run out
                                                                      ▼
                                                        render the REAL one (and keep it)
```

The looking is the part that matters. A model that never sees its render will hand back a black frame with confidence; a model shown a 480-pixel preview says "it is sinking through the floor" and fixes it. Two or three rounds is usually the whole of it, and the expensive render happens once, at the end.

It stops for one of five reasons and always says which: `done` (the eye was happy), `rounds`, `budget`, `render` (the script would not run) or `model`. Whatever the reason, **everything made up to then is kept** — a scene that is nearly right is worth more than an error.

A script that will not run is not a failure either: the error goes back to the model as the thing to fix, in the next round.

## 3. Where it renders

The loop knows nothing about where Blender is. It is handed a `Render` (`ports.ts`) — a script in, pictures out — so the same loop runs against:

| Where | What it is for |
| --- | --- |
| **The person's own computer** | the fast path: their card, their files, nothing to pay. The desktop app already runs commands there |
| **A container on the VPS** | small previews when no computer is attached. `blender.ts` is exactly this |
| **A rented GPU box** | long animations and heavy frames: the same container image, a different machine |
| **A fake** | the tests. 36 of them, and not a frame rendered |

`blender.ts` is the reference runner: a folder of its own per render, the script written into it, `blender --background --factory-startup --python`, no shell anywhere. Where it writes and where the assets are come from the environment (`CINEMA_OUT`, `CINEMA_ASSETS`), never from the scene. Past its time it is killed and what it had written is still read.

## 3a. With no app anywhere: the backend on its own

Blender is a command-line program that happens to ship with a window. `--background` opens no window, needs no screen, no X, no desktop session: it reads a Python file, writes pictures, and exits. On a server it is a binary like any other, and this is the whole of it:

```bash
apt-get install -y blender          # or the official tarball, which is newer
blender --version                   # what `ready()` asks before anything is sent here
```

Then `CINEMA_BLENDER` names it and `renderHere()` is the renderer. Nobody's computer is involved: a person on a phone asks, the backend builds the scene, renders it, puts it in the bucket, and the phone is handed a URL. The desktop app is an **optimisation** — their card, their files, free — not a requirement.

Four things are true of a server that are not true of a laptop:

* **No graphics card, so no Eevee.** Eevee draws with a card; without one there is nothing for it to draw with. The script asks the machine at run time and falls to Cycles, which renders on cores and runs anywhere (`script.ts`). Nothing upstream has to know.
* **Cores decide the wait, not money.** A 480×360 preview at 24 samples is seconds. A 1600×1200 frame at 128 samples is minutes on a few cores — ten to thirty times what a card would take. Animation on CPU is where this stops being sensible: four seconds at 24fps is 96 of those frames.
* **One at a time.** Two renders on one box do not go twice as fast; they share the cores and take the app down with them. `blenderRunner` queues them, one lane by default.
* **Fonts and memory.** A bare container has no fonts, so a `text` object renders as boxes — install a font package with Blender. Subdivision is the thing that eats memory; the checker caps it at three levels.

Deployed the way the media worker is (its own container, started by a profile, no route to the internet, a memory and CPU limit, a health check), it is the same shape the backend already knows: see DEPLOY.md.

## 4. What is kept, and what is not

Keys are `c/<user>/<creation>/v<n>/<name>` in the bucket we already have (`media/blob.ts`): one person's key can never name another's, a version never writes over the one before it, and a creation survives the job that made it.

| Kept | Why |
| --- | --- |
| **the script** and the scene as data | kilobytes, and enough to make everything else again. The asset |
| **the preview** of each round | it is what a person sees in a list, and what the eye judged |
| **the final render** | a picture, or ONE clip |
| the .blend | only when asked for (`keepBlend`): it is the big one |

**A move comes back as one video, not as frames.** Blender's own encoder writes an H.264 file, so a four-second turntable is a few megabytes instead of ninety-six PNGs nobody will ever clean up. That one rule removes most of what a 3D product would otherwise accumulate.

## 5. What it costs

Two model calls a round: the scene (the code tier, a long answer) and the eye (the vision tier, a short one). The whole creation is held to `CINEMA_CAP_PAISE`, and the loop stops the moment it is reached rather than halfway through a render.

The renders themselves cost what the machine costs — nothing on the person's own computer, a few paise on a container, more on a card. The preview being deliberately tiny is what keeps the iteration honest: three rounds of 480×360 at 24 samples costs less than one real frame.

## 6. Settings

| Switch | Default | What it does |
| --- | --- | --- |
| `CINEMA` | off | the whole thing. Off, nothing reads it and nothing can reach it |
| `CINEMA_USERS` | empty | comma-separated account ids: while it names anyone, only they get it |
| `CINEMA_BLENDER` | `blender` | the binary on this machine; none, and this machine renders nothing |
| `CINEMA_WORK` | empty | where a render's folder goes (a disk with room beats the system's temporary place) |
| `CINEMA_CAP_PAISE` | 400 | the most the models may spend on one creation, over all its rounds |

## 7. Fitting it to the bot, later

What is missing is the part that belongs to the bot, not to the 3D:

* **A job with stages**, so a long render is progress on a screen rather than a wait: gather, build, look, ask, render. The pieces map one-to-one onto the rounds this loop already reports.
* **A creations index** — owner, bot, job, version, parent, what is kept, what it cost. A creation is not an attachment and should not be bent into the attachment tables; it is also what a gallery of a person's work would read.
* **Decision cards** for the moments that are taste rather than correctness: two camera angles, pick one. The loop already stops with a preview in hand, which is the natural place for it.
* **Picking the machine**: the runner the desktop app already provides, the container, the rented card. The loop takes whichever it is handed.

## 8. What it does not do yet

* **No in-app 3D viewer.** A person sees renders and a clip, not something they can spin with a finger. That needs a new drawing surface in both apps, and it is not where the value is first.
* **No generated meshes.** Image-to-3D would give a rough prop to import; the scene vocabulary already has `asset` for it, and the service behind it is not wired.
* **No textures or UVs.** Materials are colour, metal, roughness, glass and glow. An image on a surface is the next thing the vocabulary needs.
* **No library of its own.** Assets and skies come from whatever the runner is given.
