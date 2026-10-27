/**
 * scripts/time-vision.ts, without the network: its command line, its
 * prices and table maths with a mocked fetch, and one whole run with a fake
 * model behind the server's real planStream, to show it sends the request
 * the picture path sends (each family's prompt, reasoning, temperature,
 * provider routing, the picture) one call at a time, and prints what it
 * should and nothing it should not. The script itself is never run by the
 * suite: it costs money and needs the key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sk-or-v1-test-secret-0123456789";
process.env.OPENROUTER_API_KEY = SECRET;
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

/** What each model streams, or "throw" for a 503 before any of it. */
const llm = vi.hoisted(() => ({
  calls: [] as Array<Record<string, any>>,
  answers: new Map<string, string | "throw">(),
  active: 0,
  most: 0,
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.calls.push(body);
          llm.active += 1;
          llm.most = Math.max(llm.most, llm.active);
          const answer = llm.answers.get(body.model) ?? "SAY Five.\nDONE";
          if (answer === "throw") {
            llm.active -= 1;
            throw Object.assign(new Error("503 No endpoints available for this model"), { status: 503 });
          }
          return (async function* () {
            try {
              for (const part of answer.match(/[\s\S]{1,9}/g) ?? []) {
                await new Promise((r) => setTimeout(r, 1));
                yield { choices: [{ delta: { content: part } }], provider: "Fake Cloud" };
              }
              yield { choices: [], usage: { prompt_tokens: 3000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 50 } } };
            } finally {
              llm.active -= 1;
            }
          })();
        },
      },
    };
  },
}));

const tv = await import("../scripts/time-vision.js");
const { PICTURE_BASE64, PICTURE_HEIGHT, PICTURE_MIME, PICTURE_WIDTH } = await import("../scripts/time-vision-picture.js");
const { placesNote } = await import("../src/agent/prompt.js");
const { stableBlock } = await import("../src/principles/roles.js");
const VISION = stableBlock("ask_vision");
const { resetConfigForTests } = await import("../src/config.js");
import type { Run } from "../scripts/time-vision.js";

/** OpenRouter's model list as it answers, for the models these tests use. */
const MODEL_LIST = {
  data: [
    { id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025", image: "0.0000003", input_cache_read: "0.00000003", internal_reasoning: "0.0000025" } },
    {
      id: "anthropic/claude-haiku-5.5",
      pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.00000001", overrides: [{ min_prompt_tokens: 100000, prompt: "0.0000005", completion: "0.0000025", input_cache_read: "0.00000005" }] },
    },
    { id: "openai/gpt-6-luna", pricing: { prompt: "0.0000001", completion: "0.0000005", request: "0.0001" } },
    { id: "broken/model", pricing: { prompt: "free" } },
  ],
};
const okFetch = vi.fn(async () => new Response(JSON.stringify(MODEL_LIST), { status: 200 })) as unknown as typeof fetch;

beforeEach(() => {
  llm.calls.length = 0;
  llm.answers.clear();
  llm.active = 0;
  llm.most = 0;
  vi.mocked(okFetch).mockClear();
});

describe("the command line", () => {
  it("defaults: 3 runs, the server's models, the server's routing", () => {
    expect(tv.parseArgs([])).toEqual({ options: { runs: 3, models: [], help: false } });
  });

  it("reads --runs, --models and --route, with a space or an =", () => {
    expect(tv.parseArgs(["--runs", "8", "--models", "google/gemini-3.8-flash, anthropic/claude-haiku-5.5", "--route", "latency"])).toEqual({
      options: { runs: 8, models: ["google/gemini-3.8-flash", "anthropic/claude-haiku-5.5"], route: "latency", help: false },
    });
    expect(tv.parseArgs(["--runs=2", "--models=a/b,a/b,c/d", "--route=none"])).toEqual({ options: { runs: 2, models: ["a/b", "c/d"], route: "none", help: false } });
    expect(tv.parseArgs(["--help"])).toMatchObject({ options: { help: true } });
    expect(tv.parseArgs(["-h"])).toMatchObject({ options: { help: true } });
  });

  it.each([
    [["--runs"]], [["--runs", "0"]], [["--runs", "51"]], [["--runs", "2.5"]], [["--runs", "many"]],
    [["--models"]], [["--models", " , "]], [["--route", "fastest"]], [["--route"]], [["--fast"]], [["extra"]],
  ])("%j is a usage error", (argv) => {
    expect(tv.parseArgs(argv)).toHaveProperty("error");
  });

  it("a usage error exits 2 with the usage, and --help exits 0 with it, before any setting is read", async () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(await tv.main(["--runs", "zero"], { out: (l) => out.push(l), err: (l) => err.push(l), fetch: okFetch })).toBe(2);
    expect(err.join("\n")).toContain("--runs is a whole number");
    expect(err.join("\n")).toContain(tv.USAGE);
    expect(await tv.main(["--help"], { out: (l) => out.push(l), err: (l) => err.push(l), fetch: okFetch })).toBe(0);
    expect(out).toEqual([tv.USAGE]);
    expect(okFetch).not.toHaveBeenCalled();
    expect(llm.calls).toHaveLength(0);
  });
});

