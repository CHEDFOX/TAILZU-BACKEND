/**
 * Ask's pen: the DRAW line on both paths. How a line is read (every kind,
 * every form of spot, the lenient spellings a small model writes), what is
 * kept of it (ids from this screen, places in the picture only on a step
 * that has one, picture numbers inside the picture, the caps and the label's
 * length), and that marks go out among the sentences in the order they were
 * written, as soon as each line is whole. Then the prompts: both teach DRAW
 * and both are still the same bytes for every request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.AGENT_TIMEOUT_MS = "500";
process.env.AGENT_VISION_TIMEOUT_MS = "500";
process.env.AGENT_IMAGE_MAX_BYTES = "50000";
process.env.AGENT_RATE_LIMIT_MAX = "1000";

/** Chunks the fake model streams; a number is a pause of that many ms. */
const llm = vi.hoisted(() => ({
  calls: [] as Array<{ body: Record<string, any> }>,
  plan: ["DONE"] as Array<string | number>,
}));

vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (body: Record<string, any>, opts?: Record<string, any>) => {
          llm.calls.push({ body });
          if (!body.stream) return { choices: [{ message: { content: "written" } }] };
          const signal: AbortSignal | undefined = opts?.signal;
          return (async function* () {
            for (const c of llm.plan) {
              if (typeof c === "number") { await new Promise((r) => setTimeout(r, c)); continue; }
              if (signal?.aborted) throw new Error("aborted");
              yield { choices: [{ delta: { content: c } }] };
            }
            yield { choices: [], usage: { prompt_tokens: 1400, completion_tokens: 12 } };
          })();
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.mock("groq-sdk", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "", segments: [] }) } };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { LineReader, LABEL_MAX, PATH_MAX, parseDraw, parseLine } = await import("../src/agent/lines.js");
const { AGENT_SYSTEM, AGENT_VISION_SYSTEM } = await import("../src/agent/prompt.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { runStep } = await import("../src/agent/run.js");
const { getConfig } = await import("../src/config.js");
const { buildApp } = await import("../src/server.js");
import type { AgentEvent, AgentStepRequest } from "../../shared/types/api.js";

type Ev = Record<string, any>;
const TERMINAL = new Set(["action", "ask", "look", "done", "error"]);

const draw = (line: string) => {
  const l = parseLine(line, "mac");
  expect(l?.verb, line).toBe("DRAW");
  return (l as { verb: "DRAW"; draw: unknown }).draw;
};

describe("a DRAW line, read", () => {
  it("every kind parses, with its label where it has one", () => {
    expect(draw('DRAW BOX e12 "Export"')).toEqual({ kind: "box", target: { id: "e12" }, text: "Export" });
    expect(draw('DRAW CIRCLE [160,790,50,50] "90°"')).toEqual({ kind: "circle", target: { box: [160, 790, 50, 50] }, text: "90°" });
    expect(draw("DRAW UNDERLINE o3")).toEqual({ kind: "underline", target: { id: "o3" } });
    expect(draw("DRAW HIGHLIGHT [100,200,300,40]")).toEqual({ kind: "highlight", target: { box: [100, 200, 300, 40] } });
    expect(draw('DRAW ARROW (640,450) -> (450,620) "c, what we want"')).toEqual({
      kind: "arrow", from: { pt: [640, 450] }, to: { pt: [450, 620] }, text: "c, what we want",
    });
    expect(draw("DRAW NUMBER e40 1")).toEqual({ kind: "number", target: { id: "e40" }, n: 1 });
    expect(draw('DRAW LABEL (500,200) "hypotenuse"')).toEqual({ kind: "label", target: { pt: [500, 200] }, text: "hypotenuse" });
    expect(draw('DRAW PATH (180,820) (180,420) (720,820) CLOSED "the triangle"')).toEqual({
      kind: "path", points: [[180, 820], [180, 420], [720, 820]], closed: true, text: "the triangle",
    });
    expect(draw("DRAW PATH (180,420) (720,820)")).toEqual({ kind: "path", points: [[180, 420], [720, 820]] });
    expect(draw("DRAW CLEAR")).toEqual({ kind: "clear" });
  });

  it("spots: an id, a box and a point, in the spellings a model writes them", () => {
    // Spaces, commas and semicolons between numbers; brackets or parentheses;
    // names in front of the numbers; ids in either case.
    expect(draw("DRAW BOX [ 10 , 20 , 30 , 40 ]")).toMatchObject({ target: { box: [10, 20, 30, 40] } });
    expect(draw("DRAW BOX [10 20 30 40]")).toMatchObject({ target: { box: [10, 20, 30, 40] } });
    expect(draw("DRAW BOX (10;20;30;40)")).toMatchObject({ target: { box: [10, 20, 30, 40] } });
    expect(draw("DRAW BOX (x=10, y=20, w=30, h=40)")).toMatchObject({ target: { box: [10, 20, 30, 40] } });
    expect(draw("DRAW CIRCLE ( 500 ,  250 )")).toMatchObject({ target: { pt: [500, 250] } });
    expect(draw("DRAW CIRCLE [500, 250]")).toMatchObject({ target: { pt: [500, 250] } });
    expect(draw("DRAW CIRCLE (x: 500, y: 250)")).toMatchObject({ target: { pt: [500, 250] } });
    expect(draw("DRAW CIRCLE E12")).toMatchObject({ target: { id: "e12" } });
    expect(draw("DRAW CIRCLE (499.6, 250.4)")).toMatchObject({ target: { pt: [500, 250] } });
    // "(12)" is not the point (1, 2): two numbers need something between them.
    expect(draw("DRAW CIRCLE (12)")).toBeNull();
    expect(draw("DRAW CIRCLE e12abc")).toBeNull();
  });

  it("the arrow in any of its spellings, or none, and from … to", () => {
    for (const line of ["DRAW ARROW e5 -> e9", "DRAW ARROW e5 → e9", "DRAW ARROW e5 to e9", "DRAW ARROW e5 TO e9", "DRAW ARROW e5 --> e9",
      "DRAW ARROW e5 => e9", "DRAW ARROW e5 — e9", "DRAW ARROW e5, e9", "DRAW ARROW e5 e9", "DRAW ARROW from e5 to e9", "DRAW ARROW e5->e9"]) {
      expect(draw(line), line).toEqual({ kind: "arrow", from: { id: "e5" }, to: { id: "e9" } });
    }
    expect(draw("DRAW ARROW e5 -> (300,400)")).toEqual({ kind: "arrow", from: { id: "e5" }, to: { pt: [300, 400] } });
    expect(draw("DRAW ARROW [1,2,30,40] → e9")).toEqual({ kind: "arrow", from: { box: [1, 2, 30, 40] }, to: { id: "e9" } });
    // A chain draws its first link; the rest is not written on the screen as
    // a label of "> e10".
    for (const line of ["DRAW ARROW e5 -> e9 -> e10", "DRAW ARROW e5 → e9 → (3,4)", "DRAW ARROW e5 to e9 to e10"]) {
      expect(draw(line), line).toEqual({ kind: "arrow", from: { id: "e5" }, to: { id: "e9" } });
    }
    // Words after it that are not another end are still its label.
    expect(draw("DRAW ARROW e5 -> e9 to the total")).toEqual({ kind: "arrow", from: { id: "e5" }, to: { id: "e9" }, text: "to the total" });
  });

  it("quotes straight or curly, a separator before the label, or none at all", () => {
    for (const line of ['DRAW CIRCLE e5 "90°"', "DRAW CIRCLE e5 “90°”", "DRAW CIRCLE e5 '90°'", "DRAW CIRCLE e5 ‘90°’", "DRAW CIRCLE e5 | 90°",
      "DRAW CIRCLE e5: 90°", "DRAW CIRCLE e5 90°", 'DRAW CIRCLE e5 "90°', "DRAW CIRCLE e5 „90°“", "DRAW CIRCLE e5 «90°»"]) {
      expect(draw(line), line).toEqual({ kind: "circle", target: { id: "e5" }, text: "90°" });
    }
    // An apostrophe inside is the label's own.
    expect(draw("DRAW LABEL e5 \"what's this\"")).toMatchObject({ text: "what's this" });
    expect(draw("DRAW LABEL e5 'it's here'")).toMatchObject({ text: "it's here" });
  });

  it("bullets, bold and a colon a model adds, and the kinds' near misses", () => {
    expect(draw("- **DRAW** CIRCLE e5")).toEqual({ kind: "circle", target: { id: "e5" } });
    expect(draw("DRAW: circle e5")).toEqual({ kind: "circle", target: { id: "e5" } });
    expect(draw("DRAW RECT e3")).toEqual({ kind: "box", target: { id: "e3" } });
    expect(draw("DRAW ELLIPSE e3")).toEqual({ kind: "circle", target: { id: "e3" } });
    expect(draw("DRAW LINE (1,2) (3,4)")).toEqual({ kind: "path", points: [[1, 2], [3, 4]] });
    // A path's points may be joined by commas and arrows too.
    expect(draw("DRAW PATH (1,2), (3,4) -> (5,6) → (7,8) closed")).toEqual({ kind: "path", points: [[1, 2], [3, 4], [5, 6], [7, 8]], closed: true });
    // Prose that starts with "Draw" is prose.
    expect(parseLine("Draw a circle around the export button.", "mac")).toBeNull();
  });

  it("NUMBER: 1 to 9, after the spot as written or before it", () => {
    expect(draw("DRAW NUMBER 2 e8")).toEqual({ kind: "number", target: { id: "e8" }, n: 2 });
    expect(draw("DRAW NUMBER e8 #3")).toEqual({ kind: "number", target: { id: "e8" }, n: 3 });
    expect(draw('DRAW NUMBER (300,400) 4 "Data"')).toEqual({ kind: "number", target: { pt: [300, 400] }, n: 4, text: "Data" });
    for (const line of ["DRAW NUMBER e8 0", "DRAW NUMBER e8 10", "DRAW NUMBER e8 12", "DRAW NUMBER e8", "DRAW NUMBER 2"]) {
      expect(draw(line), line).toBeNull();
    }
  });

  it("an unreadable DRAW is still a DRAW, with no mark, so the reader counts it", () => {
    for (const line of ["DRAW", "DRAW BLOB e5", "DRAW constructor e5", "DRAW toString e5", "DRAW CIRCLE", "DRAW CIRCLE somewhere nice", "DRAW ARROW e5", "DRAW ARROW e5 -> e5",
      "DRAW LABEL (500,200)", "DRAW LABEL e5 \"\"", "DRAW PATH (1,2)", "DRAW PATH e5 e6"]) {
      expect(draw(line), line).toBeNull();
    }
  });

  it("picture numbers are whole and inside 0..1000; a box is at least 4 and is cut at the edge", () => {
    expect(draw("DRAW CIRCLE (1200, -5)")).toMatchObject({ target: { pt: [1000, 0] } });
    expect(draw("DRAW BOX [10.4, 20.6, 0, 1]")).toMatchObject({ target: { box: [10, 21, 4, 4] } });
    expect(draw("DRAW BOX [990, 100, 50, 50]")).toMatchObject({ target: { box: [990, 100, 10, 50] } });
    expect(draw("DRAW BOX [1000, 1000, 50, 50]")).toMatchObject({ target: { box: [996, 996, 4, 4] } });
    expect(draw("DRAW BOX [-50, -50, 2000, 2000]")).toMatchObject({ target: { box: [0, 0, 1000, 1000] } });
    expect(draw("DRAW PATH (-1,-1) (1001,1001)")).toMatchObject({ points: [[0, 0], [1000, 1000]] });
  });

  it("a path has 2 to 32 points", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => `(${i * 10},${i * 20})`).join(" ");
    expect(draw(`DRAW PATH ${pts(PATH_MAX)}`)).toMatchObject({ kind: "path" });
    expect((draw(`DRAW PATH ${pts(PATH_MAX)}`) as { points: unknown[] }).points).toHaveLength(32);
    expect(draw(`DRAW PATH ${pts(PATH_MAX + 1)}`)).toBeNull();
    expect(draw(`DRAW PATH ${pts(1)}`)).toBeNull();
  });

  it("a label: no control characters, no markdown, one line, at most 48, cut at a word", () => {
    expect(LABEL_MAX).toBe(48);
    expect(draw('DRAW CIRCLE e5 "  **the\tright\u0007 angle**  "')).toMatchObject({ text: "the right angle" });
    const long = draw('DRAW CIRCLE e5 "a very long label that goes on and on and on past the limit of forty eight"') as { text: string };
    expect(long.text.length).toBeLessThanOrEqual(48);
    expect(long.text).toBe("a very long label that goes on and on and on…");
    const word = draw(`DRAW LABEL e5 "${"x".repeat(80)}"`) as { text: string };
    expect(word.text).toBe("x".repeat(47) + "…");
    expect(parseDraw("CIRCLE e5 \"two\nlines\"")).toMatchObject({ text: "two lines" });
    // A cut never leaves half an emoji: a lone surrogate is drawn as a box.
    const loneHalf = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const pad of [45, 46, 47]) {
      const t = (draw(`DRAW LABEL e5 "${"a".repeat(pad)}😀😀😀😀"`) as { text: string }).text;
      expect(t.length, String(pad)).toBeLessThanOrEqual(48);
      expect(t, String(pad)).not.toMatch(loneHalf);
      expect(t.endsWith("…"), String(pad)).toBe(true);
    }
  });
});

