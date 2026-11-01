/**
 * WHERE XODE FELL SHORT IN REAL CHATS, AS CASES TO TEST IT ON.
 *
 * The chat marks a turn when the person did not take its answer: the next message was a reaction to it ("??", "why?", "matlab?") or said the same
 * thing again (code/chat/converse.ts; the `f` of a turn in code/chat/threads.ts). This lists those turns for ONE person, with the turns before them
 * and what was said next, as JSON lines e2e/xode-eval.ts reads (--extra):
 *
 *   npx tsx scripts/xode-cases.ts --user <the owner's user id> [--out e2e/cases/real.jsonl] [--days 30]
 *   docker compose exec backend node dist/tulmi/scripts/xode-cases.js --user <id>      (in the production container)
 *
 * A line: { id, repo, before, say, did: "?", says: [], flag, missed, then }. Fill `did` (answer, job or ask) and, when the answer must say
 * something, `says` (words, read as case-blind patterns); a line whose `did` is still "?" is skipped by the eval. Then:
 *
 *   npx tsx e2e/xode-eval.ts --only backend --modes loop --extra e2e/cases/real.jsonl
 *
 * These are a person's own words about their own code: run it for your own account, or for another person's only with their say. It needs the
 * server's SUPABASE_URL and SUPABASE_SERVICE_KEY, and prints no key. Exit 0 with cases written, 1 with none found, 2 when it cannot run.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { supabase } from "../src/auth/supabase.js";
import { lastOf, THREAD_ID } from "../src/code/chat/threads.js";

const arg = (name: string, d = ""): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const THREADS_MAX = 500;
const BEFORE_TURNS = 2;
const MISSED_CHARS = 800;

export interface RealCase { id: string; repo: string; before: string[]; say: string; did: "?"; says: string[]; flag: "reaction" | "rephrase"; missed: string; then: string }

/** The marked turns of a thread's history, each with the turns before it and the message after it. */
export function casesOf(threadId: string, repo: string, history: Array<{ q: string; a: string; f?: "reaction" | "rephrase" }>): RealCase[] {
  const out: RealCase[] = [];
  history.forEach((t, i) => {
    if (!t.f) return;
    out.push({
      id: `real-${threadId.slice(0, 8)}-${i}`, repo, before: history.slice(Math.max(0, i - BEFORE_TURNS), i).map((b) => b.q), say: t.q, did: "?", says: [],
      flag: t.f, missed: t.a.slice(0, MISSED_CHARS), then: history[i + 1]?.q ?? "",
    });
  });
  return out;
}

async function main(): Promise<number> {
  const user = arg("user");
  if (!THREAD_ID.test(user)) { console.error("Give the person's user id: --user <uuid> (your own, or someone's who said yes)."); return 2; }
  if (!getConfig().supabaseEnabled) { console.error("No database is configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)."); return 2; }
  const sb = supabase();
  if (!sb) return 2;
  const since = new Date(Date.now() - Math.max(1, Number(arg("days", "30")) || 30) * 86_400_000).toISOString();
  const threads = await sb.from("code_chat_threads").select("id, project_id, last_located").eq("user_id", user).gte("updated_at", since)
    .order("updated_at", { ascending: false }).limit(THREADS_MAX);
  if (threads.error) { console.error(`Could not read the chats: ${threads.error.message}`); return 2; }
  const rows = (threads.data ?? []) as Array<{ id: string; project_id: string; last_located: unknown }>;
  const ids = [...new Set(rows.map((r) => r.project_id))];
  const projects = ids.length ? await sb.from("code_projects").select("id, full_name").in("id", ids) : { data: [], error: null };
  const repoOf = new Map(((projects.data ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));
  const cases = rows.flatMap((r) => casesOf(r.id, repoOf.get(r.project_id) ?? r.project_id, lastOf(r.last_located).history));
  const file = arg("out", path.join("e2e", "cases", `real-${new Date().toISOString().slice(0, 10)}.jsonl`));
  if (!cases.length) { console.log(`No marked turns in ${rows.length} chats of the last ${arg("days", "30")} days.`); return 1; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${cases.map((c) => JSON.stringify(c)).join("\n")}\n`);
  console.log(`${cases.length} marked turns from ${rows.length} chats, written to ${file}. Fill "did" (answer, job or ask) in each before the eval reads it.`);
  return 0;
}

if (process.argv[1] && /xode-cases\.[jt]s$/.test(process.argv[1])) {
  main().then((c) => process.exit(c), (err) => { console.error("Could not list the cases:", (err as Error)?.message ?? "unknown error"); process.exit(2); });
}
