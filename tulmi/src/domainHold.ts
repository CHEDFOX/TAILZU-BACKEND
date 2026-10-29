/**
 * UNTIL THE MOVE IS DONE ON THE SERVER, IT KEEPS ITS OLD ADDRESSES.
 *
 * The code's defaults are on x0bot.com (domains.ts). A production server whose .env does not put it there yet
 * (docs/domain-x0bot.md step 9: PUBLIC_ORIGIN=https://api.x0bot.com and the rest) keeps answering as it did, on
 * tailzu.space, so a deploy before the new names have DNS and a certificate breaks no sign-in, link or image. Once
 * step 9 is done this changes nothing. Imported first by server.ts, before anything reads the environment.
 */
const HOLD: Record<string, string> = {
  PUBLIC_ORIGIN: "https://api.tailzu.space",
  DEVICE_LINK_ORIGIN: "https://app.tailzu.space",
  CONNECTOR_REDIRECT_URL: "https://api.tailzu.space/v1/connectors/callback",
  CONNECTOR_CLIENT_METADATA_URL: "https://api.tailzu.space/oauth/client-metadata.json",
};

if (process.env.NODE_ENV === "production" && !/x0bot\.com/.test(process.env.PUBLIC_ORIGIN ?? "")) {
  for (const [k, v] of Object.entries(HOLD)) if (!process.env[k]) process.env[k] = v;
}

export {};
