/**
 * Sign in with Apple, ended when the account is (src/auth/appleSignIn.ts): the client secret Apple takes, the one-time code traded and
 * its token kept sealed, and the token revoked at Apple when the account is deleted, never throwing.
 */
import { describe, expect, it } from "vitest";
import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify, decodeProtectedHeader } from "jose";
import { AppleSignIn, appleSiwaConfig, clientSecret, type AppleTokenStore } from "../src/auth/appleSignIn.js";

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { pem: await exportPKCS8(privateKey), spki: await exportSPKI(publicKey) };
}

function memStore(start: Record<string, string> = {}): AppleTokenStore & { rows: Record<string, string> } {
  const rows = { ...start };
  return {
    rows,
    async get(id) { return rows[id] ?? null; },
    async set(id, t) { rows[id] = t; },
    async drop(id) { delete rows[id]; },
  };
}

const seal = { encrypt: (s: string) => `sealed:${s}`, decrypt: (s: string) => s.replace(/^sealed:/, "") };

function fakeApple(answer: { status: number; json?: unknown }) {
  const calls: Array<{ url: string; form: URLSearchParams }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Sign in with Apple's key", () => {
  it("is off without the key id or the key, and takes the .p8 text or that text in base64", async () => {
    const { pem } = await keys();
    const base = { APPLE_SIWA_TEAM_ID: "TEAM123456", APPLE_SIWA_CLIENT_ID: "com.tulmi.app" };
    expect(appleSiwaConfig({ ...base, APPLE_SIWA_KEY_ID: "", APPLE_SIWA_PRIVATE_KEY: pem })).toBeNull();
    expect(appleSiwaConfig({ ...base, APPLE_SIWA_KEY_ID: "KEY1234567", APPLE_SIWA_PRIVATE_KEY: undefined })).toBeNull();
    expect(appleSiwaConfig({ ...base, APPLE_SIWA_KEY_ID: "KEY1234567", APPLE_SIWA_PRIVATE_KEY: "not a key" })).toBeNull();
    const fromB64 = appleSiwaConfig({ ...base, APPLE_SIWA_KEY_ID: "KEY1234567", APPLE_SIWA_PRIVATE_KEY: Buffer.from(pem).toString("base64") });
    const fromText = appleSiwaConfig({ ...base, APPLE_SIWA_KEY_ID: "KEY1234567", APPLE_SIWA_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
    expect(fromB64?.privateKey.trim()).toBe(pem.trim());
    expect(fromText?.privateKey.trim()).toBe(pem.trim());
  });

  it("signs a client secret Apple takes: ES256 with the key id, the team as issuer, the app as subject, minutes long", async () => {
    const { pem, spki } = await keys();
    const now = Date.UTC(2026, 10, 2, 12);
    const jwt = await clientSecret({ teamId: "TEAM123456", keyId: "KEY1234567", clientId: "com.tulmi.app", privateKey: pem }, now);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const { payload } = await jwtVerify(jwt, await importSPKI(spki, "ES256"), { audience: "https://appleid.apple.com", currentDate: new Date(now) });
    expect(payload).toMatchObject({ iss: "TEAM123456", sub: "com.tulmi.app" });
    expect(payload.exp! - payload.iat!).toBe(300);
  });
});

describe("Sign in with Apple, ended when the account is", () => {
  const config = async () => ({ teamId: "TEAM123456", keyId: "KEY1234567", clientId: "com.tulmi.app", privateKey: (await keys()).pem });

  it("trades the phone's one-time code at Apple and keeps the refresh token sealed", async () => {
    const apple = fakeApple({ status: 200, json: { refresh_token: "r-token", access_token: "a", id_token: "i" } });
    const store = memStore();
    const s = new AppleSignIn({ config: await config(), store, fetch: apple.f, seal });
    expect(await s.keepCode("u1", "c-code")).toBe(true);
    expect(apple.calls[0]!.url).toBe("https://appleid.apple.com/auth/token");
    expect(Object.fromEntries(apple.calls[0]!.form)).toMatchObject({ client_id: "com.tulmi.app", code: "c-code", grant_type: "authorization_code" });
    expect(apple.calls[0]!.form.get("client_secret")).toMatch(/^ey/);
    expect(store.rows).toEqual({ u1: "sealed:r-token" });
  });

  it("keeps nothing when Apple will not trade the code (used, expired)", async () => {
    const store = memStore();
    const s = new AppleSignIn({ config: await config(), store, fetch: fakeApple({ status: 400, json: { error: "invalid_grant" } }).f, seal });
    expect(await s.keepCode("u1", "old")).toBe(false);
    expect(store.rows).toEqual({});
  });

  it("revokes the kept token at Apple when the account is deleted, and forgets it", async () => {
    const apple = fakeApple({ status: 200 });
    const store = memStore({ u1: "sealed:r-token" });
    const s = new AppleSignIn({ config: await config(), store, fetch: apple.f, seal });
    expect(await s.forAccountDelete("u1")).toBe(true);
    expect(apple.calls[0]!.url).toBe("https://appleid.apple.com/auth/revoke");
    expect(Object.fromEntries(apple.calls[0]!.form)).toMatchObject({ client_id: "com.tulmi.app", token: "r-token", token_type_hint: "refresh_token" });
    expect(store.rows).toEqual({});
  });

  it("has nothing to revoke for someone who signed in before the code was sent, and never throws", async () => {
    const apple = fakeApple({ status: 200 });
    const s = new AppleSignIn({ config: await config(), store: memStore(), fetch: apple.f, seal });
    expect(await s.forAccountDelete("u1")).toBe(true);
    expect(apple.calls).toHaveLength(0);

    const refused = new AppleSignIn({ config: await config(), store: memStore({ u1: "sealed:r" }), fetch: fakeApple({ status: 500 }).f, seal });
    expect(await refused.forAccountDelete("u1")).toBe(false);
    const broken: AppleTokenStore = { get: async () => { throw new Error("db down"); }, set: async () => {}, drop: async () => {} };
    expect(await new AppleSignIn({ config: await config(), store: broken, fetch: apple.f, seal }).forAccountDelete("u1")).toBe(false);
  });
});
