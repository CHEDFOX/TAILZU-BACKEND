# What the window asks for, and when

The phone and the window run the same first run (`docs/bots-app.md`): Welcome → Sign in → Code in the gate, then **straight
to Home**. Nothing is asked in a flow of steps — the asks are **cards over a blurred Home**, one thing at a time, and the
window draws those cards exactly as the phone does (`BotCard` with `overlay: true`: a fixed veil, a backdrop blur, a paper
card in the middle).

What a computer keeps that a phone does not is the only difference, and it is a difference in the rows, not in the shape.

## The cards

| card | asks for | where |
|---|---|---|
| **Terms and privacy** (`firstRun/aiConsentCard.ts`) | sending what you give X0 Bot to AI services — `PUT /v1/you/ai-consent` | Home, once per wording, before anything is sent |
| **The arrival card** (`firstRun/arrivalCard.ts`) | the microphone (the system's own prompt), then the switches only System Settings can flip | Home, the first time they land |
| **The permission card** (`TAILZU-DESKTOP/src/app/sdui/permCard.js`) | one permission, at the moment a feature is refused for want of it | over whatever is on screen |

### The arrival card, in a window

1. **The microphone** — `requestPermission`, which is macOS's own prompt over the window. Allowed or not, the card moves on.
2. **One or two switches in your Mac's settings** — one step, drawn from the window's own live rows (`DeskAskSetup`):

   | row | why |
   |---|---|
   | Typing for you | so your words land where your cursor is, in any app, instead of only being copied |
   | Answering about your screen | so Ask can answer about what's in front of you when you ask it to; the picture is never kept |

   The line under them gives the Mac's own names — Accessibility and Screen Recording — because without them nobody can find
   the switches in System Settings. The rows tick themselves while the person is away in there (`$state.axGranted`,
   `$state.seeGranted`), the step goes when both are on, and the card closes itself.
3. **You're all set.**

**The camera is not on this card.** A call is the only thing that opens one, and only when the person turns it on there, so
it is asked for at that moment and never up front.

**A row is named for what it does, not for what the OS calls it.** "Screen recording" is the Mac's name for a switch and a
fair description of nothing we do (privacy policy, section 10.4: what Ask reads off the screen, and any picture it sends, is
not stored).

### The permission card, when something is missed later

Someone can say "Not now", or turn a permission off months after. What they met then was a failure with nothing to do about
it: a dictation that only copied, a look that answered "I can't see your screen", a call whose camera button did nothing.

| it goes up when | who says so |
|---|---|
| a paste comes back refused, so the words could only be copied | the main process (`notifyAccessibility` → `permNeeded("ax")`) |
| Ask's look is refused | the main process (`lookPermission(denied)`) |
| a call cannot turn the microphone or camera on | the window (`sdui/v2/call.js`, on `NotAllowedError`) |

Only while the window is on screen — a card behind a hidden window is not an ask, so `permNeeded` answers false there and the
notification stays for that case. One at a time; Escape and "Not now" close it; it closes itself the moment the answer turns
yes, which for the two granted in System Settings is while the person is still away in them (it re-reads every second). The
words are the server's (`appKnobsData.ts`, `desktop.perm.*`), so they change with a knob push and no release.

## What is on is the computer's answer, not ours

Only the main process can read these, so each is an IPC handler of its own — `app:micStatus`, `app:camStatus`,
`app:seeStatus`, `app:axStatus` — and `src/app/sdui/permissions.js` reads them when a page is painted and again every time
the window comes back to the front, which is when System Settings may have turned one on.

| capability | declared when | what it unlocks |
|---|---|---|
| `DeskMicAsk` | `tailzuApp.micStatus` and `getUserMedia` | the microphone step |
| `DeskCamAsk` | `tailzuApp.camStatus` and `getUserMedia` | the camera card, at the moment a call needs it |
| `DeskAxState` | `tailzuApp.axStatus` | the "Typing for you" row, and the step going by itself |
| `DeskSeeState` | `tailzuApp.seeStatus` | the "Answering about your screen" row |

**What an answer means is that system's own** (`permAnswer`). A Mac keeps one answer per app and asks for it once, so
"not-determined" there is a question still to put and the row shows its button. Windows has no prompt for an app to show at
all: a desktop app records unless the person turned it off in Settings, where the answer becomes "denied". So on Windows
anything short of that no reads as **nothing to ask for** — otherwise we would send someone to Settings to switch on what
already worked. `"unknown"` (Linux keeps no such answer) reads the same way.

## How far an ask can go, by permission

**Every ask starts in the app, wherever the system has a dialog to show.** Nothing sends anyone to Settings on a first
press.

| | the first press | the press after |
|---|---|---|
| microphone, camera (macOS) | `getUserMedia` *is* the system's prompt, over our window. Allow there is the whole of it. | macOS never asks twice, so the button opens its page. |
| microphone, camera (Windows, Linux) | nothing to grant: a desktop app records unless the person turned it off in Settings. | only if Windows says "denied": `ms-settings:privacy-microphone` / `privacy-webcam`. |
| typing for you, answering about your screen (macOS) | macOS's own dialog, over the app (`isTrustedAccessibilityClient(true)`, and asking for the window list). It shows once and never again. | the exact page in System Settings, where the switch is. |

**No system lets an app grant the last two** — macOS keeps that for the person, in System Settings, and no API or entitlement
changes it. The dialog is as far as any app gets, ours included; what we can do is ask in the app first and only then open the
page, which is also what puts X0 Bot in that page's list at all. The row's button says **Allow** until it has been pressed and
**Open Settings** after (`allow` / `allowAgain`), so the words always match what the press will do.

The camera needs more than permission. A hardened Mac build is refused the camera outright without `NSCameraUsageDescription`
and `com.apple.security.device.camera`, both of which the window now ships — and the window's own permission handler
(`main.js setPermissionRequestHandler`) refused **video to everyone**, which was right while nothing in the app had a camera
and meant a call's camera button could not have worked on any system. The app window may ask for a camera now; nothing else
may, and recording the screen comes through a different permission, which is still nobody's.

## Taking the yes back

The desk's **Settings › Privacy and data** has *Send to AI services* (`experience/desk/settings.ts`): the same
`PUT /v1/you/ai-consent` as the phone's own switch in You › Privacy, and the same words (`settingsWords.ts` `d.ai`). Off,
nothing more of theirs is sent: bots, dictation and Ask wait (App Review 5.1.1(ii): consent withdrawn as easily as it was
given).

## What is not here

- **The phone is untouched.** Its cards, its steps and its permissions are exactly as they were.
- **The `onboard` screen is not where any of this lives.** Languages, Keyboard, Try it and Make me yours are the older flow,
  served to builds that do not declare `BotsKit`, and it keeps the shape it had on both surfaces.
- Notifications are not a row: a window shows the server's notices without a grant to ask for.
