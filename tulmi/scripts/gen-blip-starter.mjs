#!/usr/bin/env node
/**
 * The desktop's own copy of Blip's catalog (TAILZU-DESKTOP src/shared/blipStarter.js), written from this repo's
 * shared/bots/blip.json: what Blip plays on a first launch, offline, or until the server's newer one arrives.
 *
 *   node scripts/gen-blip-starter.mjs [path/to/TAILZU-DESKTOP]
 *
 * Run it after changing shared/bots/blip.json for a release; between releases the server pushes the catalog itself.
 * The desktop's test compares the copy with this file when the two repos sit side by side.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const json = readFileSync(resolve(here, "../../shared/bots/blip.json"), "utf8");
const catalog = JSON.parse(json);
const desktop = resolve(process.argv[2] ?? resolve(here, "../../../TAILZU-DESKTOP"));
const out = join(desktop, "src/shared/blipStarter.js");
writeFileSync(out, `// GENERATED from TAILZU-BACKEND shared/bots/blip.json (tulmi/scripts/gen-blip-starter.mjs): do not edit here.
// Blip's catalog as this build carries it, for a first launch and offline; the server's newer one replaces it (shared/blip.js).
(function (root, starter) {
  if (typeof module === "object" && module && module.exports) module.exports = starter;
  else root.TailzuBlipStarter = starter;
})(typeof globalThis !== "undefined" ? globalThis : this, ${JSON.stringify(catalog)});
`);
console.log(`wrote ${out} (v ${catalog.v}, ${Object.keys(catalog.gestures ?? {}).length} moves)`);
