/**
 * The services every Bots app area's routes may use (routes/bots{Shell,You,Bots,Keybot,Code}.ts).
 * Each area registers its own endpoints in its own file; server.ts already calls all five, so an area never edits server.ts.
 */
import type { Artifacts } from "../artifacts/index.js";
import type { Bots } from "../bots/index.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import type { Connectors } from "../connectors/index.js";
import type { MediaService } from "../media/index.js";

export interface BotsAreaDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when the matching feature is off. */
  bots: Bots | null;
  code: Code | null;
  jobs: JobRouter | null;
  connectors: Connectors | null;
  media: MediaService | null;
  artifacts: Artifacts | null;
  /** The Code bot's agent: its answer to a job's question (the widgets' and notifications' quick answers, routes/widgets.ts). Optional. */
  agent?: { answer(userId: string, jobId: string, answer: unknown): Promise<unknown> } | null;
}
