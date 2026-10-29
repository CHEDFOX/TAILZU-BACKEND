/**
 * The one repair round (agent/run.ts, connectors/tasks.ts and index.ts): a USE
 * whose arguments do not fit its tool runs nothing, and the planner is asked
 * once to put it right; and the step that says the nothing line says why.
 *
 * What must hold: a bad call is never previewed, approved, audited or called;
 * the first gets a "fix:" line, one of Tailzu's own at the top of <tools> and
 * never inside <result>, and the call runs once it is right; the second in a
 * step ends with va.failed in the person's voice and StepResult.code
 * "invalid_args"; the repair is one of the step's rounds, and the last round
 * still reads no USE; a hand-off keeps its own question for what it was not
 * given; and "nothing_usable" is set exactly where the nothing line is said.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { runStep, runCommand } = await import("../src/agent/run.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { ALWAYS_ON, CATALOG } = await import("../src/connectors/catalog.js");
const { encrypt } = await import("../src/connectors/crypto.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { EN, HG } = await import("../src/connectors/words.js");

// Thursday 22 Oct 2026, 13:30 in India.
const NOW = Date.parse("2026-10-22T08:00:00Z");
const user = "u1";

/** Google Tasks (and the hand-offs), connected, with Google a fake that records every request. */
async function setup(o: { autoOk?: string[] } = {}) {
  const fetches: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetches.push({ method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url.includes("/tasks/v1/lists/@default/tasks") && init?.method === "POST") return new Response(JSON.stringify({ id: "t9" }), { status: 200 });
    if (url.includes("/tasks/v1/lists/@default/tasks")) return new Response(JSON.stringify({ items: [{ id: "t1", title: "Gym", status: "needsAction" }] }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: "no route" } }), { status: 404 });
  }) as typeof fetch;
  const store = new MemoryConnectorStore();
  const connectors = createConnectors({
    store, redirectUrl: "https://api.example.com/v1/connectors/callback", now: () => NOW, fetchFn,
    google: { clientId: "cid", clientSecret: "secret" },
    catalog: [...CATALOG.filter((c) => c.id === "google-tasks"), ...ALWAYS_ON],
    notes: { find: async () => null },
  });
  const def = CATALOG.find((c) => c.id === "google-tasks")!;
  await store.upsertConnection(user, "google-tasks", {
    level: "send", autoOk: o.autoOk ?? [],
    tokensEnc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: NOW + 3_600_000, scope: def.scopes!.join(" ") })),
  });
  return { store, connectors, fetches };
}

/** One step with a scripted planner, one answer per planner call (then DONE): the phone's Ask, or a desktop step. */
async function step(answers: string[], o: { said?: string; platform?: "ios" | "mac"; language?: string; autoOk?: string[] } = {}) {
  const s = await setup({ autoOk: o.autoOk });
  const lines: string[] = [];
  const sink = new EventSink((l) => lines.push(l));
  const sent: Array<{ system: string; user: string }> = [];
  const queue = [...answers];
  const deps = {
    write: async () => "", rewrite: async () => "",
    plan: (system: unknown, u: unknown) => {
      sent.push({ system: String(system), user: typeof u === "string" ? u : "" });
      const a = queue.shift() ?? "DONE";
      return (async function* () { yield { model: "m", delta: `${a}\n` }; })();
    },
    connectors: s.connectors.runtimeFor(user),
  };
  const said = o.said ?? "add gym to my google tasks for tomorrow";
  const result = o.platform === "mac"
    ? await runStep({ req: { runId: "run_desk1", step: 0, platform: "mac", app: "Safari", screen: { elements: [] }, utterance: said, ...(o.language ? { language: o.language } : {}) }, maxSteps: 8 }, deps as never, sink)
    : await runCommand({ runId: "ask_phone1", said, platform: "ios", ...(o.language ? { language: o.language } : {}) }, deps as never, sink);
  return { ...s, events: lines.map((l) => JSON.parse(l)), sent, result };
}

/** The <tools> block of a planner message, line by line. */
const toolsOf = (msg: string) => /<tools>\n([\s\S]*?)\n<\/tools>/.exec(msg)?.[1]!.split("\n") ?? [];
const resultOf = (msg: string) => /<result>\n([\s\S]*?)\n<\/result>/.exec(msg)?.[1] ?? "";

