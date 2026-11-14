# What the window asks for, and when

The phone's onboarding ends with **Make me yours** (notifications, microphone) and the AI permission is asked for later, on
Home, by a card of its own. A window got neither: `postAuthSteps` left Make me yours out because "the OS asks", and the Home
card never shows in a window that lands on the desk. So someone who finished the window's onboarding had agreed to nothing and
granted nothing — and the first thing they tried was refused by the AI gate with a line pointing at a switch the window did not
have.

Two steps of the same stage Blip already walks through now fill that in, and the desk's Settings grew the switch the second one
promises.

## The flow

| | phone | window |
|---|---|---|
| after sign-in | Languages, Keyboard, Try it, **Make me yours**, [Connect apps, How careful], Done | Languages, **Terms and privacy**, **Let me in, once**, Try it, [Connect apps, How careful], Done |

Terms come **before** Try it: Try it sends a recording to be written down, and `privacy/aiGate.ts` refuses that until they have
agreed. The permissions come next, so the microphone Try it asks them to hold is granted before it asks.

- **Terms and privacy** (`experience/onboard/terms.ts`). The same two answers and the same route as the phone's card
  (`bots/screens/firstRun/aiConsentCard.ts`): *Agree and continue* → `PUT /v1/you/ai-consent { agree: true }`, and only on a
  successful save does the step move; *Not now* → `PUT { agree: false, later: true }`, which keeps the answer, grants nothing,
  and **skips Try it** — there is nothing to try while nothing may be sent. "Not now" stays a real answer with nothing lost by
  choosing it (App Review 5.1.1(i): the choice must be free; this is not a pre-prompt to a system permission). Someone who
  already agreed, here or on a phone, is told so and has one button.
- **Let me in, once** (`experience/onboard/perms.ts`). One row per thing the app needs from the computer, each with that
  computer's own answer beside it and either *Allow* (the system's own prompt) or *Open Settings* (the Mac's page). Continue is
  always live: a refusal is a toast saying where to turn it on, never a step that will not pass.

| row | what it is for | how it is asked | the state it reads |
|---|---|---|---|
| Microphone | dictation, a bot, a call | `requestPermission` → the system's prompt | `micGranted` |
| Camera | only a call, only while they have it on | `requestPermission` → the system's prompt | `camGranted` |
| Accessibility (Mac) | typing the words where the cursor is | `ask.openAccessibility` → System Settings | `axGranted` |
| Screen recording (Mac) | Ask seeing the window; a note hearing a call | `ask.openScreenRecording` → System Settings | `seeGranted` |

## What is on is the computer's answer, not ours

Each row draws from a state path, and the **window** keeps those paths up to date — the server never guesses. Only the main
process can read these answers, so each is an IPC handler of its own (`app:micStatus`, `app:camStatus`, `app:seeStatus`,
`app:axStatus`), and `src/app/sdui/permissions.js` reads them when a page is painted and again every time the window comes back
to the front, which is when System Settings may have turned one on. A row therefore ticks itself while the person is away in
Settings, and Blip says so once they all have ("That's everything.").

`"unknown"` — a system that keeps no such answer, Linux for all four — reads as **nothing to ask for**, so the row shows as
allowed rather than as a switch nobody can turn on.

## A row is only drawn where the window can answer it

| capability | declared when | what it unlocks |
|---|---|---|
| `DeskMicAsk` | `tailzuApp.micStatus` and `getUserMedia` | the microphone row |
| `DeskCamAsk` | `tailzuApp.camStatus` and `getUserMedia` | the camera row |
| `DeskAxState` | `tailzuApp.axStatus` | the Accessibility row |
| `DeskSeeState` | `tailzuApp.seeStatus` | the Screen recording row |

The two Mac rows need `device.os === "mac"` as well: no other system has either switch. An older window is asked for what it
can answer and nothing else, and a window that can answer none of them still has a step that passes. Both steps are in the list
for **every** window all the same, so the progress bar is the same length in the sign-in stage and in the screen.

The camera needs more than a row: a hardened Mac build is refused the camera outright without
`NSCameraUsageDescription` and `com.apple.security.device.camera`, both of which the window now ships — which is also what a
video call needs there (`docs/rooms.md`).

## When it is missed later: the card over the app

Someone can say "Not now" in the step, or turn a permission off months after. What they met then was a failure with nothing to
do about it: a dictation that only copied, a look that answered "I can't see your screen", a call whose camera button did
nothing. So the window has the card the phone has — one permission, over the app, the page behind it blurred
(`src/app/sdui/permCard.js`; the veil and the card are the overlay `BotCard`'s, so the two surfaces are one thing).

| It goes up when | Who says so |
|---|---|
| A paste comes back refused for want of Accessibility | the main process (`notifyAccessibility` → `permNeeded("ax")`) |
| Ask's look is refused for want of Screen Recording | the main process (`lookPermission(denied)`) |
| A call cannot turn the microphone or camera on | the window (`sdui/v2/call.js`, on `NotAllowedError`) |
| A permissions row is refused for good | the window (`askMic` / `askCam`, in place of the page's own line) |

**Only while the window is on screen.** A card drawn behind a hidden window is not an ask, so `permNeeded` returns false there
and the caller keeps what it did before — the notification. One card at a time; Escape and "Not now" close it; it closes
itself the moment the answer turns yes, which for the two granted in System Settings is while the person is still away in
them (it re-reads every second).

**It asks the system itself where the system will ask.** The microphone and the camera: the first press is `getUserMedia`,
which is macOS's own prompt over our window — Allow there is the whole of it. Told no once, macOS never asks again and
Windows never asks at all, so the button becomes *Open Settings* and opens that computer's own page
(`ms-settings:privacy-microphone` / `privacy-webcam`, or the Mac's Privacy_Microphone / Privacy_Camera). Accessibility and
Screen Recording have no such prompt on any system — no API grants them — so their button opens the exact page, having first
made macOS list X0 Bot there to be switched on.

The words are the server's (`appKnobsData.ts`, `desktop.perm.*`), so they change with a knob push and no release.

## Taking the yes back

The terms step promises the AI permission can be turned off whenever they like, so the desk's **Settings › Privacy and data**
has the switch (`experience/desk/settings.ts`): the same `PUT /v1/you/ai-consent` as the phone's own switch in You › Privacy,
and the same words (`settingsWords.ts` `d.ai`). Off, nothing more of theirs is sent: bots, dictation and Ask wait (App Review
5.1.1(ii): consent withdrawn as easily as it was given).

## Words

English and the design's Hinglish, line for line, in `experience/onboard/copy.ts` (`tp.*` for the terms, `wp.*` for the
permissions). The model is never asked for any of them; `tests/onboard-words.test.ts` stands in for the translator and holds
that down, and two lines ("That's everything.", "Allow") are written in the assistant's own Hinglish so the same English never
reads two ways.

## What is not here

- **The phone is untouched.** Make me yours, the Home card and the phone's own permissions are exactly as they were.
- A Bots-app window still gets the first-arrival card on Home (`firstRun/arrivalCard.ts`). It asks for the microphone and
  Accessibility too, and closes itself once both are on — which, after this step, they are. That card is a screen's node, drawn
  by the server; the one above is the window's own, because only this side knows a paste came back refused.
- Notifications are not a row: a window shows the server's notices without a grant to ask for.
