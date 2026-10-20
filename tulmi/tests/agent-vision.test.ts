/**
 * The picture path's models: each family asked the way it allows, the ladder
 * as production configures it, OpenRouter's provider routing, and Gemini's
 * own order for places in a picture, taught in its prompt and read back from
 * its answer, with the fallback's answer still read the generic way.
 *
 * The model is a fake that streams what a test gives it, per model, so what
 * is checked is the request each rung is sent and how its answer is read.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.AGENT_VISION_TIMEOUT_MS = "500";

/** What a model streams: chunks of text, or "throw" for a 503 before any. */
type Plan = string[] | "throw";
const llm = vi.hoisted(() => ({
  calls: [] as Array<Record<string, any>>,
  plans: new Map<string, Plan>(),
  plan: ["DONE"] as Plan,
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.calls.push(body);
          const plan = llm.plans.get(body.model) ?? llm.plan;
          if (plan === "throw") throw Object.assign(new Error("upstream 503"), { status: 503 });
          return (async function* () {
            for (const c of plan) yield { choices: [{ delta: { content: c } }], provider: "Fake Cloud" };
            yield { choices: [], usage: { prompt_tokens: 3200, completion_tokens: 140, completion_tokens_details: { reasoning_tokens: 40 } } };
          })();
        },
      },
    };
  },
}));

const { AGENT_SYSTEM, AGENT_VISION_SYSTEM, AGENT_VISION_SYSTEM_GEMINI, drawOrderFor, visionSystemFor } = await import("../src/agent/prompt.js");
const { planStream, plannerRequest, providerSortOf, reasoningFor, temperatureFor, visionLadder } = await import("../src/agent/llm.js");
const { parseDraw, parseLine } = await import("../src/agent/lines.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { runStep } = await import("../src/agent/run.js");
const { resetConfigForTests } = await import("../src/config.js");
import type { AgentStepRequest } from "../../shared/types/api.js";
import type { CallRecord } from "../src/agent/llm.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PICTURE = { mime: "image/jpeg" as const, data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) };
const REQ: AgentStepRequest = {
  runId: "run_vision1", step: 0, platform: "mac", app: "Preview", utterance: "how long is the long side?",
  picture: { region: "element" },
  screen: { elements: [{ id: "e6", role: "image", region: "c" }, { id: "o1", role: "text", label: "c = ?", region: "c" }] },
};

/** One picture step through the real run and the real planStream. */
async function pictureStep(req: AgentStepRequest = REQ) {
  const sent: Array<Record<string, any>> = [];
  const calls: CallRecord[] = [];
  const result = await runStep({ req, maxSteps: 8, image: PICTURE }, {
    write: async () => "",
    rewrite: async () => "",
    plan: (system, user, signal, picture) => planStream(system, user, { signal, picture, log: (c) => calls.push(c) }),
  }, new EventSink((l) => sent.push(JSON.parse(l))));
  return { sent, calls, result };
}

function withEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
}

beforeEach(() => {
  llm.calls.length = 0;
  llm.plans.clear();
  llm.plan = ["DONE"];
  withEnv({ AGENT_VISION_MODEL: undefined, AGENT_VISION_FALLBACK_MODELS: undefined, AGENT_VISION_DEEP_MODEL: undefined, AGENT_VISION_PROVIDER_SORT: undefined, CLEANUP_MODEL: undefined });
});

