/**
 * Support — served as HTML at /support (x0bot.com/support, through the site's
 * proxy, like /privacy and /terms).
 *
 * How to reach us, what to put in a message, and short answers to what people
 * ask most. Every answer says only what the product does today: the keyboard's
 * Full Access (policies/privacy.ts, Section 9), the microphone (1.5), connecting
 * GitHub and other apps (Sections 12 and 13), billing and refunds as the Terms
 * say them (terms.ts, 3.4), and deleting an account (deleteAccount.ts). No
 * promise of a reply time: nothing in the product keeps one.
 *
 * Bump SUPPORT_UPDATED when an answer changes.
 */
import { siteShell } from "./shell.js";
import { crumbsLd, pageLd } from "../../seo/head.js";

export const SUPPORT_UPDATED = "October 30, 2026";
export const SUPPORT_EMAIL = "support@x0bot.com";

const mail = (address: string) => `<a href="mailto:${address}">${address}</a>`;

const SUPPORT_BODY = `
<h1>Support</h1>
<p class="effective">Updated: ${SUPPORT_UPDATED}</p>

<h2>Write to us</h2>
<p>Email ${mail(SUPPORT_EMAIL)}. In the app, the same address is under <strong>You, Write to us</strong>. Please write from the email address you sign in to X0 Bot with, so we can find your account.</p>
<p>Help us help you by saying:</p>
<ul>
  <li>which device you use (iPhone, Android, Windows or Mac), and which version of X0 Bot;</li>
  <li>what you were doing, what you expected, and what happened instead;</li>
  <li>roughly when it happened, and in which time zone;</li>
  <li>a screenshot or a short screen recording, if it shows the problem.</li>
</ul>
<p><strong>Never send us</strong> a password, a sign-in code, a payment card number, a UPI PIN, or a key from a bot or a connected app. We will never ask for them.</p>
<p>Other addresses: privacy requests (a copy of your data, a correction, deletion) go to ${mail("privacy@x0bot.com")}; a security problem to ${mail("security@x0bot.com")}; questions about our Terms to ${mail("legal@x0bot.com")}.</p>

<hr>

<h2>Quick answers</h2>

<h3>The keyboard, and Full Access</h3>
<p>On iPhone, switch X0 Bot on in Settings, under Keyboards, and allow <strong>Full Access</strong>. An iPhone keyboard cannot reach the internet without Full Access, and X0 Bot needs the internet to hear you. Without it the keyboard still types. With it, the keyboard sends something only when you tap the mic or ask it to refine; normal typing stays on your phone, and it cannot see password fields. On Android, the app takes you through switching the keyboard on.</p>

<h3>The microphone</h3>
<p>X0 Bot asks for the microphone when you first dictate. If you said no, turn it back on in your phone's settings, under X0 Bot (on a Mac: System Settings, Privacy &amp; Security, Microphone). Your audio is turned into text and then deleted, unless you turn on session history. On iPhone, Flow keeps the microphone ready so you can dictate from the keyboard: iPhone shows the recording indicator the whole time, and Flow ends after a while with nothing said, or when you end it.</p>

<h3>Connecting GitHub and other apps</h3>
<p>Connect apps in X0 Bot under <strong>You, Connected apps</strong>: each one asks you to sign in on its own page, and X0 Bot can then do only what you allowed there. For GitHub, tap <strong>Connect GitHub</strong> in the Code bot and choose which repos X0 Bot may see; it works only in the repos you add as projects. To stop, disconnect the app in Connected apps; for GitHub, also uninstall the X0 Bot app in your GitHub settings, under Applications. Our <a href="https://x0bot.com/privacy#github">Privacy Policy</a> says what each connection reads and keeps.</p>

<h3>Plans, billing and refunds</h3>
<p>What is free, and what plans cost, is at <a href="https://x0bot.com/pricing">x0bot.com/pricing</a>.</p>
<ul>
  <li><strong>Bought in the App Store or Google Play:</strong> manage or cancel it in your App Store or Google Play subscriptions. Refunds for these are decided by Apple or Google under their own policies (for Apple, at reportaproblem.apple.com), not by us.</li>
  <li><strong>Bought on the web or in the desktop app</strong> (paid through Razorpay): cancel it in X0 Bot, under Settings, then Cancel subscription. A subscription bought earlier through Paddle is cancelled from your Paddle receipt or at paddle.net.</li>
  <li>A cancelled subscription stays active until the end of the period already paid for. Purchases are non-refundable, except where the law requires a refund (<a href="https://x0bot.com/terms">Terms</a>, section 3.4).</li>
  <li>New phone? Sign in with the same account you bought with.</li>
</ul>

<h3>Deleting your account</h3>
<p>In the app, open <strong>You, Delete account</strong>. Without the app, go to <a href="https://x0bot.com/delete-account">x0bot.com/delete-account</a> and sign in with your email. Your account is deleted 7 days after you ask, and until then you can sign in and choose <strong>Keep my account</strong>. The page lists what is deleted and what is kept.</p>

<h3>Someone is bothering you in Spaces</h3>
<p>Tap <strong>Report</strong> under the message, on the shared thing, or on their page, and block them if you want to. We act on every report within 24 hours (<a href="https://x0bot.com/terms#objectionable-content">Terms, 4.1</a>).</p>

<h3>Privacy and terms</h3>
<p>What we collect and why is in our <a href="https://x0bot.com/privacy">Privacy Policy</a>; the rules for using X0 Bot are in our <a href="https://x0bot.com/terms">Terms of Service</a>.</p>

<hr>

<p>X0 Bot is made by XOOTEQ LAB PRIVATE LIMITED.</p>
`;

const DESCRIPTION = "How to reach X0 Bot's support, and quick answers about the keyboard, the microphone, connected apps, billing and your account.";

export const SUPPORT_HTML = siteShell({
  title: "Support",
  path: "/support",
  description: DESCRIPTION,
  ld: [
    pageLd("/support", "X0 Bot support", DESCRIPTION, { "@type": "ContactPage" }),
    crumbsLd([["X0 Bot", "/"], ["Support", "/support"]]),
  ],
  main: `<article class="prose">\n${SUPPORT_BODY}\n</article>`,
});
