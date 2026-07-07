/**
 * Terms of Service — served as HTML at /terms.
 *
 * Legal binding document; required by Apple for any app with subscriptions.
 * Bump the effective date if you meaningfully change subscription terms,
 * refund policy, or governing law.
 */
export const TERMS_EFFECTIVE = "July 7, 2026";

export const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Terms of Service — Tailzu</title>
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

<h1>Terms of Service</h1>
<p class="effective">Effective: ${TERMS_EFFECTIVE}</p>

<p>These Terms of Service ("Terms") govern your use of the Tailzu applications, keyboard extension, and related services (collectively, the "Service"). By using the Service you agree to these Terms.</p>

<hr>

<h2>1. Eligibility</h2>
<p>You must be at least 13 years old to use Tailzu. If you are under the age of majority in your jurisdiction, a parent or guardian must accept these Terms on your behalf.</p>

<hr>

<h2>2. Account</h2>
<ul>
  <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
  <li>You are responsible for all activity on your account.</li>
  <li>Notify us at <a href="mailto:security@tailzu.space">security@tailzu.space</a> of any unauthorized use.</li>
  <li>We may suspend or terminate accounts that violate these Terms or applicable law.</li>
</ul>

<hr>

<h2>3. Subscriptions and billing</h2>

<h3>3.1 Purchase</h3>
<p>Certain Tailzu features are available only through a paid subscription. Subscriptions are billed through the Apple App Store or Google Play; you agree to the terms of those stores in addition to these Terms.</p>

<h3>3.2 Auto-renewal (App Store / Google Play required disclosures)</h3>
<ul>
  <li>Payment will be charged to your iTunes Account (iOS) or Google Play account (Android) at confirmation of purchase.</li>
  <li>Subscription automatically renews unless auto-renew is turned off at least 24 hours before the end of the current period.</li>
  <li>Your account will be charged for renewal within 24 hours prior to the end of the current period at the same price of the selected subscription plan.</li>
  <li>Subscriptions may be managed by you and auto-renewal may be turned off by going to your account settings after purchase.</li>
  <li>Any unused portion of a free trial period, if offered, will be forfeited when you purchase a subscription, where applicable.</li>
  <li>You can manage or cancel subscriptions in your device's App Store or Google Play settings.</li>
</ul>

<h3>3.2.1 Current subscription plans</h3>
<p>The current subscription plans, prices, and durations are shown inside the app on the paywall screen and in your device's App Store or Google Play. Plans and prices may change over time; the price you see at purchase is the price you pay.</p>

<h3>3.3 Free trials</h3>
<p>If we offer a free trial, you will not be charged during the trial period. If you do not cancel before the trial ends, you will be automatically billed for the subscription.</p>

<h3>3.4 Refunds</h3>
<p>Subscription refunds are handled by Apple or Google according to their policies. We do not process refunds directly for App Store or Google Play purchases.</p>

<h3>3.5 Price changes</h3>
<p>We may adjust subscription prices from time to time. You will be notified of any material change before it takes effect. Continued use after the change constitutes acceptance.</p>

<hr>

<h2>4. Acceptable use</h2>
<p>You agree not to:</p>
<ul>
  <li>Use the Service to violate any law or regulation</li>
  <li>Send content that is unlawful, harmful, harassing, defamatory, or infringing</li>
  <li>Attempt to reverse-engineer, decompile, or extract source code</li>
  <li>Circumvent security features or rate limits</li>
  <li>Use the Service to build competing products</li>
  <li>Automate account creation or usage in a manner that abuses our infrastructure</li>
  <li>Impersonate any person or entity</li>
</ul>

<hr>

<h2>5. Your content</h2>
<ul>
  <li>You retain ownership of the content you submit to Tailzu.</li>
  <li>You grant Tailzu a limited license to process your content solely to provide the Service (transcribing, refining, storing history if you enable it).</li>
  <li>You are responsible for ensuring you have the right to submit any content you input.</li>
  <li>You warrant that your content does not infringe third-party rights.</li>
</ul>

<hr>

<h2>6. Intellectual property</h2>
<p>Tailzu, including its software, design, and branding, is owned by us. All rights not expressly granted are reserved. You may not copy, modify, distribute, or create derivative works without permission.</p>

<hr>

<h2>7. AI-generated output</h2>
<p>Tailzu uses artificial intelligence to transcribe voice and refine text. AI output may contain errors. You are responsible for reviewing output before relying on it, especially in contexts where accuracy matters (medical, legal, financial). Tailzu does not guarantee that AI output is accurate, complete, or fit for any particular purpose.</p>

<hr>

<h2>8. Service availability</h2>
<p>We aim to keep the Service available but do not guarantee uninterrupted access. We may modify, suspend, or discontinue features at any time. We will make reasonable efforts to notify you of significant changes.</p>

<hr>

<h2>9. Disclaimers</h2>
<p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY.</p>

<hr>

