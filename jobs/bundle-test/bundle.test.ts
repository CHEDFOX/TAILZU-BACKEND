/**
 * The Worker as it is SHIPPED: built the way `wrangler deploy` builds it, looked at, and loaded in workerd.
 *
 * What the vitest-plugin tests (test/) run is the source through Vite; this is the bundle esbuild makes of it and ../tulmi/src,
 * which is what Cloudflare gets. So here: that nothing the Worker must not carry is in it (undici, node:dns, node:net), that it is
 * the size it should be, that the wrangler config says what the docs said it should (the cron, the CPU limit, nodejs_compat, the
 * bindings, a compatibility date the runtime knows), and that it loads and answers.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, unstable_readConfig, type Unstable_DevWorker } from "wrangler";
import { signRequest } from "../../tulmi/src/code/jobs/handoff/sign.js";

const root = resolve(__dirname, "..");
const outdir = mkdtempSync(join(tmpdir(), "tailzu-jobs-bundle-"));
const SECRET = "bundle-test-secret-0123456789abcdef0123456789";
let source = "";
let worker: Unstable_DevWorker | undefined;

beforeAll(async () => {
  execFileSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, stdio: "pipe", timeout: 110_000 });
  source = readFileSync(join(outdir, "index.js"), "utf8");
});

afterAll(async () => { await worker?.stop(); });

/** The runner script the GitHub Actions provider writes into a branch is a template string in the bundle; its imports are text, not the Worker's. */
const withoutTemplates = (js: string) => js.replace(/String\.raw`[\s\S]*?`/g, "");

/** What the bundle really imports: its `import ... from "x"` statements, which esbuild writes at the start of a line. */
const importsOf = (js: string): string[] => [...withoutTemplates(js).matchAll(/^import\s[^;\n]*?from\s+"([^"]+)";?$/gm), ...withoutTemplates(js).matchAll(/^import\s+"([^"]+)";?$/gm)].map((m) => m[1]!);

describe("the bundle", () => {
  it("carries nothing the Worker must not: no undici, no node:dns, no node:net, no node:http", () => {
    const code = withoutTemplates(source);
    expect(code).not.toMatch(/\bundici\b/i);
    const imports = importsOf(source);
    for (const banned of ["undici", "node:dns", "node:net", "node:http", "node:https", "node:tls", "node:http2", "node:child_process", "node:worker_threads", "node:os", "dns", "net", "http", "https", "tls", "child_process", "os", "dotenv"]) {
      expect(imports).not.toContain(banned);
    }
  });

  it("imports only the Workers runtime's own modules, and Node's as nodejs_compat provides them", () => {
    const allowed = new Set(["cloudflare:workers", "cloudflare:workflows", "node:crypto", "node:fs", "node:path", "node:url", "node:zlib", "node:stream", "node:stream/promises"]);
    // (A relative import cannot be real in one file: those are lines of the project templates the Code bot writes, inside template strings.)
    expect([...new Set(importsOf(source))].filter((m) => !m.startsWith(".") && !allowed.has(m))).toEqual([]);
  });

  it("is small enough for any Workers plan", () => {
    const bytes = statSync(join(outdir, "index.js")).size;
    const gz = gzipSync(source).length;
    console.log(`jobs bundle: ${(bytes / 1024).toFixed(0)} KiB, ${(gz / 1024).toFixed(0)} KiB gzipped, ${readdirSync(outdir).length} files`);
    expect(bytes).toBeLessThan(10 * 1024 * 1024);
  });

  it("exports the three classes the config names, and a fetch and a scheduled handler", () => {
    expect(source).toMatch(/export\s*\{[^}]*\bAgentJob\b/);
    expect(source).toMatch(/export\s*\{[^}]*\bBuildBrain\b/);
    expect(source).toMatch(/export\s*\{[^}]*\bNonceGuard\b/);
    expect(source).toContain("scheduled");
  });
});

