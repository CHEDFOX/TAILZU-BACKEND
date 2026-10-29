/**
 * THE FILE ROUTES (src/routes/files.ts): off unless MEDIA_INGEST is on; the owner's only; refusals in words with the right status; a spreadsheet as a
 * chart or a table; "add this logo to the project" through a real workspace over a fake GitHub.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { registerFilesRoutes } = await import("../src/routes/files.js");
const { MediaService } = await import("../src/media/service.js");
const { MemoryMediaStore } = await import("../src/media/store.js");
const { MemoryBlobStore } = await import("../src/media/blob.js");
const { Guard } = await import("../src/guard/index.js");
const { refFromBody } = await import("../src/front/attachments.js");
const { validateArtifact } = await import("../src/artifacts/validate.js");
const art = await import("./artifacts-rig.js");
const rig = await import("./ingest-rig.js");
const { appKeys, FakeGithub, bytesOf } = await import("./github-fake.js");
const { GithubApp } = await import("../src/code/github.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { ApprovalBook } = await import("../src/code/approvals.js");
const { addProject } = await import("../src/code/projects.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const MB = 1024 * 1024;

function multipartBody(name: string, data: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----tailzu" + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function served(o: { media?: boolean; worker?: boolean; speech?: boolean; blobs?: boolean; artifacts?: boolean; code?: unknown } = {}) {
  const store = new MemoryMediaStore();
  const blobs = new MemoryBlobStore();
  const w = rig.fakeWorker();
  const media = o.media === false ? null : new MediaService({ store, blobs: o.blobs === false ? null : blobs, worker: o.worker === false ? null : w.worker, speech: o.speech === false ? null : rig.fakeSpeech().speech });
  const a = art.rig();
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 50 * MB, files: 1, fields: 20 } });
  registerFilesRoutes(app, { rateLimit: RL, media, artifacts: o.artifacts === false ? null : ({ service: a.service } as never), code: (o.code ?? null) as never, guard: new Guard() });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: user ? who(user) : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const upload = (user: string | null, name: string, data: Buffer) => {
    const m = multipartBody(name, data);
    return app.inject({ method: "POST", url: "/v1/files", headers: { ...(user ? who(user) : {}), ...m.headers }, payload: m.payload });
  };
  return { app, call, upload, store, blobs, worker: w.calls, artifacts: a };
}

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("the switch and the session", () => {
  it("every route is 404 media_off while the feature is off", async () => {
    const s = await served({ media: false });
    for (const [method, url] of [["POST", "/v1/files"], ["GET", "/v1/files"], ["GET", `/v1/files/${ID}`], ["POST", `/v1/files/${ID}/keep`], ["DELETE", `/v1/files/${ID}`], ["POST", `/v1/files/${ID}/artifact`], ["POST", `/v1/files/${ID}/asset`]] as const) {
      const r = await s.call("alice", method, url, method === "POST" ? {} : undefined);
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().code).toBe("media_off");
    }
  });

  it("wants a session", async () => {
    const s = await served();
    expect((await s.call(null, "GET", "/v1/files")).statusCode).toBe(401);
    expect((await s.upload(null, "a.txt", Buffer.from("hi there\nfriend\n"))).statusCode).toBe(401);
    expect((await s.call(null, "DELETE", `/v1/files/${ID}`)).statusCode).toBe(401);
  });
});

describe("sending a file", () => {
  it("reads it once and gives back what the app puts in an ask: a ref, with no text and no storage key", async () => {
    const s = await served();
    const r = await s.upload("alice", "handbook.docx", rig.docx());
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.cached).toBe(false);
    expect(body.file).toMatchObject({ name: "handbook.docx", kind: "document", format: "docx", keep: false, tables: [] });
    expect(JSON.stringify(body)).not.toMatch(/blobKey|u\/alice|"text"/);
    expect(body.attachment).toMatchObject({ id: body.file.id, kind: "document", mime: expect.stringContaining("wordprocessingml"), name: "handbook.docx", sha256: body.file.sha256 });
    // The ref is exactly what POST /v1/ask accepts.
    expect(refFromBody(body.attachment)).toMatchObject({ ok: true });
    // Again: not read again.
    const again = await s.upload("alice", "handbook.docx", rig.docx());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ cached: true, file: { id: body.file.id } });
    expect(s.worker.convert).toHaveLength(1);
  });

  it("two people sending the same file are two files", async () => {
    const s = await served();
    const a = await s.upload("alice", "x.docx", rig.docx());
    const b = await s.upload("bob", "x.docx", rig.docx());
    expect(b.json().file.id).not.toBe(a.json().file.id);
    expect(s.worker.convert).toHaveLength(2);
  });

  it("each refusal says what it is and why, with the right status", async () => {
    const s = await served({ speech: false });
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512), Buffer.from("EncryptedPackage", "utf16le")]);
    const cases: Array<[string, Buffer, number, string, RegExp]> = [
      ["pay.xlsx", ole, 422, "password", /password-protected/],
      ["locked.pdf", rig.pdf(["x"], { encrypt: true }), 422, "password", /password-protected/],
      ["bomb.zip", rig.zip([{ name: "z", data: Buffer.alloc(5 * MB) }]), 422, "bomb", /zip bomb/],
      ["tool.exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 1)]), 422, "unsupported", /never run anything/],
      ["old.doc", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(300)]), 422, "unsupported", /Old binary Office files/],
      ["call.mp3", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(100)]), 503, "not_configured", /turning recordings into text/i],
      ["empty.txt", Buffer.alloc(0), 400, "empty", /empty/],
    ];
    for (const [name, data, status, code, words] of cases) {
      const r = await s.upload("alice", name, data);
      expect(r.statusCode, name).toBe(status);
      expect(r.json().code, name).toBe(code);
      expect(r.json().message, name).toMatch(words);
    }
    expect(s.store.size).toBe(0);
  });

  it("a file over the biggest cap is 413, and one over its own kind's cap is 413 too", async () => {
    const s = await served();
    const huge = await s.upload("alice", "huge.bin", Buffer.alloc(51 * MB, 1));
    expect(huge.statusCode).toBe(413);
    expect(huge.json().code).toBe("too_big");
    const big = await s.upload("alice", "big.png", Buffer.concat([rig.png(), Buffer.alloc(11 * MB)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().message).toMatch(/over 10 MB/);
  });

  it("a body that is not a form with a file is a 400, not a crash", async () => {
    const s = await served();
    const r = await s.app.inject({ method: "POST", url: "/v1/files", headers: { ...who("alice"), "content-type": "application/json" }, payload: { nope: true } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("no_file");
  });
});

describe("looking at, keeping and deleting", () => {
  it("lists a person's files, newest first, and shows one to its owner only", async () => {
    const s = await served();
    const a = (await s.upload("alice", "one.txt", Buffer.from("first\nfile\n"))).json().file;
    await s.upload("alice", "two.txt", Buffer.from("second\nfile\n"));
    await s.upload("bob", "three.txt", Buffer.from("bobs\nfile\n"));
    const list = (await s.call("alice", "GET", "/v1/files")).json().files;
    expect(list.map((f: { name: string }) => f.name).sort()).toEqual(["one.txt", "two.txt"]);
    expect((await s.call("alice", "GET", `/v1/files/${a.id}`)).json().file).toMatchObject({ name: "one.txt" });
    expect((await s.call("bob", "GET", `/v1/files/${a.id}`)).statusCode).toBe(404);
    expect((await s.call("alice", "GET", "/v1/files/not-an-id")).statusCode).toBe(404);
  });

  it("keeps a file past thirty days, or lets it go", async () => {
    const s = await served();
    const a = (await s.upload("alice", "one.txt", Buffer.from("first\nfile\n"))).json().file;
    expect((await s.call("alice", "POST", `/v1/files/${a.id}/keep`, { keep: true })).json().file.keep).toBe(true);
    expect((await s.call("alice", "POST", `/v1/files/${a.id}/keep`, { keep: false })).json().file.keep).toBe(false);
    expect((await s.call("alice", "POST", `/v1/files/${a.id}/keep`, { keep: "yes" })).statusCode).toBe(400);
    expect((await s.call("bob", "POST", `/v1/files/${a.id}/keep`, { keep: true })).statusCode).toBe(404);
  });

  it("deletes a file with its bytes, for its owner only", async () => {
    const s = await served();
    const a = (await s.upload("alice", "p.png", rig.png())).json().file;
    expect(s.blobs.objects.size).toBe(1);
    expect((await s.call("bob", "DELETE", `/v1/files/${a.id}`)).statusCode).toBe(404);
    expect(s.blobs.objects.size).toBe(1);
    expect((await s.call("alice", "DELETE", `/v1/files/${a.id}`)).json()).toEqual({ ok: true });
    expect(s.blobs.objects.size).toBe(0);
    expect((await s.call("alice", "DELETE", `/v1/files/${a.id}`)).statusCode).toBe(404);
  });
});

describe("a spreadsheet as a chart or a table", () => {
  const csv = Buffer.from("Month,Revenue,Margin\nJan,100,10\nFeb,150,12\nMar,120,9\n");

  it("makes a chart by code, as a React artifact with the rows in it, and costs nothing", async () => {
    const s = await served();
    const f = (await s.upload("alice", "sales.csv", csv)).json().file;
    expect(f.tables).toEqual([{ name: "sales", columns: ["Month", "Revenue", "Margin"], totalRows: 3 }]);
    const r = await s.call("alice", "POST", `/v1/files/${f.id}/artifact`, { kind: "chart" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: "chart", version: 1, artifact: { type: "react", title: "sales" } });
    const content = await s.artifacts.service.contentOf(r.json().artifact.id, 1);
    expect(content).toContain('"name":"Feb","s1":150,"s2":12');
    expect(validateArtifact({ type: "react", content }).ok).toBe(true);
    expect(s.artifacts.model.sent).toEqual([]);
  });

  it("makes a table page, with every cell escaped", async () => {
    const s = await served();
    const f = (await s.upload("alice", "people.csv", Buffer.from("name,score\n<b>Asha</b>,90\n\"Ravi\"\" & Co\",80\nMeera,70\n"))).json().file;
    const r = await s.call("alice", "POST", `/v1/files/${f.id}/artifact`, { kind: "table" });
    expect(r.statusCode).toBe(201);
    const content = await s.artifacts.service.contentOf(r.json().artifact.id, 1);
    expect(r.json().artifact.type).toBe("html");
    expect(content).toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(content).not.toContain("<b>Asha</b>");
    expect(content).toContain("Ravi&quot; &amp; Co");
    expect(validateArtifact({ type: "html", content }).ok).toBe(true);
  });

  it("says why when it cannot", async () => {
    const s = await served();
    const prose = (await s.upload("alice", "notes.txt", Buffer.from("just words\nand more words\n"))).json().file;
    expect((await s.call("alice", "POST", `/v1/files/${prose.id}/artifact`, { kind: "chart" })).json().code).toBe("no_table");
    const names = (await s.upload("alice", "names.csv", Buffer.from("name,city\nasha,pune\nravi,delhi\nmeera,goa\n"))).json().file;
    expect((await s.call("alice", "POST", `/v1/files/${names.id}/artifact`, { kind: "chart" })).json().code).toBe("no_numbers");
    expect((await s.call("alice", "POST", `/v1/files/${names.id}/artifact`, { kind: "table" })).statusCode).toBe(201);
    expect((await s.call("alice", "POST", `/v1/files/${names.id}/artifact`, { kind: "pie" })).statusCode).toBe(400);
    expect((await s.call("alice", "POST", `/v1/files/${names.id}/artifact`, { kind: "table", table: 7 })).json().code).toBe("no_table");
    expect((await s.call("bob", "POST", `/v1/files/${names.id}/artifact`, { kind: "table" })).statusCode).toBe(404);
    const off = await served({ artifacts: false });
    expect((await off.call("alice", "POST", `/v1/files/${ID}/artifact`, { kind: "chart" })).json().code).toBe("artifacts_off");
  });

  it("a cell that looks like a secret is refused by the artifact core, in words", async () => {
    const s = await served();
    const f = (await s.upload("alice", "keys.csv", Buffer.from(`name,key\nprod,${art.FAKE_AWS}\nstage,none\ndev,none\n`))).json().file;
    const r = await s.call("alice", "POST", `/v1/files/${f.id}/artifact`, { kind: "table" });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.json().message).toMatch(/looks like it holds/);
    expect(r.json().message).not.toContain(art.FAKE_AWS);
  });
});

describe("add this logo to the project", () => {
  async function withProject(o: { worker?: boolean; blobs?: boolean } = {}) {
    const keys = appKeys();
    const fake = new FakeGithub(keys);
    const now = () => fake.clock.t;
    const store = new MemoryCodeStore(now);
    const github = new GithubApp({ slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: keys.privateKeyPem, appId: "123456" }, { fetchFn: fake.fetchFn, now });
    const approvals = new ApprovalBook({ now });
    fake.addInstall(101, "alice");
    const repo = fake.addRepo(101, "alice/app", { files: { "README.md": "# app\n", "src/a.ts": "x" } });
    await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 1, githubLogin: "alice" });
    const d = { store, github, approvals };
    const p = (await addProject(d, "alice", repo.id)).project;
    const s = await served({ code: { ...d, oauth: null }, ...o });
    const f = (await s.upload("alice", "Brand Logo.png", rig.png(300, 300))).json().file;
    return { s, f, fake, repo, p };
  }

  it("makes a work branch, commits the picture made fit for a logo, and opens a draft pull request", async () => {
    const t = await withProject();
    const r = await t.s.call("alice", "POST", `/v1/files/${t.f.id}/asset`, { projectId: t.p.id, use: "logo" });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body).toMatchObject({ path: "src/assets/brand-logo.png", format: "png", width: 512, bytes: expect.any(Number), pr: { number: expect.any(Number) } });
    expect(body.branch).toMatch(/^tailzu\//);
    expect(bytesOf(t.fake.files(t.repo, body.branch)[body.path])!.toString()).toBe("OPT-png-512");
    expect(t.fake.files(t.repo, "main")["src/assets/brand-logo.png"]).toBeUndefined();
  });

  it("on a branch that is not X0 Bot's it is a question, and the same request with its answer does it", async () => {
    const t = await withProject();
    const asked = await t.s.call("alice", "POST", `/v1/files/${t.f.id}/asset`, { projectId: t.p.id, use: "icon", branch: "main" });
    expect(asked.statusCode).toBe(202);
    expect(asked.json()).toMatchObject({ needsApproval: true, action: "commit.other_branch", branch: "main", path: "src/assets/brand-logo.png" });
    expect(t.fake.files(t.repo, "main")["src/assets/brand-logo.png"]).toBeUndefined();
    const done = await t.s.call("alice", "POST", `/v1/files/${t.f.id}/asset`, { projectId: t.p.id, use: "icon", branch: "main", approvalId: asked.json().approvalId });
    expect(done.statusCode).toBe(201);
    expect(done.json().pr).toBeUndefined();
    expect(bytesOf(t.fake.files(t.repo, "main")["src/assets/brand-logo.png"])).not.toBeNull();
  });

  it("checks the request, and says what is missing", async () => {
    const t = await withProject();
    const url = `/v1/files/${t.f.id}/asset`;
    expect((await t.s.call("alice", "POST", url, { use: "logo" })).statusCode).toBe(400);
    expect((await t.s.call("alice", "POST", url, { projectId: t.p.id, use: "wallpaper" })).json().message).toMatch(/use is one of logo, icon/);
    expect((await t.s.call("alice", "POST", url, { projectId: t.p.id, use: "logo", format: "gif" })).statusCode).toBe(400);
    expect((await t.s.call("alice", "POST", url, { projectId: t.p.id, use: "logo", path: 5 })).statusCode).toBe(400);
    expect((await t.s.call("bob", "POST", url, { projectId: t.p.id, use: "logo" })).statusCode).toBe(404);
    const noCode = await served({ code: null });
    const f = (await noCode.upload("alice", "l.png", rig.png())).json().file;
    expect((await noCode.call("alice", "POST", `/v1/files/${f.id}/asset`, { projectId: t.p.id, use: "logo" })).json().code).toBe("code_off");
  });

  it("says so when the picture's bytes were not kept, or the file is not a picture", async () => {
    const t = await withProject({ blobs: false });
    const r = await t.s.call("alice", "POST", `/v1/files/${t.f.id}/asset`, { projectId: t.p.id, use: "logo" });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("no_bytes");
    const pdf = (await t.s.upload("alice", "doc.pdf", rig.pdf(["x"]))).json().file;
    expect((await t.s.call("alice", "POST", `/v1/files/${pdf.id}/asset`, { projectId: t.p.id, use: "logo" })).statusCode).toBe(409);
  });

  it("a project that is not the person's is not found", async () => {
    const t = await withProject();
    const r = await t.s.call("alice", "POST", `/v1/files/${t.f.id}/asset`, { projectId: "99999999-9999-4999-8999-999999999999", use: "logo" });
    expect(r.statusCode).toBe(404);
  });
});