describe("reasoning and sampling, per family", () => {
  const USER = "u";
  it.each([
    ["anthropic/claude-haiku-5.5", { effort: "none", enabled: false }, undefined],
    ["google/gemini-2.5-flash", { effort: "none" }, 0],
    ["google/gemini-2.5-flash-lite", { effort: "none" }, 0],
    ["google/gemini-2.5-pro", { effort: "low" }, 0],
    ["google/gemini-3.8-flash", { effort: "low" }, undefined],
    ["google/gemini-3.1-flash-lite", { effort: "low" }, undefined],
    ["google/gemini-4-argon", { effort: "low" }, undefined],
    ["openai/gpt-6-luna", { effort: "none" }, 0],
    ["openai/gpt-5.4-mini", { effort: "none" }, 0],
  ])("%s: reasoning %j, temperature %s", (model, reasoning, temperature) => {
    expect(reasoningFor(model)).toEqual(reasoning);
    expect(temperatureFor(model)).toBe(temperature);
    const body = plannerRequest(model, AGENT_VISION_SYSTEM, USER) as Record<string, any>;
    expect(body.reasoning).toEqual(reasoning);
    if (temperature === undefined) expect("temperature" in body).toBe(false);
    else expect(body.temperature).toBe(temperature);
  });

  it("the system bytes are what they were given, for every family, cache-marked only for anthropic", () => {
    for (const model of ["anthropic/claude-haiku-5.5", "google/gemini-2.5-flash", "google/gemini-3.8-flash", "openai/gpt-6-luna"]) {
      for (const system of [AGENT_SYSTEM, AGENT_VISION_SYSTEM, AGENT_VISION_SYSTEM_GEMINI]) {
        const content = (plannerRequest(model, system, "u") as Record<string, any>).messages[0].content;
        const text = typeof content === "string" ? content : content[0].text;
        expect(text).toBe(system);
        expect(typeof content === "string").toBe(!model.startsWith("anthropic/"));
      }
    }
  });

  it("a Gemini 3 model on the ladder is asked to think a little, not refused for 'none', and keeps its own temperature", async () => {
    withEnv({ AGENT_VISION_MODEL: "google/gemini-3.8-flash" });
    llm.plan = ["SAY The long side is 5.\nDONE"];
    const { sent } = await pictureStep();
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe("google/gemini-3.8-flash");
    expect(llm.calls[0]!.reasoning).toEqual({ effort: "low" });
    expect("temperature" in llm.calls[0]!).toBe(false);
    expect(llm.calls[0]!.messages[0].content).toBe(AGENT_VISION_SYSTEM_GEMINI);
    expect(sent.at(-1)).toEqual({ t: "done" });
  });
});

describe("the ladder, as production configures it", () => {
  it("defaults: the Gemini model, the anthropic one behind it; the deep model is the same model, so it is not tried twice", () => {
    expect(visionLadder()).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini"]);
    expect(visionLadder(true)).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini"]);
  });

  it("with CLEANUP_MODEL the same as the primary, as it is in production, each model is tried once, in its first place", async () => {
    withEnv({ CLEANUP_MODEL: "google/gemini-2.5-flash" });
    expect(visionLadder()).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"]);
    expect(visionLadder(true)).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"]);
    llm.plan = "throw";
    const { sent } = await pictureStep();
    expect(llm.calls.map((c) => c.model)).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"]);
    expect(sent.at(-1)).toMatchObject({ t: "error", code: "model_unavailable" });
  });

  it("a model named twice in the env is still tried once", () => {
    withEnv({ AGENT_VISION_FALLBACK_MODELS: " google/gemini-2.5-flash , anthropic/claude-haiku-5.5,anthropic/claude-haiku-5.5" });
    expect(visionLadder()).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini"]);
  });
});

