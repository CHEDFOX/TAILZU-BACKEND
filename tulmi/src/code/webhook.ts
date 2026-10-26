/**
 * GITHUB TELLING US THAT AN INSTALL CHANGED.
 *
 *   POST /v1/code/github/webhook
 *
 * GitHub is the caller, not a person, so there is no session: the request is
 * trusted only if X-Hub-Signature-256 is "sha256=" and the HMAC-SHA256 (hex)
 * of the raw body under GITHUB_APP_WEBHOOK_SECRET. The raw body is kept by the
 * server's JSON parser for this path (server.ts, as for Razorpay's), since a
 * signature is over the bytes as sent. The compare is timing-safe (auth/secret.ts). With no
 * secret set, every delivery is refused.
 *
 * What it does, and all it does:
 *
 *   installation               deleted    drop everyone's links to it, and their projects on it
 *   installation               suspend    mark it suspended: Tailzu makes no call under it (projects.ts)...
 *   installation               unsuspend  ...until the mark is cleared
 *   installation_repositories  removed    drop the projects on the repos taken off it
 *
 * Anything else is a 202 and nothing. It only touches Tailzu's own store: it
 * never calls GitHub, so it answers fast (GitHub gives up after ten seconds),
 * and a delivery that arrives twice or late does the same thing twice.
 */
import { createHmac } from "node:crypto";
import { sameSecret } from "../auth/secret.js";
import type { CodeStore } from "./store.js";

/** True when `header` is the signature of `raw` under `secret`. False for no secret, no header, or any other value. */
export function signatureOk(raw: string, header: string, secret: string): boolean {
  if (!secret || !header) return false;
  return sameSecret(header, "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
}

/** The signature GitHub would send for `raw` (for tests and for anyone wiring a fake). */
export const signatureFor = (raw: string, secret: string): string =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

const idOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

/** What a delivery did: "handled" (a change was made, or there was nothing left to change), or "ignored". */
export async function handleWebhook(store: CodeStore, event: string, payload: unknown, now = Date.now()): Promise<"handled" | "ignored"> {
  const p = (payload && typeof payload === "object" ? payload : {}) as {
    action?: unknown; installation?: { id?: unknown }; repositories_removed?: Array<{ id?: unknown }>;
  };
  const installationId = idOf(p.installation?.id);
  if (installationId === null) return "ignored";

  if (event === "installation") {
    if (p.action === "deleted") { await store.removeInstallationForAll(installationId); return "handled"; }
    if (p.action === "suspend") { await store.setSuspended(installationId, now); return "handled"; }
    if (p.action === "unsuspend") { await store.setSuspended(installationId, null); return "handled"; }
    return "ignored";
  }
  if (event === "installation_repositories" && p.action === "removed") {
    const repoIds = (Array.isArray(p.repositories_removed) ? p.repositories_removed : [])
      .map((r) => idOf(r?.id)).filter((id): id is number => id !== null);
    await store.removeReposForAll(installationId, repoIds);
    return "handled";
  }
  return "ignored";
}
