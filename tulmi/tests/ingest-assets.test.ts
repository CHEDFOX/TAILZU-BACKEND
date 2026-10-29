/**
 * "ADD THIS LOGO TO THE PROJECT" (src/media/assets.ts), through the real workspace and the real policy over a fake GitHub.
 *
 *   - the picture is made fit for its use by the worker (resized to the use, webp or png as the project's own pictures are, metadata gone), then
 *     committed with workspace().commit as a blob: free on a branch Tailzu made, a question on any other, the policy's refusals unchanged
 *   - the size limit (1 MB) holds for a picture too: the worker is asked again at smaller sizes, and in the end it is refused in words
 *   - an SVG is text: checked for anything that would run or load, then committed as it is
 *   - where it goes and what it is called come from the project; a name that is taken gets -2
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { appKeys, FakeGithub, bytesOf } = await import("./github-fake.js");
const { GithubApp } = await import("../src/code/github.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { ApprovalBook } = await import("../src/code/approvals.js");
const { PolicyError, isNeedsApproval } = await import("../src/code/policy.js");
const { addProject, createWorkBranch, workspace } = await import("../src/code/projects.js");
const { insertAsset, habitsOf, unsafeSvg, ASSET_USES, isAssetUse } = await import("../src/media/assets.js");
const rig = await import("./ingest-rig.js");

type Fake = InstanceType<typeof FakeGithub>;
let KEYS: ReturnType<typeof appKeys>;
beforeAll(() => { KEYS = appKeys(); });
afterEach(() => { vi.restoreAllMocks(); });

const MB = 1024 * 1024;

function gh() {
  const fake: Fake = new FakeGithub(KEYS);
  const now = () => fake.clock.t;
  const store = new MemoryCodeStore(now);
  const github = new GithubApp({ slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem, appId: "123456" }, { fetchFn: fake.fetchFn, now });
  const approvals = new ApprovalBook({ now });
  return { fake, store, approvals, d: { store, github, approvals } };
}

async function project(files: Record<string, string> = { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" }) {
  const r = gh();
  r.fake.addInstall(101, "alice");
  const repo = r.fake.addRepo(101, "alice/app", { files });
  await r.store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 1, githubLogin: "alice" });
  const p = (await addProject(r.d, "alice", repo.id)).project;
  const { branch } = await createWorkBranch(r.d, "alice", p.id, "add a logo");
  return { ...r, repo, p, branch, ws: () => workspace(r.d, "alice", p.id, branch), onMain: () => workspace(r.d, "alice", p.id, "main") };
}

/** A worker that makes a picture of a size that depends on how much it is asked to shrink it, and writes down the sizes it was asked for. */
const sizing = (bytesAt: (maxSide: number) => number) => {
  const sides: number[] = [];
  const { worker } = rig.fakeWorker({
    async image(_data, o) {
      sides.push(o.maxSide);
      const fmt = o.format === "auto" ? "webp" : o.format;
      return { data: Buffer.alloc(bytesAt(o.maxSide), 7), mime: `image/${fmt}`, width: o.maxSide, height: o.maxSide, format: fmt };
    },
  });
  return { worker, sides };
};

