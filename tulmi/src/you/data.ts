/**
 * "DOWNLOAD MY DATA" AND "DELETE MY DATA" (Privacy, and Delete account's "Want a copy first?").
 *
 * The download is one JSON file of everything Tailzu holds for the person, built from the exports and reads that already exist: the bots
 * platform's own export (bots, keys masked, commands, what each bot remembers), the profile and writing style, Xode's projects and jobs,
 * the connected apps (never a token) and their tasks, meeting notes, dictation history, files (their names and sizes; the files themselves are
 * downloaded where they are), and the You tab's own rows. A read that fails is left out and named in `missing`, never faked.
 *
 * The browser opens it from a link (the phone's and the window's openUrl carry no session): /v1/you/export/file?t=<token>, the token signed for
 * one person and good for 30 minutes (a key derived from the server's service key, so it exists only where data does).
 *
 * Deleting takes chats, notes and files: dictation history, what the bots remember and their chat summaries, Xode's conversations, meeting
 * notes, and files (their bytes first). The account, the plan, the bots themselves and the projects stay. Like DELETE /v1/account it needs the
 * service key, and says so when it is missing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthedUser } from "../auth/supabase.js";
import { supabase } from "../auth/supabase.js";
import type { Bots } from "../bots/index.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import { getConfig } from "../config.js";
import type { Connectors } from "../connectors/index.js";
import { listHistory } from "../history/store.js";
import type { MediaService } from "../media/index.js";
import { getNote, listNotes } from "../notes/store.js";
import { getPersonality } from "../personality/store.js";
import { getProfile } from "../profile/store.js";
import type { YouStore } from "./store.js";

export interface DataDeps {
  bots: Bots | null;
  code: Code | null;
  jobs: JobRouter | null;
  connectors: Connectors | null;
  media: MediaService | null;
  store: YouStore;
}

const LINK_MS = 30 * 60_000;
const UUIDISH = /^[A-Za-z0-9_-]{1,64}$/;

function linkKey(): string | null {
  const c = getConfig();
  const secret = c.SUPABASE_SERVICE_KEY || c.BOT_KEY_PEPPER || c.RAZORPAY_KEY_SECRET;
  return secret ? createHmac("sha256", secret).update("tailzu-you-export-v1").digest("hex") : null;
}

const sign = (key: string, body: string) => createHmac("sha256", key).update(body).digest("base64url").slice(0, 32);

/** The download link for one person, good for 30 minutes; null when the server has no secret to sign it with. */
export function exportLink(userId: string, now: number, origin = process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"): { url: string; expiresAt: number } | null {
  const key = linkKey();
  if (!key || !UUIDISH.test(userId)) return null;
  const exp = Math.floor((now + LINK_MS) / 1000);
  const body = `${userId}.${exp}`;
  return { url: `${origin.replace(/\/+$/, "")}/v1/you/export/file?t=${body}.${sign(key, body)}`, expiresAt: exp * 1000 };
}

/** Who a link was signed for, while it is good; else null. */
export function exportLinkUser(t: unknown, now: number): string | null {
  const key = linkKey();
  const parts = typeof t === "string" ? t.split(".") : [];
  if (!key || parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  if (!UUIDISH.test(userId) || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now) return null;
  const want = Buffer.from(sign(key, `${userId}.${exp}`)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
}

/** Everything held for the person, as one object. */
export async function gatherExport(user: AuthedUser, d: DataDeps, now: number): Promise<Record<string, unknown>> {
  const missing: string[] = [];
  const read = async <T>(name: string, p: () => Promise<T>): Promise<T | undefined> => {
    try { return await p(); } catch { missing.push(name); return undefined; }
  };
  const history: unknown[] = [];
  await read("history", async () => {
    let before: string | undefined, beforeId: string | undefined;
    for (let page = 0; page < 25; page++) {
      const r = await listHistory(user, { limit: 200, ...(before ? { before } : {}), ...(beforeId ? { beforeId } : {}) });
      history.push(...r.entries);
      if (!r.nextBefore || !r.entries.length) break;
      before = r.nextBefore; beforeId = r.nextBeforeId;
    }
  });
  const notes = await read("notes", async () => {
    const list = await listNotes(user, 500);
    const out: unknown[] = [];
    for (const n of list.slice(0, 200)) out.push((await getNote(user, n.id).catch(() => null)) ?? n);
    return out;
  });
  const [profile, personality, bots, projects, jobs, apps, tasks, files, you] = await Promise.all([
    read("profile", () => getProfile(user)),
    read("writing style", () => getPersonality(user)),
    d.bots ? read("bots", () => d.bots!.exportAll(user.id)) : undefined,
    d.code ? read("projects", async () => (await d.code!.store.listProjects(user.id)).map((p) => ({ id: p.id, repo: p.fullName, defaultBranch: p.defaultBranch, private: p.private, addedAt: p.createdAt }))) : undefined,
    d.jobs ? read("jobs", async () => (await d.jobs!.listJobs(user.id, 200)).map((j) => ({
      id: j.id, task: j.task, state: j.state, branch: j.branch, projectId: j.projectId, budgetPaise: j.budgetPaise, spentPaise: j.spentPaise, createdAt: j.createdAt, updatedAt: j.updatedAt,
    }))) : undefined,
    d.connectors ? read("connected apps", async () => (await d.connectors!.store.listConnections(user.id)).map((c) => ({
      app: c.connectorId, connected: !!c.tokensEnc, level: c.level, allowedWithoutAsking: c.autoOk, lastUsedAt: c.lastUsedAt, since: c.createdAt,
    }))) : undefined,
    d.connectors ? read("tasks", () => d.connectors!.tasks.list(user.id, 100)) : undefined,
    d.media ? read("files", async () => (await d.media!.store.list(user.id, 500)).map((m) => ({ id: m.id, name: m.name, kind: m.kind, type: m.mime, bytes: m.bytes }))) : undefined,
    read("you", () => d.store.exportRows(user.id)),
  ]);
  return {
    about: "Everything X0 Bot holds for you, as of exportedAt. Times are milliseconds since 1970 (UTC) unless written as a date.",
    exportedAt: new Date(now).toISOString(),
    account: { id: user.id, ...(user.email ? { email: user.email } : {}) },
    profile, writingStyle: personality, bots, code: { projects, jobs }, connectedApps: apps, tasks, notes, history, files,
    budgetAndSettings: you,
    ...(missing.length ? { missing } : {}),
  };
}

/** Chats, notes and files go; the account, the plan, the bots and the projects stay. */
export async function deleteMyData(userId: string, d: Pick<DataDeps, "media">, log?: { error: (o: object, m: string) => void }): Promise<{ ok: boolean; cleared: string[] }> {
  const admin = supabase();
  if (!admin) return { ok: false, cleared: [] };
  const cleared: string[] = [];
  // The bytes are in a bucket, not in the database: they go first, then the rows below.
  try { await d.media?.forAccountDelete(userId); } catch (err) { log?.error({ err }, "you: delete file bytes"); }
  for (const table of ["cleanup_history", "bot_facts", "bot_threads", "code_chat_threads", "notes", "media_items"]) {
    try {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) log?.error({ err: error }, `you: delete ${table}`); else cleared.push(table);
    } catch (err) { log?.error({ err }, `you: delete ${table}`); }
  }
  return { ok: cleared.length > 0, cleared };
}
