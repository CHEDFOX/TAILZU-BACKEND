/**
 * TAILZU'S PUBLISHED OAUTH CLIENT: GET /oauth/client-metadata.json
 *
 * A client ID metadata document (CIMD, in the MCP spec 2026-07-28). Its own
 * address is Tailzu's client id: an app's auth server that supports it, asked
 * to sign someone in for "https://api.x0bot.com/oauth/client-metadata.json",
 * fetches this page to learn who that is and where it may send them back,
 * instead of us registering a fresh client with every app (oauth.ts).
 *
 * Built from the config, so it cannot drift from what the sign-in sends:
 *   client_id      CONNECTOR_CLIENT_METADATA_URL, exactly (the spec requires it)
 *   redirect_uris  [CONNECTOR_REDIRECT_URL], exactly: auth servers compare it as a string
 *   token_endpoint_auth_method "none": a public client, PKCE instead of a secret
 * Served with a 200, never a redirect, and cacheable for a day: auth servers
 * keep it. With CONNECTOR_CLIENT_METADATA_URL set to "" there is no document.
 *
 * THE ADDRESS IT HAD BEFORE x0bot.com (src/domains.ts): asked for at the same
 * path on api.tailzu.space, the document names that address as its client id,
 * with that host's callback. A sign-in made under the old id is refreshed by
 * the app reading the old document again, and a document whose client_id is
 * not the URL it was read from is refused. A new sign-in uses the new id.
 * Public, no session: there is nothing secret in it.
 */
import type { FastifyInstance } from "fastify";
import { legacyTwin, SITE_ORIGIN } from "../domains.js";

export const CLIENT_METADATA_PATH = "/oauth/client-metadata.json";

export interface ClientMetadataDeps {
  /** CONNECTOR_CLIENT_METADATA_URL; empty means none is published. */
  clientMetadataUrl: string;
  /** CONNECTOR_REDIRECT_URL. */
  redirectUrl: string;
  rateLimit?: { rateLimit: { max: number; timeWindow: number } };
}

/** The document itself. */
export function clientMetadataDocument(d: Pick<ClientMetadataDeps, "clientMetadataUrl" | "redirectUrl">) {
  return {
    client_id: d.clientMetadataUrl,
    client_name: "X0 Bot",
    client_uri: SITE_ORIGIN,
    redirect_uris: [d.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function registerOAuthClientMetadataRoute(app: FastifyInstance, deps: ClientMetadataDeps): void {
  const body = deps.clientMetadataUrl ? JSON.stringify(clientMetadataDocument(deps)) : null;
  const old = body ? legacyTwin(deps.clientMetadataUrl) : undefined;
  const oldRedirect = legacyTwin(deps.redirectUrl);
  const oldHost = old ? new URL(old).hostname : "";
  const oldBody = old && oldRedirect ? JSON.stringify(clientMetadataDocument({ clientMetadataUrl: old, redirectUrl: oldRedirect })) : null;
  app.get(CLIENT_METADATA_PATH, deps.rateLimit ? { config: deps.rateLimit } : {}, async (req, reply) => {
    if (!body) return reply.code(404).send({ code: "not_found", message: "No client document is published here." });
    const host = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
    return reply
      .header("content-type", "application/json")
      .header("cache-control", "public, max-age=86400")
      .send(oldBody && host === oldHost ? oldBody : body);
  });
}
