/**
 * TELLING THE PERSON, FROM THE WORKER: A SIGNED CALL BACK TO THE VPS.
 *
 * The push credentials stay on the VPS (src/push there). When a job needs the person, finishes or fails, the Worker
 * posts { jobId, kind, text } to `${PUBLIC_ORIGIN}/v1/internal/code/notify`, signed with CODE_JOBS_SECRET the way the VPS
 * signs its calls here (tulmi/src/code/jobs/handoff/sign.ts). The VPS looks the job up and pushes to its owner; the body
 * names no person. A push that cannot be sent is not a failed job: this tries twice, never throws, and logs only an id and a code.
 */
import { signRequest } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { NOTIFY_PATH, type NotifyBody } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { Notify } from "../../tulmi/src/code/jobs/types.js";
import type { Env } from "./env.js";

export interface NotifyDeps {
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  log?: { warn(o: object, m: string): void };
  attempts?: number;
}

export function workerNotify(env: Pick<Env, "PUBLIC_ORIGIN" | "CODE_JOBS_SECRET">, d: NotifyDeps = {}): Notify {
  const call = d.fetchFn ?? ((url, init) => fetch(url, init));
  const now = d.now ?? Date.now;
  const attempts = d.attempts ?? 2;
  return async (_userId, kind, data) => {
    const origin = (env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
    const secret = env.CODE_JOBS_SECRET ?? "";
    if (!/^https:\/\//i.test(origin) || !secret) return;
    const body = JSON.stringify({
      jobId: data.jobId, kind, text: (data.reason ?? "").slice(0, 300), at: data.at,
      ...(data.to ? { to: data.to } : {}), ...(data.estimatePaise !== undefined ? { estimatePaise: data.estimatePaise } : {}),
    } satisfies NotifyBody);
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const res = await call(`${origin}${NOTIFY_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...signRequest({ secret, method: "POST", path: NOTIFY_PATH, body, now: now() }) },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        await res.body?.cancel().catch(() => undefined);
        if (res.ok || (res.status < 500 && res.status !== 429)) return;
      } catch { /* tried again below */ }
    }
    d.log?.warn({ jobId: data.jobId, kind }, "jobs worker: the VPS could not be told");
  };
}