describe("a DRAW line, kept or dropped", () => {
  const ids = new Set(["e1", "e2", "o1"]);
  const read = (lines: string[], r = new LineReader(ids, "show")) => ({ out: lines.flatMap((l) => r.read(parseLine(l, "mac")!)), r });

  it("a mark at an id on this screen is kept; at one that is not, dropped and counted", () => {
    const { out, r } = read(["DRAW CIRCLE e1", "DRAW CIRCLE e9", "DRAW ARROW e1 -> e7", "DRAW ARROW o1 -> e2 \"this\""]);
    expect(out).toEqual([
      { emit: { t: "draw", kind: "circle", target: { id: "e1" } } },
      { emit: { t: "draw", kind: "arrow", from: { id: "o1" }, to: { id: "e2" }, text: "this" } },
    ]);
    expect([r.draws, r.drawsDropped]).toEqual([2, 2]);
  });

  it("places in a picture are dropped on a step with no picture, and kept on one with it", () => {
    const lines = ["DRAW CIRCLE (500,500)", "DRAW BOX [1,2,30,40]", "DRAW ARROW e1 -> (300,300)", "DRAW PATH (1,2) (3,4)", "DRAW NUMBER e2 1"];
    const text = read(lines);
    expect(text.out).toEqual([{ emit: { t: "draw", kind: "number", target: { id: "e2" }, n: 1 } }]);
    expect(text.r.drawsDropped).toBe(4);
    const picture = read(lines, new LineReader(ids, "show", { picture: true, says: 10 }));
    expect(picture.out.map((o) => ("emit" in o ? o.emit.t : "act"))).toEqual(["draw", "draw", "draw", "draw", "draw"]);
    expect(picture.r.drawsDropped).toBe(0);
  });

  it("at most AGENT_DRAW_MAX a step: the rest are dropped and counted; a CLEAR is a mark like any other", () => {
    expect(getConfig().AGENT_DRAW_MAX).toBe(12);
    const lines = Array.from({ length: 15 }, (_, i) => (i === 3 ? "DRAW CLEAR" : `DRAW NUMBER e1 ${(i % 9) + 1}`));
    const { out, r } = read(lines);
    expect(out).toHaveLength(12);
    expect([r.draws, r.drawsDropped]).toEqual([12, 3]);
    const off = read(["DRAW CIRCLE e1", "SAY Here."], new LineReader(ids, "show", { draws: 0 }));
    expect(off.out).toEqual([{ emit: { t: "say", text: "Here." } }]);
    expect(off.r.drawsDropped).toBe(1);
  });

  it("never ends the step, in show mode or do mode, and is honoured in both; after the action nothing is", () => {
    for (const mode of ["show", "do"] as const) {
      const { out, r } = read(["SAY Press it.", "DRAW CIRCLE e1", "DRAW NUMBER e2 1"], new LineReader(ids, mode));
      expect(out.map((o) => ("emit" in o ? o.emit.t : "act"))).toEqual(["say", "draw", "draw"]);
      expect(r.ended).toBe(false);
    }
    const { out } = read(["DRAW CIRCLE e1", "PRESS e1", "DRAW CIRCLE e2"], new LineReader(ids, "do"));
    expect(out).toEqual([{ emit: { t: "draw", kind: "circle", target: { id: "e1" } } }, { act: { verb: "PRESS", id: "e1" } }]);
  });

  it("a picture's labels have their TeX written as symbols; a label that comes to nothing drops a LABEL", () => {
    const r = new LineReader(ids, "show", { picture: true });
    expect(r.read(parseLine('DRAW CIRCLE (100,100) "$c^2$"', "mac")!)).toEqual([{ emit: { t: "draw", kind: "circle", target: { pt: [100, 100] }, text: "c²" } }]);
    expect(new LineReader(ids, "show").read(parseLine('DRAW CIRCLE e1 "$c^2$"', "mac")!)).toEqual([{ emit: { t: "draw", kind: "circle", target: { id: "e1" }, text: "$c^2$" } }]);
    expect(r.read(parseLine('DRAW LABEL (100,100) "$$"', "mac")!)).toEqual([]);
    expect(r.drawsDropped).toBe(1);
  });

  it("goes through the sink as it is, between the says, and changes no step's ending", () => {
    const lines: string[] = [];
    const sink = new EventSink((l) => lines.push(l));
    sink.emit({ t: "heard", text: "how do I filter?", mode: "show" });
    sink.emit({ t: "say", text: "Select it." });
    sink.emit({ t: "draw", kind: "number", target: { id: "e1" }, n: 1 });
    sink.emit({ t: "say", text: "Then Filter." });
    sink.emit({ t: "draw", kind: "clear" });
    expect(sink.ended).toBe(false);
    sink.emit({ t: "done" });
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { t: "heard", text: "how do I filter?", mode: "show" },
      { t: "say", text: "Select it." },
      { t: "draw", kind: "number", target: { id: "e1" }, n: 1 },
      { t: "say", text: "Then Filter.", append: true },
      { t: "draw", kind: "clear" },
      { t: "done" },
    ]);
  });
});

