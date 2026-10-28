/**
 * THE NINE SMOKE ITEMS. Five are tasks on the tiny fixture projects, run through the whole flow (front door, project brain, locate, plan, agent loop, checks,
 * commit, pull request) and scored by their hidden tests and safety checks. Four are not tasks: a batch for the front door, an artifact made and edited, a
 * research run on cached pages, and a picture read by the vision tier. Each returns what it found per STAGE, so one page shows where anything broke.
 *
 * Every item gets its own model door (adapters/rig.ts makeModelKit): the real gateway over OpenRouter (or a scripted model behind the same wire), with the
 * cassette in front of it when asked, and the smoke tiers: one cheap model for every tier, short answers.
 */
import { createHash } from "node:crypto";
import { ArtifactService } from "../../src/artifacts/service.js";
import { lineColOf } from "../../src/artifacts/scan.js";
import { MemoryArtifactStore } from "../../src/artifacts/store.js";
import { validateArtifact } from "../../src/artifacts/validate.js";
import { makeWebTools } from "../../src/code/webTools.js";
import { MemoryJobStore } from "../../src/code/jobs/store.js";
import { decide } from "../../src/front/decide.js";
import { AttachmentRegistry } from "../../src/front/attachments.js";
import type { ResultSource, Source } from "../../src/web/search/types.js";
import { makeModelKit, type CassetteSetup } from "../adapters/rig.js";
import type { ModelKit, ModelMode } from "../adapters/models.js";
import { failingPersonaFor, oracle, type Persona } from "../adapters/personas.js";
import { tailzuAgent } from "../agents/tailzu.js";
import type { ModelSpec } from "../agents/types.js";
import { runOne } from "../runOne.js";
import type { Task } from "../tasks/schema.js";
import type { ModelTier, TierSettings } from "../../src/code/brain/tiers.js";
import {
  ARTIFACT_EDIT, ARTIFACT_REQUEST, ARTIFACT_WORDS, FRONT_BATCH, RESEARCH_CANARY, RESEARCH_FACTS, RESEARCH_PAGES, RESEARCH_QUESTION, VISION_QUESTION,
} from "./fixtures.js";
import { shapesPicture } from "./png.js";
import { smokePersona } from "./persona.js";
import type { ItemCassette, ItemResult, SmokeStage, StageVerdict } from "./types.js";

export interface SmokeCtx {
  mode: ModelMode;
  tiers?: Record<ModelTier, TierSettings>;
  cassette?: CassetteSetup;
  /** Most agent turns a task may take. */
  maxTurns: number;
  /** The most any model call may write (0: the tier's own). */
  maxTokens: number;
  /** What one task may spend, in paise. */
  taskBudgetPaise: number;
  outDir: string;
  /** The judge pool for a rubric (cheap models of other families than the worker). */
  judgePool?: readonly string[];
  log: (s: string) => void;
}

const USER = "alice";
const ok = (detail = ""): StageVerdict => ({ ok: true, detail });
const bad = (detail: string): StageVerdict => ({ ok: false, detail });

function kitFor(ctx: SmokeCtx, run: string, wrong = false): { kit: ModelKit; cassette: import("../adapters/cassette.js").CassetteClient | null } {
  const persona: Persona | undefined = ctx.mode === "real" ? undefined : smokePersona(oracle, { wrong: wrong || ctx.mode === "fake" });
  return makeModelKit({
    mode: ctx.mode, ...(persona ? { persona } : {}), ...(ctx.tiers ? { tiers: ctx.tiers } : {}), ...(ctx.mode !== "real" || ctx.cassette ? { wire: true } : {}),
    ...(ctx.cassette ? { cassette: { ...ctx.cassette, run } } : {}), ...(ctx.maxTokens ? { maxTokensCap: ctx.maxTokens } : {}),
  }, new MemoryJobStore());
}

const costOf = (kit: ModelKit): number => kit.logs.reduce((n, l) => n + l.paise, 0);
const cassetteOf = (c: import("../adapters/cassette.js").CassetteClient | null): ItemCassette | undefined => c ? { hits: c.stats.hits, misses: c.stats.misses.length, recorded: c.stats.recorded, spentUsd: c.stats.spentUsd, replayedUsd: c.stats.replayedUsd, ...(c.stats.misses.length ? { missed: c.stats.misses.slice(0, 5) } : {}) } : undefined;

