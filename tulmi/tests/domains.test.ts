/**
 * THE MOVE TO x0bot.com (src/domains.ts, docs/domain-x0bot.md): everything new is built on x0bot.com, and what the apps
 * already installed still send on tailzu.space is accepted.
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { API_ORIGIN, APP_LINK_ORIGIN, isOurPayPage, isSitePage, legacyTwin, SITE_ORIGIN, SITE_ORIGINS } from "../src/domains.js";
import { registerOAuthClientMetadataRoute } from "../src/routes/oauthClientMetadata.js";
import { madeForAnotherAddress } from "../src/connectors/oauth.js";

describe("our addresses", () => {
  it("are on x0bot.com", () => {
    expect([SITE_ORIGIN, API_ORIGIN, APP_LINK_ORIGIN]).toEqual(["https://x0bot.com", "https://api.x0bot.com", "https://app.x0bot.com"]);
    expect(SITE_ORIGINS).toEqual(["https://x0bot.com", "https://www.x0bot.com", "https://tailzu.space", "https://www.tailzu.space"]);
  });

  it("a page of the site is one on either domain, apex or www, https only", () => {
    for (const ok of ["https://x0bot.com/", "https://x0bot.com", "https://www.x0bot.com/download", "https://tailzu.space/pay?x=1", "https://www.tailzu.space/"]) {
      expect(isSitePage(ok), ok).toBe(true);
    }
    for (const bad of ["http://x0bot.com/", "https://api.x0bot.com/", "https://x0bot.com.evil.example/", "https://evilx0bot.com/", "https://x0bot.community/", "https://x0bot.com/a b"]) {
      expect(isSitePage(bad), bad).toBe(false);
    }
  });

  it("the pay page is ours on either domain (the env may still name the old one)", () => {
    expect(isOurPayPage("https://x0bot.com/pay")).toBe(true);
    expect(isOurPayPage("https://tailzu.space/pay")).toBe(true);
    expect(isOurPayPage("https://pay.rev.cat/abc")).toBe(false);
    expect(isOurPayPage(undefined)).toBe(false);
  });

  it("an address on x0bot.com has a twin on tailzu.space; anything else has none", () => {
    expect(legacyTwin("https://api.x0bot.com/oauth/client-metadata.json")).toBe("https://api.tailzu.space/oauth/client-metadata.json");
    expect(legacyTwin("https://x0bot.com/pay")).toBe("https://tailzu.space/pay");
    expect(legacyTwin("https://api.tailzu.space/x")).toBeUndefined();
    expect(legacyTwin("https://evilx0bot.com/x")).toBeUndefined();
    expect(legacyTwin("not a url")).toBeUndefined();
  });
});

describe("the connectors' client document, at both addresses", () => {
  const CIMD = "https://api.x0bot.com/oauth/client-metadata.json";
  const REDIRECT = "https://api.x0bot.com/v1/connectors/callback";
  const doc = async (host: string) => {
    const app = Fastify();
    registerOAuthClientMetadataRoute(app, { clientMetadataUrl: CIMD, redirectUrl: REDIRECT });
    const res = await app.inject({ method: "GET", url: "/oauth/client-metadata.json", headers: { host } });
    await app.close();
    return res.json() as { client_id: string; redirect_uris: string[]; client_uri: string };
  };

  it("names itself by the address it is read at: a sign-in made under the old id refreshes against the old document", async () => {
    expect(await doc("api.x0bot.com")).toMatchObject({ client_id: CIMD, redirect_uris: [REDIRECT], client_uri: "https://x0bot.com" });
    expect(await doc("api.tailzu.space")).toMatchObject({
      client_id: "https://api.tailzu.space/oauth/client-metadata.json", redirect_uris: ["https://api.tailzu.space/v1/connectors/callback"],
    });
    expect(await doc("API.TAILZU.SPACE:443")).toMatchObject({ client_id: "https://api.tailzu.space/oauth/client-metadata.json" });
    expect((await doc("127.0.0.1:8770")).client_id).toBe(CIMD);
  });

  it("a client kept from the old address is let go at the next sign-in; one made for this address is kept", () => {
    const now = { redirect: REDIRECT, cimd: CIMD };
    expect(madeForAnotherAddress(undefined, now.redirect, now.cimd)).toBe(false);
    // Registered (dynamic registration echoes the redirects it was made with).
    expect(madeForAnotherAddress({ client_id: "abc", redirect_uris: ["https://api.tailzu.space/v1/connectors/callback"] } as never, now.redirect, now.cimd)).toBe(true);
    expect(madeForAnotherAddress({ client_id: "abc", redirect_uris: [REDIRECT] } as never, now.redirect, now.cimd)).toBe(false);
    // Our client document: the id is its URL.
    expect(madeForAnotherAddress({ client_id: "https://api.tailzu.space/oauth/client-metadata.json" }, now.redirect, now.cimd)).toBe(true);
    expect(madeForAnotherAddress({ client_id: CIMD }, now.redirect, now.cimd)).toBe(false);
    // A registered id that is no URL, with no redirects to judge by, is kept.
    expect(madeForAnotherAddress({ client_id: "abc" }, now.redirect, now.cimd)).toBe(false);
  });
});
