/**
 * THE NAME GOOGLE OR APPLE SENT IS SAVED ON THE ACCOUNT AS IT IS ONBOARDED (routes/bots/botsFirstRun.ts providerNameToSave):
 * through PUT /v1/profile { onboarded: true } and the Bots app's own mark at boot (routes/app/appScreens.ts). Never a guess from
 * an email, never over a name already saved, and theirs to change afterwards with PUT /v1/profile { full_name }.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// Each bearer names a sign-in: "google-u1" is user u1 signed in with Google, who sent "Aanya Rao", and so on.
const SIGNINS: Record<string, { provider: string; providerName?: string; email?: string; phone?: string }> = {
  google: { provider: "google", providerName: "Aanya Rao", email: "aanya@gmail.com" },
  apple: { provider: "apple", providerName: "Rohan Mehta", email: "x7@privaterelay.appleid.com" },
  applenone: { provider: "apple", email: "x8@privaterelay.appleid.com" },
  email: { provider: "email", email: "priya.sharma@example.in" },
  phone: { provider: "phone", phone: "+919800000000" },
};
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const token = h?.replace(/^Bearer\s+/i, "").trim() ?? "";
      const [kind, id] = token.split("-");
      return kind && id && SIGNINS[kind] ? { id: `${kind}-${id}`, ...SIGNINS[kind] } : null;
    },
  };
});

const { registerProfileRoutes } = await import("../src/routes/account/profile.js");
const { providerNameToSave } = await import("../src/routes/bots/botsFirstRun.js");

function app() {
  const a = Fastify();
  registerProfileRoutes(a, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, appleSignIn: null });
  return a;
}
const put = (a: ReturnType<typeof app>, who: string, payload: Record<string, unknown>) =>
  a.inject({ method: "PUT", url: "/v1/profile", headers: { authorization: `Bearer ${who}` }, payload });
const get = async (a: ReturnType<typeof app>, who: string) => (await a.inject({ method: "GET", url: "/v1/profile", headers: { authorization: `Bearer ${who}` } })).json();

describe("the name Google or Apple sent", () => {
  it("is saved on the account as it is onboarded", async () => {
    const a = app();
    expect((await put(a, "google-1", { onboarded: true })).statusCode).toBe(200);
    expect(await get(a, "google-1")).toMatchObject({ onboarded: true, fullName: "Aanya Rao" });
    await put(a, "apple-1", { onboarded: true });
    expect(await get(a, "apple-1")).toMatchObject({ fullName: "Rohan Mehta" });
  });
  it("is theirs to change afterwards, and onboarding again never puts it back", async () => {
    const a = app();
    await put(a, "google-2", { onboarded: true });
    await put(a, "google-2", { full_name: "Aanya" });
    expect(await get(a, "google-2")).toMatchObject({ fullName: "Aanya" });
    await put(a, "google-2", { onboarded: true });
    expect(await get(a, "google-2")).toMatchObject({ fullName: "Aanya" });
  });
  it("never overwrites a name already saved, or one sent with the same write", async () => {
    const a = app();
    await put(a, "apple-3", { full_name: "Ro" });
    await put(a, "apple-3", { onboarded: true });
    expect(await get(a, "apple-3")).toMatchObject({ fullName: "Ro" });
    await put(a, "google-3", { onboarded: true, full_name: "A. Rao" });
    expect(await get(a, "google-3")).toMatchObject({ fullName: "A. Rao" });
  });
  it("is nothing for an email or phone sign-in, or an Apple one that sent no name: no guess is saved", async () => {
    const a = app();
    for (const who of ["email-4", "phone-4", "applenone-4"]) {
      await put(a, who, { onboarded: true });
      expect((await get(a, who)).fullName ?? "", who).toBe("");
    }
    expect(providerNameToSave({ provider: "email", email: "priya.sharma@example.in" })).toBeUndefined();
    expect(providerNameToSave({ provider: "google", providerName: "  Aanya Rao  " })).toBe("Aanya Rao");
    expect(providerNameToSave({ provider: "google", providerName: "Aanya Rao" }, "Saved")).toBeUndefined();
  });
});
