/**
 * THE SIGN-IN CARD (docs/sign-in.md): the planner reads the real boxes off a sign-in page and names them, so a shop
 * nobody has written code for works like one that was. These tests hold the parts that make that safe to ship: a
 * card only ever made of fields that are really on this screen, never one for a payment or a CAPTCHA, and no card
 * at all when the planner is unsure — because the page itself always works and a guessed card does not.
 *
 * No server and no model: the lines are what a planner writes, read by the same reader a real step uses.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { LineReader, parseLine } = await import("../src/agent/lines.js");
const { SIGN_IN_NOTE, agentUserMessage, looksLikeSignIn } = await import("../src/agent/prompt.js");
const { stableBlock } = await import("../src/principles/roles.js");
import type { AgentElement, AgentStepRequest } from "../../shared/types/api.js";

/** A sign-in page as the device reads one: a phone box, a password box, a button, and another way in. */
const IDS = new Set(["e1", "e2", "e3", "e4", "e5", "o1"]);
const read = (lines: string[], r = new LineReader(IDS, "do")) =>
  ({ out: lines.flatMap((l) => r.read(parseLine(l, "mac")!)), r });

const el = (id: string, role: string, label?: string): AgentElement => (label ? { id, role, label } : { id, role });

const request = (screen: AgentStepRequest["screen"], over: Partial<AgentStepRequest> = {}): AgentStepRequest => ({
  runId: "r1", step: 0, platform: "mac", app: "Safari", said: "sign me in", screen, ...over,
} as AgentStepRequest);

describe("the lines a card is written in", () => {
  it("reads a FIELD and an ALSO, and the words a model reaches for instead of the protocol's", () => {
    expect(parseLine("FIELD e1 phone | Phone number", "mac"))
      .toEqual({ verb: "FIELD", field: { id: "e1", kind: "phone", label: "Phone number" } });
    // "password", "otp" and "pin" are what a page says; the protocol calls them secret and code.
    expect(parseLine("FIELD e2 password | Password", "mac"))
      .toEqual({ verb: "FIELD", field: { id: "e2", kind: "secret", label: "Password" } });
    expect(parseLine("FIELD e2 OTP | The code we texted you", "mac"))
      .toEqual({ verb: "FIELD", field: { id: "e2", kind: "code", label: "The code we texted you" } });
    // A kind nobody recognises is a plain box, not a dropped line: the label still helps them.
    expect(parseLine("FIELD e1 username | Your username", "mac"))
      .toEqual({ verb: "FIELD", field: { id: "e1", kind: "text", label: "Your username" } });
    expect(parseLine("- **ALSO** e4 | Continue with Google", "mac"))
      .toEqual({ verb: "ALSO", way: { id: "e4", label: "Continue with Google" } });
    // No id, or no label, is not a line of the protocol.
    expect(parseLine("FIELD phone | Phone number", "mac")).toBeNull();
    expect(parseLine("ALSO e4", "mac")).toBeNull();
  });

  it("a label in their own language is kept as it is written", () => {
    expect(parseLine("FIELD e1 phone | मोबाइल नंबर", "mac"))
      .toEqual({ verb: "FIELD", field: { id: "e1", kind: "phone", label: "मोबाइल नंबर" } });
  });
});

