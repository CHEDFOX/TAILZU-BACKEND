/**
 * WHAT IS ATTACHED (src/front/attachments.ts): the kinds, the handlers by kind, the read that happens once, and only the part that matters.
 *
 *   - a request's attachments are checked (an id, a name, a size, a SHA-256, base64 of a sane size) and given a kind;
 *   - text and code are read directly, capped, and only the windows that share words with the question are sent on, the head first,
 *     with what was left out marked and line numbers on code;
 *   - an image is described by the vision tier once; the same picture again is not read again, by checksum, per person;
 *   - audio, video, PDFs and the rest are "coming soon", in three languages, and no model is asked;
 *   - a checksum that does not match the bytes, a file too big, binary pretending to be text, a file no longer held, are each said in words;
 *   - the media feature adds a kind by registering a handler.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const {
  AttachmentRegistry, AttachmentCache, kindOf, refFromBody, relevantPart, ATTACHMENTS_MAX, IMAGE_BYTES_MAX, TEXT_BYTES_MAX, RELEVANT_CHARS, sha256Of,
} = await import("../src/front/attachments.js");
const { comingSoon } = await import("../src/front/words.js");
const { model, noModel, fileInput, PNG, sha } = await import("./front-rig.js");

const read = (reg: InstanceType<typeof AttachmentRegistry>, inputs: ReturnType<typeof fileInput>[], o: { question?: string; lang?: "en" | "hinglish" | "hi"; call?: ReturnType<typeof model>["call"]; user?: string } = {}) =>
  reg.read(o.user ?? "alice", inputs, { question: o.question ?? "what is this?", lang: o.lang ?? "en", model: { userId: o.user ?? "alice", call: (o.call ?? noModel().call) as never }, budget: { maxPaise: 50 } });

describe("kinds", () => {
  it("come from what the client says it is and what it is called", () => {
    expect(kindOf("image/png", "a.png")).toBe("image");
    expect(kindOf("image/heic", "a.heic")).toBe("image");
    expect(kindOf("audio/mpeg", "a.mp3")).toBe("audio");
    expect(kindOf("video/mp4", "a.mp4")).toBe("video");
    expect(kindOf("application/pdf", "a.bin")).toBe("pdf");
    expect(kindOf("", "report.PDF")).toBe("pdf");
    expect(kindOf("text/plain", "main.ts")).toBe("code");
    expect(kindOf("application/octet-stream", "script.py")).toBe("code");
    expect(kindOf("application/json", "x")).toBe("code");
    expect(kindOf("text/markdown", "notes.md")).toBe("text");
    expect(kindOf("text/csv", "data.csv")).toBe("text");
    expect(kindOf("application/zip", "a.zip")).toBe("other");
  });
});

describe("an attachment in a request", () => {
  const good = { id: "f1", kind: "text", mime: "text/plain", bytes: 5, sha256: "A".repeat(64), name: "n.txt", data: Buffer.from("hello").toString("base64") };

  it("is read into a ref (the checksum in lower case) and its bytes", () => {
    const r = refFromBody(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.ref).toEqual({ id: "f1", kind: "text", mime: "text/plain", bytes: 5, sha256: "a".repeat(64), name: "n.txt" });
      expect(r.input.data!.toString()).toBe("hello");
    }
  });

  it("takes its kind from its name when the client does not say", () => {
    const r = refFromBody({ ...good, kind: undefined, name: "main.ts" });
    expect(r.ok && r.input.ref.kind).toBe("code");
  });

  it("is refused, with the reason, when it is not an attachment", () => {
    const why = (v: unknown) => { const r = refFromBody(v); return r.ok ? "ok" : r.why; };
    expect(why(null)).toMatch(/object/);
    expect(why({ ...good, id: "" })).toMatch(/id and a name/);
    expect(why({ ...good, name: "x".repeat(201) })).toMatch(/id and a name/);
    expect(why({ ...good, bytes: -1 })).toMatch(/bytes/);
    expect(why({ ...good, bytes: 51 * 1024 * 1024 })).toMatch(/bytes/);
    expect(why({ ...good, sha256: "nope" })).toMatch(/sha256/);
    expect(why({ ...good, data: 5 })).toMatch(/base64/);
    expect(why({ ...good, data: "@@@" })).toMatch(/base64/);
    expect(why({ ...good, data: "A".repeat(8 * 1024 * 1024 + 1) })).toMatch(/base64/);
    expect(why({ ...good, data: undefined })).toBe("ok");
  });
});

describe("the part that matters", () => {
  const lines = (n: number, hit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => hit[i] ?? `filler line number ${i} that says nothing at all`).join("\n");

  it("is the whole text when it fits, numbered for code", () => {
    expect(relevantPart("a\nb", "anything", 1000, false)).toBe("a\nb");
    expect(relevantPart("a\nb", "anything", 1000, true)).toBe("1: a\n2: b");
  });

  it("is the head, and the windows that share words with the question, in order, with what was left out marked", () => {
    const text = lines(300, { 100: "the refund window is thirty days", 250: "shipping takes five days to arrive" });
    const out = relevantPart(text, "how long is the refund window?", 1200, true);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out).toContain("1: filler line number 0");
    expect(out).toContain("101: the refund window is thirty days");
    expect(out).not.toContain("shipping takes five days");
    expect(out).toMatch(/\[… lines 9-98 left out …\]/);
    expect(out.indexOf("filler line number 0")).toBeLessThan(out.indexOf("refund window"));
    expect(out.trimEnd().endsWith("left out …]")).toBe(true);
  });

  it("is the start of the file when nothing in it matches", () => {
    const out = relevantPart(lines(400), "zebra quantum", 900, false);
    expect(out).toContain("filler line number 0");
    expect(out).toContain("[… the rest is left out]");
    expect(out.length).toBeLessThan(1000);
  });

  it("takes the windows with the most matching words first, and as many as fit", () => {
    const text = lines(300, { 40: "alpha", 41: "beta", 130: "alpha beta gamma", 200: "gamma" });
    const out = relevantPart(text, "alpha beta gamma", 1500, false);
    expect(out).toContain("alpha beta gamma");
  });

  it("cuts a very long line", () => {
    expect(relevantPart("x".repeat(1000), "q", 5000, false).length).toBe(300);
  });
});

describe("text and code", () => {
  it("are read directly, with no model, and cached by checksum for the person", async () => {
    const reg = new AttachmentRegistry();
    const m = noModel();
    const f = fileInput("main.ts", "export const a = 1;\nexport const b = 2;\n");
    const r = await read(reg, [f], { call: m.call });
    expect(r.files).toEqual([{ name: "main.ts", kind: "code", text: "1: export const a = 1;\n2: export const b = 2;\n3: " }]);
    expect(r.notes).toEqual([{ id: f.ref.id, name: "main.ts", kind: "code", status: "read" }]);
    expect(r.paise).toBe(0);
    expect(m.sent).toEqual([]);
    expect(reg.cache.size).toBe(1);
    // the follow-up sends the ref alone
    const again = await read(reg, [{ ref: f.ref }]);
    expect(again.notes[0]).toMatchObject({ status: "cached" });
    expect(again.files[0]!.text).toContain("export const b = 2;");
    // another person's follow-up cannot reach it
    const other = await read(reg, [{ ref: f.ref }], { user: "bob" });
    expect(other.notes[0]).toMatchObject({ status: "missing" });
    expect(other.files).toEqual([]);
  });

  it("strips a byte-order mark, and reads only the first 200,000 characters, saying so", async () => {
    const reg = new AttachmentRegistry();
    const bom = await read(reg, [fileInput("a.txt", `﻿hello`)]);
    expect(bom.files[0]!.text).toBe("hello");
    const big = await read(reg, [fileInput("big.txt", "word ".repeat(100_000))]);
    expect(big.notes[0]).toMatchObject({ status: "read", note: "only the first 200,000 characters were read" });
    expect(big.files[0]!.text.length).toBeLessThanOrEqual(RELEVANT_CHARS + 200);
  });

  it("sends only the relevant part of a big file to a model", async () => {
    const reg = new AttachmentRegistry();
    const body = Array.from({ length: 2000 }, (_, i) => (i === 1500 ? "the invoice total is 4,200 rupees" : `row ${i}: nothing of interest here`)).join("\n");
    const r = await read(reg, [fileInput("data.csv", body)], { question: "what is the invoice total?" });
    expect(r.files[0]!.text).toContain("the invoice total is 4,200 rupees");
    expect(r.files[0]!.text.length).toBeLessThan(RELEVANT_CHARS + 600);
  });

  it("is withheld whole when the secret scan flags it", async () => {
    const reg = new AttachmentRegistry();
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    const r = await read(reg, [fileInput("config.ts", `export const key = "${key}";\n`)]);
    expect(r.files[0]!.text).toBe("(withheld: it looked like it held a secret)");
  });

  it("says it cannot read binary dressed as text, a file too big, or one whose checksum is not its bytes", async () => {
    const reg = new AttachmentRegistry();
    const bin = await read(reg, [fileInput("fake.txt", Buffer.concat([Buffer.from("abc"), Buffer.alloc(10, 0), Buffer.from("def")]))]);
    expect(bin.notes[0]).toMatchObject({ status: "unreadable" });
    const huge = fileInput("huge.txt", Buffer.alloc(TEXT_BYTES_MAX + 1, 97));
    expect((await read(reg, [huge])).notes[0]).toMatchObject({ status: "too_big", note: expect.stringContaining("1 MB") });
    const lie = fileInput("lie.txt", "hello");
    lie.ref.sha256 = "0".repeat(64);
    expect((await read(reg, [lie])).notes[0]).toMatchObject({ status: "unreadable", note: expect.stringMatching(/checksum/) });
    expect(reg.cache.size).toBe(0);
  });

  it("reads four files of a message and says the rest were not read", async () => {
    const reg = new AttachmentRegistry();
    const inputs = Array.from({ length: ATTACHMENTS_MAX + 2 }, (_, i) => fileInput(`f${i}.txt`, `file number ${i}`));
    const r = await read(reg, inputs);
    expect(r.files).toHaveLength(ATTACHMENTS_MAX);
    expect(r.notes.slice(ATTACHMENTS_MAX).map((n) => n.status)).toEqual(["too_big", "too_big"]);
    expect(r.notes[ATTACHMENTS_MAX]!.note).toMatch(/first 4 files/);
  });
});

describe("an image", () => {
  it("is described by the vision tier, with the question, as the front_look role; once", async () => {
    const reg = new AttachmentRegistry();
    const m = model(() => "A receipt for 450 rupees from a bakery.");
    const f = fileInput("receipt.png", PNG);
    const r = await read(reg, [f], { question: "how much was it?", call: m.call });
    expect(r.files).toEqual([{ name: "receipt.png", kind: "image", text: "A receipt for 450 rupees from a bakery." }]);
    expect(r.notes[0]).toMatchObject({ status: "described" });
    expect(r.paise).toBe(4);
    const sent = m.sent[0]!;
    expect(sent).toMatchObject({ tier: "vision", purpose: "front.look", capPaise: 50 });
    expect(sent.user).toBe("Question: how much was it?[image]");
    // the same bytes again, as a new upload or as a ref: read once
    await read(reg, [f], { call: m.call });
    await read(reg, [{ ref: f.ref }], { call: m.call });
    expect(m.sent).toHaveLength(1);
  });

  it("is turned away when it is too big or not a kind the vision tier takes, and a model that is down is an error in words", async () => {
    const reg = new AttachmentRegistry();
    const big = fileInput("big.png", Buffer.concat([PNG, Buffer.alloc(IMAGE_BYTES_MAX, 1)]));
    expect((await read(reg, [big], { call: model(() => "x").call })).notes[0]).toMatchObject({ status: "too_big" });
    const heic = fileInput("a.heic", PNG, { mime: "image/heic", kind: "image" });
    expect((await read(reg, [heic], { call: model(() => "x").call })).notes[0]).toMatchObject({ status: "unreadable", note: expect.stringMatching(/PNG, JPEG, WebP and GIF/) });
    await expect(read(reg, [fileInput("ok.png", PNG)], { call: model(() => new Error("down")).call })).rejects.toMatchObject({ code: "model_down", status: 503 });
    expect(reg.cache.size).toBe(0);
  });

  it("is sent with the secret scan on the question, and the picture as a data URL", async () => {
    const reg = new AttachmentRegistry();
    const m = model(() => "ok");
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    await read(reg, [fileInput("a.png", PNG)], { question: `is ${key} in this?`, call: m.call });
    const content = (m.sent[0]!.messages.at(-1) as { content: Array<{ type: string; text?: string; image_url?: { url: string } }> }).content;
    expect(content[0]!.text).not.toContain(key);
    expect(content[1]!.image_url!.url.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
  });
});

describe("the kinds that are coming", () => {
  it("say so clearly, in three languages, and ask no model", async () => {
    const reg = new AttachmentRegistry();
    const m = noModel();
    const f = fileInput("talk.mp3", Buffer.from("ID3"), { mime: "audio/mpeg", kind: "audio" });
    expect((await read(reg, [f], { call: m.call })).notes[0]).toEqual({ id: f.ref.id, name: "talk.mp3", kind: "audio", status: "coming_soon", note: "Reading audio files is coming soon. For now I can read images and text or code files." });
    expect((await read(reg, [f], { lang: "hinglish" })).notes[0]!.note).toBe("Audio files padhna jaldi aa raha hai. Abhi main sirf images aur text ya code files padh sakta hoon.");
    expect((await read(reg, [f], { lang: "hi" })).notes[0]!.note).toMatch(/जल्द आ रहा है/);
    for (const [kind, word] of [["video", "videos"], ["pdf", "PDFs"], ["other", "this kind of file"]] as const) expect(comingSoon(kind, "en")).toContain(word);
    expect(comingSoon("image", "en")).toBe("");
    expect(m.sent).toEqual([]);
  });

  it("are a registration away: the media feature adds a handler for a kind and it is used", async () => {
    const reg = new AttachmentRegistry();
    expect(reg.handles("pdf")).toBe(false);
    reg.register({ kinds: ["pdf"], extract: async () => ({ text: "Page 1: hello", status: "read", paise: 2 }) });
    expect(reg.handles("pdf")).toBe(true);
    const r = await read(reg, [fileInput("a.pdf", Buffer.from("%PDF-1.4"))]);
    expect(r.files).toEqual([{ name: "a.pdf", kind: "pdf", text: "Page 1: hello" }]);
    expect(r.paise).toBe(2);
  });
});

describe("the cache", () => {
  it("is per person and per checksum, forgets after its time, and is bounded in files and in characters", () => {
    let t = 0;
    const c = new AttachmentCache(() => t, 1000, 3, 100);
    c.set("a", "s1", { text: "one", status: "read", kind: "text" });
    expect(c.get("a", "s1")?.text).toBe("one");
    expect(c.get("b", "s1")).toBeUndefined();
    t = 1001;
    expect(c.get("a", "s1")).toBeUndefined();
    t = 2000;
    for (const k of ["s1", "s2", "s3", "s4"]) c.set("a", k, { text: k, status: "read", kind: "text" });
    expect(c.size).toBe(3);
    expect(c.get("a", "s1")).toBeUndefined();
    c.set("a", "big", { text: "x".repeat(90), status: "read", kind: "text" });
    c.set("a", "big2", { text: "y".repeat(90), status: "read", kind: "text" });
    expect(c.get("a", "big")).toBeUndefined();
    expect(c.get("a", "big2")?.text.length).toBe(90);
    c.clear();
    expect(c.size).toBe(0);
  });

  it("keys on the bytes' own SHA-256", () => {
    expect(sha256Of(Buffer.from("hello"))).toBe(sha(Buffer.from("hello")));
    expect(sha256Of(Buffer.from("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
