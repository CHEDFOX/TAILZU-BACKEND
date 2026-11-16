/**
 * src/discover/builder and src/discover/photos: the pipeline behind a place somebody searched. No network and no
 * model — the geocoder, the researcher, the model and Commons are all handed in.
 *
 *   - the five steps in order, and a card at the end of them with the place the geocoder settled
 *   - the SOURCES on the card are the pages really read, never the ones the model claims
 *   - an unknown place, too little read, and a model that says nothing each come back as words, not a half card
 *   - a place with neither a moment nor a date is refused, however well the model writes
 *   - Commons: a free licence is kept with its credit, a non-free one is dropped, and a card goes out without it
 */
import { describe, expect, it } from "vitest";
import { noNetwork } from "./no-network.js";

const { builder, sourcesFrom } = await import("../src/discover/builder.js");
const { commonsPhotos, parseCommons, photoFrom } = await import("../src/discover/photos.js");
const { CURATED } = await import("../src/discover/catalog.js");

noNetwork();

type Found = import("../src/discover/builder.js").Found;
type Source = import("../src/discover/types.js").Source;

const HAMPI: Found = {
  slug: "hampi",
  label: "Hampi",
  where: "Hampi, Karnataka",
  country: "in",
  at: { lat: 15.335, lon: 76.46 },
};