describe("a step's marks, as the model writes them", () => {
  const REQ: AgentStepRequest = {
    runId: "run_abc123", step: 0, platform: "mac", app: "Numbers", utterance: "how do I add a filter to this column?",
    screen: { elements: [{ id: "e40", role: "cell", label: "Region", region: "c" }, { id: "e8", role: "tab", label: "Data", region: "t" }, { id: "e15", role: "button", label: "Filter", region: "t" }] },
  };
  const deps = (chunks: Array<string | (() => Promise<void>)>) => ({
    write: async () => "",
    rewrite: async () => "",
    plan: async function* () {
      for (const c of chunks) {
        if (typeof c === "function") { await c(); continue; }
        yield { model: "fake/model", delta: c };
      }
    },
  });

  it("each draw goes out the moment its line is whole, before the model has finished", async () => {
    const sent: AgentEvent[] = [];
    const sink = new EventSink((l) => sent.push(JSON.parse(l)));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let seenAtGate: string[] = [];
    const step = runStep({ req: REQ, maxSteps: 8 }, deps([
      "SAY Select the column, open Data, then press Filter.\nDRAW NUM", "BER e40 1\nDRAW NUMBER e8 2\n",
      async () => { seenAtGate = sent.map((e) => e.t); await gate; },
      "DRAW NUMBER e15 3\nDONE\n",
    ]), sink);
    await vi.waitFor(() => expect(seenAtGate.length).toBeGreaterThan(0));
    expect(seenAtGate).toEqual(["heard", "say", "draw", "draw"]);
    release();
    const result = await step;
    expect(sent.slice(1)).toEqual([
      { t: "say", text: "Select the column, open Data, then press Filter." },
      { t: "draw", kind: "number", target: { id: "e40" }, n: 1 },
      { t: "draw", kind: "number", target: { id: "e8" }, n: 2 },
      { t: "draw", kind: "number", target: { id: "e15" }, n: 3 },
      { t: "done" },
    ]);
    expect(result).toMatchObject({ path: "model", draws: 3 });
    expect(result.drawsDropped).toBeUndefined();
  });

  it("the step's result counts what was drawn and what was dropped, for the log; a step with none says nothing of it", async () => {
    const sink = new EventSink(() => {});
    const result = await runStep({ req: REQ, maxSteps: 8, drawMax: 2 }, deps([
      "SAY Here.\nDRAW CIRCLE e40\nDRAW CIRCLE e99\nDRAW CIRCLE (5,5)\nDRAW BLOB\nDRAW BOX e8\nDRAW BOX e15\nDONE\n",
    ]), sink);
    expect(result).toMatchObject({ draws: 2, drawsDropped: 4 });
    const plain = await runStep({ req: REQ, maxSteps: 8 }, deps(["SAY Here.\nDONE\n"]), new EventSink(() => {}));
    expect(plain.draws).toBeUndefined();
    expect(plain.drawsDropped).toBeUndefined();
  });

  it("an action's risk is the action's own: marks never raise it", async () => {
    const sent: Ev[] = [];
    const req: AgentStepRequest = { ...REQ, utterance: "filter this column", screen: { elements: [...REQ.screen.elements, { id: "e2", role: "button", label: "Delete column", region: "t" }] } };
    await runStep({ req, maxSteps: 8 }, deps(['SAY Opening Data.\nDRAW CIRCLE e2 "delete"\nDRAW ARROW e40 -> e2 "send it"\nPRESS e8\n']), new EventSink((l) => sent.push(JSON.parse(l))));
    expect(sent.map((e) => e.t)).toEqual(["heard", "say", "draw", "draw", "action"]);
    expect(sent.at(-1)).toEqual({ t: "action", kind: "press", id: "e8", risk: "free" });
  });
});

