/**
 * ASK'S FLOW INSTRUCTIONS (agent/flow.ts, the `flow` event): sent only to a request that asks, right after heard; the
 * media a question wants ends the step in `look`; a trusted command's ordinary steps are free on the server's side too,
 * and its floors are not.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { decideFlow, flowPolicy, isVisualQuestion, wantsClip, PLAYERS } = await import("../src/agent/flow.js");
const { EventSink, readFlowAsk } = await import("../src/agent/protocol.js");
const { runStep } = await import("../src/agent/run.js");
const { riskOf } = await import("../src/agent/risk.js");
import type { AgentEvent, AgentStepRequest } from "../../shared/types/api.js";

const POLICY = flowPolicy({
  AGENT_FLOW_LISTEN_AFTER: "question,command,words,picture", AGENT_FLOW_IDLE_MS: 120000, AGENT_FLOW_TRUST_COMMANDS: true,
  AGENT_FLOW_MEDIA: true, AGENT_FLOW_CLIP_SECONDS: 6, AGENT_FLOW_VIDEO_APPS: "", AGENT_FLOW_ASK_REPLY_MIC: "",
});
const CAN = { v: 1, can: ["picture", "clip"] as Array<"picture" | "clip"> };
const req = (utterance: string, o: Partial<AgentStepRequest> = {}): AgentStepRequest => ({
  runId: "run_flow01", step: 0, platform: "mac", app: "Keynote", utterance,
  screen: { elements: [{ id: "e1", role: "button", label: "Export" }, { id: "e2", role: "button", label: "Send" }] }, ...o,
});

async function step(r: AgentStepRequest, o: { flow?: typeof POLICY | null; plan?: string; image?: boolean } = {}) {
  const sent: AgentEvent[] = [];
  let planned = 0;
  await runStep({
    req: r, maxSteps: 8, names: ["X0"], ...(o.flow === null ? {} : { flow: o.flow ?? POLICY }),
    ...(o.image ? { image: { mime: "image/jpeg" as const, data: Buffer.from([0xff, 0xd8, 0xff]) } } : {}),
  }, {
    write: async () => "", rewrite: async () => "",
    plan: () => { planned++; return (async function* () { yield { delta: o.plan ?? "SAY Here it is.\nDONE\n", model: "m" }; })(); },
  }, new EventSink((l) => sent.push(JSON.parse(l))));
  return { sent, planned, flow: sent.find((e) => e.t === "flow") as Extract<AgentEvent, { t: "flow" }> | undefined };
}

describe("the flow event", () => {
  it("is sent only to a request that asks for it, right after heard", async () => {
    const off = await step(req("what does export do?"));
    expect(off.flow).toBeUndefined();
    const on = await step(req("what does export do?", { flow: { v: 1 } }));
    expect(on.sent.map((e) => e.t).slice(0, 2)).toEqual(["heard", "flow"]);
    expect(on.flow).toEqual({ t: "flow", v: 1, afterAnswer: "listen", idleMs: 120000, trusted: false, media: "none" });
    const noPolicy = await step(req("what does export do?", { flow: { v: 1 } }), { flow: null });
    expect(noPolicy.flow).toBeUndefined();
  });

  it("a command is trusted unless it pays or deletes; a question never is", () => {
    const f = (said: string) => decideFlow(POLICY, { req: req(said, { flow: { v: 1 } }), said, first: said, mode: said.endsWith("?") ? "show" : "do", all: said, names: [], media: false });
    expect(f("open Chrome").trusted).toBe(true);
    expect(f("delete this file").trusted).toBe(false);
    expect(f("pay rahul 500").trusted).toBe(false);
    expect(f("where is export?").trusted).toBe(false);
  });

  it("thread policy and the ASK microphone come from config", () => {
    const p = flowPolicy({ AGENT_FLOW_LISTEN_AFTER: "question", AGENT_FLOW_IDLE_MS: 30000, AGENT_FLOW_TRUST_COMMANDS: false, AGENT_FLOW_MEDIA: false, AGENT_FLOW_CLIP_SECONDS: 4, AGENT_FLOW_VIDEO_APPS: "", AGENT_FLOW_ASK_REPLY_MIC: "key" });
    const said = "open Chrome";
    const cmd = decideFlow(p, { req: req(said, { flow: CAN }), said, first: said, mode: "do", all: said, names: [], media: false });
    expect(cmd).toEqual({ v: 1, afterAnswer: "close", trusted: false, askReplyMic: "key" });
    const q = "write me a poem about rain";
    const words = decideFlow(POLICY, { req: req(q, { flow: CAN }), said: q, first: q, mode: "show", all: q, names: [], media: false });
    expect(words.afterAnswer).toBe("listen");
  });
});

describe("media: clip, picture or none", () => {
  it("the desktop's rules: something moving in a player, or a video named, is a clip; something drawn is a picture", () => {
    expect(wantsClip("what's happening?", "VLC")).toBe(true);
    expect(wantsClip("what's happening?", "Chrome: YouTube")).toBe(true);
    expect(wantsClip("what's happening?", "Slack")).toBe(false);
    expect(wantsClip("what's happening in this video?", "Chrome")).toBe(true);
    expect(wantsClip("pause the video", "VLC")).toBe(false);
    expect(wantsClip("where's the video settings?", "VLC")).toBe(false);
    expect(wantsClip("what's happening?", "Maxwell's notes", [], PLAYERS)).toBe(false);
    expect(isVisualQuestion("explain this equation")).toBe(true);
    expect(isVisualQuestion("what's this?")).toBe(true);
    expect(isVisualQuestion("where's the chart")).toBe(false);
    expect(isVisualQuestion("how do I insert an image")).toBe(false);
  });

  it("a clip the words want ends the step in look, before any model", async () => {
    const r = await step(req("what's happening in this video?", { app: "VLC", flow: CAN }));
    expect(r.sent.map((e) => e.t)).toEqual(["heard", "flow", "look"]);
    expect(r.flow).toMatchObject({ media: "clip", clipSeconds: 6, trusted: false });
    expect(r.planned).toBe(0);
  });

  it("only a kind the device offered; never a clip of a private window; nothing once offered nothing", async () => {
    const pic = await step(req("what's happening in this video?", { app: "VLC", flow: { v: 1, can: ["picture"] } }));
    expect(pic.flow?.media).toBe("none");
    const eq = await step(req("explain this equation", { flow: { v: 1, can: ["picture"] } }));
    expect(eq.flow?.media).toBe("picture");
    expect(eq.sent.at(-1)).toEqual({ t: "look", why: "something drawn" });
    const priv = await step(req("what's happening in this video?", { app: "VLC", privateWindow: true, flow: CAN }));
    expect(priv.flow?.media).toBe("none");
    const again = await step(req("explain this equation", { flow: { v: 1 } }));
    expect(again.flow?.media).toBe("none");
    expect(again.planned).toBe(1);
  });

  it("a step with a picture is answered from it, and asks for nothing more", async () => {
    const r = await step(req("explain this equation", { flow: { v: 1 }, picture: { region: "element" } }), { image: true });
    expect(r.flow).toEqual({ t: "flow", v: 1, afterAnswer: "listen", idleMs: 120000, trusted: false });
    expect(r.sent.some((e) => e.t === "look")).toBe(false);
  });

  it("the request's flow is read: a version from 1, only the two kinds, nothing offered beside a picture", () => {
    expect(readFlowAsk({ v: 1, can: ["clip", "picture", "audio", "clip"] })).toEqual({ v: 1, can: ["clip", "picture"] });
    expect(readFlowAsk({ v: 0 })).toBeNull();
    expect(readFlowAsk({ v: "1" })).toBeNull();
    expect(readFlowAsk({ v: 2, can: ["clip"] }, true)).toEqual({ v: 2 });
  });
});

describe("trusted on the server's own risk", () => {
  const browser = req("send it", { app: "Google Chrome" });
  it("ordinary steps of a trusted command are free; untrusted they ask as before", () => {
    const t = { req: browser, said: "send it", trusted: true };
    const u = { req: browser, said: "send it" };
    expect(riskOf({ kind: "press", id: "e2" }, t)).toBe("free");
    expect(riskOf({ kind: "press", id: "e2" }, u)).toBe("confirm");
    expect(riskOf({ kind: "open", app: "Slack" }, t)).toBe("free");
    expect(riskOf({ kind: "open", app: "Slack" }, u)).toBe("confirm");
  });
  it("the floors hold whatever: paying, deleting, signing out, the chords that close or quit", () => {
    const r = req("do it", { screen: { elements: [{ id: "e1", role: "button", label: "Delete account" }, { id: "e2", role: "button", label: "Sign out" }, { id: "e3", role: "button", label: "Pay now" }] } });
    const t = { req: r, said: "do it", trusted: true };
    expect(riskOf({ kind: "press", id: "e1" }, t)).toBe("always");
    expect(riskOf({ kind: "press", id: "e3" }, t)).toBe("always");
    expect(riskOf({ kind: "press", id: "e2" }, t)).toBe("confirm");
    expect(riskOf({ kind: "key", keys: "cmd+q" }, t)).toBe("confirm");
    expect(riskOf({ kind: "key", keys: "cmd+enter" }, t)).toBe("confirm");
  });
  it("a trusted command's action comes out free from the step itself", async () => {
    const r = await step(req("open Slack", { flow: { v: 1 } }));
    expect(r.flow?.trusted).toBe(true);
    expect(r.sent.at(-1)).toMatchObject({ t: "action", kind: "open", risk: "free" });
    const old = await step(req("open Slack"));
    expect(old.sent.at(-1)).toMatchObject({ t: "action", kind: "open", risk: "confirm" });
  });
});
