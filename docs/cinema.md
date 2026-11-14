# Cinema: films shot by shot, and pictures

A built-in bot that makes a film from what a person says, the way a small crew would: a director writes the script and the shot list, a
storyboard is drawn and agreed, each shot is filmed by the camera that suits it, every take is looked at before anyone sees it, and the editor
cuts it together with the voice-over, the music and the subtitles. It makes pictures too: posters, product shots, portraits, logos and edits of
a photo the person sends. Every model is reached through OpenRouter (`OPENROUTER_API_KEY`), the key the server already has.

Code: `tulmi/src/cinema/`, the doors `tulmi/src/routes/bots/cinema.ts`, the screens `tulmi/src/experience/bots/screens/bots/cinemaPage.ts` and
`cinemaScreens.ts`, migration `0089_cinema.sql`. Off unless `CINEMA=true` (and `BOTS`).

* [1. Why it works better](#1-why-it-works-better)
* [2. A film, from idea to cut](#2-a-film-from-idea-to-cut)
* [3. The models and the router](#3-the-models-and-the-router)
* [4. The prompts](#4-the-prompts)
* [5. The eye and the retakes](#5-the-eye-and-the-retakes)
* [6. The edit](#6-the-edit)
* [7. Pictures](#7-pictures)
* [8. Money](#8-money)
* [9. What the server answers](#9-what-the-server-answers)
* [10. Privacy](#10-privacy)
* [11. Configuration and deploy](#11-configuration-and-deploy)
* [12. Tests](#12-tests)
* [13. Still to come](#13-still-to-come)
* [14. Ideas borrowed](#14-ideas-borrowed)

## 1. Why it works better

The big tools sell a vending machine: pick a model, pick a preset, type a prompt, pay, look at a five-second clip, sigh, pay again. Continuity,
story, sound and the edit are left to the person. This bot works the other way round:

| The usual way | Here |
| --- | --- |
| The person picks a model and a preset | The person says what they want; the router picks the model per shot from what the shot needs (faces, motion, physics, a camera move, spoken lines, words in frame), within the quality they chose |
| One clip at a time, no story | A director writes a bible (who, where, the look) and a shot list with film grammar: an establishing shot, varied sizes, one action and one camera move a shot, the 180-degree rule, cutting on action |
| Every attempt costs video money | Everything is a still first (cheap). The storyboard and the voice-over are looked over before a second of video is made, and every shot is animated *from its agreed still*, so what was agreed is what is filmed |
| A face changes from clip to clip | Reference sheets for each person and place seen more than once, and one look frame for the colour and light, passed with every still; the motion prompt never re-describes the picture |
| The person checks every clip and pays for the bad ones | A vision model checks every still and every take against the shot card; a failed take is retaken with a fix line, or on another model when the fault is the model's (bodies, melting, physics). After three takes the best is kept, with a note |
| Stitching, voice-over, music and subtitles are done elsewhere | The cut is made here: dissolves where asked, the voice-over placed and measured, the music ducked under it, subtitles, loudness for phones |
| Change one thing, start again | A change in plain words, to the film or to one shot: only what it touches is made again (a new line is a new take from the same still; a new coat is a new still and a new take; the cut follows) |
| Credits, and surprise charges | No credits and no prices: the person's plan covers their films. They say go twice (the script, the storyboard); the money is ours to watch, within limits per film, per day and per plan |

Hindi and Hinglish are first-class: the script, the lines, the voice-over and the subtitles are written in the person's language.

## 2. A film, from idea to cut

`Film.status` (`src/cinema/types.ts`):

| Status | What is happening | Who moves it on |
| --- | --- | --- |
| `writing` | the director writes the bible and the shot list (`plan.ts direct`, the strong tier) | by itself, about a minute |
| `script` | the person reads it and changes anything in plain words (`revise`) | **the person**: Make the storyboard (`approve-script`) |
| `boarding` | the look frame, the reference sheets, the stills (two for a shot with people; the eye keeps the better), the voice-over | by itself |
| `board` | the storyboard | **the person**: Film it (`approve-board`) |
| `rendering` | each shot animated from its still, checked, retaken | by itself |
| `cutting` | the cut | by itself |
| `done` | the film, ready to watch, download and share | a change sends it back to `rendering` |

`failed` (something could not be got past) and `stopped` (the person stopped it) end it. `Film.hold` says why a moving film waits: `budget`
(the film has reached a limit and is paused for today: it carries on by itself, or sooner with a bigger plan) or `shot` (a shot the eye gave up on:
Try again, or change it).

**How it moves.** `flow.ts steps(film)` is one pure function that looks at a film and says what to do now: make a sheet, a still, a voice-over,
a take; ask how a take is going; check one; cut; or move the status. The service (`service.ts`) runs the steps every few seconds (`tick`), a
few at a time, one of each per shot, as the film's owner. Because every decision is made again from the film's own data, a server that
restarts picks each film up where it was, and a changed shot is made again by itself: each shot carries fingerprints of what its still and its
take were made from (`compile.ts stillPrint`, `takePrint`), and a step is due when a fingerprint no longer matches.

**What waits for what.** Sheets and the look frame before the stills that need them; a shot that *continues* the one before waits for that
shot's chosen take, starts on its last frame and lands on its own still (first and last frame), so the moment carries on with no jump.

## 3. The models and the router

Two halves, kept apart (`models.ts`, `imageModels.ts`):

* **Live**: OpenRouter's lists (`GET /api/v1/videos/models`, `/api/v1/images/models`), read at boot and every six hours: the durations, aspect
  ratios and resolutions each model takes, whether it takes a first and a last frame, whether it makes sound, and its price. A price change or
  a new duration needs no deploy.
* **Craft**: our judgment, model by model, 0 to 5 on realism, faces, motion, physics, camera moves, stylised looks, spoken lines, words in frame
  and keeping a face; its tier (draft, standard, premium); how it wants its prompt written. A model is used only when it is in both halves.

The video models judged today: Google Veo 3.1 (and Fast, Lite), Gemini Omni Flash, Kling v3.0 Pro and Std and Kling O1, Seedance 2.5, 2.0, 2.0
Fast and Mini, Wan 3.0, 3.0 Prime and 2.7, HappyHorse 1.1, Hailuo 3 Max, Runway Gen-4.5. The Chinese labs' models are first-class: on motion,
camera moves and keeping a face they are often the best choice, and usually the cheapest. Pictures: Nano Banana 2.1 and Gemini 3 Pro Image,
Seedream 5.5 and 5.0 Flash, Qwen Image 3 Pro and 2.1 Turbo, Hunyuan Image 3.5, GPT Image 2, FLUX 3, Recraft 4.1 vector.

**The router** (`route.ts`) scores each model for each shot: what the shot needs (`needs`: a close-up with people needs faces, fast action needs
motion, rain needs physics, an orbit needs camera, lines need dialogue) times the model's scores, less a little for the price (more in the
cheaper tiers) and for a duration it cannot quite make. Hard rules first: the film's aspect ratio; a last frame for a shot that continues; sound
for a shot with lines; never above the film's tier (unless the person pinned the model); a model blamed for this shot is passed over on a retake.
OpenRouter's prices are read in all three ways it writes them: dollars a second, cents a second, and Seedance's price per video token.

## 4. The prompts

The result comes from the detail, and the detail starts with the director. Every shot card is written in full (`plan.ts`
`DIRECTOR_SYSTEM`): concrete, visual, specific, with no empty words, and with the result first:

| Field | What the director writes | Where it goes |
| --- | --- | --- |
| `intent` | what the viewer should feel or understand by the shot's end | the still, the motion, the eye's check |
| `frame`, `composition` | the opening instant; the layers (foreground, subject, background), the subject's place, where the eye goes, the space left | the still |
| `action` | what moves, in order, with direction and speed | the motion (a Seedance timeline: one beat per sentence) |
| `performance` | two to four visible cues of the acting ("her eyes drop to the cup, a small smile"), never a named feeling | the motion, the eye's check |
| `camera` | the one move: speed, direction, the framing it starts and ends on, what the focus does | the motion, the eye's check |
| `light` | the key's direction and quality, its colour temperature, the practicals, the fill and rim, the time of day | the still, the motion |
| `atmosphere` | what moves in the air and the place: rain, steam, dust in a beam, wind in fabric | the still, the motion |
| `end` | the last moment, as a still | the motion ("Ends on:" / ENDING STATE), the eye's check |
| `sound` | the ambience, then the effects tied to what happens | the motion's audio |
| people | `look` (age, skin, face, eyes, hair, marks, build, posture), `wardrobe` (every garment's colour, fabric, fit), `voice` (pitch, pace, accent) | sheets and stills; the voice in every spoken line |
| the look | palette, light, lens character, stock, colour `grade`, `texture` | the look frame, every sheet and still |

The person reads the acting, the camera and the intent in the script and can change any of it in plain words before anything is made.

One card then becomes (`compile.ts`):

* **the look frame**: one key-art picture of the film (the logline, a composition with depth, the light, the lens, the palette, the grade, the
  texture, the mood), given to every still as its style reference;
* **the reference sheets**: each person front and three-quarter on grey, 85mm at f/8, soft even light, every detail of face and clothes; each
  place empty, 24mm, deep focus, every material and prop in view;
* **the still** (300 words or more; image models read long labelled prompts well): the shot, angle, lens and depth of field (a close-up's
  background melts away, a wide holds everything sharp), the scene, the composition, each person in full, the setting, the atmosphere, the
  lighting setup, the palette, the grade, the texture, the mood, the purpose, each reference image named by its number with one role ("the
  face, hair, build and clothes of Ravi; not the background or the pose", "the colour grade, the light and the film texture only"), and a
  quality lock (skin texture, eyes with catchlights, hands with five fingers, coherent perspective; for animation, on-model drawing);
* **the motion**: what changes from the still, in the model's own way and at the length it reads best (`models.ts maxPrompt`): Veo about 200
  words, camera first, the acting, `Ravi says in a low, warm voice: "…"`, `Audio:`; Kling tighter and motion-led, `[Ravi, low warm voice]:
  "…"`; a busy Seedance shot as a labelled timeline (STARTING STATE, CAMERA, each beat with its seconds, a settling moment, PERFORMANCE,
  ENDING STATE, CONTINUITY, ATMOSPHERE, PHYSICS, AUDIO); Runway short, no sound. Every motion prompt: the action first (a model weighs the start
  most), one camera move with its speed and focus, the acting cues, the atmosphere moving, physics when water, cloth or fire is in it, crowds
  kept apart, the ending named, the purpose, the identity kept, the sound with "no music" (the film's music is added in the cut), the empty
  words (cinematic, epic, stunning…) taken out, no model names, durations or aspect ratios in the words. Never a re-description of the still:
  that is what makes faces drift and clothes change. Over a model's cap, the light goes first, then the sound, the purpose and the atmosphere;
  never the action, the camera or the ending.

Kling's sound cannot be told "no music", so a Kling take is silent unless someone speaks in it (`wantsAudio`).

**Pictures** get the same treatment (`pictures.ts`): an art director's brief of 120 to 220 words in ten parts (subject in full, the moment, the
setting, the composition and text space, the lens and focus, the lighting setup, the colours and grade, the medium, the mood, and for a poster
the exact words with their typeface, size, placement and hierarchy), decided by what the picture is for, then a quality lock by kind (a
portrait's eyes tack-sharp, a product exact in shape and label, a logo bold and flat, an edit changing only what was asked).

## 5. The eye and the retakes

Every still and every take is looked at by a vision model (`qc.ts`): the shot card, who must look like what, the agreed still, frames from the
take, and for a shot that continues or stays in the same place, the last frame of the shot before. It answers five scores (identity, action,
camera, quality, continuity), the problems it saw and one concrete line that would fix them; it is told the shot's intent, the acting, the
camera move and the ending, and marks the take on whether it delivers them. What passes is decided in code: no major problem, nothing
under 6, a weighted mean of 7.

| After a take is checked | |
| --- | --- |
| it passes | kept |
| a problem a prompt can fix (the action, the camera, the framing, the words) | retaken with the fix line ("Important: …") |
| a problem of the model's own (bodies, hands, melting, physics, a face that changes) or the same problem twice from it | retaken on the next model in the router's list |
| three checked takes, or the money would not cover another | the best is kept, with a note to the person, unless it is unsafe or anything is under 4 |

The frames go to the eye as **one tiled picture** in time order, rather than one at a time: it sees the whole movement at once, which is what
catches a shot that morphs or runs backwards, and it is one image to read instead of five.
| otherwise | the shot waits for the person (`hold: "shot"`); the other shots carry on |

A take that fails at the provider (an error, not a bad picture) is tried again; after two from one model that model is blamed; after four the
shot waits. Failed generations are not billed by OpenRouter. Stills are checked the same way, two candidates for a shot with people, the better
one kept, one more pair with the fix when neither passes.

## 6. The edit

`cut.ts` works out the edit and ffmpeg's arguments; `ffmpeg.ts` runs them on the server (its image has ffmpeg):

* **picture**: every take scaled and padded to the frame (1080p, 720p for a draft), 24 frames a second; plain cuts, a half-second dissolve
  where the shot list says so; a short fade in and out. The finished film is then looked at for a blank stretch in the middle
  (`blackdetect`), which the per-shot eye cannot see by construction - a take that came back black, or a dissolve that went through nothing;
* **sound**: each take's own sound (its lines and ambience, or silence), the voice-over placed at the start of its shot, the music (Lyria,
  through OpenRouter) looped to length and ducked under the voice with a sidechain compressor, the mix brought to -16 LUFS. The mix is
  **listened to first** and then normalised with what that heard, because one pass alone lands about half a unit out, through a limiter
  running at four times the sample rate so it sees the peaks that fall between samples. Then the **finished file** is listened to again: AAC
  adds peaks that no filter could see before encoding, so while it is still over -1 dBTP the sound alone is encoded again, lower, with the
  picture copied across;
* **words**: the lines and the voice-over as a soft subtitle track and an `.srt` beside it.

The voice-over is recorded while the storyboard is drawn (`pipeline/tts.ts`, in the film's voice) and measured: a shot whose words need more
seconds is given them before anything is filmed, so words are never cut to fit.

**And heard back** (`voiceCheck.ts`). A machine reads the line and nobody listens before it is cut in, so every recording is transcribed with
the server's own speech-to-text and compared with what it should say. A number read as another number ("ninety-nine" as "nineteen") always
fails, and so does a line cut short; the second reading writes the numbers out in words, which is what stops a voice engine guessing. Hindi and
Hinglish are the hard part, and are handled in the comparison itself: a Hinglish line written in Latin letters comes back in Devanagari about
half the time, so when the scripts differ the letters are not compared at all - only the numbers, which survive transliteration, and how much
was said. Within one script the words are compared loosely, because Hinglish has no settled spelling. Number words that are ordinary words too
("do", "no", "ek") are read as numbers when the two readings are compared, but never failed on.

**Subtitles are timed to be read.** Every cue is held for the time its characters take to read - counted by script, because Latin, Devanagari
and the Han and kana scripts are read at very different speeds - and no two are ever on screen at once: a cue that would run into the next one
ends where that one starts. Where the recogniser reported word timings, the voice-over's subtitle is timed to the speech rather than the clip.

## 7. Pictures

`pictures.ts`: a cheap model reads the ask (what kind of picture, the words that must be spelled right, the frame, a full description with no
empty words; anyone from the person's cast named in it brings their reference sheet); `imageModels.ts routeImage` picks the model (words →
the models that spell; a face that must stay someone's → the ones that keep a reference; a logo → a vector model, as SVG; a product → the ones
that keep it as photographed); two candidates where faces or words are involved; the eye checks spelling, anatomy and likeness; one more try
on the next model with the fix when none passes; then the best, with a note.

**The cast.** A person can keep a character from a film (Keep in my cast): their name, look, clothes and sheet, to bring into another film or
picture by name. `cinema_cast`, `POST /v1/cinema/films/:id/cast/:key`.

## 8. Money

The person never sees a cost: no prices, no rupees, no credits. Their plan covers their films, and the money is ours to watch:

* **A budget per film, from the quotes, never shown.** Saying go to the script sets the film's budget to the storyboard's quote (`quote.ts
  boardQuote`: the look frame, the sheets, the stills, the voice-over, and a quarter more for stills the eye sends back); saying go to the
  storyboard adds the film's quote (`filmQuote`: each shot at its model's rate for its seconds, 40% for retakes, the music).
* **Never past the budget.** Before a paid step starts, what it will cost is set aside; a step the budget does not cover is not started.
* **Extended by itself.** When the retakes need more, the service adds a quarter at a time (`extend`), as long as the plan's allowance says
  yes (`enforceQuota`) and it stays under `CINEMA_FILM_MAX_PAISE` for one film (₹1,500 by default) and `CINEMA_DAILY_PAISE` for one person's
  day (₹3,000). Past them the film is paused for today (`hold: "budget"`, a push): its page says it carries on tomorrow, or sooner with a
  bigger plan, and offers the plans. Saying go to a script or a storyboard, and making a picture, ask the plan's allowance first too.
* **Recorded.** Every call is put on the person's usage meter as the "cinema" bot (`chargeUsd`) and on the film (`spentPaise`), at the cost
  OpenRouter reports where it reports one. Writing the script and reading a picture's ask are on the meter but not in the film's budget.
* **Never sent to the app.** The routes answer without budgets, spend or prices (`public.ts`), and the bot's chat never speaks of them.

## 9. What the server answers

Routes in `routes/bots/cinema.ts` (the header lists them all): the overview, a new film, a film, approve the script, approve the storyboard,
add money, a change, try a shot again (on a model the person picks), stop, delete; keep a character, drop one; a picture, delete one; and the
media route. Every still, take and film is opened by a signed link of ours (`media.ts`, `/v1/cinema/media/<key>?exp=&sig=`, a day), made fresh
each time a screen is drawn; never the storage's own address. Refusals are `{ code, message }`: `cinema_off`, `not_found`, `wrong_status`,
`no_model`, `cinema_film_cap`, `cinema_day`, `quota_exceeded`, `ai_consent_needed`, `bad_photo`, `bad_link`.

**The bot himself.** The cinema bot wears the **director** (`shared/bots/looks.json`): a charcoal cap and a viewfinder on a cord at his
neck. He has three moments of his own: `c.clap` (he holds the clapperboard up, swings it open and claps it: his Home card, over and over),
`c.frame` (he makes a frame with his hands and finds the shot: the page before the first film) and `c.premiere` (he throws the film up in
the air, once, when one is finished). The parts they are drawn from (`slate`, `clapstick`, `lens`, `filmframe`) are in the catalog too, and
the apps' starter copies are regenerated with it (`TAILZU-FRONTEND/app/src/botTiles/genStarter.mjs`).

**The screens** (`experience/bots/screens/bots/cinemaPage.ts`, `cinemaScreens.ts`; drawn by the apps from the server, no app release):

* **Home** (`screens/shell/home.ts`): a card of its own among the first tiles, wherever the bot is on, with the director clapping his board
  and the line "Makes your films and pictures".
* **The bot's page** (`bots.bot`, slug `cinema`): the films waiting for the person first (a script or a storyboard to approve, more money, a
  shot to look at); a new film (their words; Length, Frame and Quality as segmented controls; Write the script); a picture; the other films
  with their first still; the pictures; the cast.
* **A film** (`bots.cinema.film`, params `f`): the title and where it stands, then the decision as one card at the top (Make the
  storyboard; Film it; paused for today, with the plans; the finished film's still with a play mark, Watch, Download, Share or Copy link, the
  subtitles; or what is happening now). Then the script (the look, who is in it, the shots as a numbered list) or
  the storyboard as a grid of stills (four across in the window, two on the phone), each tile with its number, size, seconds, a mark for where
  it stands and what happens. A change to the whole film; the cast; the notes; Stop and Delete.
* **A shot** (`bots.cinema.shot`, params `f`, `n`): its still, large; where it stands; its card in full (what it is for, what happens, the
  acting, the camera, the frame, the light, the air, how it ends, the lines, the voice-over, the sound); the takes, each with what the
  checker said in words ("Sent back: her hand passes through the glass"); Try again when it gave up; a change to this shot only.

**What the person never sees.** The models, the prompts, the provider's jobs, the models a retake passed over, the fix lines, the
checker's numbers and every cost stay on the server: the routes answer with the film as the person sees it (`public.ts publicFilm`, `publicPicture`), so
not even the app's traffic carries them. A shot that cannot be made says what to change ("Spoken lines can't be filmed at this quality"),
never which models there are; a provider's own error text is never shown. The bot's chat is told never to name the models either. The
prompts are our craft, and the models are ours to change from one day to the next.

The render check draws the whole flow on both clients, Home to the finished film, from `scripts/bots-render/samples/cinema.ts`:
`cd tulmi && npx tsx scripts/bots-render/showcase.ts --only cinema`.

**Pushes** (`push/defaults.ts`): `cinema_board` (the storyboard is ready), `cinema_hold` (the film waits for you), `cinema_ready` (the film is
ready), each opening the film's page; quiet in quiet hours, none with the bot turned off; never a word of the film but its title.

**The chat.** The bot's chat runs the usual loop with no tools and the person's films and pictures as its knowledge (`digest.ts`): it can say
what is waiting and why, and points to the page to make or change anything.

## 10. Privacy

* What a person types for a film or a picture, and the photos they send for an edit, go to OpenRouter and the model's maker to make it. Their
  AI consent is asked first (every step runs as them, through the server's guarded fetch). Video generation is not covered by OpenRouter's zero
  data retention.
* Reference images and first frames are sent as data, never as links to our storage. Nothing here logs a prompt, a picture or a link.
* The films, takes and pictures are the person's: in R2 under their own folder, rows readable by the server alone, deleted with the film or the
  account (`forAccountDelete`).
* The director refuses real people's likenesses, brands they did not ask for, sexual content involving minors, gore and hate; the eye marks an
  unsafe take, which is never kept.

## 11. Configuration and deploy

| Setting | |
| --- | --- |
| `CINEMA` | `true` puts the bot among the bots (needs `BOTS`) |
| `CINEMA_MEDIA_SECRET` | signs the media links (secret); not set, a secret is made at each start |
| `CINEMA_FILM_MAX_PAISE`, `CINEMA_DAILY_PAISE` | the caps (above) |
| `R2_*` | where the files live; without R2 they are kept in memory and a restart forgets them |

Migration 0089 (`cinema_films`, `cinema_pictures`, `cinema_cast`). DEPLOY.md, "Cinema", has the steps.

## 12. Tests

`tulmi/tests/cinema-*.test.ts`, none of which needs a key or the network:

* `cinema-engine`: OpenRouter's lists read (prices in all three forms, frames, sound), the router's hard rules and choices, the prompts (refs and
  their roles, empty words, endings, Kling's lines, Seedance's timeline, the caps), the fingerprints, the prices
* `cinema-flow`: the eye's verdicts and what follows a check; the order of work, the money left, the holds, a change that remakes only what it
  touches
* `cinema-plan`: a model's script made safe; the director asked once more, a one-shot note changing one shot, sheets kept through a revision
* `cinema-pictures`: reading an ask, two candidates, a retry on the next model, a logo as SVG
* `cinema-cut`: the timeline, the reading time and the overlap of subtitles, the two-pass loudness and the peak readers, where a film goes
  blank, and, where ffmpeg is installed, a real cut of three clips with a voice-over and music, a tiled contact sheet, and a loud film
  measured after encoding to prove it comes in under the ceiling
* `cinema-voice`: the voice-over heard back - numbers across English, Hindi and Hinglish, a line heard in another script, a line cut short
* `cinema-store`: the store's ownership and the account's deletion; signed links
* `cinema-service`: a whole film with every model faked, from the idea to the cut, a failed take retaken, a late change, the caps, a picture
* `cinema-routes`: the doors off and on, refusals, the allowance, photos, links, the bot among the built-ins and the front door's pick
* `cinema-page`: the page and the film page at each step, on the phone and the window, through the app's linter

## 13. Still to come

* A live run against OpenRouter with a real key (`tulmi/e2e`-style), to tune the craft scores and the eye's thresholds on real takes.
* The music call (Lyria through OpenRouter's chat API with sound out) is written from the docs and not yet run live; without music the film is
  cut without it.
* Native multi-shot generation for dialogue coverage inside one scene (Kling, Seedance), and Seedance's draft-then-final mode where OpenRouter
  offers it, to make retakes cheaper.
* OpenRouter's completion webhooks instead of polling; an in-app player (the Bots kit has no Video node yet: Watch opens the film).
* A rough-cut pass that trims or drops shots before the cut; exporting the timeline for an editor.

## 14. Ideas borrowed

From open projects and guides, ideas only, no code: dependency-aware scheduling and choosing between two keyframes with a judge (HKUDS/ViMax,
MIT); per-model prompting rules, the ending named, empty words dropped (smixs/visual-skills, CC BY 4.0; Square-Zero-Labs/video-prompting-skill,
Apache-2.0); a single style frame for every still (wind-comic, MIT); separating a prompt problem from a model limitation when retaking (VISTA);
audio-first timing (fal-ai-community/skills, MIT).