const READ: { answer: string; sources: Source[] } = {
  answer:
    "Hampi was Vijayanagara, capital of the empire of that name, sacked in 1565. The ruins cover about 16 square miles. Most visitors come between November and February, when it is dry and cooler. Dawn from Matanga Hill is the common advice.",
  sources: [
    { host: "whc.unesco.org", url: "https://whc.unesco.org/en/list/241/", readAt: "2026-11-16" },
    { host: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Hampi", readAt: "2026-11-16" },
  ],
};

const SLOTS = {
  title: "Boulders at dawn, over the Tungabhadra",
  hook: "Granite the size of houses, and a river that moated a capital, best walked at first light.",
  moment: "first light, from Matanga Hill",
  dated: "a capital sacked in 1565",
  story:
    "Until 1565 this was Vijayanagara, the capital of an empire, and the ruins still run for about sixteen square miles. The dry months bring everyone; the hour before the buses do not.",
  tags: ["history", "architecture", "solitude"],
  months: [11, 12, 1, 2],
  budget: "budget",
  effort: 2,
  rarity: 0.4,
  wow: 0.8,
};

/** A model that answers with whatever it is told to, in the shape the gateway gives back. */
const modelSaying = (json: unknown, seen?: { prompt: string[] }) =>
  (async (input: unknown) => {
    const messages = (input as { messages: Array<{ content: string }> }).messages;
    if (seen) seen.prompt = messages.map((m) => m.content);
    return {
      text: "", json, toolCalls: [], model: "fake", promptTokens: 0, completionTokens: 0,
      costUsd: 0, paise: 0, costSource: "estimated" as const,
    };
  }) as never;

const deps = (over: Partial<Parameters<typeof builder>[0]> = {}) =>
  builder({
    resolve: async () => HAMPI,
    research: async () => READ,
    call: modelSaying(SLOTS),
    ...over,
  });

describe("building a card for a searched place", () => {
  it("resolves, reads, fills and keeps — filed under the place the geocoder settled", async () => {
    const built = await deps().build("hampi", { userId: "user_1" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.card.slug).toBe("hampi");
    expect(built.card.where).toBe("Hampi, Karnataka");
    expect(built.card.country).toBe("in");
    expect(built.card.origin).toBe("built");
    expect(built.card.forUserId).toBe("user_1");
    expect(built.card.title).toBe(SLOTS.title);
  });

  it("gives the model the pages that were read, and nothing about the person", async () => {
    const seen = { prompt: [] as string[] };
    await builder({ resolve: async () => HAMPI, research: async () => READ, call: modelSaying(SLOTS, seen) })
      .build("hampi", { userId: "user_private" });
    const whole = seen.prompt.join("\n");
    expect(whole).toContain("sacked in 1565");
    expect(whole).not.toContain("user_private");
  });

  it("takes the sources from the pages really read, not from the model", async () => {
    const lying = { ...SLOTS, sources: [{ url: "https://invented.example/hampi", readAt: "2026-11-16" }] };
    const built = await deps({ call: modelSaying(lying) }).build("hampi", { userId: "user_1" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.card.sources.map((s) => s.host)).toEqual(["whc.unesco.org", "en.wikipedia.org"]);
  });

  it("says so plainly when the place is not a place", async () => {
    const built = await deps({ resolve: async () => null }).build("asdfgh", { userId: "user_1" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built).toMatchObject({ reason: "unknown_place" });
    expect(built.why).toContain("asdfgh");
  });

  it("refuses to write from one page", async () => {
    const built = await deps({ research: async () => ({ answer: "A bit.", sources: [READ.sources[0]!] }) })
      .build("hampi", { userId: "user_1" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built).toMatchObject({ reason: "no_reading" });
  });

  it("comes back with words, not a half card, when the model says nothing usable", async () => {
    const built = await deps({ call: modelSaying(undefined) }).build("hampi", { userId: "user_1" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built).toMatchObject({ reason: "no_answer" });
  });

  it("refuses a place with neither a moment nor a date, however well written", async () => {
    const dull = { ...SLOTS, moment: "", dated: null, title: "The streets of Whitefield", hook: "A large district on the east side of the city, with offices and malls on every road." };
    const built = await deps({ call: modelSaying(dull) }).build("whitefield", { userId: "user_1" });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.why).toMatch(/neither a moment nor a date/);
  });

  it("will not repeat a place of the same kind in the same country", async () => {
    const twin = { ...CURATED[0]!, slug: "other", country: "in", tags: ["history", "architecture"] as never };
    const built = await deps().build("hampi", { userId: "user_1", against: [twin] });
    expect(built.ok).toBe(false);
  });

  it("puts photographs on the card, and still makes one when there are none", async () => {
    const withPics = await deps({ photos: async () => [{ url: "https://upload.example/a.jpg", alt: "a", credit: "Wikimedia Commons · CC BY-SA 4.0 · Someone" }] })
      .build("hampi", { userId: "user_1" });
    expect(withPics.ok && withPics.card.photos).toHaveLength(1);

    const broken = await deps({ photos: async () => { throw new Error("commons down"); } }).build("hampi", { userId: "user_1" });
    expect(broken.ok).toBe(true);
    if (!broken.ok) return;
    expect(broken.card.photos).toEqual([]);
  });
});

describe("sources, from what was read", () => {
  it("keeps the cited pages, one to a host, with the day they were read", () => {
    const out = sourcesFrom([
      { url: "https://www.example.org/a", fetchedAt: Date.UTC(2026, 10, 16, 9), cited: true },
      { url: "https://example.org/b", fetchedAt: Date.UTC(2026, 10, 16, 9), cited: true },
      { url: "https://other.org/c", fetchedAt: Date.UTC(2026, 10, 16, 9), cited: false },
    ]);
    expect(out).toEqual([{ host: "example.org", url: "https://www.example.org/a", readAt: "2026-11-16" }]);
  });

  it("drops anything that is not a web page", () => {
    expect(sourcesFrom([{ url: "file:///etc/passwd", fetchedAt: 0, cited: true }])).toEqual([]);
  });
});

describe("photographs from Commons", () => {
  const page = (licence: string, extra: Record<string, unknown> = {}) => ({
    title: "File:Hampi Virupaksha temple.jpg",
    index: 1,
    imageinfo: [{
      thumburl: "https://upload.wikimedia.org/thumb/hampi.jpg",
      thumbwidth: 1600,
      thumbheight: 1067,
      extmetadata: {
        LicenseShortName: { value: licence },
        Artist: { value: '<a href="/wiki/User:X">A Photographer</a>' },
        ImageDescription: { value: "The Virupaksha temple at dawn" },
      },
      ...extra,
    }],
  });

  it("keeps a free licence, with a credit built from the file's own metadata", () => {
    const photo = photoFrom(page("CC BY-SA 4.0"), "Hampi");
    expect(photo).toEqual({
      url: "https://upload.wikimedia.org/thumb/hampi.jpg",
      alt: "The Virupaksha temple at dawn",
      credit: "Wikimedia Commons · CC BY-SA 4.0 · A Photographer",
      width: 1600,
      height: 1067,
    });
  });

  it("keeps public domain and CC0", () => {
    expect(photoFrom(page("Public domain"), "Hampi")).toBeTruthy();
    expect(photoFrom(page("CC0"), "Hampi")).toBeTruthy();
  });

  it("drops what we may not show, rather than showing it uncredited", () => {
    expect(photoFrom(page("Fair use"), "Hampi")).toBeNull();
    expect(photoFrom(page("Non-free"), "Hampi")).toBeNull();
    expect(photoFrom(page(""), "Hampi")).toBeNull();
  });

  it("reads a whole answer in the order Commons ranked it, without repeats", () => {
    const body = { query: { pages: { "2": { ...page("CC BY 2.0"), index: 2 }, "1": page("CC0") } } };
    const out = parseCommons(body, "Hampi");
    expect(out).toHaveLength(1); // same thumburl in both: kept once
    expect(out[0]?.credit).toContain("CC0");
  });

  it("asks Commons for files, at a width we can show, and says who we are", async () => {
    const calls: Array<{ url: string; ua: string }> = [];
    const source = commonsPhotos({
      fetch: (async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url, ua: headers["user-agent"] ?? headers["User-Agent"] ?? "" });
        return { ok: true, status: 200, json: async () => ({ query: { pages: { "1": page("CC BY-SA 4.0") } } }) } as unknown as Response;
      }),
    });
    const out = await source.find("Hampi", { want: 3 });
    expect(out).toHaveLength(1);
    const asked = calls[0]!;
    expect(asked.url).toContain("gsrsearch=Hampi");
    expect(asked.url).toContain("gsrnamespace=6");
    expect(asked.url).toContain("iiurlwidth=1600");
    expect(asked.ua).toMatch(/^Tailzu\/1\.0/);
  });
});
