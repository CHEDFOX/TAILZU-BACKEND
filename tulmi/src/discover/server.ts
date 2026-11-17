/**
 * THE SERVER'S SIDE OF THE CATALOGUE: the real geocoder, the real researcher, the real photographs.
 *
 *   discover({ call, gateway }) -> Discover      what bots/wire.ts hands to ports.discover
 *
 * src/discover knows nothing about any of these. It declares what it needs (builder.ts BuilderDeps) and this file
 * is the only place the three are named:
 *
 *   resolve   src/places — the same geocoder Plan Ease uses for travel times, so a place resolves once for the
 *             whole server and "hampi" cannot become two cards
 *   research  src/web/research through code/webTools — several pages read and an answer that CITES them; those
 *             citations become the card's sources, which is why the model is never asked for its own
 *   photos    Wikimedia Commons under a free licence (photos.ts)
 *
 * A builder is made per person, because the researcher's limits and budget are theirs. Each is held to BUILD_PAISE
 * for everything together: reading the pages and filling the slots.
 *
 * All three are optional at runtime. No geocoder set, no model, Commons off — a build comes back as words the bot
 * can say, and the written catalogue keeps working regardless.
 */
import type { GatewayDeps } from "../code/brain/gateway.js";
import { makeWebTools } from "../code/webTools.js";
import type { CallFn } from "../code/work/model.js";
import { places } from "../places/index.js";
import { builder, sourcesFrom, type Found } from "./builder.js";
import { Discover } from "./index.js";
import { photosFromConfig } from "./photos.js";

/** One build: the pages read and the slots filled, together. A card costs this once, ever, per place. */
const BUILD_PAISE = 400;
/** Enough pages to disagree with each other, not enough to write an essay. */
const DEPTH = "quick" as const;

const slugOf = (label: string): string =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export interface DiscoverServerOptions {
  call?: CallFn;
  gateway?: GatewayDeps;
}

/**
 * The catalogue, with the builder behind it. One instance for the server: the written places are static and the
 * built ones are in rows, so nothing here is per-request except the builder itself.
 */
export function discoverService(o: DiscoverServerOptions = {}): Discover {
  const call = o.call;
  const pics = photosFromConfig();

  return new Discover({
    makeBuilder: call
      ? (userId: string) =>
          builder({
            userId,
            maxPaise: BUILD_PAISE,
            call,

            async resolve(query) {
              const found = await places().place(query);
              if (!found) return null;
              const label = found.label;
              const slug = slugOf(label);
              if (!slug) return null;
              const where = label;
              const resolved: Found = {
                slug,
                label,
                where,
                country: (found.country ?? "").toLowerCase(),
                at: { lat: found.lat, lon: found.lon },
              };
              return resolved;
            },

            async research(question) {
              const web = makeWebTools({
                userId,
                budget: { maxPaise: BUILD_PAISE },
                call,
                ...(o.gateway ? { gateway: o.gateway } : {}),
              });
              const out = await web.research(question, DEPTH);
              return { answer: out.answer, sources: sourcesFrom(out.sources) };
            },

            ...(pics
              ? {
                  photos: (place: string, want: number) => pics.find(place, { want }),
                }
              : {}),
          })
      : undefined,
  });
}

let one: Discover | null = null;

/** The server's catalogue, made once. */
export function discover(o: DiscoverServerOptions = {}): Discover {
  return (one ??= discoverService(o));
}
