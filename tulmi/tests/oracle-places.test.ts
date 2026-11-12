/**
 * WHERE THEY WERE BORN (src/oracle/places.ts): Google's suggestions and the picked place's coordinates in one session when a key is set, the
 * server's own geocoder when not or when Google refuses, and neither the key nor anything typed in a log line.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { birthPlaces } = await import("../src/oracle/places.js");

const KEY = ["AIza", "test", "only", "0123456789abcdefghijk"].join("");
const SESSION = "0b6c1d0e-6a0f-4a43-9c1e-6f5b1a2c3d4e";
const MUMBAI = { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" };
const ours = { place: async (q: string) => (/mumbai/i.test(q) ? MUMBAI : null) };

function google(answers: Record<string, unknown>) {
  const urls: URL[] = [];
  const fetchFn = async (input: string) => {
    const u = new URL(input);
    urls.push(u);
    const body = u.pathname.endsWith("/autocomplete/json") ? answers.autocomplete : answers.details;
    return { ok: true, status: 200, json: async () => body };
  };
  return { urls, fetchFn };
}

const AUTOCOMPLETE = {
  status: "OK",
  predictions: [
    { place_id: "ChIJwe1EZjDG5zsRaYxkjY_tpF0", description: "Mumbai, Maharashtra, India", structured_formatting: { main_text: "Mumbai", secondary_text: "Maharashtra, India" } },
    { place_id: "ChIJ2", description: "Mumbra, Maharashtra, India", structured_formatting: { main_text: "Mumbra", secondary_text: "Maharashtra, India" } },
    { place_id: "ChIJ3", description: "Mumbwa, Zambia" },
    { place_id: "ChIJ4", description: "Mumbai Central, Mumbai, India" },
    { place_id: "ChIJ5", description: "Five" },
    { place_id: "ChIJ6", description: "Six, one too many" },
  ],
};

describe("Google's suggestions, with a key", () => {
  it("asks for towns and cities in one session, and shows five at most", async () => {
    const g = google({ autocomplete: AUTOCOMPLETE });
    const p = birthPlaces({ key: KEY, fetchFn: g.fetchFn, finder: ours, log: () => undefined });
    expect(p.google).toBe(true);
    const hits = await p.suggest("  mum ", SESSION);
    expect(hits).toHaveLength(5);
    expect(hits[0]).toEqual({ id: "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0", label: "Mumbai", sub: "Maharashtra, India" });
    expect(hits[2]).toEqual({ id: "g:ChIJ3", label: "Mumbwa", sub: "Zambia" });
    const u = g.urls[0]!;
    expect(u.origin + u.pathname).toBe("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    expect(Object.fromEntries(u.searchParams)).toEqual({ input: "mum", types: "(cities)", language: "en", sessiontoken: SESSION, key: KEY });
  });

  it("finds the picked one's coordinates in the same session", async () => {
    const g = google({ details: { status: "OK", result: { geometry: { location: { lat: 19.076, lng: 72.8777 } }, formatted_address: "Mumbai, Maharashtra, India", name: "Mumbai" } } });
    const p = birthPlaces({ key: KEY, fetchFn: g.fetchFn, finder: ours, log: () => undefined });
    expect(await p.resolve({ id: "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0", label: "Mumbai", session: SESSION })).toEqual({ lat: 19.076, lon: 72.8777, label: "Mumbai, Maharashtra, India" });
    expect(Object.fromEntries(g.urls[0]!.searchParams)).toMatchObject({ place_id: "ChIJwe1EZjDG5zsRaYxkjY_tpF0", fields: "geometry,formatted_address,name", sessiontoken: SESSION });
  });

  it("falls back to the server's own when Google refuses, and logs the refusal once, without the key or the words", async () => {
    const lines: string[] = [];
    const g = google({ autocomplete: { status: "REQUEST_DENIED", error_message: `The provided API key ${KEY} is invalid.` } });
    const p = birthPlaces({ key: KEY, fetchFn: g.fetchFn, finder: ours, log: (l) => lines.push(l) });
    expect(await p.suggest("mumbai", SESSION)).toEqual([{ id: "c:19.0700,72.8700", label: "Mumbai", sub: "Maharashtra, India" }]);
    await p.suggest("mumbai", SESSION);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/REQUEST_DENIED/);
    expect(lines.join(" ")).not.toContain(KEY);
    expect(lines.join(" ")).not.toMatch(/mumbai/i);
  });
});

describe("the server's own, without a key", () => {
  it("suggests its best guess, keeps its coordinates in the id, and finds typed words", async () => {
    const fetchFn = vi.fn();
    const p = birthPlaces({ key: null, fetchFn, finder: ours });
    expect(p.google).toBe(false);
    expect(await p.suggest("m")).toEqual([]);
    const [hit] = await p.suggest("Mumbai");
    expect(hit).toEqual({ id: "c:19.0700,72.8700", label: "Mumbai", sub: "Maharashtra, India" });
    expect(await p.resolve({ id: hit!.id, label: hit!.label })).toEqual({ lat: 19.07, lon: 72.87, label: "Mumbai" });
    expect(await p.resolve({ label: "mumbai" })).toEqual(MUMBAI);
    expect(await p.resolve({ id: "c:999,0", label: "Atlantis" })).toBeNull();
    expect(await p.resolve({ id: "g:ChIJ1", label: "" })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
