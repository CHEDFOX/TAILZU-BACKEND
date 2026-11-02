/**
 * IS THE SIGN IN WITH APPLE KEY RIGHT? ONE CALL TO APPLE SAYS (src/auth/appleSignIn.ts).
 *
 *   npx tsx scripts/apple-signin-check.ts
 *   docker compose exec backend node dist/tulmi/scripts/apple-signin-check.js      (on the server)
 *
 * It asks Apple's token endpoint for the app's own token (client_credentials, the user-migration scope), signed with the server's key: Apple
 * gives one only to a client secret it takes, and answers "invalid_client" when the key, its id, the team or the app is wrong. (A one-time
 * code is no test: Apple looks at the code before the key, and says "invalid_grant" to any key, a made-up one too. Measured 2026-11-02.)
 * Prints no key. Exit 0 when the key works, 1 when Apple refused it, 2 when it is not set or Apple could not be asked.
 */
import { appleSiwaConfig, clientSecret } from "../src/auth/appleSignIn.js";

async function main(): Promise<number> {
  const c = appleSiwaConfig();
  if (!c) { console.log("Not set: APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY (the .p8 in base64) are both needed in tulmi/.env."); return 2; }
  let secret: string;
  try { secret = await clientSecret(c); } catch (err) { console.log(`The key could not be read: ${(err as Error).message}. Is APPLE_SIWA_PRIVATE_KEY the whole .p8 file, in base64?`); return 1; }
  const res = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: c.clientId, client_secret: secret, grant_type: "client_credentials", scope: "user.migration" }),
  });
  const body = (await res.json().catch(() => null)) as { error?: string; access_token?: string } | null;
  if (res.ok && body?.access_token) { console.log(`The key works: Apple took it (key ${c.keyId}, team ${c.teamId}, app ${c.clientId}).`); return 0; }
  const error = body?.error ?? `HTTP ${res.status}`;
  if (error === "invalid_client") { console.log(`Apple refused the key: check the Key ID (${c.keyId}), that the key has Sign in with Apple for ${c.clientId}, and the team (${c.teamId}).`); return 1; }
  console.log(`Apple answered ${error}.`); return 2;
}

main().then((code) => process.exit(code), (err) => { console.log(`Could not ask Apple: ${(err as Error)?.message ?? "unknown error"}`); process.exit(2); });
