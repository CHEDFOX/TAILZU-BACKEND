/**
 * THE EMERGENCY STOP FOR "SIGN IN WITH GITHUB": revoke every stored token.
 *
 * A signed-in person's GitHub token reaches all of their repos (code/oauth.ts).
 * If it is ever in doubt, say the encryption key may have leaked or the code
 * that uses it has a bug, run this. Every stored token is revoked at GitHub
 * (DELETE /applications/{client_id}/token), then dropped from the database, and
 * each person's link is marked "needs_signin": they sign in again once it is
 * safe. Nothing else is touched: projects and branches stay.
 *
 *   npx tsx scripts/revoke-github-oauth.ts
 *
 * In the production container (tsx is not installed there; the script is
 * compiled with the server):
 *
 *   docker compose exec backend node dist/tulmi/scripts/revoke-github-oauth.js
 *
 * It needs the same environment as the server: SUPABASE_URL and
 * SUPABASE_SERVICE_KEY (the tokens are in the database), CONNECTOR_TOKEN_KEY
 * (to open them), GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (to
 * revoke them). It works whatever CODE_GITHUB_OAUTH says: to switch the
 * sign-in off so that no stored token is ever used again, set
 * CODE_GITHUB_OAUTH=false and restart, which is a separate step.
 *
 * It prints how many were revoked and how many GitHub would not revoke (those
 * are kept, unusable, so that running it again tries them again). Exit code 0
 * when every token is gone, 1 when some could not be revoked, 2 when it can't
 * run. It never prints a token.
 */
import { getConfig } from "../src/config.js";
import { createCode } from "../src/code/index.js";

async function main(): Promise<number> {
  const cfg = getConfig();
  if (!cfg.supabaseEnabled) {
    console.error("No database is configured (SUPABASE_URL / SUPABASE_SERVICE_KEY), so there are no stored tokens to revoke.");
    return 2;
  }
  const code = createCode();
  if (!code.oauth) {
    console.error("GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET are not set: GitHub can't be told to revoke anything.");
    return 2;
  }
  const { revoked, failed } = await code.oauth.revokeAll();
  console.log(`GitHub sign-in tokens revoked: ${revoked}. GitHub would not revoke: ${failed}.`);
  if (failed) console.log("Those links are unusable; run this again to try them again.");
  return failed ? 1 : 0;
}

main().then((c) => process.exit(c), (err) => {
  console.error("Could not revoke:", (err as Error)?.message ?? "unknown error");
  process.exit(2);
});
