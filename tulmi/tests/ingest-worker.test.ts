/**
 * THE PYTHON WORKER FROM THE VPS'S SIDE (src/media/worker.ts) AND DEEPGRAM (src/media/speech.ts), over fakes: no network, no real worker.
 *
 *   - every call is signed: timestamp, nonce, and an HMAC of the method, the path with its query, and the body. The signature below is the SAME one
 *     media-worker/tests/test_security.py checks, so the two sides cannot drift apart
 *   - a worker's refusal becomes a MediaError with the worker's own words, by code; a worker that is not there is "not answering"
 *   - answers are read defensively (tables, a picture with its size in headers, a video's frames and sound)
 *   - Deepgram: the same key, model and language rule as the dictation path; the transcript keeps its timestamps
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });
const { HttpWorker, workerFromConfig, workerSignature, signedLines } = await import("../src/media/worker.js");
const { DeepgramTranscriber, transcriberFromConfig } = await import("../src/media/speech.js");
const { resetConfigForTests } = await import("../src/config.js");

const SECRET = "test-secret-0123456789abcdef0123456789";

describe("signing", () => {
  it("is the signature the worker's own tests check (one known vector, on both sides)", () => {
    const body = Buffer.from("hello");
    const sig = workerSignature(SECRET, { timestamp: 1700000000, nonce: "00112233445566778899aabbccddeeff", method: "POST", pathWithQuery: "/v1/convert?format=docx", body });
    expect(sig).toBe("2a33a770351bfe2000365ad6e1b9bf4a56f4fc6c83a9765044275a57ed4b38bf");
  });

  it("covers the version, time, nonce, method, path with its query and the body's hash, in that order", () => {
    const lines = signedLines({ timestamp: 5, nonce: "ab", method: "post", pathWithQuery: "/v1/image?max=512", body: Buffer.from("x") }).split("\n");
    expect(lines).toEqual(["v1", "5", "ab", "POST", "/v1/image?max=512", createHash("sha256").update("x").digest("hex")]);
  });

  it("changes when any one of them changes", () => {
    const base = { timestamp: 1, nonce: "n", method: "POST", pathWithQuery: "/v1/pdf", body: Buffer.from("a") };
    const sig = workerSignature(SECRET, base);
    for (const change of [{ timestamp: 2 }, { nonce: "m" }, { method: "GET" }, { pathWithQuery: "/v1/video" }, { body: Buffer.from("b") }]) {
      expect(workerSignature(SECRET, { ...base, ...change })).not.toBe(sig);
    }
    expect(workerSignature("another-secret-0123456789abcdef012345", base)).not.toBe(sig);
  });
});

interface Sent { url: string; headers: Record<string, string>; body: Buffer }
function worker(reply: (path: string) => Response | Error, o: { now?: number } = {}) {
  const sent: Sent[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Uint8Array) });
    const r = reply(new URL(url).pathname);
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  let n = 0;
  const w = new HttpWorker({ baseUrl: "http://worker:8000/", secret: SECRET, fetchFn, now: () => o.now ?? 1_700_000_000_000, nonce: () => `${(n += 1).toString(16).padStart(32, "0")}` });
  return { w, sent };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

describe("a call", () => {
  it("carries the time, a fresh nonce each time, and a signature that checks out", async () => {
    const { w, sent } = worker(() => json({ markdown: "# Hi", pages: null, tables: [], notes: [] }));
    await w.convert(Buffer.from("file one"), "docx");
    await w.convert(Buffer.from("file two"), "docx");
    const [a, b] = sent;
    expect(a!.url).toBe("http://worker:8000/v1/convert?format=docx");
    expect(a!.headers["x-tailzu-timestamp"]).toBe("1700000000");
    expect(a!.headers["x-tailzu-nonce"]).toBe("00000000000000000000000000000001");
    expect(b!.headers["x-tailzu-nonce"]).toBe("00000000000000000000000000000002");
    const expect1 = createHmac("sha256", SECRET).update(["v1", "1700000000", a!.headers["x-tailzu-nonce"], "POST", "/v1/convert?format=docx", createHash("sha256").update("file one").digest("hex")].join("\n")).digest("hex");
    expect(a!.headers["x-tailzu-signature"]).toBe(expect1);
    expect(a!.body.toString()).toBe("file one");
    expect(JSON.stringify(a!.headers)).not.toContain(SECRET);
  });

  it("reads a conversion: Markdown, pages, and the sheets' rows as tables", async () => {
    const { w } = worker(() => json({
      markdown: "## Sales", pages: 3, notes: ["one"],
      tables: [{ name: "Sales", columns: ["Month", "Revenue"], rows: [["Jan", 100], ["Feb", "150"], ["Mar", null]], total_rows: 9 }, { nope: true }],
    }));
    const r = await w.convert(Buffer.from("x"), "xlsx");
    expect(r).toMatchObject({ markdown: "## Sales", pages: 3, notes: ["one"] });
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0]).toMatchObject({ name: "Sales", columns: ["Month", "Revenue"], totalRows: 9, numeric: [1] });
  });

  it("reads a picture: the bytes, and the size and format from the headers", async () => {
    const { w, sent } = worker(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "x-image-width": "512", "x-image-height": "256", "x-image-format": "webp" } }));
    const r = await w.image(Buffer.from("png"), { maxSide: 512, format: "webp", quality: 80 });
    expect(r).toMatchObject({ width: 512, height: 256, format: "webp", mime: "image/webp" });
    expect([...r.data]).toEqual([1, 2, 3]);
    expect(sent[0]!.url).toBe("http://worker:8000/v1/image?max=512&format=webp&quality=80");
  });

  it("does not take a format it does not know for a picture", async () => {
    const { w } = worker(() => new Response(new Uint8Array([1]), { status: 200, headers: { "x-image-format": "tiff" } }));
    await expect(w.image(Buffer.from("x"), { maxSide: 64, format: "auto" })).rejects.toThrow(/do not know/);
  });

  it("reads a video: frames (never more than 8) and the sound", async () => {
    const frames = Array.from({ length: 12 }, (_, i) => ({ t: i, jpeg: Buffer.from(`f${i}`).toString("base64") }));
    const { w } = worker(() => json({ duration: 61.5, width: 1920, height: 1080, frames, audio: { mime: "audio/mpeg", data: Buffer.from("snd").toString("base64") }, notes: [] }));
    const r = await w.video(Buffer.from("mp4"));
    expect(r.durationSeconds).toBe(61.5);
    expect(r.frames).toHaveLength(8);
    expect(r.frames[1]!.data.toString()).toBe("f1");
    expect(r.audio!.data.toString()).toBe("snd");
    const none = await worker(() => json({ duration: 1, frames: [], audio: null })).w.video(Buffer.from("x"));
    expect(none.audio).toBeNull();
  });

  it("reads a PDF's Markdown with its form-feed page breaks", async () => {
    const { w } = worker(() => json({ markdown: "one\fpage two", pages: 2, notes: [] }));
    const r = await w.pdf(Buffer.from("%PDF-"));
    expect(r.markdown.split("\f")).toEqual(["one", "page two"]);
    expect(r.pages).toBe(2);
  });
});

describe("when the worker says no", () => {
  const refusal = (code: string, status: number, message = "Written for a person.") => worker(() => json({ code, message }, status)).w;

  it("keeps the worker's own words and maps its code", async () => {
    const cases: Array<[string, string]> = [["password", "password"], ["bomb", "bomb"], ["corrupt", "corrupt"], ["too_big", "too_big"], ["unsupported", "unsupported"], ["too_long", "too_long"], ["timeout", "failed"], ["busy", "worker_down"]];
    for (const [workerCode, ours] of cases) {
      const err = await refusal(workerCode, 422, "That file is password-protected.").convert(Buffer.from("x"), "docx").catch((e: Error & { code: string }) => e);
      expect((err as { code: string }).code, workerCode).toBe(ours);
      expect((err as Error).message).toBe("That file is password-protected.");
    }
  });

  it("an unknown code, or a body that is not JSON, is a failure in plain words", async () => {
    const odd = await refusal("???", 500).convert(Buffer.from("x"), "docx").catch((e) => e);
    expect(odd.code).toBe("failed");
    const html = await worker(() => new Response("<html>502 Bad Gateway</html>", { status: 502 })).w.convert(Buffer.from("x"), "docx").catch((e) => e);
    expect(html.message).toBe("The file reader could not read that file.");
    expect(html.message).not.toMatch(/Bad Gateway/);
  });

  it("an unreachable worker is 'not answering', not a stack trace", async () => {
    const err = await worker(() => new Error("connect ECONNREFUSED 10.0.0.5:8000")).w.pdf(Buffer.from("x")).catch((e) => e);
    expect(err).toMatchObject({ code: "worker_down", status: 503 });
    expect(err.message).toBe("The file reader is not answering just now. Try again in a moment.");
  });

  it("a message is cut to a sensible length", async () => {
    const err = await refusal("corrupt", 422, "x".repeat(2000)).convert(Buffer.from("x"), "docx").catch((e) => e);
    expect(err.message.length).toBe(300);
  });
});

describe("from the environment", () => {
  it("is a worker only with both the address and the secret, and an http(s) address", () => {
    const set = (url?: string, secret?: string) => {
      delete process.env.MEDIA_WORKER_URL; delete process.env.MEDIA_WORKER_SECRET;
      if (url) process.env.MEDIA_WORKER_URL = url;
      if (secret) process.env.MEDIA_WORKER_SECRET = secret;
      resetConfigForTests();
    };
    set(); expect(workerFromConfig()).toBeNull();
    set("http://media-worker:8000"); expect(workerFromConfig()).toBeNull();
    set(undefined, SECRET); expect(workerFromConfig()).toBeNull();
    set("ftp://x", SECRET); expect(workerFromConfig()).toBeNull();
    set("http://media-worker:8000", SECRET); expect(workerFromConfig()).toBeInstanceOf(HttpWorker);
    set();
  });
});

describe("Deepgram", () => {
  const dgReply = (body: unknown, status = 200) => {
    const sent: Array<{ url: string; headers: Record<string, string>; bytes: number }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, bytes: (init.body as Uint8Array).length });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { sent, fetchFn };
  };
  const answer = {
    metadata: { duration: 125.4 },
    results: { channels: [{ detected_language: "hi", alternatives: [{ transcript: "plain", paragraphs: { paragraphs: [
      { start: 0, sentences: [{ text: "Namaste doston.", start: 0 }, { text: "Aaj ka agenda.", start: 2 }] },
      { start: 65.2, sentences: [{ text: "Refund tees din mein milega.", start: 65.2 }] },
    ] } }] }] },
  };

  it("sends the audio as it is with the key, the model, and language detection when no language is pinned", async () => {
    const d = dgReply(answer);
    const t = await new DeepgramTranscriber({ apiKey: "dg-key", model: "nova-2", language: "", fetchFn: d.fetchFn }).transcribe(Buffer.alloc(1000), "audio/mpeg");
    const url = new URL(d.sent[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe("nova-2");
    expect(url.searchParams.get("detect_language")).toBe("true");
    expect(url.searchParams.get("language")).toBeNull();
    expect(url.searchParams.get("paragraphs")).toBe("true");
    expect(d.sent[0]!.headers).toMatchObject({ Authorization: "Token dg-key", "Content-Type": "audio/mpeg" });
    expect(d.sent[0]!.bytes).toBe(1000);
    expect(t).toEqual({ text: "[0:00] Namaste doston. Aaj ka agenda.\n\n[1:05] Refund tees din mein milega.", seconds: 125.4, language: "hi" });
  });

  it("pins the language when one is configured", async () => {
    const d = dgReply(answer);
    await new DeepgramTranscriber({ apiKey: "k", model: "nova-2", language: "multi", fetchFn: d.fetchFn }).transcribe(Buffer.alloc(10), "audio/wav");
    const url = new URL(d.sent[0]!.url);
    expect(url.searchParams.get("language")).toBe("multi");
    expect(url.searchParams.get("detect_language")).toBeNull();
  });

  it("falls back to the plain transcript when there are no paragraphs", async () => {
    const d = dgReply({ metadata: {}, results: { channels: [{ alternatives: [{ transcript: "  just words  " }] }] } });
    expect((await new DeepgramTranscriber({ apiKey: "k", model: "", language: "", fetchFn: d.fetchFn }).transcribe(Buffer.alloc(1), "audio/mpeg")).text).toBe("just words");
  });

  it("explains a refusal without repeating the key or the provider's body", async () => {
    const t = new DeepgramTranscriber({ apiKey: "dg-key", model: "nova-2", language: "", fetchFn: dgReply({ err_msg: "bad key dg-key" }, 401).fetchFn });
    const err = await t.transcribe(Buffer.alloc(1), "audio/mpeg").catch((e) => e);
    expect(err.code).toBe("failed");
    expect(err.message).toBe("The speech service did not accept this server's key.");
    const e2 = await new DeepgramTranscriber({ apiKey: "k", model: "", language: "", fetchFn: dgReply({}, 500).fetchFn }).transcribe(Buffer.alloc(1), "audio/mpeg").catch((e) => e);
    expect(e2.message).toBe("The speech service could not read that recording.");
  });

  it("a speech service that cannot be reached is 'not answering'", async () => {
    const fetchFn = (async () => { throw new Error("getaddrinfo ENOTFOUND api.deepgram.com"); }) as unknown as typeof fetch;
    const err = await new DeepgramTranscriber({ apiKey: "k", model: "", language: "", fetchFn }).transcribe(Buffer.alloc(1), "audio/mpeg").catch((e) => e);
    expect(err).toMatchObject({ code: "failed", status: 503 });
    expect(err.message).not.toMatch(/ENOTFOUND/);
  });

  it("is configured from the dictation path's own settings, and absent without a key", () => {
    delete process.env.DEEPGRAM_API_KEY; resetConfigForTests();
    expect(transcriberFromConfig()).toBeNull();
    process.env.DEEPGRAM_API_KEY = "k"; resetConfigForTests();
    expect(transcriberFromConfig()).toBeInstanceOf(DeepgramTranscriber);
    delete process.env.DEEPGRAM_API_KEY; resetConfigForTests();
  });
});
