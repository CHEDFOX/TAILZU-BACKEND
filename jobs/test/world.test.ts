/**
 * The real world (src/world.ts buildWorld) made from the Worker's settings: GitHub's key as the PKCS#1 PEM GitHub hands out, the Browser
 * Rendering renderer, the router with GitHub's computers, the orchestrator in its Worker role, the brain whose builds are Workflows.
 * Stores are in memory (no Supabase here), and nothing reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "../../tulmi/src/config.js";
import { clearSafeFetchForTests, isBlockedAddress, isSafeFetchInstalled } from "../../tulmi/src/web/safeFetch.js";
import { buildWorld, getWorld, setWorldForTests } from "../src/world.js";
import { testEnv, SECRET, uuid } from "./helpers.js";
import type { Env } from "../src/env.js";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function pkcs1Pem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  // The PKCS#1 key is the OCTET STRING at the end of the PKCS#8 wrapper.
  let p = 0;
  const read = () => { const tag = pkcs8[p++]!; let n = pkcs8[p++]!; if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j += 1) n = n * 256 + pkcs8[p++]!; } return { tag, start: p, n }; };
  read();
  const v = read(); p = v.start + v.n;
  const a = read(); p = a.start + a.n;
  const o = read();
  const der = pkcs8.slice(o.start, o.start + o.n);
  return `-----BEGIN RSA PRIVATE KEY-----\n${b64(der).match(/.{1,64}/g)!.join("\n")}\n-----END RSA PRIVATE KEY-----\n`;
}

const KEYS = ["RUNTIME", "OPENROUTER_API_KEY", "DEV_SKIP_AUTH", "NODE_ENV", "CONNECTOR_TOKEN_KEY", "CODE_GITHUB", "CODE_PROJECT_BRAIN", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "WEB_BROWSER", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "PUBLIC_ORIGIN", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } resetConfigForTests(); setWorldForTests(null); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } resetConfigForTests(); clearSafeFetchForTests(); setWorldForTests(null); });

async function workerEnv(more: Record<string, string> = {}): Promise<Env> {
  return {
    ...testEnv, OPENROUTER_API_KEY: "or-test", DEV_SKIP_AUTH: "true", NODE_ENV: "test", CONNECTOR_TOKEN_KEY: b64(new TextEncoder().encode("0123456789abcdef0123456789abcdef")),
    CODE_GITHUB: "true", CODE_PROJECT_BRAIN: "true", GITHUB_APP_SLUG: "tailzu-test", GITHUB_APP_CLIENT_ID: "Iv1.test", GITHUB_APP_CLIENT_SECRET: "client-secret-test",
    GITHUB_APP_PRIVATE_KEY: await pkcs1Pem(), WEB_BROWSER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf-token", PUBLIC_ORIGIN: "https://api.example.test",
    CODE_JOBS_SECRET: SECRET, ...more,
  } as Env;
}

describe("buildWorld", () => {
  it("makes the ports from the Worker's settings, and installs the Worker's guard for every read of the web", async () => {
    const world = await buildWorld(await workerEnv(), { memoryStores: true });
    expect(Object.keys(world).sort()).toEqual(["agent", "brain", "ticker"]);
    expect(isSafeFetchInstalled()).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(true); // the Worker's guard: every address written as an IP is refused
  });

  it("an unknown job is over, with nothing claimed; nothing to tick; no job to nudge; no brain to skip", async () => {
    const world = await buildWorld(await workerEnv(), { memoryStores: true });
    expect(await world.agent.advance(uuid(1), { holder: "wf-1", turns: 2 })).toEqual({ next: "end", why: "over" });
    await world.agent.abandon(uuid(1), "nobody"); // a job that is not there: nothing to end
    expect(await world.ticker.tick()).toEqual({ expired: 0, moved: 0, failed: 0, woken: 0, handedBack: 0 });
    expect(await world.ticker.idle(0, 10)).toEqual([]);
    expect(await world.brain.check({ userId: "alice", projectId: uuid(2), mode: "incremental", headSha: "a".repeat(40) })).toEqual({ skip: false, reason: "" });
  });

  it("will not start without Supabase, and says which settings without saying their values", async () => {
    await expect(buildWorld(await workerEnv())).rejects.toThrow("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set on the Worker.");
  });

  it("will not start without GitHub", async () => {
    await expect(buildWorld(await workerEnv({ GITHUB_APP_PRIVATE_KEY: "" }), { memoryStores: true })).rejects.toThrow("GitHub is not set up on the Worker");
  });

  it("will not start with a GitHub key it cannot read, and never prints it", async () => {
    let msg = "";
    try { await buildWorld(await workerEnv({ GITHUB_APP_PRIVATE_KEY: "nonsense-key-value" }), { memoryStores: true }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("GitHub is not set up on the Worker");
    expect(msg).not.toContain("nonsense-key-value");
  });

  it("a start that failed is not remembered: the next call builds again, and a world that is set is the one given", async () => {
    const bad = await workerEnv({ GITHUB_APP_PRIVATE_KEY: "" });
    await expect(getWorld(bad)).rejects.toThrow();
    await expect(getWorld(bad)).rejects.toThrow();
    resetConfigForTests(); // (a Worker's settings do not change under it; a test's do)
    const fake = await buildWorld(await workerEnv(), { memoryStores: true });
    setWorldForTests(fake);
    expect(await getWorld(bad)).toBe(fake);
  });
});
