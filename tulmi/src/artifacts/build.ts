/**
 * "BUILD IT": FROM AN ARTIFACT THE PERSON APPROVED TO A CODE JOB THAT BUILDS IT INTO THE PROJECT.
 *
 * The person has looked at a design (an artifact, made in their project's style by kit.ts componentArtifact or by a bot),
 * clicked around it, changed what they wanted, and said "build it". buildFromArtifact(...) turns that version into a
 * Code bot job:
 *
 *   1. the artifact is read AT THE VERSION they approved, not the head (they may have kept editing since)
 *   2. the project's kit is read (kit.ts; the cache makes it free when the brain has not moved) and locate() says where
 *      in the project it would go (code/work/locate.ts)
 *   3. a work branch is made (code/projects.ts createWorkBranch) and a job on it, driven by the agent loop
 *   4. the job's TASK says what is to be built, where, in the project's style, and carries a short view of the design; the
 *      job's STATE carries the whole design as the SPEC (code/agent/types.ts SpecArtifact) and the place found, so:
 *        - the model is shown the design as the thing to match, every turn, beside the project's kit (agent/context.ts)
 *          and told to use the project's REAL components and conventions rather than the artifact's stand-ins
 *        - the locate phase is not run again: the answer found now stands
 *
 * THE SCREENSHOT COMPARE (compare.ts) plugs in through `CompareHook`: when the job is made, `register` tells it which artifact and
 * version are this job's spec, and later `compare` is given where the built page can be seen and answers how close it is, viewport by
 * viewport. The agent's design round (code/agent/design.ts) calls it after the checks pass. Where no browser is set up the default hook
 * (`noCompare`) does nothing and says so; the job runs the same either way.
 *
 * Nothing here edits the person's repo: the job does, through the workspace and the policy, as every job does.
 */
import type { AgentOrchestrator } from "../code/agent/orchestrator.js";
import { SPEC_CHARS_MAX, type SpecArtifact } from "../code/agent/types.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import type { JobRouter } from "../code/jobs/router.js";
import type { CodeJob } from "../code/jobs/types.js";
import { assertAccess, createWorkBranch, ownProject, type ProjectDeps } from "../code/projects.js";
import { locate, type LocateBrain, type Located } from "../code/work/locate.js";
import type { CallFn } from "../code/work/model.js";
import { designKit, type KitBrain, type KitDeps } from "./kit.js";
import type { ViewportName } from "./shothost.js";
import type { ArtifactService } from "./service.js";
import { ArtifactError } from "./types.js";

// ------------------------------------------------------------------ the compare seam

export interface CompareJob { jobId: string; userId: string; projectId: string; branch: string }

/** One difference between the design and the built page, as the vision tier reports it. */
export interface DesignIssue {
  /** Where on the screen, in words ("the pricing card's header"). */
  area: string;
  issue: string;
  /** "major": the person would say it is wrong. "minor": polish. */
  severity: "minor" | "major";
  /** One sentence telling a developer what to change. */
  fixHint: string;
  viewport: ViewportName;
}

/** What one viewport came to. */
export interface ViewportResult {
  viewport: ViewportName;
  /** 0 to 1. */
  match: number;
  issues: DesignIssue[];
  /** "same": the cheap gate found the shots alike and the model was not asked. "model": the vision tier looked. "failed": see `error`. */
  gate: "same" | "model" | "failed";
  /** What the model call cost, in paise (0 when the gate answered). */
  paise: number;
  /** Ids of the two shots in the shot store (shots.ts), when they were kept. */
  shots?: { built: string; approved: string };
  error?: string;
}

/** What the compare step is given about the built page. */
export interface CompareInput {
  job: CompareJob;
  spec: Pick<SpecArtifact, "artifactId" | "version" | "type" | "title">;
  /** Where the built page can be seen: the preview's address (shots of it are made by a browser that fetches it). */
  builtUrl?: string;
  /** The page of the app the design is shown on (`/pricing`); `/` when not given. */
  route?: string;
  /** Where in the project the design goes, for the model ("src/components/Pricing.tsx"). */
  location?: string;
  /** The project's kit, for the model. */
  kit?: string;
  /** Which viewports to compare. All of them when not given. */
  viewports?: ViewportName[];
}

export interface CompareResult {
  /** The compare did not run (no browser, no viewer, no built page). */
  skipped?: boolean;
  /** 0 to 1: how close the built page is to the design (the average over the viewports that were compared). */
  similarity?: number;
  /** What differs, in words. */
  notes: string[];
  /** Each viewport's result, with its issues and the ids of its shots. */
  viewports?: ViewportResult[];
}

export interface CompareHook {
  /** The job was made from this artifact version: remember it, so the compare step can find the spec for the job. */
  register(job: CompareJob, spec: Pick<SpecArtifact, "artifactId" | "version" | "type" | "title">): Promise<void> | void;
  /** Compare the built page to the spec's rendering. */
  compare(input: CompareInput): Promise<CompareResult>;
}

/** The hook where no screenshot step is set up: it remembers nothing and compares nothing. */
export const noCompare: CompareHook = {
  register() { /* nothing to remember */ },
  async compare() { return { skipped: true, notes: [] }; },
};