// ---- through the server ----------------------------------------------------------

const ELEMENTS = [
  { id: "e1", role: "button", label: "Search", region: "t" },
  { id: "e3", role: "button", label: "Export…", region: "tr" },
  { id: "e7", role: "image", region: "c" },
];
const step = (over: Record<string, unknown> = {}) => ({ runId: "run_abc123", step: 0, platform: "mac", app: "Slack", screen: { elements: ELEMENTS }, ...over });

let app: FastifyInstance;
/** What the route logged with req.log.info, for the step's log line. */
const logged: Array<{ obj: Record<string, any>; msg: string }> = [];
beforeAll(async () => {
  app = await buildApp();
  app.addHook("onRequest", async (req) => {
    const info = req.log.info.bind(req.log);
    req.log.info = ((obj: unknown, msg?: string) => {
      if (obj && typeof obj === "object") logged.push({ obj: obj as Record<string, any>, msg: String(msg ?? "") });
      return (info as (o: unknown, m?: string) => void)(obj, msg);
    }) as typeof req.log.info;
  });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  llm.calls.length = 0;
  llm.plan = ["DONE"];
  logged.length = 0;
});

function events(payload: string): Ev[] {
  const evs = payload.trim().split("\n").map((l) => JSON.parse(l) as Ev);
  expect(evs.filter((e) => TERMINAL.has(e.t))).toHaveLength(1);
  expect(TERMINAL.has(evs.at(-1)!.t)).toBe(true);
  return evs;
}
async function post(body: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/v1/agent", payload: body });
  return events(res.payload);
}
const jpeg = (size = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]);
async function postPicture(over: Record<string, unknown> = {}) {
  const b = "----draw";
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="request"\r\n\r\n${JSON.stringify(step({ picture: { region: "element" }, ...over }))}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="picture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    jpeg(),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const res = await app.inject({ method: "POST", url: "/v1/agent", payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  return events(res.payload);
}
const streamCalls = () => llm.calls.filter((c) => c.body.stream);
const systemText = (i = 0) => {
  const c = streamCalls()[i]!.body.messages[0].content;
  return typeof c === "string" ? c : c[0].text;
};

