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

  it("streams live dictation through the engine built for the flagship language", async () => {
    // The two mics take different roads and that is what the complaint was.
    // The in-app mic posts a whole clip to /v1/transcribe-clean, where
    // STT_PROVIDER=auto races Sarvam against the generalist and keeps the Indic
    // reading. The keyboard mic streams, and streaming lands on
    // STT_LIVE_PROVIDER. While that defaulted to Deepgram, choosing the
    // keyboard instead of the app silently chose the weaker engine for Indian
    // and code-mixed speech — same speaker, same sentence, worse transcript.
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    delete process.env.STT_LIVE_PROVIDER;

    const getConfig = await loadFreshConfig();
    expect(getConfig().STT_LIVE_PROVIDER).toBe("sarvam");
  });

  it("still lets an operator pin live dictation back to Deepgram", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.STT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.DEV_SKIP_AUTH = "true";
    process.env.STT_LIVE_PROVIDER = "deepgram";

    const getConfig = await loadFreshConfig();
    expect(getConfig().STT_LIVE_PROVIDER).toBe("deepgram");
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
