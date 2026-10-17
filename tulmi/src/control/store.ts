/**
 * Where the rules live: one JSON document on the server's own disk, on a
 * Docker volume so it survives every deploy (docker-compose: tulmi_control).
 *
 *   CONTROL_DIR/control.json        the live rules, with a version number
 *   CONTROL_DIR/history/v<N>.json   every version ever saved, for rollback
 *
 * Read once, kept in memory, and re-read when the file changes on disk, so
 * a rule edited by hand on the server goes live the same way one saved from
 * the console does. Writes are atomic (temp file, then rename): a crash mid-
 * save leaves the previous version in place, never half a file.
 *
 * A file that fails to parse or validate is refused whole and the last good
 * rules stay live, with the error kept for the console to show.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { RuleSchema, type Rule } from "./rules.js";

export const DocSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  updatedBy: z.string().optional(),
  rules: z.array(RuleSchema),
});
export type ControlDoc = z.infer<typeof DocSchema>;

const EMPTY: ControlDoc = { version: 0, updatedAt: new Date(0).toISOString(), rules: [] };
const KEEP_HISTORY = 500;

export class ControlStore {
  private doc: ControlDoc = EMPTY;
  private mtimeMs = -1;
  private checkedAt = 0;
  lastError: string | null = null;

  constructor(readonly dir: string, private readonly recheckMs = 2000) {}

  private get file() { return path.join(this.dir, "control.json"); }
  private get historyDir() { return path.join(this.dir, "history"); }

  /** The live rules. Cheap: re-reads the file at most every recheckMs. */
  current(): ControlDoc {
    const now = Date.now();
    if (now - this.checkedAt >= this.recheckMs || this.mtimeMs < 0) {
      this.checkedAt = now;
      this.reloadIfChanged();
    }
    return this.doc;
  }

  rules(): readonly Rule[] { return this.current().rules; }

  private reloadIfChanged(): void {
    let st: fs.Stats;
    try { st = fs.statSync(this.file); } catch { this.mtimeMs = 0; return; }
    if (st.mtimeMs === this.mtimeMs) return;
    this.mtimeMs = st.mtimeMs;
    try {
      this.doc = DocSchema.parse(JSON.parse(fs.readFileSync(this.file, "utf8")));
      this.lastError = null;
    } catch (e) {
      this.lastError = `control.json refused, last good rules kept: ${(e as Error).message}`;
    }
  }

  /** Save a new set of rules as the next version. Returns the saved doc. */
  save(rules: Rule[], by?: string): ControlDoc {
    const prev = this.current();
    const next: ControlDoc = DocSchema.parse({
      version: prev.version + 1,
      updatedAt: new Date().toISOString(),
      ...(by ? { updatedBy: by } : {}),
      rules,
    });
    fs.mkdirSync(this.historyDir, { recursive: true });
    const body = JSON.stringify(next, null, 2);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file);
    fs.writeFileSync(path.join(this.historyDir, `v${next.version}.json`), body);
    this.prune();
    this.doc = next;
    this.mtimeMs = fs.statSync(this.file).mtimeMs;
    this.lastError = null;
    return next;
  }

  /** Upsert one rule by id. */
  put(rule: Rule, by?: string): ControlDoc {
    const stamped = { ...rule, updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}) };
    const rules = this.rules().filter((r) => r.id !== rule.id);
    return this.save([...rules, stamped], by);
  }

  remove(id: string, by?: string): ControlDoc | null {
    const rules = this.rules();
    if (!rules.some((r) => r.id === id)) return null;
    return this.save(rules.filter((r) => r.id !== id), by);
  }

  /** Versions on disk, newest first. */
  history(limit = 50): Array<{ version: number; updatedAt: string; updatedBy?: string; rules: number }> {
    let files: string[] = [];
    try { files = fs.readdirSync(this.historyDir); } catch { return []; }
    return files
      .map((f) => /^v(\d+)\.json$/.exec(f)?.[1]).filter((x): x is string => !!x)
      .map(Number).sort((a, b) => b - a).slice(0, limit)
      .map((v) => {
        try {
          const d = DocSchema.parse(JSON.parse(fs.readFileSync(path.join(this.historyDir, `v${v}.json`), "utf8")));
          return { version: v, updatedAt: d.updatedAt, updatedBy: d.updatedBy, rules: d.rules.length };
        } catch { return null; }
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  version(v: number): ControlDoc | null {
    try {
      return DocSchema.parse(JSON.parse(fs.readFileSync(path.join(this.historyDir, `v${v}.json`), "utf8")));
    } catch { return null; }
  }

  /** Make an old version's rules live again, as a new version. */
  rollback(v: number, by?: string): ControlDoc | null {
    const old = this.version(v);
    return old ? this.save(old.rules, by ?? `rollback to v${v}`) : null;
  }

  private prune(): void {
    try {
      const vs = fs.readdirSync(this.historyDir)
        .map((f) => Number(/^v(\d+)\.json$/.exec(f)?.[1])).filter(Number.isFinite).sort((a, b) => b - a);
      for (const v of vs.slice(KEEP_HISTORY)) fs.rmSync(path.join(this.historyDir, `v${v}.json`), { force: true });
    } catch { /* history is best-effort */ }
  }
}
