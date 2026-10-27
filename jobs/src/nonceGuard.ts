/**
 * THE NONCES OF SIGNED CALLS, REMEMBERED WHERE EVERY ISOLATE CAN ASK.
 *
 * A signed call carries a nonce that may be used once (tulmi/src/code/jobs/handoff/sign.ts). A Worker has no memory
 * between requests and many isolates at once, so "seen before" has to live somewhere they share and that answers the
 * same to everyone: one Durable Object, with SQLite storage, asked by RPC. `claim` is one statement: INSERT OR IGNORE,
 * and the rows it wrote say whether the nonce was new. Expired rows are dropped on the way.
 *
 * (A Durable Object handles around a thousand requests a second; this takes one per signed call, which is a few a minute.)
 * https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
 */
import { DurableObject } from "cloudflare:workers";
import type { NonceStore } from "../../tulmi/src/code/jobs/handoff/sign.js";

export class NonceGuard extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
  }

  /** True the first time a nonce is seen, false after, until `expiresAt` (epoch ms). */
  async claim(nonce: string, expiresAt: number): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM nonces WHERE expires_at < ?", Date.now());
    const wrote = sql.exec("INSERT OR IGNORE INTO nonces (nonce, expires_at) VALUES (?, ?)", nonce, expiresAt);
    wrote.toArray();
    return wrote.rowsWritten > 0;
  }
}

/** The shared nonce book as the verifier takes it. */
export function durableNonces(ns: DurableObjectNamespace<NonceGuard>): NonceStore {
  return { claim: (nonce, expiresAt) => ns.get(ns.idFromName("signed-calls")).claim(nonce, expiresAt) };
}
