# The bot at the foot of Home, as what is happening

The tiny bot who walks the bottom of Home used to carry a box to type in. With `HOME_UPDATES` on he carries **what is going on** instead: what needs you, what your bots are working on, what just finished — each one opening where it belongs. And he is **listening the whole time that page is in front**: no microphone to press, nothing to hold, just talk to him. Typing is still there, behind a small key, for the times you cannot speak — and opening that key is the one thing that shuts his ear.

Off by default: with the switch off Home is exactly what it is today, and nothing extra is read.

Code: `tulmi/src/experience/bots/screens/shell/homeUpdates.ts`; Home picks it in `screens/shell/home.ts` (the phone) and `screens/shell.ts` (the window), which also reads the feed for it. Tests: `tulmi/tests/home-updates.test.ts`.

* [1. What he shows](#1-what-he-shows)
* [2. Asking him](#2-asking-him)
* [3. What he says back](#3-what-he-says-back)
* [4. The routing is the front door's](#4-the-routing-is-the-front-doors)
* [5. Settings](#5-settings)
* [6. What it does not do yet](#6-what-it-does-not-do-yet)

## 1. What he shows

At rest his thought is one line, the most pressing thing there is: "Xode needs you", "2 need you", "Xode is on it", "Fix the empty cart crash", or "Nothing new". Tap him and it opens:

| | Where it comes from | What a tap does |
| --- | --- | --- |
| **Needs you** | the live reads every screen already has (`ctx.live.needs`), with the same two buttons the decision card has | answers it where it stands, or opens the job or the approval |
| **Working** | `ctx.live.working`, with the job's stage as short bars | opens the job |
| **Done** | the activity feed, nothing older than a day and a half | opens the job, the approval, the answer or that bot's chat |
| **See everything** | — | the Activity screen |

Nothing new, and he says so and offers to be asked. The list scrolls inside his thought where the build's boxes scroll, so his ear and the key below are always in reach; on a build whose boxes do not scroll he carries a shorter list for the same reason. The numbers are in `SHOW` and `SHORT`.

## 2. Asking him

* **His ear is open, and there is nothing to press.** It opens as soon as Home is in front and stays open: turn after turn, each pause sending what he heard. A quiet "Listening" at the foot of the box is the only sign of it, and the words he hears stand just above it. Speak to him with his thought shut and he opens it himself to answer. He falls quiet by himself after a long while with nothing said, and opens again the next time the page comes to the front; a double tap is a way to wake him there and then.
* **A tap on him opens his thought.** It no longer means "stop listening" — he always is — so the list is always reachable.
* **Typing shuts his ear.** The small key opens the field and stops him hearing, because there is one voice at a time and nothing said at a keyboard is meant for him. Send goes down exactly the same road as a spoken ask. The ✕ beside the field ends typing and gives him his ear back, as does closing the box.
* **Coming back to voice by speaking** — saying something while the keyboard is open and having him take it — is the wake word, and it is not here (section 6). The ✕ is the way back.
* A build that cannot hear, and `HOME_LISTEN=false`, give the same bot: updates and a key, nothing that mentions talking.

## 3. What he says back

A spoken ask goes out marked as spoken, so the front door shapes the answer **for the ear**: short, no table, no page (`front/decide.ts` `spoken`, `handlers.ts` "Spoken: yes."). He says a word while he thinks — "Mm, let me see." — so a spoken question is never answered by silence, and speaks the answer when it lands. A typed ask stays silent and is read, as it always was.

## 4. The routing is the front door's

Nothing here decides who answers. The words go to the same door the ask bar uses, which reads them for nothing, picks the bot whose purpose and skills fit (the small model only when the rules are unsure), and sends anything that is nobody's down its own roads — a reply, the web, research, a plan, an artifact, a code answer (`docs/front-door.md`, `docs/bots.md` section 7). That is the same shape Xode uses: work out what it is, find the best place, go there.

**One gap worth knowing.** What the person has open — the jobs running, the routines due — is in the person's context, which the voice chat (`src/talk`) reads but the front door's reply does not. So "how is the cart fix going?" is answered from the bot's own knowledge, not from the job's progress, unless the bot itself can see it. Closing that means either giving the front door the same context block or sending voice asks through the talk brain; neither is done here.

## 5. Settings

| Switch | Default | What it does |
| --- | --- | --- |
| `HOME_UPDATES` | off | the bot at the foot of Home carries what is happening, instead of a box to type in |
| `HOME_UPDATES_USERS` | empty | comma-separated account ids: while it names anyone, only they get it |
| `HOME_LISTEN` | **on** | his ear is open the whole time Home is in front. It is his nature, not an extra, so it rides with `HOME_UPDATES`; `false` is the way to shut an open microphone (the phone shows its own mark, it costs battery, everything said near it is heard) without turning him off |

```
ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/set-env.sh HOME_UPDATES=true HOME_UPDATES_USERS=<your account id> && ./deploy/ship.sh'
```

## 6. What it does not do yet

* **A wake word** ("hey X0" with the microphone otherwise shut, and the way back to voice while the keyboard is open) is not here. The server can open an ear and read every word in it; it cannot ask the app to sleep until one phrase is said. That is native work in both apps — local listening, a permission, battery tuning, store review. The open ear while Home is in front is the nearest thing the server can do on its own, and the ✕ beside the field is the way back from typing.
* **Holding him to make him listen** is not here either: neither app reports a press and hold on him today, only a tap and a double tap. The gesture block that landed on 14 Nov (`docs/renderer.md` section 3) does carry a hold, so once `SDUI_V2` is on and the builds that have it are out, this can be done from the server, for the clients that have it — a hold anywhere on the strip he walks, not pinpointed to his body.
* **His voice is the app's own.** The pauses and the "mm" are words we send, not a way of speaking; a slower, more human delivery with real hesitation is the speech service's to give.
