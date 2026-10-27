/**
 * THE CHECKS THAT LOOK AT THE FILES OF A RESULT AS A WHOLE: LEFTOVERS OF AN OLD NAME, WHAT MUST BE THERE, WHAT MUST STAY. Used by the scorer and by the
 * validator (the oracle's result has to satisfy them too), so both read the same rules the same way.
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../tasks/schema.js";

const re = (s: string): RegExp => new RegExp(s, "i");

/** The text files under a directory (not .git, node_modules, our report), up to half a megabyte each. */
export function walkTexts(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".e2e-report") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, r);
      else if (e.isFile()) {
        const st = fs.statSync(f);
        if (st.size > 512 * 1024) continue;
        const buf = fs.readFileSync(f);
        if (!buf.includes(0)) out.set(r, buf.toString("utf8"));
      }
    }
  };
  walk(root, "");
  return out;
}

export interface FileCheck { id: string; ok: boolean; detail: string }

export function fileChecks(task: Task, snap: ReadonlyMap<string, string>): { checks: FileCheck[]; keptFileLost: boolean } {
  const c = task.checks;
  const checks: FileCheck[] = [];
  let keptFileLost = false;
  for (const l of c.noLeftovers ?? []) {
    const r = re(l.pattern);
    const ex = (l.except ?? []).map(re);
    const left = [...snap].filter(([p, text]) => !ex.some((x) => x.test(p)) && r.test(text)).map(([p]) => p);
    checks.push({ id: "leftovers", ok: left.length === 0, detail: left.length ? `${left.length} file(s) still hold ${l.pattern}, e.g. ${left.slice(0, 3).join(", ")}` : `no file holds ${l.pattern} any more` });
  }
  for (const m of c.mustContain ?? []) {
    const text = snap.get(m.path);
    checks.push({ id: "must_contain", ok: text !== undefined && re(m.pattern).test(text), detail: text === undefined ? `${m.path} is gone` : re(m.pattern).test(text) ? `${m.path} has ${m.pattern}` : `${m.path} does not have ${m.pattern}` });
  }
  for (const m of c.mustKeep ?? []) {
    const text = snap.get(m.path);
    const kept = text !== undefined && re(m.pattern).test(text);
    if (!kept) keptFileLost = true;
    checks.push({ id: "kept", ok: kept, detail: kept ? `${m.path} is still there` : text === undefined ? `${m.path} was deleted` : `${m.path} no longer has ${m.pattern}` });
  }
  return { checks, keptFileLost };
}

/** A question's facts must be findable in the files the answer is about: the ground truth is grounded in the code, not in the author's memory. */
export function groundingProblems(task: Task, snap: ReadonlyMap<string, string>): string[] {
  const files = task.truth.answerFiles ?? [];
  if (!task.truth.facts?.length || !files.length) return [];
  const text = files.map((f) => snap.get(f) ?? "").join("\n");
  const missing = files.filter((f) => !snap.has(f)).map((f) => `answer file ${f} is not in the project`);
  const absent = task.truth.facts.filter((f) => !re(f).test(text)).map((f) => `fact /${f}/ is not in the answer files`);
  return [...missing, ...absent];
}
