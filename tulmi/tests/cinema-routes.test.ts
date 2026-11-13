/**
 * THE CINEMA BOT'S DOORS (src/routes/bots/cinema.ts):
 *
 *   - off (BOTS off, or the bot not switched on): 404 cinema_off, on every door
 *   - the service's refusals are answered as they are (status, code, words)
 *   - approving a price and making a picture ask the plan allowance first
 *   - a photo must be a picture and not too big
 *   - a media link opens only with its signature, and only for a cinema file
 *   - and the bot is among the built-ins only with CINEMA=true
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
});

import { builtinBots, cinemaOn, isBuiltinSlug } from "../src/bots/builtin.js";
import { scoreBots } from "../src/bots/door.js";
import { RESERVED_SLUGS } from "../src/bots/types.js";
import { signMedia } from "../src/cinema/media.js";
import { CinemaError, type CinemaService } from "../src/cinema/service.js";
import { resetConfigForTests } from "../src/config.js";
import { registerCinemaRoutes } from "../src/routes/bots/cinema.js";

function fake() {
  const calls: string[] = [];
  const files = new Map<string, Buffer>([["u/dev-user/cinema/films/f1/still-1.png", Buffer.from("png")]]);
  const s = {
    overview: async (u: string) => { calls.push(`overview:${u}`); return { films: [], pictures: [], cast: [], spentToday: 0, dailyCap: 100 }; },
    create: async (u: string, o: { idea: string; language?: string }) => { calls.push(`create:${u}:${o.idea}:${o.language}`); return { film: { id: "f1", status: "writing" } }; },
    film: async () => { throw new CinemaError(404, "There is no such film.", "not_found"); },
    approveScript: async () => { calls.push("approveScript"); return { film: { id: "f1", status: "boarding" } }; },
    approveBoard: async () => { throw new CinemaError(402, "That is more than one film may cost.", "cinema_film_cap"); },
    picture: async (_u: string, o: { photos: unknown[] }) => { calls.push(`picture:${o.photos.length}`); return { id: "p1", url: "/x" }; },
    file: async (k: string) => files.get(k) ?? null,
  };
  return { service: s as unknown as CinemaService, calls };
}

async function app(o: { bots?: unknown; service?: CinemaService | null; quota?: string | null } = {}) {
  const f = fake();
  const a = Fastify();
  registerCinemaRoutes(a, { rateLimit: {}, bots: o.bots === undefined ? {} : o.bots, service: o.service === undefined ? f.service : o.service, quota: async () => o.quota ?? null });
  await a.ready();
  return { a, calls: f.calls };
}

describe("the cinema bot's doors", () => {
  it("are shut while BOTS is off or the bot is not switched on", async () => {
    for (const o of [{ bots: null }, { service: null }]) {
      const { a } = await app(o);
      for (const [method, url] of [["GET", "/v1/cinema/overview"], ["POST", "/v1/cinema/films"], ["POST", "/v1/cinema/pictures"], ["GET", "/v1/cinema/media/u/x/cinema/a.png"]] as const) {
        const r = await a.inject({ method, url, payload: method === "POST" ? {} : undefined });
        expect(r.statusCode).toBe(404);
        expect(r.json().code).toBe("cinema_off");
      }
    }
  });

  it("start a film as the signed-in person, in their language", async () => {
    const { a, calls } = await app();
    const r = await a.inject({ method: "POST", url: "/v1/cinema/films", payload: { idea: "a chai ad", language: "hi" } });
    expect(r.statusCode).toBe(201);
    expect(calls).toContain("create:dev-user:a chai ad:hi");
  });

  it("answer the service's refusals as they are", async () => {
    const { a } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/cinema/films/nope" })).json()).toEqual({ code: "not_found", message: "There is no such film." });
    const r = await a.inject({ method: "POST", url: "/v1/cinema/films/f1/approve-board" });
    expect(r.statusCode).toBe(402);
    expect(r.json().code).toBe("cinema_film_cap");
  });

  it("ask the plan allowance before agreeing to a price or making a picture", async () => {
    const { a, calls } = await app({ quota: "You've reached this stretch's limit." });
    expect((await a.inject({ method: "POST", url: "/v1/cinema/films/f1/approve-script" })).statusCode).toBe(429);
    expect((await a.inject({ method: "POST", url: "/v1/cinema/pictures", payload: { words: "a poster" } })).statusCode).toBe(429);
    expect(calls).toEqual([]);
  });

  it("take photos as pictures only", async () => {
    const { a, calls } = await app();
    const bad = await a.inject({ method: "POST", url: "/v1/cinema/pictures", payload: { words: "x", photos: [{ type: "text/html", data: "PGI+" }] } });
    expect(bad.statusCode).toBe(400);
    const ok = await a.inject({ method: "POST", url: "/v1/cinema/pictures", payload: { words: "make it night", photos: [{ type: "image/png", data: "iVBORw0KGgo=" }] } });
    expect(ok.statusCode).toBe(201);
    expect(calls).toContain("picture:1");
  });

  it("open a file only with its signature", async () => {
    const { a } = await app();
    const key = "u/dev-user/cinema/films/f1/still-1.png";
    const ok = await a.inject({ method: "GET", url: signMedia(key) });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect(ok.body).toBe("png");
    expect((await a.inject({ method: "GET", url: `/v1/cinema/media/${key}?exp=9999999999999&sig=nope` })).statusCode).toBe(403);
    expect((await a.inject({ method: "GET", url: signMedia(key).replace("still-1", "still-2") })).statusCode).toBe(403);
  });
});

describe("the bot among the built-ins", () => {
  it("is listed only with CINEMA=true, and its slug is kept", () => {
    resetConfigForTests();
    expect(cinemaOn()).toBe(false);
    expect(builtinBots().map((b) => b.slug)).not.toContain("cinema");
    process.env.CINEMA = "true";
    resetConfigForTests();
    expect(cinemaOn()).toBe(true);
    const bot = builtinBots().find((b) => b.slug === "cinema")!;
    expect(bot.colour).toBe("stone");
    expect(bot.purpose.length).toBeLessThanOrEqual(140);
    expect(isBuiltinSlug("cinema")).toBe(true);
    expect(RESERVED_SLUGS).toContain("cinema");
    delete process.env.CINEMA;
    resetConfigForTests();
  });

  it("is what the front door picks for making a film or a picture, in English, Hinglish and Hindi, and nothing else", () => {
    process.env.CINEMA = "true";
    resetConfigForTests();
    const bots = builtinBots();
    const none = { projectId: null, attachments: [], recent: [], mode: "auto" } as unknown as Parameters<typeof scoreBots>[2];
    const top = (m: string) => scoreBots(m, bots, none)[0];
    expect(top("make a 30 second video ad for my chai stall")?.bot.slug).toBe("cinema");
    expect(top("create a poster for our Diwali sale")?.bot.slug).toBe("cinema");
    expect(top("meri dukaan ka video banao")?.bot.slug).toBe("cinema");
    expect(top("मेरी दुकान का वीडियो बनाओ")?.bot.slug).toBe("cinema");
    expect(top("plan my week and block time for deep work")?.bot.slug).not.toBe("cinema");
    expect(top("reply to Neha that I'm running late")?.bot.slug).not.toBe("cinema");
    delete process.env.CINEMA;
    resetConfigForTests();
  });
});
