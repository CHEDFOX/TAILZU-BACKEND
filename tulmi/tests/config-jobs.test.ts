/**
 * The settings for jobs on Cloudflare (src/config.ts): CODE_JOBS_MODE, CODE_JOBS_URL, CODE_JOBS_SECRET, RUNTIME, WEB_BROWSER=cloudflare,
 * and what a Worker (RUNTIME=worker) is no longer asked for. The default is today's behaviour.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function config(env: Record<string, string>) {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: "test", DEV_SKIP_AUTH: "true", OPENROUTER_API_KEY: "or", GROQ_API_KEY: "gq", ...env });
  vi.resetModules();
  const mod = await import("../src/config.js");
  return mod;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterAll(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("CODE_JOBS_MODE", () => {
  it("is local unless it says cloudflare, whatever else is set", async () => {
    for (const v of [undefined, "", "local", "LOCAL", "remote", "cloudflare-ish", "true", "1"]) {
      const { getConfig } = await config({ ...(v === undefined ? {} : { CODE_JOBS_MODE: v }), CODE_JOBS_URL: "https://jobs.example", CODE_JOBS_SECRET: "s".repeat(40) });
      expect(getConfig().CODE_JOBS_MODE, String(v)).toBe("local");
    }
  });

  it("is cloudflare when it says so, in any case, with spaces", async () => {
    for (const v of ["cloudflare", "Cloudflare", "  CLOUDFLARE "]) {
      expect((await config({ CODE_JOBS_MODE: v, CODE_JOBS_URL: "https://jobs.example", CODE_JOBS_SECRET: "s".repeat(40) })).getConfig().CODE_JOBS_MODE).toBe("cloudflare");
    }
  });

  it("carries the Worker's address and the secret, trimmed", async () => {
    const cfg = (await config({ CODE_JOBS_MODE: "cloudflare", CODE_JOBS_URL: "  https://jobs.example  ", CODE_JOBS_SECRET: "s".repeat(40) })).getConfig();
    expect(cfg.CODE_JOBS_URL).toBe("https://jobs.example");
    expect(cfg.CODE_JOBS_SECRET).toBe("s".repeat(40));
  });

  it("warns, once, and does not refuse to start, when cloudflare mode has nowhere to send jobs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getConfig } = await config({ CODE_JOBS_MODE: "cloudflare" });
    expect(() => getConfig()).not.toThrow();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("CODE_JOBS_MODE=cloudflare"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("CODE_JOBS_URL and CODE_JOBS_SECRET are not set");
  });

  it("warns about an address that is not https and a secret that is short, without printing either", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getConfig } = await config({ CODE_JOBS_MODE: "cloudflare", CODE_JOBS_URL: "http://jobs.example", CODE_JOBS_SECRET: "short" });
    getConfig();
    const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("CODE_JOBS_URL is not an https address");
    expect(text).toContain("CODE_JOBS_SECRET is under 32 characters");
    expect(text).not.toContain("http://jobs.example");
    expect(text).not.toContain("short\n");
  });

  it("says nothing in local mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (await config({})).getConfig();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("CODE_JOBS"))).toHaveLength(0);
  });
});

describe("RUNTIME", () => {
  it("is node unless it says worker", async () => {
    for (const v of [undefined, "", "node", "deno", "WORKERS"]) {
      expect((await config(v === undefined ? {} : { RUNTIME: v })).getConfig().RUNTIME, String(v)).toBe("node");
    }
    expect((await config({ RUNTIME: "worker" })).getConfig().RUNTIME).toBe("worker");
    expect((await config({ RUNTIME: " Worker " })).getConfig().RUNTIME).toBe("worker");
  });

  it("does not ask a Worker for the speech provider's key, and still asks the VPS", async () => {
    const worker = await config({ RUNTIME: "worker", GROQ_API_KEY: "" });
    delete process.env.GROQ_API_KEY;
    expect(() => worker.getConfig()).not.toThrow();
    const openai = await config({ RUNTIME: "worker", STT_PROVIDER: "openai" });
    delete process.env.OPENAI_API_KEY;
    expect(() => openai.getConfig()).not.toThrow();
    const vps = await config({});
    delete process.env.GROQ_API_KEY;
    expect(() => vps.getConfig()).toThrow(/GROQ_API_KEY/);
    const vps2 = await config({ STT_PROVIDER: "openai" });
    delete process.env.OPENAI_API_KEY;
    expect(() => vps2.getConfig()).toThrow(/OPENAI_API_KEY/);
  });

  it("still asks a Worker for what the jobs need: the model's key, and a way to sign in to Supabase", async () => {
    const noModel = await config({ RUNTIME: "worker" });
    delete process.env.OPENROUTER_API_KEY;
    expect(() => noModel.getConfig()).toThrow(/OPENROUTER_API_KEY/);
    const noAuth = await config({ RUNTIME: "worker", DEV_SKIP_AUTH: "false" });
    expect(() => noAuth.getConfig()).toThrow(/Supabase auth is not configured/);
  });

  it("isWorkerRuntime(): RUNTIME=worker, or a runtime that says it is Cloudflare's", async () => {
    const { isWorkerRuntime } = await config({});
    expect(isWorkerRuntime()).toBe(false);
    process.env.RUNTIME = "worker";
    expect(isWorkerRuntime()).toBe(true);
    delete process.env.RUNTIME;
    const nav = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
    expect(isWorkerRuntime()).toBe(true);
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    expect(isWorkerRuntime()).toBe(false);
  });

  it("loads no .env file on a Worker (and one is not read here under test either)", async () => {
    const { envFileToLoad } = await config({});
    expect(envFileToLoad({ underTest: true, backendEnv: true })).toBe("none");
  });
});

describe("WEB_BROWSER", () => {
  it("is off, local or cloudflare; anything else is off", async () => {
    for (const [v, want] of [["", "off"], ["local", "local"], ["LOCAL", "local"], ["cloudflare", "cloudflare"], [" Cloudflare ", "cloudflare"], ["chrome", "off"], ["true", "off"]] as const) {
      expect((await config({ WEB_BROWSER: v })).getConfig().WEB_BROWSER, v).toBe(want);
    }
    expect((await config({})).getConfig().WEB_BROWSER).toBe("off");
  });

  it("carries the Cloudflare account and token for the Browser Rendering API", async () => {
    const cfg = (await config({ WEB_BROWSER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: " acct ", CLOUDFLARE_API_TOKEN: " tok " })).getConfig();
    expect(cfg.CLOUDFLARE_ACCOUNT_ID).toBe("acct");
    expect(cfg.CLOUDFLARE_API_TOKEN).toBe("tok");
  });
});

describe("the settings are in the list the test setup clears", () => {
  it("includes every new name, so one machine's exports never reach a test", async () => {
    const { ENV_KEYS } = await config({});
    for (const k of ["CODE_JOBS_MODE", "CODE_JOBS_URL", "CODE_JOBS_SECRET", "RUNTIME", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) expect(ENV_KEYS).toContain(k);
  });
});
