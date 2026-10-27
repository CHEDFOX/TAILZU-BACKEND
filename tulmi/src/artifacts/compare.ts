/**
 * THE COMPARE STEP: THE REAL APP, BUILT FROM THE DESIGN, AGAINST THE DESIGN (docs/artifacts.md section 11). It implements `CompareHook` (build.ts).
 *
 * For one viewport, given the preview's address:
 *   1. shoot the built page (shots.ts shootUrl) and the approved artifact at its version (shootArtifact), at the same size;
 *   2. THE CHEAP GATE (pixels.ts): both go down to a small grid of lightness and a coarse grid of colour, in pure TypeScript. When nothing a person would see
 *      differs, the model is NOT asked: the answer is a match of 0.95 to 1, no issues, no cost;
 *   3. otherwise the vision tier is sent both pictures, the component's name and where it lives, and the project's kit tokens, and answers
 *        { match: 0..1, issues: [{ area, issue, severity: "minor" | "major", fixHint }] }
 *      once. What it costs is metered in the job's budget (`budget: "job"`, the job's id), and a call that the job cannot afford is refused by the gateway
 *      before it is made (`BudgetExceeded`, which the caller decides about).
 * The compare runs once per viewport asked for (mobile 390 x 844, desktop 1280 x 800); the agent asks for mobile only when that is the project's main target.
 * Both shots are kept (shots.ts ShotStore) under a private key, and the answer carries their ids; a link to one is signed by whoever shows it.
 *
 * It never throws for a shot that failed or a model that said something unusable: that viewport's result says `error` and the others go on.
 */
import { z } from "zod";
import { callModel, type GatewayDeps } from "../code/brain/gateway.js";
import type { ChatMessage } from "../code/brain/types.js";
import type { CallFn } from "../code/work/model.js";
import { forModel, oneLine } from "../code/work/model.js";
import type { CompareHook, CompareInput, CompareJob, CompareResult, DesignIssue, ViewportResult } from "./build.js";
import { PngError, gate } from "./pixels.js";
import type { ArtifactService } from "./service.js";
import { SHOT_VIEWPORTS, ShotError, VIEWPORT_NAMES, shootArtifact, shootProblem, shootUrl, type ShootDeps, type ShotStore, type ViewportName } from "./shots.js";
import { isArtifactError } from "./types.js";

/** The most one compare call may cost in the worst case, in paise (two pictures, a short answer). */
export const COMPARE_CAP_PAISE = 120;
const MAX_ISSUES = 10;

const VerdictSchema = z.object({
  match: z.coerce.number().min(0).max(1),
  issues: z.array(z.object({
    area: z.string().min(1).max(160),
    issue: z.string().min(1).max(500),
    severity: z.enum(["minor", "major"]),
    fixHint: z.string().max(500).default(""),
  })).max(30).default([]),
});

export const COMPARE_SYSTEM = [
  "You compare two screenshots of one screen, taken at the same size, for a developer who is building a design into a real app.",
  "IMAGE 1 is the DESIGN the person approved: the target. IMAGE 2 is the REAL APP as it is built now.",
  "Say how well the real app matches the design in the part the design is about (the component named below), and list every difference a person would notice.",
  "Look at: layout and order, sizes and spacing, colours, fonts and weight, the words, icons, states, and what is missing or extra.",
  "Ignore: the rest of the app around the component, data that is different (names, numbers, dates), a scrollbar, a cursor, and pictures from other addresses, which the design's picture does not load (they are blank there).",
  "If the real app shows an error, a blank page or a login, say so as ONE major issue and nothing else.",
  "severity \"major\": the person would say it is wrong (a different layout, a missing part, a wrong colour or text, broken spacing). \"minor\": small polish (a few pixels, a slightly different shade).",
  "fixHint: one sentence telling the developer what to change, in the project's own terms (its tokens, its components); say nothing you cannot see.",
  "match is 1 for identical, 0 for nothing alike. Answer with JSON only: {\"match\": number, \"issues\": [{\"area\": string, \"issue\": string, \"severity\": \"minor\"|\"major\", \"fixHint\": string}]}, at most 10 issues, the worst first.",
].join("\n");

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const dataUrl = (png: Uint8Array): string => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

