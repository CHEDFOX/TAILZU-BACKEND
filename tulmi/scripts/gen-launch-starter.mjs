#!/usr/bin/env node
/**
 * The phone's own copy of its launch motion (TAILZU-FRONTEND app/src/launch/launchStarter.ts), written from this repo's
 * shared/launch/launch.json: what the launch plays on a first start, offline, or until the server's newer one has been
 * kept (the bootstrap's "app.launch", read on the next start).
 *
 *   node scripts/gen-launch-starter.mjs [path/to/TAILZU-FRONTEND]
 *
 * Run it after changing shared/launch/launch.json for a release; between releases the server sends the launch itself.
 * The app's test compares the copy with this file when the two repos sit side by side.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const launch = JSON.parse(readFileSync(resolve(here, "../../shared/launch/launch.json"), "utf8"));
const app = resolve(process.argv[2] ?? resolve(here, "../../../TAILZU-FRONTEND"));
const out = join(app, "app/src/launch/launchStarter.ts");
writeFileSync(out, `// GENERATED from TAILZU-BACKEND shared/launch/launch.json (tulmi/scripts/gen-launch-starter.mjs): do not edit here.
// The launch's motion as this build carries it, for a first start and offline; the server's replaces it (launchMotion.ts).
import type { LaunchSpec } from "./launchMotion.ts";

export const LAUNCH_STARTER: LaunchSpec = ${JSON.stringify(launch, null, 2)};
`);
console.log(`wrote ${out} (v ${launch.v})`);
