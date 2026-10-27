/**
 * The three files a step on GitHub's free computers is made of (src/code/jobs
 * workflow.ts, runScript.ts) and the reading of the person's own workflows
 * (ciNoise.ts): the workflow as a golden file, step.json, and `.tailzu/run.mjs`
 * both piece by piece (its pure helpers, exported) and whole, run with node
 * against a temporary git repo and a local server standing in for GitHub's
 * identity-token endpoint and for Tailzu's result address. Nothing reaches the
 * network: the only server is on 127.0.0.1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { RUN_MJS } = await import("../src/code/jobs/runScript.js");
const { CACHE_PATHS, LOCKFILES, renderWorkflow, shadowFiles, stepJson, timeoutMinutes } = await import("../src/code/jobs/workflow.js");
const { CI_NOISE_MINUTES_EACH, CI_NOISE_MINUTES_MAX, ciNoiseOf, firesForRunnerPush, pushTrigger } = await import("../src/code/jobs/ciNoise.js");
const shadow = await import("../src/code/shadow.js");

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** A scratch directory that is removed after the test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tailzu-run-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ------------------------------------------------------------ the workflow

/** The workflow for a step that has 12 minutes, written out, as a golden file. */
const GOLDEN = `# Written by Tailzu for one step of a coding job. Do not edit: it is replaced for every step.
# It runs only for the throwaway tailzu-run/ branch it was written on, and the branch is deleted afterwards.
name: Tailzu run
on:
  push:
    branches: ['tailzu-run/**']
permissions:
  contents: read
  id-token: write
concurrency:
  group: tailzu-run-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/cache@v4
        with:
          path: |
            ~/.npm
            ~/.cache/pip
            ~/.cache/yarn
            ~/.local/share/pnpm
          key: tailzu-\${{ runner.os }}-\${{ hashFiles('**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/requirements*.txt', '**/poetry.lock', '**/Pipfile.lock') }}
          restore-keys: |
            tailzu-\${{ runner.os }}-
      - run: node .tailzu/run.mjs
`;

