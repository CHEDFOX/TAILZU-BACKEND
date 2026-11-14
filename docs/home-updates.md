# The bot at the foot of Home, as what is happening

The tiny bot who walks the bottom of Home used to carry a box to type in. With `HOME_UPDATES` on he carries **what is going on** instead: what needs you, what your bots are working on, what just finished — each one opening where it belongs — and he listens when you want to ask something. Typing is still there, behind a small key, for the times you cannot speak.

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

* **His ear.** A mic at the foot of the box, and a double tap on him, both start a voice chat: turn after turn, each pause sending what he heard. While he listens the words stand where the list was, and **a tap on him stops** him. He falls quiet by himself after a while with nothing said; tap again and he carries on.
* **With `HOME_LISTEN`** he starts listening the moment Home is in front, without being asked. It is its own switch because it means an open microphone for as long as that page is up: the phone shows its own mark, it costs battery, and everything said near it is heard and sent to be understood. Off by default.
* **Typing** is the small key beside the mic: it opens the field, and Send goes down exactly the same road. Nothing is typed by default and the field is not what you see first.
* A build that cannot hear (no voice) is sent no mic and no mention of talking — only the key.

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
| `HOME_LISTEN` | off | he listens the moment Home is in front (an open microphone while that page is up) |

```
ssh root@91.108.104.168 'cd ~/tulmi && ./deploy/set-env.sh HOME_UPDATES=true HOME_UPDATES_USERS=<your account id> && ./deploy/ship.sh'
```

## 6. What it does not do yet

* **A wake word** ("hey X0" with the microphone otherwise shut) is not here. It needs the app itself to listen locally, which is native work in both apps, a permission, battery tuning and store review. `HOME_LISTEN` is the nearest thing the server can do on its own.
* **Holding him to make him listen** is not here either: neither app reports a press and hold on him today, only a tap and a double tap. The gesture block that landed on 14 Nov (`docs/renderer.md` section 3) does carry a hold, so once `SDUI_V2` is on and the builds that have it are out, this can be done from the server, for the clients that have it — a hold anywhere on the strip he walks, not pinpointed to his body.
* **His voice is the app's own.** The pauses and the "mm" are words we send, not a way of speaking; a slower, more human delivery with real hesitation is the speech service's to give.
