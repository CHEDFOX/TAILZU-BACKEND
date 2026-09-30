import { clearAppEnv } from "./env-surface.js";

/**
 * THE SUITE STARTS FROM AN EMPTY ENVIRONMENT, ON EVERY MACHINE.
 *
 * Each test file declares the few variables it needs and assumes nothing else
 * is set. That assumption was never enforced, and it was wrong twice on the
 * server:
 *
 *   1. tulmi/.env sits beside the source there and config.ts loaded it, so the
 *      tests read the live deployment. 56 failed. The stores fall back to an
 *      in-memory map when Supabase is off — which is what their tests are
 *      written against — so a real service key pointed `npm test` at the
 *      production database and it began writing rows to it.
 *
 *   2. With the file skipped, ADMIN_SECRET still arrived: it was EXPORTED in
 *      the shell. The test that checks the "no secret configured" branch got a
 *      401 instead of a 503, because on that machine a secret really was
 *      configured. dotenv was never involved.
 *
 * The second is the one worth designing around. A test can be isolated from a
 * file; it cannot be isolated from the shell it was started in unless it
 * clears what it knows about. This runs before every test file and empties the
 * app's whole env surface — and because vitest runs it before the file's own
 * module scope, the assignments at the top of each test file still win.
 */
clearAppEnv(process.env);
