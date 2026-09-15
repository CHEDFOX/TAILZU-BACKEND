import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";

/**
 * getConfig() memoises its result in a module-level `cached` — we call
 * vi.resetModules() before each import so each test bootstraps against a
 * clean process.env.
 */
const ORIGINAL_ENV = { ...process.env };

async function loadFreshConfig() {
  vi.resetModules();
  const mod = await import("../src/config.js");
  return mod.getConfig;
}

function resetEnv() {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
}

describe("config guards", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  it("runs BOTH live engines by default, and streams the worldwide one", async () => {
    // The two mics take different roads and that is what the complaint was.
    // The in-app mic posts a clip to /v1/transcribe-clean, where
    // STT_PROVIDER=auto already races Sarvam against the generalist and keeps
    // the Indic reading. The keyboard mic streams, and streaming ran ONE
    // engine — so the same speaker got a worse transcript for reaching for the
    // keyboard instead of the app.
    //
    // The fix is dual, not a different primary. Sarvam covers 22 Indian
    // languages plus English and nothing else, so promoting it to primary
    // would fix Hindi by breaking French, Japanese and Arabic outright.
    // Deepgram streams the partials; Sarvam listens; the stop decides.
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    delete process.env.STT_LIVE_PROVIDER;
    delete process.env.STT_LIVE_DUAL;

    const getConfig = await loadFreshConfig();
    expect(getConfig().STT_LIVE_DUAL).toBe(true);
    expect(getConfig().STT_LIVE_PROVIDER).toBe("deepgram");
  });

  it("lets an India-first deployment stream Sarvam and halve the cost", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    process.env.STT_LIVE_PROVIDER = "sarvam";
    process.env.STT_LIVE_DUAL = "false";

    const getConfig = await loadFreshConfig();
    expect(getConfig().STT_LIVE_PROVIDER).toBe("sarvam");
    expect(getConfig().STT_LIVE_DUAL).toBe(false);
  });

  it("refuses to boot when DEV_SKIP_AUTH=true under NODE_ENV=production", async () => {
    // Baseline env: satisfy the required OPENROUTER_API_KEY + provider check.
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    process.env.NODE_ENV = "production";
    delete process.env.DEV_SKIP_AUTH_ALLOW_PROD;

    const getConfig = await loadFreshConfig();
    expect(() => getConfig()).toThrow(/DEV_SKIP_AUTH=true is not allowed/i);
  });

  it("allows the DEV_SKIP_AUTH override with the explicit escape hatch", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    process.env.NODE_ENV = "production";
    process.env.DEV_SKIP_AUTH_ALLOW_PROD = "true";

    const getConfig = await loadFreshConfig();
    expect(() => getConfig()).not.toThrow();
  });

  it("refuses when the selected STT provider has no key", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DEV_SKIP_AUTH = "true";
    delete process.env.NODE_ENV;

    const getConfig = await loadFreshConfig();
    expect(() => getConfig()).toThrow(/GROQ_API_KEY/);
  });
});