export interface CompareContext {
  userId: string;
  jobId?: string;
  /** The component's name (the design's title) and where in the project it goes. */
  component: string;
  location: string;
  /** The project's kit, for a model (at most 2,000 characters). */
  kit?: string;
  viewport: ViewportName;
  call?: CallFn;
  gateway?: GatewayDeps;
  signal?: AbortSignal;
}

export interface Verdict {
  match: number;
  issues: DesignIssue[];
  gate: "same" | "model";
  paise: number;
}

/**
 * Two PNGs of the same screen, the design's and the app's: the cheap gate first, then (if they differ) the vision tier. Throws PngError for a picture
 * that cannot be read, BudgetExceeded when the job cannot afford the call, and ModelUnavailable when no model could be reached.
 */
export async function compareShots(approved: Uint8Array, built: Uint8Array, c: CompareContext): Promise<Verdict> {
  const g = gate(approved, built);
  if (g.same) return { match: Math.round((1 - Math.min(0.05, g.difference)) * 100) / 100, issues: [], gate: "same", paise: 0 };

  const text = [
    `Component: ${cut(c.component, 120)}`,
    `Where it lives in the project: ${cut(c.location, 300)}`,
    `Viewport: ${c.viewport} (${SHOT_VIEWPORTS[c.viewport].width} x ${SHOT_VIEWPORTS[c.viewport].height})`,
    ...(c.kit?.trim() ? [`The project's style (use these names in your fix hints):\n${cut(c.kit.trim(), 1500)}`] : []),
    `The cheap check found: ${g.changedCells} regions of the screen differ in lightness${g.colorMax > 0.12 ? ", and some in colour" : ""}${g.sameShape ? "" : ", and the two pictures are not the same shape"}.`,
    "Image 1 is the design. Image 2 is the real app.",
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: COMPARE_SYSTEM },
    { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: dataUrl(approved) } }, { type: "image_url", image_url: { url: dataUrl(built) } }] },
  ];
  const call = c.call ?? (callModel as CallFn);
  const res = await call({
    tier: "vision", messages, json: VerdictSchema, maxTokens: 1100, purpose: "artifact.compare", userId: c.userId,
    ...(c.jobId ? { jobId: c.jobId, budget: "job" as const } : { budget: { maxPaise: COMPARE_CAP_PAISE } }),
    ...(c.signal ? { signal: c.signal } : {}),
  }, c.gateway);
  const v = res.json;
  if (!v) throw new ShotError("failed", "The model's answer could not be read.");
  const issues: DesignIssue[] = (v.issues ?? [])
    .map((i) => ({ area: oneLine(forModel(i.area), 160), issue: oneLine(forModel(i.issue), 500), severity: i.severity, fixHint: oneLine(forModel(i.fixHint ?? ""), 500), viewport: c.viewport }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1))
    .slice(0, MAX_ISSUES);
  // A match that says "perfect" with a major issue listed, or "nothing alike" with none, is made to agree with its issues.
  let match = Math.max(0, Math.min(1, v.match));
  if (issues.some((i) => i.severity === "major")) match = Math.min(match, 0.9);
  else if (!issues.length) match = Math.max(match, 0.9);
  return { match: Math.round(match * 100) / 100, issues, gate: "model", paise: res.paise };
}

// ------------------------------------------------------------------ the hook

export interface CompareHookDeps {
  shoot: ShootDeps;
  shots: ShotStore;
  /** The approved artifact at its version, with the project's look (service.get). */
  artifacts: Pick<ArtifactService, "get">;
  call?: CallFn;
  gateway?: GatewayDeps;
  /** Tests: the two shots in place of Cloudflare's or Chrome's. */
  shooter?: {
    url: typeof shootUrl;
    artifact: typeof shootArtifact;
  };
}

/** The address of a route on the preview: the preview's own address (which may carry a path of its own in cookie mode) and the route, joined. */
export function routeUrl(previewUrl: string, route: string | undefined): string {
  const r = !route || route === "/" ? "" : route.startsWith("/") ? route : `/${route}`;
  return r ? `${previewUrl.replace(/\/+$/, "")}${r}` : previewUrl;
}

