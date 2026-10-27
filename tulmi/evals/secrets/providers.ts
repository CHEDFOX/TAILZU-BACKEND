/**
 * Forty providers' fake tokens for the secret-scan tests (tests/code-secrets-gitleaks.test.ts) and benchmark (evals/secrets/run.ts).
 *
 * NO TOKEN IS WRITTEN IN THIS FILE. Each is made when asked for: a short prefix (the part that tells a scanner what it is looking at, never longer than
 * a dozen characters) and a body drawn from a seeded shuffle of the alphabet the provider's tokens use, so that the body has about as much entropy as a
 * real one and a scanner reading this source finds nothing. The same seed gives the same tokens on every run.
 */

let seed = 20261027;
export const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ALPHA = {
  alnum: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  lower: "abcdefghijklmnopqrstuvwxyz",
  lowerDigits: "abcdefghijklmnopqrstuvwxyz0123456789",
  hex: "0123456789abcdef",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  upperDigits: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  digits: "0123456789",
  b32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  word: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
  b64: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/",
  bech: "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L",
};
/** `n` characters of `alphabet`, each shuffle of it used whole before the next starts, so the text has about as much entropy as the alphabet allows. */
function deck(alphabet: string, n: number): string {
  let out = "";
  while (out.length < n) {
    const s = [...alphabet];
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [s[i], s[j]] = [s[j]!, s[i]!]; }
    out += s.join("");
  }
  return out.slice(0, n);
}
export const D = (a: keyof typeof ALPHA, n: number): string => deck(ALPHA[a], n);