describe("the workflow", () => {
  it("is exactly this, from one function (a golden file)", () => {
    expect(renderWorkflow(12)).toBe(GOLDEN);
  });

  it("runs on pushes to tailzu-run/** only, reads the contents, may ask GitHub for an identity and nothing else, and pins the actions by major version", () => {
    const y = renderWorkflow(5);
    expect(y).toMatch(/on:\n {2}push:\n {4}branches: \['tailzu-run\/\*\*'\]\n/);
    expect(y).toMatch(/permissions:\n {2}contents: read\n {2}id-token: write\n(?!\s+\w)/);
    expect(y).toContain("group: tailzu-run-${{ github.ref }}");
    expect(y).toContain("cancel-in-progress: true");
    expect(y).toContain("runs-on: ubuntu-latest");
    expect([...y.matchAll(/uses: (\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4", "actions/cache@v4"]);
    expect(y).toContain("fetch-depth: 0");
    for (const p of CACHE_PATHS) expect(y).toContain(`            ${p}\n`);
    for (const f of LOCKFILES) expect(y).toContain(`'${f}'`);
    expect(y.trimEnd().split("\n").at(-1)).toBe("      - run: node .tailzu/run.mjs");
    // The token is not kept in git's config on the runner.
    expect(y).toContain("persist-credentials: false");
  });

  it("takes its timeout from the step: the minutes rounded up, and one more to collect and report", () => {
    expect(timeoutMinutes(600)).toBe(11);
    expect(timeoutMinutes(601)).toBe(12);
    expect(timeoutMinutes(60)).toBe(2);
    expect(timeoutMinutes(1)).toBe(2);
    expect(timeoutMinutes(3600)).toBe(61);
    expect(renderWorkflow(timeoutMinutes(300))).toContain("timeout-minutes: 6\n");
    expect(renderWorkflow(0)).toContain("timeout-minutes: 1\n");
  });

  it("is valid enough to be read back by the reader of a person's own workflows: it is a push to tailzu-run/ only, and that is not noise", () => {
    expect(firesForRunnerPush(pushTrigger(renderWorkflow(5)))).toBe(true); // it fires for a runner push, as it must
    expect(pushTrigger(renderWorkflow(5))).toEqual({ branches: ["tailzu-run/**"] });
  });
});

describe("step.json and the three files", () => {
  const spec = {
    jobId: "3f9a1c2b-0000-4000-8000-000000000000", stepIdx: 2, epoch: 3, commands: ["npm ci", "npm test"], timeoutSec: 300,
    baseSha: "a".repeat(40), resultUrl: "https://api.tailzu.space/v1/code/runner/gh-result", audience: "tailzu",
  };

  it("step.json holds exactly what the script needs and nothing secret", () => {
    const text = stepJson(spec);
    expect(JSON.parse(text)).toEqual(spec);
    expect(Object.keys(JSON.parse(text))).toEqual(["jobId", "stepIdx", "epoch", "commands", "timeoutSec", "baseSha", "resultUrl", "audience"]);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("step.json carries the agent's staged edits (overlay) and discard only when there are some, after the rest", () => {
    const overlay = [{ path: "src/a.ts", content: "export const a = 2;\n" }, { path: "old.ts", content: null }];
    const withBoth = JSON.parse(stepJson({ ...spec, overlay, discard: true }));
    expect(Object.keys(withBoth)).toEqual([...Object.keys(spec), "overlay", "discard"]);
    expect(withBoth.overlay).toEqual(overlay);
    expect(withBoth.discard).toBe(true);
    expect(stepJson({ ...spec, overlay: [], discard: false })).toBe(stepJson(spec));
  });

  it("a shadow commit is exactly the workflow, step.json and run.mjs, in that order, and nothing else", () => {
    const files = shadowFiles(spec);
    expect(files.map((f) => f.path)).toEqual([...shadow.SHADOW_FILES]);
    expect(files.map((f) => f.path)).toEqual([".github/workflows/tailzu-run.yml", ".tailzu/step.json", ".tailzu/run.mjs"]);
    expect(files[0]!.content).toBe(renderWorkflow(6));
    expect(files[1]!.content).toBe(stepJson(spec));
    expect(files[2]!.content).toBe(RUN_MJS);
    expect(shadow.isExactShadowSet(files.map((f) => f.path))).toBe(true);
  });

  it("names a branch for the job, step and epoch, and reads the holder it writes", () => {
    const b = shadow.shadowBranchName("3f9a1c2b-0000-4000-8000-000000000000", 2, 3);
    expect(b).toBe("tailzu-run/3f9a1c2b-2-3");
    const sha = "b".repeat(40);
    expect(shadow.parseHolder(shadow.holderOf(b, sha))).toEqual({ branch: b, sha });
    expect(shadow.parseHolder("laptop-0001")).toBeNull();
    expect(shadow.parseHolder(null)).toBeNull();
    expect(shadow.parseHolder(`tailzu-run/xyz-1-1@${sha}`)).toBeNull();
    expect(shadow.isShadowBranch("tailzu-run/abc")).toBe(true);
    expect(shadow.isShadowBranch("Tailzu-Run/abc")).toBe(true);
    expect(shadow.isShadowBranch("tailzu/abc")).toBe(false);
    for (const p of [".tailzu/step.json", ".tailzu/anything/else", ".TAILZU/x", ".tailzu", ".github/workflows/tailzu-run.yml", ".GitHub/Workflows/Tailzu-Run.yml"]) {
      expect(shadow.isReservedPath(p), p).toBe(true);
    }
    for (const p of ["src/.tailzu", ".tailzuf/x", ".github/workflows/ci.yml", "tailzu-run.yml", "README.md"]) expect(shadow.isReservedPath(p), p).toBe(false);
    expect(shadow.isExactShadowSet([".tailzu/step.json"])).toBe(false);
    expect(shadow.isExactShadowSet([...shadow.SHADOW_FILES, "x"])).toBe(false);
    expect(shadow.isExactShadowSet([...shadow.SHADOW_FILES].reverse())).toBe(true);
    expect(shadow.isExactShadowSet([".tailzu/step.json", ".tailzu/step.json", ".tailzu/run.mjs"])).toBe(false);
  });
});

// ------------------------------------------------------------ run.mjs, in pieces

/** The script written to a file and imported, so its exported helpers can be called (it is plain JavaScript, so they are untyped here). */
async function loadScript(): Promise<any> {
  const dir = scratch();
  const file = join(dir, "run.mjs");
  writeFileSync(file, RUN_MJS);
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}

describe("run.mjs: what it prints and keeps", () => {
  it("is dependency-free Node: only node: modules are imported, and it holds no template literal", () => {
    const imports = [...RUN_MJS.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((i) => i!.startsWith("node:"))).toBe(true);
    expect(RUN_MJS).not.toContain("`");
    expect(RUN_MJS).not.toContain("${");
  });

  it("keeps at most 8 KB of the end of the output, whole characters", async () => {
    const m = await loadScript();
    expect(m.TAIL_BYTES).toBe(8192);
    expect(m.tailOf("short")).toBe("short");
    const long = `${"x".repeat(20_000)}THE END`;
    const tail = m.tailOf(long);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(8192);
    expect(tail.endsWith("THE END")).toBe(true);
    // A cut that would land inside a character moves forward to the next whole one.
    const emoji = m.tailOf("é".repeat(5000), 7);
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(7);
    expect(emoji).toMatch(/^é+$/);
    expect(m.tailOf("🙂".repeat(10), 10)).toBe("🙂🙂");
    expect(m.tailOf("abc", 0)).toBe("");
  });

  it("replaces obvious secrets with [redacted]: tokens, keys, headers, JWTs, passwords and the runner's own values", async () => {
    const m = await loadScript();
    const ghp = `ghp_${"A1b2C3d4E5".repeat(4)}`;
    const aws = `AKIA${"ABCDEFGH12345678"}`;
    // Built at runtime so the fixture itself never looks like a token to a secret scanner.
    const slack = ["xo", "xb-123456789012-abcdefghijklmn"].join("");
    const jwt = `eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4eXoiLCJhdWQiOiJ0YWlsenUifQ.c2lnbmF0dXJlLXZhbHVl`;
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123456789\n-----END RSA PRIVATE KEY-----";
    const out = m.redact([
      `token ${ghp}`, `key ${aws}`, `jwt ${jwt}`, pem, "curl -H 'Authorization: Bearer abc123def456ghi789'", "API_KEY=Zk3QpW9xLm2VbN7tRy5HcD8sFgJ4aE1u",
      "password: hunter2hunter2", `SLACK=${slack}`, "from the env: sup3rs3cr3tvalue-in-the-runner", "all fine here",
    ].join("\n"), ["sup3rs3cr3tvalue-in-the-runner"]);
    for (const secret of [ghp, aws, jwt, "MIIEowIBAAKCAQEA0123456789", "abc123def456ghi789", "Zk3QpW9xLm2VbN7tRy5HcD8sFgJ4aE1u", "hunter2hunter2", slack.slice(0, 17), "sup3rs3cr3tvalue"]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).toContain("[redacted]");
    expect(out).toContain("all fine here");
    expect(out).toContain("Authorization: Bearer [redacted]");
    // Ordinary words around the word "token" are left alone.
    expect(m.redact("the token was refreshed, tokens: none, secret santa")).toBe("the token was refreshed, tokens: none, secret santa");
  });

  it("finds the runner's own secret values by name, and keeps ones too short to be a secret out of it", async () => {
    const m = await loadScript();
    expect(m.secretValues({ ACTIONS_RUNTIME_TOKEN: "runtime-token-1234", GITHUB_TOKEN: "ghs_abcdefgh1234", PATH: "/usr/bin", MY_PASSWORD: "x", HOME: "/home/runner" }).sort())
      .toEqual(["ghs_abcdefgh1234", "runtime-token-1234"]);
  });

  it("takes the way to ask GitHub for an identity out of what the commands can see", async () => {
    const m = await loadScript();
    const env = m.commandEnv({ PATH: "/bin", ACTIONS_ID_TOKEN_REQUEST_URL: "u", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t", ACTIONS_RUNTIME_TOKEN: "r", CI: "true" });
    expect(env).toEqual({ PATH: "/bin", CI: "true" });
  });
});

describe("run.mjs: the overlay", () => {
  it("allows a path inside the checkout, and not .git, Tailzu's own files, a workflow, an absolute or a parent path", async () => {
    const m = await loadScript();
    for (const p of ["src/a.ts", "a.txt", "deep/er/path/file.md", ".env.example", ".github/CODEOWNERS"]) expect(m.overlayPathOk(p), p).toBe(true);
    for (const p of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "./a", ".git/config", "src/.git/hooks/x", ".tailzu/run.mjs", ".TAILZU/step.json", ".github/workflows/ci.yml", ".github/workflows/tailzu-run.yml", "a\\b", 5, null]) {
      expect(m.overlayPathOk(p), String(p)).toBe(false);
    }
    expect(m.overlayPathOk("x".repeat(501))).toBe(false);
  });

  it("writes text over the checkout, removes a file whose content is null (one that is not there is no error), makes folders, and names what it would not do", async () => {
    const m = await loadScript();
    const dir = scratch();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "old\n");
    writeFileSync(join(dir, "gone.ts"), "x\n");
    const out = m.applyOverlay([
      { path: "src/a.ts", content: "new\n" }, { path: "new/dir/b.ts", content: "b\n" }, { path: "gone.ts", content: null }, { path: "never-there.ts", content: null },
      { path: ".git/config", content: "evil" }, { path: "../escape.txt", content: "evil" }, { path: ".github/workflows/ci.yml", content: "evil" }, { path: "bad.ts", content: 5 },
    ], dir);
    expect(out).toEqual({ written: 2, removed: 2, skipped: [".git/config", "../escape.txt", ".github/workflows/ci.yml", "bad.ts"] });
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("new\n");
    expect(readFileSync(join(dir, "new/dir/b.ts"), "utf8")).toBe("b\n");
    expect(existsSync(join(dir, "gone.ts"))).toBe(false);
    expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
    expect(m.applyOverlay("not a list", dir)).toEqual({ written: 0, removed: 0, skipped: [] });
  });

  it("will not write through a symlink out of the checkout, or onto a symlink", async () => {
    const m = await loadScript();
    const dir = scratch();
    const outside = scratch();
    symlinkSync(outside, join(dir, "link"));
    writeFileSync(join(outside, "target.txt"), "keep\n");
    symlinkSync(join(outside, "target.txt"), join(dir, "file-link.txt"));
    const out = m.applyOverlay([{ path: "link/x.txt", content: "evil" }, { path: "link/target.txt", content: null }, { path: "file-link.txt", content: "mine\n" }], dir);
    expect(out.skipped).toEqual(["link/x.txt", "link/target.txt"]);
    expect(existsSync(join(outside, "x.txt"))).toBe(false);
    expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("keep\n");
    // The link itself is replaced by a file of ours, not written through.
    expect(readFileSync(join(dir, "file-link.txt"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("keep\n");
  });
});

describe("run.mjs: what changed", () => {
  const read = (files: Record<string, { size?: number; bytes?: Buffer; symlink?: boolean; notFile?: boolean } | null>) => (p: string) => files[p] ?? null;
  const text = (s: string) => ({ size: Buffer.byteLength(s), bytes: Buffer.from(s) });

  it("reads git diff --name-status -z", async () => {
    const m = await loadScript();
    expect(m.parseNameStatus("A\0new.txt\0M\0src/a.ts\0D\0old.md\0")).toEqual([
      { status: "A", path: "new.txt" }, { status: "M", path: "src/a.ts" }, { status: "D", path: "old.md" },
    ]);
    expect(m.parseNameStatus("")).toEqual([]);
    expect(m.parseNameStatus("M\0with space.txt\0A\0ünï.txt\0")).toEqual([{ status: "M", path: "with space.txt" }, { status: "A", path: "ünï.txt" }]);
  });

  it("sends added and modified files with their text, and deletions as null", async () => {
    const m = await loadScript();
    const { changes, skipped } = m.collectChanges(
      [{ status: "A", path: "dist/out.txt" }, { status: "M", path: "src/a.ts" }, { status: "D", path: "README.md" }],
      read({ "dist/out.txt": text("built\n"), "src/a.ts": text("export const a = 2;\n") }),
    );
    expect(changes).toEqual([
      { path: "dist/out.txt", content: "built\n" }, { path: "src/a.ts", content: "export const a = 2;\n" }, { path: "README.md", content: null },
    ]);
    expect(skipped).toEqual([]);
  });

  it("never sends .tailzu/ or the workflow file, and says nothing about them", async () => {
    const m = await loadScript();
    const entries = [
      { status: "A", path: ".tailzu/step.json" }, { status: "A", path: ".tailzu/run.mjs" }, { status: "M", path: ".tailzu/anything" },
      { status: "A", path: ".github/workflows/tailzu-run.yml" }, { status: "D", path: ".GitHub/Workflows/Tailzu-Run.yml" },
      { status: "A", path: ".github/workflows/ci.yml" },
    ];
    const { changes, skipped } = m.collectChanges(entries, read({ ".github/workflows/ci.yml": text("name: ci\n") }));
    expect(changes).toEqual([{ path: ".github/workflows/ci.yml", content: "name: ci\n" }]);
    expect(skipped).toEqual([]);
    expect(m.isTailzuPath(".tailzu")).toBe(true);
    expect(m.isTailzuPath("src/.tailzu/x")).toBe(false);
  });

  it("skips a file over 1 MB, a binary file, a file that is not text, a symlink, a folder, and a path the server would refuse; and says so", async () => {
    const m = await loadScript();
    const big = "x".repeat(1024 * 1024 + 1);
    const { changes, skipped } = m.collectChanges(
      [
        { status: "A", path: "big.txt" }, { status: "A", path: "bin.dat" }, { status: "A", path: "latin1.txt" }, { status: "A", path: "link" },
        { status: "A", path: "dir" }, { status: "A", path: "a\\b.txt" }, { status: "A", path: "x".repeat(501) }, { status: "T", path: "typechange" },
        { status: "A", path: "ok.txt" }, { status: "M", path: "vanished.txt" },
      ],
      read({
        "big.txt": { size: big.length }, "bin.dat": { size: 3, bytes: Buffer.from([1, 0, 2]) }, "latin1.txt": { size: 2, bytes: Buffer.from([0xe9, 0xff]) },
        link: { symlink: true }, dir: { notFile: true }, "ok.txt": text("fine"),
      }),
    );
    expect(changes).toEqual([{ path: "ok.txt", content: "fine" }]);
    expect(skipped.map((s) => [s.path.slice(0, 12), s.why])).toEqual([
      ["big.txt", "over 1 MB"], ["bin.dat", "not text"], ["latin1.txt", "not text"], ["link", "not a plain file"], ["dir", "not a plain file"],
      ["a\\b.txt", "odd path"], ["xxxxxxxxxxxx", "odd path"], ["typechange", "not a plain file change"], ["vanished.txt", "gone before it was read"],
    ]);
  });

  it("caps the total at 3 MB (measured as the JSON that carries it) and the files at 200, and names what was left out", async () => {
    const m = await loadScript();
    expect([m.TOTAL_MAX_BYTES, m.FILE_MAX_BYTES, m.FILES_MAX]).toEqual([3 * 1024 * 1024, 1024 * 1024, 200]);
    // Four 900 KB files: three fit under 3 MB, the fourth is over.
    const chunk = "y".repeat(900 * 1024);
    const entries = ["a", "b", "c", "d"].map((n) => ({ status: "A", path: `${n}.txt` }));
    const files = Object.fromEntries(entries.map((e) => [e.path, text(chunk)]));
    const { changes, skipped } = m.collectChanges(entries, read(files));
    expect(changes.map((c) => c.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(skipped).toEqual([{ path: "d.txt", why: "over the 3 MB total" }]);
    // The encoded size counts: a text that is mostly newlines is twice its length as JSON.
    const nl = "\n".repeat(900 * 1024);
    const two = m.collectChanges(["a", "b"].map((n) => ({ status: "A", path: `${n}.txt` })), read({ "a.txt": text(nl), "b.txt": text(nl) }), { totalMax: 2 * 1024 * 1024 });
    expect(two.changes.map((c) => c.path)).toEqual(["a.txt"]);
    expect(two.skipped).toHaveLength(1);
    // Too many files.
    const many = Array.from({ length: 205 }, (_, i) => ({ status: "D", path: `f${i}.txt` }));
    const cut = m.collectChanges(many, read({}));
    expect(cut.changes).toHaveLength(200);
    expect(cut.skipped).toHaveLength(5);
    expect(cut.skipped[0]).toEqual({ path: "f200.txt", why: "too many files" });
    // The note says how many and which, and is empty when nothing was left out.
    expect(m.skippedNote([])).toBe("");
    expect(m.skippedNote(cut.skipped)).toMatch(/^\n\[Tailzu: 5 changed files were not sent: f200\.txt \(too many files\), /);
    expect(m.skippedNote([{ path: "a", why: "w" }])).toBe("\n[Tailzu: 1 changed file was not sent: a (w)]");
    expect(m.skippedNote(Array.from({ length: 12 }, (_, i) => ({ path: `p${i}`, why: "w" })))).toMatch(/, and more\]$/);
  });
});

describe("run.mjs: asking for the identity and reporting", () => {
  it("asks GitHub's endpoint for the audience, with the request token, and reads { value }", async () => {
    const m = await loadScript();
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const f = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), auth: (init.headers as Record<string, string>).authorization });
      return new Response(JSON.stringify({ value: "the.jwt.value" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await m.oidcToken("https://pipelines.actions.githubusercontent.com/x/y?api-version=2.0", "reqtok", "tailzu", f)).toBe("the.jwt.value");
    expect(seen).toEqual([{ url: "https://pipelines.actions.githubusercontent.com/x/y?api-version=2.0&audience=tailzu", auth: "Bearer reqtok" }]);
    await expect(m.oidcToken("https://x.test/t", "r", "a", (async () => new Response("no", { status: 403 })) as unknown as typeof fetch)).rejects.toThrow(/403/);
    await expect(m.oidcToken("https://x.test/t", "r", "a", (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)).rejects.toThrow(/no identity token/);
  });

  it("posts the result with the token, tries again for a 5xx, a 429 or a network error (waiting a little longer each time), and not for a refusal", async () => {
    const m = await loadScript();
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    const answers = (...as: Array<number | "boom">) => {
      const calls: Array<{ url: string; auth: string; body: string }> = [];
      const f = (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: (init.headers as Record<string, string>).authorization!, body: String(init.body) });
        const a = as[Math.min(calls.length - 1, as.length - 1)]!;
        if (a === "boom") throw new Error("network");
        return new Response("{}", { status: a });
      }) as unknown as typeof fetch;
      return { f, calls };
    };
    const body = { jobId: "j", stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "", minutes: 0.2, changes: [] };

    const ok = answers(200);
    expect(await m.postResult("https://api.test/gh-result", "tok", body, { fetchFn: ok.f, sleep })).toEqual({ ok: true, status: 200 });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).toMatchObject({ url: "https://api.test/gh-result", auth: "Bearer tok" });
    expect(JSON.parse(ok.calls[0]!.body)).toEqual(body);
    expect(waits).toEqual([]);

    const flaky = answers(503, "boom", 429, 200);
    expect(await m.postResult("https://api.test/gh-result", "tok", body, { fetchFn: flaky.f, sleep })).toEqual({ ok: true, status: 200 });
    expect(flaky.calls).toHaveLength(4);
    expect(waits).toEqual([2000, 5000, 15000]);

    const refused = answers(409);
    expect(await m.postResult("u", "t", body, { fetchFn: refused.f, sleep })).toEqual({ ok: false, status: 409 });
    expect(refused.calls).toHaveLength(1);
    const forbidden = answers(403);
    expect(await m.postResult("u", "t", body, { fetchFn: forbidden.f, sleep })).toEqual({ ok: false, status: 403 });

    waits.length = 0;
    const down = answers(500);
    expect(await m.postResult("u", "t", body, { fetchFn: down.f, sleep })).toEqual({ ok: false, status: 500 });
    expect(down.calls).toHaveLength(4);
    expect(waits).toEqual([2000, 5000, 15000]);
  });
});

// ------------------------------------------------------------ run.mjs, whole

interface Seen { tokenRequests: Array<{ url: string; auth?: string }>; results: Array<{ auth?: string; body: any }> }

/** A local stand-in for GitHub's identity-token endpoint (GET /token) and for Tailzu's result address (POST /result). */
async function stubServer(o: { resultStatus?: number } = {}): Promise<{ port: number; seen: Seen; server: Server }> {
  const seen: Seen = { tokenRequests: [], results: [] };
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "GET" && req.url?.startsWith("/token")) {
        seen.tokenRequests.push({ url: req.url, auth: req.headers.authorization });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ value: "fake.oidc.token" }));
      } else if (req.method === "POST" && req.url === "/result") {
        seen.results.push({ auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
        res.statusCode = o.resultStatus ?? 200;
        res.setHeader("content-type", "application/json");
        res.end("{}");
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => { server.close(); server.closeAllConnections?.(); });
  return { port: (server.address() as { port: number }).port, seen, server };
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/**
 * A repo as the runner finds it: the work branch's checkpoint (base files), then the shadow commit on top of it with the three
 * files; and `node .tailzu/run.mjs` run in it, against the stub server.
 */
async function runStep(o: {
  commands: string[]; timeoutSec?: number; base?: Record<string, string>; identity?: boolean; resultStatus?: number;
  overlay?: Array<{ path: string; content: string | null }>; discard?: boolean;
}): Promise<{ exit: number; stdout: string; seen: Seen; dir: string; elapsedMs: number }> {
  const dir = scratch();
  git(dir, "init", "-q", "-b", "main");
  const files = o.base ?? { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n", ".gitignore": "node_modules/\n" };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "checkpoint");
  const baseSha = git(dir, "rev-parse", "HEAD");
  const srv = await stubServer({ resultStatus: o.resultStatus });
  const spec = {
    jobId: "job-1", stepIdx: 3, epoch: 2, commands: o.commands, timeoutSec: o.timeoutSec ?? 60, baseSha,
    resultUrl: `http://127.0.0.1:${srv.port}/result`, audience: "tailzu",
    ...(o.overlay ? { overlay: o.overlay } : {}), ...(o.discard ? { discard: true } : {}),
  };
  mkdirSync(join(dir, ".tailzu"), { recursive: true });
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  writeFileSync(join(dir, ".tailzu/step.json"), stepJson(spec));
  writeFileSync(join(dir, ".tailzu/run.mjs"), RUN_MJS);
  writeFileSync(join(dir, ".github/workflows/tailzu-run.yml"), renderWorkflow(5));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "shadow");

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (o.identity !== false) {
    env.ACTIONS_ID_TOKEN_REQUEST_URL = `http://127.0.0.1:${srv.port}/token?api-version=2.0`;
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "request-token-0123456789";
  }
  const started = Date.now();
  const res = await new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile("node", [".tailzu/run.mjs"], { cwd: dir, env, timeout: 60_000 }, (err, stdout) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, stdout });
    });
  });
  return { exit: res.code, stdout: res.stdout, seen: srv.seen, dir, elapsedMs: Date.now() - started };
}

describe("run.mjs, run for real in a git repo", () => {
  it("runs the commands in order, sends what they changed against the checkpoint (not the shadow files), and reports with the identity token", async () => {
    const r = await runStep({
      commands: [
        "mkdir -p dist && echo built > dist/out.txt", "echo 'hello from the build'", "echo changed >> src/a.ts", "rm README.md",
        "mkdir -p node_modules/x && echo ignored > node_modules/x/index.js", "env | grep -c ACTIONS_ID_TOKEN || true",
      ],
    });
    expect(r.exit).toBe(0);
    // GitHub's endpoint was asked for the audience with the request token; the result went with the identity token it gave.
    expect(r.seen.tokenRequests).toHaveLength(1);
    expect(r.seen.tokenRequests[0]!.auth).toBe("Bearer request-token-0123456789");
    expect(new URL(`http://x${r.seen.tokenRequests[0]!.url}`).searchParams.get("audience")).toBe("tailzu");
    expect(r.seen.results).toHaveLength(1);
    const { auth, body } = r.seen.results[0]!;
    expect(auth).toBe("Bearer fake.oidc.token");
    expect(Object.keys(body).sort()).toEqual(["changes", "epoch", "exitCode", "jobId", "minutes", "outputTail", "stepIdx"]);
    expect(body).toMatchObject({ jobId: "job-1", stepIdx: 3, epoch: 2, exitCode: 0 });
    expect(typeof body.minutes).toBe("number");
    expect(body.minutes).toBeGreaterThan(0);
    expect(body.minutes).toBeLessThan(1);
    // The changes: the new file, the modified one, the deleted one; not the shadow files, not what .gitignore hides.
    expect(body.changes).toEqual(expect.arrayContaining([
      { path: "dist/out.txt", content: "built\n" }, { path: "src/a.ts", content: "export const a = 1;\nchanged\n" }, { path: "README.md", content: null },
    ]));
    expect(body.changes).toHaveLength(3);
    // What they printed, with the command lines, and the commands could not see the way to ask GitHub for an identity.
    expect(body.outputTail).toContain("$ echo 'hello from the build'");
    expect(body.outputTail).toContain("hello from the build");
    expect(body.outputTail).toMatch(/\$ env \| grep -c ACTIONS_ID_TOKEN \|\| true\n0\n/);
    expect(r.stdout).toContain("hello from the build");
  });

  it("lays the staged edits over the checkout for the commands to see, and with discard sends no changes back", async () => {
    const r = await runStep({
      commands: ["cat src/a.ts", "test ! -e README.md && echo readme-gone", "echo extra >> src/a.ts"],
      overlay: [{ path: "src/a.ts", content: "export const a = 42;\n" }, { path: "README.md", content: null }, { path: "src/new.ts", content: "export const n = 1;\n" }, { path: ".github/workflows/ci.yml", content: "evil" }],
      discard: true,
    });
    expect(r.exit).toBe(0);
    const body = r.seen.results[0]!.body;
    expect(body.exitCode).toBe(0);
    expect(body.outputTail).toContain("[Tailzu: laid 3 staged file(s) over the checkout; could not lay .github/workflows/ci.yml]");
    expect(body.outputTail).toContain("export const a = 42;");
    expect(body.outputTail).toContain("readme-gone");
    expect(body.changes).toEqual([]);
  });

  it("without discard, a step with an overlay reports what the commands changed against the checkpoint, the overlay included", async () => {
    const r = await runStep({ commands: ["echo more >> src/a.ts"], overlay: [{ path: "src/a.ts", content: "export const a = 42;\n" }] });
    const body = r.seen.results[0]!.body;
    expect(body.changes).toEqual([{ path: "src/a.ts", content: "export const a = 42;\nmore\n" }]);
  });

  it("stops at the first command that fails, reports its exit code, sends no files, and still reports (the run ends red, but the server heard)", async () => {
    const r = await runStep({ commands: ["echo one > made.txt", "echo before-the-failure", "sh -c 'exit 3'", "echo never-printed"] });
    expect(r.exit).toBe(1);
    expect(r.seen.results).toHaveLength(1);
    const body = r.seen.results[0]!.body;
    expect(body.exitCode).toBe(3);
    expect(body.changes).toEqual([]);
    expect(body.outputTail).toContain("before-the-failure");
    expect(body.outputTail).not.toContain("never-printed");
  });

  it("gives each command the time the step has left: one that runs past it is killed, exit code 124, and later ones don't run", async () => {
    const r = await runStep({ commands: ["echo start", "sleep 30", "echo never"], timeoutSec: 2 });
    expect(r.elapsedMs).toBeLessThan(15_000);
    const body = r.seen.results[0]!.body;
    expect(body.exitCode).toBe(124);
    expect(body.outputTail).toContain("start");
    expect(body.outputTail).toMatch(/stopped after 2 seconds/);
    expect(body.outputTail).not.toContain("never");
    expect(r.exit).toBe(1);
  });

  it("is not held up by something a command leaves running in the background", async () => {
    const r = await runStep({ commands: ["(sleep 20 &) ; echo started-a-daemon"], timeoutSec: 30 });
    expect(r.elapsedMs).toBeLessThan(15_000);
    expect(r.seen.results[0]!.body).toMatchObject({ exitCode: 0 });
    expect(r.seen.results[0]!.body.outputTail).toContain("started-a-daemon");
  });

  it("keeps secrets the commands print out of what it reports", async () => {
    const ghp = `ghp_${"Q1w2E3r4T5".repeat(4)}`;
    const r = await runStep({ commands: [`echo ${ghp}`, "echo password=correcthorsebatterystaple", "echo 'a normal line'"] });
    const tail = r.seen.results[0]!.body.outputTail as string;
    expect(tail).not.toContain(ghp);
    expect(tail).not.toContain("correcthorsebatterystaple");
    expect(tail).toContain("[redacted]");
    expect(tail).toContain("a normal line");
  });

  it("names what it could not send in the output (a file over 1 MB is left out, not silently)", async () => {
    const r = await runStep({ commands: ["head -c 1100000 /dev/zero | tr '\\0' 'a' > huge.txt", "echo small > small.txt"] });
    const body = r.seen.results[0]!.body;
    expect(body.changes).toEqual([{ path: "small.txt", content: "small\n" }]);
    expect(body.outputTail).toMatch(/\[Tailzu: 1 changed file was not sent: huge\.txt \(over 1 MB\)\]$/);
  });

  it("does not follow a symlink out of the repo, and reports a symlink as left out", async () => {
    const outside = scratch();
    writeFileSync(join(outside, "secret.txt"), "not for the server\n");
    const r = await runStep({ commands: [`ln -s ${join(outside, "secret.txt")} link.txt`, "echo ok > ok.txt"] });
    const body = r.seen.results[0]!.body;
    expect(body.changes).toEqual([{ path: "ok.txt", content: "ok\n" }]);
    expect(JSON.stringify(body)).not.toContain("not for the server");
    expect(body.outputTail).toContain("link.txt (not a plain file)");
    void symlinkSync;
  });

  it("can't report without an identity token: it says so and the run fails (the server then sees a run that ended without a result)", async () => {
    const r = await runStep({ commands: ["echo hi"], identity: false });
    expect(r.exit).toBe(1);
    expect(r.seen.results).toHaveLength(0);
  });

  it("treats a refusal as final (no retry), and a 409 (the step was given to another computer) as not its failure", async () => {
    const refused = await runStep({ commands: ["echo hi"], resultStatus: 403 });
    expect(refused.exit).toBe(1);
    expect(refused.seen.results).toHaveLength(1);
    const stale = await runStep({ commands: ["echo hi"], resultStatus: 409 });
    expect(stale.exit).toBe(0);
    expect(stale.seen.results).toHaveLength(1);
  });
});

// ------------------------------------------------------------ the person's own CI

describe("the person's own workflows that would also run on a runner push", () => {
  const t = (yaml: string) => firesForRunnerPush(pushTrigger(yaml));

  it("counts a push trigger with no filter, written any way `on:` is written", () => {
    expect(t("name: CI\non: push\njobs: {}\n")).toBe(true);
    expect(t("name: CI\non: [push, pull_request]\n")).toBe(true);
    expect(t("on: ['push']\n")).toBe(true);
    expect(t("on:\n  - push\n  - pull_request\n")).toBe(true);
    expect(t("on:\n  push:\n  pull_request:\n")).toBe(true);
    expect(t("on:\n  push:\n    paths-ignore:\n      - 'docs/**'\n")).toBe(true);
    expect(t("on:\n  pull_request:\n  push: {}\n")).toBe(true);
    expect(t("on: { push: {}, pull_request: {} }\n")).toBe(true);
    expect(t('"on":\n  push:\n')).toBe(true);
    expect(t("on:\r\n  push:\r\n    branches-ignore: [main]\r\n")).toBe(true);
    expect(t("on:\n  push: # every push\n  workflow_dispatch:\n")).toBe(true);
  });

  it("does not count a push trigger with a branch filter that leaves tailzu-run/ out, or no push at all", () => {
    expect(t("on:\n  push:\n    branches: [main]\n")).toBe(false);
    expect(t("on:\n  push:\n    branches:\n      - main\n      - 'release/**'\n")).toBe(false);
    expect(t("on: { push: { branches: [main, dev] } }\n")).toBe(false);
    expect(t("on:\n  push:\n    branches: ['tailzu/**']\n")).toBe(false);
    expect(t("on:\n  push:\n    tags:\n      - 'v*'\n")).toBe(false);
    expect(t("on:\n  pull_request:\n  workflow_dispatch:\n")).toBe(false);
    expect(t("on: pull_request\n")).toBe(false);
    expect(t("on: [pull_request, workflow_dispatch]\n")).toBe(false);
    expect(t("on:\n  schedule:\n    - cron: '0 0 * * *'\n")).toBe(false);
    expect(t("name: no triggers read\n")).toBe(false);
    expect(t("")).toBe(false);
  });

  it("counts a branch filter that does include tailzu-run/, or ignores everything but other branches; with ! taking a pattern back", () => {
    expect(t("on:\n  push:\n    branches: ['**']\n")).toBe(true);
    expect(t("on:\n  push:\n    branches: ['*', 'tailzu-run/**']\n")).toBe(true);
    expect(t("on:\n  push:\n    branches: ['**', '!tailzu-run/**']\n")).toBe(false);
    expect(t("on:\n  push:\n    branches-ignore: ['tailzu-run/**']\n")).toBe(false);
    expect(t("on:\n  push:\n    branches-ignore: [wip/**]\n")).toBe(true);
  });

  it("reads paths filters against the three runner files: a filter that can't match them is quiet, an ignore of the whole lot is too", () => {
    expect(t("on:\n  push:\n    paths:\n      - 'src/**'\n")).toBe(false);
    expect(t("on:\n  push:\n    paths: ['**.ts']\n")).toBe(false);
    expect(t("on:\n  push:\n    paths:\n      - '.github/**'\n")).toBe(true);
    expect(t("on:\n  push:\n    paths: ['**']\n")).toBe(true);
    expect(t("on:\n  push:\n    paths-ignore: ['.tailzu/**', '.github/**']\n")).toBe(false);
    expect(t("on:\n  push:\n    paths-ignore: ['docs/**']\n")).toBe(true);
  });

  it("estimates 3 minutes for each workflow that would run, at most 30, ignoring Tailzu's own and files that aren't workflows", () => {
    const loud = "name: CI\non: push\njobs: {}\n";
    const quiet = "on:\n  push:\n    branches: [main]\n";
    expect(ciNoiseOf([])).toEqual({ ciNoise: false, extraMinutes: 0, workflows: [] });
    expect(ciNoiseOf([{ path: ".github/workflows/q.yml", text: quiet }])).toEqual({ ciNoise: false, extraMinutes: 0, workflows: [] });
    expect(ciNoiseOf([
      { path: ".github/workflows/ci.yml", text: loud }, { path: ".github/workflows/q.yml", text: quiet }, { path: ".github/workflows/lint.yaml", text: loud },
      { path: ".github/workflows/tailzu-run.yml", text: loud }, { path: ".github/workflows/README.md", text: loud },
    ])).toEqual({ ciNoise: true, extraMinutes: 2 * CI_NOISE_MINUTES_EACH, workflows: [".github/workflows/ci.yml", ".github/workflows/lint.yaml"] });
    const many = Array.from({ length: 20 }, (_, i) => ({ path: `.github/workflows/w${i}.yml`, text: loud }));
    expect(ciNoiseOf(many).extraMinutes).toBe(CI_NOISE_MINUTES_MAX);
  });
});