export function createCompareHook(d: CompareHookDeps): CompareHook & { registered(jobId: string): CompareInput["spec"] | undefined } {
  const specs = new Map<string, CompareInput["spec"]>();
  const shooter = d.shooter ?? { url: shootUrl, artifact: shootArtifact };

  async function one(input: CompareInput, viewport: ViewportName, art: { id: string; type: "html" | "react" | "svg" | "mermaid" | "markdown"; title: string; content: string; kit?: Parameters<typeof shootArtifact>[2] }): Promise<ViewportResult> {
    const base = { viewport } as const;
    let built: Uint8Array;
    let approved: Uint8Array;
    try {
      // Both at once: they are different browsers' worth of work, and the wait is the page's.
      [built, approved] = await Promise.all([
        shooter.url(routeUrl(input.builtUrl!, input.route), { viewport }, d.shoot),
        shooter.artifact(art, input.spec.version, art.kit, viewport, d.shoot),
      ]);
    } catch (err) {
      return { ...base, match: 0, issues: [], gate: "failed", paise: 0, error: err instanceof ShotError ? err.message : "The page could not be shot." };
    }
    const kept = {
      built: await d.shots.put(input.job.userId, { artifactId: input.spec.artifactId, version: input.spec.version, kind: "built", viewport, jobId: input.job.jobId, at: Date.now() }, built).catch(() => null),
      approved: await d.shots.put(input.job.userId, { artifactId: input.spec.artifactId, version: input.spec.version, kind: "approved", viewport, jobId: input.job.jobId, at: Date.now() }, approved).catch(() => null),
    };
    const shots = kept.built && kept.approved ? { built: kept.built.id, approved: kept.approved.id } : undefined;
    try {
      const v = await compareShots(approved, built, {
        userId: input.job.userId, jobId: input.job.jobId, component: input.spec.title, location: input.location ?? input.route ?? "/", viewport,
        ...(input.kit ? { kit: input.kit } : {}), ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      });
      return { ...base, ...v, ...(shots ? { shots } : {}) };
    } catch (err) {
      // The job's money is the agent's to decide about; everything else is this viewport's result.
      if ((err as { code?: unknown } | null)?.code === "budget_exceeded") throw err;
      return { ...base, match: 0, issues: [], gate: "failed", paise: 0, ...(shots ? { shots } : {}), error: err instanceof PngError ? `A picture could not be read (${err.message}).` : "The comparison could not be made." };
    }
  }

  return {
    register(job: CompareJob, spec) { specs.set(job.jobId, spec); },
    registered: (jobId) => specs.get(jobId),
    async compare(input: CompareInput): Promise<CompareResult> {
      const problem = shootProblem(d.shoot, { artifact: true });
      if (problem) return { skipped: true, notes: [problem] };
      if (!input.builtUrl) return { skipped: true, notes: ["There is no built page to look at."] };
      let art;
      try {
        const view = await d.artifacts.get(input.job.userId, input.spec.artifactId, input.spec.version);
        art = { id: view.artifact.id, type: view.artifact.type, title: view.artifact.title, content: view.content, ...(view.kit ? { kit: view.kit } : {}) };
      } catch (err) {
        if (isArtifactError(err)) return { skipped: true, notes: ["The approved design could not be read, so it could not be compared."] };
        throw err;
      }
      const viewports = (input.viewports?.length ? input.viewports : VIEWPORT_NAMES).filter((v, i, all) => VIEWPORT_NAMES.includes(v) && all.indexOf(v) === i);
      const results: ViewportResult[] = [];
      for (const v of viewports) results.push(await one(input, v, art));
      const ok = results.filter((r) => r.gate !== "failed");
      if (!ok.length) return { skipped: true, notes: results.map((r) => r.error ?? "The page could not be shot."), viewports: results };
      const notes = results.flatMap((r) => (r.error ? [`${r.viewport}: ${r.error}`] : r.issues.map((i) => `${r.viewport}: ${i.severity}: ${i.area}: ${i.issue}`)));
      return { similarity: Math.round((ok.reduce((n, r) => n + r.match, 0) / ok.length) * 100) / 100, notes, viewports: results };
    },
  };
}
