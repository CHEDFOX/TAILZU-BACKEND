/**
 * WRITES THE HAND-AUTHORED TASKS TO e2e/tasks/*.json.
 *
 * Every module in e2e/tasks/author/ exports `tasks(): Promise<Task[]>`; each is written to the JSON file of the same name. The patches are built from the
 * pinned projects' real text (a pin that moved makes an edit fail loudly), so run this after changing repos.json, then `npm run e2e:validate`.
 * `tsx e2e/author.ts [module..]` (no argument: all of them).
 */
import { parseCli, runCli, type CliSpec } from "./cli.js";
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Task } from "./tasks/schema.js";
import { taskProblems } from "./tasks/schema.js";
import { IMAGES_DIR, TASKS_DIR, mkdirp, sh, writeJson } from "./util.js";
import { checkoutEnv, getRepo } from "./repos.js";

const AUTHOR_DIR = path.join(TASKS_DIR, "author");

/**
 * `--images`: renders the reference picture of each design task from its oracle's component, through the same dev server and browser the check uses,
 * and writes it to e2e/images/ (a task "from a screenshot" shows the bot that same picture).
 */
async function renderImages(only: string[]): Promise<void> {
  const { workTree } = await import("./score/hidden.js");
  const { startDevServer, shoot } = await import("./score/design.js");
  const { checkoutEnv } = await import("./repos.js");
  const net = await import("node:net");
  mkdirp(IMAGES_DIR);
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json") && (!only.length || only.includes(f.replace(/\.json$/, ""))));
  for (const f of files) {
    const list = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")) as Task[];
    for (const t of list) {
      const d = t.checks.design;
      if (!d) continue;
      const out = path.join(IMAGES_DIR, d.reference);
      const co = await workTree(t, (t.oracle.files ?? {}) as Record<string, string | null>, t.hidden?.files ?? {});
      let server: Awaited<ReturnType<typeof startDevServer>> | null = null;
      try {
        if (!co.spec?.ui) throw new Error(`${t.id}: no dev server for ${t.repo}`);
        const port: number = await new Promise((resolve, reject) => { const s = net.createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = (s.address() as import("node:net").AddressInfo).port; s.close(() => resolve(p)); }); });
        server = await startDevServer(co.spec.ui.dev, co.dir, checkoutEnv(co.spec, {}, co.dir), port);
        const png = await shoot(`http://127.0.0.1:${port}${d.route ?? "/"}`, "#e2e-target");
        fs.writeFileSync(out, png);
        console.log(`${t.id}: ${d.reference} (${png.length} bytes)`);
      } finally { server?.stop(); co.dispose(); }
    }
  }
}

/**
 * An oracle's patch is what a perfect worker would leave, and a perfect worker passes the project's own lint and format checks. So the patch's source files
 * go through the project's own formatter (repos.json `format`) in a checkout with the patch laid over it, and what comes out is the patch.
 */
async function formatOracle(t: Task): Promise<number> {
  const spec = t.repo !== "synthetic" ? getRepo(t.repo) : undefined;
  const files = t.oracle.files;
  if (!spec?.format || !files) return 0;
  const only = new RegExp(spec.format.only);
  const paths = Object.entries(files).filter(([p, c]) => typeof c === "string" && only.test(p)).map(([p]) => p);
  if (!paths.length) return 0;
  const { materialize } = await import("./validate.js");
  const { lay } = await import("./score/hidden.js");
  const m = await materialize(t);
  let changed = 0;
  try {
    lay(m.dir, files);
    const list = paths.map((p) => `'${p}'`).join(" ");
    await sh(spec.format.cmd.replace(/\{files\}/g, list), { cwd: m.dir, env: checkoutEnv(spec, {}, m.dir), timeoutMs: 180_000 });
    for (const p of paths) {
      const after = fs.readFileSync(path.join(m.dir, p), "utf8");
      if (after !== files[p]) { files[p] = after; changed += 1; }
    }
  } finally { m.dispose(); }
  return changed;
}

/** The modules other tasks are derived from come first, so a variant reads a finished (formatted) task from its JSON. */
const FIRST = ["features", "refactors", "questions", "ui"];

export const AUTHOR_SPEC: CliSpec = {
  name: "npm run e2e:author --",
  about: "write the authored tasks (e2e/tasks/author/*.ts) to e2e/tasks/*.json, formatted by each project's own formatter",
  positionals: { name: "[modules]", about: "only these task modules (default all)" },
  flags: { images: { kind: "bool", about: "render the reference picture of each design task instead" } },
};

async function main(): Promise<void> {
  const p = parseCli(AUTHOR_SPEC, process.argv.slice(2));
  const only = p.positionals;
  if (p.has("images")) { await renderImages(only); return; }
  const mods = fs.readdirSync(AUTHOR_DIR).filter((f) => f.endsWith(".ts") && f !== "lib.ts").map((f) => f.replace(/\.ts$/, "")).filter((m) => !only.length || only.includes(m)).sort((a, b) => (FIRST.includes(a) ? FIRST.indexOf(a) : 99) - (FIRST.includes(b) ? FIRST.indexOf(b) : 99) || (a < b ? -1 : 1));
  for (const m of mods) {
    const mod = (await import(pathToFileURL(path.join(AUTHOR_DIR, `${m}.ts`)).href)) as { tasks(): Promise<Task[]> };
    const list = await mod.tasks();
    for (const t of list) {
      const bad = taskProblems(t);
      if (bad.length) throw new Error(`${m}: task ${t.id} is not usable: ${bad.join(", ")}`);
    }
    let formatted = 0;
    for (const t of list) formatted += await formatOracle(t);
    // Keep a validation that is still true: the same oracle and hidden files as before.
    const file = path.join(TASKS_DIR, `${m}.json`);
    const before: Task[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    for (const t of list) {
      const old = before.find((x) => x.id === t.id);
      if (old?.validated && JSON.stringify({ o: old.oracle, h: old.hidden, b: old.base }) === JSON.stringify({ o: t.oracle, h: t.hidden, b: t.base })) t.validated = old.validated;
    }
    writeJson(file, list);
    console.log(`${m}: ${list.length} task(s) -> tasks/${m}.json${formatted ? ` (${formatted} patch file(s) reformatted by the project's formatter)` : ""}`);
  }
}

runCli(async () => { await main(); }).then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
