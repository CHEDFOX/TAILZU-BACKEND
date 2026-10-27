/**
 * TAILZU'S CODE BOT JOBS ON CLOUDFLARE: THE WORKER.
 *
 * The VPS keeps the API. Job EXECUTION is here: a Workflow per job (agentJob.ts) driving the agent loop one advance at a time, a
 * Workflow per brain build (buildBrain.ts), and a Cron Trigger every minute for the ticker (cron.ts). Two Durable Objects make the live session
 * (docs/cloudflare-jobs.md section 10): a person's PCs that are online (userDevices.ts) and, per job, its copy of the code, its runner and the
 * app's live view (jobRoom.ts). All the logic is the VPS's own
 * code, imported straight from ../tulmi/src and bundled by Wrangler's esbuild; what is in this folder is the glue (docs/cloudflare-jobs.md).
 */
import { handleRequest } from "./http.js";
import { runCron } from "./cron.js";
import type { Env } from "./env.js";

export { AgentJob } from "./agentJob.js";
export { BuildBrain } from "./buildBrain.js";
export { NonceGuard } from "./nonceGuard.js";
export { UserDevices } from "./userDevices.js";
export { JobRoom } from "./jobRoom.js";

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      // Never a value from the request or the environment in an answer or a log.
      console.error("jobs worker: a request failed", (err as Error)?.name ?? "error");
      return Response.json({ ok: false, code: "failed", message: "That did not work. Try again." }, { status: 500 });
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runCron(env).then(() => undefined, (err) => { console.error("jobs worker: the ticker failed", (err as Error)?.name ?? "error"); }));
  },
} satisfies ExportedHandler<Env>;
