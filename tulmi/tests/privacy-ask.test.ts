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
const ask = policy.slice(policy.indexOf("10. Ask, on the desktop app"), policy.indexOf("11. Changes to this policy"));

describe("the policy's date and shape", () => {
  it("is effective from the day the Ask section was added", () => {
    expect(PRIVACY_POLICY_EFFECTIVE).toBe("October 20, 2026");
    expect(PRIVACY_POLICY_HTML).toContain("Effective: October 20, 2026");
  });

  it("numbers its sections 1 to 12, once each, in order", () => {
    const nums = [...PRIVACY_POLICY_HTML.matchAll(/<h2>(\d+)\. /g)].map((m) => Number(m[1]));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const subs = [...PRIVACY_POLICY_HTML.matchAll(/<h3>10\.(\d) /g)].map((m) => Number(m[1]));
    expect(subs).toEqual([1, 2, 3, 4, 5]);
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

describe("served at /privacy", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("with the Ask section and the new date", async () => {
    const res = await app.inject({ method: "GET", url: "/privacy" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<h2>10. Ask, on the desktop app</h2>");
    expect(res.body).toContain("Effective: October 20, 2026");
    const meta = await app.inject({ method: "GET", url: "/policies.json" });
    expect(meta.json().privacy).toEqual({ url: "https://tailzu.space/privacy", effective: "October 20, 2026" });
  });
});
