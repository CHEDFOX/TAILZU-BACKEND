/**
 * Writes tests/fixtures/store-build.json: the names the store build draws and
 * does, read from the phone repo's origin/main (scripts/storeBuild.ts says how).
 * Re-run when the store build changes what it draws, i.e. when a release goes
 * out:
 *
 *   npx tsx scripts/store-build-fixture.ts [/path/to/TAILZU-FRONTEND]
 *
 * The test reads this file when the phone repo is not at hand, and the repo
 * itself when it is.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { STORE_FILES, parseStoreBuild } from "./storeBuild.js";
import type { StoreSources } from "./storeBuild.js";

const repo = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "TAILZU-FRONTEND"));
const git = (...args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

const src = Object.fromEntries(
  Object.entries(STORE_FILES).map(([k, file]) => [k, git("show", `origin/main:${file}`)]),
) as unknown as StoreSources;
const build = parseStoreBuild(src);
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "tests", "fixtures", "store-build.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ from: `${repo} origin/main ${git("rev-parse", "--short", "origin/main")}`, ...build }, null, 1) + "\n");
console.log(`${out}: ${build.declared.length} declared, ${build.drawn.length} drawn, ${build.actions.length} actions, ${build.styleKeys.length} style keys`);
