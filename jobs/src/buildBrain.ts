/**
 * BUILD BRAIN: ONE WORKFLOW INSTANCE PER BRAIN BUILD, id = brain-<projectId>-<headSha>.
 *
 * Asked for by the VPS (a project added, a push to the default branch after its quiet minute, the refresh route) or by the
 * agent's first phase when the brain is behind. One instance per head: asking again for a commit already being built is a no-op
 * (http.ts / workflows.ts startBrainBuild).
 *
 *   check   Is it still wanted? A brain that is already ready at this commit is not built again (unless a full rebuild was asked for).
 *   build   buildProjectBrain, full or incremental, to the end (tulmi/src/code/project/build.ts).
 *
 * WHY ONE STEP FOR THE BUILD. The snapshot, the per-file analysis, the import graph, the hotspots and the words are one function
 * (`runBuild`) over data that lives in memory from one to the next: the tree and the contents of up to 20,000 files, the extracts,
 * the graph. A Workflow step may hand on 1 MiB, and these are tens of megabytes, so the stages cannot be separate steps without
 * rewriting the build to save and reload between them. It does save as it goes (the analysis is written at 70%, the words later,
 * and a rebuild "pays only for what is missing"), so a retry after a crash starts again cheaply, and the progress and the status
 * are in the brain's row, which GET /v1/code/projects/:id/brain reads. The step is given the Worker's raised CPU limit
 * (wrangler.jsonc limits.cpu_ms, 300 s) and 30 minutes of wall clock, the most the Workflows rules recommend for a timeout.
 *
 * MEMORY. A Worker isolate has 128 MB (developers.cloudflare.com/workers/platform/limits/#memory). The build holds at most 60 MB of
 * text, and a repo that does not fit makes the step fail rather than be partly read; see docs/cloudflare-jobs.md.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { isSha, isUuid, type BrainBody } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { Env } from "./env.js";
import { getWorld } from "./world.js";

const CHECK_STEP = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
/** A build that fails is tried once more after a minute (GitHub or Supabase hiccuped); the row says why if it still fails. */
const BUILD_STEP = { retries: { limit: 1, delay: "1 minute", backoff: "constant" }, timeout: "30 minutes" } as const;

export interface BuildSummary {
  status: string;
  headSha: string;
  spentPaise: number;
  skipped?: string;
}

export class BuildBrain extends WorkflowEntrypoint<Env, BrainBody> {
  async run(event: WorkflowEvent<BrainBody>, step: WorkflowStep): Promise<BuildSummary> {
    const b = event.payload;
    if (!b || !isUuid(b.projectId) || !isSha(b.headSha) || typeof b.userId !== "string" || !b.userId || (b.mode !== "full" && b.mode !== "incremental")) {
      throw new NonRetryableError("userId, projectId, headSha and mode are needed.");
    }
    const wanted = await step.do("check", CHECK_STEP, async () => (await getWorld(this.env)).brain.check(b));
    if (wanted.skip) return { status: "ready", headSha: b.headSha, spentPaise: 0, skipped: wanted.reason };
    return step.do("build", BUILD_STEP, async () => (await getWorld(this.env)).brain.build(b));
  }
}