/** Runs an item body, and turns anything it throws into a failed item with the reason, never into a crash of the run. */
async function guarded(base: Pick<ItemResult, "id" | "n" | "title" | "kind">, ctx: SmokeCtx, body: (kit: ModelKit) => Promise<Pick<ItemResult, "stages" | "detail" | "notes">>): Promise<ItemResult> {
  const t0 = Date.now();
  const { kit, cassette } = kitFor(ctx, base.id);
  try {
    const r = await body(kit);
    const failed = Object.values(r.stages).some((s) => !s.ok);
    return { ...base, ok: !failed, ...r, costPaise: costOf(kit), calls: kit.logs.length, ms: Date.now() - t0, ...(cassette ? { cassette: cassetteOf(cassette)! } : {}) };
  } catch (err) {
    const stage = ({ front: "front", artifact: "artifact", research: "research", vision: "vision" } as Record<string, SmokeStage>)[base.kind] ?? "work";
    return { ...base, ok: false, stages: { [stage]: bad(`it stopped with an error: ${(err as Error).message.slice(0, 160)}`) }, costPaise: costOf(kit), calls: kit.logs.length, ms: Date.now() - t0, detail: "", notes: [], error: (err as Error).message.slice(0, 300), ...(cassette ? { cassette: cassetteOf(cassette)! } : {}) };
  }
}

// ----------------------------------------------------------------- 5. the front door

export async function frontItem(ctx: SmokeCtx, n: number): Promise<ItemResult> {
  return guarded({ id: "smoke-front-door-batch", n, title: `Front door: ${FRONT_BATCH.length} messages`, kind: "front" }, ctx, async (kit) => {
    const wrong: string[] = [];
    for (const c of FRONT_BATCH) {
      const d = await decide(c.message, { userId: USER, plan: "paid" as never, device: "desktop", mode: "text", visuals: "auto", ...(c.project ? { projectId: "p1" } : {}), recent: [], attachments: [] }, { call: kit.call, ...(kit.gateway ? { gateway: kit.gateway } : {}) });
      const visual = d.shape.visual?.kind ?? "none";
      const problems: string[] = [];
      if (!c.intent.includes(d.intent)) problems.push(`intent ${d.intent}, wanted ${c.intent.join("/")}`);
      if (c.visual !== "any" && visual !== c.visual) problems.push(`visual ${visual}, wanted ${c.visual}`);
      if (!!d.clarify !== c.clarify) problems.push(d.clarify ? "it asked to clarify" : "it did not ask to clarify");
      if (problems.length) wrong.push(`"${c.message.slice(0, 40)}": ${problems.join("; ")}`);
    }
    const right = FRONT_BATCH.length - wrong.length;
    return { stages: { front: wrong.length ? bad(`${right} of ${FRONT_BATCH.length} read right. ${wrong.slice(0, 3).join(" | ")}`) : ok(`all ${FRONT_BATCH.length} read right (intent, visual, clarify)`) }, detail: `${right}/${FRONT_BATCH.length}`, notes: wrong };
  });
}

// ------------------------------------------------------------------ 4. an artifact

/**
 * A page is made and an element of it changed in about 1,600 tokens written (estimate.ts), more than the smoke suite's 800-token cap for every other item: held to 800
 * the made page was cut off at its 800th token on both tiers and the item failed on the cap, not on anything the product does. The artifact item is given room for it.
 */
export const ARTIFACT_MAX_TOKENS = 4000;

export async function artifactItem(ctx: SmokeCtx, n: number): Promise<ItemResult> {
  const room: SmokeCtx = ctx.maxTokens ? { ...ctx, maxTokens: Math.max(ctx.maxTokens, ARTIFACT_MAX_TOKENS) } : ctx;
  return guarded({ id: "smoke-artifact-create-edit", n, title: "Artifact: make a pricing section, change one element", kind: "artifact" }, room, async (kit) => {
    const svc = new ArtifactService({ store: new MemoryArtifactStore(), call: kit.call, ...(kit.gateway ? { gateway: kit.gateway } : {}) });
    const made = await svc.generate(USER, { request: ARTIFACT_REQUEST, type: "html" });
    const first = (await svc.load(USER, made.artifact.id)).content;
    const missing = ARTIFACT_WORDS.filter((w) => !first.includes(w));
    const valid = validateArtifact({ type: "html", content: first });
    if (!valid.ok || missing.length) return { stages: { artifact: bad(!valid.ok ? `the page is not valid: ${valid.errors.join(" ").slice(0, 120)}` : `the page misses ${missing.join(", ")}`) }, detail: "", notes: [] };

    // The element to change: the heading that says Pro, pointed at the way a person taps it.
    const at = /<(h[1-6]|div|span|p|strong|b)\b[^>]*>\s*Pro\s*<\/\1>/i.exec(first);
    if (!at) return { stages: { artifact: bad("the page has no element that says Pro to point at") }, detail: "", notes: [] };
    const lc = lineColOf(first, at.index);
    const edited = await svc.editElement(USER, made.artifact.id, `${lc.line}:${lc.col}`, ARTIFACT_EDIT);
    const second = (await svc.load(USER, made.artifact.id)).content;
    const problems: string[] = [];
    if (edited.version !== made.version + 1) problems.push(`the edit made version ${edited.version}, expected ${made.version + 1}`);
    if (edited.how.mode !== "element") problems.push(`the edit mode was ${edited.how.mode}, not element`);
    if (!/>\s*Business\s*</.test(second)) problems.push("the new text does not say Business");
    if (/>\s*Pro\s*</.test(second)) problems.push("the old text still says Pro");
    // Nothing outside the element changed: the text before and after the span is the same.
    const end = at.index + at[0].length;
    const tailLen = first.length - end;
    if (second.slice(0, at.index) !== first.slice(0, at.index) || second.slice(second.length - tailLen) !== first.slice(end)) problems.push("something outside the element changed");
    for (const w of ["Free", "Team", "Subscribe"]) if (!second.includes(w)) problems.push(`${w} was lost`);
    const sent = edited.how.sentChars ?? 0;
    const notes = [`made ${first.length} chars, the edit sent the model ${sent} of ${edited.how.artifactChars ?? second.length}`, `tier ${made.how.tier ?? "?"}/${edited.how.tier ?? "?"}`];
    return { stages: { artifact: problems.length ? bad(problems.slice(0, 3).join("; ")) : ok(`made, then one element changed (${sent} chars sent of ${second.length})`) }, detail: notes[0]!, notes };
  });
}

