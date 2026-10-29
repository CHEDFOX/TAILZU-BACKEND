/**
 * THE MOMENT AN ASK IS OUT (src/experience/bots/askMoment.ts), in every chat: the Code bot's project chat and task bar, a bot's chat,
 * Ask, and Home's ask bar.
 *
 * What these hold down, for a build that carries (BotBuddyCarry) and streams (AskStream):
 *   - the words go up as the person's bubble (bound to `sent`) and the box is cleared BEFORE the call, which sends `$state.sent`;
 *   - a full-width lane: the chat's own bot (its colour and look; Tailzu's ink in Ask) carrying it, done when the first words come;
 *   - the answer written in as it comes (`stream: "reply"`), the step line under the bot, and Stop (POST /v1/ask/stop with its id);
 *   - a failed call puts the words back in the box and says why; a stopped one keeps them, marked;
 *   - an older build: today's "Asking…" line, no lane, no Stop, no stream; lint-clean either way.
 */
import { describe, expect, it, vi } from "vitest";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { CODEWORK_API, PROJECT } = await import("./bots-codework-data.js");
const { sampleApi } = await import("./bots-bots-data.js");

const NEW = ["BotsKit", "BotsMotion", "BotBuddy", "BotBuddyCarry", "AskStream"];
const OLD = ["BotsKit", "BotsMotion", "BotBuddy"];

async function build(screenId: string, client: "phone" | "desktop", params: Record<string, string>, can: string[], api: Record<string, unknown>) {
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "00000000-0000-4000-8000-00000000aaaa" }, can: new Set(can), desk: { pages: false, notes: false } },
    fakeDeps({ jobs: [], tasks: [], api }));
  return { s, nodes: walk(s.root!) };
}

/** Every action in a tree, flattened. */
function actions(nodes: Node[]): ActionSpec[] {
  const out: ActionSpec[] = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const x = a as ActionSpec & Record<string, unknown>;
    out.push(x);
    if (Array.isArray(x.actions)) (x.actions as unknown[]).forEach(visit);
    for (const k of ["then", "else", "onSuccess", "onError"]) visit(x[k]);
  };
  for (const n of nodes) for (const a of Object.values(n.on ?? {})) visit(a);
  return out;
}

const lanes = (nodes: Node[]) => nodes.filter((n) => n.type === "BotBuddy" && n.props?.act === "carry");

const CASES: Array<{ name: string; id: string; params: Record<string, string>; api: () => Promise<Record<string, unknown>>; color: string; kind: string; path: string; box: string; busy: string; old: string }> = [
  { name: "the Code bot's project chat", id: "bots.code.job", params: { project: PROJECT }, api: async () => CODEWORK_API, color: "#4F7A3A", kind: "code", path: "/v1/ask", box: "msg", busy: "asking", old: "Asking Code bot…" },
  { name: "a bot's chat", id: "bots.chat", params: { slug: "gym-bot" }, api: sampleApi, color: "", kind: "custom", path: "/v1/botsapp/bots/chat/gym-bot", box: "say", busy: "sending", old: "Gym bot is on it…" },
  { name: "Ask", id: "bots.ask", params: {}, api: async () => ({}), color: "#0a0a0a", kind: "custom", path: "/v1/shell/ask", box: "ask", busy: "asking", old: "Asking…" },
  { name: "Home's ask bar", id: "bots.home", params: {}, api: async () => ({}), color: "#0a0a0a", kind: "custom", path: "/v1/shell/ask", box: "ask", busy: "asking", old: "Asking your bots…" },
];

describe("the moment an ask is out", () => {
  for (const c of CASES) {
    for (const client of ["phone", "desktop"] as const) {
      it(`${c.name} (${client}): the bubble and the box cleared first, the carrying lane, the words as they come, Stop`, async () => {
        const { s, nodes } = await build(c.id, client, c.params, NEW, await c.api());
        expect(lintTree(s.root!)).toEqual([]);
        const lane = lanes(nodes);
        expect(lane.length).toBeGreaterThan(0);
        const p = lane[0]!.props!;
        expect(p.width).toBeUndefined();
        expect(Number(p.height)).toBeGreaterThanOrEqual(64);
        expect(Number(p.height)).toBeLessThanOrEqual(72);
        expect(p.kind).toBe(c.kind);
        if (c.color) expect(p.color).toBe(c.color);
        expect(p.doneWhen).toEqual({ truthy: "reply.text" });
        expect(p.label).toBe("Working on it…");
        expect(lane[0]!.visibleIf).toEqual({ truthy: c.busy });
        // The bubble and the words, bound to state.
        expect(nodes.some((n) => n.type === "Text" && n.bind?.content === "sent")).toBe(true);
        expect(nodes.some((n) => n.type === "Text" && n.bind?.content === "reply.text")).toBe(true);
        expect(nodes.some((n) => n.type === "Text" && n.bind?.content === "reply.step")).toBe(true);
        // The send: bubble, box cleared, busy, then the call with what was sent, streamed.
        const acts = actions(nodes);
        const call = acts.find((a) => a.kind === "callEndpoint" && a.path === c.path) as Extract<ActionSpec, { kind: "callEndpoint" }> | undefined;
        expect(call, c.path).toBeTruthy();
        expect((call!.body as Record<string, unknown>).message).toBe("$state.sent");
        expect(call!.stream).toBe("reply");
        const seqWithCall = acts.find((a) => a.kind === "sequence" && a.actions.includes(call!)) as Extract<ActionSpec, { kind: "sequence" }> | undefined
          ?? acts.find((a) => a.kind === "sequence" && a.actions.some((x) => typeof x === "object" && x.kind === "condition" && JSON.stringify(x).includes(c.path))) as Extract<ActionSpec, { kind: "sequence" }>;
        const first = JSON.stringify(seqWithCall.actions.slice(0, 5));
        expect(first).toContain(`{"kind":"setState","path":"sent","value":"$state.${c.box}"}`);
        expect(first).toContain(`{"kind":"clearState","path":"${c.box}"}`);
        expect(first).toContain(`{"kind":"setState","path":"${c.busy}","value":true}`);
        // Failing puts the words back in the box; stopped keeps them.
        const fail = JSON.stringify(call!.onError);
        expect(fail).toContain(`{"kind":"setState","path":"${c.box}","value":"$state.sent"}`);
        expect(fail).toContain('"if":{"truthy":"stopped"}');
        // Stop.
        expect(acts.some((a) => a.kind === "callEndpoint" && a.path === "/v1/ask/stop" && JSON.stringify(a.body) === '{"id":"$state.reply.id"}')).toBe(true);
        expect(nodes.some((n) => n.type === "Text" && n.props?.content === "Stopped")).toBe(true);
      });
    }
    it(`${c.name}: an older build gets today's line, no lane, no stream, no Stop; still the bubble`, async () => {
      const { s, nodes } = await build(c.id, "phone", c.params, OLD, await c.api());
      expect(lintTree(s.root!)).toEqual([]);
      expect(lanes(nodes)).toHaveLength(0);
      expect(nodes.some((n) => n.type === "Text" && n.props?.content === c.old)).toBe(true);
      const acts = actions(nodes);
      expect(acts.some((a) => a.kind === "callEndpoint" && a.stream)).toBe(false);
      expect(acts.some((a) => a.kind === "callEndpoint" && a.path === "/v1/ask/stop")).toBe(false);
      expect(nodes.some((n) => n.type === "Text" && n.bind?.content === "sent")).toBe(true);
    });
  }

});
