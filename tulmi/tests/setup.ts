import { beforeEach } from "vitest";
import { clearAppEnv } from "./env-surface.js";
import { resetBreakersForTests } from "../src/guard/breaker.js";
import { resetCoalescerForTests } from "../src/guard/coalesce.js";
import { resetGuardForTests } from "../src/guard/index.js";
// The VPS guard for outbound reads (web/safeFetch.ts): the server installs it by loading this file, and so does every test.
import "../src/connectors/egress.js";

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

// The suite tests the paid product: limits, paywall, plans. Tailzu ships with
// FREE_FOR_ALL on for now, and tests/free-for-all.test.ts turns it on to test
// that; every other file sees the limits it was written against.
process.env.FREE_FOR_ALL = "false";

// The project brain reads code with tree-sitter where it can (src/code/project/treesitter). The brain's older tests were written against the regex readers and
// build a brain in nearly every file, each paying to start the parser: they run on the regexes, which are also what ships as the fallback. The tests that
// are about the parser (tests/code-project-treesitter*.test.ts) turn it on for themselves.
process.env.CODE_TREE_SITTER = "false";

// The brain's circuit breakers (guard/breaker.ts) are the process's, and a test that fails a model on purpose many times would otherwise
// leave the next one with that model skipped. Every test starts with every breaker closed.
beforeEach(() => { resetBreakersForTests(); });

// The same for the rest of the guards (src/guard): a request that repeats an earlier test's within 30 seconds would be answered from its idempotency
// store, a read in flight would be shared, and a permit left out would be missed by the next. Every test starts with a fresh guard and no reads in flight.
beforeEach(() => { resetGuardForTests(); resetCoalescerForTests(); });
