import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

// vi.mock() is hoisted to the top of the file — bindings referenced from
// inside its factory must ALSO be hoisted, or they'll be TDZ'd at eval time.
// vi.hoisted() gives us safely-hoisted state to share with the factories.
const { assistMock, editMock, sttState } = vi.hoisted(() => ({
  assistMock: vi.fn(async (input: string, _opts?: unknown) => input),
  editMock: vi.fn(async (text: string, instruction: string, _opts?: unknown, _mode?: unknown) => `${instruction}::${text}`),
  sttState: {
    text: "hey um make it shorter",
    durationSeconds: 5,
  },
}));

vi.mock("../src/pipeline/cleanup.js", () => ({
  assist: assistMock,
  editSelection: editMock,
}));

vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({
    text: sttState.text,
    durationSeconds: sttState.durationSeconds,
  })),
  estimateDurationSeconds: () => 0,
}));

// eslint-disable-next-line import/first
import { runPipeline } from "../src/pipeline/index.js";

describe("runPipeline", () => {
  beforeEach(() => {
    assistMock.mockClear();
    editMock.mockClear();
    sttState.text ="hey um make it shorter";
    sttState.durationSeconds =5;
  });

  it("returns transcript + cleanedText + usage with audioSeconds > 0", async () => {
    sttState.text ="the meeting is tomorrow";
    const res = await runPipeline({
      audio: Buffer.from([0x00, 0x01, 0x02]),
      format: "wav",
    });
    expect(res.transcript).toBe("the meeting is tomorrow");
    expect(res.cleanedText).toBe("the meeting is tomorrow");
    expect(res.usage.audioSeconds).toBeGreaterThan(0);
    expect(res.usage.words).toBeGreaterThan(0);
    expect(typeof res.usage.model).toBe("string");
  });

  it("hands the whole message to assist (instruction NOT pre-stripped)", async () => {
    // The assistant separates message from instruction itself, so runPipeline
    // no longer strips a trailing command — it passes the full utterance and
    // keeps the raw transcript intact.
    sttState.text ="the meeting is tomorrow, make it shorter";
    const res = await runPipeline({
      audio: Buffer.from([0x00]),
      format: "wav",
    });
    expect(assistMock).toHaveBeenCalledTimes(1);
    const [passedInput] = assistMock.mock.calls[0]!;
    expect(passedInput).toBe("the meeting is tomorrow, make it shorter");
    // The raw transcript is preserved (not command-stripped).
    expect(res.transcript).toBe("the meeting is tomorrow, make it shorter");
  });

  it("rewrites a selection with what was said, instead of writing it", async () => {
    sttState.text ="make this bullet points";
    const res = await runPipeline({
      audio: Buffer.from([0x00]),
      format: "wav",
      selection: "we ship friday and tell the team",
      context: "Notes:",
    });
    expect(assistMock).not.toHaveBeenCalled();
    expect(editMock).toHaveBeenCalledTimes(1);
    const [text, instruction, , mode] = editMock.mock.calls[0]!;
    expect(text).toBe("we ship friday and tell the team");
    expect(instruction).toBe("make this bullet points");
    expect(mode).toEqual({ spoken: true });
    expect(res.cleanedText).toBe("make this bullet points::we ship friday and tell the team");
    expect(res.transcript).toBe("make this bullet points");
    expect(res.replacedSelection).toBe(true);
    expect(res.joinWithSpace).toBe(false);
  });

  it("does not touch a selection when nothing was said", async () => {
    sttState.text ="";
    const res = await runPipeline({ audio: Buffer.from([0x00]), format: "wav", selection: "keep me" });
    expect(editMock).not.toHaveBeenCalled();
    expect(res.noSpeech).toBe(true);
    expect(res.replacedSelection).toBeUndefined();
  });
});
