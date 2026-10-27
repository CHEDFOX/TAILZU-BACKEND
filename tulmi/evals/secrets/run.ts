/**
 * The secret scan, measured: what it catches, what it wrongly flags, and how long it takes, with and without Gitleaks' rules.
 *
 *   npm run bench:secrets
 *
 * COVERAGE   the forty providers of evals/secrets/providers.ts (tokens made at run time): how many the older rules alone flag, how many the scan flags, and
 *            how many it flags under the right name.
 * FALSE POSITIVES  the repository's own source and documents (tulmi/src, docs/, jobs/src, shared/, viewer/, media-worker/, deploy/, tulmi tests, evals and scripts; no dependencies): files flagged.
 * TIME       CPU milliseconds to scan tulmi/src + docs/ (every run after the first is warm; the first one also builds the keyword automaton and compiles
 *            the regular expressions the files wake), and the same in the worst case a hostile file can make of it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scanForSecrets } from "../../src/code/policy.js";
import { GL_RULES } from "../../src/code/secrets/gitleaksRules.js";
import { PROVIDERS } from "./providers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
type F = { path: string; content: string };

function filesUnder(dir: string, out: F[] = []): F[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (["node_modules", "dist", ".git", "build", ".wrangler", ".venv", "venv", "vendor", "__pycache__", "out", "cache"].includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) filesUnder(full, out);
    else if (st.size <= 1024 * 1024 && /\.(?:[cm]?[jt]sx?|json|md|py|sh|sql|ya?ml|html?|css|toml|swift|txt)$/i.test(name)) out.push({ path: relative(root, full), content: readFileSync(full, "utf8") });
  }
  return out;
}

const cpu = (fn: () => void): number => { const t = process.cpuUsage(); fn(); const u = process.cpuUsage(t); return (u.user + u.system) / 1000; };
const min = (xs: number[]): number => Math.min(...xs);

function coverage(): { providers: number; olderRules: number; scan: number; rightName: number; rules: number } {
  let older = 0, any = 0, right = 0;
  const rules = new Set<string>();
  for (const p of PROVIDERS) {
    const token = p.make();
    const path = p.path ?? "src/app.ts";
    const before = scanForSecrets([{ path, content: token }], { gitleaks: false });
    const after = scanForSecrets([{ path, content: token }]);
    if (before.length) older++;
    if (after.length) any++;
    if (after.some((h) => h.kinds.includes(p.kind))) { right++; rules.add(p.rule); }
  }
  return { providers: PROVIDERS.length, olderRules: older, scan: any, rightName: right, rules: rules.size };
}

const src = [...filesUnder(join(root, "tulmi", "src")), ...filesUnder(join(root, "docs"))];
const bytes = src.reduce((a, f) => a + f.content.length, 0);
const wide = [...src, ...["jobs/src", "shared", "viewer", "media-worker", "tulmi/evals", "tulmi/scripts", "deploy"].flatMap((d) => filesUnder(join(root, d)))];
const tests = filesUnder(join(root, "tulmi", "tests"));

const cov = coverage();
console.log(`coverage   ${cov.rightName}/${cov.providers} providers flagged under the right name (older rules alone: ${cov.olderRules}/${cov.providers}); ${cov.rules} distinct Gitleaks rules exercised of ${GL_RULES.length}`);

const olderHits = scanForSecrets(src, { gitleaks: false });
const hits = scanForSecrets(src);
const wideHits = scanForSecrets(wide);
console.log(`false pos  tulmi/src + docs/: ${src.length} files, ${(bytes / 1e6).toFixed(1)} MB: flagged ${hits.length} (older rules alone: ${olderHits.length}); wider (${wide.length} files: jobs, shared, viewer, media-worker, deploy, evals, scripts): flagged ${wideHits.length}`);
for (const h of wideHits.slice(0, 12)) console.log(`             ${h.path}: ${h.kinds.join(", ")}`);
const testHits = scanForSecrets(tests);
console.log(`           tulmi/tests (they hold made-up tokens on purpose): ${tests.length} files, flagged ${testHits.length} (older rules alone: ${scanForSecrets(tests, { gitleaks: false }).length})`);

const cold = cpu(() => scanForSecrets(src));
const warmOlder: number[] = [];
const warm: number[] = [];
for (let i = 0; i < 9; i++) { warmOlder.push(cpu(() => scanForSecrets(src, { gitleaks: false }))); warm.push(cpu(() => scanForSecrets(src))); }
console.log(`time       older rules alone ${min(warmOlder).toFixed(0)} ms; with Gitleaks' ${min(warm).toFixed(0)} ms (best of 9 warm runs; ${(bytes / 1e6 / (min(warm) / 1000)).toFixed(0)} MB/s); a first call in a fresh process: ${cold.toFixed(0)} ms`);

const hostile = (filler: string): string => GL_RULES.map((r) => (r.kw[0] ?? "") + filler.repeat(40)).join(" ").repeat(Math.ceil(900_000 / 12_000)).slice(0, 900_000);
const worst = Math.max(...["a", "-", "ab1", " ", "=", "\n"].map((f) => cpu(() => scanForSecrets([{ path: "x.txt", content: hostile(f) }]))));
console.log(`worst case a 900 KB file made of every rule's keyword and filler: ${worst.toFixed(0)} ms`);
