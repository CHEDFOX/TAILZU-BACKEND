/**
 * Terms of Service — served as HTML at /terms.
 *
 * Legal binding document; required by Apple for any app with subscriptions.
 * Bump the effective date if you meaningfully change subscription terms,
 * refund policy, or governing law.
 */
import { siteShell } from "./shell.js";
import { crumbsLd, pageLd } from "../../seo/head.js";
export const TERMS_EFFECTIVE = "October 30, 2026";

const TERMS_BODY = `
<h1>Terms of Service</h1>
<p class="effective">Effective: ${TERMS_EFFECTIVE}</p>

<p>These Terms of Service ("Terms") govern your use of the X0 Bot applications, keyboard extension, desktop apps, website, bots and related services (collectively, the "Service"). The Service is provided by XOOTEQ LAB PRIVATE LIMITED ("X0 Bot", "we", "us"). By creating an account or using the Service you agree to these Terms. Our <a href="https://x0bot.com/privacy">Privacy Policy</a> says what we do with your information. If you do not agree to these Terms, do not use the Service.</p>

<hr>

<h2>1. Eligibility</h2>
<p>You must be at least 13 years old to use X0 Bot. If you are under the age of majority in your jurisdiction, a parent or guardian must accept these Terms on your behalf. If you use the Service for an organisation, you confirm that you may bind it to these Terms, and "you" includes it.</p>

<hr>

<h2>2. Account</h2>
<ul>
  <li>You are responsible for maintaining the confidentiality of your account credentials, and of any keys you create (such as a bot's API key).</li>
  <li>You are responsible for all activity on your account, including what is done with your keys and by bots acting on your approvals.</li>
  <li>You are responsible for who can see your phone and computer: widgets, Live Activities and notifications can show content on a Lock Screen (Privacy Policy, Section 15).</li>
  <li>Notify us at <a href="mailto:security@x0bot.com">security@x0bot.com</a> of any unauthorized use.</li>
  <li>We may suspend or terminate accounts that violate these Terms or applicable law (see Section 15).</li>
</ul>

<hr>

<h2>3. Subscriptions and billing</h2>

<h3>3.1 Purchase</h3>
<p>Certain X0 Bot features are available only through a paid subscription. In the app, subscriptions are billed through the Apple App Store or Google Play, and you agree to the terms of those stores in addition to these Terms. On the web and in the desktop app, subscriptions are bought at <a href="https://x0bot.com/pay">x0bot.com/pay</a>, and payment is processed by <strong>Razorpay</strong>, whose terms also apply to the payment. Web subscriptions bought earlier through Paddle.com remain subject to Paddle's <a href="https://www.paddle.com/legal/checkout-buyer-terms">Buyer Terms</a>.</p>

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
<p>The current subscription plans, prices, and durations are listed at <a href="https://x0bot.com/pricing">x0bot.com/pricing</a>, and shown inside the app on the paywall screen and in your device's App Store or Google Play. Plans and prices may change over time; the price you see at purchase is the price you pay.</p>

<h3>3.3 Free trials</h3>
<p>If we offer a free trial, you will not be charged during the trial period. If you do not cancel before the trial ends, you will be automatically billed for the subscription.</p>

<h3>3.4 Refunds</h3>
<p>Purchases are non-refundable, except where the law requires a refund. App Store and Google Play purchases are refunded, if at all, by Apple or Google under their own policies; we do not process refunds for them. Web purchases follow our <a href="https://xooteq.com/refunds">Refund Policy</a>. Web subscriptions can be cancelled in X0 Bot, under Settings, then Cancel subscription; one bought earlier through Paddle is cancelled from your Paddle receipt or at <a href="https://paddle.net">paddle.net</a>. A cancelled subscription stays active until the end of the period already paid for.</p>

<h3>3.5 Price changes</h3>
<p>We may adjust subscription prices from time to time. You will be notified of any material change before it takes effect, and in the App Store and Google Play as their rules require. Continued use after the change constitutes acceptance; if you do not accept it, cancel before the change applies to you.</p>

<h3>3.6 Free use, limits and fair use</h3>
<p>Free use and every plan come with limits, for example on words a month, requests, a bot's spending, web searches, files and their size, and the GitHub minutes X0 Bot uses. We set these limits and may change them, including to keep the Service working for everyone. Free features, and features marked as a preview or for testers, may change or end at any time. You must not get around a limit, for example by making several accounts.</p>

<hr>

<h2>4. Acceptable use</h2>
<p>You agree not to, and not to use a bot, a key or a connected app to:</p>
<ul>
  <li>Use the Service to violate any law or regulation</li>
  <li>Send content that is unlawful, harmful, harassing, defamatory, or infringing</li>
  <li>Send spam, or messages, posts, emails or payment requests that the people receiving them did not ask for</li>
  <li>Reach accounts, repos, apps, files or data you are not authorised to use</li>
  <li>Attempt to reverse-engineer, decompile, or extract source code, or the instructions and settings behind our bots</li>
  <li>Scrape, crawl or copy the Service, its content or other people's information by automated means, except through features we provide for it (such as a bot's API key, used as these Terms allow)</li>
  <li>Circumvent security features, rate limits, usage limits or the approvals the Service asks for</li>
  <li>Probe, scan or test the Service for weaknesses, except as we have agreed (report a security issue to <a href="mailto:security@x0bot.com">security@x0bot.com</a>)</li>
  <li>Upload malware, or anything meant to harm the Service, other people or their devices</li>
  <li>Use the Service to build competing products</li>
  <li>Resell or provide the Service to others as a service, except through features we provide for it</li>
  <li>Automate account creation or usage in a manner that abuses our infrastructure</li>
  <li>Rely on the Service where its failure or a wrong answer could lead to death, injury, or serious harm to health, safety or property</li>
  <li>Impersonate any person or entity</li>
</ul>

<h3 id="objectionable-content">4.1 Spaces, messages and what you share: no objectionable content, no abusive users</h3>
<p>In Spaces you can message people and share things with them. There is <strong>no tolerance for objectionable content or abusive users</strong>. You must not send or share anything that is:</p>
<ul>
  <li>harassing, bullying, threatening, or meant to intimidate or shame someone</li>
  <li>hateful, or that attacks people for their race, ethnicity, religion, caste, gender, sexual orientation, disability, or any similar trait</li>
  <li>sexually explicit, or sexual content involving anyone under 18 (which we also report to the authorities)</li>
  <li>violent or graphic, or that encourages self-harm, suicide, terrorism or violence</li>
  <li>spam, a scam or fraud, or malware</li>
  <li>someone else's private information, shared without their permission</li>
  <li>otherwise unlawful, or infringing on anyone's rights</li>
</ul>
<p><strong>Reporting and blocking.</strong> You can report any message, anything shared with you, and any person, from the app: tap <strong>Report</strong> under a message, on a shared thing, or on someone's page (their name in a chat or in a space). You can block anyone, so you no longer see each other's messages and they can no longer message you; unblock them any time in <strong>You, Blocked people</strong>. You can also write to <a href="mailto:support@x0bot.com">support@x0bot.com</a>.</p>
<p><strong>What we do.</strong> We review every report and act on it <strong>within 24 hours</strong>: we remove content that breaks these Terms, and we <strong>remove users who post it</strong> by suspending or terminating their accounts. The person reported is not told who reported them.</p>

<hr>

<h2>5. Your content</h2>
<ul>
  <li>You retain ownership of the content you submit to X0 Bot (what you say, type, upload and share, and the code in the repos you connect). We do not claim ownership of it.</li>
  <li>You grant X0 Bot a worldwide, non-exclusive, royalty-free license to host, store, copy, transmit, process and display your content only as needed to provide, maintain and secure the Service and to do what you ask, including sending it to the processors and connected apps our Privacy Policy names. The license ends when your content is deleted from the Service, except for copies the Privacy Policy says we keep (for example, a report kept as a safety record, or what you sent to other people).</li>
  <li>When you share content in Spaces, list a bot in Find a bot, or give someone a bot's key, you allow the people you share it with to see and use it within the Service.</li>
  <li>You are responsible for ensuring you have the right to submit any content you input, and to let X0 Bot work in the accounts, apps and repos you connect.</li>
  <li>You warrant that your content does not infringe third-party rights.</li>
  <li>We may remove or refuse content, and disable a bot, a listing, a key or a connection, if it breaks these Terms or the law, or puts other people or the Service at risk.</li>
</ul>

<hr>

<h2>6. Intellectual property and feedback</h2>
<p>X0 Bot, including its software, design, bots, and branding, is owned by us and our licensors. All rights not expressly granted are reserved. You may not copy, modify, distribute, or create derivative works without permission. If you send us ideas, suggestions or feedback, we may use them for any purpose without restriction or payment to you.</p>

<hr>

<h2>7. AI output, and what you do with it</h2>
<p>X0 Bot uses artificial intelligence to transcribe voice, refine and write text, answer questions, write and change code, and act in the apps you connect. AI output, including text, code, summaries and the actions a bot proposes or takes, may be wrong, incomplete, out of date, or unsuitable, and may resemble content that others own. You are responsible for reviewing output before relying on it, especially where accuracy matters (medical, legal, financial). <strong>You alone are responsible for what you send, post, merge, deploy, publish, pay or approve</strong>, whether you wrote it or X0 Bot did. X0 Bot does not guarantee that AI output is accurate, complete, original, or fit for any particular purpose, and it is not professional advice.</p>

<hr>

<h2>8. Bots, and actions taken for you</h2>
<ul>
  <li>A bot acts on your instructions, on the settings and rules you give it, and on the approvals you give. When you approve an action, or allow a kind of action to run without asking each time, you authorise X0 Bot to carry it out for you, in your name, in the app concerned, and you are responsible for it as if you had done it yourself.</li>
  <li>Read an approval card before you approve it. X0 Bot judges whether an action reads, changes, sends, deletes or pays from what the app says about it, and that can be wrong.</li>
  <li>You are responsible for the bots you make and configure, for what they do with the skills, files and apps you give them, for the bots you add to a space or list in Find a bot, and for everyone you give a bot's API key to. Keep keys secret, and revoke a key you think is exposed.</li>
  <li>X0 Bot never moves money. When a bot or a space fills in a payment for you, you pay it yourself in your own UPI app; that payment is between you, your bank or UPI app, and the payee, and we are not a party to it.</li>
  <li>A bot stops when it reaches its spending limit or another limit (Section 3.6), and may then leave work unfinished.</li>
</ul>

<hr>

<h2>9. The Code bot and GitHub</h2>
<ul>
  <li>You may connect only repos, accounts and organisations you are allowed to, and your use of GitHub stays subject to GitHub's terms and to the rules of any organisation that owns a repo.</li>
  <li>The Code bot makes its changes on its own branches and in draft pull requests. Unless you have told it otherwise for a project, it asks you before it merges a pull request, commits or pushes to any other branch (the default branch included), or deletes a branch, and some actions (such as a force-push) ask every time. A standing "always" you give for a project lets it act without asking, at your risk; you can take it back at any time.</li>
  <li><strong>Reviewing, testing, merging, deploying and releasing code, and your repos' settings, branch protection, CI and secrets, are your decision and your risk.</strong> Code X0 Bot writes may contain bugs or security weaknesses, or resemble code under another licence; checking it is your job.</li>
  <li>X0 Bot's check for passwords and keys is a safeguard, not a guarantee. Do not keep secrets in your code.</li>
  <li>Commands X0 Bot runs for a job run on the computers you allow: your own computer, or GitHub's computers in your repo. You are responsible for allowing them there, and for anything a third party charges you, such as GitHub for Actions minutes beyond your free allowance.</li>
  <li>Keep your own copies of your code. To the extent the law allows, we are not responsible for code, branches, data or minutes lost or changed in your repos or accounts.</li>
</ul>

<hr>

<h2>10. Third-party apps and services</h2>
<ul>
  <li>The Service works with services we do not control: GitHub, Google's apps, the other apps you connect (such as Notion or Zapier), the apps X0 Bot opens for you (such as WhatsApp, Gmail, Google Maps or your UPI app), the app stores, payment processors, and the AI model providers named in our Privacy Policy. Their own terms and privacy policies apply to your use of them, and you must follow them.</li>
  <li>When you connect an app, you authorise X0 Bot to access and use your account there as you direct, within the permissions you gave.</li>
  <li>We do not endorse those services and are not responsible for their availability, accuracy, security, how they handle your data, or what they charge. They may change or end what they offer, and a connection, a hand-off or a feature that depends on them may then stop working. We may add, change or remove a connection to any of them at any time.</li>
</ul>

<hr>

<h2>11. Changes to the Service, and availability</h2>
<p>We aim to keep the Service available but do not guarantee uninterrupted access. We may modify, suspend, or discontinue the Service or any feature, bot, connection, plan, limit or price at any time. We will make reasonable efforts to notify you of significant changes, and will give the notice the law or the app stores require (for example, before a price change to a subscription you pay for).</p>

<hr>

<h2>12. Disclaimers</h2>
<p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY. WITHOUT LIMITING THAT, WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE OR ERROR-FREE, THAT DEFECTS WILL BE CORRECTED, THAT CONTENT WILL NOT BE LOST, OR THAT AI OUTPUT, CODE OR ACTIONS TAKEN FOR YOU WILL BE CORRECT, SAFE OR SUITABLE.</p>
<p>Some jurisdictions do not allow certain warranties to be excluded, so some of these exclusions may not apply to you. Nothing in these Terms takes away rights you have as a consumer that the law says cannot be taken away.</p>

<hr>

<h2>13. Limitation of liability</h2>
<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, X0 BOT AND ITS AFFILIATES, DIRECTORS, EMPLOYEES AND SUPPLIERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, CODE, GOODWILL OR BUSINESS OPPORTUNITY, OR THE COST OF SUBSTITUTE SERVICES, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE, INCLUDING AI OUTPUT, ACTIONS YOU APPROVED OR ALLOWED, CODE YOU MERGED OR DEPLOYED, AND THIRD-PARTY SERVICES, EVEN IF WE WERE TOLD SUCH DAMAGES WERE POSSIBLE.</p>
<p>OUR AGGREGATE LIABILITY IN ANY MATTER RELATED TO THE SERVICE SHALL NOT EXCEED THE AMOUNTS YOU PAID US IN THE PRIOR 12 MONTHS OR US$100, WHICHEVER IS GREATER.</p>
<p>These limits apply whatever the legal theory (contract, tort including negligence, or otherwise). They do not limit liability that the law does not allow to be limited, such as for fraud, or for death or personal injury caused by negligence.</p>

<hr>

<h2>14. Indemnification</h2>
<p>To the extent the law allows, you agree to indemnify and hold X0 Bot and its affiliates harmless from any claim, loss, liability or expense (including reasonable legal fees) arising from (a) your use of the Service in violation of these Terms, (b) content you submit or share, (c) actions taken by your bots, your keys or the Code bot that you instructed, approved or allowed, (d) your use of connected apps and repos, or (e) your violation of any law or third-party right.</p>

<hr>

<h2>15. Suspension and termination</h2>
<ul>
  <li>You may stop using the Service at any time. To delete your account, open <strong>Delete account</strong> in the app (under You, or in Settings). Your account is deleted 7 days after you ask. Until then nothing is removed, your bots stop working, and you can sign in and choose <strong>Keep my account</strong> to keep everything as it was. After the 7 days the account, the personality it learned, and the usage history are deleted for good, and that cannot be undone. Where the app says deleting cannot be undone, it deletes the account straight away. You can also ask for it without the app, at <a href="https://x0bot.com/delete-account">x0bot.com/delete-account</a>. If you cannot reach either, email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a> instead.</li>
  <li>We may suspend or terminate your access if you violate these Terms, including by posting objectionable content or abusing other users (see 4.1).</li>
  <li>We may also suspend or limit an account, a bot, a key or a connection, or remove content, when we reasonably believe it is needed to protect people, the Service or others from harm, fraud, abuse or a security risk, or when the law requires it. Where it is lawful and safe, we will tell you.</li>
  <li>We may share information with authorities and respond to lawful requests as our Privacy Policy allows.</li>
  <li>On termination, sections that by their nature should survive (your content license for copies we may keep, IP and feedback, AI output, disclaimers, limitations, indemnity, governing law, and the general terms) remain in effect.</li>
</ul>

<hr>

<h2>16. Governing law and disputes</h2>
<p>These Terms are governed by the laws of <strong>India</strong>, without regard to its conflict-of-law rules. Any dispute arising from or relating to these Terms or the Service shall be resolved in the courts of India, unless the App Store's or Google Play's own terms require otherwise for consumer disputes.</p>
<p>If you are a consumer resident in the European Union, United Kingdom, or another jurisdiction whose mandatory consumer-protection laws grant you the right to bring proceedings in the courts of your place of residence, that right is preserved.</p>

<hr>

<h2>17. Apple App Store additional terms</h2>
<p>If you download X0 Bot from the Apple App Store, the following additional terms apply. These terms are between you and X0 Bot; Apple is not a party to these Terms but is an intended third-party beneficiary and has the right to enforce them against you.</p>

<h3>17.1 Scope of License</h3>
<p>X0 Bot grants you a non-transferable license to use the app on any Apple-branded products that you own or control, and as permitted by the App Store Terms of Service. You may not distribute, network, share, or make the app available for use over a network where it could be used by multiple devices at the same time (except as expressly permitted by Apple).</p>

<h3>17.2 Maintenance and support</h3>
<p>X0 Bot is solely responsible for providing any maintenance and support services with respect to the app, as specified in these Terms or as required under applicable law. Apple has no obligation whatsoever to furnish any maintenance and support services with respect to the app.</p>

<h3>17.3 Warranty</h3>
<p>X0 Bot is solely responsible for any product warranties, whether express or implied by law, to the extent not effectively disclaimed. In the event of any failure of the app to conform to any applicable warranty, you may notify Apple, and Apple will refund the purchase price of the app to you. To the maximum extent permitted by applicable law, Apple will have no other warranty obligation whatsoever with respect to the app, and any other claims, losses, liabilities, damages, costs, or expenses attributable to any failure to conform to any warranty will be the sole responsibility of X0 Bot.</p>

<h3>17.4 Product claims</h3>
<p>X0 Bot, not Apple, is responsible for addressing any claims by you or any third party relating to the app or your possession or use of the app, including but not limited to: (i) product liability claims; (ii) any claim that the app fails to conform to any applicable legal or regulatory requirement; and (iii) claims arising under consumer protection or similar legislation.</p>

<h3>17.5 Intellectual property rights</h3>
<p>In the event of any third-party claim that the app or your possession and use of the app infringes that third party's intellectual property rights, X0 Bot, not Apple, will be solely responsible for the investigation, defense, settlement, and discharge of any such intellectual property infringement claim.</p>

<h3>17.6 Legal compliance</h3>
<p>You represent and warrant that (i) you are not located in a country that is subject to a U.S. Government embargo, or that has been designated by the U.S. Government as a "terrorist supporting" country; and (ii) you are not listed on any U.S. Government list of prohibited or restricted parties.</p>

<h3>17.7 Third-party beneficiary</h3>
<p>You acknowledge and agree that Apple, and Apple's subsidiaries, are third-party beneficiaries of these Terms, and that, upon your acceptance of these Terms, Apple will have the right (and will be deemed to have accepted the right) to enforce these Terms against you as a third-party beneficiary thereof.</p>

<h3>17.8 Third-party terms</h3>
<p>You must comply with applicable third-party terms of agreement when using the app, such as your wireless data service agreement.</p>

<h3>17.9 Developer contact</h3>
<p>For questions, complaints, or claims regarding the app, contact:<br>
XOOTEQ LAB PRIVATE LIMITED (X0 Bot) · <a href="mailto:support@x0bot.com">support@x0bot.com</a></p>

<hr>

<h2>18. Changes to these Terms</h2>
<p>We may update these Terms from time to time. Material changes will be posted with a new "Effective" date, and, where the law requires or it is reasonable, we will tell you in the app or by email before they take effect. Continued use after changes take effect constitutes acceptance. If you do not agree to a change, stop using the Service and delete your account. A change does not apply to a dispute that arose before it.</p>

<hr>

<h2>19. General</h2>
<ul>
  <li><strong>Entire agreement.</strong> These Terms, the Privacy Policy, and any terms shown to you when you buy a plan, are the whole agreement between you and us about the Service.</li>
  <li><strong>Severability.</strong> If any part of these Terms is found unenforceable, it is changed only as much as needed to make it enforceable, and the rest stays in effect.</li>
  <li><strong>No waiver.</strong> If we do not enforce a right or a term, that is not a waiver of it.</li>
  <li><strong>Assignment.</strong> You may not transfer these Terms without our written consent. We may transfer them, for example as part of a merger, acquisition or sale of assets, or by operation of law.</li>
  <li><strong>Events beyond our control.</strong> We are not responsible for delays or failures caused by events beyond our reasonable control, including failures of the third-party services in Section 10.</li>
  <li><strong>Relationship.</strong> Nothing in these Terms makes either of us the other's partner, employee or agent, except that bots act for you as Section 8 says.</li>
  <li><strong>Notices.</strong> We may give you notices in the app, by email to your account's address, or on our website.</li>
</ul>

<hr>

<h2>20. Contact</h2>
<p>Questions about these Terms: <a href="mailto:legal@x0bot.com">legal@x0bot.com</a>. Help with the Service: <a href="mailto:support@x0bot.com">support@x0bot.com</a>, or see <a href="https://x0bot.com/support">x0bot.com/support</a>.</p>
`;

export const TERMS_HTML = siteShell({
  title: "Terms of Service",
  path: "/terms",
  description: "The terms for using X0 Bot, its apps and its keyboard.",
  ld: [
    pageLd("/terms", "X0 Bot terms of service", "The terms for using X0 Bot, its apps and its keyboard."),
    crumbsLd([["X0 Bot", "/"], ["Terms", "/terms"]]),
  ],
  main: `<article class="prose">\n${TERMS_BODY}\n</article>`,
});