describe("the text path draws by id", () => {
  it("marks come in stream order with the says, split across chunks, and a picture place is dropped", async () => {
    llm.plan = ["SAY Export is up he", "re.\nDRAW CIR", "CLE e3 \"Export\"\nDRAW CIRCLE (500,500)\nSAY It saves a copy.\nDRAW ARROW e1 ", "-> e3\nDONE\n"];
    const evs = await post(step({ utterance: "what does export do?" }));
    expect(evs).toEqual([
      { t: "heard", text: "what does export do?", mode: "show" },
      { t: "say", text: "Export is up here." },
      { t: "draw", kind: "circle", target: { id: "e3" }, text: "Export" },
      { t: "say", text: "It saves a copy.", append: true },
      { t: "draw", kind: "arrow", from: { id: "e1" }, to: { id: "e3" } },
      { t: "done" },
    ]);
  });

  it("in a do run the marks go before the action, which is still the step's one ending", async () => {
    llm.plan = ["SAY Exporting it.\nDRAW NUMBER e3 1\nPRESS e3\nDRAW NUMBER e1 2\n"];
    const evs = await post(step({ utterance: "export this" }));
    expect(evs.map((e) => e.t)).toEqual(["heard", "say", "draw", "action"]);
    expect(evs[2]).toEqual({ t: "draw", kind: "number", target: { id: "e3" }, n: 1 });
  });
});

