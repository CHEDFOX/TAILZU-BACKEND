/**
 * `npm run e2e:cassettes`: gzips every cassette in e2e/cassettes (or E2E_CASSETTES_DIR) as one gzip member, `<name>.jsonl.gz`.
 * A plain `<name>.jsonl` is moved into it (and removed); a gzipped one written entry by entry (one member per entry) is packed again. Each file is checked to
 * read back byte for byte before the old one goes, so replay does not change. `--check` only says what would be done.
 */
import fs from "node:fs";
import { CASSETTES_DIR, cassetteNameOf, compactCassette } from "./adapters/cassette.js";
import { CliExit, parseCli } from "./cli.js";

let p;
try { p = parseCli({ name: "npm run e2e:cassettes --", about: "gzip the cassettes (one member each), checked to read back byte for byte", flags: { check: { kind: "bool", about: "say what would be done; write nothing" } }, positionals: false }, process.argv.slice(2)); }
catch (e) { if (e instanceof CliExit) { console.log(e.message); process.exit(e.code); } throw e; }
const names = [...new Set(fs.readdirSync(CASSETTES_DIR).map((f) => cassetteNameOf(f)).filter((n): n is string => !!n))].sort();
let before = 0, after = 0;
for (const n of names) {
  if (p.has("check")) { console.log(`would pack ${n}`); continue; }
  const r = compactCassette(CASSETTES_DIR, n);
  before += r.from; after += r.to;
  console.log(`${n}: ${(r.from / 1e6).toFixed(1)} MB -> ${(r.to / 1e6).toFixed(1)} MB (${(r.bytes / 1e6).toFixed(1)} MB of text)`);
}
if (!p.has("check")) console.log(`${names.length} cassette(s): ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