describe("provider routing", () => {
  it("picture requests ask for the lowest-latency provider by default", async () => {
    llm.plan = ["SAY Five.\nDONE"];
    await pictureStep();
    expect(llm.calls[0]!.provider).toEqual({ sort: "latency" });
  });

  it("an empty AGENT_VISION_PROVIDER_SORT sends no provider field at all", async () => {
    withEnv({ AGENT_VISION_PROVIDER_SORT: "" });
    llm.plan = ["SAY Five.\nDONE"];
    await pictureStep();
    expect("provider" in llm.calls[0]!).toBe(false);
  });

  it("another sort is passed as it is; the text path never sends one", async () => {
    withEnv({ AGENT_VISION_PROVIDER_SORT: "throughput" });
    llm.plan = ["SAY Five.\nDONE"];
    await pictureStep();
    expect(llm.calls[0]!.provider).toEqual({ sort: "throughput" });
    llm.calls.length = 0;
    for await (const _ of planStream(AGENT_SYSTEM, "u")) { /* read it */ }
    expect("provider" in llm.calls[0]!).toBe(false);
    expect(plannerRequest("openai/gpt-6-luna", AGENT_SYSTEM, "u")).not.toHaveProperty("provider");
  });

  it("a setting OpenRouter would not understand is sent as no preference, so it cannot fail every picture question", async () => {
    for (const bad of ["none", "fastest", "latency,price"]) {
      withEnv({ AGENT_VISION_PROVIDER_SORT: bad });
      llm.calls.length = 0;
      llm.plan = ["SAY Five.\nDONE"];
      const { sent } = await pictureStep();
      expect("provider" in llm.calls[0]!, bad).toBe(false);
      expect(sent.at(-1)).toEqual({ t: "done" });
    }
    // Written in another case or with spaces round it, a real sort is still that sort.
    withEnv({ AGENT_VISION_PROVIDER_SORT: " Latency " });
    llm.calls.length = 0;
    await pictureStep();
    expect(llm.calls[0]!.provider).toEqual({ sort: "latency" });
    expect(providerSortOf("price")).toBe("price");
    expect(providerSortOf(undefined)).toBe("");
    expect(plannerRequest("google/gemini-2.5-flash", AGENT_VISION_SYSTEM, "u", 450, { providerSort: "none" })).not.toHaveProperty("provider");
  });

  it("the call's log line says who served it and what it spent thinking", async () => {
    llm.plan = ["SAY Five.\nDONE"];
    const { calls } = await pictureStep();
    expect(calls).toEqual([expect.objectContaining({ model: "google/gemini-2.5-flash", outcome: "ok", provider: "Fake Cloud", promptTokens: 3200, completionTokens: 140, reasoningTokens: 40, picture: true })]);
  });
});

describe("Gemini's order for places in the picture", () => {
  it("a box [ymin,xmin,ymax,xmax] and a point [y,x] become the same [x,y,w,h] and [x,y] the device always gets", () => {
    expect(parseDraw("BOX [100,200,300,500]", { order: "yx" })).toEqual({ kind: "box", target: { box: [200, 100, 300, 200] } });
    expect(parseDraw("CIRCLE [790,160,840,210] \"90°\"", { order: "yx" })).toEqual({ kind: "circle", target: { box: [160, 790, 50, 50] }, text: "90°" });
    expect(parseDraw("NUMBER [620,150] 2", { order: "yx" })).toEqual({ kind: "number", target: { pt: [150, 620] }, n: 2 });
    expect(parseDraw("NUMBER (620, 150) 2", { order: "yx" })).toEqual({ kind: "number", target: { pt: [150, 620] }, n: 2 });
    expect(parseDraw("ARROW [450,640] -> [620,450] \"c\"", { order: "yx" })).toEqual({ kind: "arrow", from: { pt: [640, 450] }, to: { pt: [450, 620] }, text: "c" });
    expect(parseDraw("LABEL [900,450] \"√25\"", { order: "yx" })).toEqual({ kind: "label", target: { pt: [450, 900] }, text: "√25" });
    expect(parseDraw("PATH [820,180] [420,180] [820,720] CLOSED", { order: "yx" })).toEqual({ kind: "path", points: [[180, 820], [180, 420], [720, 820]], closed: true });
    // Ids are ids in either order.
    expect(parseDraw("ARROW o1 -> e6", { order: "yx" })).toEqual({ kind: "arrow", from: { id: "o1" }, to: { id: "e6" } });
    // And the generic order is unchanged, and still the default.
    expect(parseDraw("BOX [100,200,300,500]")).toEqual({ kind: "box", target: { box: [100, 200, 300, 500] } });
    expect(parseDraw("NUMBER (620,150) 2", { order: "xy" })).toEqual({ kind: "number", target: { pt: [620, 150] }, n: 2 });
  });

  it("corners written the wrong way round are put right; a box stays at least 4 and inside the picture", () => {
    expect(parseDraw("BOX [300,500,100,200]", { order: "yx" })).toEqual({ kind: "box", target: { box: [200, 100, 300, 200] } });
    expect(parseDraw("BOX [100,500,300,200]", { order: "yx" })).toEqual({ kind: "box", target: { box: [200, 100, 300, 200] } });
    // A box with no size is a box BOX_MIN across, not nothing.
    expect(parseDraw("BOX [400,400,400,400]", { order: "yx" })).toEqual({ kind: "box", target: { box: [400, 400, 4, 4] } });
    // Past the edge is clamped to it; a box at the very edge keeps its size inside.
    expect(parseDraw("BOX [-20,950,1200,1100]", { order: "yx" })).toEqual({ kind: "box", target: { box: [950, 0, 50, 1000] } });
    expect(parseDraw("BOX [1000,1000,1000,1000]", { order: "yx" })).toEqual({ kind: "box", target: { box: [996, 996, 4, 4] } });
    // Fractions of the picture are still no spot at all.
    expect(parseDraw("BOX [0.1,0.2,0.3,0.4]", { order: "yx" })).toBeNull();
  });

  it("parseLine passes the order to the DRAW it reads, and nothing else changes", () => {
    expect(parseLine("DRAW UNDERLINE [600,135,640,165]", "mac", { order: "yx" })).toEqual({ verb: "DRAW", draw: { kind: "underline", target: { box: [135, 600, 30, 40] } } });
    expect(parseLine("SAY [1,2]", "mac", { order: "yx" })).toEqual({ verb: "SAY", text: "[1,2]" });
  });

  it("which order is whose: Gemini models are taught y first and read y first; every other model x first", () => {
    for (const m of ["google/gemini-2.5-flash", "google/gemini-3.8-flash", "google/gemini-4-argon"]) {
      expect(drawOrderFor(m)).toBe("yx");
      expect(visionSystemFor(m)).toBe(AGENT_VISION_SYSTEM_GEMINI);
    }
    for (const m of ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "openai/gpt-5.4-mini"]) {
      expect(drawOrderFor(m)).toBe("xy");
      expect(visionSystemFor(m)).toBe(AGENT_VISION_SYSTEM);
    }
  });
});