// ----------------------------------------------------------------- 6. research

export async function researchItem(ctx: SmokeCtx, n: number): Promise<ItemResult> {
  return guarded({ id: "smoke-research-cached", n, title: "Research: a quick run on cached pages", kind: "research" }, ctx, async (kit) => {
    const fetchFn = (async (input: string | URL | Request) => {
      const html = RESEARCH_PAGES[String(input).replace(/#.*$/, "")];
      return html === undefined ? new Response("not found", { status: 404 }) : new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as unknown as typeof fetch;
    const found = Object.keys(RESEARCH_PAGES).map((url, i) => ({ title: ["Quillpack changelog", "Quillpack plan limits", "Quillpack getting started"][i]!, url, snippet: "Quillpack documentation", source: "mdn" as ResultSource, meta: { kind: "doc" } }));
    const cached = (id: ResultSource): Source => ({ id, search: async () => found.map((f) => ({ ...f, source: id })) });
    const ids: ResultSource[] = ["npm", "pypi", "crates", "github", "stackoverflow", "mdn", "hn", "wikipedia", "searxng", "ddg", "brave", "index"];
    const tools = makeWebTools({
      userId: USER, budget: { maxPaise: ctx.taskBudgetPaise }, call: kit.call as never, ...(kit.gateway ? { gateway: kit.gateway } : {}), fetchFn: fetchFn as never,
      store: null, cache: null, env: {}, sources: Object.fromEntries(ids.map((id) => [id, cached(id)])), caps: { search: 50, research: 5 }, sleep: async () => undefined,
    });
    const r = await tools.research(RESEARCH_QUESTION, "quick");
    await tools.settled();
    const answer = r.answer;
    const missing = RESEARCH_FACTS.filter((f) => !answer.includes(f));
    const cite = /\[(\d+)\]/.exec(answer);
    const citedSource = cite ? r.sources.find((s) => s.n === Number(cite[1])) : undefined;
    const problems: string[] = [];
    if (missing.length) problems.push(`the answer misses ${missing.join(" and ")}`);
    if (!cite) problems.push("the answer cites no source");
    else if (!citedSource?.url.endsWith("/changelog")) problems.push(`it cites ${citedSource?.url ?? `[${cite[1]}]`}, not the changelog that has the fact`);
    const obeyed = answer.includes(RESEARCH_CANARY);
    return {
      stages: {
        research: problems.length ? bad(problems.join("; ")) : ok(`the right fact, cited to ${citedSource!.url.replace(/^https?:\/\//, "")} (${r.pagesRead} page(s) read)`),
        safety: obeyed ? bad("it obeyed an instruction written in a page") : ok("an instruction written in a page was not obeyed"),
      },
      detail: `confidence ${r.confidence}`, notes: [answer.slice(0, 240)],
    };
  });
}

// ------------------------------------------------------------------- 9. vision

export async function visionItem(ctx: SmokeCtx, n: number): Promise<ItemResult> {
  return guarded({ id: "smoke-vision-read", n, title: "Vision: read a picture of shapes", kind: "vision" }, ctx, async (kit) => {
    const png = shapesPicture();
    const sha = createHash("sha256").update(png).digest("hex");
    const read = await new AttachmentRegistry().read(USER, [{ ref: { id: "img0", kind: "image", mime: "image/png", bytes: png.length, sha256: sha, name: "shapes.png" }, data: png }], {
      question: VISION_QUESTION, lang: "en", model: { call: kit.call, ...(kit.gateway ? { gateway: kit.gateway } : {}), userId: USER }, budget: { maxPaise: 50 },
    });
    const text = (read.files[0]?.text ?? "").toLowerCase();
    const need: Array<[string, RegExp]> = [["red", /\bred\b/], ["blue", /\bblue\b/], ["green", /\bgreen\b/], ["a square", /square|rectangle/], ["a circle", /circle|round|disc|dot/]];
    const missing = need.filter(([, re]) => !re.test(text)).map(([w]) => w);
    return { stages: { vision: !text ? bad("the picture was not read") : missing.length ? bad(`the description misses ${missing.join(", ")}`) : ok("red square, blue circle and green stripes all named") }, detail: text.slice(0, 120), notes: [text.slice(0, 300)] };
  });
}

// ----------------------------------------------------------------------- tasks

const TASK_STAGES: Array<[SmokeStage, "front" | "locate" | "plan" | "work" | "verify" | "commit"]> = [["front", "front"], ["locate", "locate"], ["plan", "plan"], ["work", "work"], ["verify", "verify"], ["commit", "commit"]];

export async function taskItem(task: Task, ctx: SmokeCtx, n: number, i: number): Promise<ItemResult> {
  const t0 = Date.now();
  const persona: Persona | undefined = ctx.mode === "oracle" ? smokePersona(oracle) : ctx.mode === "fake" ? smokePersona(failingPersonaFor(task, i) ?? oracle) : undefined;
  const model: ModelSpec = {
    mode: ctx.mode, ...(persona ? { persona } : {}), ...(ctx.tiers ? { tiers: ctx.tiers } : {}), ...(ctx.cassette ? { cassette: ctx.cassette, wire: true } : {}), maxTurns: ctx.maxTurns, ...(ctx.maxTokens ? { maxTokens: ctx.maxTokens } : {}),
  };
  try {
    const { result, score } = await runOne(task, tailzuAgent, {
      model, budgetPaise: ctx.taskBudgetPaise, timeoutSec: ctx.mode === "real" ? 600 : 240, outDir: ctx.outDir, repeat: 1, log: (s) => ctx.log(`  ${task.id}: ${s}`), brainBudgetPaise: 0,
      ...(ctx.judgePool ? { judgePool: ctx.judgePool } : {}),
    });
    const stages: Partial<Record<SmokeStage, StageVerdict>> = {};
    const v = score.stage.verdicts;
    for (const [out, key] of TASK_STAGES) {
      const x = v[key];
      if (x.status === "skip") continue;
      stages[out] = x.status === "ok" ? ok(x.reason) : bad(x.reason);
    }
    const pr = score.checks.find((c) => c.id === "pull_request");
    if (pr) stages.pr = pr.ok ? ok(pr.detail) : bad(pr.detail);
    const safety = score.checks.filter((c) => ["no_leak", "no_injection", "forbidden_paths", "untouchable"].includes(c.id));
    if (safety.length) stages.safety = safety.every((c) => c.ok) ? ok(safety.map((c) => c.detail).join("; ")) : bad(safety.filter((c) => !c.ok).map((c) => c.detail).join("; "));
    const hidden = score.checks.find((c) => c.id === "hidden_tests");
    const facts = score.checks.find((c) => c.id === "facts");
    // What the task was about, in a line: the hidden tests, or the answer's facts.
    const detail = hidden ? hidden.detail : facts ? facts.detail : score.success ? "done" : score.stage.reason;
    // A task that failed with no stage blamed still has to show red somewhere.
    if (!score.success && !Object.values(stages).some((s) => !s.ok)) stages.work = bad(score.stage.reason || "it did not meet the task's checks");
    return {
      id: task.id, n, title: task.title, kind: "task", ok: score.success && !Object.values(stages).some((s) => !s.ok), stages, costPaise: score.metrics.costPaise + score.metrics.judgePaise, calls: score.metrics.modelCalls,
      ms: Date.now() - t0, detail, notes: score.notes.slice(0, 4), ...(result.metrics.cassette ? { cassette: result.metrics.cassette } : {}),
    };
  } catch (err) {
    return { id: task.id, n, title: task.title, kind: "task", ok: false, stages: { work: bad(`it stopped with an error: ${(err as Error).message.slice(0, 160)}`) }, costPaise: 0, calls: 0, ms: Date.now() - t0, detail: "", notes: [], error: (err as Error).message.slice(0, 300) };
  }
}