describe("the step's log line", () => {
  it("counts the marks drawn and the DRAW lines dropped, with nothing of what they said; a step with none says nothing of it", async () => {
    llm.plan = ["SAY Export is up here.\nDRAW CIRCLE e3 \"Export\"\nDRAW BOX e99\nDRAW CIRCLE (500,500)\nDRAW SQUIGGLE e3\nDRAW NUMBER e1 1\nDONE\n"];
    await post(step({ utterance: "what does export do?" }));
    await vi.waitFor(() => expect(logged.some((l) => l.msg === "agent step")).toBe(true));
    const line = logged.find((l) => l.msg === "agent step")!.obj.agent;
    expect(line).toMatchObject({ path: "model", ending: "done", draws: 2, drawsDropped: 3 });
    // (The agent lines: the request-completed line's raw objects are pino's to serialize.)
    expect(JSON.stringify(logged.filter((l) => l.obj.agent))).not.toMatch(/Export|e99|SQUIGGLE/);

    logged.length = 0;
    llm.plan = ["SAY It saves a copy.\nDONE\n"];
    await post(step({ utterance: "what does export do?" }));
    await vi.waitFor(() => expect(logged.some((l) => l.msg === "agent step")).toBe(true));
    const plain = logged.find((l) => l.msg === "agent step")!.obj.agent;
    expect(plain.draws).toBeUndefined();
    expect(plain.drawsDropped).toBeUndefined();
  });
});

