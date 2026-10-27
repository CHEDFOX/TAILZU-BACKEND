/** The shared config, read on a Worker: from the Worker's env through process.env, without what only the VPS needs. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, resetConfigForTests } from "../../tulmi/src/config.js";
import { applyEnv, type Env } from "../src/env.js";
import { testEnv } from "./helpers.js";

const KEYS = ["OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GROQ_API_KEY", "RUNTIME", "CODE_GITHUB", "STT_PROVIDER", "WEB_BROWSER", "CODE_JOBS_MODE", "CLOUDFLARE_ACCOUNT_ID", "NODE_ENV"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } resetConfigForTests(); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } resetConfigForTests(); });

const worker = (more: Record<string, string> = {}): Env => ({ ...testEnv, OPENROUTER_API_KEY: "or-test", SUPABASE_URL: "https://x.supabase.test", SUPABASE_SERVICE_KEY: "service-test", CODE_GITHUB: "true", ...more } as Env);

describe("config on a Worker", () => {
  it("is parsed from the Worker's env through process.env", () => {
    applyEnv(worker({ WEB_BROWSER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acct" }));
    const cfg = getConfig();
    expect(cfg.RUNTIME).toBe("worker");
    expect(cfg.CODE_GITHUB).toBe(true);
    expect(cfg.WEB_BROWSER).toBe("cloudflare");
    expect(cfg.CLOUDFLARE_ACCOUNT_ID).toBe("acct");
    expect(cfg.supabaseEnabled).toBe(true);
  });

  it("does not ask a Worker for the speech provider's key (the VPS is asked)", () => {
    applyEnv(worker());
    expect(() => getConfig()).not.toThrow();
    resetConfigForTests();
    // The same settings on the VPS are refused: STT_PROVIDER defaults to groq, which needs its key.
    delete process.env.RUNTIME;
    for (const k of Object.keys(process.env)) if (k.startsWith("OPENROUTER") || k.startsWith("SUPABASE")) { /* keep */ }
    process.env.OPENROUTER_API_KEY = "or-test";
    process.env.SUPABASE_URL = "https://x.supabase.test";
    process.env.SUPABASE_SERVICE_KEY = "service-test";
    process.env.RUNTIME = "node";
    expect(() => getConfig()).toThrow(/GROQ_API_KEY/);
  });

  it("still needs what the jobs themselves need", () => {
    applyEnv({ ...testEnv } as Env);
    expect(() => getConfig()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("copies only text bindings, and does not touch what is already set to the same value", () => {
    applyEnv({ ...worker(), NOT_TEXT: 42, ALSO_NOT: { a: 1 } } as unknown as Env);
    expect(process.env.NOT_TEXT).toBeUndefined();
    expect(process.env.SUPABASE_URL).toBe("https://x.supabase.test");
    delete process.env.NOT_TEXT;
  });
});
