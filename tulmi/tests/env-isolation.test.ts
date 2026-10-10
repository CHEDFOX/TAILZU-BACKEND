import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { ENV_KEYS, envFileToLoad, getConfig } from "../src/config.js";
// eslint-disable-next-line import/first
import { clearAppEnv } from "./env-surface.js";

/**
 * WHAT THIS IS GUARDING.
 *
 * The suite ran green on every machine we had and red on the server, and the
 * difference was not the code — it was that the server keeps a .env beside the
 * source and we did not. Reading it turned 56 tests red. Two of those were
 * worth more than the red: the history and personality stores fall back to an
 * in-memory map when Supabase is off, and that map is what their tests are
 * written against, so a real service key in the environment pointed `npm test`
 * at the production database and it started writing rows. The foreign key
 * refused them, because the ids in the tests are not UUIDs. That is luck.
 *
 * The loader is a pure function so this can be checked without a test writing
 * a .env into the source tree — which, with files running in parallel, would
 * be read by whichever suite imported config while it existed.
 */
describe("a test run never reads the deployment's env", () => {
  it("skips the file under the runner, whatever is on disk", () => {
    // Both present, which is the server's shape, and still nothing is read.
    expect(envFileToLoad({ underTest: true, backendEnv: true, rootEnv: true })).toBe("none");
    expect(envFileToLoad({ underTest: true, backendEnv: true })).toBe("none");
    expect(envFileToLoad({ underTest: true, rootEnv: true })).toBe("none");
    expect(envFileToLoad({ underTest: true })).toBe("none");
  });

  it("still prefers tulmi/.env, then the repo root, when it is not a test", () => {
    // The half that has to keep working: this is how the server is configured.
    expect(envFileToLoad({ underTest: false, backendEnv: true, rootEnv: true })).toBe("backend");
    expect(envFileToLoad({ underTest: false, rootEnv: true })).toBe("root");
    expect(envFileToLoad({ underTest: false })).toBe("default");
  });

  it("is actually switched on in this process", () => {
    // The branch above is only reached because the runner sets this. If the
    // variable ever changes name, the two tests above keep passing while the
    // guard they describe does nothing at all.
    expect(process.env.VITEST).toBeTruthy();
  });

  it("clears what a shell exported, which no file guard can reach", () => {
    // The second half of the same lesson, and the one that survived the
    // first fix. ADMIN_SECRET was exported in the server's shell, so the test
    // for "no secret configured" ran on a machine where one was — 401, not
    // 503 — with dotenv never involved.
    const env: Record<string, string | undefined> = {
      ADMIN_SECRET: "exported-by-the-shell",
      SUPABASE_SERVICE_KEY: "the-one-that-bypasses-every-rls-rule",
      INTRO_PLAY_WHEN: "everyLaunch",
      NODE_ENV: "production",
      PATH: "/usr/bin",
    };
    const removed = clearAppEnv(env);

    expect(env.ADMIN_SECRET).toBeUndefined();
    expect(env.SUPABASE_SERVICE_KEY).toBeUndefined();
    expect(env.INTRO_PLAY_WHEN).toBeUndefined();
    expect(removed).toContain("ADMIN_SECRET");
    // NODE_ENV is pinned, not dropped — production made the DEV_SKIP_AUTH
    // guard throw ahead of the assertion the test was making.
    expect(env.NODE_ENV).toBe("test");
    // And it touches nothing that is not ours. Deleting PATH from a worker
    // would be a far more interesting bug than the one being fixed.
    expect(env.PATH).toBe("/usr/bin");
  });

  it("knows about the variables that actually caused failures", () => {
    // The list is the whole mechanism: a name missing from it is a variable
    // the suite still reads off the machine. These three each broke a test.
    expect(ENV_KEYS).toContain("ADMIN_SECRET");
    expect(ENV_KEYS).toContain("SUPABASE_SERVICE_KEY");
    expect(ENV_KEYS).toContain("INTRO_PLAY_WHEN");
    // NODE_ENV is in the list and is meant to be: an exported
    // NODE_ENV=production is a contaminant like any other. It is cleared with
    // the rest and pinned back afterwards, which the test above checks.
    expect(ENV_KEYS).toContain("NODE_ENV");
    // VITEST is not, and must not be — the loader's own guard reads it.
    expect(ENV_KEYS).not.toContain("VITEST");
  });

  it("leaves the stores on their in-memory fallback", () => {
    // The consequence, stated where it will be read. No test file sets a
    // service key, so nothing in the suite can reach a real database — and on
    // a machine whose .env has one, this is the line that says why.
    expect(getConfig().SUPABASE_SERVICE_KEY).toBeUndefined();
  });
});