export interface Provider { name: string; kind: string; rule: string; make: () => string; path?: string }
export const PROVIDERS: Provider[] = [
  { name: "AWS access key", kind: "an AWS access key", rule: "aws-access-token", make: () => "AKIA" + D("b32", 16) },
  { name: "GitHub personal access token", kind: "a GitHub token", rule: "github-pat", make: () => "ghp_" + D("alnum", 36) },
  { name: "GitLab personal access token", kind: "a GitLab token", rule: "gitlab-pat", make: () => "glpat-" + D("word", 20) },
  { name: "GitLab runner token", kind: "a GitLab token", rule: "gitlab-runner-authentication-token", make: () => "glrt-" + D("word", 20) },
  { name: "Slack bot token", kind: "a Slack token", rule: "slack-bot-token", make: () => "xoxb-" + D("digits", 11) + "-" + D("digits", 12) + "-" + D("alnum", 24) },
  { name: "Slack app token", kind: "a Slack token", rule: "slack-app-token", make: () => "xapp-1-" + D("upperDigits", 11) + "-" + D("digits", 13) + "-" + D("hex", 64) },
  { name: "Slack webhook", kind: "a Slack webhook address", rule: "slack-webhook-url", make: () => "https://hooks.slack.com/services/T" + D("upper", 10) + "/B" + D("upper", 10) + "/" + D("alnum", 24) },
  { name: "Stripe live key", kind: "a Stripe key", rule: "stripe-access-token", make: () => "sk_live_" + D("alnum", 30) },
  { name: "Google API key", kind: "a Google API key", rule: "gcp-api-key", make: () => "AIza" + D("word", 35) },
  { name: "OpenAI key", kind: "a model API key", rule: "openai-api-key", make: () => "sk-proj-" + D("word", 58) + "T3BlbkFJ" + D("word", 58) },
  { name: "Anthropic key", kind: "a model API key", rule: "anthropic-api-key", make: () => "sk-ant-api03-" + D("word", 93) + "AA" },
  { name: "SendGrid key", kind: "a SendGrid API token", rule: "sendgrid-api-token", make: () => "SG." + D("word", 22) + "." + D("word", 43) },
  { name: "Twilio key", kind: "a Twilio API key", rule: "twilio-api-key", make: () => "SK" + D("hex", 32) },
  { name: "Shopify access token", kind: "a Shopify token", rule: "shopify-access-token", make: () => "shpat_" + D("hex", 32) },
  { name: "npm token", kind: "an npm access token", rule: "npm-access-token", make: () => "npm_" + D("lowerDigits", 36) },
  { name: "PyPI upload token", kind: "a PyPI upload token", rule: "pypi-upload-token", make: () => "pypi-AgEIcHlwaS5vcmc" + D("word", 60) },
  { name: "Hugging Face token", kind: "a Hugging Face access token", rule: "huggingface-access-token", make: () => "hf_" + D("lower", 34) },
  { name: "DigitalOcean token", kind: "a DigitalOcean token", rule: "digitalocean-pat", make: () => "dop_v1_" + D("hex", 64) },
  { name: "Heroku key", kind: "a Heroku API key v2", rule: "heroku-api-key-v2", make: () => "HRKU-AA" + D("word", 58) },
  { name: "Databricks token", kind: "a Databricks API token", rule: "databricks-api-token", make: () => "dapi" + D("hex", 32) },
  { name: "Linear key", kind: "a Linear API key", rule: "linear-api-key", make: () => "lin_api_" + D("alnum", 40) },
  { name: "Postman key", kind: "a Postman API token", rule: "postman-api-token", make: () => "PMAK-" + D("hex", 24) + "-" + D("hex", 34) },
  { name: "Grafana service account", kind: "a Grafana token", rule: "grafana-service-account-token", make: () => "glsa_" + D("alnum", 32) + "_" + D("hex", 8) },
  { name: "Doppler token", kind: "a Doppler API token", rule: "doppler-api-token", make: () => "dp.pt." + D("lowerDigits", 43) },
  { name: "Fly.io token", kind: "a Fly.io access token", rule: "flyio-access-token", make: () => "fo1_" + D("word", 43) },
  { name: "Pulumi token", kind: "a Pulumi API token", rule: "pulumi-api-token", make: () => "pul-" + D("hex", 40) },
  { name: "Vault service token", kind: "a Vault token", rule: "vault-service-token", make: () => "hvs." + D("word", 95) },
  { name: "age secret key", kind: "an age secret key", rule: "age-secret-key", make: () => "AGE-SECRET-KEY-1" + deck(ALPHA.bech, 58) },
  { name: "JSON Web Token", kind: "a JSON Web Token", rule: "jwt", make: () => "eyJ" + D("alnum", 20) + ".eyJ" + D("alnum", 24) + "." + D("word", 30) },
  { name: "private key block", kind: "a private key", rule: "private-key", make: () => "-----BEGIN " + "RSA PRIVATE KEY-----\n" + D("b64", 64) + "\n" + D("b64", 64) + "\n-----END " + "RSA PRIVATE KEY-----" },
  { name: "Notion token", kind: "a Notion API token", rule: "notion-api-token", make: () => "ntn_" + D("digits", 11) + D("alnum", 35) },
  { name: "Square token", kind: "a Square access token", rule: "square-access-token", make: () => "EAAA" + D("alnum", 60) },
  { name: "Cloudflare origin CA key", kind: "a Cloudflare origin CA key", rule: "cloudflare-origin-ca-key", make: () => "v1.0-" + D("hex", 24) + "-" + D("hex", 146) },
  { name: "AWS Bedrock key", kind: "an AWS Bedrock API key", rule: "aws-amazon-bedrock-api-key-long-lived", make: () => "ABSK" + D("b64", 120) },
  { name: "Adafruit key (named)", kind: "an Adafruit API key", rule: "adafruit-api-key", make: () => `adafruit_key = "aio_${D("alnum", 28)}"` },
  { name: "Datadog key (named)", kind: "a Datadog access token", rule: "datadog-access-token", make: () => `datadog_api_key: ${D("hex", 40)}` },
  { name: "Telegram bot (named)", kind: "a Telegram bot API token", rule: "telegram-bot-api-token", make: () => `telegram_bot_token = ${D("digits", 9)}:A${D("word", 34)}` },
  { name: "Azure AD secret (named)", kind: "an Azure AD client secret", rule: "azure-ad-client-secret", make: () => `azure client_secret = "${D("alnum", 3)}8Q~${D("word", 34)}"` },
  { name: "Twitter bearer (named)", kind: "a Twitter bearer token", rule: "twitter-bearer-token", make: () => `twitter bearer: ${"A".repeat(22)}${D("alnum", 90)}` },
  { name: "curl with a bearer token", kind: "a credential in a curl header", rule: "curl-auth-header", make: () => `curl -H "Authorization: Bearer ${D("alnum", 30)}" https://api.example.test/v1` },
  { name: "generic named key", kind: "a secret value", rule: "generic-api-key", make: () => `{"clientSecret": "${D("alnum", 40)}"}` },
  { name: "PKCS#12 file (by its name)", kind: "a PKCS#12 key file", rule: "pkcs12-file", make: () => "binary", path: "certs/site.p12" },
];

