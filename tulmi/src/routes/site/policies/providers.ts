/**
 * SERVICE PROVIDERS: every company that processes personal data for X0 Bot, with what it does. Part of the Privacy Policy (its
 * Section 3 describes the groups and links here), served at /privacy/providers. App Review 5.1.1(i) and 5.1.2(i) ask that the
 * policy identify who receives data, third-party AI above all; this page is where it does, so the policy itself reads simply.
 *
 * Keep it true: a provider added or dropped in the code is added or dropped here, and the date moves (PRIVACY_POLICY_EFFECTIVE).
 */
import { crumbsLd, pageLd } from "../../../seo/head.js";
import { PRIVACY_POLICY_EFFECTIVE } from "./privacy.js";
import { siteShell } from "./shell.js";

const BODY = `
<h1>Service providers</h1>
<p class="effective">Part of the <a href="/privacy">X0 Bot Privacy Policy</a>. Effective: ${PRIVACY_POLICY_EFFECTIVE}</p>

<p>These are the companies that process personal data for X0 Bot, and what each one does. Each receives only what it needs for its part of the service, and is bound, by its agreement with us or its own published terms, to protect your data with the same or equal protection as our Privacy Policy. Section numbers below refer to the Privacy Policy.</p>

<h2 id="ai">AI services</h2>
<p>These receive what you say, type or share in X0 Bot, and only after you agree in the app (Privacy Policy, Section 3): <strong>OpenAI</strong>, <strong>Anthropic</strong>, <strong>Google (Gemini)</strong>, <strong>Groq</strong>, <strong>Deepgram</strong>, <strong>Sarvam AI</strong>, and <strong>OpenRouter</strong>, which passes a request to the company that made the model or a cloud service that hosts it (such as DeepSeek, Moonshot AI or Z.ai). What each does:</p>

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

<h3>Xode and GitHub (see Section 12)</h3>
<ul>
  <li><strong>GitHub</strong> (docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) — holds the repos you connect; X0 Bot reads and writes there as Section 12 says, and GitHub Actions runs the steps X0 Bot gives it in your repo.</li>
  <li><strong>OpenRouter</strong> (openrouter.ai/privacy) — passes Xode's work to AI models made by companies such as OpenAI, Anthropic, Google, DeepSeek and Z.ai, chosen by the kind of work, and only to providers that neither keep nor train on what they are sent.</li>
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
  <li><strong>Apple Push Notification service / Firebase Cloud Messaging</strong> — deliver them to your iPhone or Android phone. Our servers also send the Bots at work Live Activity's updates to Apple's service directly (Section 15).</li>
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
`;

export const PROVIDERS_HTML = siteShell({
  title: "Service providers",
  path: "/privacy/providers",
  description: "The companies that process personal data for X0 Bot, and what each one does.",
  ld: [
    pageLd("/privacy/providers", "X0 Bot service providers", "The companies that process personal data for X0 Bot, and what each one does.", { "@type": "WebPage" }),
    crumbsLd([["X0 Bot", "/"], ["Privacy", "/privacy"], ["Service providers", "/privacy/providers"]]),
  ],
  main: `<article class="prose">\n${BODY}\n</article>`,
});
