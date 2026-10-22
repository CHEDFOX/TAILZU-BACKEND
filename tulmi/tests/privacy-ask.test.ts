import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
// No published site: /privacy serves this repo's copy of the policy.
process.env.SITE_DIR = "/tmp/tailzu-test-no-site";

// eslint-disable-next-line import/first
import { PRIVACY_POLICY_EFFECTIVE, PRIVACY_POLICY_HTML } from "../src/routes/policies/privacy.js";
// eslint-disable-next-line import/first
import { APP_KNOB_FLAGS } from "../src/experience/appKnobsData.js";
// eslint-disable-next-line import/first
import { getConfig } from "../src/config.js";
// eslint-disable-next-line import/first
import { modelLadder, visionLadder } from "../src/agent/llm.js";
// eslint-disable-next-line import/first
import { readStepRequest } from "../src/agent/protocol.js";
// eslint-disable-next-line import/first
import { sensitiveApp } from "../src/pipeline/sensitive.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { ALWAYS_ON, CATALOG } from "../src/connectors/catalog.js";
// eslint-disable-next-line import/first
import { RESULT_MAX } from "../src/connectors/client.js";

/**
 * THE PRIVACY POLICY'S ASK SECTION (permissions-spec §3).
 *
 * The permission cards only ask to see; this section is where what is read,
 * what is sent, what never is, where a picture goes and how to stop it are
 * said whole. Every claim in it is held to the code here where the backend
 * can see the code: a change to the models, the wire or the refusals that
 * makes the policy untrue fails this file, and the policy is changed with it.
 */

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/\s+/g, " ").replace(/ ([,.;:)])/g, "$1");
const policy = text(PRIVACY_POLICY_HTML);
const ask = policy.slice(policy.indexOf("10. Ask, on the desktop app"), policy.indexOf("11. Google apps you connect"));
const google = policy.slice(policy.indexOf("11. Google apps you connect"), policy.indexOf("12. Changes to this policy"));