describe("the two vision prompts", () => {
  it("the generic prompts are byte for byte what they were before Gemini had its own", () => {
    // sha256 of AGENT_SYSTEM and AGENT_VISION_SYSTEM at cdb6b21.
    expect(sha(AGENT_SYSTEM)).toBe("e0f10e6a7f626a7471e4e539de5e7c18e3a5f266e727234acb3ffc70249af7b8");
    expect(sha(AGENT_VISION_SYSTEM)).toBe("2a3e881e5d718ed75e34d13c1bfa3106b50a75b93af0a07b70d2b0756ee5a0d2");
  });

  it("Gemini's differs only in how places in the picture are written", () => {
    const generic = AGENT_VISION_SYSTEM.split("\n");
    const gemini = AGENT_VISION_SYSTEM_GEMINI.split("\n");
    expect(gemini).toHaveLength(generic.length);
    const differ = generic.flatMap((l, i) => (l === gemini[i] ? [] : [i]));
    // The PATH syntax, what a spot is, and the worked triangle's description
    // and its four marks: nothing else.
    expect(differ).toHaveLength(7);
    for (const i of differ) {
      expect(generic[i], generic[i]).toMatch(/\(\d+,\d+\)|\[\d+,\d+,\d+,\d+\]|\(x,y\)|\[x,y,w,h\]/);
      expect(gemini[i], gemini[i]).toMatch(/\[\d+,\d+\]|\[\d+,\d+,\d+,\d+\]|\[y,x\]|\[ymin,xmin,ymax,xmax\]/);
      expect(gemini[i]).not.toMatch(/\(\d+,\d+\)|\(x,y\)/);
    }
    // Ids are written as ids in both.
    expect(AGENT_VISION_SYSTEM_GEMINI).toContain("an id from the list (e12, o3)");
    expect(AGENT_VISION_SYSTEM_GEMINI).toContain("POINT o4 | Load balancer");
  });

  it("each is the same bytes for two different requests, whichever the ladder reaches", async () => {
    llm.plan = ["SAY Five.\nDONE"];
    await pictureStep();
    await pictureStep({ ...REQ, app: "Microsoft Edge", platform: "win", language: "es", utterance: "¿qué es esto?", picture: { region: "window" } });
    llm.plans.set("google/gemini-2.5-flash", "throw");
    await pictureStep();
    await pictureStep({ ...REQ, app: "Notes", utterance: "walk me through this step by step" });
    const system = (c: Record<string, any>) => (typeof c.messages[0].content === "string" ? c.messages[0].content : c.messages[0].content[0].text);
    const gemini = llm.calls.filter((c) => c.model === "google/gemini-2.5-flash").map(system);
    const haiku = llm.calls.filter((c) => c.model === "anthropic/claude-haiku-5.5").map(system);
    expect(gemini).toEqual([AGENT_VISION_SYSTEM_GEMINI, AGENT_VISION_SYSTEM_GEMINI, AGENT_VISION_SYSTEM_GEMINI, AGENT_VISION_SYSTEM_GEMINI]);
    expect(haiku).toEqual([AGENT_VISION_SYSTEM, AGENT_VISION_SYSTEM]);
  });
});

