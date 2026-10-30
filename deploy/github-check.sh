#!/usr/bin/env bash
#
# Check the Code bot's GitHub App from inside the running server, step by step:
# the settings, the App's key (GET /app), its installs, a token for each, the repos
# that token sees, and the installs this server has stored. Prints no secret.
#
#   cd ~/tulmi && ./deploy/github-check.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

docker compose exec -T backend node - <<'JS'
const c = require("node:crypto");
const e = process.env;
const say = (...a) => console.log(...a);
for (const k of ["CODE_GITHUB", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET", "CONNECTOR_TOKEN_KEY"]) {
  const v = e[k] ?? "";
  say(k.padEnd(26), !v ? "MISSING" : ["CODE_GITHUB", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID"].includes(k) ? v : `set (${v.length} chars)`);
}
let key;
try {
  let pem = (e.GITHUB_APP_PRIVATE_KEY ?? "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8").replace(/\\n/g, "\n");
  key = c.createPrivateKey(pem);
  say("private key               reads OK");
} catch (err) { say("private key               BROKEN:", err.message); process.exit(0); }
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const jwt = (iss) => { const h = b({ alg: "RS256", typ: "JWT" }), p = b({ iat: now - 60, exp: now + 540, iss }); return `${h}.${p}.${c.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`; };
const gh = async (method, path, token, body) => {
  const r = await fetch(`https://api.github.com${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "x0-check" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
(async () => {
  const appJwt = jwt(e.GITHUB_APP_CLIENT_ID || e.GITHUB_APP_ID);
  const app = await gh("GET", "/app", appJwt);
  say("\nGitHub /app               ", app.status, app.status === 200 ? `slug=${app.json.slug} owner=${app.json.owner?.login}` : app.json?.message);
  if (app.status === 200) {
    if (app.json.slug !== e.GITHUB_APP_SLUG) say("  !! GITHUB_APP_SLUG should be", app.json.slug);
    say("  permissions", JSON.stringify(app.json.permissions));
  }
  if (app.status !== 200 && e.GITHUB_APP_ID) {
    const byId = await gh("GET", "/app", jwt(e.GITHUB_APP_ID));
    say("  same with GITHUB_APP_ID  ", byId.status, byId.status === 200 ? "works: GITHUB_APP_CLIENT_ID is wrong" : byId.json?.message);
  }
  const inst = await gh("GET", "/app/installations", appJwt);
  say("\ninstalls on GitHub        ", inst.status, Array.isArray(inst.json) ? inst.json.length : inst.json?.message);
  for (const i of Array.isArray(inst.json) ? inst.json : []) {
    say(`  #${i.id} @${i.account?.login} repos=${i.repository_selection} suspended=${!!i.suspended_at}`);
    say("    accepted permissions", JSON.stringify(i.permissions));
    const t = await gh("POST", `/app/installations/${i.id}/access_tokens`, appJwt, { permissions: { metadata: "read" } });
    if (t.status !== 201) { say("    token", t.status, t.json?.message); continue; }
    const r = await gh("GET", "/installation/repositories?per_page=5", t.json.token);
    say("    repos", r.status, r.status === 200 ? `${r.json.total_count}: ${r.json.repositories.map((x) => x.full_name).join(", ")}` : r.json?.message);
  }
  if (e.SUPABASE_URL && e.SUPABASE_SERVICE_KEY) {
    const r = await fetch(`${e.SUPABASE_URL}/rest/v1/code_installations?select=installation_id,account_login,github_login,suspended_at`, { headers: { apikey: e.SUPABASE_SERVICE_KEY, authorization: `Bearer ${e.SUPABASE_SERVICE_KEY}` } });
    const rows = await r.json().catch(() => null);
    say("\ninstalls stored here      ", r.status, Array.isArray(rows) ? rows.map((x) => `#${x.installation_id} @${x.account_login} signedIn=${!!x.github_login} suspended=${!!x.suspended_at}`).join(" | ") || "none" : rows?.message);
  }
})().catch((err) => say("ERROR", err.message));
JS
