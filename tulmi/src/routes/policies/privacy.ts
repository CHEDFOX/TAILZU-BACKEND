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
export const PRIVACY_POLICY_EFFECTIVE = "July 7, 2026";

export const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Privacy Policy — Tailzu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 28px; margin-bottom: 6px; }
  h2 { font-size: 20px; margin-top: 32px; }
  h3 { font-size: 16px; margin-top: 20px; }
  .effective { color: #6b6b6b; font-size: 14px; margin-bottom: 32px; }
  ul { padding-left: 22px; }
  li { margin-bottom: 6px; }
  a { color: #2563eb; }
  code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #e5e5e5; margin: 32px 0; }
</style>
</head>
<body>

<h1>Privacy Policy</h1>
<p class="effective">Effective: ${PRIVACY_POLICY_EFFECTIVE}</p>

<p>Tailzu (also referred to as "we", "our", "us") builds a voice-and-text keyboard that transcribes your speech, refines your writing, and helps you communicate. This Privacy Policy explains what personal information we collect through the Tailzu iOS and Android apps and keyboard extension, how we use it, and the choices you have.</p>

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
</ul>

<h3>1.3 Purchase information</h3>
<p>If you purchase a subscription, our payment processor (RevenueCat, backed by the Apple App Store or Google Play) provides us a receipt confirming the purchase and its entitlements. We do not receive or store your credit card number.</p>

<h3>1.4 Device and diagnostic information</h3>
<ul>
  <li><strong>Device model, OS version, app version, language, timezone</strong></li>
  <li><strong>Push notification tokens</strong> (via Apple Push Notification service / Firebase Cloud Messaging) — used to deliver notifications you have opted into</li>
  <li><strong>Advertising identifier (IDFA on iOS)</strong> — accessed only if you tap "Allow" on the App Tracking Transparency prompt. Never collected without your explicit opt-in.</li>
  <li><strong>Crash reports and error logs</strong> (via Sentry, only if enabled) — used to diagnose and fix bugs</li>
  <li><strong>Usage events</strong> (via PostHog, only if enabled) — anonymous aggregate metrics about which features are used, to guide product improvements</li>
</ul>

<h3>1.5 Data you may choose to share via device permissions</h3>

<p>The app requests OS-level permissions only when you activate a specific feature. If you deny a permission, the related feature is unavailable but the rest of the app functions normally.</p>

<ul>
  <li><strong>Microphone</strong> — required for voice input. Audio is transient and never stored (see 1.2 above).</li>
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

<h3>1.6 Non-collection notice</h3>
<ul>
  <li>We do NOT collect your typing outside of when you actively invoke the mic or refine actions.</li>
  <li>The keyboard extension respects Apple's and Google's sandboxing — we do not read passwords, PINs, or content from secure text fields.</li>
  <li>We do not sell personal information to third parties.</li>
  <li>We do not share your content with third parties for their independent marketing.</li>
  <li>We do not use your data to train third-party AI models.</li>
  <li><strong>CCPA notice:</strong> in the preceding 12 months we have NOT sold or shared any category of personal information for value.</li>
</ul>

<hr>

<h2>2. How we use your information</h2>
<ul>
  <li>To provide the core features (transcription, refinement, keyboard, personality)</li>
  <li>To authenticate your account and secure your data</li>
  <li>To process subscriptions and manage entitlements</li>
  <li>To improve the app through anonymous, aggregated usage analytics</li>
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

<h3>Authentication and database</h3>
<ul>
  <li><strong>Supabase</strong> (supabase.com/privacy) — hosts your account, profile, and (if opted in) session history in secure managed Postgres.</li>
  <li><strong>Apple Sign In / Google Sign In</strong> — used only if you choose these methods; each provider shares only the fields you authorize.</li>
</ul>

<h3>Purchases</h3>
<ul>
  <li><strong>RevenueCat</strong> (revenuecat.com/privacy) — manages subscriptions.</li>
  <li><strong>Apple App Store / Google Play</strong> — process the actual payment.</li>
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
  <li><strong>Account:</strong> retained until you request deletion.</li>
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

<p>To exercise any of these rights, contact us at <a href="mailto:privacy@tailzu.space">privacy@tailzu.space</a>. We respond within 30 days (45 for CCPA requests, with a possible 45-day extension where permitted). We may request information to verify your identity before processing.</p>

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

<h2>10. Changes to this policy</h2>
<p>We will update this policy when our practices change. We will bump the "Effective" date at the top and, for material changes, notify you in the app or by email.</p>

<hr>

<h2>11. Contact</h2>
<p>Questions or requests: <a href="mailto:privacy@tailzu.space">privacy@tailzu.space</a></p>

<p style="color:#6b6b6b; font-size:13px; margin-top:40px;">This policy is available in machine-readable form at <code>https://api.tailzu.space/privacy</code>. The version served by the app matches the version linked in App Store Connect.</p>

</body>
</html>`;
