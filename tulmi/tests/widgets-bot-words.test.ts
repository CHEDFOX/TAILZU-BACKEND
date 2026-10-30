/**
 * EVERY BOT GIVES ITS OWN WIDGET WORDS (docs/widget-glance-v2.md section 1), and none is ever refused for them:
 *
 *   - Xode: ask_user's short / short_options are the question's words for the phone, kept with the job's question (and read by
 *     jobLite, so the widget and the Live Activity show them); done's short is what it finished. Too long: cut at a word. Wrong: dropped.
 *   - a person's bot: a change it calls carries x0_widget {question, private}, the yes for the owner's phone. It is kept on the approval,
 *     never handed to the app, and is in the tool's schema the bot is given; the bots' contract says so
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { ALICE, rig, def, toolCall } = await import("./bots-rig.js");
const { jobLite } = await import("../src/experience/bots/deps.js");
const { AGENT_TOOLS } = await import("../src/code/agent/tools.js");
const { stableBlock } = await import("../src/principles/roles.js");

describe("Xode's words for the phone", () => {
  it("are in its tools, never required", () => {
    const ask = AGENT_TOOLS.find((t) => t.name === "ask_user")!;
    const done = AGENT_TOOLS.find((t) => t.name === "done")!;
    expect(Object.keys((ask.parameters as { properties: object }).properties)).toEqual(["question", "options", "short", "short_options"]);
    expect((ask.parameters as { required: string[] }).required).toEqual(["question"]);
    expect(ask.description).toMatch(/short \(≤80 characters\) and short_options \(≤14 each, same order\)/);
    expect(Object.keys((done.parameters as { properties: object }).properties)).toEqual(["summary", "short"]);
    expect(done.description).toMatch(/short: it in ≤40 characters/);
  });

  it("are kept with its question and its finish, checked, and read by the widget", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(
      call("ask_user", {
        question: "Should the dashes be trimmed from the start of the slug too, or only from its end?", options: ["Both ends", "Only the end"],
        short: "Trim dashes at both ends of the slug, or only at the end of it, as it is today?", short_options: ["Both ends", "Only the very end please", 7],
      }),
      call("edit_file", UTIL_EDIT),
      call("done", { summary: "Trimmed both ends, as you said.", short: "Slug dashes are trimmed at both ends of it now" }),
    );
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({
      kind: "question", options: ["Both ends", "Only the end"],
      widget: { question: "Trim dashes at both ends of the slug, or only at the end of it, as it is today?", choices: ["Both ends", "Only the very…"] },
    });
    const asking = jobLite(await r.jobNow(job.id));
    expect(asking.question).toMatchObject({ text: "Should the dashes be trimmed from the start of the slug too, or only from its end?", widget: { choices: ["Both ends", "Only the very…"] } });
    expect(asking.phase).toBeTruthy();
    expect(asking.startedAt).toBeGreaterThan(0);

    await r.orch.answer("alice", job.id, "Both ends");
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect((await r.stateNow(job.id)).work.doneResult).toBe("Slug dashes are trimmed at both ends of…");
    expect(jobLite(j)).toMatchObject({ result: "Slug dashes are trimmed at both ends of…" });
  });

  it("never stop the question or the finish when they are missing or wrong", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(
      call("ask_user", { question: "Which?", short: { x: 1 }, short_options: "nope" }),
      call("edit_file", UTIL_EDIT),
      call("done", { summary: "Done it.", short: "Supercalifragilisticexpialidociousandthensomemoreletters" }),
    );
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "question", question: "Which?" });
    expect((s.waiting as { widget?: unknown }).widget).toBeUndefined();
    await r.orch.answer("alice", job.id, "this one");
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect((await r.stateNow(job.id)).work.doneResult).toBeUndefined();
    expect(jobLite(await r.jobNow(job.id)).result).toBeUndefined();
  });
});

describe("a person's bot's words for the phone", () => {
  const calendarBot = { skills: { connectors: ["fake-cal"] } };

  it("ride on the change it calls: kept on the approval, checked, and never handed to the app", async () => {
    let n = 0;
    const r = await rig(() => (n++ === 0 ? {
      toolCalls: [toolCall("fake-cal__create_event", {
        title: "Gym", when: "6am", x0_widget: { question: "Put gym at 6 am on your calendar for tomorrow morning, before the standup with the team?", private: true },
      })],
    } : "It's waiting for your yes."));
    await r.bots.create(ALICE, def({ slug: "buddy", ...calendarBot }));
    const a = await r.bots.ask(ALICE, "buddy", { message: "put gym at 6am on my calendar" });
    expect(a.approvals).toHaveLength(1);
    // the bot was offered the field, and told what it is for
    const sent = r.model.of("bot.run")[0]!;
    const tool = sent.tools.find((t) => t.name === "fake-cal__create_event")!;
    expect((tool.parameters as { properties: Record<string, unknown> }).properties.x0_widget).toEqual({ type: "object", properties: { question: { type: "string", maxLength: 80 }, private: { type: "boolean" } } });
    expect(stableBlock("bot_run")).toContain("x0_widget{question}");
    // kept on the approval, cut at a word
    const [task] = await r.conn.tasks.list(ALICE);
    expect(task!.approval!.widget).toEqual({ question: "Put gym at 6 am on your calendar for tomorrow morning, before the standup with…", private: true });
    // the app is asked exactly what it takes
    expect((await r.conn.tasks.approve(ALICE, task!.id)).status).toBe("ok");
    expect(r.conn.done).toEqual([{ tool: "create_event", args: { title: "Gym", when: "6am" } }]);
  });

  it("are never required, and a wrong one is dropped, not refused", async () => {
    let n = 0;
    const r = await rig(() => (n++ === 0 ? { toolCalls: [toolCall("fake-cal__create_event", { title: "Gym", x0_widget: "not an object" })] } : "Waiting."));
    await r.bots.create(ALICE, def({ slug: "buddy", ...calendarBot }));
    const a = await r.bots.ask(ALICE, "buddy", { message: "put gym on my calendar" });
    expect(a.approvals).toHaveLength(1);
    const [task] = await r.conn.tasks.list(ALICE);
    expect(task!.approval!.widget).toBeUndefined();
    await r.conn.tasks.approve(ALICE, task!.id);
    expect(r.conn.done).toEqual([{ tool: "create_event", args: { title: "Gym" } }]);
  });
});
