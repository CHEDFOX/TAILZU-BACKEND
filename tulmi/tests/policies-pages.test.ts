import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
// No published site: /privacy, /terms and /support serve this repo's copies.
process.env.SITE_DIR = "/tmp/tailzu-test-no-site";

// eslint-disable-next-line import/first
import { PRIVACY_POLICY_HTML } from "../src/routes/policies/privacy.js";
// eslint-disable-next-line import/first
import { TERMS_EFFECTIVE, TERMS_HTML } from "../src/routes/policies/terms.js";
// eslint-disable-next-line import/first
import { SUPPORT_EMAIL, SUPPORT_HTML } from "../src/routes/policies/support.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { getConfig } from "../src/config.js";
// eslint-disable-next-line import/first
import { ACTIONS } from "../src/code/policy.js";
// eslint-disable-next-line import/first
import { IDLE_REVOKE_MS, OAUTH_SCOPES } from "../src/code/oauth.js";
// eslint-disable-next-line import/first
import { gate, gateTool } from "../src/connectors/risk.js";
// eslint-disable-next-line import/first
import { RESULT_MAX } from "../src/connectors/client.js";
// eslint-disable-next-line import/first
import { KEEP_DAYS as ACTIVITY_DAYS, cleanEvent } from "../src/shell/events.js";
// eslint-disable-next-line import/first
import { CHAT_KEEP } from "../src/botsBots/chat.js";
// eslint-disable-next-line import/first
import { shownName } from "../src/routes/botsBots.js";
// eslint-disable-next-line import/first
import { KEEP_DAYS as WIDGET_ANSWER_DAYS } from "../src/widgets/act.js";
// eslint-disable-next-line import/first
import { WIDGETS_DEFAULTS } from "../src/widgets/defaults.js";
// eslint-disable-next-line import/first
import { PUSH_DEFAULTS } from "../src/push/defaults.js";
// eslint-disable-next-line import/first
import { sitePages } from "../src/seo/machine.js";
// eslint-disable-next-line import/first
import { ACT_WITHIN_MS } from "../src/botsBots/safety.js";

/**
 * THE POLICY PAGES, HELD TO THE CODE (routes/policies: privacy.ts, terms.ts, support.ts).
 *
 * privacy-ask.test.ts holds the Ask and Google sections. This file holds the rest of what the policy says the product
 * does today (Xode and GitHub, other connected apps, bots, files, the Lock Screen, purchases), the Terms'
 * protections, and the Support page, to the code that does it: a change that makes a sentence untrue fails here, and
 * the page is changed with it.
 */

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/\s+/g, " ").replace(/ ([,.;:)])/g, "$1");
const policy = text(PRIVACY_POLICY_HTML);
const between = (from: string, to: string) => policy.slice(policy.indexOf(from), policy.indexOf(to));
const github = between("12. Xode and GitHub", "13. Other apps you connect");
const apps = between("13. Other apps you connect", "14. Bots");
const bots = between("14. Bots", "15. Widgets, Live Activities");
const lock = between("15. Widgets, Live Activities", "16. Changes to this policy");
const terms = text(TERMS_HTML);
const support = text(SUPPORT_HTML);

describe("Xode and GitHub (privacy, Section 12)", () => {
  it("says what it does on its own, what it asks about, and what asks every time, as the policy's tiers have it", () => {
    for (const a of ["branch.create", "commit.own_branch", "pr.open_draft", "branch.sync", "pr.comment"] as const) expect(ACTIONS[a].tier, a).toBe("free");
    for (const a of ["commit.other_branch", "pr.merge", "pr.ready", "pr.close", "branch.delete", "workflow.write", "repo.init"] as const) expect(ACTIONS[a].tier, a).toBe("ask");
    for (const a of ["push.force", "branch.delete_default", "commit.secret"] as const) expect(ACTIONS[a].tier, a).toBe("ask_strict");
    for (const a of ["repo.delete", "path.escape"] as const) expect(ACTIONS[a].tier, a).toBe("never");
    expect(github).toContain("It asks you first before it commits or pushes to any other branch (the default branch included), merges a pull request");
    expect(github).toContain("A force-push, deleting the default branch, and a commit with something in it that looks like a password or key ask every time, with Face ID on your phone.");
    expect(github).toContain("It never deletes a repo, writes outside the repo");
  });

  it("says what a sign-in token can reach, and that it is revoked after 30 days unused", () => {
    expect([...OAUTH_SCOPES]).toEqual(["repo", "read:user"]);
    expect(github).toContain(`GitHub's "repo" and "read:user" permissions, and "workflow" only if you allow that too`);
    expect(IDLE_REVOKE_MS).toBe(30 * 24 * 3_600_000);
    expect(github).toContain("leaving it unused for 30 days revokes your token at GitHub and deletes it");
    expect(policy).toContain("A token from Sign in with GitHub is kept until you disconnect, delete your account, or leave it unused for 30 days.");
  });

  it("says where the code goes and what is kept, without promising more than the code keeps back", () => {
    expect(github).toContain("X0 Bot tells OpenRouter to use only providers that neither keep nor train on what they are sent");
    expect(github).toContain("With the App we keep no GitHub token");
    expect(github).toContain("the first 200 characters of the task it was made for");
    expect(github).toContain("the first 500 characters of each task");
    // A job's checkpoint holds the staged code and stays after the job (docs/code-agent.md, "Privacy").
    expect(github).toContain("keeps them after the job ends");
    expect(github).toContain("does not uninstall the App from GitHub");
  });
});