<h2>10. Limitation of liability</h2>
<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, TAILZU AND ITS AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE.</p>
<p>OUR AGGREGATE LIABILITY IN ANY MATTER RELATED TO THE SERVICE SHALL NOT EXCEED THE AMOUNTS YOU PAID US IN THE PRIOR 12 MONTHS OR US$100, WHICHEVER IS GREATER.</p>

<hr>

<h2>11. Indemnification</h2>
<p>You agree to indemnify and hold Tailzu harmless from any claim arising from (a) your use of the Service in violation of these Terms, (b) content you submit, or (c) your violation of any third-party right.</p>

<hr>

<h2>12. Termination</h2>
<ul>
  <li>You may stop using the Service at any time. To delete your account, email <a href="mailto:privacy@tailzu.space">privacy@tailzu.space</a>.</li>
  <li>We may suspend or terminate your access if you violate these Terms.</li>
  <li>On termination, sections that by their nature should survive (IP, disclaimers, limitations, indemnity, governing law) remain in effect.</li>
</ul>

<hr>

<h2>13. Governing law and disputes</h2>
<p><em>NOTE FOR OPERATOR: replace the placeholder below with your registered legal jurisdiction before submitting to the App Store.</em></p>
<p>These Terms are governed by the laws of <strong>India</strong>, without regard to its conflict-of-law rules. Any dispute arising from or relating to these Terms or the Service shall be resolved exclusively in the courts of <strong>Bangalore, India</strong>, unless the App Store's or Google Play's own terms require otherwise for consumer disputes.</p>
<p>If you are a consumer resident in the European Union, United Kingdom, or another jurisdiction whose mandatory consumer-protection laws grant you the right to bring proceedings in the courts of your place of residence, that right is preserved.</p>

<hr>

<h2>14. Apple App Store additional terms</h2>
<p>If you download Tailzu from the Apple App Store, the following additional terms apply. These terms are between you and Tailzu; Apple is not a party to these Terms but is an intended third-party beneficiary and has the right to enforce them against you.</p>

<h3>14.1 Scope of License</h3>
<p>Tailzu grants you a non-transferable license to use the app on any Apple-branded products that you own or control, and as permitted by the App Store Terms of Service. You may not distribute, network, share, or make the app available for use over a network where it could be used by multiple devices at the same time (except as expressly permitted by Apple).</p>

<h3>14.2 Maintenance and support</h3>
<p>Tailzu is solely responsible for providing any maintenance and support services with respect to the app, as specified in these Terms or as required under applicable law. Apple has no obligation whatsoever to furnish any maintenance and support services with respect to the app.</p>

<h3>14.3 Warranty</h3>
<p>Tailzu is solely responsible for any product warranties, whether express or implied by law, to the extent not effectively disclaimed. In the event of any failure of the app to conform to any applicable warranty, you may notify Apple, and Apple will refund the purchase price of the app to you. To the maximum extent permitted by applicable law, Apple will have no other warranty obligation whatsoever with respect to the app, and any other claims, losses, liabilities, damages, costs, or expenses attributable to any failure to conform to any warranty will be the sole responsibility of Tailzu.</p>

<h3>14.4 Product claims</h3>
<p>Tailzu, not Apple, is responsible for addressing any claims by you or any third party relating to the app or your possession or use of the app, including but not limited to: (i) product liability claims; (ii) any claim that the app fails to conform to any applicable legal or regulatory requirement; and (iii) claims arising under consumer protection or similar legislation.</p>

<h3>14.5 Intellectual property rights</h3>
<p>In the event of any third-party claim that the app or your possession and use of the app infringes that third party's intellectual property rights, Tailzu, not Apple, will be solely responsible for the investigation, defense, settlement, and discharge of any such intellectual property infringement claim.</p>

<h3>14.6 Legal compliance</h3>
<p>You represent and warrant that (i) you are not located in a country that is subject to a U.S. Government embargo, or that has been designated by the U.S. Government as a "terrorist supporting" country; and (ii) you are not listed on any U.S. Government list of prohibited or restricted parties.</p>

<h3>14.7 Third-party beneficiary</h3>
<p>You acknowledge and agree that Apple, and Apple's subsidiaries, are third-party beneficiaries of these Terms, and that, upon your acceptance of these Terms, Apple will have the right (and will be deemed to have accepted the right) to enforce these Terms against you as a third-party beneficiary thereof.</p>

<h3>14.8 Developer contact</h3>
<p>For questions, complaints, or claims regarding the app, contact:<br>
Tailzu · <a href="mailto:support@tailzu.space">support@tailzu.space</a><br>
Business address: <em>[Add your registered business address before submission.]</em></p>

<hr>

<h2>15. Changes to these Terms</h2>
<p>We may update these Terms from time to time. Material changes will be posted with a new "Effective" date. Continued use after changes take effect constitutes acceptance.</p>

<hr>

<h2>16. Contact</h2>
<p>Questions about these Terms: <a href="mailto:legal@tailzu.space">legal@tailzu.space</a></p>

</body>
</html>`;
