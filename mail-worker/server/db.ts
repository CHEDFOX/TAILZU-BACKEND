// The mail worker's own records, in one SQLite file under DATA_DIR (a Docker volume). Mail itself lives in Stalwart; this keeps what
// Stalwart has no place for: each business (whose X0 account it is), each address's folder, auto-reply and AI mode, the rules, each
// business's brief, and the AI log with what each reply cost. From Xooteq Mail's dashboard (dashboard/server/db.ts), a schema of its own:
// no logins, AI providers or app users.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, "mail-worker.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Each migration runs once, in order; add new ones at the end, never edit old ones.
const migrations: string[] = [
  `CREATE TABLE companies (
     id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE, local TEXT NOT NULL,
     account_id TEXT NOT NULL, color TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '', daily_usd REAL,
     position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE INDEX companies_owner ON companies(owner);
   CREATE TABLE addresses (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     local TEXT NOT NULL, label TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
     auto_reply TEXT, ai_mode TEXT NOT NULL DEFAULT 'off', display_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
     UNIQUE(company_id, local));
   CREATE TABLE rules (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, match TEXT NOT NULL DEFAULT 'all',
     conditions TEXT NOT NULL, actions TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL);
   CREATE TABLE ai_profiles (
     company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE, profile TEXT NOT NULL);
   CREATE TABLE ai_runs (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, address TEXT, message_id TEXT,
     email_id TEXT, thread_id TEXT, sender TEXT, subject TEXT, mode TEXT, status TEXT NOT NULL,
     reason TEXT, draft_id TEXT, send_at INTEGER, model TEXT, cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE INDEX ai_runs_company ON ai_runs(company_id, created_at);
   CREATE UNIQUE INDEX ai_runs_once ON ai_runs(company_id, message_id) WHERE message_id IS NOT NULL;
   CREATE INDEX ai_runs_due ON ai_runs(status, send_at);`,
  // Each message sorted: what kind it is, how urgent, and one line of what the sender wants (shown in X0 Bot, the skipped ones too).
  // And the team's own changes to the AI's drafts, the last few of which teach later replies its way of writing.
  `ALTER TABLE ai_runs ADD COLUMN kind TEXT;
   ALTER TABLE ai_runs ADD COLUMN priority TEXT;
   ALTER TABLE ai_runs ADD COLUMN summary TEXT;
   CREATE TABLE ai_examples (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     subject TEXT NOT NULL DEFAULT '', ai_text TEXT NOT NULL, final_text TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX ai_examples_company ON ai_examples(company_id, created_at);`,
];

db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
const done = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value ?? 0);
for (let i = done; i < migrations.length; i++) {
  db.exec("BEGIN");
  try {
    db.exec(migrations[i]);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(i + 1));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => Date.now();

/** Runs fn in a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
