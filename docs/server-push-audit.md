# What the apps still decide: a server-push audit

Audit date 2026-10-29. Read-only: no app or backend file was changed. Not covered: the tiny bots' looks and moments
(`app/src/botTiles/core.ts`, desktop `botTiles.js`, the keyboard's peek bot), which are already planned as server data, and the
files two helpers are editing now (the chat screens, and the money and usage change across screens).

* [Summary](#summary)
* [How to read the tables](#how-to-read-the-tables)
* [A. Quick wins: existing mechanisms, no app update](#a-quick-wins-existing-mechanisms-no-app-update)
* [B. Worth a renderer update](#b-worth-a-renderer-update)
* [C. Leave in the app](#c-leave-in-the-app)
* [Inventory 1: screens and windows the apps draw themselves](#inventory-1-screens-and-windows-the-apps-draw-themselves)
* [Inventory 2: user-facing words built into the apps](#inventory-2-user-facing-words-built-into-the-apps)
* [Inventory 3: behaviour and rules in app code](#inventory-3-behaviour-and-rules-in-app-code)
* [Inventory 4: bundled assets](#inventory-4-bundled-assets)
* [Inventory 5: feature switches](#inventory-5-feature-switches)
* [Method and limits](#method-and-limits)

## Summary

Most of the apps is already server-driven. The screens are SDUI. The knobs cover **411 labels and 1,362 flags** for the phone and
the desktop (196 labels and 357 flags of those are `desktop.*`), plus about 40 tray and notification words in `desktop.shell`. The
keyboards read **375 flags and 42 labels** (iOS) and **395 flags and 51 labels** (Android). The control console
(`tulmi/src/control/rules.ts`) can change any of these live, for a platform, build, version, language, user or percentage. Both
manifests are current: `extract.mjs --check` and `extract-keyboard.mjs --check` both pass, and the backend's data files match them.
No product feature switch is decided in app code. Every switch is a knob.

Here is what is still built in:

| | Count | Where it is |
| --- | --- | --- |
| Native screens, windows and panels | ~38 | Most only arrange words and numbers that are already knobs. Six still have built-in words. |
| User-facing words that are not knobs | **~120 movable** (+ ~50 runner log notes) | Almost all on the desktop: Ask's stop and refusal lines, the "Tailzu Code on this computer" window, share-in words. The iOS share extension has 4. |
| Words that must stay compiled in | 32 | Permission prompts, App Intent titles, the Android widget picker's words |
| Words the server sends but never translates | ~140 | The keyboard's labels (42 iOS, 51 Android) and the word-bearing flags (`desktop.shell`, `desktop.tones`, `profile.genders`, `auth.countries`). `localize()` translates labels and node props only, and `/v1/keyboard/config` is not localized at all. |
| Product rules in code | ~820 phrases, 31 regex rules, ~10 limits, 44 fixed haptics | Mainly the desktop's one-key router (`router.js`, ~666 phrase literals) and Ask's local resolver (`resolver.js`, ~155) |
| Bundled assets the server could update | 20 desktop fonts, 1 mark picture on the phone, 2 bundled keyboard configs | Icons, splash and tray pictures must stay bundled. |

The rest of this file sorts these into the three groups below. The first column of each table is the work to do.

## How to read the tables

* **Mechanism.** *knob*: a `txt`/`num`/`list`/`obj` read the app already has, set from `catalog.ts` or a console rule. *label*: a
  word in `bootstrap.labels`, which the server translates. *SDUI*: a server screen. *program*: data the app already interprets, like
  the mic key's motion. *new*: the app needs a code change before the server can drive it.
* **Effort.** S: hours to a day. M: a few days. L: a week or more, or design work.
* **Value.** How often you'd change it. High: monthly, or it shapes daily use. Med: a few times a year. Low: rarely.

## A. Quick wins: existing mechanisms, no app update

These change only the backend (`catalog.ts`, `i18n.ts`, `server.ts`) or a console rule. Every app version already out reads them.

| # | Item | Where | What to do | Effort | Value |
| --- | --- | --- | --- | --- | --- |
| A1 | **Translate the words the server already sends.** The keyboard's labels (for example `words_out_status`, "Out of free words — open Tailzu to get more.") always go out in English. So do the word-bearing flags: the tray and notification copy in `desktop.shell`, the `desktop.tones` labels, `profile.genders`, and the country names in `auth.countries`. | `tulmi/src/server.ts:3478-3543` (keyboard config: no `localize`); `experience/i18n.ts:299` (labels only); `catalog.ts:2310` (`desktop.shell` is a flag) | Run the keyboard config's `labels` through the translator. Also walk the string leaves of a short list of word-bearing flags (`desktop.shell`, `desktop.tones[].label`, `profile.genders[].label`, `auth.countries[].name`). | S–M | High: India-first, and these are the words people see most (tray, keyboard status) |
| A2 | **The tray's tones look like code ids.** The server sends the app's own fallback list, so the tray shows "none, formal, casual, very-casual, excited", in lower case and without the person's own voices. Tone names are kept in 6 places. | `TAILZU-DESKTOP/main.js:531`; `appKnobsData.ts:1227` (the only source); no `desktop.tones` in `catalog.ts` | Build `desktop.tones` in the catalog from the same source as the keyboard's `kb.personality.tones` (`catalog.ts:15149`, `personalityPresets.ts`), with the person's pinned voices first. | S | Med |
| A3 | **Swipe typing uses an embedded word list.** About 300 frequency-ordered words are built into the iOS keyboard. The server can replace the list with `kb.swipe.coreWords` but sends `[]`, so the embedded one is always used. `kb.swipe.extraWords` is only `["tailzu","tulmi"]`. | `app/targets/keyboard/SDUIRenderer.swift:9194` (list), `:9232` (read); `catalog.ts:14984` | Send the core list from the server, and add common Hinglish words and product names to `extraWords`. Tune both with the revert telemetry. | S | Med–High: swipe quality, Hinglish |
| A4 | **Key clicks disagree when the server says nothing.** With `kb.key.sound` absent, iOS clicks and Android stays silent. | `SDUIRenderer.swift:7471` (`!= false`), `SDUIRenderer.kt:3735` (`!= true`); `catalog.ts:15132` sets it only for someone who chose | Send `kb.key.sound` explicitly for everyone, as one product decision. | S | Low–Med |
| A5 | **Keys the server could set but the console doesn't list.** Desktop share-in's 11 words (`"desktop.share." + k`: Drop to send, Adding it…, Couldn't add that…, That file is over 50 MB…). 42 iOS and 10 Android keyboard keys with no default (`kb.flash.*` ×4, `kb.smartPeriod`, `kb.suggestion.chip*` ×4, `kb.confetti.colors`, `kb.audio.*` ×3, `kb.tones`…). 9 app keys (`app.offline.*` colours, `share.maxAgeMs`, `postLanguageScreenId`…). | `TAILZU-DESKTOP/shareIn.js:160-165`; `keyboardKnobsData.ts` `dynamic` lists; `app-knobs.json` `dynamic` | Give each one an explicit value in `catalog.ts`, as labels for the words, so the console shows them and A1 translates them. Then rewrite `shareIn.js` to name its keys literally the next time it is touched, so the extractor finds them. | S | Low–Med |
| A6 | **Retire the native name-and-gender card.** It still shows on `personality` and `home` for people who were onboarded before the Bots app's first run. The Bots app already asks the same question as a server screen (`bots.name-it`). | `app/src/onboarding/ProfileGate.tsx`; `SduiApp.tsx:2089, 2209`; `catalog.ts:2534, 2634` | For Bots app builds, set `profileGate.screenIds` to `[]` and open `bots.name-it` through `promptScreenId` for anyone with no gender. First check that `bots.name-it` suits someone who is already onboarded: it also runs Name your Tailzu. | S | Low–Med |
| A7 | **Native fallback lists are only safety nets.** The language list, countries, genders, accents (`kb.accents`, `catalog.ts:14274`), tones, autocorrect confusables and filler patterns are all knobs, and the server sends them. | `LanguageSelectScreen.tsx:56`, `authConfig.ts:107`, `ProfileGate.tsx:84`, `SDUIRenderer.swift:5490` | Nothing to do. Edit these through the console, not in the apps. The native language picker is already switched off (`needsLanguagePick: false`, `catalog.ts:2488`). | — | — |

**A totals:** 6 actions, about 3–5 days of backend work. Together they translate about 140 words, give the tray proper tone names,
put swipe's word list on the server, settle one platform disagreement, list about 70 hidden keys in the console, and retire one
native overlay.

## B. Worth a renderer update

Each item needs one app or desktop release. After that, the server drives it. Ordered by value for effort.

| # | Item | Where | What it takes | Effort | Value |
| --- | --- | --- | --- | --- | --- |
| B1 | **The desktop's one-key router.** It decides where spoken words go: typed, Ask, meeting notes, or a bot. The rules are about 666 phrase literals in English, Hinglish and Devanagari: wake names and the ways the recogniser mishears "Tailzu", greetings, notes start and stop phrases, question and command openers and endings, "about the screen" nouns, writing instructions. There are also 4 built-in bots' names and 16 bot-task regexes ("book a flight" → Travel, "fix the bug" → Code). The wake names `["Tailzu","Blip"]` are written in 3 places. | `TAILZU-DESKTOP/router.js:55-240`; `main.js:3021, 3107`; `resolver.js:27` | Read each list as `list("desktop.router.<name>", <today's list>)`, and the task rules as `obj` (slug plus pattern strings). The router stays local and synchronous, and works offline from the cached bootstrap. The server then sends the lists from one source, and can add a person's own bots and new languages. | M | **High**: routing errors are the main one-key complaint, and the lists need tuning |
| B2 | **Ask's own words on the desktop.** 19 stop lines and 3 error lines ("Ask doesn't look at this app.", "I stopped there: that was taking too long.", "Couldn't reach Tailzu."…). Also 19 refusals from the file tools ("That isn't a folder.", "No folder is allowed for Ask. Add one in Settings."…). All English only. | `agent.js:126-147`, `:2760-2765`; `localfiles.js:245-290` | `agent.js` already has a `knob()` dependency, so each line can read a `desktop.agent.text.*` label. Pass a `txt` into `createLocalFiles` for the refusals. The rules themselves stay in the app (see C). | S | Med |
| B3 | **The "Tailzu Code on this computer" window.** A native window with about 43 built-in words: its intro, the safety text, the switches, the state names ("Online for Tailzu Code", "Paused: the battery is under 20%"), and the projects table. The server already has `bots.computer`, but it shows status only. | `runner/runner.html`; `runner/ui.js:10-60`; `preload.js:161-170` | Give the window's controls desk actions (`runner.set`, `runner.project`, `runner.checkDocker`, `runner.stop`, `runner.openAudit`, plus a `runner` state in screen state), the way `notes.allowSystemAudio` works in `sdui.js:3726`. Then draw it as `bots.computer` on the desktop and drop the window. Consent stays with main.js. | M | Med |
| B4 | **Ask's local resolver mirrors the server's grammar.** 15 regex rules and about 155 phrases are copied from `tulmi/src/agent/grammar.ts` and `resolver.ts`, with a comment saying "keep them in step". They match today. | `TAILZU-DESKTOP/resolver.js:23-296` | Send the lists in the bootstrap from the server's own module, keeping today's as the fallback. This removes the drift risk. The thresholds are already knobs (`desktop.agent.matchScore`, `matchMargin`). | S–M | Low–Med |
| B5 | **The iOS share extension's card.** 4 words ("Opening Tailzu…", "That's too big for Tailzu.", "Tailzu can't take this one.", "Saved. Open Tailzu to send it."), 5 limits (5 files, 50 MB, 6,000 characters, 4,096 px, 1.6 s close) and a fixed white card. | `app/targets/share/ShareViewController.swift:30-37, 45-60, 271-288` | Have the app write a `share.*` copy and limits block to the App Group, as it already does for the widgets (`widgets/flow.ts`, `month.ts`). The extension reads that block and falls back to today's values. | S | Low–Med |
| B6 | **Limits that are product decisions.** Share-in takes 5 files and 2,000 characters on the phone and the desktop, and 6,000 characters in the iOS extension. The outbox keeps 20 asks and keeps sent ones for 24 h (phone and desktop). The upload cap is 50 MB in three copies; the server can lower it per action but never raise it. | `app/src/share/shareIn.ts:31-32`; `sdui/outboxCore.ts:48-49`; `sdui/mediaCore.ts:9`; `TAILZU-DESKTOP/shareIn.js:30-32`, `outbox.js:19-20`, `media.js:23` | `num()` knobs, keeping today's numbers as the ceilings where they guard memory. | S | Low |
| B7 | **Fixed haptics on the phone.** 44 native haptic calls with fixed styles, in the sign-in pills, morph controls, the dictionary, swipe rows, the profile card and coverflow. The server's own `haptic` action is already server-driven. | `AuthGateScreen.tsx` (14), `morphControls.tsx` (11), `dictionary.tsx` (4), `SwipeAction.tsx` (3), `ProfileGate.tsx` (3), others (9) | One map knob, `app.haptics.<moment>` → `light|medium|selection|success|warning|none`, read through a small `haptic(moment)` helper. | S–M | Low |
| B8 | **Android keyboard icons.** Six icon names map to Android **system** drawables (shift uses `ic_menu_upload`, refine uses `star_on`). A new icon needs a release. iOS takes any SF Symbol name from the server. | `modules/tulmi-keyboard/android/SDUIRenderer.kt:3885-3892` | Draw icons from server vector shapes, as `TulmiMarkView` already does for the mic mark (same file, below it). | M | Low–Med |
| B9 | **Android notifications have one channel.** Every push goes to "General", so people cannot mute just Plan reminders or Code bot pings. | `app/src/notifications/push.ts:82-88` | `list("push.android.channels", [...])`, with the push engine naming a channel per push kind. | S | Low–Med |
| B10 | **Lists of apps the code recognises.** Browsers (twice), their short names, the web apps Ask knows, and the Android keyboard's package → app name map (WhatsApp, Telegram, Slack, Gmail, Instagram, Twitter, Messages). | `frontApp.js:32-33`; `agent.js:317-327`; `TulmiKeyboardService.kt:1692-1706` | `list` / `obj` knobs, with today's as the fallback. For Android, better: send the package and let the server name the app. | S | Low |
| B11 | **Desktop faces are bundled only.** 20 woff2 files (~640 KB). The CSP allows the app's own fonts only, so a new face needs an installer. The phone already loads fonts from the server (`sdui/remoteFonts.ts`). | `TAILZU-DESKTOP/assets/fonts`, `app.html:17+`, `guide.html:86+`, `overlay.html:14+` | A remote font loader allowing `font-src` from the backend origin, with the bundled faces as the fallback. | M | Low |
| B12 | **Small leftover words and hints.** The phone's file-too-big line. Raw auth error details ("Network error", "OAuth error"…), shown only with `auth.errors.showDetail`. The desktop's one-key labels ("Right ⌥", "Right Ctrl"…). The keyboard's 10 English field descriptions sent to the model ("a message being sent to a person"). | `sdui/mediaCore.ts:65`; `AuthGateScreen.tsx:1064, 1293, 1305, 1328`; `oneKey.js:25-28`; `KeyboardViewController.swift:2827-2841` | Labels for the words. For the hints, send the field-kind enum only and let the server write the words. | S | Low |
| B13 | **Tray menu order and structure.** The words are already the server's (`desktop.shell`). The rows, their order and their submenus are code. | `TAILZU-DESKTOP/main.js:1789-1880` | A server list of rows (`kind`, `label` key, `action`, `when`) drawn by main.js. | M | Low |
| B14 | **Motion micro-timings in the Bots kit's own components.** Home header write-on (170 ms a letter, the caret's 2.6 s stay), SVG breathe (900 ms), Blip overlay fade (380 ms), the email-sent animation. About 15 values. | `sdui/HomeHead.tsx:32, 74-87, 176`; `SvgShapes.tsx:71`; `onboard/BlipHost.tsx:263`; `auth/EmailSendAnimation.tsx:30-46` | Node props with today's defaults. | S | Low |
| B15 | **Blip, the onboarding walker.** His figure, poses and motion are code: about 300 numbers on the phone with no knobs, and about 150 in the desktop's `blip.js`. The animated loops are already served (`/blip/bots/`, `blipLoops.ts`), and the server already picks his pose per step (`BlipSpot`). | `app/src/onboard/blipFigure.ts:140` (POSES), `blipMotion.ts`; `TAILZU-DESKTOP/blip.js` | Fold into the planned tiny-bots data work: poses as data, same shape for both renderers. | L | Low |

**B totals:** 15 items. B1–B5 are worth one desktop release plus one phone release, roughly 2–3 weeks. They move about 110 words
and the ~820 routing phrases. B6–B15 are small and can ride along when their files are next touched.

## C. Leave in the app

| Item | Where | Why it stays |
| --- | --- | --- |
| Native sign-in screen | `app/src/auth/AuthGateScreen.tsx:780` | Already server-first. The server's `auth.screen` tree draws whenever this build has every component it names (`:942-947`). This screen is the way in when the tree is missing or throws. Its words and sizes are knobs (28 `txt`, 53 more). |
| Boot failure, error card, offline card, splash, the developer's connection screen | `App.tsx:151`; `sdui/ErrorBoundary.tsx`; `OfflineScreen.tsx`; `SduiApp.tsx:1810, 2352`; `app.config.ts:504-510` | They must draw with no server. Their words and colours are knobs read from the last bootstrap on disk (`App.tsx` `primeKnobs`). |
| Update prompt | `SduiApp.tsx:2226` (phone); `main.js:385-410` (desktop) | It has to work on old builds whatever the server's screens need. Its content is already the server's (`boot.update`, `desktop.update`). |
| OS permission prompts: iOS 17, macOS 3, Android manifest | `app.config.ts:195-245`; `TAILZU-DESKTOP/package.json:122-125` | Compiled into Info.plist and the manifest, and reviewed by the stores. *When* we ask, and the card before the OS prompt, are already SDUI (`arrivalCard`, `DeskMicAsk`, `DeskAskSetup`). |
| App Intent and widget gallery words: 8 iOS, 4 Android | `targets/widgets/DictateControl.swift:44-52`, `FlowActivity.swift:85-86`, `_shared/FlowEnd.swift:38-39`; `tulmi-bridge/.../tailzu_widget_strings.xml` | Compile-time metadata. Everything drawn on the widgets themselves is already the server's, through the App Group. |
| Keyboard typing path: touch model, autocorrect cost model, swipe decoder, key plane, accent tray, key pop, tone sheet gestures | `SDUIRenderer.swift` (1055-1669, 5236-6177, 7501-7734, 8666-9500), `TulmiAutocorrect.kt`, `TulmiSwipe.kt`, `TulmiKeyPlane.kt` | Each runs inside a keystroke. Already tuned by about 300 `kb.*` knobs, and the word lists are server data (A3, A7). Drawing these from a tree would add latency where it is felt most. |
| Bundled keyboard config and the legacy hand-built keyboards | `targets/keyboard/default-config.json`, `modules/tulmi-keyboard/android/res/raw/tailzu_default_config.json` (41 KB each); `KeyboardViewController.swift:838+`; `res/xml/qwerty.xml`, `legacy_*.xml` | Offline fallbacks for a keyboard that has never fetched a config. The bundled copies are dated 18 Oct. **Re-export them at every release** (a checklist item, not a server push). |
| Security floors: private and sensitive app detection (49 terms), Ask's risk words, the file tools' path rules and limits (500 files, depth 6…), the runner's guard, live-view sandboxing, screen-id and deep-link validation | `frontApp.js:54, 60`; `agent.js:882-905`; `localfiles.js:5-50, 245-290`; `runner/guard.js`; `liveViewMain.js`, `sdui/liveViewRules.ts`; `app/src/security.ts`, `deeplinks/router.ts` | A server mistake or compromise must not be able to widen them. If these lists are ever served, take the **union** with the built-in list, so the server can add but never remove. Their *words* can move (B2). |
| Guard-rail constants in Ask's agent and the drivers (screen size caps, picture bytes, timeouts) | `agent.js:63-112`; `axDriver.js:26-43`; `uiaDriver.js:29-38` | Most are protocol and memory ceilings. The ones that are product choices are already knobs (`desktop.agent.*`, 20 reads). |
| Icons, splash pictures, tray dots, the keyboard's mark | `app/assets/*`; `TAILZU-DESKTOP/assets/*.png`; `targets/keyboard/Assets.xcassets`, `res/drawable-nodpi/tailzu_mark.png` | Needed at install or before any network. The keyboard's mic mark is already drawn from server geometry when one arrives. |
| Platform constraints | Flow Session is iOS-only; the one key is not on Linux; Google sign-in needs native client ids | OS facts, not product decisions. The decisions that rest on them are knobs (`kb.mic.mode`, `desktop.oneKey.enabled`, `auth.google.*`). |
| Review and demo scripts (~100 sample lines) | `guide.js:2012-2404`, `pill.js:890-925` | Not user-facing: they only run with `?demo`. They could be left out of the packaged build. |
| Hidden windows | `recorder.html`, `notes.html` | They draw nothing. |

## Inventory 1: screens and windows the apps draw themselves

"Words/numbers" says whether what the surface shows is already the server's.

| Surface | Where | Words/numbers | Layout | Group |
| --- | --- | --- | --- | --- |
| **Phone** | | | | |
| Sign-in (native fallback) | `auth/AuthGateScreen.tsx` | knobs | native; SDUI-first | C |
| Language picker | `onboarding/LanguageSelectScreen.tsx` | knobs | native; switched off by the server | A7 |
| Name and gender card | `onboarding/ProfileGate.tsx` | knobs | native overlay | A6 |
| Offline card, connection screen, error card, boot failure, splash | see C | knobs | native | C |
| Update prompt | `SduiApp.tsx:2226` | server | native | C |
| Launch card frame | `SduiApp.tsx:2142` | server (SDUI root) | native frame | — |
| Email-sent animation | `auth/EmailSendAnimation.tsx` | none | native | B14 |
| System alerts (subscription elsewhere, purchase error, leaving a live view, sign-in errors) | `sdui/actions.ts:78, 658`; `LiveView.tsx:78`; `AuthGateScreen.tsx:131` | knobs | OS alert | C |
| Month widget (iOS and Android), Flow and Setup Live Activities, Dictate control | `targets/widgets/*`; `tulmi-bridge/.../TailzuMonthWidget.kt` | server via the App Group, except the gallery metadata | native (WidgetKit, RemoteViews) | C |
| **Keyboards** | | | | |
| Tone sheet, accent tray, key pop, dictation veil, toast, confetti, language sheet | `SDUIRenderer.swift:5236, 5722, 7658, 4948, 8336, 8389, 9484`; Android `TulmiToneSheet.kt`, `TulmiKeyPop.kt`, `TulmiEffects.kt` | knobs (`kb.tone.sheet.*`, `kb.accentTray.*`…) | native | C |
| Legacy hand-built keyboard | `KeyboardViewController.swift:838`; Android `res/xml/*.xml` | knobs (`kb.legacy.*`) | native | C |
| **Share extension (iOS)** | `targets/share/ShareViewController.swift` | **built in** | native | B5 |
| **Desktop** | | | | |
| Pill | `pill.html`, `pill.js` | knobs (`desktop.pill.*`) | native | — |
| Ask's guide card | `guide.html`, `guide.js` | knobs, but **agent.js stop lines are built in** | native | B2 |
| Live captions overlay | `overlay.html`, `overlay.js` | knobs | native | — |
| **Tailzu Code on this computer** | `runner/runner.html`, `runner/ui.js` | **built in** | native | B3 |
| Tray menu | `main.js:1789` | `desktop.shell` and knobs; not translated (A1) | native order | A1, B13 |
| Notifications (~30 kinds) and the runner's two dialogs | `main.js:285-3485` | `desktop.shell` and knobs | OS | A1 |
| Sign-in gate frame (heading, note, error line) | `app.html` | server (`desktop.shell.gate`) | native frame; the form is SDUI | — |
| Share-in drop layer | `shareIn.js` | keyed but **unlisted** | native | A5 |

## Inventory 2: user-facing words built into the apps

These are words a person can see that are not knobs, labels or node props. The count excludes knob fallbacks, logs, and test or
demo text.

| Area | Built in | Examples | Group |
| --- | --- | --- | --- |
| Phone (`app/src`, `App.tsx`) | **4** | "That file is over 50 MB, the most Tailzu takes." (`mediaCore.ts:66`); "Network error", "OAuth error", "Google didn't return an identity token." (debug detail only) | B12 |
| Keyboards (iOS and Android) | **0** shown to people (+10 English hints for the model, +7 app names) | "a message being sent to a person"; "WhatsApp" from `com.whatsapp` | B12, B10 |
| Share extension (iOS) | **4** | "Opening Tailzu…", "Saved. Open Tailzu to send it." | B5 |
| Widgets and App Intents | 12 (must stay) | "Dictate with Tailzu", "End Flow session", "The Month" in the Android picker | C |
| Permission prompts | 20 (must stay) | NSMicrophoneUsageDescription (iOS ×17, macOS ×3) | C |
| Desktop: Ask (`agent.js`) | **22** | "Ask doesn't look at private windows.", "I was going round in circles, so I stopped." | B2 |
| Desktop: file tools (`localfiles.js`) | **19** | "That path goes up out of its folder.", "I can't reach that." | B2 |
| Desktop: runner window | **~43** (+ ~50 log notes such as "[Tailzu: this computer could not run the step: …]") | "Use this computer for Tailzu Code", "Paused: Low Power Mode is on" | B3 |
| Desktop: share-in | **11** (keyed, unlisted) | "Drop to send", "Let go, then pick the bot to send it to." | A5 |
| Desktop: one key, wake names | 5 + 2 lists | "Right ⌥", "Right Ctrl"; `["Tailzu","Blip"]` | B12, B1 |
| Desktop: demos | ~100 (not shipped to people's eyes) | Sample Slack and Keynote scripts | C |
| **Total movable** | **~120** (+ ~50 runner log notes) | | |

Separately, about **140 words the server already sends are never translated** (A1): 42 iOS and 51 Android keyboard labels, about
40 `desktop.shell` words, and the word-bearing list flags. Every built-in word above is English for everyone. Moving a word to a
label gets it translated by `i18n.ts` with no extra work.

## Inventory 3: behaviour and rules in app code

| Rule | Where | Size | Group |
| --- | --- | --- | --- |
| One-key routing: what is dictation, a question, a notes command, a bot task | `TAILZU-DESKTOP/router.js:55-240` | ~666 phrase literals, 16 task regexes, 4 bot name sets | B1 |
| Ask's local answer: fillers, show or do, picture questions | `resolver.js:48-296` | 15 regexes, ~155 phrases (server mirror) | B4 |
| App recognition | `frontApp.js:32-33`; `agent.js:317-327`; `TulmiKeyboardService.kt:1692` | 4 lists, 7 rules | B10 |
| Privacy, risk and file safety | `frontApp.js:54-60`; `agent.js:882-905`; `localfiles.js` | ~70 terms, ~10 limits | C |
| Product limits: share-in, outbox, upload cap | see B6 | 8 values in 3 copies | B6 |
| Haptics in native components | see B7 | 44 calls | B7 |
| Key click when unset | see A4 | 1, disagrees across platforms | A4 |
| Swipe core lexicon | `SDUIRenderer.swift:9194` | ~300 words | A3 |
| Motion micro-timings in Bots kit components | see B14 | ~15 | B14 |
| Blip's figure and motion | see B15 | ~450 numbers | B15 |
| Tray menu order | `main.js:1789` | 1 | B13 |

Already server data, so nothing to move: accent map, autocorrect weights and confusables, touch bigrams, filler patterns, tones,
haptics per key, routing thresholds, tap and one-key timings, live-update timings, onboarding order (`firstRun.ts`, `onboard.ts`),
deep-link prefixes, the push foreground rules, the mic key's motion program, and every timing on the phone outside the files named
in B14.

## Inventory 4: bundled assets

| Asset | Where | Could the server serve it? | Group |
| --- | --- | --- | --- |
| App icons, adaptive icon, splash and splash mark | `app/assets/icon.png`, `adaptive-icon.png`, `splash*.png` | No: install time and the OS splash | C |
| Tailzu mark used by the particle and morph effects | `app/assets/tailzu-mark.png` (`ParticleMark.tsx:58`, `morphControls.tsx:29`) | Yes, as a URL prop with this file as the fallback | B (low; not tabled) |
| Keyboard mark | `Assets.xcassets/TailzuMark`, `res/drawable-nodpi/tailzu_mark.png` | Already drawn from server geometry when one arrives | C |
| Keyboard default configs | 2 × 41 KB JSON | Already the server's export; refresh at each release | C |
| Desktop fonts (20 woff2, ~640 KB) | `TAILZU-DESKTOP/assets/fonts` | Yes, with these kept as the fallback | B11 |
| Desktop app and tray icons | `assets/icon*.png`, `tray*.png` | No: before any network | C |
| Blip loops (animated WebP) | `tulmi/blip/bots`, `blipLoops.ts` | Already served | — |
| Phone fonts | `sdui/remoteFonts.ts` | Already served | — |
| Sounds | none bundled; keyboard clicks are the system's | — | — |
| Old app's tab icons (drawn in code) | `sdui/ThreadIcons.tsx` | The Bots app's glyphs are already server SVG (`bots/glyphs.ts`) | none (being replaced) |

## Inventory 5: feature switches

None of the apps' features is switched on or off in code. Every switch is a knob the server sends, including phone sign-in,
sign-up, Ask, the one key, routing, the pill, captions by default, the analytics and ads SDKs, live updates, the outbox, and the
keyboard's autocorrect, auto-caps and smart punctuation. Per-person switches (`bots.app`) are flags the server sets per person.
The console can scope any switch by platform, build, version, language, user, percentage or date (`control/rules.ts`), and
`experience/rollout.ts` adds stable buckets.

Two things to watch:

* Where a key is *absent* on purpose, its meaning is the app's. `kb.key.sound` is the one where that meaning differs by platform
  (A4).
* `CATALOG_CONDITIONAL` (`appKnobs.ts`) lists flags whose absence means something. A new one needs to be added there, or the knob
  filler will send its default to everyone.

## Method and limits

* **Words.** I scanned every `.ts`/`.tsx` in `app/src` and `App.tsx`, every `.swift` and `.kt` in the keyboards, share extension,
  widgets and native modules, and every `.js`/`.html` in `TAILZU-DESKTOP` (runner included). I looked for string literals that read
  like words, removed knob fallbacks, log lines and errors, and checked each remaining hit by hand. Desktop numbers were cross-checked
  against their `num()` reads.
* **Coverage.** Knob counts come from `tools/knobs/app-knobs.json` and `keyboard-knobs.json`. Both were checked current with
  `--check`, and the backend's data files were compared key by key.
* **Translation.** The A1 finding comes from reading `i18n.ts:280-305` and the routes that call `localize`. No `localize` call
  appears on `/v1/keyboard/config`, and no `language` reaches `buildKeyboardConfig` (`catalog.ts:13449`). It is worth a quick look
  at the live payload in Hindi to confirm.
* **Console.** A console rule may already set some values this file calls unset (A2, A4, A5). The rules live in the database, which
  this audit did not read.
* **Counts are rough.** "~" means hand-checked samples and pattern counts, not an exhaustive human read of every line.
