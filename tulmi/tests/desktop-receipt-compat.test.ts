/**
 * DESKTOP 0.4.4, IN PEOPLE'S HANDS, AND THE RECEIPT IT HAS NEVER SEEN.
 *
 * The run ledger sends a `receipt` event just before the terminal event of a
 * step that ends a run (src/runs). 0.4.4 knows nothing of it: its step loop
 * hands any event that is not terminal to onEvent, whose switch ends
 * `default: break` (agent.js:1734), and it stops at the terminal after it.
 * This runs 0.4.4's own agent, read out of the desktop repo at its release
 * commit, on the same streams with and without a receipt, and holds that what
 * the person sees (the guide's calls), what is done (the driver's acts) and
 * what goes back to the server (the step requests) are the same.
 *
 * The fakes are the desktop's own (agent.test.js at that commit, lines
 * 45-109). Where the desktop repo is not at hand (CI), this skips: the
 * release is fixed, so the proof does not go stale.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

/** "Desktop 0.4.4": agent.js there is byte-identical to the desktop's main at e9bc7ab. */
const DESKTOP_044 = "1536067";
const FILES = ["agent.js", "frontApp.js", "resolver.js", "localfiles.js"];

/** 0.4.4's agent and the three files it requires, in a folder of their own; null where the repo is not at hand. */
function desktop044(): string | null {
  const repo = process.env.TAILZU_DESKTOP ?? "/home/user/TAILZU-DESKTOP";
  let dir: string | null = null;
  try {
    const files = FILES.map((f) => [f, execFileSync("git", ["-C", repo, "show", `${DESKTOP_044}:${f}`], { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "ignore"] })] as const);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailzu-desktop-044-"));
    for (const [f, src] of files) fs.writeFileSync(path.join(dir, f), src);
    return dir;
  } catch {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
}
const DIR = desktop044();
afterAll(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ev = Record<string, Any>;

// ---- the desktop's own fakes (agent.test.js at 1536067) -------------------------

function fakeDriver(snaps: Any[]) {
  const calls: Any[][] = [];
  let n = 0;
  const drv: Any = { calls };
  drv.snapshot = async (opts: Any) => {
    calls.push(["snapshot", opts]);
    const s = snaps[Math.min(n, snaps.length - 1)];
    n++;
    return typeof s === "function" ? s(n) : s;
  };
  for (const m of ["press", "click", "setValue", "focus", "scroll", "key", "open"]) {
    drv[m] = async (...args: Any[]) => { calls.push([m, ...args]); return { ok: true }; };
  }
  drv.acts = () => calls.filter((c) => c[0] !== "snapshot" && c[0] !== "look");
  return drv;
}

function fakeGuide(confirm: boolean) {
  const calls: Any[][] = [];
  const g: Any = { calls };
  for (const m of ["show", "state", "heard", "say", "point", "unpoint", "steps", "hide", "error", "badge", "offer"]) {
    g[m] = (...args: Any[]) => { calls.push([m, ...args]); };
  }
  g.confirm = (text: string, risk: string) => { calls.push(["confirm", text, risk]); return Promise.resolve(confirm); };
  return g;
}

/** scripts[k] is step k's events. */
function fakePost(scripts: Ev[][]) {
  const requests: Any[] = [];
  async function* post(req: Any, audio: Any, signal: Any, image: Any) {
    requests.push({ req: JSON.parse(JSON.stringify(req)), audio, signal, image: image || null });
    for (const ev of scripts[requests.length - 1] ?? [{ t: "done" }]) yield ev;
  }
  (post as Any).reqs = () => requests.map((r) => r.req);
  return post as Any;
}

// ---- the streams ---------------------------------------------------------------

const WIN = [0, 0, 900, 600];
const SLACK = {
  ok: true, app: { name: "Slack", pid: 42 }, window: { frame: WIN }, focused: null, selection: "", scale: "points",
  elements: [{ id: "e1", role: "button", label: "Export", frame: [700, 20, 80, 30] }], truncated: false, ms: 5,
};
const AUDIO = { mime: "audio/webm", data: Buffer.from("x") };
/** As the server sends it (src/runs/ledger.ts). */
const RECEIPT = { t: "receipt", receipt: { runId: "run_abc123", outcome: "done", line: "Done.", effects: 0, steps: 1, ms: 900, firstMs: 300 } };
const ENDS = ["done", "error", "ask", "approve"];
/** A step's stream with the receipt where the server puts it: just before a terminal that ends the run. */
const withReceipt = (list: Ev[]) => {
  const i = list.findIndex((e) => ENDS.includes(e.t));
  return i < 0 ? list : [...list.slice(0, i), RECEIPT, ...list.slice(i)];
};

const CASES: Record<string, Ev[][]> = {
  "an answer": [[{ t: "heard", text: "where's export?", mode: "show" }, { t: "say", text: "Up here." }, { t: "point", id: "e1" }, { t: "done" }]],
  "done with words": [[{ t: "heard", text: "export", mode: "do" }, { t: "say", text: "On it." }, { t: "done", text: "All done." }]],
  "an error": [[{ t: "heard", text: "x", mode: "do" }, { t: "error", code: "model_unavailable", message: "Ask can't think right now." }]],
  "an action, then done": [
    [{ t: "heard", text: "press export", mode: "do" }, { t: "action", kind: "press", id: "e1", risk: "free" }],
    [{ t: "heard", text: "press export", mode: "do" }, { t: "say", text: "Done." }, { t: "done" }],
  ],
  "a question": [[{ t: "heard", text: "send it", mode: "do" }, { t: "ask", text: "Which one?" }]],
  "an approval with no card": [[{ t: "heard", text: "post it", mode: "do" }, { t: "approve", taskId: "t1", approval: { id: "a1", connector: "slack", tool: "post", risk: "send", preview: "Post" } }]],
};

describe.skipIf(!DIR)(`desktop 0.4.4 (${DESKTOP_044}) fed a receipt before the terminal event`, () => {
  const agentJs = () => createRequire(path.join(DIR!, "agent.js"))("./agent.js") as { createAgent: (o: Any) => Any; readEvents: (body: AsyncIterable<Buffer>) => AsyncIterable<Ev> };

  /** One run of 0.4.4's agent on these streams: what the person saw, what was done, what went back. */
  async function play(scripts: Ev[][]) {
    let clock = 1_000_000;
    const driver = fakeDriver([SLACK]);
    const guide = fakeGuide(true);
    const post = fakePost(scripts);
    const knobs: Record<string, number> = { "desktop.agent.settleMs": 0, "desktop.agent.doneMs": 1, "desktop.agent.confirmMs": 50, "desktop.agent.snapshotTimeoutMs": 200 };
    const agent = agentJs().createAgent({
      driver, guide, post, paste: async () => {}, listen: async () => null,
      knob: (n: string, f: unknown) => (n in knobs ? knobs[n] : f), platform: "mac", now: () => (clock += 1), log: () => {},
    });
    agent.begin({ app: "Slack" });
    await agent.heard(AUDIO);
    await new Promise((r) => setTimeout(r, 30));
    // The run id is the agent's own random one: not part of what is compared.
    return { guide: guide.calls, acts: driver.acts(), reqs: post.reqs().map((q: Ev) => ({ ...q, runId: "x" })) };
  }

  for (const [name, scripts] of Object.entries(CASES)) {
    it(`does and shows the same: ${name}`, async () => {
      const plain = await play(scripts);
      const receipted = await play(scripts.map(withReceipt));
      expect(scripts.map(withReceipt).flat().filter((e) => e.t === "receipt")).toHaveLength(scripts.filter((s) => s.some((e) => ENDS.includes(e.t))).length);
      expect(receipted.guide).toEqual(plain.guide);
      expect(receipted.acts).toEqual(plain.acts);
      expect(receipted.reqs).toEqual(plain.reqs);
      expect(plain.guide.length).toBeGreaterThan(0);
    });
  }

  it("its reader passes a receipt line through as an event like any other, and its loop stops at the terminal after it", async () => {
    const body = [{ t: "heard", text: "x", mode: "do" }, RECEIPT, { t: "done" }, { t: "say", text: "after" }].map((e) => JSON.stringify(e)).join("\n") + "\n";
    const seen: string[] = [];
    for await (const ev of agentJs().readEvents((async function* () { yield Buffer.from(body); })())) seen.push(ev.t);
    expect(seen).toEqual(["heard", "receipt", "done", "say"]);
    // Its own terminal set, which the step loop breaks on, has no receipt in it.
    const src = fs.readFileSync(path.join(DIR!, "agent.js"), "utf8");
    expect(src).toContain('const TERMINAL = new Set(["action", "ask", "done", "error", "look", "approve", "device"]);');
    expect(src).toContain("default: break;");
  });
});