describe("the picture path draws in the picture", () => {
  it("places in the picture and ids alike, in order with the sentences, labels as plain maths", async () => {
    llm.plan = [
      "SAY The long side is 5.\nDRAW ARROW (640,450) -> (450,620) \"c, what we want\"\n",
      "SAY In a right triangle, a² + b² = c².\nDRAW CIRCLE [160,790,50,50] \"90°\"\nDRAW UNDERLINE [135 600 30 40]\n",
      "DRAW LABEL (450,900) \"$\\sqrt{25}$\"\nDRAW BOX e9\nDRAW PATH (180,820) (180,420) (720,820) CLOSED\nSAY So c = √25 = 5.\nDONE\n",
    ];
    const evs = await postPicture({ utterance: "how long is the long side?" });
    expect(evs).toEqual([
      { t: "heard", text: "how long is the long side?", mode: "show" },
      { t: "say", text: "The long side is 5." },
      { t: "draw", kind: "arrow", from: { pt: [640, 450] }, to: { pt: [450, 620] }, text: "c, what we want" },
      { t: "say", text: "In a right triangle, a² + b² = c².", append: true },
      { t: "draw", kind: "circle", target: { box: [160, 790, 50, 50] }, text: "90°" },
      { t: "draw", kind: "underline", target: { box: [135, 600, 30, 40] } },
      { t: "draw", kind: "label", target: { pt: [450, 900] }, text: "√25" },
      { t: "draw", kind: "path", points: [[180, 820], [180, 420], [720, 820]], closed: true },
      { t: "say", text: "So c = √25 = 5.", append: true },
      { t: "done" },
    ]);
  });
});