describe("prices, from a mocked fetch", () => {
  it("are read once from OpenRouter's public list, per token, with the tiers and a fee per request", async () => {
    const prices = await tv.fetchPrices(okFetch);
    expect(okFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(okFetch).mock.calls[0]![0]).toBe("https://openrouter.ai/api/v1/models");
    // No key goes to the public list.
    expect(JSON.stringify(vi.mocked(okFetch).mock.calls[0])).not.toContain(SECRET);
    expect(prices!.get("google/gemini-2.5-flash")).toEqual({ prompt: 0.0000003, completion: 0.0000025, cacheRead: 0.00000003 });
    expect(prices!.get("anthropic/claude-haiku-5.5")).toEqual({
      prompt: 0.0000001, completion: 0.0000005, cacheRead: 0.00000001,
      tiers: [{ min: 100000, prompt: 0.0000005, completion: 0.0000025, cacheRead: 0.00000005 }],
    });
    expect(prices!.get("openai/gpt-6-luna")).toEqual({ prompt: 0.0000001, completion: 0.0000005, request: 0.0001 });
    expect(prices!.has("broken/model")).toBe(false);
  });

  it("are null when the list cannot be had, so costs show ? rather than a guess", async () => {
    expect(await tv.fetchPrices((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await tv.fetchPrices((async () => new Response("nope", { status: 502 })) as unknown as typeof fetch)).toBeNull();
    expect(await tv.fetchPrices((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)).toBeNull();
    expect(await tv.fetchPrices((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });

  it("cost: the prompt, its cached part at the cache's price, the answer, at the tier the prompt reaches", async () => {
    const prices = (await tv.fetchPrices(okFetch))!;
    const gemini = prices.get("google/gemini-2.5-flash");
    expect(tv.costOf(gemini, { promptTokens: 3412, completionTokens: 181 })).toBeCloseTo(3412 * 0.0000003 + 181 * 0.0000025, 12);
    expect(tv.costOf(gemini, { promptTokens: 3412, completionTokens: 181, cachedTokens: 2000 }))
      .toBeCloseTo(1412 * 0.0000003 + 2000 * 0.00000003 + 181 * 0.0000025, 12);
    const haiku = prices.get("anthropic/claude-haiku-5.5");
    expect(tv.costOf(haiku, { promptTokens: 3000, completionTokens: 100 })).toBeCloseTo(3000 * 0.0000001 + 100 * 0.0000005, 12);
    expect(tv.costOf(haiku, { promptTokens: 120000, completionTokens: 100 })).toBeCloseTo(120000 * 0.0000005 + 100 * 0.0000025, 12);
    expect(tv.costOf(prices.get("openai/gpt-6-luna"), { promptTokens: 1000, completionTokens: 0 })).toBeCloseTo(1000 * 0.0000001 + 0.0001, 12);
    // No price, or no usage: unknown.
    expect(tv.costOf(undefined, { promptTokens: 1, completionTokens: 1 })).toBeNull();
    expect(tv.costOf(gemini, { completionTokens: 1 })).toBeNull();
  });
});

describe("the table maths", () => {
  const run = (over: Partial<Run>): Run => ({ model: "m/x", ok: true, draws: 0, drawsDropped: 0, ...over });

  it("median and worst, over the numbers there are", () => {
    expect(tv.median([3, 1, 2])).toBe(2);
    expect(tv.median([4, 1, 3, 2])).toBe(2.5);
    expect(tv.median([5, undefined, null, 1])).toBe(3);
    expect(tv.median([])).toBeNull();
    expect(tv.worst([2, 9, undefined, 4])).toBe(9);
    expect(tv.worst([null])).toBeNull();
  });

  it("a model's summary counts only the runs that answered, and its cost per 1,000 is the mean answered run's", () => {
    const runs = [
      run({ firstMs: 900, sayMs: 2000, totalMs: 3000, cost: 0.0010, say: "The long side is 5." }),
      run({ firstMs: 1100, sayMs: 2400, totalMs: 3500, cost: 0.0012 }),
      run({ ok: false, error: "503 busy", firstMs: 10, sayMs: 10, totalMs: 10 }),
      run({ firstMs: 1000, sayMs: 4600, totalMs: 6000, cost: 0.0014 }),
    ];
    const s = tv.summarize("m/x", runs);
    expect(s).toMatchObject({
      model: "m/x", ok: 3, runs: 4,
      first: { median: 1000, worst: 1100 }, say: { median: 2400, worst: 4600 }, total: { median: 3500, worst: 6000 },
      firstSay: "The long side is 5.",
    });
    expect(s.per1000).toBeCloseTo(1.2, 10);
    // One answered run with no price makes the model's cost unknown, not cheaper.
    expect(tv.summarize("m/x", [run({ cost: 0.001 }), run({ cost: null })]).per1000).toBeNull();
    expect(tv.summarize("m/x", [run({ ok: false })]).per1000).toBeNull();
  });

  it("rows: a run, a failure, the median and worst, the first sentence cut to 80, and a run past the server's timeout", () => {
    const runs = [
      run({ firstMs: 1480, sayMs: 2040, totalMs: 3110, promptTokens: 3412, completionTokens: 181, reasoningTokens: 0, cost: 0.00148, draws: 3, servedBy: "Google AI Studio", say: "x".repeat(100) }),
      run({ ok: false, error: "503 No endpoints available" }),
      run({ firstMs: 9800, sayMs: 10200, totalMs: 11010, promptTokens: 3412, completionTokens: 170, cost: 0.00146, draws: 2, drawsDropped: 1 }),
    ];
    expect(tv.tableHead("m/x", "latency")).toEqual([
      "m/x, providers sorted by latency",
      "  run     first byte  first sentence     done  tokens in/out  thinking      cost  marks  served by",
    ]);
    expect(tv.tableHead("m/x", "")[0]).toBe("m/x, OpenRouter's default routing");
    expect(tv.runRow(1, runs[0]!)).toBe("    1         1.48 s          2.04 s   3.11 s       3412/181         0  $0.00148  3/0    Google AI Studio");
    expect(tv.runRow(2, runs[1]!)).toBe("    2     failed: 503 No endpoints available");
    expect(tv.runRow(3, runs[2]!)).toBe("    3         9.80 s         10.20 s  11.01 s       3412/170         -  $0.00146  2/1");
    expect(tv.tableFoot(runs, 9000)).toEqual([
      "  median      5.64 s          6.12 s   7.06 s                           $0.00147",
      "  worst       9.80 s         10.20 s  11.01 s                           $0.00148",
      "  2 of 3 answered",
      "  1 of 3 started later than AGENT_VISION_TIMEOUT_MS (9.00 s): the server would have gone to the next model",
      `  first sentence: "${"x".repeat(79)}…"`,
    ]);
    expect(tv.tableFoot([run({ ok: false, error: "x" })])).toEqual(["  none of 1 answered"]);
  });

  it("the closing lines: the fastest to its first sentence by median, and each model's cost per 1,000", () => {
    const results = new Map<string, Run[]>([
      ["slow/one", [run({ sayMs: 4200, cost: 0.0035 }), run({ sayMs: 15300, cost: 0.0034 })]],
      ["fast/one", [run({ sayMs: 2090, cost: 0.0008 }), run({ sayMs: 2370, cost: 0.0007 })]],
      ["unpriced/one", [run({ sayMs: 9000, cost: null })]],
      ["down/one", [run({ ok: false, error: "503" })]],
    ]);
    expect(tv.closing(results)).toEqual([
      "Fastest to its first sentence: fast/one, 2.23 s median, 2.37 s at worst. Under about 1.5 s feels instant.",
      "Cost per 1,000 picture questions: slow/one $3.45, fast/one $0.75, unpriced/one ?, down/one ?.",
    ]);
    expect(tv.closing(new Map([["down/one", [run({ ok: false })]]]))[0]).toBe("Fastest to its first sentence: none of them answered.");
  });
});

describe("the picture it carries", () => {
  it("is the worksheet JPEG, 1040×500, 22 KB", () => {
    const jpeg = Buffer.from(PICTURE_BASE64, "base64");
    expect(PICTURE_MIME).toBe("image/jpeg");
    expect(jpeg.length).toBe(22219);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // The frame header's height and width.
    let at = 2;
    while (at < jpeg.length && !(jpeg[at] === 0xff && jpeg[at + 1]! >= 0xc0 && jpeg[at + 1]! <= 0xc2)) at += 2 + jpeg.readUInt16BE(at + 2);
    expect([jpeg.readUInt16BE(at + 7), jpeg.readUInt16BE(at + 5)]).toEqual([PICTURE_WIDTH, PICTURE_HEIGHT]);
    expect([PICTURE_WIDTH, PICTURE_HEIGHT]).toEqual([1040, 500]);
  });
});

describe("a whole run, through the server's own planStream", () => {
  const GEMINI_ANSWER = [
    "SAY The long side, c, is 5, because in a right triangle a² + b² = c², so c² = 9 + 16 = 25 and c = √25.",
    "DRAW CIRCLE [790,160,840,210] \"90°\"",
    "DRAW ARROW o1 -> [620,450] \"c\"",
    "DRAW BOX e99",
    "SAY The 3 and the 4 are the two shorter sides.",
    "DONE",
  ].join("\n");

  async function run(argv: string[]) {
    const out: string[] = [];
    let t = 0;
    const code = await tv.main(argv, { fetch: okFetch, out: (l) => out.push(l), err: (l) => out.push(l), now: () => (t += 100) });
    return { code, out, text: out.join("\n") };
  }

  it("asks each model in turn, one call at a time, with the picture path's real request", async () => {
    llm.answers.set("google/gemini-2.5-flash", GEMINI_ANSWER);
    llm.answers.set("anthropic/claude-haiku-5.5", "SAY It's 5.\nDRAW CIRCLE [160,790,50,50]\nDONE");
    const { code } = await run(["--runs", "2", "--models", "google/gemini-2.5-flash,anthropic/claude-haiku-5.5,google/gemini-3.8-flash"]);
    expect(code).toBe(0);
    expect(llm.most).toBe(1);
    expect(okFetch).toHaveBeenCalledTimes(1);
    expect(llm.calls.map((c) => c.model)).toEqual([
      "google/gemini-2.5-flash", "google/gemini-2.5-flash",
      "anthropic/claude-haiku-5.5", "anthropic/claude-haiku-5.5",
      "google/gemini-3.8-flash", "google/gemini-3.8-flash",
    ]);
    const [gemini, , haiku, , gemini3] = llm.calls;
    // The picture path's request: streamed, its budget, the server's routing.
    for (const c of llm.calls) {
      expect(c.stream).toBe(true);
      expect(c.max_tokens).toBe(450);
      expect(c.provider).toEqual({ data_collection: "deny", sort: "latency" });
      expect(c.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${PICTURE_BASE64}` } });
      expect(c.messages[1].content[1].text.split("\n")[0]).toBe("App: Slack. The picture is one image from the window.");
      expect(c.messages[1].content[1].text).toContain('o1 text "a² + b² = c²" @c');
      expect(c.messages[1].content[1].text.endsWith("<said>explain this triangle</said>")).toBe(true);
    }
    // The same block for every family, each family's note for places, reasoning and temperature, as the server sends them.
    expect(gemini!.messages[0].content).toBe(VISION);
    expect(gemini!.messages[1].content[1].text.split("\n")[1]).toBe(placesNote("yx"));
    expect(haiku!.messages[1].content[1].text.split("\n")[1]).toBe(placesNote("xy"));
    expect(gemini!.reasoning).toEqual({ effort: "none" });
    expect(gemini!.temperature).toBe(0);
    expect(haiku!.messages[0].content).toEqual([{ type: "text", text: VISION, cache_control: { type: "ephemeral" } }]);
    expect(haiku!.reasoning).toEqual({ effort: "none", enabled: false });
    expect("temperature" in haiku!).toBe(false);
    expect(gemini3!.messages[0].content).toBe(VISION);
    expect(gemini3!.reasoning).toEqual({ effort: "low" });
    expect("temperature" in gemini3!).toBe(false);
  });

  it("prints a table per model with times, tokens, cost and the marks read in that model's order, then the two closing lines", async () => {
    llm.answers.set("google/gemini-2.5-flash", GEMINI_ANSWER);
    llm.answers.set("anthropic/claude-haiku-5.5", "SAY It's 5.\nDRAW CIRCLE [160,790,50,50]\nDONE");
    const { out } = await run(["--runs", "2", "--models", "google/gemini-2.5-flash,anthropic/claude-haiku-5.5"]);
    const gemini = out.slice(out.indexOf("google/gemini-2.5-flash, providers sorted by latency"));
    expect(gemini[1]).toBe("  run     first byte  first sentence     done  tokens in/out  thinking      cost  marks  served by");
    // 3,000 in with 1,000 of them cached, 200 out (50 of them thinking), at
    // the mocked list's prices; two marks kept, the one at an unknown id dropped.
    const cost = 2000 * 0.0000003 + 1000 * 0.00000003 + 200 * 0.0000025;
    expect(gemini[2]).toMatch(new RegExp(String.raw`^ {4}1 +\d+\.\d\d s +\d+\.\d\d s +\d+\.\d\d s +3000/200 +50 +\$${cost.toFixed(5).replace(".", "\\.")}  2/1    Fake Cloud$`));
    expect(gemini[3]).toMatch(/^ {4}2 /);
    expect(gemini[4]).toMatch(/^  median /);
    expect(gemini[5]).toMatch(/^  worst /);
    expect(gemini[6]).toBe(`  first sentence: "${"The long side, c, is 5, because in a right triangle a² + b² = c², so c² = 9 + 16 = 25 and c = √25.".slice(0, 79)}…"`);
    const haiku = out.slice(out.indexOf("anthropic/claude-haiku-5.5, providers sorted by latency"));
    expect(haiku[2]).toMatch(/ 1\/0 {4}Fake Cloud$/);
    expect(haiku.find((l) => l.startsWith("  first sentence"))).toBe('  first sentence: "It\'s 5."');
    expect(out.at(-2)).toMatch(/^Fastest to its first sentence: (google\/gemini-2\.5-flash|anthropic\/claude-haiku-5\.5), \d+\.\d\d s median, \d+\.\d\d s at worst\. Under about 1\.5 s feels instant\.$/);
    expect(out.at(-1)).toBe(`Cost per 1,000 picture questions: google/gemini-2.5-flash $${(cost * 1000).toFixed(2)}, anthropic/claude-haiku-5.5 $${((2000 * 0.0000001 + 1000 * 0.00000001 + 200 * 0.0000005) * 1000).toFixed(2)}.`);
  });

  it("a model that fails says why, and the others go on; the exit is still 0", async () => {
    llm.answers.set("openai/gpt-6-luna", "throw");
    const { code, out } = await run(["--runs", "2", "--models", "openai/gpt-6-luna,google/gemini-2.5-flash"]);
    expect(code).toBe(0);
    expect(out).toContain("    1     failed: 503 No endpoints available for this model");
    expect(out).toContain("  none of 2 answered");
    expect(llm.calls.map((c) => c.model)).toEqual(["openai/gpt-6-luna", "openai/gpt-6-luna", "google/gemini-2.5-flash", "google/gemini-2.5-flash"]);
    expect(out.at(-2)).toMatch(/^Fastest to its first sentence: google\/gemini-2\.5-flash/);
    expect(out.at(-1)).toMatch(/^Cost per 1,000 picture questions: openai\/gpt-6-luna \?, google\/gemini-2\.5-flash \$\d+\.\d\d\.$/);
  });

  it("--route none sends no provider preference; by default it is the server's", async () => {
    await run(["--runs", "1", "--models", "google/gemini-2.5-flash", "--route", "none"]);
    expect(llm.calls[0]!.provider).toEqual({ data_collection: "deny" });
    llm.calls.length = 0;
    const { out } = await run(["--runs", "1", "--models", "google/gemini-2.5-flash"]);
    expect(llm.calls[0]!.provider).toEqual({ data_collection: "deny", sort: "latency" });
    expect(out).toContain("google/gemini-2.5-flash, providers sorted by latency");
  });

  it("a server setting OpenRouter would not understand is measured, and headed, as no preference", async () => {
    process.env.AGENT_VISION_PROVIDER_SORT = "none";
    resetConfigForTests();
    try {
      const { out } = await run(["--runs", "1", "--models", "google/gemini-2.5-flash"]);
      expect(llm.calls[0]!.provider).toEqual({ data_collection: "deny" });
      expect(out).toContain("google/gemini-2.5-flash, OpenRouter's default routing");
    } finally {
      delete process.env.AGENT_VISION_PROVIDER_SORT;
      resetConfigForTests();
    }
  });

  it("with no --models it measures the server's vision models, then the two for comparison", async () => {
    await run(["--runs", "1"]);
    expect(llm.calls.map((c) => c.model)).toEqual(["google/gemini-2.5-flash", "anthropic/claude-haiku-5.5", "google/gemini-3.8-flash", "openai/gpt-6-luna"]);
  });

  it("prints no key, no picture and no answer beyond its first sentence, cut to 80", async () => {
    llm.answers.set("google/gemini-2.5-flash", GEMINI_ANSWER);
    llm.answers.set("openai/gpt-6-luna", "throw");
    const { text } = await run(["--runs", "1", "--models", "google/gemini-2.5-flash,openai/gpt-6-luna"]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PICTURE_BASE64.slice(0, 40));
    expect(text).not.toContain("c = √25.");
    expect(text).not.toContain("The 3 and the 4");
    expect(text).not.toContain("DRAW");
  });

  it("costs show ? when the prices cannot be fetched, and the runs still happen", async () => {
    const out: string[] = [];
    const code = await tv.main(["--runs", "1", "--models", "google/gemini-2.5-flash"], {
      fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, out: (l) => out.push(l),
    });
    expect(code).toBe(0);
    expect(out[0]).toContain("OpenRouter's prices could not be fetched, so costs show ?");
    expect(out.find((l) => l.startsWith("    1 "))).toMatch(/ 50 {9}\?  0\/0 {4}Fake Cloud$/);
    expect(out.at(-1)).toBe("Cost per 1,000 picture questions: google/gemini-2.5-flash ?.");
  });
});
