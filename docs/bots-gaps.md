# Bots app: logic still to build

Audit of 28 Oct 2026. Every built screen (69 of 75, phone and desktop) is wired: all 561 endpoint calls hit real
routes and no button opens a missing screen (scripts: the preview export + a route check). What is left is below:
features left out or simplified while building, grouped by what they need. ✓ = done since.

## A. Small backend or glue work (fast)
1. Keyboard settings saved but not applied: look, key height, key sounds, hold space to speak, Keybot key
   position, haptics strength (map keybot_prefs onto `/v1/keyboard/config` flags; height and haptics flags exist).
   Read-aloud speed, "read while driving", "read my draft back" are saved but not used by `/v1/speak`.
2. Monthly spend limit does not cover front-door answers or Keybot (only Code bot jobs and bot answers).
3. Delete account deletes at once: no 7-day grace / undo.
4. Activity only records bot answers sent through Ask (`/v1/shell/ask`); answers from a bot's own page and chat
   are missing from the feed.
5. The "turn on notifications" ask (pushAsk) is not shown in the Bots app.
6. Desktop: the Accessibility step of the arrival card can't close by itself (the permission isn't in the
   window's screen state); expose it like `micGranted`.
7. Your words: no "sounds like" field or edit; words aren't grouped by kind (names, places, work).
8. Bot keys: no "Try it" run on the keys page.
9. A brand-new person's first-day Home still has the old header (the living header is on the normal Home).

## B. Needs one feature in both app renderers
10. Upload a picked file: photo, screenshot, screen recording, file (Attach sheet, Ask's attach buttons).
11. A live artifact viewer node: Design and Preview draw an artifact's parts, not the running page.
12. Offline: nothing switches to the Offline screen when the connection drops; asks typed offline aren't queued.
13. Share into Tailzu: iOS share extension, Android share intent, desktop drop → `bots.share-in`.
14. Voice in Ask on the phone (speak inside the app, not via the keyboard's mic).
15. Play a voice sample on Keybot's voices page (no audio playback node).

## C. Needs a backend feature that doesn't exist yet
16. Desktop sign-in by scanning a QR with the phone / approve on the phone (device linking).
17. Desktop Keybot key choice (Fn / Right ⌥ / Right ⌘) from the app.
18. Desktop reply drafts and rewrite cards in the pill (DKeyReply, DKeyRewrite).
19. Plan bot travel times and "minutes saved"; Travel bot weather and stay comparison; payment requests in Spaces.
20. Code bot: "Open on my phone" for previews, the live dev-server preview link, a real cost/time estimator
    (today: median of past jobs), outdated packages, "+ Add a check".
21. Meeting notes: to-dos and decisions extracted from the transcript.
22. Shipped screen: time saved and before/after.

## D. Native surfaces
23. The keyboard itself in the new look (iOS KeyboardViewController.swift, Android TulmiKeyboardService.kt):
    live listening strip, reply drafts card, rewrite before/after card, clay Keybot key.
24. iOS widgets and the lock-screen live activity (data ready: `GET /v1/shell/glance`).
25. macOS menu bar dropdown.

## E. Check on real devices
26. Living tiles' frame rate on a mid Android; the blur on iOS and Android; Skia drawing of the tiny bots.
