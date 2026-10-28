# Bots app: logic still to build

Audit of 28 Oct 2026. Every built screen (69 of 75, phone and desktop) is wired: all 561 endpoint calls hit real
routes and no button opens a missing screen (scripts: the preview export + a route check). What is left is below:
features left out or simplified while building, grouped by what they need. ✓ = done since.

## A. Small backend or glue work (fast)
1. Keyboard settings saved but not applied: look, key height, key sounds, hold space to speak, Keybot key
   position, haptics strength (map keybot_prefs onto `/v1/keyboard/config` flags; height and haptics flags exist).
   Read-aloud speed, "read while driving", "read my draft back" are saved but not used by `/v1/speak`.
2. Monthly spend limit does not cover front-door answers or Keybot (only Code bot jobs and bot answers).
3. ✓ Delete account deletes at once: no 7-day grace / undo. *Now a date 7 days out (migration 0045, src/you/deletion.ts,
   routes/accountDeletion.ts); signing in shows it with Keep my account; a sweep deletes on the day.*
4. ✓ Activity only records bot answers sent through Ask (`/v1/shell/ask`); answers from a bot's own page and chat
   are missing from the feed. *The chat route writes them down; the Code bot's page asks through `/v1/shell/ask`.*
5. ✓ The "turn on notifications" ask (pushAsk) is not shown in the Bots app. *A card on a phone's Home once a bot is working
   or needs you (screens/pushAsk.ts); "Notifications are off" on What pings you.*
6. ✓ Desktop: the Accessibility step of the arrival card can't close by itself (the permission isn't in the
   window's screen state); expose it like `micGranted`. *A window that declares DeskAxState writes `$state.axGranted`
   (main.js app:axStatus, isTrustedAccessibilityClient; true off a Mac) on each paint and return to the window; the
   card's step goes and the card closes once it is on (firstRun.ts AX_STATE); Keybot's page shows it while off.*
7. Your words: no "sounds like" field or edit; words aren't grouped by kind (names, places, work).
8. Bot keys: no "Try it" run on the keys page.
9. ✓ A brand-new person's first-day Home still has the old header (the living header is on the normal Home).

## B. Needs one feature in both app renderers
10. ✓ Upload a picked file: photo, screenshot, screen recording, file (Attach sheet, Ask's attach buttons). *Action
    `uploadFile` (capability FileUpload; phone src/sdui/media.ts, window media.js, a Mac's screenshot through main.js
    app:captureScreen): picks, sends to POST /v1/files with progress, the answer in state (bots/media.ts uploadChip).*
11. ✓ A live artifact viewer node: Design and Preview draw an artifact's parts, not the running page. *Node `LiveView`
    (phone LiveView.tsx, a WebView; window liveView.js + liveViewMain.js, a webview in a session of its own): a page from a
    URL or the HTML the server wrote, sandboxed, loading and error states. Design and Live preview run the artifact through
    GET /v1/artifacts/:id/live (src/artifacts/livehost.ts); point to change picks a part. Needs ARTIFACT_VIEWER_URL set.*
12. ✓ Offline: nothing switches to the Offline screen when the connection drops; asks typed offline aren't queued.
    *Capability `Outbox` (phone offline.tsx + outboxCore.ts, window outbox.js): Home becomes `bots.offline` while offline and
    comes back; other screens get a line; asks are kept on the device in order with when they were typed and sent once,
    with a client id POST /v1/shell/ask answers once (src/shell/sentAsks.ts, migration 0047).*
13. ✓ Share into Tailzu: iOS share extension, Android share intent, desktop drop → `bots.share-in`. *The extension
    (app targets/share) hands text, a link and up to five files to the app through the App Group and opens tulmi://share;
    Android's SEND/SEND_MULTIPLE land on MainActivity (modules/tulmi-share); the window takes a drop (shareIn.js). Each
    sends its files to POST /v1/files and opens the screen, which now takes several files (`files`) and "Ask any bot".*
14. ✓ Voice in Ask on the phone (speak inside the app, not via the keyboard's mic). *Action `recordVoice` (VoiceRecord):
    the mic asked for properly, the take through /v1/transcribe-clean into Ask's field; bars follow the voice.*
15. ✓ Play a voice sample on Keybot's voices page (no audio playback node). *Actions `playAudio` / `stopAudio`
    (AudioPlay), one sound at a time, stopped with its screen; GET /v1/keybot/voices/:id/sample (routes/voiceSample.ts).*

## C. Needs a backend feature that doesn't exist yet
16. ✓ Desktop sign-in by scanning a QR with the phone / approve on the phone (device linking). *The window's sign-in
    has a QR and a typed code (DeskLinkSignIn, desktop linkSignIn.js); the phone's camera opens
    app.tailzu.space/s/bots.link (or You › Link a computer, the code) and Approve / Not me; the window then redeems a
    one-time sign-in, once (src/auth/deviceLink.ts, routes/deviceLink.ts, migration 0049, screens/link.ts).*
17. ✓ Desktop Keybot key choice (Fn / Right ⌥ / Right ⌘) from the app. *One key on the desktop (desktop oneKey.js): hold to
    talk, tap for hands-free; Fn on a Mac (native/tzkey.swift watches it), Right Ctrl on Windows, picked in Keybot's settings
    (`desktop.config` oneKey: Fn, Right ⌥, Right ⌘ / Right Ctrl, Right Alt). The words go where they are meant (routing.js):
    typed, Ask, meeting notes, or a bot through /v1/shell/route and /v1/shell/ask, with a one-tap fix in the pill.*
18. Desktop reply drafts and rewrite cards in the pill (DKeyReply, DKeyRewrite).
19. ✓ Plan bot travel times and "minutes saved"; Travel bot weather and stay comparison; payment requests in Spaces.
    *src/places (geocoding/routing behind PLACES_*, off until set; weather MET Norway on), botsBots/planTravel, stays;
    payments in botsBots/payments.ts. Self-host routing before launch (the public OSRM terms). Migrations 0051, 0052.*
20. Code bot: (no QR: the preview runs inside the project, item 11) "Open on my phone" for previews, the live dev-server preview link, a real cost/time estimator
    (today: median of past jobs), outdated packages, "+ Add a check".
21. ✓ Meeting notes: to-dos and decisions extracted from the transcript. *src/notes/extract.ts, once per transcript.
    Notes is its own feature now (screens/notes.ts, a strip under Home's grid).*
22. Shipped screen: time saved and before/after.

## D. Native surfaces
23. The keyboard itself in the new look (iOS KeyboardViewController.swift, Android TulmiKeyboardService.kt):
    live listening strip, reply drafts card, rewrite before/after card, clay Keybot key.
24. iOS widgets and the lock-screen live activity (data ready: `GET /v1/shell/glance`).
25. macOS menu bar dropdown.

## E. Check on real devices
26. Living tiles' frame rate on a mid Android; the blur on iOS and Android; Skia drawing of the tiny bots.