describe("one answer, one model's order", () => {
  it("a Gemini answer's marks are read y first", async () => {
    llm.plan = ["SAY The long side is 5.\nDRAW CIRCLE [790,160,840,210] \"90°\"\nDRAW ARROW o1 -> [620,450]\nDONE"];
    const { sent, result } = await pictureStep();
    expect(result.model).toBe("google/gemini-2.5-flash");
    expect(sent.filter((e) => e.t === "draw")).toEqual([
      { t: "draw", kind: "circle", target: { box: [160, 790, 50, 50] }, text: "90°" },
      { t: "draw", kind: "arrow", from: { id: "o1" }, to: { pt: [450, 620] } },
    ]);
  });

  it("a Haiku answer after a Gemini failure is read x first, with the generic prompt", async () => {
    llm.plans.set("google/gemini-2.5-flash", "throw");
    llm.plan = ["SAY The long side is 5.\nDRAW CIRCLE [160,790,50,50] \"90°\"\nDRAW ARROW o1 -> (450,620)\nDONE"];
    const { sent, result, calls } = await pictureStep();
    expect(calls.map((c) => [c.model, c.outcome])).toEqual([["google/gemini-2.5-flash", "failed"], ["anthropic/claude-haiku-5.5", "ok"]]);
    expect(result.model).toBe("anthropic/claude-haiku-5.5");
    expect(llm.calls[1]!.messages[0].content).toEqual([{ type: "text", text: AGENT_VISION_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(sent.filter((e) => e.t === "draw")).toEqual([
      { t: "draw", kind: "circle", target: { box: [160, 790, 50, 50] }, text: "90°" },
      { t: "draw", kind: "arrow", from: { id: "o1" }, to: { pt: [450, 620] } },
    ]);
  });

  it("a mark split across chunks is read in its model's order when it is whole", async () => {
    llm.plan = ["SAY Here.\nDRAW NUMBER [6", "20,15", "0] 1\nDONE"];
    const { sent } = await pictureStep();
    expect(sent.filter((e) => e.t === "draw")).toEqual([{ t: "draw", kind: "number", target: { pt: [150, 620] }, n: 1 }]);
  });

  it("the text path reads x first whoever answers, and drops places in a picture it has none of", async () => {
    const req: AgentStepRequest = { ...REQ, picture: undefined, utterance: "what is this?", screen: { elements: REQ.screen.elements } };
    const sent: Array<Record<string, any>> = [];
    llm.plan = ["SAY It's a picture.\nDRAW CIRCLE e6\nDRAW CIRCLE [790,160,840,210]\nDONE"];
    const result = await runStep({ req, maxSteps: 8 }, {
      write: async () => "", rewrite: async () => "",
      plan: (system, user, signal, picture) => planStream(system, user, { signal, picture, models: ["google/gemini-2.5-flash"] }),
    }, new EventSink((l) => sent.push(JSON.parse(l))));
    expect(llm.calls[0]!.messages[0].content).toBe(AGENT_SYSTEM);
    expect(sent.filter((e) => e.t === "draw")).toEqual([{ t: "draw", kind: "circle", target: { id: "e6" } }]);
    expect(result).toMatchObject({ draws: 1, drawsDropped: 1 });
  });
});
