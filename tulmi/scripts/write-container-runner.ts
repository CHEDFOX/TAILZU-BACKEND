/**
 * Writes jobs/container/run.mjs: the session runner X0's cloud container runs, which is the very script GitHub's computers run (RUN_MJS).
 *
 *   npx tsx scripts/write-container-runner.ts
 *
 * Run it after changing runScript.ts; tests/container-runner.test.ts fails while the two differ.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RUN_MJS } from "../src/code/jobs/runScript.js";

const out = fileURLToPath(new URL("../../jobs/container/run.mjs", import.meta.url));
writeFileSync(out, RUN_MJS);
console.log(`wrote ${out}`);