describe("the card the reader builds", () => {
  it("hangs the boxes and the ways in on the HANDOVER they were written for", () => {
    const { out } = read([
      "SAY I'll need you for this bit.",
      "FIELD e1 phone | Phone number",
      "FIELD e2 secret | Password",
      "ALSO e4 | Continue with Google",
      "HANDOVER login | Sign in to Swiggy and I'll carry on.",
    ]);
    expect(out).toEqual([
      { emit: { t: "say", text: "I'll need you for this bit." } },
      { emit: {
        t: "handover", why: "login", text: "Sign in to Swiggy and I'll carry on.",
        card: { fields: [{ id: "e1", kind: "phone", label: "Phone number" }, { id: "e2", kind: "secret", label: "Password" }],
          also: [{ id: "e4", label: "Continue with Google" }] },
      } },
    ]);
  });

  it("a box is silent on its own and never ends the step", () => {
    const { out, r } = read(["FIELD e1 phone | Phone number", "ALSO e4 | Use email instead"]);
    expect(out).toEqual([]);
    expect(r.ended).toBe(false);
  });

  it("drops a box whose field is not on this screen, and says nothing rather than typing nowhere", () => {
    const { out, r } = read([
      "FIELD e1 phone | Phone number",
      "FIELD e9 secret | Password",
      "HANDOVER login | Sign in.",
    ]);
    expect(out).toEqual([{ emit: {
      t: "handover", why: "login", text: "Sign in.",
      card: { fields: [{ id: "e1", kind: "phone", label: "Phone number" }] },
    } }]);
    expect(r.cardDropped).toBe(1);
  });

  it("the same field twice is the model repeating itself, and a way in cannot also be a box", () => {
    const { out, r } = read([
      "FIELD e1 phone | Phone number",
      "FIELD e1 text | Mobile",
      "ALSO e1 | Continue",
      "ALSO e4 | Continue with Google",
      "ALSO e4 | Google",
      "HANDOVER login | Sign in.",
    ]);
    const card = out[0] && "emit" in out[0] && out[0].emit.t === "handover" ? out[0].emit.card : undefined;
    expect(card).toEqual({ fields: [{ id: "e1", kind: "phone", label: "Phone number" }], also: [{ id: "e4", label: "Continue with Google" }] });
    expect(r.cardDropped).toBe(3);
  });

  it("with no box there is no card, so they are shown the page itself — which always works", () => {
    const { out } = read(["HANDOVER login | Sign in on the page and press Continue."]);
    expect(out).toEqual([{ emit: { t: "handover", why: "login", text: "Sign in on the page and press Continue." } }]);
  });

  it("NEVER a card for a payment or a CAPTCHA, however many boxes were written", () => {
    for (const why of ["payment", "captcha", "other"] as const) {
      const { out, r } = read([
        "FIELD e1 text | Card number",
        "FIELD e2 code | CVV",
        `HANDOVER ${why} | Your turn.`,
      ]);
      const emitted = out[0] && "emit" in out[0] ? out[0].emit : null;
      expect(emitted).toEqual({ t: "handover", why, text: "Your turn." });
      expect(r.cardDropped).toBe(2);
    }
  });

  it("at most six boxes and four ways in; the rest are dropped and counted", () => {
    const { out, r } = read([
      ...Array.from({ length: 8 }, (_, i) => `FIELD e${i + 1} text | Box ${i + 1}`),
      "HANDOVER login | Sign in.",
    ]);
    const card = out[0] && "emit" in out[0] && out[0].emit.t === "handover" ? out[0].emit.card : undefined;
    // Only e1-e5 are controls on this screen, so the cap is not even reached: what is dropped is what is not there.
    expect(card?.fields.map((f) => f.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(r.cardDropped).toBe(3);
  });

  it("never a box on a line of text read off the pixels: there is nothing behind it to fill", () => {
    const { out, r } = read(["FIELD o1 text | Username", "FIELD e1 phone | Phone number", "HANDOVER login | Sign in."]);
    const card = out[0] && "emit" in out[0] && out[0].emit.t === "handover" ? out[0].emit.card : undefined;
    expect(card).toEqual({ fields: [{ id: "e1", kind: "phone", label: "Phone number" }] });
    expect(r.cardDropped).toBe(1);
  });

  it("a show run and the picture path never build one: neither of them signs anybody in", () => {
    for (const r of [new LineReader(IDS, "show"), new LineReader(IDS, "do", { picture: true, says: 10 })]) {
      const out = ["FIELD e1 phone | Phone number", "HANDOVER login | Sign in."].flatMap((l) => r.read(parseLine(l, "mac")!));
      expect(out).toEqual([{ emit: { t: "say", text: "Sign in." } }]);
    }
  });
});

describe("when the planner is told the rules at all", () => {
  const box = el("e1", "field", "Email");
  const wayIn = el("e3", "button", "Sign in");

  it("knows a sign-in page by the focused field, or by a box beside a way in", () => {
    expect(looksLikeSignIn({ elements: [box], field: { kind: "password" } })).toBe(true);
    expect(looksLikeSignIn({ elements: [el("e2", "field", "Password")] })).toBe(true);
    expect(looksLikeSignIn({ elements: [box, wayIn] })).toBe(true);
    expect(looksLikeSignIn({ elements: [box, el("e3", "button", "Continue with Google")] })).toBe(true);
  });

  it("and leaves every other screen alone", () => {
    expect(looksLikeSignIn({ elements: [box] })).toBe(false);
    expect(looksLikeSignIn({ elements: [wayIn] })).toBe(false);
    expect(looksLikeSignIn({ elements: [] })).toBe(false);
    // A button is not a box to type in, so a page that only talks about signing in is not one.
    expect(looksLikeSignIn({ elements: [el("e1", "text", "Password managers are useful"), el("e2", "link", "Log in")] })).toBe(false);
  });

  it("the rules ride only on a sign-in screen, and the two verbs are always in the contract", () => {
    const say = (screen: AgentStepRequest["screen"], over: Partial<AgentStepRequest> = {}, mode: "show" | "do" = "do") =>
      agentUserMessage(request(screen, over), "sign me in", mode, 20);
    const signIn = say({ elements: [box, wayIn] });
    const ordinary = say({ elements: [el("e1", "button", "Export")] });
    expect(signIn).toContain(SIGN_IN_NOTE);
    expect(ordinary).not.toContain("S1.");
    // On a phone there is no page to sign in on, and a show run answers questions rather than acting.
    expect(say({ elements: [box, wayIn] }, { platform: "ios" })).not.toContain("S1.");
    expect(say({ elements: [box, wayIn] }, {}, "show")).not.toContain("S1.");
    // The verbs cost the stable block two lines; the seven rules cost it nothing.
    const planner = stableBlock("ask_planner");
    expect(planner).toContain("FIELD <id> <text|phone|email|secret|code>");
    expect(planner).toContain("ALSO <id> | <label>");
    expect(planner).not.toContain("S1.");
  });
});