describe("other connected apps (privacy, Section 13)", () => {
  it("says deletes and payments always ask, as the gate does at every level and policy", () => {
    for (const risk of ["destructive", "pay"] as const) {
      expect(gate(risk, "send", true)).toBe("approve");
      expect(gateTool(risk, "allow")).toBe("approve");
      expect(gate(risk, "draft", false)).toBe("block");
    }
    expect(gate("read", "look", false)).toBe("run");
    expect(gate("write", "look", false)).toBe("block");
    expect(gate("write", "draft", true)).toBe("approve");
    expect(gate("send", "send", true)).toBe("run");
    expect(apps).toContain("Deleting and paying ask every time.");
    expect(apps).toContain("Can look (it only reads), Can draft (every change asks first, and nothing can be sent, deleted or paid) or Can send.");
  });

  it("says what goes to the model at a time, and that disconnecting does not tell the app", () => {
    expect(RESULT_MAX).toBe(1500);
    expect(apps).toContain("at most 1,500 characters at a time");
    expect(apps).toContain("Unlike Google, the app is not told");
  });
});

describe("bots (privacy, Section 14)", () => {
  it("keeps what it says, for as long as it says", () => {
    expect(CHAT_KEEP).toBe(200);
    expect(bots).toContain("up to the last 200 turns with each bot");
    expect(ACTIVITY_DAYS).toBe(90);
    expect(bots).toContain("Entries older than 90 days are deleted whenever a new one is added.");
    expect(cleanEvent({ kind: "ask", bot: "plan", title: "x".repeat(500), paise: 1, amountPaise: 0, payee: "" }).title).toHaveLength(200);
    expect(bots).toContain("the first 200 characters of what you asked");
  });

  it("shows a person by the name it says, in spaces and in Find a bot", () => {
    expect(shownName({ email: "meera.rao@example.com", phone: undefined } as never)).toBe("Meera R.");
    expect(shownName({ email: undefined, phone: "+919876543210" } as never)).toBe("…3210");
    expect(policy).toContain(`meera.rao@… is shown as "Meera R."`);
    expect(bots).toContain("your name as 1.8 says it is shown");
  });
});

describe("files you attach (privacy, 1.9)", () => {
  it("keeps them as long as the sweep does", () => {
    expect(getConfig().MEDIA_KEEP_DAYS).toBe(30);
    expect(policy).toContain("30 days from when it was first read");
  });
});

describe("the Lock Screen (privacy, Section 15)", () => {
  it("shows only a count on the Lock Screen, and never answers a delete or a payment from outside the app", () => {
    const f = WIDGETS_DEFAULTS.flags as Record<string, unknown>;
    expect((f["widgets.people.limits"] as { lock: number }).lock).toBe(0);
    expect((f["widgets.needs.limits"] as { lock: number }).lock).toBe(0);
    expect(f["widgets.needs.inPlaceRisks"]).not.toContain("pay");
    expect(f["widgets.needs.inPlaceRisks"]).not.toContain("destructive");
    expect(lock).toContain(`On the iPhone Lock Screen, these two widgets show only a count ("2 new from your people")`);
    expect(lock).toContain("(never a delete or a payment: those open X0 Bot)");
    expect(f["widgets.token.ttlMin"]).toBe(24 * 60);
    expect(lock).toContain("lasts a day");
    expect(WIDGET_ANSWER_DAYS).toBe(7);
    expect(lock).toContain("We keep the outcome of each such answer for seven days");
  });

  it("names only the app in a connected app's notification, and never a message's words", () => {
    const l = PUSH_DEFAULTS.labels;
    expect(l["push.approval.body"]).toContain("{app}");
    expect(l["push.space_message.body"]).not.toMatch(/\{(text|message|body)\}/);
    expect(lock).toContain("that someone messaged you (their name and the chat, not the message)");
  });
});

describe("purchases (privacy 1.3 and Section 3)", () => {
  it("names every processor the code pays through", () => {
    const s3 = between("3. Third parties we use", "4. Data retention");
    for (const name of ["RevenueCat", "Apple App Store / Google Play", "Razorpay", "Paddle"]) expect(s3, name).toContain(name);
    expect(policy).toContain("We give Razorpay your X0 Bot account ID");
  });
});