// ------------------------------------------------------------------ build it

export interface BuildDeps {
  service: ArtifactService;
  projects: ProjectDeps;
  jobs: Pick<JobRouter, "createJob">;
  agent: Pick<AgentOrchestrator, "enqueue">;
  kit: KitDeps;
  brain: KitBrain & LocateBrain;
  /** The screenshot compare step (compare.ts createCompareHook); `noCompare` when none is given. */
  compareHook?: CompareHook;
  call?: CallFn;
  gateway?: GatewayDeps;
}

export interface Built {
  job: CodeJob;
  branch: string;
  spec: Pick<SpecArtifact, "artifactId" | "version" | "type" | "title" | "target">;
  located: Pick<Located, "targets" | "confidence" | "question">;
  /** The task text the job was made with. */
  task: string;
  kit: { headSha: string; cached: boolean };
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What to search the project with: the design's title, and the words it was made from (the first version's note). */
async function searchWords(service: ArtifactService, userId: string, artifactId: string, title: string, type: string): Promise<string> {
  const versions = await service.versions(userId, artifactId).catch(() => []);
  const first = versions.length ? versions[versions.length - 1]!.note : "";
  return [title, first && first !== "Created" ? first.replace(/^Component:\s*/i, "") : "", `(a ${type} design)`].filter(Boolean).join(" ");
}

/**
 * The task a job is made with: short, because the planner and the classifier read it; the design itself is the job's spec.
 * It names what is built, where, in what style, and shows the top of the design.
 */
export function buildTask(o: { title: string; type: string; version: number; target: Array<{ path: string; why: string }>; kit: string; content: string }): string {
  const where = o.target.length
    ? `Where it goes (found by searching the project): ${o.target.slice(0, 3).map((t) => `${t.path} (${cut(t.why, 100)})`).join("; ")}.`
    : "No place in the project stood out; put it where a component of this kind belongs, and say where you chose.";
  return [
    `Build the design "${cut(o.title, 80)}" (the person approved version ${o.version}, a ${o.type} artifact) into this project, so that it looks and behaves like the design.`,
    "Use the project's own components, styles and conventions rather than the design's stand-ins. The whole design is the SPEC shown with every step.",
    where,
    ...(o.kit ? [`The project's style kit:\n${cut(o.kit, 1200)}`] : []),
    `The top of the design, for orientation:\n${cut(o.content, 1500)}`,
  ].join("\n\n").trim();
}

/**
 * Makes the job. The artifact must be the person's and `version` one that exists; the project must be theirs too. Throws the service's
 * ArtifactError for the former, and the Code bot's ConnectorError (not_found, no_access, too_many...) for the latter.
 */
export async function buildFromArtifact(d: BuildDeps, userId: string, artifactId: string, version: number, projectId: string, o: { budgetPaise?: number; now?: () => number } = {}): Promise<Built> {
  if (typeof version !== "number" || !Number.isInteger(version)) throw new ArtifactError("bad_request", "version is the version the person approved.");
  const view = await d.service.get(userId, artifactId, version);
  const project = await ownProject(d.projects, userId, projectId);
  await assertAccess(d.projects, userId, project);

  const { kit, cached } = await designKit(d.kit, { id: project.id, userId, name: project.fullName });
  const words = await searchWords(d.service, userId, view.artifact.id, view.artifact.title, view.artifact.type);
  const located = await locate(`Build ${words}`, d.brain, {
    model: { userId, budget: { maxPaise: 100 }, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}) },
    read: (p) => d.kit.files.read(p),
  });
  const target = located.targets.slice(0, 4).map((t) => ({ path: t.path, why: t.why }));
  const truncated = view.content.length > SPEC_CHARS_MAX;
  const spec: SpecArtifact = {
    artifactId: view.artifact.id, version, type: view.artifact.type, title: view.artifact.title,
    content: truncated ? view.content.slice(0, SPEC_CHARS_MAX) : view.content, ...(truncated ? { truncated } : {}),
    kit: kit.prompt, target, approvedAt: (o.now ?? Date.now)(),
  };
  const task = buildTask({ title: spec.title, type: spec.type, version, target, kit: kit.prompt, content: spec.content });

  const { branch } = await createWorkBranch(d.projects, userId, project.id, `build ${spec.title}`);
  const job = await d.jobs.createJob(userId, project.id, branch, task, o.budgetPaise, { agent: true });
  // The whole task goes into the agent's state (the job keeps its first characters), with the design and the place found.
  const made = await d.agent.enqueue(job.id, task, { spec, located });
  await (d.compareHook ?? noCompare).register({ jobId: job.id, userId, projectId: project.id, branch }, { artifactId: spec.artifactId, version, type: spec.type, title: spec.title });
  return {
    job: made ?? job, branch, spec: { artifactId: spec.artifactId, version, type: spec.type, title: spec.title, target }, task,
    located: { targets: located.targets, confidence: located.confidence, ...(located.question ? { question: located.question } : {}) }, kit: { headSha: kit.headSha, cached },
  };
}
