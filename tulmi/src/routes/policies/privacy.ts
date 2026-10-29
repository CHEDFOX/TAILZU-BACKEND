/**
 * Privacy Policy — served as HTML at /privacy.
 *
 * The content lives inline so admins can update copy via the same PR/deploy
 * flow as everything else. Keep in sync with the actual SDKs the app uses.
 *
 * If you materially change what data you collect / who processes it / where it
 * lives → bump the effective date AND remember to update the App Privacy
 * questionnaire in App Store Connect.
 */
import { siteShell } from "./shell.js";
import { crumbsLd, pageLd } from "../../seo/head.js";
export const PRIVACY_POLICY_EFFECTIVE = "October 28, 2026";

const PRIVACY_POLICY_BODY = `
<h1>Privacy Policy</h1>
<p class="effective">Effective: ${PRIVACY_POLICY_EFFECTIVE}</p>

<p>Tailzu (also referred to as "we", "our", "us") builds a voice-and-text keyboard that transcribes your speech, refines your writing, and helps you communicate. This Privacy Policy explains what personal information we collect through the Tailzu iOS, Android and desktop apps, the keyboard extension and our website (x0bot.com), how we use it, and the choices you have.</p>

<p>By using Tailzu, you agree to this Privacy Policy. If you do not agree, please do not use the app.</p>

<hr>

<h2>1. Information we collect</h2>

<h3>1.1 Account information</h3>
<ul>
  <li><strong>Email address</strong> (when you sign in with email or Apple ID)</li>
  <li><strong>Phone number</strong> (only if you choose phone sign-in)</li>
  <li><strong>Name</strong> (only if you provide it during onboarding or your Apple ID shares it)</li>
  <li><strong>Language preference</strong> and other in-app settings</li>
</ul>

<h3>1.2 Voice and text you send to Tailzu</h3>
<p>When you use voice input or the refinement feature, we transmit the audio or text you dictate to our servers and to the AI providers listed below in Section 3 for the purpose of transcription and refinement.</p>
<ul>
  <li><strong>Voice recordings</strong> are processed transiently — sent to a speech-to-text provider, converted to text, and then discarded. We do not permanently store raw audio unless you specifically enable session history in Settings.</li>
  <li><strong>Text you dictate or refine</strong> is used to produce refined output and, if you opt in to session history, saved so you can review it later.</li>
  <li><strong>Personality preferences</strong> (tone, vocabulary, personal dictionary) are stored so refinement can match your voice.</li>
  <li><strong>What you ask Tailzu to do on your phone</strong>: the first 80 characters are kept for 30 days, so the You tab can show your recent requests, and your words for a day when a request failed having changed nothing, so you can try it again with one tap (see 11.4). Of what you ask Ask on your computer, none of your words are kept, apart from your Tasks list (see 11.4).</li>
</ul>

<h3>1.3 Purchase information</h3>
<p>If you purchase a subscription, our payment processor (RevenueCat, backed by the Apple App Store or Google Play) provides us a receipt confirming the purchase and its entitlements. We do not receive or store your credit card number.</p>

<h3>1.4 Device and diagnostic information</h3>
<ul>
  <li><strong>Device model, OS version, app version, language, timezone</strong></li>
  <li><strong>Push notification tokens</strong> (via Apple Push Notification service / Firebase Cloud Messaging) — used to deliver notifications you have opted into</li>
  <li><strong>Advertising identifier</strong> — on Android, the device's advertising ID is read by Meta's SDK to tell whether an install came from one of our ads (see 1.6). You can reset or delete it in Android's settings. On iPhone, Tailzu never asks for or reads the advertising identifier (IDFA), and shows no tracking prompt.</li>
  <li><strong>Crash reports and error logs</strong> (via Sentry, only if enabled) — used to diagnose and fix bugs</li>
  <li><strong>Usage events</strong> (via PostHog, only if enabled) — anonymous aggregate metrics about which features are used, to guide product improvements</li>
</ul>

<h3>1.5 Data you may choose to share via device permissions</h3>

<p>The app requests OS-level permissions only when you activate a specific feature. If you deny a permission, the related feature is unavailable but the rest of the app functions normally.</p>

<ul>
  <li><strong>Microphone</strong> — required for voice input. Audio is transient and never stored (see 1.2 above). <strong>Flow Sessions:</strong> when you start a Flow session, the microphone stays active in the background — iOS shows the recording indicator the entire time — so you can dictate directly from the Tailzu keyboard without reopening the app. The session ends automatically after a period of inactivity (about 10 minutes by default) and you can end it at any time from Settings → End Flow session. Outside of an active Flow session or an explicit dictation, the microphone is off.</li>
  <li><strong>Photos / Photo Library</strong> — accessed only when you attach an image to a message or import media. We never scan your library in the background.</li>
  <li><strong>Camera</strong> — accessed only when you actively invoke camera capture or QR scan.</li>
  <li><strong>Contacts</strong> — accessed only when you tag or mention a contact. We do not upload your contact book to our servers.</li>
  <li><strong>Calendar</strong> — accessed only when you dictate an event to add to your calendar.</li>
  <li><strong>Location (precise or approximate)</strong> — accessed only if you dictate a location-tagged note or check-in. Not collected in the background.</li>
  <li><strong>Face ID / Touch ID / biometric authentication</strong> — used locally on your device to unlock private drafts. Biometric data never leaves your device.</li>
  <li><strong>Clipboard</strong> — read only when you paste into the app. We never read the clipboard in the background.</li>
  <li><strong>Bluetooth</strong> — used to connect to headsets you pair for voice input.</li>
  <li><strong>Local network</strong> — used only if you enable device-to-device sync.</li>
  <li><strong>Speech recognition</strong> — on-device recognition; audio processed locally by iOS.</li>
</ul>

<h3>1.6 Advertising measurement (Meta)</h3>
<p>We advertise on Facebook and Instagram, and we tell Meta when someone gets and starts using Tailzu, so we can see which ads work and show them to people likely to find Tailzu useful. What Meta receives:</p>
<ul>
  <li><strong>On our website</strong> (Meta's pixel): the pages you visit on x0bot.com, and a click on a download or app-store link, with your IP address, browser, and Meta's cookies (_fbp, _fbc). The pixel does not load if your browser sends Global Privacy Control or Do Not Track, or if your device's clock is set to a European time zone. It never loads on the payment page.</li>
  <li><strong>From the phone apps</strong> (Meta's SDK): that the app was installed and opened, and three milestones — that you created an account, switched the keyboard on, and made your first dictation.</li>
  <li><strong>From our servers</strong> (Meta's Conversions API): for the desktop app, that you created an account and made your first dictation; for any subscription bought on x0bot.com, that it started and its price. These carry your email address and phone number only as one-way SHA-256 hashes, and your account ID hashed the same way, which is how Meta matches them to someone its ads reached.</li>
</ul>
<p>Each milestone is reported once, and only for accounts in their first week. <strong>Meta never receives anything you say, type or dictate</strong>, nor your history, settings or vocabulary. You can control how Meta uses this in your Facebook or Instagram ad settings, and you can ask us to stop reporting your account at <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</p>

<h3>1.7 Non-collection notice</h3>
<ul>
  <li>We do NOT collect your typing outside of when you actively invoke the mic or refine actions.</li>
  <li>The keyboard extension respects Apple's and Google's sandboxing — we do not read passwords, PINs, or content from secure text fields.</li>
  <li>We do not sell personal information to third parties.</li>
  <li>We do not share your content with third parties for their independent marketing.</li>
  <li>We do not use your data to train third-party AI models.</li>
  <li><strong>CCPA notice:</strong> we do not sell personal information. The advertising measurement in 1.6 may count as "sharing" for cross-context behavioural advertising under California law; we honour Global Privacy Control as an opt-out of it on our website, and you can opt out for your account by emailing us.</li>
</ul>

<hr>

<h2>2. How we use your information</h2>
<ul>
  <li>To provide the core features (transcription, refinement, keyboard, personality)</li>
  <li>To do what you ask in the Google apps you connect, and nothing more (see Section 11)</li>
  <li>To authenticate your account and secure your data</li>
  <li>To process subscriptions and manage entitlements</li>
  <li>To improve the app through anonymous, aggregated usage analytics</li>
  <li>To measure and improve our advertising on Facebook and Instagram (see 1.6)</li>
  <li>To diagnose and fix crashes and bugs</li>
  <li>To comply with legal obligations</li>
</ul>

<hr>

<h2>3. Third parties we use</h2>

<p>Tailzu depends on the following processors to deliver the service. Each has its own privacy policy.</p>

<h3>Speech-to-text</h3>
<ul>
  <li><strong>OpenAI</strong> (openai.com/policies/privacy-policy) — processes voice for transcription. Voice is transient and not retained.</li>
  <li><strong>Groq</strong> (groq.com/privacy-policy) — alternative transcription provider.</li>
</ul>

<h3>Language refinement</h3>
<ul>
  <li><strong>OpenAI</strong> (openai.com/policies/privacy-policy) — refinement, tone matching. Content is transient and not used to train models under our data-processing agreement.</li>
  <li><strong>OpenRouter</strong> (openrouter.ai/privacy) — routing layer for language models.</li>
  <li><strong>Anthropic</strong> (anthropic.com/legal/privacy) — used through OpenRouter for premium refinement.</li>
</ul>

<h3>Ask, on the desktop app (see Section 10)</h3>
<ul>
  <li><strong>OpenRouter</strong> (openrouter.ai/privacy) — passes Ask's questions to the AI model that answers them. OpenRouter chooses which provider serves that model: the company that made it, or a cloud service that hosts it.</li>
  <li><strong>OpenAI</strong> (openai.com/policies/privacy-policy) — answers questions about the text on your screen.</li>
  <li><strong>Google</strong> (policies.google.com/privacy) — Gemini answers a question that comes with a picture of part of your screen.</li>
  <li><strong>Anthropic</strong> (anthropic.com/legal/privacy) — Claude answers either kind when the first model cannot.</li>
  <li>The models under <em>Language refinement</em> above write and rewrite text for Ask (a message it types into a field, a selection it rewrites), and answer a question when none of the models before them could.</li>
</ul>

<h3>Google apps you connect (see Section 11)</h3>
<ul>
  <li><strong>Google</strong> (policies.google.com/privacy) — Google Calendar, Docs, Tasks, Sheets, Forms and Classroom, for the ones you connect, and YouTube's search (see 11.1).</li>
  <li><strong>OpenRouter</strong>, <strong>OpenAI</strong> and <strong>Anthropic</strong> — the same models that answer Ask's questions about the text on your screen work out what to do in the apps you connect, on your phone and on your computer.</li>
</ul>

<h3>Authentication and database</h3>
<ul>
  <li><strong>Supabase</strong> (supabase.com/privacy) — hosts your account, profile, the record of your requests to Ask (see Section 4), and (if opted in) session history in secure managed Postgres.</li>
  <li><strong>Apple Sign In / Google Sign In</strong> — used only if you choose these methods; each provider shares only the fields you authorize.</li>
</ul>

<h3>Purchases</h3>
<ul>
  <li><strong>RevenueCat</strong> (revenuecat.com/privacy) — manages subscriptions.</li>
  <li><strong>Apple App Store / Google Play</strong> — process the actual payment.</li>
</ul>

<h3>Advertising measurement</h3>
<ul>
  <li><strong>Meta Platforms</strong> (facebook.com/privacy/policy) — measures our Facebook and Instagram ads, from the events described in 1.6.</li>
</ul>

<h3>Diagnostics (optional)</h3>
<ul>
  <li><strong>Sentry</strong> (sentry.io/privacy) — crash and error reporting.</li>
  <li><strong>PostHog</strong> (posthog.com/privacy) — anonymous product analytics.</li>
</ul>

<p>These processors receive only the minimum information needed for their specific function.</p>

<hr>

<h2>4. Data retention</h2>
<ul>
  <li><strong>Voice recordings:</strong> transient. Deleted immediately after transcription.</li>
  <li><strong>Session history:</strong> only if you opt in. Stored until you delete it or your account.</li>
  <li><strong>Ask:</strong> what it reads off your screen, and any picture it sends, is not stored. See Section 10.</li>
  <li><strong>The record of your requests to Ask:</strong> how each one went (done, waiting for you, or stopped, and why), how long it took, how many steps and changes it made, and which AI model answered and what that cost. It is kept until you delete your account, and holds none of your words, except from your phone: the first 80 characters of what you asked, for 30 days; your words to try again with, for a day; and a question Tailzu asks you back, with your request, for five minutes. See 10.4 and 11.4.</li>
  <li><strong>Google apps you connect:</strong> what Tailzu reads in them is not stored, except the details of a change waiting for your OK. Your access to an app is kept until you disconnect it or delete your account; your Tasks list and its record of actions, until you delete your account. See Section 11.</li>
  <li><strong>Account:</strong> kept until you delete it. When you choose Delete account in the app, your account and everything kept with it are deleted 7 days later. Until then nothing is removed and your bots stop working; sign in and choose Keep my account to keep it as it was. Where the app says deleting cannot be undone, it is deleted straight away.</li>
  <li><strong>Diagnostic logs:</strong> retained by Sentry / PostHog for up to 90 days per their standard retention.</li>
</ul>

<hr>

<h2>5. Your rights</h2>

<p>Depending on your region (GDPR, CCPA, and similar laws), you have the right to:</p>
<ul>
  <li><strong>Access</strong> — request a copy of the personal information we hold about you</li>
  <li><strong>Correct</strong> inaccurate or incomplete information</li>
  <li><strong>Delete</strong> your account and associated data ("right to erasure")</li>
  <li><strong>Portability</strong> — export your data in a machine-readable format</li>
  <li><strong>Restrict processing</strong> in specific circumstances</li>
  <li><strong>Object</strong> to processing based on legitimate interests</li>
  <li><strong>Withdraw consent</strong> for optional processing (crash reporting, analytics, tracking) at any time</li>
  <li><strong>Non-discrimination</strong> — we will not deny service, charge different prices, or provide a different level of service because you exercised any right (CCPA)</li>
  <li><strong>Automated decision-making</strong> — request human review of significant decisions made about you by automated systems. We do not currently make such decisions.</li>
  <li><strong>Authorized agent</strong> — you may designate an authorized agent to make requests on your behalf (CCPA)</li>
  <li><strong>Complaint</strong> — lodge a complaint with your local data protection supervisory authority if you believe we have not complied with applicable law (GDPR)</li>
</ul>

<p>To exercise any of these rights, contact us at <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>. We respond within 30 days (45 for CCPA requests, with a possible 45-day extension where permitted). We may request information to verify your identity before processing.</p>

<hr>

<h2>6. Data security</h2>
<ul>
  <li>All communication with Tailzu servers uses TLS (HTTPS).</li>
  <li>Data at rest is encrypted by our infrastructure providers.</li>
  <li>Access to personal data is restricted to necessary personnel.</li>
  <li>We follow industry-standard security practices, but no service can guarantee absolute security.</li>
</ul>

<hr>

<h2>7. Children</h2>
<p>Tailzu is not directed at children under 13. We do not knowingly collect personal information from anyone under 13. If we learn we have, we will delete it.</p>

<hr>

<h2>8. International data transfers</h2>
<p>Tailzu is operated globally. Data may be processed in the United States and other countries where our providers operate. Where required by law (GDPR), we rely on Standard Contractual Clauses.</p>

<hr>

<h2>9. Keyboard extension privacy</h2>
<p>The Tailzu keyboard extension is a separate iOS/Android app extension with restricted sandboxing:</p>
<ul>
  <li>The keyboard only sends data to our servers when you explicitly invoke voice or refine actions.</li>
  <li>Normal typing stays on-device and is never transmitted.</li>
  <li>The keyboard cannot see content from secure text fields (passwords, PINs).</li>
  <li>Full Access is only required for voice + refinement features that need network. Without Full Access, the keyboard still functions for regular typing.</li>
</ul>

<hr>

<h2>10. Ask, on the desktop app</h2>
<p>Ask is the helper in the Tailzu desktop app for Mac and Windows. Tap its key twice and say something about the app in front of you ("where's Export?", "explain this chart"), and it points at the thing, explains it, or does a small job for you. It reads the screen when you call it up, and again after each thing it does for you, to see what changed.</p>

<h3>10.1 What Ask reads on your computer</h3>
<ul>
  <li><strong>The app in front of you</strong>, through the system's accessibility interface: its buttons, fields and the text in them. On a Mac this needs the Accessibility permission.</li>
  <li><strong>The window's pixels</strong>, read into lines of text by your computer's own text recognition (Apple's Vision on a Mac, Windows' own OCR on Windows), on your computer. On a Mac this needs the Screen Recording permission (Screen &amp; System Audio Recording on newer versions of macOS).</li>
  <li><strong>Where your text cursor is</strong>, while you dictate, so Ask's character can sit above it. That position never leaves your computer.</li>
</ul>
<p>Some questions, like "where's Export?", are answered on your computer from what it read: your words still go to be turned into text (see 10.2), but nothing from your screen is sent.</p>

<h3>10.2 What Ask sends to our servers</h3>
<ul>
  <li><strong>A text list of what is on the screen:</strong> for each button, field or piece of text, what kind it is, its label, a short value, whether it is checked, selected or greyed out, and a rough position (top left, centre, bottom right and so on), together with the lines of text read off the window's pixels, each with its rough position. Also the app's name (for a browser, with the site's name, taken from the end of the tab's title, as in "Chrome: Gmail"), which field your cursor is in, and the text you have selected, if any.</li>
  <li><strong>What you said:</strong> your spoken question, turned into text by the same speech-to-text providers as dictation and handled the same way (see 1.2); and, while Ask is working on a question, what it has done for it so far. With it go your language setting and your time zone (as its offset from UTC).</li>
  <li><strong>The names of your files, only when you ask Ask about them:</strong> when you ask Ask to find, sort or tidy files, your computer does the work, only inside the folders you allowed (Downloads, Desktop and Documents unless you change them in Settings), and never in system, app or hidden folders. For a question about your files, the file names, sizes, kinds and dates it needs are sent to the AI model that plans the answer; what is inside a file never leaves your computer, and Tailzu does not store the names. Moving something to the Trash always asks first.</li>
  <li><strong>One picture, only when a question needs it and you have allowed it:</strong> a picture of the part of the screen your question is about (the image or chart, or else the window), cut on your computer to below the window's title bar and a browser's tabs and address bar, where it finds them, and no more than 1,024 pixels on its longer side by default. Before one is sent, Ask asks: Allow once, Always for that app (where the app can be named), or Not now. It does not ask again for an app you said Always to, nor at all once you have said yes for every app in the Tailzu app's Ask setup (see 10.5). Ask's card shows a note when a picture goes with a question.</li>
</ul>

<h3>10.3 What Ask never sends</h3>
<ul>
  <li><strong>The window's title</strong>, beyond a browser's site name (above). The tabs, headings and other text on the screen are listed as they are shown, even where one of them repeats the title.</li>
  <li><strong>Exact positions</strong> of anything on your screen. Only the rough position above leaves your computer.</li>
  <li><strong>Passwords and addresses:</strong> nothing in a password field; nothing in a browser's address bar, where Ask finds one; and never the part of a web address after "?" or "#", where links carry their one-time codes. Text you have selected is not sent at all if it contains such an address.</li>
  <li><strong>Anything from a private window or a sensitive app.</strong> Ask stops, and sends nothing from the screen, in a private (incognito) browser window, or in an app or page whose name marks it as banking, payments, investing or crypto, tax, health, insurance, a wallet or a password manager; and our servers refuse a request that comes from such an app.</li>
</ul>

<h3>10.4 Where a picture goes, and what is kept</h3>
<ul>
  <li>A picture goes from our server through <strong>OpenRouter</strong> to the AI model that answers the question: <strong>Google's Gemini</strong>; only if that fails, <strong>Anthropic's Claude</strong>; and if that fails too, the model that refines your dictation (see Section 3), when it is a different one. It goes with the question and the text list above. OpenRouter and the model's provider handle it under their own privacy policies.</li>
  <li><strong>Tailzu does not store the picture and does not log it.</strong> It is held in memory only while your question is answered. Our logs record that a picture went with a question, its size in bytes, whether it was of one image or the whole window, and which model and provider answered; never the picture or the text on your screen.</li>
  <li>Ask writes nothing to your History. As with dictation, your usage counts the words Ask writes for you and the seconds you spoke, and we keep a count, in memory, of the pictures sent in the past day, for the daily limit.</li>
  <li>Tailzu keeps a record of each request to Ask on your computer: how it ended and why, how many steps it took and how long, how many things it changed, and which AI model answered and what that cost. It holds nothing you said and nothing from your screen.</li>
</ul>

<h3>10.5 How to turn it off</h3>
<ul>
  <li><strong>Each time:</strong> answer Not now when Ask asks to look, and no picture is sent.</li>
  <li><strong>For one app:</strong> an app you said Always to is listed in the Tailzu menu (the menu bar on a Mac, the system tray on Windows), where you can have Ask ask again for it, or for all of them.</li>
  <li><strong>For every app:</strong> in the Tailzu app, "Look at the screen when it's needed" (on the home page until it is set up, and always in Settings under Ask) lets Ask look without asking each time. Turn it off there, and Ask goes back to asking first, except in the apps you said Always to. Signing out turns it off and forgets every Always.</li>
  <li><strong>Altogether, on a Mac:</strong> without the Accessibility permission Ask cannot read an app's buttons, fields and text, and without Screen Recording it cannot see the window's pixels or take a picture of them; with both off, it reads nothing on your screen. You can turn either off at any time in System Settings &rarr; Privacy &amp; Security.</li>
</ul>

<hr>

<h2 id="google-user-data">11. Google apps you connect</h2>
<p>You can connect Google apps to Tailzu: Google Calendar, Google Docs, Google Tasks, Google Sheets, Google Forms and Google Classroom. Then you can ask Tailzu, on your phone or with Ask on your computer, to do things in them for you. You connect each app yourself, in Connected apps in Tailzu: tap Connect, and Google asks whether to allow it. This section says what Tailzu reads and changes in those apps, where that goes, what we keep, and how to end it.</p>

<h3>11.1 What Tailzu does in each app</h3>
<p>Google asks you for an app's permissions only when you tap Connect on it, and Tailzu connects only if you allow all of them. Signing in to Tailzu with Google never asks for them. Connecting does not give Tailzu your Google account's name or email address.</p>
<ul>
  <li><strong>Google Calendar</strong> — reads your events (their titles, times, and guests' names and email addresses), when you are free or busy, and your calendar's time zone. It adds, moves or cancels an event when you ask. If the event has guests, Google emails them the invite, the new time or the cancellation.</li>
  <li><strong>Google Docs</strong> — makes a new Doc from your words, or from one of your Tailzu meeting notes (its summary, key points and people, or its transcript if it has no summary). It does not read your Docs. Google lets it reach only the files Tailzu made, never the rest of your Drive.</li>
  <li><strong>Google Tasks</strong> — reads your task lists and tasks. It adds a task, ticks one off or deletes one when you ask.</li>
  <li><strong>Google Sheets</strong> — makes a sheet, adds rows to one, or reads one back. Google lets it reach only the sheets Tailzu made.</li>
  <li><strong>Google Forms</strong> — makes a form with your questions and publishes it, and reads the answers people send: the totals for each choice and the latest three answers. Google lets it reach only the forms Tailzu made. Those answers are other people's, and everything in this section applies to them too.</li>
  <li><strong>Google Classroom</strong> — only reads: your classes, the classwork that is due and whether you turned it in (with your grade, once it is returned), and your classes' latest announcements. It never changes anything in Classroom.</li>
</ul>
<p><strong>Gmail and Google Maps are not connected apps.</strong> When you ask Tailzu to write an email, it opens Gmail's own compose window with the email written, for you to check and send yourself. When you ask for directions, it opens Google Maps. Tailzu has no access to either, and it reads none of your email.</p>
<p><strong>YouTube is not a connected app either.</strong> When you ask Tailzu to find a video, it sends only the words to search for to Google's YouTube Data API, with Tailzu's own key (or, when it can't, opens YouTube's own search on your device). There is no sign-in, and nothing from your Google account is read or changed.</p>

<h3>11.2 Only when you ask</h3>
<ul>
  <li>Tailzu reaches into a Google app only to do what you just asked for. It never looks around in your apps on its own, in the background or on a schedule.</li>
  <li><strong>Looking something up</strong> (your calendar, your tasks, a sheet, a form's answers, your classes) happens right away.</li>
  <li><strong>Changes wait for your OK.</strong> The first time Tailzu makes a kind of change in an app (adding an event, adding a task), it shows you a card with the exact change, and nothing happens until you tap Approve; tap Not now, and nothing is done. Once you approve, Tailzu makes that kind of change in that app without asking again. Deleting always asks, every time. You choose how far Tailzu can go in each app (Can look, Can draft or Can send): at Can draft every change asks, and at Can look Tailzu changes nothing.</li>
</ul>

<h3>11.3 Where your Google data goes</h3>
<ul>
  <li><strong>To the AI model that works out the next step.</strong> What Tailzu reads in a Google app, at most 1,500 characters at a time, goes from our server with your request through <strong>OpenRouter</strong> to the AI model that answers you: <strong>OpenAI's</strong> model first; <strong>Anthropic's Claude</strong> if that fails; and if that fails too, the model that refines your dictation (see Section 3). With Ask on your computer, the text list of your screen goes with it (see 10.2). Tailzu tells OpenRouter to use only providers that do not collect it to train models (OpenRouter's data-collection setting is off for every one of these requests). OpenRouter and the model's provider handle it under their own privacy policies, which may let them keep it for a short time after Tailzu has dropped it.</li>
  <li><strong>To you.</strong> Tailzu's answer, and the card asking for your OK, are shown in Tailzu on your phone or computer.</li>
  <li><strong>To Google.</strong> What you asked Tailzu to write there: an event and its guests' email addresses, a Doc with your words or your meeting note, a task, rows in a sheet, a form's questions; and the words of a YouTube search (see 11.1). When you connect, Tailzu also sends Google your Tailzu account ID, which Google sends straight back so we know the sign-in is yours.</li>
  <li><strong>Nowhere else.</strong> When a change is waiting for your OK, the notification on your phone names only the app. Apart from Supabase, which stores what 11.4 lists, no one else receives your Google data.</li>
</ul>

<h3>11.4 What we keep</h3>
<ul>
  <li><strong>Your access to each app.</strong> The keys Google gives Tailzu for an app ("tokens") are encrypted (AES-256-GCM) before they are stored, and kept until you disconnect that app or delete your account. If Tailzu stops offering an app you connected, its keys are no longer used, and they are deleted when you delete your account, or sooner if you email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</li>
  <li><strong>Your Tasks list.</strong> For each request that used an app: the first 80 characters of what you asked, and short steps like "Google Calendar: list events", so you can see what Tailzu did. Only you can see it in Tailzu.</li>
  <li><strong>A change waiting for your OK</strong> keeps its details, which can include what Tailzu read in Google to show it to you (an event's title, time and guests, or the name of a task, task list or sheet), until you tap Approve or Not now. Then they are deleted. If you never answer, they stay until you delete your account.</li>
  <li><strong>A record of each action:</strong> which app and action, whether it ran, failed or you said no, and when. It holds nothing that was read or written.</li>
  <li><strong>Your recent requests, on your phone.</strong> The first 80 characters of what you asked and how it ended, for 30 days, shown in Activity on the You tab; and, when a request failed having changed nothing, your words for a day, for Try again. Only you can see them in Tailzu. How each request went (how it ended, how long it took, how many changes it made) is kept until you delete your account, without your words. None of it holds what Tailzu read in your Google apps.</li>
  <li><strong>Nothing else.</strong> Apart from a change waiting for your OK, what Tailzu reads in your Google apps is used for that one request and not stored, and we do not write it into our logs. On your phone, a question Tailzu asks you back is kept with your request until your next request, and used with it only if that comes within five minutes, so your answer makes sense; then it is deleted. A question that comes after Tailzu read something in a Google app is held only in our server's memory, since it may repeat what was read. Your calendar's time zone is held in memory too, and read from Google again at most once an hour.</li>
</ul>

<h3>11.5 Limited Use</h3>
<p>Tailzu's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. In plain words:</p>
<ul>
  <li>Tailzu uses your Google data only to do what you asked, when you ask.</li>
  <li>The record Tailzu keeps of your requests (see 11.4) says how each one went; it never holds your Google data.</li>
  <li>We never sell it.</li>
  <li>We never use it for advertising, and it is not part of the advertising measurement in 1.6.</li>
  <li>Tailzu does not use it to create, train or improve AI or machine-learning models.</li>
  <li>No one at Tailzu reads it, unless you ask us to (for example, to look into a problem you report), it is needed for security (such as looking into abuse), or the law requires it.</li>
</ul>

<h3>11.6 Disconnecting, and deleting what we keep</h3>
<ul>
  <li><strong>Disconnect an app</strong> in Connected apps in Tailzu. Tailzu deletes its stored access to that app right away and stops using it.</li>
  <li><strong>At Google's end:</strong> Google keeps one permission for all the Google apps you connect to Tailzu. When you disconnect the last of them, Tailzu also asks Google to revoke it. Until then, Google keeps Tailzu's permission for every Google app you connected, including the one you just disconnected, though Tailzu no longer uses it for that app. You can also remove Tailzu yourself at any time in your Google Account (myaccount.google.com/connections), for example if Google could not be reached when you disconnected.</li>
  <li><strong>What stays after you disconnect:</strong> your Tasks list, the record of actions, and any change still waiting for your OK (see 11.4). They are kept until you delete your account. To have them deleted sooner, email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</li>
  <li><strong>Deleting your account</strong> deletes all of it: your access to your Google apps, your Tasks list and the record. It does not tell Google, so disconnect your Google apps first, or remove Tailzu in your Google Account afterwards.</li>
  <li>What Tailzu made or changed in your Google apps (events, Docs, tasks, sheets, forms) is yours. It stays there until you change it in Google.</li>
</ul>

<hr>

<h2>12. Changes to this policy</h2>
<p>We will update this policy when our practices change. We will bump the "Effective" date at the top and, for material changes, notify you in the app or by email.</p>

<hr>

<h2>13. Contact</h2>
<p>Questions or requests: <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a></p>

<p style="color:#6b6b6b; font-size:13px; margin-top:40px;">This policy is available at <code>https://x0bot.com/privacy</code>. The version served by the app matches the version linked in App Store Connect.</p>
`;

export const PRIVACY_POLICY_HTML = siteShell({
  title: "Privacy Policy",
  path: "/privacy",
  description: "What Tailzu collects, why, who processes it, and your rights.",
  ld: [
    pageLd("/privacy", "Tailzu privacy policy", "What Tailzu collects, why, who processes it, and your rights.", { "@type": "WebPage" }),
    crumbsLd([["Tailzu", "/"], ["Privacy", "/privacy"]]),
  ],
  main: `<article class="prose">\n${PRIVACY_POLICY_BODY}\n</article>`,
});