describe("the prompts teach DRAW, and stay the same bytes", () => {
  it("the text prompt: the same for two different requests, with DRAW in it, and picture places only for pictures", async () => {
    await post(step({ utterance: "what does export do?" }));
    await post(step({ utterance: "¿qué hace esto?", platform: "win", app: "Excel", language: "es", screen: { elements: [{ id: "o1", role: "text", label: "Total", region: "c" }] } }));
    expect(streamCalls()).toHaveLength(2);
    expect(systemText(0)).toBe(systemText(1));
    expect(systemText(0)).toBe(AGENT_SYSTEM);
    for (const must of ["DRAW marks the screen while you explain, like a teacher's pen.", "DRAW BOX <spot>", "DRAW CIRCLE <spot>", "DRAW UNDERLINE <spot>",
      "DRAW HIGHLIGHT <spot>", "DRAW ARROW <spot> -> <spot>", "DRAW NUMBER <spot> <1-9>", "DRAW LABEL <spot> \"text\"", "DRAW PATH (x,y) (x,y) … CLOSED",
      "DRAW CLEAR", "At most 6 marks.", "Put each DRAW right after the SAY it belongs to.", "Do not draw for a plain \"where is X\" (POINT rings it).",
      "only for a question answered from a picture you are shown", "SAY, POINT and DRAW come first."]) {
      expect(AGENT_SYSTEM, must).toContain(must);
    }
    // Its example draws by id: it has no picture to draw in.
    expect(AGENT_SYSTEM).toMatch(/^DRAW NUMBER e8 2$/m);
    expect(AGENT_SYSTEM).not.toMatch(/^DRAW \w+ [[(]\d/m);
  });

  it("the vision prompt: the same for two different pictures, with DRAW in it and an example in picture numbers", async () => {
    await postPicture({ utterance: "how long is the long side?" });
    await postPicture({ utterance: "walk me through this step by step", app: "Preview", platform: "win" });
    expect(streamCalls()).toHaveLength(2);
    expect(systemText(0)).toBe(AGENT_VISION_SYSTEM);
    expect(systemText(1)).toBe(AGENT_VISION_SYSTEM);
    for (const must of ["DRAW marks the screen while you explain, like a teacher's pen.", "DRAW ARROW <spot> -> <spot>", "DRAW PATH (x,y) (x,y) … CLOSED",
      "from 0 to 1000 across from its left edge and down from its top", "answer with SAY, POINT, DRAW and DONE only"]) {
      expect(AGENT_VISION_SYSTEM, must).toContain(must);
    }
    expect(AGENT_VISION_SYSTEM).toMatch(/^DRAW CIRCLE \[160,790,50,50\] "90°"$/m);
    // Every example line it is taught parses, and is kept on a picture step.
    const r = new LineReader(new Set(), "show", { picture: true });
    const examples = AGENT_VISION_SYSTEM.split("\n").filter((l) => /^DRAW [A-Z]+ /.test(l) && /\d/.test(l) && !/[<—…]/.test(l));
    expect(examples.length).toBeGreaterThan(3);
    for (const l of examples) expect(r.read(parseLine(l, "mac")!), l).toHaveLength(1);
  });
});