describe("the policy's date and shape", () => {
  it("is effective from the day the Google section was added", () => {
    expect(PRIVACY_POLICY_EFFECTIVE).toBe("October 22, 2026");
    expect(PRIVACY_POLICY_HTML).toContain("Effective: October 22, 2026");
  });

  it("numbers its sections 1 to 13, once each, in order", () => {
    const nums = [...PRIVACY_POLICY_HTML.matchAll(/<h2(?: id="[a-z-]+")?>(\d+)\. /g)].map((m) => Number(m[1]));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const subs = [...PRIVACY_POLICY_HTML.matchAll(/<h3>10\.(\d) /g)].map((m) => Number(m[1]));
    expect(subs).toEqual([1, 2, 3, 4, 5]);
    const google = [...PRIVACY_POLICY_HTML.matchAll(/<h3>11\.(\d) /g)].map((m) => Number(m[1]));
    expect(google).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("points the advertising identifier at the advertising section", () => {
    expect(policy).toMatch(/one of our ads \(see 1\.6\)/);
  });
});

describe("what Ask reads, sends and never sends", () => {
  it("says what it reads on the computer", () => {
    expect(ask).toContain("through the system's accessibility interface");
    expect(ask).toContain("read into lines of text by your computer's own text recognition");
    expect(ask).toContain("Accessibility permission");
    expect(ask).toContain("Screen Recording permission");
  });

  it("says what it sends: a text list with rough positions, what was said, and one picture only when needed and allowed", () => {
    expect(ask).toContain("A text list of what is on the screen");
    expect(ask).toContain("a rough position (top left, centre, bottom right and so on)");
    expect(ask).toContain("the lines of text read off the window's pixels");
    expect(ask).toContain("What you said");
    expect(ask).toContain("One picture, only when a question needs it and you have allowed it");
    expect(ask).toContain("Allow once, Always for that app");
    expect(ask).toContain("Not now");
  });

  it("says what never goes", () => {
    expect(ask).toContain("The window's title, beyond a browser's site name");
    expect(ask).toContain("Exact positions of anything on your screen");
    expect(ask).toContain("nothing in a password field; nothing in a browser's address bar, where Ask finds one;");
    expect(ask).toContain(`the part of a web address after "?" or "#"`);
    expect(ask).toContain("private (incognito) browser window");
    expect(ask).toContain("banking, payments, investing or crypto, tax, health, insurance, a wallet or a password manager");
  });

  it("does not promise more than the code keeps back", () => {
    // A browser's tabs are named with their pages' titles, and the tree's
    // tabs are sent like any other element (only a window's own label is
    // dropped): "window titles never leave" was not true of the tab that
    // repeats it.
    expect(ask).not.toMatch(/Window titles/);
    expect(ask).toContain("even where one of them repeats the title");
    const read = readStepRequest({
      runId: "run-123", step: 0, platform: "mac", app: "Chrome: Gmail", utterance: "what is this",
      screen: { elements: [{ id: "e1", role: "tab", label: "Inbox (3) - Gmail", region: "t" }] },
    }, { maxElements: 250, screenMaxChars: 24_000 });
    expect(JSON.stringify(read)).toContain("Inbox (3) - Gmail");
    // An answer "on your computer" still had its words streamed to be
    // transcribed: it was never "nothing sent at all".
    expect(ask).not.toContain("nothing is sent at all");
    expect(ask).toContain("your words still go to be turned into text (see 10.2), but nothing from your screen is sent");
    // The Mac's two permissions each stop one way of reading, not Ask as a
    // whole: with Screen Recording alone it still reads the window's text
    // off its pixels.
    expect(ask).toContain("with both off, it reads nothing on your screen");
    // The crop is cut below the chrome Ask finds; it cannot promise more.
    expect(ask).toContain("where it finds them");
  });

  it("and the wire does what it says: no window title, no address bar, no query or fragment", () => {
    const read = readStepRequest({
      runId: "run-123", step: 0, platform: "mac", app: "Chrome: Gmail", utterance: "what is this",
      screen: {
        elements: [
          { id: "e1", role: "window", label: "Q3 budget - Confidential", value: "/Users/me/q3.xlsx", region: "t" },
          { id: "e2", role: "field", label: "Address and search bar", value: "mail.google.com/mail/u/0?tok=SECRET", region: "t" },
          { id: "e3", role: "link", label: "https://x.example/reset?token=SECRET#frag", region: "c" },
          { id: "o1", role: "text", label: "see https://x.example/a?code=SECRET", region: "b" },
        ],
      },
    }, { maxElements: 250, screenMaxChars: 24_000 });
    expect("req" in read).toBe(true);
    const sent = JSON.stringify(read);
    expect(sent).not.toContain("SECRET");
    expect(sent).not.toContain("Confidential");
    expect(sent).not.toContain("q3.xlsx");
    expect(sent).toContain("https://x.example/reset");
    // Only the rough position, one of nine.
    for (const el of (read as { req: { screen: { elements: Array<{ region?: string }> } } }).req.screen.elements) {
      if (el.region) expect(["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"]).toContain(el.region);
    }
  });

  it("and the server refuses the apps it names", () => {
    for (const app of ["Chase", "HDFC Bank", "1Password", "Robinhood", "Chrome: MyChart Health", "HMRC", "Chrome: tax return"]) {
      expect(sensitiveApp(app), app).toBe(true);
    }
  });

  it("the picture's size is the desktop's default", () => {
    expect(APP_KNOB_FLAGS["desktop.agent.pictureMaxSide"]).toBe(1024);
    expect(ask).toContain("no more than 1,024 pixels on its longer side by default");
  });
});

describe("where a picture goes, and what is kept", () => {
  it("names the picture path's models as the config sends to them", () => {
    const cfg = getConfig();
    const ladder = visionLadder(false);
    expect(ladder[0]).toMatch(/^google\//);
    expect(ladder[1]).toMatch(/^anthropic\//);
    expect(ladder.at(-1)).toBe(cfg.CLEANUP_MODEL);
    expect(visionLadder(true)[0]).toMatch(/^google\//);
    expect(ask).toContain("through OpenRouter to the AI model that answers the question: Google's Gemini; only if that fails, Anthropic's Claude; and if that fails too, the model that refines your dictation (see Section 3), when it is a different one.");
    // The last rung is skipped when it is a model already tried (no model twice).
    const ladderLen = new Set([cfg.AGENT_VISION_MODEL, ...cfg.AGENT_VISION_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean), cfg.CLEANUP_MODEL]).size;
    expect(ladder).toHaveLength(ladderLen);
  });

  it("lists Ask's processors in Section 3", () => {
    const s3 = policy.slice(policy.indexOf("3. Third parties we use"), policy.indexOf("4. Data retention"));
    const list = s3.slice(s3.indexOf("Ask, on the desktop app"));
    for (const name of ["OpenRouter", "OpenAI", "Google", "Anthropic"]) expect(list).toContain(name);
    // The text path's first model is OpenAI's, its fallback Anthropic's, and
    // the refinement model is its last rung, as it writes Ask's text.
    expect(modelLadder()[0]).toMatch(/^openai\//);
    expect(modelLadder()[1]).toMatch(/^anthropic\//);
    expect(modelLadder().at(-1)).toBe(getConfig().CLEANUP_MODEL);
    expect(list).toContain("The models under Language refinement above write and rewrite text for Ask");
    // OpenRouter, not Tailzu, picks who serves a model.
    expect(list).toContain("OpenRouter chooses which provider serves that model");
  });

  it("says the picture is not stored and not logged, and how to turn it off", () => {
    expect(ask).toContain("Tailzu does not store the picture and does not log it.");
    expect(policy).toContain("Ask: what it reads off your screen, and any picture it sends, is not stored.");
    expect(ask).toContain(`"Look at the screen when it's needed"`);
    expect(ask).toContain("Settings under Ask");
    expect(ask).toContain("System Settings → Privacy & Security");
  });
});

/**
 * THE GOOGLE SECTION (Google API Services User Data Policy, Limited Use).
 *
 * Google's review reads the policy linked on the consent screen: it must say
 * what Google data is read, how it is used, kept, shared and deleted, and
 * carry the Limited Use statement. The claims that rest on the catalog and the
 * planner are checked against them here.
 */
describe("the Google apps section", () => {
  const googleApps = CATALOG.filter((c) => c.provider === "google");

  it("carries the Limited Use statement, with its link", () => {
    expect(google).toContain("Tailzu's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.");
    expect(PRIVACY_POLICY_HTML).toContain(`<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>`);
    expect(google).toContain("Tailzu uses your Google data only to do what you asked, when you ask.");
    expect(google).toContain("We never sell it.");
    expect(google).toContain("We never use it for advertising");
    expect(google).toContain("Tailzu does not use it to create, train or improve AI or machine-learning models.");
    expect(google).toContain("No one at Tailzu reads it, unless you ask us to");
  });

  it("names every Google app the catalog can connect, and no other", () => {
    expect(googleApps.map((c) => c.id).sort()).toEqual([
      "google-calendar", "google-classroom", "google-docs", "google-forms", "google-sheets", "google-tasks",
    ]);
    for (const c of googleApps) expect(google, c.id).toContain(`${c.name} —`);
  });

  it("says Classroom only reads, and Docs, Sheets and Forms reach only Tailzu's own files, as their scopes allow", () => {
    const scopes = (id: string) => CATALOG.find((c) => c.id === id)!.scopes!;
    expect(scopes("google-classroom").every((s) => s.endsWith(".readonly"))).toBe(true);
    expect(google).toContain("Google Classroom — only reads");
    for (const id of ["google-docs", "google-sheets", "google-forms"]) {
      expect(scopes(id), id).toEqual(["https://www.googleapis.com/auth/drive.file"]);
    }
    expect(google).toContain("Google lets it reach only the files Tailzu made, never the rest of your Drive.");
    expect(google).toContain("Google lets it reach only the sheets Tailzu made.");
    expect(google).toContain("Google lets it reach only the forms Tailzu made.");
  });

  it("says YouTube's search is no connected app: no sign-in and no scope, as the catalog has it", () => {
    const yt = ALWAYS_ON.find((c) => c.id === "youtube")!;
    expect(yt.auth).toBe("none");
    expect(yt.scopes).toBeUndefined();
    expect(CATALOG.some((c) => c.id === "google-youtube")).toBe(false);
    expect(google).toContain("YouTube is not a connected app either.");
    expect(google).toContain("it sends only the words to search for to Google's YouTube Data API, with Tailzu's own key");
    expect(google).not.toMatch(/playlist/i);
  });

  it("says Gmail and Maps are hand-offs with no access, as the catalog has them", () => {
    for (const id of ["email-handoff", "maps"]) {
      const h = ALWAYS_ON.find((c) => c.id === id)!;
      expect(h.auth, id).toBe("none");
      expect(h.scopes, id).toBeUndefined();
    }
    expect(google).toContain("it opens Gmail's own compose window with the email written");
    expect(google).toContain("Tailzu has no access to either, and it reads none of your email.");
  });

  it("names the planner's models as the config sends to them, and the cut on what is read", () => {
    expect(modelLadder()[0]).toMatch(/^openai\//);
    expect(modelLadder()[1]).toMatch(/^anthropic\//);
    expect(modelLadder().at(-1)).toBe(getConfig().CLEANUP_MODEL);
    expect(google).toContain("through OpenRouter to the AI model that answers you: OpenAI's model first; Anthropic's Claude if that fails; and if that fails too, the model that refines your dictation (see Section 3).");
    expect(RESULT_MAX).toBe(1500);
    expect(google).toContain("at most 1,500 characters at a time");
    const s3 = policy.slice(policy.indexOf("3. Third parties we use"), policy.indexOf("4. Data retention"));
    expect(s3).toContain("Google apps you connect (see Section 11)");
  });

  it("says how to disconnect, the last-Google-app rule, and what stays", () => {
    expect(google).toContain("Tailzu deletes its stored access to that app right away and stops using it.");
    expect(google).toContain("When you disconnect the last of them, Tailzu also asks Google to revoke it.");
    expect(google).toContain("Until then, Google keeps Tailzu's permission for every Google app you connected, including the one you just disconnected");
    expect(google).toContain("myaccount.google.com/connections");
    expect(google).toContain("What stays after you disconnect: your Tasks list, the record of actions, and any change still waiting for your OK");
    expect(google).toContain("It does not tell Google, so disconnect your Google apps first");
    expect(policy).toContain("Google apps you connect: what Tailzu reads in them is not stored, except the details of a change waiting for your OK.");
    expect(google).toContain("Apart from a change waiting for your OK, what Tailzu reads in your Google apps is used for that one request and not stored");
  });
});

describe("served at /privacy", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("with the Ask and Google sections and the new date", async () => {
    const res = await app.inject({ method: "GET", url: "/privacy" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<h2>10. Ask, on the desktop app</h2>");
    // The anchor the Google verification pack links to (docs/google-verification.md).
    expect(res.body).toContain(`<h2 id="google-user-data">11. Google apps you connect</h2>`);
    expect(res.body).toContain("including the Limited Use requirements.");
    expect(res.body).toContain("Effective: October 22, 2026");
    const meta = await app.inject({ method: "GET", url: "/policies.json" });
    expect(meta.json().privacy).toEqual({ url: "https://tailzu.space/privacy", effective: "October 22, 2026" });
  });
});
