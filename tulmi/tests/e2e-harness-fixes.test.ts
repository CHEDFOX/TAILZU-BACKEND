/**
 * What the first real-model test found in the harness itself (e2e/RESULTS-2026-10-27.md):
 *
 *   - the catalog fetch went around the proxy the environment names, so estimates ran on assumed prices;
 *   - the bake-off's dry run did not say what --edit-format adds, and had no --estimate (the smoke suite and e2e/run.ts do);
 *   - the cassette's key and record left out `reasoning`, so a recording of a refusal ("Reasoning is mandatory") was served to the request that fixed it.
 *
 * No key, no network: the "proxy" is a local server, the catalog a file.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cacheDir = vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof import("node:fs");
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "e2e-cache-"));
  process.env.E2E_CACHE_DIR = dir;
  // A fresh copy of the catalog, so nothing here goes to the network: two models, one that requires reasoning (efforts medium and up), one that does not.
  const entry = (id: string, mandatory: boolean, efforts: string[]) => ({
    id, name: id, created: 1, context_length: 1000, pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { input_modalities: ["text"] },
    supported_parameters: ["tools", "reasoning"], reasoning: { mandatory, supported_efforts: efforts },
  });
  nodeFs.writeFileSync(nodePath.join(dir, "models.json"), JSON.stringify({ fetchedAt: Date.now(), raw: { data: [entry("vendor/thinker-x", true, ["medium", "high"]), entry("vendor/plain-x", false, ["low", "none"])] } }));
  return dir;
});

import { CassetteClient, CassetteMiss, CassetteStore, cassetteKey, wireRequestOf } from "../e2e/adapters/cassette.js";
import { loadCatalog, parseCatalog } from "../e2e/catalog.js";
import { proxyAwareFetch } from "../e2e/fetch.js";
import { planBakeoff, renderPlan } from "../e2e/bakeoff/plan.js";
import { runBakeoffCli } from "../e2e/bakeoff/index.js";
import { reasoningFor } from "../src/agent/llm.js";
import { resetReasoningForTests } from "../src/agent/reasoning.js";
import type { ChatClient } from "../src/code/brain/gateway.js";

afterEach(() => { resetReasoningForTests(); });

// ------------------------------------------------------------------ the proxy

describe("the catalog fetch goes through the proxy the environment names", () => {
  const servers: Array<http.Server> = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });

  it("is the plain fetch when no proxy is named, or when Node does it itself", () => {
    expect(proxyAwareFetch({})).toBe(fetch);
    expect(proxyAwareFetch({ HTTPS_PROXY: "http://127.0.0.1:1", NODE_USE_ENV_PROXY: "1" })).toBe(fetch);
    expect(proxyAwareFetch({ HTTPS_PROXY: "http://127.0.0.1:1" })).not.toBe(fetch);
  });

  it("sends a request through the proxy (a CONNECT to the address), and goes direct to what NO_PROXY names", async () => {
    const target = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "via/target" }] })); });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    servers.push(target);
    const where = `127.0.0.1:${(target.address() as net.AddressInfo).port}`;
    const connects: string[] = [];
    const proxy = http.createServer();
    proxy.on("connect", (req, client, head) => {
      connects.push(String(req.url));
      const [host, port] = String(req.url).split(":");
      const up = net.connect(Number(port), host, () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); up.write(head); up.pipe(client); client.pipe(up); });
      up.on("error", () => client.destroy());
      client.on("error", () => up.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    servers.push(proxy);
    const url = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

    const through = await proxyAwareFetch({ HTTP_PROXY: url, HTTPS_PROXY: url })(`http://${where}/api/v1/models`, { signal: AbortSignal.timeout(5000) });
    expect(((await through.json()) as { data: Array<{ id: string }> }).data[0]!.id).toBe("via/target");
    expect(connects).toEqual([where]);

    connects.length = 0;
    const direct = await proxyAwareFetch({ HTTP_PROXY: url, HTTPS_PROXY: url, NO_PROXY: "127.0.0.1" })(`http://${where}/api/v1/models`, { signal: AbortSignal.timeout(5000) });
    expect(direct.status).toBe(200);
    expect(connects).toEqual([]);
  });

  it("loadCatalog's own fetch is that one: an https catalog is asked for through a CONNECT to the proxy", async () => {
    const connects: string[] = [];
    const proxy = http.createServer();
    proxy.on("connect", (req, socket) => { connects.push(String(req.url)); socket.destroy(); });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    servers.push(proxy);
    const url = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    const saved = { s: process.env.HTTPS_PROXY, l: process.env.https_proxy, u: process.env.NODE_USE_ENV_PROXY };
    process.env.HTTPS_PROXY = url;
    delete process.env.https_proxy;
    delete process.env.NODE_USE_ENV_PROXY;
    try {
      // maxAgeMs 0: the saved copy is too old to use, so it must ask; the proxy hangs up, and the copy is what is left (and says so).
      const c = await loadCatalog({ maxAgeMs: 0, timeoutMs: 3000 });
      // (The agent asks again when the tunnel is cut, so more than one: what matters is where.)
      expect(connects.length).toBeGreaterThan(0);
      expect(new Set(connects)).toEqual(new Set(["openrouter.ai:443"]));
      expect(c.source).toBe("cache");
    } finally {
      for (const [k, v] of [["HTTPS_PROXY", saved.s], ["https_proxy", saved.l], ["NODE_USE_ENV_PROXY", saved.u]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

describe("the catalog tells the product how a model thinks", () => {
  it("reads mandatory and the efforts into the model's entry, and loading the catalog hands them to the product", async () => {
    const m = parseCatalog({ data: [{ id: "a/b", supported_parameters: ["reasoning"], reasoning: { mandatory: true, supported_efforts: ["high", "low"] } }] }).get("a/b")!;
    expect(m.reasoning).toEqual({ supported: true, mandatory: true, efforts: ["high", "low"] });
    expect(reasoningFor("vendor/thinker-x")).toEqual({ effort: "none" });
    const c = await loadCatalog();
    expect(c.models.get("vendor/thinker-x")!.reasoning.mandatory).toBe(true);
    expect(reasoningFor("vendor/thinker-x")).toEqual({ effort: "medium" });
    expect(reasoningFor("vendor/plain-x")).toEqual({ effort: "none" });
  });
});

// ------------------------------------------------------------------ the cassette

describe("the cassette key and record hold the reasoning", () => {
  const req = (reasoning?: unknown, model = "vendor/thinker-x"): Record<string, unknown> => ({
    model, messages: [{ role: "user", content: "hello" }], ...(reasoning !== undefined ? { reasoning } : {}),
  });
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "cassette-reasoning-"));

  it("makes a different key for a different reasoning, and the same one for the same, whatever the order of its keys", () => {
    expect(cassetteKey(req({ effort: "none" }))).not.toBe(cassetteKey(req({ effort: "low" })));
    expect(cassetteKey(req({ effort: "none", enabled: false }))).not.toBe(cassetteKey(req({ effort: "none" })));
    expect(cassetteKey(req({ effort: "none", enabled: false }))).toBe(cassetteKey(req({ enabled: false, effort: "none" })));
    expect(cassetteKey(req({ effort: "low" }))).not.toBe(cassetteKey(req()));
    expect(cassetteKey(req({ effort: "none" }), { legacy: true })).toBe(cassetteKey(req()));
  });

  it("writes the reasoning into the record", async () => {
    const dir = tmp();
    const store = new CassetteStore("r", dir);
    store.reset();
    const upstream: ChatClient = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "ok" } }], usage: { cost: 0.001 } }) } } };
    await new CassetteClient({ store, mode: "record", upstream }).create(req({ effort: "low" }));
    expect(wireRequestOf(req({ effort: "low" })).reasoning).toEqual({ effort: "low" });
    expect(store.entries()[0]!.req.reasoning).toEqual({ effort: "low" });
    expect(JSON.parse(fs.readFileSync(store.file, "utf8").trim()).req.reasoning).toEqual({ effort: "low" });
  });

  it("re-records when the reasoning changed: a replay of the refusal is not served to the request that fixed it", async () => {
    const dir = tmp();
    const store = new CassetteStore("r", dir);
    store.reset();
    const refuse: ChatClient = { chat: { completions: { create: async () => { throw Object.assign(new Error("OpenRouter 400: Reasoning is mandatory for this endpoint and cannot be disabled."), { status: 400 }); } } } };
    await new CassetteClient({ store, mode: "record", upstream: refuse }).create(req({ effort: "none" })).catch(() => undefined);
    const replay = new CassetteClient({ store: new CassetteStore("r", dir).load(), mode: "replay" });
    await expect(replay.create(req({ effort: "none" }))).rejects.toMatchObject({ status: 400 });
    await expect(replay.create(req({ effort: "low" }))).rejects.toBeInstanceOf(CassetteMiss);
    // In mixed mode the changed request goes to the model, and is added.
    const upstream: ChatClient = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "fine" } }], usage: { cost: 0.001 } }) } } };
    const mixed = new CassetteClient({ store: new CassetteStore("r", dir).load(), mode: "mixed", upstream });
    expect(((await mixed.create(req({ effort: "low" }))) as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content).toBe("fine");
    expect(mixed.stats.recorded).toBe(1);
  });

  describe("a recording made before the key held the reasoning", () => {
    const legacyStore = (model: string) => {
      const dir = tmp();
      const store = new CassetteStore("old", dir);
      store.reset();
      const old = req(undefined, model);
      store.append({ k: cassetteKey(old), at: "2026-10-27T00:00:00Z", req: wireRequestOf(old), res: { choices: [{ message: { content: "from the old recording" } }], usage: { cost: 0.001 } }, ms: 1, usd: 0.001 });
      return new CassetteStore("old", dir).load();
    };

    it("still answers the request the product would have sent the same way then (a model that can be switched off)", async () => {
      const c = new CassetteClient({ store: legacyStore("vendor/plain-x"), mode: "replay" });
      const res = (await c.create(req({ effort: "none" }, "vendor/plain-x"))) as { choices: Array<{ message: { content: string } }> };
      expect(res.choices[0]!.message.content).toBe("from the old recording");
      expect(c.stats.hits).toBe(1);
    });

    it("never answers a model that requires reasoning now: its request is not the one that was recorded", async () => {
      await loadCatalog();
      const c = new CassetteClient({ store: legacyStore("vendor/thinker-x"), mode: "replay" });
      await expect(c.create(req({ effort: "medium" }, "vendor/thinker-x"))).rejects.toBeInstanceOf(CassetteMiss);
    });
  });
});

// ------------------------------------------------------------------ the estimates

describe("the bake-off's estimate", () => {
  const info = (slug: string) => ({ id: slug, name: slug, inUsdPerM: 1, outUsdPerM: 4, tools: true, image: false, jsonMode: true, contextLength: 1000, created: 1, reasoning: {} });
  const filtered = {
    candidates: { tiny: [{ slug: "a/tiny", tier: "tiny" as const, info: info("a/tiny") }], cheap: [], code: [{ slug: "a/code", tier: "code" as const, info: info("a/code") }], strong: [{ slug: "a/strong", tier: "strong" as const, info: info("a/strong") }], vision: [] },
    excluded: [],
  };
  const plan = (editFormat: boolean) => planBakeoff(filtered as never, { fx: 88, tiers: ["tiny", "code", "strong"], evalRuns: 1, taskCount: 2, editFormat, probesOnly: true, needleTokens: 0 });

  it("includes the edit-format probe when it is asked for, and says so", () => {
    const withIt = plan(true);
    expect(withIt.editInr).toBeGreaterThan(0);
    expect(withIt.totalInr).toBeCloseTo(plan(false).totalInr + withIt.editInr, 6);
    expect(renderPlan(withIt)).toContain(`(includes ₹${withIt.editInr.toFixed(2)} for the edit-format probe, --edit-format)`);
  });

  it("names what it would add when it is not asked for, instead of leaving it out in silence (a dry run said ₹5.77; the run spent ₹8.94)", () => {
    const without = plan(false);
    expect(without.editInr).toBeCloseTo(plan(true).editInr, 6);
    const text = renderPlan(without);
    expect(text).toMatch(/NOT INCLUDED: the edit-format probe \(--edit-format\) would add up to ₹[\d.]+ for the code and strong candidates/);
    expect(text).toContain(`₹${(without.totalInr + without.editInr).toFixed(2)} in all`);
    // Only the tiers that run it are counted: a plan of tiny alone has nothing to add.
    const tinyOnly = planBakeoff({ ...filtered, candidates: { ...filtered.candidates, code: [], strong: [] } } as never, { fx: 88, tiers: ["tiny"], evalRuns: 1, taskCount: 2, editFormat: false, probesOnly: true, needleTokens: 0 });
    expect(renderPlan(tinyOnly)).not.toContain("NOT INCLUDED");
  });

  it("--estimate is --dry for the bake-off, and prints what --parts and --grid would cost, without running or needing a key", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
    try {
      expect(await runBakeoffCli(["--probes-only", "--estimate"])).toBe(0);
      expect(out.join("\n")).toMatch(/BAKE-OFF PLAN[\s\S]*TOTAL: ₹/);
      out.length = 0;
      expect(await runBakeoffCli(["--parts", "--estimate", "--only", "router"])).toBe(0);
      expect(out.join("\n")).toMatch(/Router: learned routing against a fixed mid tier: about ₹[\d.]+/);
      expect(out.join("\n")).not.toMatch(/extraction|locate bake-off/i);
      out.length = 0;
      expect(await runBakeoffCli(["--grid", "--models", "vendor/plain-x", "--agents", "tailzu", "--estimate"])).toBe(0);
      expect(out.join("\n")).toMatch(/^estimate: about ₹\d+ \(range ₹\d+ to ₹\d+\) for \d+ runs/);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
void cacheDir;