describe("the terms", () => {
  it("are dated with the policy", () => {
    expect(TERMS_EFFECTIVE).toBe("October 30, 2026");
  });

  it("number their sections 1 to 20, once each, in order", () => {
    const nums = [...TERMS_HTML.matchAll(/<h2(?: id="[a-z-]+")?>(\d+)\. /g)].map((m) => Number(m[1]));
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("carry the protections the owner asked for, and keep the law and the venue", () => {
    expect(terms).toContain("You alone are responsible for what you send, post, merge, deploy, publish, pay or approve");
    expect(terms).toContain("Reviewing, testing, merging, deploying and releasing code, and your repos' settings, branch protection, CI and secrets, are your decision and your risk.");
    expect(terms).toContain("you are responsible for it as if you had done it yourself");
    expect(terms).toContain("Their own terms and privacy policies apply to your use of them");
    expect(terms).toContain(`THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE"`);
    expect(terms).toContain("THE AMOUNTS YOU PAID US IN THE PRIOR 12 MONTHS OR US$100, WHICHEVER IS GREATER");
    expect(terms).toContain("you agree to indemnify and hold X0 Bot and its affiliates harmless");
    expect(terms).toContain("we may use them for any purpose without restriction or payment to you");
    for (const h of ["Entire agreement.", "Severability.", "No waiver.", "Assignment."]) expect(terms).toContain(h);
    expect(terms).toContain("These Terms are governed by the laws of India");
    // Apple's minimum terms: not a party, no support duty, third-party beneficiary, third-party terms.
    expect(terms).toContain("Apple has no obligation whatsoever to furnish any maintenance and support services");
    expect(terms).toContain("Apple will have the right (and will be deemed to have accepted the right) to enforce these Terms against you");
    expect(terms).toContain("You must comply with applicable third-party terms of agreement when using the app");
    // Nothing that takes away what the law keeps for consumers.
    expect(terms).toContain("Nothing in these Terms takes away rights you have as a consumer that the law says cannot be taken away.");
    expect(terms).not.toMatch(/class action|arbitration/i);
  });

  it("say what Xode asks about as the policy's tiers do", () => {
    expect(ACTIONS["pr.merge"].tier).toBe("ask");
    expect(ACTIONS["commit.other_branch"].tier).toBe("ask");
    expect(ACTIONS["push.force"].tier).toBe("ask_strict");
    expect(terms).toContain("it asks you before it merges a pull request, commits or pushes to any other branch (the default branch included), or deletes a branch, and some actions (such as a force-push) ask every time");
  });
});

describe("the support page", () => {
  it("gives the address the app gives, and promises no reply time", () => {
    expect(SUPPORT_EMAIL).toBe("support@x0bot.com");
    expect(SUPPORT_HTML).toContain(`<a href="mailto:support@x0bot.com">support@x0bot.com</a>`);
    // The one time it names is the Terms' own, for acting on a report in Spaces (botsBots/safety.ts ACT_WITHIN_MS).
    expect(support).not.toMatch(/(reply|respond|answer|get back|hear from us)[^.]{0,60}within/i);
    expect(support.match(/within \d+ \w+/g)).toEqual(["within 24 hours"]);
    expect(ACT_WITHIN_MS).toBe(24 * 3_600_000);
  });

  it("links deleting an account, the policy and the terms, and says what the terms say about refunds", () => {
    for (const href of ["https://x0bot.com/delete-account", "https://x0bot.com/privacy", "https://x0bot.com/terms", "https://x0bot.com/pricing"]) {
      expect(SUPPORT_HTML).toContain(`href="${href}"`);
    }
    expect(support).toContain("Purchases are non-refundable, except where the law requires a refund");
    expect(terms).toContain("Purchases are non-refundable, except where the law requires a refund");
    expect(support).toContain("Your account is deleted 7 days after you ask");
  });

  it("is in the sitemap and the footer of every site page", () => {
    expect(sitePages().some((p) => p.path === "/support")).toBe(true);
    expect(PRIVACY_POLICY_HTML).toContain(`<a href="/support">Support</a>`);
    expect(SUPPORT_HTML).toContain(`<a href="/support" aria-current="page">Support</a>`);
    expect(SUPPORT_HTML).toContain(`<link rel="canonical" href="https://x0bot.com/support">`);
  });
});

describe("served", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("/support as HTML, with the site's look", async () => {
    const res = await app.inject({ method: "GET", url: "/support" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toContain("<h1>Support</h1>");
    expect(res.body).toContain("support@x0bot.com");
    expect(res.body).toContain('<article class="prose">');
  });

  it("/terms with the new date, and the sitemap with /support", async () => {
    const t = await app.inject({ method: "GET", url: "/terms" });
    expect(t.statusCode).toBe(200);
    expect(t.body).toContain("Effective: October 30, 2026");
    expect(t.body).toContain("<h2>9. Xode and GitHub</h2>");
    const map = await app.inject({ method: "GET", url: "/sitemap.xml" });
    expect(map.body).toContain("<loc>https://x0bot.com/support</loc>");
  });
});