describe("a logo on a branch X0 Bot made", () => {
  it("is made fit for a logo, named from its file, put where the project keeps its code's assets, and committed with nothing asked", async () => {
    const t = await project();
    const w = rig.fakeWorker();
    const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(800, 800), name: "Company Logo (final).png", use: "logo" });
    expect(out).toMatchObject({ ok: true, path: "src/assets/company-logo-final.png", format: "png", width: 512, height: 512 });
    expect(w.calls.image).toEqual([{ maxSide: 512, format: "png", quality: 82, bytes: expect.any(Number) }]);
    if (!out.ok) throw new Error();
    expect(out.commit).toMatchObject({ sha: t.fake.head(t.repo, t.branch) });
    // The blob in the repo is what the worker made, byte for byte.
    expect(bytesOf(t.fake.files(t.repo, t.branch)[out.path])!.toString()).toBe("OPT-png-512");
    expect(t.fake.count("POST", /\/git\/blobs$/)).toBe(1);
  });

  it("is sized for its use: a favicon is small, a hero is large, and a photo is webp", async () => {
    const t = await project();
    const w = rig.fakeWorker();
    for (const use of ["favicon", "hero", "photo"] as const) await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: `${use}.png`, use });
    expect(w.calls.image.map((c) => [c.maxSide, c.format])).toEqual([[128, "png"], [1920, "webp"], [1600, "webp"]]);
    expect(Object.keys(ASSET_USES)).toEqual(["logo", "icon", "favicon", "avatar", "thumbnail", "hero", "banner", "photo"]);
    expect(isAssetUse("hero")).toBe(true);
    expect(isAssetUse("wallpaper")).toBe(false);
  });

  it("follows the project's own pictures: webp where they are mostly webp, and the folder they are in", async () => {
    const t = await project({
      "README.md": "x", "src/a.ts": "x",
      "public/images/hero.webp": "x", "public/images/team.webp": "x", "public/images/about.webp": "x", "public/images/old.png": "x", "docs/shot.png": "x", "node_modules/pkg/i.png": "x",
    });
    const w = rig.fakeWorker();
    const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "logo.png", use: "logo" });
    expect(out).toMatchObject({ ok: true, path: "public/images/logo.webp", format: "webp" });
    if (out.ok) expect(out.notes.join(" ")).toMatch(/mostly webp, so I made it webp/);
    expect(w.calls.image[0]).toMatchObject({ format: "webp" });
    // The person saying png wins over the habit.
    const png = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "mark.png", use: "logo", format: "png" });
    expect(png).toMatchObject({ ok: true, path: "public/images/mark.png", format: "png" });
  });

  it("does not take a name that is already there, and puts it where it is told to", async () => {
    const t = await project({ "README.md": "x", "src/assets/logo.png": "old", "src/assets/logo-2.png": "older" });
    const w = rig.fakeWorker();
    const a = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "logo.png", use: "logo" });
    expect(a).toMatchObject({ ok: true, path: "src/assets/logo-3.png" });
    expect(bytesOf(t.fake.files(t.repo, t.branch)["src/assets/logo.png"])).toBeNull();
    expect(t.fake.files(t.repo, t.branch)["src/assets/logo.png"]).toBe("old");
    const b = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "x.png", use: "logo", path: "web/brand/mark.png" });
    expect(b).toMatchObject({ ok: true, path: "web/brand/mark.png" });
    const c = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "y.png", use: "icon", path: "web/icons/" });
    expect(c).toMatchObject({ ok: true, path: "web/icons/y.png" });
  });

  it("with no worker, the picture is added as it is with its metadata taken out, and the notes say it was not resized", async () => {
    const t = await project();
    const out = await insertAsset({ worker: null }, await t.ws(), { data: rig.jpeg({ orientation: 1 }), name: "farm.jpg", use: "photo" });
    expect(out).toMatchObject({ ok: true, path: "src/assets/farm.jpg", format: "jpeg" });
    if (!out.ok) throw new Error();
    expect(out.notes.join(" ")).toMatch(/not switched on here/);
    const stored = bytesOf(t.fake.files(t.repo, t.branch)[out.path])!;
    expect(stored.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(stored.includes(Buffer.from("Asha"))).toBe(false);
    expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("is a commit with a message that says what it is", async () => {
    const t = await project();
    const out = await insertAsset({ worker: rig.fakeWorker().worker }, await t.ws(), { data: rig.png(), name: "brand mark.png", use: "logo" });
    expect(out.ok).toBe(true);
    const custom = await insertAsset({ worker: rig.fakeWorker().worker }, await t.ws(), { data: rig.png(), name: "b.png", use: "logo", message: "Add the new brand mark" });
    expect(custom.ok).toBe(true);
    expect(t.fake.headCommit(t.repo, t.branch)?.message).toMatch(/^Add the new brand mark/);
  });
});

describe("the policy and the size limit apply", () => {
  it("on the default branch it is a question, and the same request with its answer commits the same bytes", async () => {
    const t = await project();
    const w = rig.fakeWorker();
    const first = await insertAsset({ worker: w.worker }, await t.onMain(), { data: rig.png(), name: "logo.png", use: "logo" });
    if (!first.ok) throw new Error();
    expect(isNeedsApproval(first.commit)).toBe(true);
    expect(first.commit).toMatchObject({ needsApproval: true, action: "commit.other_branch" });
    expect(t.fake.files(t.repo, "main")["src/assets/logo.png"]).toBeUndefined();
    const approvalId = (first.commit as { approvalId: string }).approvalId;
    const second = await insertAsset({ worker: w.worker }, await t.onMain(), { data: rig.png(), name: "logo.png", use: "logo", approvalId });
    expect(second).toMatchObject({ ok: true, commit: { sha: expect.any(String) } });
    expect(bytesOf(t.fake.files(t.repo, "main")["src/assets/logo.png"])!.toString()).toBe("OPT-png-512");
  });

  it("a yes to one picture is not a yes to another: the approval is bound to the exact bytes", async () => {
    const t = await project();
    const sizes = [100, 200];
    const w = rig.fakeWorker({ async image(_d, o) { const n = sizes.shift() ?? 300; return { data: Buffer.alloc(n, n), mime: "image/png", width: 1, height: 1, format: "png" as const }; } });
    const first = await insertAsset({ worker: w.worker }, await t.onMain(), { data: rig.png(), name: "logo.png", use: "logo" });
    if (!first.ok || !isNeedsApproval(first.commit)) throw new Error("expected a question");
    // The bytes differ (200 against 100), so the approval does not fit: it is refused, and nothing is written.
    await expect(insertAsset({ worker: w.worker }, await t.onMain(), { data: rig.png(), name: "logo.png", use: "logo", approvalId: first.commit.approvalId }))
      .rejects.toMatchObject({ code: "changed_since_approval" });
    expect(t.fake.files(t.repo, "main")["src/assets/logo.png"]).toBeUndefined();
  });

  it("a path that leaves the repo is refused by the policy, as for any file", async () => {
    const t = await project();
    const err = await insertAsset({ worker: rig.fakeWorker().worker }, await t.ws(), { data: rig.png(), name: "x.png", use: "logo", path: "../outside/x.png" }).catch((e) => e);
    expect(err).toMatchObject({ code: "bad_path" });
    expect(err.message).toMatch(/can't go up with \.\./);
    expect(Object.keys(t.fake.files(t.repo, t.branch)).filter((p) => p.includes("outside"))).toEqual([]);
  });

  it("a picture over 1 MB is made smaller again, and the first size that fits is the one committed", async () => {
    const t = await project();
    const w = sizing((side) => (side > 400 ? 2 * MB : 300_000));
    const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "big.png", use: "logo" });
    expect(out).toMatchObject({ ok: true, width: 384, bytes: 300_000 });
    expect(w.sides).toEqual([512, 384]);
  });

  it("is refused in words when even the smallest is over the limit", async () => {
    const t = await project();
    const w = sizing(() => 2 * MB);
    const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "big.png", use: "hero" });
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.why).toMatch(/over 1 MB.*more than a commit may carry/);
    expect(w.sides).toEqual([1920, 1440, 960, 672]);
    expect(Object.keys(t.fake.files(t.repo, t.branch)).filter((p) => p.includes("big"))).toEqual([]);
  });

  it("without a worker a picture over 1 MB cannot be made smaller, and says so", async () => {
    const t = await project();
    const out = await insertAsset({ worker: null }, await t.ws(), { data: rig.bigPng(1100 * 1024), name: "huge.png", use: "photo" });
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.why).toMatch(/over 1 MB.*shrinker is not switched on/);
  });

  it("the commit layer itself refuses a binary file over 1 MB, or one that is not base64", async () => {
    const t = await project();
    const ws = await t.ws();
    await expect(ws.commit([{ path: "a.png", content: Buffer.alloc(MB + 1).toString("base64"), encoding: "base64" }], "big")).rejects.toMatchObject({ code: "too_large" });
    await expect(ws.commit([{ path: "a.png", content: "not base64!!", encoding: "base64" }], "bad")).rejects.toMatchObject({ code: "bad_request" });
    await expect(ws.commit([{ path: "a.png", content: "", encoding: "base64" }], "empty")).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("what is not a picture, and SVG", () => {
  it("says so for a file that is not a picture, and for a use it does not know", async () => {
    const t = await project();
    const w = rig.fakeWorker();
    const pdf = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.pdf(["x"]), name: "doc.pdf", use: "logo" });
    expect(pdf).toMatchObject({ ok: false });
    if (!pdf.ok) expect(pdf.why).toMatch(/not a picture/);
    const bad = await insertAsset({ worker: w.worker }, await t.ws(), { data: rig.png(), name: "x.png", use: "wallpaper" as never });
    expect(bad).toMatchObject({ ok: false });
    const pw = await insertAsset({ worker: w.worker }, await t.ws(), { data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(300), Buffer.from("EncryptedPackage", "utf16le")]), name: "x.png", use: "logo" });
    if (!pw.ok) expect(pw.why).toMatch(/password-protected/);
    expect(w.calls.image).toEqual([]);
  });

  it("a clean SVG is committed as the text it is", async () => {
    const t = await project();
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/></svg>';
    const w = rig.fakeWorker();
    const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: Buffer.from(svg), name: "logo.svg", use: "logo" });
    expect(out).toMatchObject({ ok: true, path: "src/assets/logo.svg", format: "svg" });
    expect(t.fake.files(t.repo, t.branch)["src/assets/logo.svg"]).toBe(svg);
    expect(w.calls.image).toEqual([]);
  });

  it("an SVG with anything that would run or load is refused, with which", async () => {
    const t = await project();
    const w = rig.fakeWorker();
    const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    const bad: Array<[string, string]> = [
      [wrap("<script>alert(1)</script>"), "script"],
      [wrap('<rect onload="x()" />'), "event handler"],
      [wrap('<a href="javascript:alert(1)"><rect/></a>'), "javascript:"],
      [wrap('<image href="https://evil.example/x.png"/>'), "another address"],
      [wrap('<foreignObject><div>hi</div></foreignObject>'), "foreignObject"],
      [wrap('<rect style="fill:url(https://evil.example/f)"/>'), "another address"],
    ];
    for (const [svg, why] of bad) {
      const out = await insertAsset({ worker: w.worker }, await t.ws(), { data: Buffer.from(svg), name: "logo.svg", use: "logo" });
      expect(out, why).toMatchObject({ ok: false });
      if (!out.ok) expect(out.why).toContain(why);
    }
    expect(Object.keys(t.fake.files(t.repo, t.branch)).filter((p) => p.endsWith(".svg"))).toEqual([]);
    expect(unsafeSvg(wrap('<image href="data:image/png;base64,AAAA"/>'))).toBeNull();
    expect(unsafeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toMatch(/entities/);
  });
});

describe("what the project's pictures say", () => {
  it("reads the format and the folder from a file tree", () => {
    const blob = (path: string) => ({ path, type: "blob" });
    expect(habitsOf([blob("a/1.webp"), blob("a/2.webp"), blob("a/3.webp"), blob("b/1.png")])).toEqual({ format: "webp", dir: "a" });
    expect(habitsOf([blob("img/1.png"), blob("img/2.png"), blob("img/3.webp")])).toEqual({ format: "png", dir: "img" });
    expect(habitsOf([blob("a.png"), blob("b.webp")])).toEqual({ format: null, dir: null });
    expect(habitsOf([blob("node_modules/x/1.png"), blob("node_modules/x/2.png"), blob("dist/3.png")])).toEqual({ format: null, dir: null });
    expect(habitsOf([{ path: "assets", type: "tree" }])).toEqual({ format: null, dir: null });
  });
});
