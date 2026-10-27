/**
 * Jobs on Cloudflare, the VPS's side: see docs/cloudflare-jobs.md.
 *
 *   protocol.ts   the messages both sides send (ids and kinds, never contents)
 *   sign.ts       HMAC-SHA256 over method, path, timestamp, nonce and body; five minutes; a nonce used once
 *   client.ts     JobsHandoff: the VPS's signed calls to the Worker, three attempts each
 */
import type { AppConfig } from "../../../config.js";
import { JobsHandoff } from "./client.js";

export * from "./protocol.js";
export * from "./sign.js";
export * from "./client.js";

/** The hand-off to the Worker when CODE_JOBS_MODE=cloudflare, or null in local mode (today's behaviour). */
export function jobsHandoffFromConfig(
  cfg: Pick<AppConfig, "CODE_JOBS_MODE" | "CODE_JOBS_URL" | "CODE_JOBS_SECRET">,
  log?: { warn(o: object, m: string): void },
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
): JobsHandoff | null {
  if (cfg.CODE_JOBS_MODE !== "cloudflare") return null;
  return new JobsHandoff({ url: cfg.CODE_JOBS_URL ?? "", secret: cfg.CODE_JOBS_SECRET ?? "", ...(log ? { log } : {}), ...(fetchFn ? { fetchFn } : {}) });
}