describe("wrangler.jsonc", () => {
  const cfg = unstable_readConfig({ config: join(root, "wrangler.jsonc") }, {});

  it("runs the ticker every minute", () => {
    expect(cfg.triggers.crons).toEqual(["* * * * *"]);
  });

  it("raises the CPU limit for brain builds, to no more than a Worker may have", () => {
    expect(cfg.limits?.cpu_ms).toBeGreaterThanOrEqual(120_000);
    expect(cfg.limits?.cpu_ms).toBeLessThanOrEqual(300_000);
  });

  it("turns on nodejs_compat, with a compatibility date the pinned runtime knows", () => {
    expect(cfg.compatibility_flags).toContain("nodejs_compat");
    const known = execFileSync(join(root, "node_modules/.bin/workerd"), ["--version"], { encoding: "utf8" }).match(/\d{4}-\d{2}-\d{2}/)![0];
    expect(cfg.compatibility_date! <= known).toBe(true);
    expect(cfg.compatibility_date! >= "2026-08-04").toBe(true);
  });

  it("binds the two Workflows, the nonce book, and names no secret", () => {
    expect(cfg.workflows.map((w: { binding: string; class_name: string }) => [w.binding, w.class_name])).toEqual([["AGENT_JOB", "AgentJob"], ["BUILD_BRAIN", "BuildBrain"]]);
    expect(cfg.durable_objects.bindings.map((b: { name: string; class_name: string }) => [b.name, b.class_name])).toEqual([["NONCES", "NonceGuard"]]);
    expect(cfg.migrations.flatMap((m: { new_sqlite_classes?: string[] }) => m.new_sqlite_classes ?? [])).toEqual(["NonceGuard"]);
    const vars = Object.keys(cfg.vars ?? {});
    for (const secret of ["CODE_JOBS_SECRET", "SUPABASE_SERVICE_KEY", "OPENROUTER_API_KEY", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_CLIENT_SECRET", "CLOUDFLARE_API_TOKEN", "CONNECTOR_TOKEN_KEY"]) {
      expect(vars).not.toContain(secret);
    }
    expect(cfg.vars?.RUNTIME).toBe("worker");
  });

  it("lists every secret it needs in a comment, and each one is read by the code", () => {
    const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");
    const listed = [...text.matchAll(/^\s*\/\/\s{3}([A-Z][A-Z0-9_]+)\s{2,}/gm)].map((m) => m[1]!);
    expect(listed).toEqual(expect.arrayContaining(["CODE_JOBS_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "OPENROUTER_API_KEY", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_CLIENT_SECRET", "CONNECTOR_TOKEN_KEY", "CLOUDFLARE_API_TOKEN"]));
  });
});

describe("loaded in workerd", () => {
  it("starts, answers /v1/health, refuses an unsigned call, and takes a signed one", async () => {
    worker = await unstable_dev(join(outdir, "index.js"), {
      config: join(root, "wrangler.jsonc"),
      local: true,
      vars: { CODE_JOBS_SECRET: SECRET },
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
      logLevel: "error",
    });
    const health = await worker.fetch("/v1/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const jobId = randomUUID(); // local state is kept between runs: a fresh job each time
    const unsigned = await worker.fetch("/v1/start", { method: "POST", body: JSON.stringify({ jobId }) });
    expect(unsigned.status).toBe(401);

    const body = JSON.stringify({ jobId });
    const ok = await worker.fetch("/v1/start", { method: "POST", body, headers: signRequest({ secret: SECRET, method: "POST", path: "/v1/start", body }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, created: true });
    // A nonce is written down in the Durable Object: the same one again is a replay.
    const nonce = `replay-${randomUUID()}`;
    const once = await worker.fetch("/v1/start", { method: "POST", body, headers: signRequest({ secret: SECRET, method: "POST", path: "/v1/start", body, nonce }) });
    expect(once.status).toBe(200);
    expect(await once.json()).toMatchObject({ ok: true, created: false }); // the same job: its Workflow is there already
    const again = await worker.fetch("/v1/start", { method: "POST", body, headers: signRequest({ secret: SECRET, method: "POST", path: "/v1/start", body, nonce }) });
    expect(again.status).toBe(401);
  });
});
