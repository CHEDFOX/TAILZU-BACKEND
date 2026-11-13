/**
 * ONE PAGE WITH EVERY DESIGN ON IT, and two pickers: which design, and what day it is having (native/SPEC.md section 5.4).
 *
 *   cd tulmi && npx tsx scripts/native-render/preview.ts                 writes scripts/native-render/out/preview.html
 *   cd tulmi && npx tsx scripts/native-render/preview.ts --open          and prints the path to open
 *
 * No browser is needed to BUILD it (every design is drawn to HTML here and the page only shows and hides), and no server is
 * needed to look at it: it is one file, openable from the disk. That matters because the person who needs to see these is the
 * owner, on their own machine, deciding whether a design ships.
 *
 * Also the honest place to see the two rules that surprise people:
 *   - a word with a slot this surface cannot fill resolves to EMPTY and its line hides, so "{n} working" simply is not there
 *     on a Live Activity;
 *   - an accessory root is drawn by the system in one colour, so a design that leans on colour has nothing left on a Lock
 *     Screen. Both are visible here, side by side with the Home Screen version.
 */
import fs from "node:fs";
import path from "node:path";
import { catalog, defaultData, sample, sheetFor, modesFor, HERE } from "./render.js";

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));

/** The sheet's body only: the whole page HTML is wrapped once, around every pane. */
function body(html: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  return m ? m[1]! : html;
}

function build(): string {
  const c = catalog();
  const panes: string[] = [];
  const options: string[] = [];
  for (const d of Object.values(c.designs)) {
    for (const name of defaultData(d)) {
      const id = `${d.id}|${name}`;
      options.push(`<option value="${esc(id)}">${esc(d.id)} — ${esc(name)}</option>`);
      panes.push(`<section class="pane" data-id="${esc(id)}" hidden>
<p class="note">${esc(d.note ?? "")}</p>
${body(sheetFor(c, d, sample(name), name))}
${d.surface === "widget" ? `<h2>What the system does to it</h2>${body(modesFor(c, d, sample(name)))}` : ""}
</section>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Native looks — preview</title><style>
  * { box-sizing: border-box; margin: 0; }
  body { font: 400 13px -apple-system, system-ui, sans-serif; background: #fafaf9; color: #111; padding: 24px; }
  header { display: flex; gap: 12px; align-items: baseline; margin-bottom: 18px; flex-wrap: wrap; }
  h1 { font-size: 17px; font-weight: 600; }
  h2 { font-size: 13px; font-weight: 600; margin: 22px 0 10px; color: #555; }
  select { font: inherit; padding: 5px 8px; border-radius: 8px; border: 1px solid #d4d4d0; background: #fff; }
  .note { max-width: 70ch; color: #555; line-height: 1.5; margin-bottom: 18px; }
  .v { color: #777; font: 500 12px ui-monospace, monospace; }
</style></head><body>
<header><h1>Native looks</h1><span class="v">catalog v${c.v} · format ${c.format}</span>
<select id="pick">${options.join("")}</select></header>
${panes.join("\n")}
<script>
  const pick = document.getElementById("pick");
  const show = () => { for (const p of document.querySelectorAll(".pane")) p.hidden = p.dataset.id !== pick.value; };
  pick.addEventListener("change", show);
  show();
</script>
</body></html>`;
}

const out = path.join(HERE, "out");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, "preview.html");
fs.writeFileSync(file, build());
console.log(file);
if (process.argv.includes("--open")) console.log(`open file://${file}`);
