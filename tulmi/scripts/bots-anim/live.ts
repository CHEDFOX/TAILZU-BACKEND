/**
 * THE SCENE WORKBENCH (anim/SPEC.md 6.1): a draft catalog, played by the real engine, in a local page.
 *
 *   cd tulmi && npx tsx scripts/bots-anim/live.ts ../shared/bots/looks.json
 *   cd tulmi && npx tsx scripts/bots-anim/live.ts --check draft.json
 *
 * The page (live.html) runs TAILZU-DESKTOP/botTiles.js — the window's generated copy of the phone's core and scene
 * engine, so what it draws is what a phone draws. It reloads when the draft is saved, and it has a level slider, a
 * tap pad, a button for each event the moment lists, a facing toggle, a Reduce Motion toggle, the three node sizes,
 * and a live meter of expression ops, dots, drawing calls and milliseconds against SCENE_LIMITS.
 *
 * `--check` is the same gate a push goes through (SPEC 5.3): every engine in shared/bots/engines compiles the
 * projection it would really be served, the format-2 engine plays every format-2 moment on three node sizes and both
 * facings, and then it prints, for each build, whether the moment plays or which act it falls back to. It exits 1 on
 * an error, so it can sit in a script; a warning is printed and does not fail.
 *
 * Nothing here publishes: `PUT ?dry=1` and `PUT` stay the way to push, with the admin secret from the environment.
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TULMI = resolve(HERE, "../..");
const ENGINE = resolve(TULMI, "../../TAILZU-DESKTOP/botTiles.js");

const { checkWithEngines, perBuild, enginesHere } = await import("../../src/experience/bots/looksEngine.js");

/** The draft, read fresh every time, so a save is one reload away. */
function draft(file: string): { spec: Record<string, unknown>; mtime: number } {
  return { spec: JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>, mtime: statSync(file).mtimeMs };
}

/** The moments a format-2 engine has to play (the ones --check reports on). */
function sceneMoments(spec: Record<string, unknown>): string[] {
  const moments = (spec.moments ?? {}) as Record<string, { format?: number }>;
  return Object.entries(moments).filter(([, m]) => (m?.format ?? 1) >= 2).map(([id]) => id);
}

function check(file: string): never {
  const { spec } = draft(file);
  const engines = enginesHere();
  console.log(`engines: ${engines.length ? engines.map((e) => `${e.name} (format ${e.format})`).join(", ") : "none found"}`);
  const { errors, warnings } = checkWithEngines(spec);
  for (const w of warnings) console.log(`  warning  ${w}`);
  for (const e of errors) console.log(`  ERROR    ${e}`);
  const ids = sceneMoments(spec);
  if (!ids.length) console.log("no format-2 moments in this draft");
  for (const id of ids) {
    console.log(`\n${id}:`);
    for (const row of perBuild(spec, id)) {
      console.log(`  ${row.engine.padEnd(22)} format ${row.format}  ${row.plays ? "plays it" : `falls back to act ${row.act}`}`);
    }
  }
  console.log(errors.length ? `\n${errors.length} error(s): this draft would be refused.` : "\nNo errors: every build is served something it can play.");
  process.exit(errors.length ? 1 : 0);
}

function serve(file: string, port: number): void {
  const page = resolve(HERE, "live.html");
  createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    try {
      if (url === "/engine.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(readFileSync(ENGINE));
      } else if (url === "/catalog.json") {
        const d = draft(file);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          .end(JSON.stringify({ mtime: d.mtime, spec: d.spec }));
      } else if (url === "/stamp") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ mtime: statSync(file).mtimeMs }));
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(readFileSync(page));
      }
    } catch (e) {
      // A draft that does not parse is the usual case while typing: say so in the page, do not fall over.
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String((e as Error).message) }));
    }
  }).listen(port, () => {
    console.log(`bots-anim: ${file}\n  http://127.0.0.1:${port}  (save the file and the page picks it up)`);
  });
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const checking = argv.includes("--check");
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--port");
if (!file) {
  console.error("usage: npx tsx scripts/bots-anim/live.ts <draft.json> [--port 5055]\n       npx tsx scripts/bots-anim/live.ts --check <draft.json>");
  process.exit(1);
}
if (checking) check(resolve(file));
else serve(resolve(file), Number(flag("port")) || 5055);
