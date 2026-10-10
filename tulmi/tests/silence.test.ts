import { beforeEach, describe, expect, it, vi } from "vitest";

// getConfig() validates the environment on first read, and the pipeline reads
// it for the model name. Enough to satisfy the schema, nothing real.
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";
process.env.DEV_SKIP_AUTH = "true";

// Silence must never reach the writing model. The scrub in stt.ts already
// returns "" for a clip it decided was silence; the pipeline then handed that
// "" to a model that wrote something anyway, and the something arrived on the
// user's screen as a refinement of a sentence they never spoke.

const assist = vi.fn(async () => "SOMETHING THE MODEL INVENTED");
let sttText = "";

vi.mock("../src/pipeline/cleanup.js", () => ({
  assist: (...a: unknown[]) => assist(...(a as [])),
}));
vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: async () => ({
    text: sttText, durationSeconds: 1.2, script: "latin",
    detectedLanguage: "en", engine: "test", alternative: undefined,
  }),
}));

const input = { audio: Buffer.from(""), format: "wav", language: "en" } as never;

describe("silence never reaches the writing model", () => {
  beforeEach(() => { assist.mockClear(); });

  it("an empty transcript returns empty, without calling the model", async () => {
    sttText = "";
    const { runPipeline } = await import("../src/pipeline/index.js");
    const r = await runPipeline(input);
    expect(r.cleanedText).toBe("");
    expect(r.transcript).toBe("");
    expect(assist).not.toHaveBeenCalled();
  });

  it("silence costs no words", async () => {
    sttText = "   ";
    const { runPipeline } = await import("../src/pipeline/index.js");
    const r = await runPipeline(input);
    expect(r.usage.words).toBe(0);
    // The clip's length is still recorded — it happened, it just said nothing.
    expect(r.usage.audioSeconds).toBe(1.2);
  });

  it("real speech still goes through", async () => {
    sttText = "hello there";
    const { runPipeline } = await import("../src/pipeline/index.js");
    const r = await runPipeline(input);
    expect(assist).toHaveBeenCalledOnce();
    expect(r.cleanedText).toBe("SOMETHING THE MODEL INVENTED");
  });
});
