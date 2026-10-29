/**
 * THE WIRING, END TO END: every Bots screen, on the phone and on the computer, built with sample data and every
 * capability on, and every button in it followed. A button that opens a screen must open one that exists (not the
 * "coming soon" page), and a call to the server must reach a route the server has (not Fastify's "Route … not found").
 *
 * Twice over: once with no answers to the screens' own reads (the empty states), and once with the render check's samples
 * (scripts/bots-render/samples: every screen as its boards draw it), since most buttons are only drawn once there is
 * something to press. And each client is sent only actions it can run: an action the other app alone handles does
 * nothing at all where it lands (the window's Paste was exactly that, readClipboard with no handler).
 */
// A route that exists answers anything but Fastify's "Route … not found" (most refuse the empty body); test keys only.
process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { BOTS_SCREENS, buildBotsScreen } from "../src/experience/bots/index.js";
import { IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { SAMPLES, apiFor } from "../scripts/bots-render/samples/index.js";

const ALL = { has: () => true } as unknown as Set<string>;

/** Every action anywhere in a tree: anything with a `kind`, in props, actions, then/else, seq lists… */
function actions(root: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string") out.push(o);
    for (const x of Object.values(o)) visit(x);
  };
  visit(root);
  return out;
}

/**
 * Actions only one app runs (TAILZU-FRONTEND/app/src/sdui/actions.ts, TAILZU-DESKTOP/sdui.js `run`): sent to the other, they do nothing.
 * The window's own: its clipboard (copyText), dictation, its settings and recorder, its connect flow. The phone's: Settings, the mic into
 * a field, its clipboard (copyToClipboard), Face ID, the share sheet, the permissions it asks for, a setting kept on the phone.
 */
const ONLY: Record<"phone" | "desktop", ReadonlySet<string>> = {
  desktop: new Set(["copyText", "dictate", "desktop.config", "notes.toggle", "connector.connect", "ask.picturesAll"]),
  phone: new Set(["openSettings", "recordVoice", "copyToClipboard", "biometricPrompt", "share", "checkPermission", "requestPushPermission", "devicePref"]),
};

/** A path as the server would see it: template parts ($state.x, {x}) become a plain segment. */
const concrete = (p: string): string => p.replace(/\$[a-zA-Z_][\w.[\]]*/g, "x").replace(/\{[^}]+\}/g, "x").split("?")[0]!;

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); }, 60_000);
afterAll(async () => { await app?.close(); });

describe("the wiring", () => {
  it("every screen's buttons open screens that exist and call routes the server has", async () => {
    const missingScreens = new Map<string, Set<string>>();
    const missingRoutes = new Map<string, Set<string>>();
    const calls = new Map<string, Set<string>>();
    // Every screen with no answers to its own reads, then every sample with the answers that draw it.
    type Build = { id: string; params?: Record<string, string | number | boolean>; deskParams?: Record<string, string | number | boolean>; deps: () => Promise<ReturnType<typeof fakeDeps>> };
    const builds: Build[] = [
      ...[...BOTS_SCREENS.keys()].map((id) => ({ id, deps: async () => fakeDeps() })),
      ...SAMPLES.map((x) => ({ id: x.id, params: x.params, deskParams: x.deskParams, deps: async () => fakeDeps({ ...(x.fake ?? {}), api: await apiFor(x) }) })),
    ];
    for (const { id, params, deskParams, deps } of builds) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await buildBotsScreen({
          screenId: id, client, params: client === "desktop" ? deskParams ?? params : params, tzOffsetMinutes: IST, user: { id: "11111111-2222-3333-4444-555555555555", name: "Aanya Rao", email: "aanya@example.in" },
          can: ALL, desk: { pages: client === "desktop", notes: true },
        }, await deps()).catch((e: Error) => { throw new Error(`${id} (${client}) failed to build: ${e.message}`); });
        for (const a of actions(s)) {
          // An action only the other app runs must never be sent to this one.
          const other = client === "desktop" ? "phone" : "desktop";
          if (ONLY[other].has(String(a.kind))) {
            (missingScreens.get(`${client} cannot ${a.kind}`) ?? missingScreens.set(`${client} cannot ${a.kind}`, new Set()).get(`${client} cannot ${a.kind}`)!).add(id);
          }
          if (a.kind === "navigate" && typeof a.screenId === "string" && a.screenId.startsWith("bots.") && !a.screenId.includes("$")) {
            if (!BOTS_SCREENS.has(a.screenId)) (missingScreens.get(a.screenId) ?? missingScreens.set(a.screenId, new Set()).get(a.screenId)!).add(`${id} (${client})`);
          }
          if (a.kind === "callEndpoint" && typeof a.path === "string") {
            const key = `${String(a.method ?? "GET").toUpperCase()} ${concrete(a.path)}`;
            (calls.get(key) ?? calls.set(key, new Set()).get(key)!).add(`${id} (${client})`);
          }
        }
      }
    }
    for (const [key, from] of calls) {
      const [method, url] = key.split(" ") as [string, string];
      const r = await app.inject({ method: method as "GET", url, ...(method === "GET" ? {} : { payload: {} }) });
      if (r.statusCode === 404 && /Route .* not found/.test(r.body)) missingRoutes.set(key, from);
    }
    const show = (m: Map<string, Set<string>>) => [...m].map(([k, v]) => `${k}  ← ${[...v].slice(0, 3).join(", ")}${v.size > 3 ? ` (+${v.size - 3})` : ""}`);
    expect(calls.size).toBeGreaterThan(10);
    // The check itself can fail: an address nobody serves is caught.
    const none = await app.inject({ method: "POST", url: "/v1/no-such-route", payload: {} });
    expect(none.statusCode === 404 && /Route .* not found/.test(none.body)).toBe(true);
    expect({ missingScreens: show(missingScreens), missingRoutes: show(missingRoutes) }).toEqual({ missingScreens: [], missingRoutes: [] });
  }, 240_000);
});
