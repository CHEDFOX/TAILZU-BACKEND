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
export const PRIVACY_POLICY_EFFECTIVE = "October 30, 2026";

const PRIVACY_POLICY_BODY = `
<h1>Privacy Policy</h1>
<p class="effective">Effective: ${PRIVACY_POLICY_EFFECTIVE}</p>

<p>X0 Bot (also referred to as "we", "our", "us") builds a voice-and-text keyboard that transcribes your speech, refines your writing, and helps you communicate, along with bots that can work for you in the apps you connect, and Spaces for sharing with family and friends. This Privacy Policy explains what personal information we collect through the X0 Bot iOS, Android and desktop apps, the keyboard extension and our website (x0bot.com), how we use it, and the choices you have.</p>

<p>By using X0 Bot, you agree to this Privacy Policy. If you do not agree, please do not use the app.</p>

<hr>

<h2>1. Information we collect</h2>

<h3>1.1 Account information</h3>
<ul>
  <li><strong>Email address</strong> (when you sign in with email or Apple ID)</li>
  <li><strong>Phone number</strong> (only if you choose phone sign-in)</li>
  <li><strong>Name</strong> (only if you provide it during onboarding or your Apple ID shares it)</li>
  <li><strong>Language preference</strong> and other in-app settings</li>
</ul>

<h3>1.2 Voice and text you send to X0 Bot</h3>
<p>When you use voice input or the refinement feature, we transmit the audio or text you dictate to our servers and to the AI providers listed below in Section 3 for the purpose of transcription and refinement.</p>
<ul>
  <li><strong>Voice recordings</strong> are processed transiently — sent to a speech-to-text provider, converted to text, and then discarded. We do not permanently store raw audio unless you specifically enable session history in Settings.</li>
  <li><strong>Text you dictate or refine</strong> is used to produce refined output and is saved to your history so you can review it later. You can turn history off, or delete it, in Settings.</li>
  <li><strong>Personality preferences</strong> (tone, vocabulary, personal dictionary) are stored so refinement can match your voice.</li>
  <li><strong>What you ask X0 Bot to do on your phone</strong>: the first 80 characters are kept for 30 days, so the You tab can show your recent requests, and your words for a day when a request failed having changed nothing, so you can try it again with one tap (see 11.4). Of what you ask Ask on your computer, none of your words are kept, apart from your Tasks list (see 11.4).</li>
</ul>

<h3>1.3 Purchase information</h3>
<ul>
  <li><strong>In the iPhone and Android apps</strong>, subscriptions are bought through the Apple App Store or Google Play, which take the payment. RevenueCat manages them for us: it knows your purchases by your X0 Bot account ID, and tells us which plan you have and until when.</li>
  <li><strong>On the web and in the desktop app</strong>, subscriptions are bought at x0bot.com/pay and paid through <strong>Razorpay</strong>. You enter your payment details on Razorpay's own checkout, and Razorpay collects what it needs to take the payment under its own privacy policy. We give Razorpay your X0 Bot account ID, so the subscription is linked to your account, and we keep the subscription's ID, its plan, the market it was sold in (India or elsewhere), its status and the dates it runs to.</li>
  <li><strong>Web subscriptions bought earlier through Paddle</strong> are handled by Paddle, which sold them, under its own privacy policy.</li>
</ul>
<p>We never receive or store your card number, your bank details or your UPI PIN.</p>

<h3>1.4 Device and diagnostic information</h3>
<ul>
  <li><strong>Device model, OS version, app version, language, timezone</strong></li>
  <li><strong>Push notification tokens</strong> (via Apple Push Notification service / Firebase Cloud Messaging) — used to deliver notifications you have opted into</li>
  <li><strong>Advertising identifier</strong> — on Android, the device's advertising ID is read by Meta's SDK to tell whether an install came from one of our ads (see 1.6). You can reset or delete it in Android's settings. On iPhone, X0 Bot never asks for or reads the advertising identifier (IDFA), and shows no tracking prompt.</li>
  <li><strong>Crash reports and error logs</strong> (via Sentry, only if enabled) — used to diagnose and fix bugs</li>
  <li><strong>Usage events</strong> (via PostHog, only if enabled) — anonymous aggregate metrics about which features are used, to guide product improvements</li>
</ul>

<h3>1.5 Data you may choose to share via device permissions</h3>

<p>The app requests OS-level permissions only when you activate a specific feature. If you deny a permission, the related feature is unavailable but the rest of the app functions normally.</p>

<ul>
  <li><strong>Microphone</strong> — required for voice input. Audio is transient and never stored (see 1.2 above). <strong>Flow Sessions:</strong> when you start a Flow session, the microphone stays active in the background — iOS shows the recording indicator the entire time — so you can dictate directly from the X0 Bot keyboard without reopening the app. The session ends automatically after a period of inactivity (about 10 minutes by default) and you can end it at any time from Settings → End Flow session. Outside of an active Flow session or an explicit dictation, the microphone is off.</li>
  <li><strong>Photos</strong> — opened only when you pick a photo, video or file to send to a bot or share in a chat, and written to only when you choose to save a picture or video to your Photos. Only what you pick is sent. We never scan your library in the background.</li>
  <li><strong>Camera</strong> — used only when you choose to take a photo or video to use in the app.</li>
  <li><strong>Face ID / Touch ID / biometric authentication</strong> — used on your device to confirm it's you before a bot does something you approve. Biometric data never leaves your device.</li>
  <li><strong>Clipboard</strong> — read only when you paste into the app. We never read the clipboard in the background.</li>
  <li><strong>Not used:</strong> the app does not ask for your contacts, your device's calendars or reminders, your location, Bluetooth, motion and fitness data, your music library, or the system's speech recognition. Your calendar and to-dos in the app are its own, kept with your account.</li>
</ul>

<h3>1.6 Advertising measurement (Meta)</h3>
<p>We advertise on Facebook and Instagram, and we tell Meta when someone gets and starts using X0 Bot, so we can see which ads work and show them to people likely to find X0 Bot useful. What Meta receives:</p>
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

<h3 id="spaces">1.8 Spaces: messages, shared things, reports and blocks</h3>
<p>In Spaces you can message the people you invite and share things with them. We store your words and a copy of what you share (like a list, a plan, a trip, a note or a link) so the people in that chat or space can see it, until it is taken out or the space or your account is deleted. A photo or file you attach stays one of your files, kept as 1.9 says, and the people there open it through a link that works only for them. Only the people in that chat or space can see what is in it; a bot shared in a space can read what is shared there when someone in the space uses it (see 14.3); and our team sees it only when it is reported to us.</p>
<ul>
  <li><strong>Your name there:</strong> people in your chats and spaces see you by a name made from your email address (the part before the @: meera.rao@… is shown as "Meera R."), or, if you signed in with a phone number, its last four digits.</li>
  <li><strong>Invites:</strong> when you invite someone by email, we keep their address with the invite, to send them that invite.</li>
  <li><strong>Tasks, plans and payment requests:</strong> a task or plan you give someone is kept for the people it is for. A payment request keeps who asked, the payee's name and UPI ID, what it is for, who approved or declined it, and when it was marked paid (and an amount, where an older version of the app sent one). X0 Bot moves no money: approving opens your own UPI app with the payee filled in, and you enter the amount and your PIN there.</li>
  <li><strong>Activity:</strong> a space keeps a log of who joined, shared, asked and paid, which the people allowed to can see.</li>
  <li><strong>Reports:</strong> when you report a message, something shared or a person, we keep the report: who sent it, who and what it is about, the reason, any note, and a copy of what was reported as it was then. It goes to our support team so it can be acted on within 24 hours, and is kept afterwards as a safety record, including after either account is deleted (without the account). The person reported is not told who reported them.</li>
  <li><strong>Blocks:</strong> we keep whom you blocked, and the name they had then, until you unblock them or delete your account.</li>
</ul>

<h3 id="files">1.9 Files and photos you attach</h3>
<p>When you attach a file or a photo (to a message to X0 Bot, to a bot, or in a chat or space), X0 Bot reads it once and keeps what it found, so it can answer from the parts that matter instead of sending the whole file each time.</p>
<ul>
  <li><strong>What is kept:</strong> the file itself (and, for a video, a few still frames from it), stored with Cloudflare (R2) under your account; the text read from it, in pieces, with anything that looks like a password or key left out; and details such as its name, kind, size, pages or length. A photo's hidden details (EXIF and the like, which can include where and when it was taken) are removed before it is stored; a JPEG keeps only which way up it is.</li>
  <li><strong>For how long:</strong> 30 days from when it was first read (sending the same file again starts the 30 days again), unless you choose to keep it. Then the file, its text and its pieces are deleted. A photo or file you sent in a chat or space is one of these files, so once it is deleted it no longer opens for the others either. Deleting your account deletes all of them; to have one deleted sooner, email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</li>
  <li><strong>Who reads it:</strong> documents, spreadsheets, scanned PDFs and videos are read on our own servers, by software that makes no calls out to the internet. The speech in a recording or a video is turned into text by <strong>Deepgram</strong>. A picture (and up to three frames of a video) is described once by an AI model, sent through <strong>OpenRouter</strong> (see Section 3). When you ask about a file, only the pieces that match your question go to the AI model that answers. Nothing in a file is ever run.</li>
</ul>

<hr>

<h2>2. How we use your information</h2>
<ul>
  <li>To provide the core features (transcription, refinement, keyboard, personality)</li>
  <li>To do what you ask in the Google apps you connect, and nothing more (see Section 11)</li>
  <li>To do what you ask in GitHub with the Code bot (Section 12) and in the other apps you connect (Section 13)</li>
  <li>To run the bots you use and make, and to keep what they remember of you (Section 14)</li>
  <li>To read the files and photos you attach (see 1.9)</li>
  <li>To send the notifications and fill the widgets you choose (Section 15)</li>
  <li>To authenticate your account and secure your data</li>
  <li>To process subscriptions and manage entitlements</li>
  <li>To improve the app through anonymous, aggregated usage analytics</li>
  <li>To measure and improve our advertising on Facebook and Instagram (see 1.6)</li>
  <li>To diagnose and fix crashes and bugs</li>
  <li>To comply with legal obligations</li>
</ul>

<hr>

<h2>3. Third parties we use</h2>

<p>X0 Bot depends on the following processors to deliver the service. Each has its own privacy policy.</p>

<h3>Speech-to-text</h3>
<ul>
  <li><strong>OpenAI</strong> (openai.com/policies/privacy-policy) — processes voice for transcription. Voice is transient and not retained. OpenAI also turns text into speech when X0 Bot reads something aloud to you.</li>
  <li><strong>Groq</strong> (groq.com/privacy-policy) — alternative transcription provider.</li>
  <li><strong>Deepgram</strong> (deepgram.com) — live transcription while you dictate, and the speech in recordings and videos you attach (see 1.9).</li>
  <li><strong>Sarvam AI</strong> (sarvam.ai) — transcription made for Indian languages, used depending on the language you speak.</li>
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

<h3>The Code bot and GitHub (see Section 12)</h3>
<ul>
  <li><strong>GitHub</strong> (docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) — holds the repos you connect; X0 Bot reads and writes there as Section 12 says, and GitHub Actions runs the steps X0 Bot gives it in your repo.</li>
  <li><strong>OpenRouter</strong> (openrouter.ai/privacy) — passes the Code bot's work to AI models made by companies such as OpenAI, Anthropic, Google, DeepSeek and Z.ai, chosen by the kind of work, and only to providers that neither keep nor train on what they are sent.</li>
</ul>

<h3>Other apps you connect, and bots (see Sections 13 and 14)</h3>
<ul>
  <li><strong>Each app you connect</strong> (for example Notion, Linear or Todoist) receives what X0 Bot reads or writes there for you, and handles it under its own privacy policy.</li>
  <li><strong>OpenRouter</strong> — passes a bot's work to AI models made by companies such as OpenAI, Anthropic, Google, DeepSeek and Z.ai, only to providers that neither keep nor train on what they are sent. The models in "Google apps you connect" above work out what to do in the apps you connect when you ask X0 Bot itself.</li>
  <li><strong>Search and map services</strong> — when a bot searches the web, the words it searches for go to search services such as DuckDuckGo and Brave Search, and it reads public web pages; when the Plan or Travel bot works out a place or a travel time, the places go to map services built on OpenStreetMap. None of them is sent your account.</li>
</ul>

<h3>Files you attach (see 1.9)</h3>
<ul>
  <li><strong>Cloudflare</strong> (cloudflare.com/privacypolicy) — stores the files and photos you attach (R2).</li>
  <li><strong>Deepgram</strong> — turns the speech in them into text. <strong>OpenRouter</strong> — passes a picture to the AI model that describes it.</li>
</ul>

<h3>Authentication and database</h3>
<ul>
  <li><strong>Supabase</strong> (supabase.com/privacy) — hosts your account, profile, the record of your requests to Ask (see Section 4), your history (unless you turn it off), and the other things this policy says we keep, in secure managed Postgres.</li>
  <li><strong>Apple Sign In / Google Sign In</strong> — used only if you choose these methods; each provider shares only the fields you authorize.</li>
</ul>

<h3>Purchases (see 1.3)</h3>
<ul>
  <li><strong>RevenueCat</strong> (revenuecat.com/privacy) — manages App Store and Google Play subscriptions, by your X0 Bot account ID.</li>
  <li><strong>Apple App Store / Google Play</strong> — process the actual payment for subscriptions bought in the apps.</li>
  <li><strong>Razorpay</strong> (razorpay.com/privacy) — processes payment for subscriptions bought on the web or in the desktop app; receives your X0 Bot account ID from us, and your payment details from you.</li>
  <li><strong>Paddle</strong> (paddle.com/legal/privacy) — sold, and still handles, web subscriptions bought earlier through it.</li>
</ul>

<h3>Notifications (see Section 15)</h3>
<ul>
  <li><strong>Expo</strong> (expo.dev/privacy) — our servers send notifications through Expo's push service, with the notification's words and your phone's push token.</li>
  <li><strong>Apple Push Notification service / Firebase Cloud Messaging</strong> — deliver them to your iPhone or Android phone.</li>
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
  <li><strong>History:</strong> kept by default so you can review it; you can turn it off in Settings. Stored until you delete it or your account.</li>
  <li><strong>Ask:</strong> what it reads off your screen, and any picture it sends, is not stored. See Section 10.</li>
  <li><strong>The record of your requests to Ask:</strong> how each one went (done, waiting for you, or stopped, and why), how long it took, how many steps and changes it made, and which AI model answered and what that cost. It is kept until you delete your account, and holds none of your words, except from your phone: the first 80 characters of what you asked, for 30 days; your words to try again with, for a day; and a question X0 Bot asks you back, with your request, for five minutes. See 10.4 and 11.4.</li>
  <li><strong>Google apps you connect:</strong> what X0 Bot reads in them is not stored, except the details of a change waiting for your OK. Your access to an app is kept until you disconnect it or delete your account; your Tasks list and its record of actions, until you delete your account. See Section 11.</li>
  <li><strong>Other apps you connect:</strong> the same as for Google apps. See Section 13.</li>
  <li><strong>The Code bot:</strong> your GitHub link, projects, jobs and what X0 Bot learned of your repos are kept until you remove the project, unlink GitHub in X0 Bot, or delete your account. A token from Sign in with GitHub is kept until you disconnect, delete your account, or leave it unused for 30 days. See Section 12.</li>
  <li><strong>Files and photos you attach:</strong> 30 days from when they were first read, unless you choose to keep them. See 1.9.</li>
  <li><strong>Bots:</strong> the bots you make, your chats with them (the last 200 turns with each) and what they remember of you are kept until you delete them or your account; activity entries older than 90 days are deleted whenever a new one is added. See Section 14.</li>
  <li><strong>Widgets and notifications:</strong> a widget's key lasts a day; the outcome of an answer given from a widget or a notification is kept for seven days. See Section 15.</li>
  <li><strong>Purchases:</strong> our record of a subscription is kept until you delete your account. See 1.3.</li>
  <li><strong>Account:</strong> kept until you delete it. When you choose Delete account in the app, your account and everything kept with it are deleted 7 days later. Until then nothing is removed and your bots stop working; sign in and choose Keep my account to keep it as it was. Where the app says deleting cannot be undone, it is deleted straight away. You can also ask for deletion without the app, by signing in with your email at <a href="https://x0bot.com/delete-account">x0bot.com/delete-account</a>, which lists what is deleted and what is kept. Messages you sent in chats with other people stay in those chats for them, under the name you had; reports (see 1.8) are kept as a safety record; and the app stores and payment processors keep their own records of purchases.</li>
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

<p><strong>Deleting your account:</strong> in the app, under You, Delete account; or on the web, without the app, at <a href="https://x0bot.com/delete-account">x0bot.com/delete-account</a>.</p>

<p>To exercise any of these rights, contact us at <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>. We respond within 30 days (45 for CCPA requests, with a possible 45-day extension where permitted). We may request information to verify your identity before processing.</p>

<hr>

<h2>6. Data security</h2>
<ul>
  <li>All communication with X0 Bot servers uses TLS (HTTPS).</li>
  <li>Data at rest is encrypted by our infrastructure providers.</li>
  <li>The keys that let X0 Bot into the apps you connect, and a token from Sign in with GitHub, are encrypted again (AES-256-GCM) before they are stored. A bot's API keys and a widget's key are stored only as one-way hashes.</li>
  <li>Access to personal data is restricted to necessary personnel.</li>
  <li>We follow industry-standard security practices, but no service can guarantee absolute security.</li>
</ul>

<hr>

<h2>7. Children</h2>
<p>X0 Bot is not directed at children under 13. We do not knowingly collect personal information from anyone under 13. If we learn we have, we will delete it.</p>

<hr>

<h2>8. International data transfers</h2>
<p>X0 Bot is operated globally. Data may be processed in the United States and other countries where our providers operate. Where required by law (GDPR), we rely on Standard Contractual Clauses.</p>

<hr>

<h2>9. Keyboard extension privacy</h2>
<p>The X0 Bot keyboard extension is a separate iOS/Android app extension with restricted sandboxing:</p>
<ul>
  <li>The keyboard only sends data to our servers when you explicitly invoke voice or refine actions.</li>
  <li>Normal typing stays on-device and is never transmitted.</li>
  <li>The keyboard cannot see content from secure text fields (passwords, PINs).</li>
  <li>Full Access is only required for voice + refinement features that need network. Without Full Access, the keyboard still functions for regular typing.</li>
</ul>

<hr>

<h2>10. Ask, on the desktop app</h2>
<p>Ask is the helper in the X0 Bot desktop app for Mac and Windows. Tap its key twice and say something about the app in front of you ("where's Export?", "explain this chart"), and it points at the thing, explains it, or does a small job for you. It reads the screen when you call it up, and again after each thing it does for you, to see what changed.</p>

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
  <li><strong>The names of your files, only when you ask Ask about them:</strong> when you ask Ask to find, sort or tidy files, your computer does the work, only inside the folders you allowed (Downloads, Desktop and Documents unless you change them in Settings), and never in system, app or hidden folders. For a question about your files, the file names, sizes, kinds and dates it needs are sent to the AI model that plans the answer; what is inside a file never leaves your computer, and X0 Bot does not store the names. Moving something to the Trash always asks first.</li>
  <li><strong>One picture, only when a question needs it and you have allowed it:</strong> a picture of the part of the screen your question is about (the image or chart, or else the window), cut on your computer to below the window's title bar and a browser's tabs and address bar, where it finds them, and no more than 1,024 pixels on its longer side by default. Before one is sent, Ask asks: Allow once, Always for that app (where the app can be named), or Not now. It does not ask again for an app you said Always to, nor at all once you have said yes for every app in the X0 Bot app's Ask setup (see 10.5). Ask's card shows a note when a picture goes with a question.</li>
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
  <li><strong>X0 Bot does not store the picture and does not log it.</strong> It is held in memory only while your question is answered. Our logs record that a picture went with a question, its size in bytes, whether it was of one image or the whole window, and which model and provider answered; never the picture or the text on your screen.</li>
  <li>Ask writes nothing to your History. As with dictation, your usage counts the words Ask writes for you and the seconds you spoke, and we keep a count, in memory, of the pictures sent in the past day, for the daily limit.</li>
  <li>X0 Bot keeps a record of each request to Ask on your computer: how it ended and why, how many steps it took and how long, how many things it changed, and which AI model answered and what that cost. It holds nothing you said and nothing from your screen.</li>
</ul>

<h3>10.5 How to turn it off</h3>
<ul>
  <li><strong>Each time:</strong> answer Not now when Ask asks to look, and no picture is sent.</li>
  <li><strong>For one app:</strong> an app you said Always to is listed in the X0 Bot menu (the menu bar on a Mac, the system tray on Windows), where you can have Ask ask again for it, or for all of them.</li>
  <li><strong>For every app:</strong> in the X0 Bot app, "Look at the screen when it's needed" (on the home page until it is set up, and always in Settings under Ask) lets Ask look without asking each time. Turn it off there, and Ask goes back to asking first, except in the apps you said Always to. Signing out turns it off and forgets every Always.</li>
  <li><strong>Altogether, on a Mac:</strong> without the Accessibility permission Ask cannot read an app's buttons, fields and text, and without Screen Recording it cannot see the window's pixels or take a picture of them; with both off, it reads nothing on your screen. You can turn either off at any time in System Settings &rarr; Privacy &amp; Security.</li>
</ul>

<hr>

<h2 id="google-user-data">11. Google apps you connect</h2>
<p>You can connect Google apps to X0 Bot: Google Calendar, Google Docs, Google Tasks, Google Sheets, Google Forms and Google Classroom. Then you can ask X0 Bot, on your phone or with Ask on your computer, to do things in them for you. You connect each app yourself, in Connected apps in X0 Bot: tap Connect, and Google asks whether to allow it. This section says what X0 Bot reads and changes in those apps, where that goes, what we keep, and how to end it.</p>

<h3>11.1 What X0 Bot does in each app</h3>
<p>Google asks you for an app's permissions only when you tap Connect on it, and X0 Bot connects only if you allow all of them. Signing in to X0 Bot with Google never asks for them. Connecting does not give X0 Bot your Google account's name or email address.</p>
<ul>
  <li><strong>Google Calendar</strong> — reads your events (their titles, times, and guests' names and email addresses), when you are free or busy, and your calendar's time zone. It adds, moves or cancels an event when you ask. If the event has guests, Google emails them the invite, the new time or the cancellation.</li>
  <li><strong>Google Docs</strong> — makes a new Doc from your words, or from one of your X0 Bot meeting notes (its summary, key points and people, or its transcript if it has no summary). It does not read your Docs. Google lets it reach only the files X0 Bot made, never the rest of your Drive.</li>
  <li><strong>Google Tasks</strong> — reads your task lists and tasks. It adds a task, ticks one off or deletes one when you ask.</li>
  <li><strong>Google Sheets</strong> — makes a sheet, adds rows to one, or reads one back. Google lets it reach only the sheets X0 Bot made.</li>
  <li><strong>Google Forms</strong> — makes a form with your questions and publishes it, and reads the answers people send: the totals for each choice and the latest three answers. Google lets it reach only the forms X0 Bot made. Those answers are other people's, and everything in this section applies to them too.</li>
  <li><strong>Google Classroom</strong> — only reads: your classes, the classwork that is due and whether you turned it in (with your grade, once it is returned), and your classes' latest announcements. It never changes anything in Classroom.</li>
</ul>
<p><strong>Gmail and Google Maps are not connected apps.</strong> When you ask X0 Bot to write an email, it opens Gmail's own compose window with the email written, for you to check and send yourself. When you ask for directions, it opens Google Maps. X0 Bot has no access to either, and it reads none of your email.</p>
<p><strong>YouTube is not a connected app either.</strong> When you ask X0 Bot to find a video, it sends only the words to search for to Google's YouTube Data API, with X0 Bot's own key (or, when it can't, opens YouTube's own search on your device). There is no sign-in, and nothing from your Google account is read or changed.</p>

<h3>11.2 Only when you ask</h3>
<ul>
  <li>X0 Bot reaches into a Google app only to do what you just asked for. It never looks around in your apps on its own, in the background or on a schedule.</li>
  <li><strong>Looking something up</strong> (your calendar, your tasks, a sheet, a form's answers, your classes) happens right away.</li>
  <li><strong>Changes wait for your OK.</strong> The first time X0 Bot makes a kind of change in an app (adding an event, adding a task), it shows you a card with the exact change, and nothing happens until you tap Approve; tap Not now, and nothing is done. Once you approve, X0 Bot makes that kind of change in that app without asking again. Deleting always asks, every time. You choose how far X0 Bot can go in each app (Can look, Can draft or Can send): at Can draft every change asks, and at Can look X0 Bot changes nothing.</li>
</ul>

<h3>11.3 Where your Google data goes</h3>
<ul>
  <li><strong>To the AI model that works out the next step.</strong> What X0 Bot reads in a Google app, at most 1,500 characters at a time, goes from our server with your request through <strong>OpenRouter</strong> to the AI model that answers you: <strong>OpenAI's</strong> model first; <strong>Anthropic's Claude</strong> if that fails; and if that fails too, the model that refines your dictation (see Section 3). With Ask on your computer, the text list of your screen goes with it (see 10.2). X0 Bot tells OpenRouter to use only providers that do not collect it to train models (OpenRouter's data-collection setting is off for every one of these requests). OpenRouter and the model's provider handle it under their own privacy policies, which may let them keep it for a short time after X0 Bot has dropped it.</li>
  <li><strong>To you.</strong> X0 Bot's answer, and the card asking for your OK, are shown in X0 Bot on your phone or computer.</li>
  <li><strong>To Google.</strong> What you asked X0 Bot to write there: an event and its guests' email addresses, a Doc with your words or your meeting note, a task, rows in a sheet, a form's questions; and the words of a YouTube search (see 11.1). When you connect, X0 Bot also sends Google your X0 Bot account ID, which Google sends straight back so we know the sign-in is yours.</li>
  <li><strong>Nowhere else.</strong> When a change is waiting for your OK, the notification on your phone names only the app. Apart from Supabase, which stores what 11.4 lists, no one else receives your Google data.</li>
</ul>

<h3>11.4 What we keep</h3>
<ul>
  <li><strong>Your access to each app.</strong> The keys Google gives X0 Bot for an app ("tokens") are encrypted (AES-256-GCM) before they are stored, and kept until you disconnect that app or delete your account. If X0 Bot stops offering an app you connected, its keys are no longer used, and they are deleted when you delete your account, or sooner if you email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</li>
  <li><strong>Your Tasks list.</strong> For each request that used an app: the first 80 characters of what you asked, and short steps like "Google Calendar: list events", so you can see what X0 Bot did. Only you can see it in X0 Bot.</li>
  <li><strong>A change waiting for your OK</strong> keeps its details, which can include what X0 Bot read in Google to show it to you (an event's title, time and guests, or the name of a task, task list or sheet), until you tap Approve or Not now. Then they are deleted. If you never answer, they stay until you delete your account.</li>
  <li><strong>A record of each action:</strong> which app and action, whether it ran, failed or you said no, and when. It holds nothing that was read or written.</li>
  <li><strong>Your recent requests, on your phone.</strong> The first 80 characters of what you asked and how it ended, for 30 days, shown in Activity on the You tab; and, when a request failed having changed nothing, your words for a day, for Try again. Only you can see them in X0 Bot. How each request went (how it ended, how long it took, how many changes it made) is kept until you delete your account, without your words. None of it holds what X0 Bot read in your Google apps.</li>
  <li><strong>Nothing else.</strong> Apart from a change waiting for your OK, what X0 Bot reads in your Google apps is used for that one request and not stored, and we do not write it into our logs. On your phone, a question X0 Bot asks you back is kept with your request until your next request, and used with it only if that comes within five minutes, so your answer makes sense; then it is deleted. A question that comes after X0 Bot read something in a Google app is held only in our server's memory, since it may repeat what was read. Your calendar's time zone is held in memory too, and read from Google again at most once an hour.</li>
</ul>

<h3>11.5 Limited Use</h3>
<p>X0 Bot's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. In plain words:</p>
<ul>
  <li>X0 Bot uses your Google data only to do what you asked, when you ask.</li>
  <li>The record X0 Bot keeps of your requests (see 11.4) says how each one went; it never holds your Google data.</li>
  <li>We never sell it.</li>
  <li>We never use it for advertising, and it is not part of the advertising measurement in 1.6.</li>
  <li>X0 Bot does not use it to create, train or improve AI or machine-learning models.</li>
  <li>No one at X0 Bot reads it, unless you ask us to (for example, to look into a problem you report), it is needed for security (such as looking into abuse), or the law requires it.</li>
</ul>

<h3>11.6 Disconnecting, and deleting what we keep</h3>
<ul>
  <li><strong>Disconnect an app</strong> in Connected apps in X0 Bot. X0 Bot deletes its stored access to that app right away and stops using it.</li>
  <li><strong>At Google's end:</strong> Google keeps one permission for all the Google apps you connect to X0 Bot. When you disconnect the last of them, X0 Bot also asks Google to revoke it. Until then, Google keeps X0 Bot's permission for every Google app you connected, including the one you just disconnected, though X0 Bot no longer uses it for that app. You can also remove X0 Bot yourself at any time in your Google Account (myaccount.google.com/connections), for example if Google could not be reached when you disconnected.</li>
  <li><strong>What stays after you disconnect:</strong> your Tasks list, the record of actions, and any change still waiting for your OK (see 11.4). They are kept until you delete your account. To have them deleted sooner, email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a>.</li>
  <li><strong>Deleting your account</strong> deletes all of it: your access to your Google apps, your Tasks list and the record. It does not tell Google, so disconnect your Google apps first, or remove X0 Bot in your Google Account afterwards.</li>
  <li>What X0 Bot made or changed in your Google apps (events, Docs, tasks, sheets, forms) is yours. It stays there until you change it in Google.</li>
</ul>

<hr>

<h2 id="github">12. The Code bot and GitHub</h2>
<p>The Code bot works on code in your GitHub repos: it reads a repo, makes changes on a branch of its own, and opens a pull request for you to review. You connect GitHub yourself, in X0 Bot. This section says what it can reach, what it does there, where your code goes, what we keep, and how to end it.</p>

<h3>12.1 How it connects, and to which repos</h3>
<ul>
  <li><strong>The X0 Bot GitHub App.</strong> You install it on GitHub and choose which repos it can see: all of an account's repos, or only the ones you select. X0 Bot works only in the repos you then add as projects in X0 Bot. In an organisation's repos, or another person's, it works only where GitHub says you can write, and an organisation's owner may have to approve the install first.</li>
  <li><strong>What the App is allowed to do</strong>, as GitHub shows you when you install it: read and write a repo's contents (its files, branches and commits), its pull requests and its workflow files; read its GitHub Actions runs, checks and commit statuses, and its basic details; and, if the App asks for it, read its deployments, to show a preview link. It also has GitHub's Administration permission, which X0 Bot uses only to make a new repo when you ask for one. GitHub tells X0 Bot when a pull request, a review, a comment, a check, a status or a push changes in those repos, and when the App is uninstalled or loses a repo. The App is given no access to issues, to the repos' secrets, or to your GitHub account's own settings.</li>
  <li><strong>Sign in with GitHub</strong>, where X0 Bot offers it instead of the App: you sign in on GitHub, and X0 Bot receives a GitHub token of yours that can reach every repo you can (GitHub's "repo" and "read:user" permissions, and "workflow" only if you allow that too). X0 Bot still uses it only in the repos you add as projects, and asks GitHub whether you can still push before every change.</li>
  <li><strong>A new repo.</strong> When you ask X0 Bot to make a repo, GitHub asks you to confirm; the repo is made on your own account, with the name you gave, private unless you chose public, and added as a project.</li>
</ul>

<h3>12.2 What it reads and what it writes</h3>
<ul>
  <li><strong>It reads</strong> a project's files, branches, commits and pull requests, reviewers' comments on its pull requests, and what checks and CI say about them (with the end of a failing job's log). When you add a project, X0 Bot reads the repo to learn its layout, and reads the changed files again when its default branch moves.</li>
  <li><strong>It does on its own:</strong> makes a branch for a task (named <code>tailzu/…</code>), commits to that branch, opens a draft pull request, brings its own branch up to date with the default branch, and comments on its own pull requests. Its commits name the bot as their author and you as co-author.</li>
  <li><strong>It asks you first</strong> before it commits or pushes to any other branch (the default branch included), merges a pull request, marks one ready for review, closes one, deletes a branch, changes a workflow file, or adds a first file to an empty repo. A force-push, deleting the default branch, and a commit with something in it that looks like a password or key ask every time, with Face ID on your phone. For a project, you can answer "always" or "never" for an action that asks (except those three), and take it back at any time. When nobody is there to answer, the work waits for you.</li>
  <li><strong>It never</strong> deletes a repo, writes outside the repo, or works around GitHub's branch protection.</li>
  <li><strong>Pull requests you hand over.</strong> If you ask X0 Bot to look after a pull request, it may push fixes to that pull request's branch, answer reviewers' comments and keep one status comment up to date there, without asking each time.</li>
  <li><strong>Running commands.</strong> A step that needs a computer (installing, building, testing) runs on one of your own computers with the X0 Bot desktop app, where you have allowed it there; or on GitHub's own computers (GitHub Actions), in your repo. For that, X0 Bot makes a temporary branch (named <code>tailzu-run/…</code>) holding a small workflow, the step's commands and a script, and deletes it afterwards. It uses your account's GitHub Actions minutes, and in a public repo anyone can see that branch while it exists. You can tell X0 Bot not to use GitHub's computers. A computer that runs commands is given access that can only read the repo; X0 Bot commits the changes itself, under the rules above.</li>
</ul>

<h3>12.3 Where your code goes</h3>
<ul>
  <li><strong>To AI models.</strong> To do the work, X0 Bot sends your task, parts of your files, and what commands printed, through <strong>OpenRouter</strong>, to AI models made by companies such as OpenAI, Anthropic, Google, DeepSeek and Z.ai, chosen by the kind of work. X0 Bot tells OpenRouter to use only providers that neither keep nor train on what they are sent, and names you to OpenRouter only by a one-way hash, never your account ID. OpenRouter and the model's provider handle it under their own privacy policies.</li>
  <li><strong>To GitHub.</strong> What X0 Bot writes goes into your repo. Its pull requests include a log of what it did.</li>
  <li><strong>Secrets.</strong> Before anything is committed, kept in our records or put in a pull request, X0 Bot looks in it for passwords, keys and tokens. A commit with one asks you every time, and our records keep a note in its place. This check can miss things, so do not put secrets in your code.</li>
  <li><strong>Not into our logs.</strong> Nothing that was sent to the AI models, or came back from them, is written to our logs.</li>
</ul>

<h3>12.4 What we keep</h3>
<ul>
  <li><strong>Your GitHub link:</strong> for each install you link, the account it is on, whether it sees all or some of its repos, and your GitHub ID and username. With the App we keep no GitHub token: one is made when X0 Bot needs to act in a repo, lasts under an hour, and is held only in our server's memory. With Sign in with GitHub, your token is kept, encrypted (AES-256-GCM); it is never shown to anyone, and never given to the AI models or to a computer that runs commands.</li>
  <li><strong>Your projects:</strong> the repos you added; for each branch X0 Bot made, its name, the first 200 characters of the task it was made for, the commit it started from, its pull request and where it is in its life; the pull requests it looks after; your settings for each project; and the standing permissions you gave.</li>
  <li><strong>Jobs:</strong> the first 500 characters of each task, the commands run, the last 8 KB each one printed (with anything that looked like a secret taken out), how long they ran, what the job cost, and a log of what X0 Bot did. A job's record also holds the changes it was making and parts of the files it last read, so it can carry on, or go back a step, and keeps them after the job ends.</li>
  <li><strong>What X0 Bot learned of a repo:</strong> its files' paths, languages and sizes, the names of their functions and other parts, which files use which, a short summary of each written by an AI model, the text its screens show people (without anything that looked like a secret), its commands and conventions, and the names (never the values) of its settings. Not a copy of your files.</li>
  <li><strong>Talking about your code:</strong> a short running summary of each conversation (up to 2,000 characters) and the files and lines the last answer pointed to; and your answers to the questions a new project is asked.</li>
  <li><strong>Usage:</strong> per month, the GitHub Actions minutes X0 Bot used for you and whether your free minutes ran out, and what your jobs cost.</li>
</ul>

<h3>12.5 How long, and how to end it</h3>
<ul>
  <li>All of 12.4 is kept until you remove the project, unlink GitHub in X0 Bot, or delete your account, and then deleted. Removing a project deletes its branches' records, its jobs and what was learned of it.</li>
  <li><strong>Unlinking in X0 Bot</strong> forgets the install and its projects here, but does not uninstall the App from GitHub: X0 Bot shows you the GitHub page where you do that. Uninstalling the App on GitHub, or taking a repo off it, removes them from X0 Bot as well.</li>
  <li><strong>Sign in with GitHub:</strong> disconnecting it in X0 Bot, deleting your account, or leaving it unused for 30 days revokes your token at GitHub and deletes it. You can also revoke it yourself in your GitHub settings, under Applications.</li>
  <li><strong>Deleting your X0 Bot account</strong> does not uninstall the App from GitHub; do that on GitHub.</li>
  <li>What X0 Bot wrote in your repos (branches, commits, pull requests, comments and repos it made) is yours, and stays on GitHub until you change it there.</li>
</ul>

<hr>

<h2 id="connected-apps">13. Other apps you connect, and apps X0 Bot opens for you</h2>
<p>Besides Google's (Section 11), X0 Bot can connect to other apps, for example Notion, Linear or Todoist. Which ones you can connect is listed in Connected apps in X0 Bot, and changes over time.</p>

<h3>13.1 How they connect</h3>
<ul>
  <li>You connect each app yourself: tap Connect, sign in on the app's own page, and allow X0 Bot there. X0 Bot then works in the app through the connection the app itself offers to AI assistants (its "MCP server").</li>
  <li>Zapier connects with a private link you copy from your Zapier account instead. That link is a key to your account, and we treat it as one.</li>
  <li>Where X0 Bot lets you add an app by its address, it treats that app as one nobody at X0 Bot has checked: anything it can do that is not plainly a read asks you first, and you choose for each of its actions whether it may run, asks first, or is off.</li>
</ul>

<h3>13.2 What X0 Bot does there</h3>
<ul>
  <li>As with Google apps, X0 Bot uses a connected app only to do what you asked, or what a bot you use was asked (Section 14), when it is asked. Looking something up happens right away.</li>
  <li>You choose how far X0 Bot can go in each app: Can look (it only reads), Can draft (every change asks first, and nothing can be sent, deleted or paid) or Can send. A new connection starts at Can send. At Can send, the first time X0 Bot makes a kind of change or sends something in an app, it shows you the exact change and waits for your yes; once you approve, it does that kind of thing in that app without asking again. Deleting and paying ask every time.</li>
  <li>X0 Bot tells reading, changing, sending, deleting and paying apart from what each app says about its actions and their names. An app can describe its own actions wrongly, so check what a card asks you to approve.</li>
</ul>

<h3>13.3 Where the data goes, and what we keep</h3>
<ul>
  <li>What X0 Bot reads in a connected app, at most 1,500 characters at a time, goes to the AI model that works out the next step, as in 11.3 (or, for a bot, as in 14.4). What you asked X0 Bot to write goes to that app. Each app handles your data under its own terms and privacy policy.</li>
  <li>We keep the same as for Google apps (11.4): your access to each app (its keys, or Zapier's private link, encrypted with AES-256-GCM), your Tasks list, the details of a change waiting for your OK until you answer it, and a record of each action, which holds nothing that was read or written.</li>
</ul>

<h3>13.4 Disconnecting</h3>
<ul>
  <li><strong>Disconnect an app</strong> in Connected apps in X0 Bot: X0 Bot deletes its stored access to that app right away and stops using it. Unlike Google, the app is not told; to end X0 Bot's access at the app's end too, remove X0 Bot in that app's own settings.</li>
  <li>Your Tasks list and the record of actions stay until you delete your account, as in 11.6. Deleting your account deletes all of it, but does not tell the apps.</li>
</ul>

<h3>13.5 Apps X0 Bot opens for you</h3>
<p>Some apps are not connected at all. X0 Bot opens them on your device with something filled in, for you to finish there: a WhatsApp, Telegram or text message, an email in Gmail or a Threads post for you to send; a call for you to start; a UPI payment for you to check and pay in your own UPI app, with your own PIN; or directions in Google Maps, a ride in Uber, hotels on Booking.com, or a search on Amazon, Flipkart, YouTube, YouTube Music or Spotify. What was filled in goes to that app when it opens. X0 Bot has no access to those apps or your accounts there, and never sends or pays for you.</p>

<hr>

<h2 id="bots">14. Bots</h2>
<p>X0 Bot's helpers are bots. The Code bot, Keybot, the Plan bot and the Travel bot come with it, and you can make your own from a sentence. This section says what a bot can do for you, what we keep, and what others can see when you share one.</p>

<h3>14.1 What a bot can do for you</h3>
<ul>
  <li>Only what its skills allow: search the web and read pages, read the files you gave it, make pages and charts, answer questions about your code (only reading it), and use the connected apps you gave it. Changing code is the Code bot's own work (Section 12).</li>
  <li>In a connected app, a bot follows the rules in 13.2: it reads right away, and nothing that changes, sends, deletes or pays happens until you say yes, unless you already allowed that kind of change in that app. A bot is told when something is waiting for you, so it does not say it is done.</li>
  <li>A bot fills in a UPI payment for you to pay in your own UPI app; X0 Bot never moves money.</li>
  <li>When a bot searches the web, the words it searches for go to search services, and it reads public web pages; the Plan and Travel bots send places to map services (see Section 3). Your account is not sent to them.</li>
</ul>

<h3>14.2 What we keep</h3>
<ul>
  <li><strong>The bots you make:</strong> name, purpose, your rules for it, its skills, the apps and files you gave it, its tone, and its spending limits.</li>
  <li><strong>Your chats with a bot:</strong> what you said and what it answered, up to the last 200 turns with each bot, until you clear the chat, delete the bot, or delete your account.</li>
  <li><strong>What a bot remembers of you:</strong> short facts it learned from what you told it (at most 40 a bot; never a feeling, your health, politics, someone else's details or anything secret) and a short running summary of your talks. You can read them, and forget one or all of them, in X0 Bot.</li>
  <li><strong>Activity:</strong> for each answer a bot gave you, which bot, the first 200 characters of what you asked, and what it cost; and for a payment you say you made, which bot filled it in, what it was for, to whom and how much. Entries older than 90 days are deleted whenever a new one is added.</li>
  <li><strong>API keys</strong> you make for a bot are stored only as one-way hashes, with their first few characters so you can tell them apart. What an app sends a bot with a key, and the bot's answers, are not written to our logs, and do not go into the bot's memory of you.</li>
</ul>

<h3>14.3 Sharing a bot</h3>
<ul>
  <li><strong>In a space:</strong> once a bot has been added to a space, it reads the latest things shared there whenever someone in the space who may use its bots uses it.</li>
  <li><strong>In Find a bot:</strong> if you list a bot there, other people see its name, colour, purpose, your rules for it, its tone and the apps it asks for, and your name as 1.8 says it is shown; anyone can add a copy, which becomes their own bot. They never get your files, its memory of you, its keys or its commands. Unlist it to take it down.</li>
  <li><strong>With a key:</strong> anyone who has one of a bot's API keys can ask that bot, and its connected apps then act for you, under the rules in 13.2. Revoke a key in X0 Bot to stop it.</li>
</ul>

<h3>14.4 Where a bot's work goes</h3>
<ul>
  <li>A bot's work goes through <strong>OpenRouter</strong> to AI models made by companies such as OpenAI, Anthropic, Google, DeepSeek and Z.ai, only to providers that neither keep nor train on what they are sent. With your message go the bot's rules, what it remembers of you, the parts of its files that match your question (at most 3,500 characters), and what a connected app or a web page returned.</li>
</ul>

<hr>

<h2 id="lock-screen">15. Widgets, Live Activities, notifications and your Lock Screen</h2>
<p>Some of X0 Bot can be seen without opening it, so anyone who can see your phone may see it too. You choose which of these you use.</p>

<h3>15.1 What can appear</h3>
<ul>
  <li><strong>The Month widget</strong> (Home Screen, and the iPhone Lock Screen): how many words you used or have left this month, and your streak. Never your words.</li>
  <li><strong>The Flow Live Activity</strong> (iPhone Lock Screen and Dynamic Island), while Flow keeps the microphone ready: whether it is ready, listening or writing, and a count of the words so far. Never what you said. Until you finish setting X0 Bot up, a Live Activity may also show your next setup step.</li>
  <li><strong>From your people</strong> (widget): the latest from the people in your spaces and chats: who sent or shared something, the tasks and plans they gave you, and, on the Home Screen, the words of their messages.</li>
  <li><strong>Needs you</strong> (widget): a bot's question with its answers, a change in a connected app waiting for your yes, and the tasks given to you, with buttons to answer them.</li>
  <li>On the iPhone Lock Screen, these two widgets show only a count ("2 new from your people"), and while the phone is locked (StandBy, Always-On) the words of messages and of Needs you are hidden. On Android they are Home Screen widgets, and show what they show to anyone who can see your Home Screen.</li>
  <li><strong>Notifications</strong>, if you allow them: that a bot needs your answer or your OK (one for a connected app names only the app); how a Code bot job is going, with the words of its task; a task or plan someone gave you, with its title; that someone messaged you (their name and the chat, not the message); the reminders you asked for; a daily summary, if you turn it on; and reminders about your words. Your phone's settings decide whether their words show on the Lock Screen.</li>
</ul>

<h3>15.2 Answering without opening the app</h3>
<ul>
  <li>A widget's or a notification's buttons can answer a bot's question, say yes or no to a change waiting in a connected app (never a delete or a payment: those open X0 Bot), mark a task done, or send a reply to a message.</li>
  <li>So that a widget's buttons work while the app is closed, X0 Bot gives your phone a separate key that can do only those things and lasts a day. It is kept on your phone (in the iPhone's Keychain, or the app's private storage on Android), and we keep only a one-way hash of it. Signing out revokes it.</li>
  <li>We keep the outcome of each such answer for seven days, so a button pressed twice acts once.</li>
</ul>

<h3>15.3 Your choices</h3>
<ul>
  <li>Widgets appear only where you add them, and the Flow Live Activity only while Flow is on. Remove them as you would any other.</li>
  <li>Choose which notifications X0 Bot sends, and its quiet hours, in X0 Bot ("What pings you"); turn notifications off, or hide their words on the Lock Screen, in your phone's settings.</li>
  <li>Our servers send notifications through Expo's push service to Apple's and Google's (see Section 3).</li>
</ul>

<hr>

<h2>16. Changes to this policy</h2>
<p>We will update this policy when our practices change. We will bump the "Effective" date at the top and, for material changes, notify you in the app or by email.</p>

<hr>

<h2>17. Contact</h2>
<p>Questions or requests: <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a></p>

<p style="color:#6b6b6b; font-size:13px; margin-top:40px;">This policy is available at <code>https://x0bot.com/privacy</code>. The version served by the app matches the version linked in App Store Connect.</p>
`;

export const PRIVACY_POLICY_HTML = siteShell({
  title: "Privacy Policy",
  path: "/privacy",
  description: "What X0 Bot collects, why, who processes it, and your rights.",
  ld: [
    pageLd("/privacy", "X0 Bot privacy policy", "What X0 Bot collects, why, who processes it, and your rights.", { "@type": "WebPage" }),
    crumbsLd([["X0 Bot", "/"], ["Privacy", "/privacy"]]),
  ],
  main: `<article class="prose">\n${PRIVACY_POLICY_BODY}\n</article>`,
});
