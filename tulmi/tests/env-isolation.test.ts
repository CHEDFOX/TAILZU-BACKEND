import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { envFileToLoad, getConfig } from "../src/config.js";

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

  it("leaves the stores on their in-memory fallback", () => {
    // The consequence, stated where it will be read. No test file sets a
    // service key, so nothing in the suite can reach a real database — and on
    // a machine whose .env has one, this is the line that says why.
    expect(getConfig().SUPABASE_SERVICE_KEY).toBeUndefined();
  });
});
