import { describe, expect, it } from "vitest";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";
import { botsAppOn, BOTS_SCREENS, buildBotsScreen } from "../src/experience/bots/index.js";
import { approvalLine, jobLite } from "../src/experience/bots/deps.js";
import { ctxFor, fakeDeps, FIXED_NOW, IST, SAMPLE_JOBS, sampleLive } from "../src/experience/bots/fixtures.js";
import { liveFrom, weekAndMonthStart } from "../src/experience/bots/live.js";
import { weekLine } from "../src/experience/bots/screens/shell.js";
import type { CodeJob } from "../src/code/jobs/types.js";
import { lintTree as checkTree, walk } from "../src/experience/bots/lint.js";

const req = (screenId: string, client: "phone" | "desktop", o: { params?: Record<string, string> } = {}) => ({
  screenId, client, params: o.params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" },
  can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: client === "desktop" },
});
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const presses = (n: Node): ActionSpec[] => walk(n).map((x) => x.on?.onPress).filter(Boolean) as ActionSpec[];

describe("live state from real records", () => {
  const live = sampleLive();
  it("the question a Code bot job waits on, with its own options, and You decide", () => {
    const n = live.needs[0]!;
    expect(n).toMatchObject({ bot: "code", botName: "Code bot", question: "Round the cart total per item, or once at the end?" });
    expect(n.choices.map((c) => [c.label, c.kind])).toEqual([["Per item", "primary"], ["At the end", "secondary"], ["You decide", "quiet"]]);
    expect(n.choices[0]!.action).toMatchObject({ kind: "callEndpoint", method: "POST", path: `/v1/code/jobs/${SAMPLE_JOBS[0]!.id}/answer`, body: { answer: "Per item" } });
  });
  it("who is working, the week, the month's spend, the greeting", () => {
    const code = live.bots.find((b) => b.slug === "code")!;
    expect(code).toMatchObject({ state: "needs", working: true, needs: 1, doing: "fixing cart", color: "#4F7A3A" });
    expect(live.bots.map((b) => b.slug).slice(0, 4)).toEqual(["code", "keybot", "plan", "travel"]);
    expect(live.week).toEqual({ done: 4, minutesSaved: 124 });
    expect(weekLine(live.week)).toBe("4 things done this week · 2 h saved");
    // Last month's job is not this month's spend.
    expect(live.spend).toEqual({ monthPaise: 640 + 1960 + 1420 + 110 + 940, budgetPaise: 50_000 });
    expect(live.greeting).toBe("Good evening");
    expect(live.tab).toMatchObject({ needs: 1, workingColor: "#4F7A3A" });
    expect(live.tab.dots.map((d) => d.working)).toEqual([true, false, false, false]);
  });
  it("a connected app waiting for a yes belongs to the bot whose app it is", () => {
    const l = liveFrom({
      bots: [], jobs: [], minutesSaved: 0, budgetPaise: 0, now: FIXED_NOW, tzOffsetMinutes: IST,
      tasks: [{ id: "t1", state: "waiting", title: "Move the dentist to Friday 10 am?", approval: { id: "a1", connector: "google-calendar", preview: "Update event: Dentist" }, createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
    });
    expect(l.needs[0]).toMatchObject({ bot: "plan", botName: "Plan bot", question: "Move the dentist to Friday 10 am?" });
    expect(l.needs[0]!.choices[0]!.action).toMatchObject({ path: "/v1/tasks/t1/approve", body: { approvalId: "a1" } });
    expect(l.needs[0]!.choices[1]!.action).toMatchObject({ path: "/v1/tasks/t1/deny" });
    // The four built-ins are there even with the bots platform off.
    expect(l.bots.map((b) => b.name)).toEqual(["Plan bot", "Code bot", "Keybot", "Travel bot"]);
    expect(l.spend.budgetPaise).toBe(50_000);
    expect(weekLine(l.week)).toBe("Nothing done yet this week");
  });
  it("the week starts on Monday and the month on the 1st, in the person's own day", () => {
    const { week, month } = weekAndMonthStart(FIXED_NOW, IST);
    expect(new Date(week + IST * 60_000).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(new Date(month + IST * 60_000).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("a job's agent question is read from its checkpoint", () => {
    const job = {
      id: "j1", userId: "u", projectId: "p", branch: "b", task: "Fix it", state: "waiting_for_you", placement: "none", leaseHolder: null, leaseEpoch: 0, leaseExpiresAt: null,
      checkpoint: { stepIndex: 2, headSha: "", notes: "", agent: { v: 1, phase: "work", waiting: { kind: "question", question: "Which one?", options: ["A", "B"], from: "model" } } },
      budgetPaise: 3000, spentPaise: 120, reassignments: 0, reason: "", waitingOn: "answer", agent: true, agentHolder: null, agentEpoch: 0, agentExpiresAt: null, createdAt: 1, updatedAt: 2,
    } as unknown as CodeJob;
    expect(jobLite(job)).toMatchObject({ id: "j1", question: { text: "Which one?", options: ["A", "B"] }, spentPaise: 120 });
    expect(approvalLine("job.plan", {})).toBe("Go ahead with this plan?");
    expect(approvalLine("pr.ready", { title: "Mark PR #128 ready?" })).toBe("Mark PR #128 ready?");
  });
});

describe("bots.home", () => {
  it("phone: Main.dc.html, from the live state, with its actions wired", async () => {
    const s = await buildBotsScreen(req("bots.home", "phone"), fakeDeps());
    const words = texts(s.root!);
    for (const w of ["Good evening", "Your bots", "4 things done this week · 2 h saved", "Needs you · Code bot",
      "Round the cart total per item, or once at the end?", "Per item", "At the end", "You decide",
      "Code bot", "Working · fixing cart", "Keybot", "Your keyboard, everywhere", "Plan bot", "Make a bot", "Bots", "Activity", "You"]) {
      expect(words, w).toContain(w);
    }
    expect(words).not.toContain("Travel bot");
    const acts = presses(s.root!);
    expect(acts).toContainEqual({ kind: "navigate", screenId: "bots.code" });
    expect(acts).toContainEqual({ kind: "navigate", screenId: "bots.keybot" });
    expect(acts).toContainEqual({ kind: "navigate", screenId: "bots.plan" });
    expect(acts).toContainEqual({ kind: "navigate", screenId: "bots.make" });
    expect(acts).toContainEqual({ kind: "switchTab", tabId: "you" });
    // The ask bar: return or the send button posts to the front door, and the answer opens.
    const field = walk(s.root!).find((n) => n.type === "TextField")!;
    expect(field.bind).toEqual({ value: "ask" });
    const ask = JSON.stringify(field.on!.onSubmit);
    expect(ask).toContain('"path":"/v1/ask"');
    expect(ask).toContain('"body":{"message":"$state.ask","device":"phone","mode":"text","bot":"any"}');
    expect(ask).toContain('"screenId":"bots.ask"');
    expect(s.state).toMatchObject({ ask: "", asking: false });
    expect(checkTree(s.root!)).toEqual([]);
  });

  it("window: DeskHome.dc.html in the sidebar frame, four tiles across, the ask bar says desktop", async () => {
    const s = await buildBotsScreen(req("bots.home", "desktop"), fakeDeps());
    const words = texts(s.root!);
    for (const w of ["What should we do?", "Hold a key, speak, done", "Your bots", "Travel bot", "Gym bot"]) expect(words, w).toContain(w);
    expect(walk(s.root!).some((n) => n.type === "Grid" && n.props?.columns === 4)).toBe(true);
    const field = walk(s.root!).find((n) => n.type === "TextField")!;
    expect(JSON.stringify(field.on!.onSubmit)).toContain('"device":"desktop"');
    expect(field.props?.placeholder).toBe("Ask any bot…  or hold Fn and speak");
    expect(checkTree(s.root!)).toEqual([]);
  });

  it("living tiles for a build that draws them (BotsMotion): a tiny bot per tile, its play, its state; else today's tiles", async () => {
    for (const [client, cols] of [["phone", 2], ["desktop", 4]] as const) {
      const r = { ...req("bots.home", client), can: new Set(["BotsKit", "BotsMotion"]) };
      const s = await buildBotsScreen(r, fakeDeps());
      const grid = walk(s.root!).find((n) => n.type === "BotTiles")!;
      expect(grid, client).toBeDefined();
      const tiles = grid.props!.tiles as Array<{ slug: string; name: string; sub: string; color: string; kind: string; state: string; action?: ActionSpec }>;
      expect(grid.props).toMatchObject({ columns: cols, faces: { semibold: "Tailzu Geist SemiBold" } });
      expect(tiles).toHaveLength(4);
      expect(tiles[3]).toMatchObject({ slug: "make", name: "Make a bot", kind: "make", color: "#0a0a0a", action: { kind: "navigate", screenId: "bots.make" } });
      // The sample day: Code bot both working and waiting on Aanya (needs first), each with its own colour and play.
      const code = tiles.find((t) => t.slug === "code")!;
      expect(code).toMatchObject({ kind: "code", color: "#4F7A3A", action: { kind: "navigate" } });
      expect(["working", "needs"]).toContain(code.state);
      for (const t of tiles.slice(0, 3)) expect(t.sub.length, t.slug).toBeGreaterThan(0);
      expect(walk(s.root!).some((n) => n.type === "Grid")).toBe(false);
      expect(checkTree(s.root!)).toEqual([]);
      // Without it: the static tiles, as before.
      const plain = await buildBotsScreen(req("bots.home", client), fakeDeps());
      expect(walk(plain.root!).some((n) => n.type === "BotTiles")).toBe(false);
      expect(walk(plain.root!).some((n) => n.type === "Grid" && n.props?.columns === cols)).toBe(true);
    }
  });

  it("a quiet day: no decision card, and the week says so", async () => {
    const s = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ jobs: [], tasks: [], minutesSaved: 0 }));
    const words = texts(s.root!);
    expect(words).toContain("Nothing done yet this week");
    expect(words.some((w) => w.startsWith("Needs you"))).toBe(false);
    expect(words).toContain("Fixes and ships your code");
  });

  it("every registered screen builds for both clients and keeps the kit's rules", async () => {
    for (const id of BOTS_SCREENS.keys()) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await buildBotsScreen(req(id, client), fakeDeps());
        expect(s.screenId).toBe(id);
        expect(checkTree(s.root!), `${id} ${client}`).toEqual([]);
        // And with the living tiles.
        const moving = await buildBotsScreen({ ...req(id, client), can: new Set(["BotsKit", "BotsMotion"]) }, fakeDeps());
        expect(checkTree(moving.root!), `${id} ${client} BotsMotion`).toEqual([]);
      }
    }
  });
});

describe("the registry", () => {
  it("an id nobody has built yet is a page that says so, with the way back", async () => {
    const s = await buildBotsScreen(req("bots.not-yet", "phone"), fakeDeps());
    expect(texts(s.root!)).toContain("This part is on its way");
    expect(JSON.stringify(s.root)).toContain('"kind":"navigateBack"');
  });
  it("a failed read draws the screen anyway", async () => {
    const deps = { ...fakeDeps(), jobs: async () => { throw new Error("down"); } };
    const s = await buildBotsScreen(req("bots.home", "phone"), deps);
    expect(texts(s.root!)).toContain("Your bots");
  });
  it("the answer page shows what was asked and what came back", () => {
    const def = BOTS_SCREENS.get("bots.ask")!;
    const s = def.build(ctxFor("bots.ask", "phone", sampleLive(), { params: { message: "How does sign-in work?", answer: "Supabase checks the email." } }), undefined);
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["How does sign-in work?", "Supabase checks the email."]));
  });
  it("is on only with the switch, a build that draws the kit, and (while set) a tester", () => {
    expect(botsAppOn({ on: false, components: ["BotsKit"] })).toBe(false);
    expect(botsAppOn({ on: true, components: ["DeskShell"] })).toBe(false);
    expect(botsAppOn({ on: true, components: ["BotsKit"] })).toBe(true);
    expect(botsAppOn({ on: true, components: new Set(["BotsKit"]) })).toBe(true);
    expect(botsAppOn({ on: true, components: ["BotsKit"], testers: "aanya@example.in", email: "Aanya@Example.in" })).toBe(true);
    expect(botsAppOn({ on: true, components: ["BotsKit"], testers: "aanya@example.in", email: "ravi@example.in" })).toBe(false);
    expect(botsAppOn({ on: true, components: ["BotsKit"], testers: "aanya@example.in" })).toBe(false);
  });
  it("a screen's own load reads through api, and its answers come back as data", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const deps = fakeDeps({ api: { "GET /v1/bots/plan/memory": { facts: [{ id: "f1", text: "Gym at 7" }] } }, calls });
    expect(await deps.api("GET", "/v1/bots/plan/memory")).toEqual({ facts: [{ id: "f1", text: "Gym at 7" }] });
    await expect(deps.api("GET", "/v1/nope")).rejects.toMatchObject({ status: 404 });
    expect(calls.map((c) => c.path)).toEqual(["/v1/bots/plan/memory", "/v1/nope"]);
  });
});