describe("a USE that does not fit its tool", () => {
  it("runs nothing, and the planner is asked again with what to fix: one of X0 Bot's own lines, first in <tools>", async () => {
    const r = await step([
      'USE google-tasks.add_task {"due":"tomorrow"}',
      'USE google-tasks.add_task {"title":"Gym","due":"tomorrow"}',
    ]);
    expect(r.sent.length).toBe(2);
    expect(toolsOf(r.sent[0]!.user).some((l) => l.startsWith("fix:"))).toBe(false);
    const tools = toolsOf(r.sent[1]!.user);
    expect(tools[0]).toBe('fix: google-tasks.add_task — missing "title"');
    expect(tools.filter((l) => l.startsWith("fix:")).length).toBe(1);
    expect(resultOf(r.sent[1]!.user)).not.toContain("fix:");
    // Put right, it goes on as any call does: a change waits for the person's yes.
    expect(r.events.map((e) => e.t)).toEqual(["heard", "approve"]);
    expect(r.events[1].approval).toMatchObject({ connector: "google-tasks", tool: "add_task", preview: 'Add the task "Gym" to Google Tasks, for Tomorrow' });
    const tasks = await r.store.listTasks(user, 10);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.approval!.args).toEqual({ title: "Gym", due: "tomorrow" });
    expect(r.result.code).toBeUndefined();
    expect(r.fetches.filter((f) => f.method !== "GET")).toEqual([]);
  });

  it("is never shown, approved, audited or called: nothing at all is left of it", async () => {
    const r = await step(['USE google-tasks.add_task {"due":"tomorrow"}', "SAY What should the task be called?\nDONE"]);
    expect(r.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(await r.store.listTasks(user, 10)).toEqual([]);
    expect(r.fetches).toEqual([]);
    // With the tool allowed to run without asking, too.
    const auto = await step(['USE google-tasks.add_task {"notes":"x"}', "DONE"], { autoOk: ["add_task"] });
    expect(await auto.store.listTasks(user, 10)).toEqual([]);
    expect(auto.fetches).toEqual([]);
  });

  it("twice in a step: said plainly in the person's voice, done, and the step's code is invalid_args", async () => {
    const r = await step(['USE google-tasks.add_task {"due":"tomorrow"}', 'USE google-tasks.add_task {"title":""}', "SAY never asked"]);
    expect(r.sent.length).toBe(2);
    expect(r.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(r.events[1].text).toBe("I couldn't fill that in for Google Tasks. Try saying it another way.");
    expect(EN["va.failed"]).toBe("I couldn't fill that in for {app}. Try saying it another way.");
    expect(r.result.code).toBe("invalid_args");
    expect(await r.store.listTasks(user, 10)).toEqual([]);
    expect(r.fetches).toEqual([]);

    const hg = await step(['USE google-tasks.add_task {}', 'USE google-tasks.add_task {}'], { language: "hinglish" });
    expect(hg.events[1].text).toBe(HG["va.failed"].replace("{app}", "Google Tasks"));
    const desk = await step(['USE google-tasks.add_task {}', 'USE google-tasks.add_task {}'], { platform: "mac" });
    expect(desk.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(desk.result.code).toBe("invalid_args");
  });

  it("calls the tool with the arguments as checked: what the readers would have read anyway", async () => {
    const r = await step(['USE google-tasks.add_task {"title":2026,"due":"tomorrow","notes":null}'], { autoOk: ["add_task"] });
    expect(r.sent.length).toBe(2);
    const post = r.fetches.find((f) => f.method === "POST")!;
    expect(post.body).toMatchObject({ title: "2026" });
    expect(toolsOf(r.sent[1]!.user).some((l) => l.startsWith("fix:"))).toBe(false);
    expect(resultOf(r.sent[1]!.user)).toContain('Added "2026"');
  });

  it("the fix is said on the next call only, and the repair is one of the step's rounds", async () => {
    // A look-up, a bad change, its fix: three calls, and the fix line only on the third.
    const r = await step([
      'USE google-tasks.list_tasks {"due":"today"}',
      'USE google-tasks.complete_task {"list":"Home"}',
      'USE google-tasks.complete_task {"task":"t1"}',
    ], { said: "mark gym done in google tasks" });
    expect(r.sent.length).toBe(3);
    expect(toolsOf(r.sent[1]!.user).some((l) => l.startsWith("fix:"))).toBe(false);
    expect(toolsOf(r.sent[2]!.user)[0]).toBe('fix: google-tasks.complete_task — missing "task"');
    expect(r.events.map((e) => e.t)).toEqual(["heard", "approve"]);

    // A bad change on the round before the last: its repair is the last round, which reads no USE.
    const late = await step([
      'USE google-tasks.list_tasks {}',
      'USE google-tasks.list_tasks {"due":"today"}',
      'USE google-tasks.add_task {}',
      'USE google-tasks.add_task {"title":"Gym"}',
    ]);
    expect(late.sent.length).toBe(4);
    expect(toolsOf(late.sent[3]!.user)[0]).toBe('fix: google-tasks.add_task — missing "title"');
    expect(late.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(await late.store.listTasks(user, 10).then((t) => t.filter((x) => x.approval))).toEqual([]);
  });
});

describe("a hand-off keeps its own questions", () => {
  it("a value it needs and was not given is asked for in its words, with no repair round", async () => {
    const r = await step(['USE upi.pay {"amount":"500","name":"Rahul"}'], { said: "pay rahul 500 on upi" });
    expect(r.sent.length).toBe(1);
    expect(r.events.map((e) => e.t)).toEqual(["heard", "ask"]);
    expect(r.events[1].text).toBe("What's their UPI ID, like name@bank?");
    const empty = await step(['USE upi.pay {"vpa":"","amount":"500"}'], { said: "pay rahul 500 on upi" });
    expect(empty.events[1].text).toBe("What's their UPI ID, like name@bank?");
  });

  it("a value that cannot be right is put right, as for any tool", async () => {
    const r = await step(['USE maps.directions {"destination":"the airport","mode":"teleport"}', 'USE maps.directions {"destination":"the airport","mode":"driving"}'], { said: "directions to the airport" });
    expect(toolsOf(r.sent[1]!.user)[0]).toBe('fix: maps.directions — "mode" is one of: driving, walking, bicycling, two-wheeler, transit');
    expect(r.events.map((e) => e.t)).toEqual(["heard", "say", "open", "done"]);
    expect(r.events[2].url).toContain("travelmode=driving");
    // A choice in another case is simply the choice.
    const cased = await step(['USE maps.directions {"destination":"the airport","mode":"Walking"}'], { said: "walking directions to the airport" });
    expect(cased.sent.length).toBe(1);
    expect(cased.events[2].url).toContain("travelmode=walking");
  });
});

describe("nothing_usable", () => {
  it("is set exactly where the nothing line is said", async () => {
    // The phone: nothing it can use (an action line is dropped there).
    const phone = await step(["PRESS e1"], { said: "hello" });
    expect(phone.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(phone.events[1].text).toBe("I couldn't find that here.");
    expect(phone.result.code).toBe("nothing_usable");
    // An answer, or a run that says something, is not "nothing".
    for (const said of ["SAY Hello!\nDONE", "SAY Hello!", "DONE"]) {
      const r = await step([said], { said: "hello" });
      expect(r.result.code, said).toBeUndefined();
    }
    // The desktop, with no app to use.
    const desk = await step([""], { said: "what is this", platform: "mac" });
    expect(desk.events.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(desk.result.code).toBe("nothing_usable");
  });

  it("and on the picture path, where the nothing line is its own", async () => {
    const lines: string[] = [];
    const answer = async (text: string) => runStep(
      { req: { runId: "run_pic1", step: 0, platform: "mac", app: "Preview", screen: { elements: [] }, utterance: "explain this" }, maxSteps: 8, image: { mime: "image/png", data: Buffer.from("x") } },
      { write: async () => "", rewrite: async () => "", plan: () => (async function* () { yield { model: "m", delta: text }; })() } as never,
      new EventSink((l) => lines.push(l)),
    );
    expect((await answer("")).code).toBe("nothing_usable");
    expect(lines.map((l) => JSON.parse(l)).find((e) => e.t === "say").text).toBe("I couldn't make that out in the picture.");
    expect((await answer("SAY It's a cat.\nDONE\n")).code).toBeUndefined();
  });
});

describe("every stop says why, in a code as well as in words (for the run ledger)", () => {
  it("not connected, unknown, blocked, show only, phone only, a recipient they did not say, the app's own refusal", async () => {
    const { connectors, store } = await setup();
    const rt = connectors.runtimeFor(user);
    const use = (connector: string, tool: string, args: Record<string, unknown>, o: { allowWrite?: boolean; platform?: "ios" | "mac"; read?: boolean; words?: string } = {}) =>
      rt.use("run_codes", "said", { verb: "USE", connector, tool, args }, { allowWrite: o.allowWrite ?? true, platform: o.platform ?? "ios", ...(o.read ? { read: true, words: o.words ?? "" } : {}) });
    expect(await use("notion", "search", {})).toMatchObject({ kind: "stopped", code: "not_connected" });
    expect(await use("google-tasks", "erase_everything", {})).toMatchObject({ kind: "stopped", code: "unknown_tool" });
    expect(await use("google-tasks", "add_task", { title: "Gym" }, { allowWrite: false })).toMatchObject({ kind: "stopped", code: "show_only" });
    expect(await use("upi", "pay", { vpa: "rahul@okhdfcbank", amount: "500" }, { platform: "mac" })).toMatchObject({ kind: "stopped", code: "phone_only", message: EN["ho.phone"] });
    expect(await use("upi", "pay", { vpa: "attacker@ybl", amount: "500" }, { read: true, words: "pay the fee" })).toMatchObject({ kind: "stopped", ask: true, code: "recipient_unsaid" });
    expect(await use("google-tasks", "complete_task", { task: "laundry" })).toMatchObject({ kind: "stopped", code: "rejected" });
    await store.upsertConnection(user, "google-tasks", { level: "look" });
    expect(await use("google-tasks", "add_task", { title: "Gym" })).toMatchObject({ kind: "stopped", code: "blocked" });
    // A call that does not fit is not a stop: it is "invalid", with what to fix, and the line to say if it stays wrong.
    expect(await use("google-tasks", "add_task", {})).toEqual({
      kind: "invalid", problems: 'missing "title"', message: "I couldn't fill that in for Google Tasks. Try saying it another way.",
    });
  });
});
