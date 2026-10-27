/**
 * Turns Gitleaks' default rules (third_party/gitleaks/gitleaks.toml, MIT, see THIRD_PARTY_NOTICES.md) into a TypeScript module the secret scan reads,
 * src/code/secrets/gitleaksRules.ts.
 *
 * Gitleaks' rules are Go (RE2) regular expressions in a TOML file. The scan runs in Node and on a Cloudflare Worker, so this script does, once, at the
 * desk, what a runtime could not do cheaply:
 *   - reads the TOML subset the file uses (tables, arrays of tables, '''literal''' and "basic" strings, numbers, arrays);
 *   - rewrites each Go regex as the JavaScript regex that matches the same text: `(?i)` becomes the `i` flag when it covers the whole pattern, and is
 *     expanded to `[aA]` classes when it covers only a part (JavaScript has no scoped flags in the engines we run on); `(?s:`, `\z`, `(?P<name>`,
 *     POSIX classes and `.` are rewritten; a construct it cannot translate stops the script instead of being guessed at;
 *   - compiles every result, so a bad translation fails here and not in production;
 *   - gives each rule the words the person sees on the approval card ("an Adafruit API key"): the same words the scan already used for the providers it
 *     knew (an AWS access key, a GitHub token...), so one token is never reported under two names.
 *
 * Run: `npm run gen:gitleaks`. The test tests/code-secrets-gitleaks.test.ts fails when the module and the TOML differ.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const TOML_PATH = join(here, "..", "third_party", "gitleaks", "gitleaks.toml");
export const OUT_PATH = join(here, "..", "src", "code", "secrets", "gitleaksRules.ts");

// ---------------------------------------------------------------- the TOML subset

type TomlValue = string | number | boolean | TomlValue[];
type TomlTable = Record<string, TomlValue>;
export interface Toml { top: TomlTable; allowlist: TomlTable; rules: Array<TomlTable & { allowlists?: TomlTable[] }> }

export function parseToml(text: string): Toml {
  let i = 0;
  const fail = (why: string): never => { throw new Error(`gitleaks.toml: ${why} at line ${text.slice(0, i).split("\n").length}`); };
  const skip = (newlines: boolean): void => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n")) i++;
      else if (c === "#") { while (i < text.length && text[i] !== "\n") i++; }
      else return;
    }
  };
  const value = (): TomlValue => {
    skip(false);
    if (text.startsWith("'''", i)) {
      const end = text.indexOf("'''", i + 3);
      if (end < 0) fail("unterminated '''");
      let s = text.slice(i + 3, end);
      if (s.startsWith("\n")) s = s.slice(1);
      i = end + 3;
      return s;
    }
    if (text[i] === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) fail("unterminated '");
      const s = text.slice(i + 1, end);
      i = end + 1;
      return s;
    }
    if (text[i] === '"') {
      let s = "";
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          const n = text[i + 1];
          const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
          if (!n || !(n in esc)) fail(`unsupported escape \\${n}`);
          s += esc[n!]!;
          i += 2;
        } else s += text[i++];
      }
      i++;
      return s;
    }
    if (text[i] === "[") {
      i++;
      const out: TomlValue[] = [];
      for (;;) {
        skip(true);
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return out; }
        if (i >= text.length) fail("unterminated array");
        out.push(value());
      }
    }
    const m = /^(?:true|false|-?\d+(?:\.\d+)?)/.exec(text.slice(i, i + 24));
    if (!m) return fail(`unsupported value ${JSON.stringify(text.slice(i, i + 20))}`);
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };

  const top: TomlTable = {};
  const allowlist: TomlTable = {};
  const rules: Toml["rules"] = [];
  let into: TomlTable = top;
  for (;;) {
    skip(true);
    if (i >= text.length) break;
    if (text[i] === "[") {
      const double = text[i + 1] === "[";
      const end = text.indexOf(double ? "]]" : "]", i);
      const name = text.slice(i + (double ? 2 : 1), end).trim();
      i = end + (double ? 2 : 1);
      if (name === "allowlist" && !double) into = allowlist;
      else if (name === "rules" && double) { const r: Toml["rules"][number] = {}; rules.push(r); into = r; }
      else if (name === "rules.allowlists" && double) {
        const r = rules[rules.length - 1] ?? fail("allowlist before any rule");
        const a: TomlTable = {};
        (r.allowlists ??= []).push(a);
        into = a;
      } else fail(`unsupported table [${name}]`);
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 64));
    if (!m) { fail(`expected a key, found ${JSON.stringify(text.slice(i, i + 20))}`); continue; }
    i += m[0].length;
    skip(false);
    if (text[i] !== "=") fail(`expected = after ${m[0]}`);
    i++;
    into[m[0]] = value();
  }
  return { top, allowlist, rules };
}

// ------------------------------------------------------------ Go (RE2) regex to JavaScript

export interface JsRegex { source: string; flags: string }

const POSIX: Record<string, string> = {
  alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z", space: " \\t\\n\\r\\f\\v", blank: " \\t",
  punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f", word: "\\w",
};

const isLetter = (c: string): boolean => /^[A-Za-z]$/.test(c);

/** One pass over a Go pattern. `expand` writes every letter that is case-insensitive as a class, and reports whether the pattern is "mixed" (flags change part-way). */
function walk(src: string, expand: boolean, startCi: boolean): { out: string; mixed: boolean } {
  type F = { ci: boolean; s: boolean };
  let cur: F = { ci: startCi, s: false };
  const stack: F[] = [];
  let mixed = false;
  let out = "";
  let i = 0;

  const escape = (): string => {
    const n = src[i + 1];
    if (n === undefined) throw new Error("trailing backslash");
    if (n === "z") { i += 2; return "$"; }
    if (n === "A") { i += 2; return "^"; }
    if (n === "Q" || n === "E" || n === "p" || n === "P" || n === "C") throw new Error(`unsupported escape \\${n}`);
    if (n === "x" && src[i + 2] === "{") throw new Error("unsupported \\x{...}");
    i += 2;
    return `\\${n}`;
  };

  /** One thing inside [...]: raw text to write back, and the character it is when it can start or end a range. */
  const classAtom = (): { raw: string; ch?: string; set?: boolean } => {
    if (src[i] === "[" && src[i + 1] === ":") {
      const end = src.indexOf(":]", i);
      const name = src.slice(i + 2, end);
      const body = POSIX[name];
      if (!body) throw new Error(`unknown POSIX class [:${name}:]`);
      i = end + 2;
      return { raw: body, set: true };
    }
    if (src[i] === "\\") {
      const n = src[i + 1];
      if (n === undefined) throw new Error("trailing backslash");
      if (n === "x") { if (src[i + 2] === "{") throw new Error("unsupported \\x{...}"); const raw = src.slice(i, i + 4); i += 4; return { raw, ch: String.fromCharCode(parseInt(raw.slice(2), 16)) }; }
      if (/[dDwWsS]/.test(n)) { i += 2; return { raw: `\\${n}`, set: true }; }
      if (/[pPQEC]/.test(n)) throw new Error(`unsupported escape \\${n}`);
      i += 2;
      const ctl: Record<string, string> = { t: "\t", n: "\n", r: "\r", f: "\f", v: "\v" };
      return { raw: `\\${n}`, ch: ctl[n] ?? n };
    }
    const ch = src[i++]!;
    return { raw: ch, ch };
  };

  const charClass = (): string => {
    i++; // [
    let out = "[";
    if (src[i] === "^") { out += "^"; i++; }
    const extra: string[] = [];
    const swap = (lo: string, hi: string, from: number, to: number, delta: number): void => {
      const s = Math.max(lo.charCodeAt(0), from), e = Math.min(hi.charCodeAt(0), to);
      if (s <= e) extra.push(s === e ? String.fromCharCode(s + delta) : `${String.fromCharCode(s + delta)}-${String.fromCharCode(e + delta)}`);
    };
    const addCase = (lo: string, hi: string): void => {
      if (!cur.ci || !expand) return;
      swap(lo, hi, 97, 122, -32);
      swap(lo, hi, 65, 90, 32);
    };
    let first = true;
    while (i < src.length && (src[i] !== "]" || first)) {
      first = false;
      const lo = classAtom();
      if (lo.ch !== undefined && src[i] === "-" && i + 1 < src.length && src[i + 1] !== "]") {
        i++;
        const hi = classAtom();
        if (hi.ch === undefined) throw new Error("range to a class");
        out += `${lo.raw}-${hi.raw}`;
        if (lo.ch.length === 1 && hi.ch.length === 1) addCase(lo.ch, hi.ch);
      } else {
        out += lo.raw;
        if (lo.ch !== undefined && lo.ch.length === 1) addCase(lo.ch, lo.ch);
        if (lo.set && /[a-zA-Z]-[a-zA-Z]/.test(lo.raw)) { addCase("a", "z"); addCase("A", "Z"); }
      }
    }
    if (src[i] !== "]") throw new Error("unterminated character class");
    i++;
    return `${out}${extra.join("")}]`;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") { out += escape(); continue; }
    if (c === "[") { out += charClass(); continue; }
    if (c === "(") {
      if (src[i + 1] === "?") {
        const rest = src.slice(i + 2);
        const flagged = /^([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(rest);
        if (/^P?<[A-Za-z_]\w*>/.test(rest)) {
          const m = /^P?<[A-Za-z_]\w*>/.exec(rest)!;
          stack.push({ ...cur });
          out += "(";
          i += 2 + m[0].length;
          continue;
        }
        if (rest.startsWith(":")) { stack.push({ ...cur }); out += "(?:"; i += 3; continue; }
        if (rest.startsWith("=") || rest.startsWith("!")) { stack.push({ ...cur }); out += `(?${rest[0]}`; i += 3; continue; }
        if (flagged && (flagged[1] || flagged[2] !== undefined)) {
          const on = flagged[1] ?? "", off = flagged[2] ?? "";
          for (const f of on + off) if (f !== "i" && f !== "s") throw new Error(`unsupported flag (?${f})`);
          const next = { ...cur };
          if (on.includes("i")) next.ci = true;
          if (off.includes("i")) next.ci = false;
          if (on.includes("s")) next.s = true;
          if (off.includes("s")) next.s = false;
          mixed = true;
          i += 2 + flagged[0].length;
          if (flagged[3] === ":") { stack.push({ ...cur }); out += "(?:"; cur = next; } else cur = next;
          continue;
        }
        throw new Error(`unsupported group ${src.slice(i, i + 8)}`);
      }
      stack.push({ ...cur });
      out += "(";
      i++;
      continue;
    }
    if (c === ")") { cur = stack.pop() ?? cur; out += ")"; i++; continue; }
    if (c === ".") { out += cur.s ? "[\\s\\S]" : "[^\\n]"; i++; continue; }
    if (expand && cur.ci && isLetter(c)) { out += `[${c.toLowerCase()}${c.toUpperCase()}]`; i++; continue; }
    out += c;
    i++;
  }
  return { out, mixed };
}

export function goToJs(src: string): JsRegex {
  let body = src;
  let ci = false;
  if (body.startsWith("(?i)")) { ci = true; body = body.slice(4); }
  const probe = walk(body, false, ci);
  let source: string;
  let flags = "";
  if (probe.mixed) source = walk(body, true, ci).out;
  else { source = probe.out; if (ci) flags = "i"; }
  new RegExp(source, flags); // a translation that does not compile stops the script here
  return { source, flags };
}

// ------------------------------------------------------------------ the module

/** The words the person reads for a rule that is not one of the providers the scan named before Gitleaks' rules were added. */
const WORDS: Record<string, string> = {
  "1password": "1Password", aws: "AWS", gcp: "GCP", api: "API", jwt: "JWT", npm: "npm", pypi: "PyPI", id: "ID", url: "URL", pat: "personal access token",
  ci: "CI", cicd: "CI/CD", ptt: "pipeline trigger token", rrt: "runner registration token", scim: "SCIM", yaml: "YAML", tf: "Terraform", ad: "AD",
  droneci: "Drone CI", travisci: "Travis CI", circleci: "CircleCI", huggingface: "Hugging Face", launchdarkly: "LaunchDarkly", planetscale: "PlanetScale",
  sendgrid: "SendGrid", sendinblue: "Sendinblue", hashicorp: "HashiCorp", digitalocean: "DigitalOcean", linkedin: "LinkedIn", mailchimp: "Mailchimp",
  rubygems: "RubyGems", nuget: "NuGet", gitlab: "GitLab", github: "GitHub", openai: "OpenAI", openshift: "OpenShift", rapidapi: "RapidAPI",
  sourcegraph: "Sourcegraph", sumologic: "Sumo Logic", settlemint: "SettleMint", flyio: "Fly.io", frameio: "Frame.io", intra42: "Intra 42", okta: "Okta",
  "new-relic": "New Relic", cisco: "Cisco", meraki: "Meraki", easypost: "EasyPost", clickhouse: "ClickHouse", messagebird: "MessageBird",
  gocardless: "GoCardless", freshbooks: "FreshBooks", privateai: "Private AI", nytimes: "New York Times", jfrog: "JFrog", slack: "Slack", ssh: "SSH",
  mfa: "MFA", db: "DB", sdk: "SDK", oauth: "OAuth", hubspot: "HubSpot", pulumi: "Pulumi", dynatrace: "Dynatrace", doppler: "Doppler", databricks: "Databricks",
  personnal: "personal", authress: "Authress", cohere: "Cohere", curl: "curl", pkcs12: "PKCS#12", pub: "public", priv: "private",
  ca: "CA", v1: "v1", v2: "v2", dnkey: "DNKey", sk: "SK",
};
const GENERIC_WORDS = new Set(["access", "token", "key", "secret", "password", "credentials", "client", "identity", "reference", "public", "private", "long", "lived", "short", "refresh", "bot", "user", "app", "config", "license", "signing", "encryption", "personal", "insert", "browser", "service", "account", "oauth", "legacy", "workspace", "file", "header", "auth", "delivery", "test", "global", "origin", "ca", "feed", "incoming", "mail", "kubernetes", "agent", "session", "cookie", "runner", "authentication", "routable", "deploy", "batch", "job", "feature", "flag", "cloud", "page", "shared", "custom", "sensitive", "name", "organization", "application", "upload", "bearer", "id", "secret", "password"]);

/** The wording for the providers the scan already named, so that its old regexes and Gitleaks' agree on one name for one token. */
const KIND_OVERRIDES: Record<string, string> = {
  "aws-access-token": "an AWS access key",
  "github-pat": "a GitHub token", "github-fine-grained-pat": "a GitHub token", "github-oauth": "a GitHub token", "github-app-token": "a GitHub token", "github-refresh-token": "a GitHub token",
  "slack-app-token": "a Slack token", "slack-bot-token": "a Slack token", "slack-config-access-token": "a Slack token", "slack-config-refresh-token": "a Slack token",
  "slack-legacy-bot-token": "a Slack token", "slack-legacy-token": "a Slack token", "slack-legacy-workspace-token": "a Slack token", "slack-user-token": "a Slack token",
  "slack-webhook-url": "a Slack webhook address",
  "stripe-access-token": "a Stripe key",
  "gcp-api-key": "a Google API key",
  "private-key": "a private key",
  "anthropic-api-key": "a model API key", "anthropic-admin-api-key": "a model API key", "openai-api-key": "a model API key",
  "generic-api-key": "a secret value",
  "jwt": "a JSON Web Token", "jwt-base64": "a JSON Web Token",
  "microsoft-teams-webhook": "a Microsoft Teams webhook address",
  "sidekiq-sensitive-url": "a Sidekiq address with a password in it",
  "pkcs12-file": "a PKCS#12 key file",
  "age-secret-key": "an age secret key",
  "kubernetes-secret-yaml": "a Kubernetes secret",
  "curl-auth-header": "a credential in a curl header",
  "curl-auth-user": "a password in a curl command",
  "aws-amazon-bedrock-api-key-long-lived": "an AWS Bedrock API key", "aws-amazon-bedrock-api-key-short-lived": "an AWS Bedrock API key",
  "hashicorp-tf-api-token": "a Terraform Cloud token", "hashicorp-tf-password": "a Terraform password",
  "vault-batch-token": "a Vault token", "vault-service-token": "a Vault token",
};

/**
 * Two rules look for "curl", then for `-H` or `-u` anywhere later, on that line or the next five, with nested lazy runs between. Go's regex engine takes
 * linear time whatever the text; a backtracking one takes time in proportion to (how many times "curl" occurs) x (how far the line goes on), which for a
 * minified bundle that says "curl" a thousand times on one 1 MB line is seconds. The scan therefore reads only this many characters after each "curl" (and,
 * per file, stops after WINDOW_BUDGET characters of such windows: secrets/gitleaks.ts). A command whose option is farther than that from the word curl is
 * not a command anyone typed.
 */
const WINDOWED: Record<string, [anchor: string, span: number]> = {
  "curl-auth-header": ["curl", 1500],
  "curl-auth-user": ["curl", 1500],
};

export function kindOf(id: string): string {
  const fixed = KIND_OVERRIDES[id];
  if (fixed) return fixed;
  if (id.startsWith("gitlab-")) return "a GitLab token";
  if (id.startsWith("digitalocean-")) return "a DigitalOcean token";
  if (id.startsWith("shopify-")) return /secret/.test(id) ? "a Shopify shared secret" : "a Shopify token";
  if (id.startsWith("grafana-")) return "a Grafana token";
  if (id.startsWith("planetscale-")) return /password/.test(id) ? "a PlanetScale password" : "a PlanetScale token";
  const parts = id.split("-");
  const words: string[] = [];
  for (let k = 0; k < parts.length; k++) {
    const two = `${parts[k]}-${parts[k + 1]}`;
    if (WORDS[two]) { words.push(WORDS[two]!); k++; continue; }
    const w = parts[k]!;
    words.push(WORDS[w] ?? (GENERIC_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  }
  const text = words.join(" ");
  const article = /^(?:[AEIO]|U(?![a-z]*[bcdfghjklmnpqrstvwxyz][aeiou]))/.test(text) || /^(?:npm|SCIM|SSH|MFA|SQL|SDK|HTML|RSA|FTP|LDAP|XML)\b/.test(text) ? "an" : "a";
  return `${article} ${text}`;
}

interface OutAllow { cond?: "AND"; target?: "match" | "line"; paths?: Array<[string, string]>; regexes?: Array<[string, string]>; stop?: string[] }
interface OutRule { id: string; kind: string; re?: [string, string]; pre?: true; win?: [string, number]; path?: [string, string]; entropy?: number; group?: number; kw: string[]; allow?: OutAllow[]; generic?: true }

/**
 * About half of Gitleaks' rules begin with a lazy run of name characters, `[\w.-]{0,50}?`, so that the "match" they report includes the name in front of
 * the keyword (`MY_SERVICE_API_KEY = ...`). Written that way a regex engine that backtracks (every JavaScript one) tries the run at EVERY position of the
 * file, which cost 100x more than finding the keyword. The module drops the run and the scan puts it back where it matters (the allowlists that test the
 * whole match): same findings, same secret, a literal for the engine to search for.
 */
export const LAZY_PREFIX = "[\\w.-]{0,50}?";

const rx = (s: unknown): [string, string] => { const r = goToJs(String(s)); return [r.source, r.flags]; };
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function allowOf(a: TomlTable): OutAllow {
  const out: OutAllow = {};
  if (a.condition === "AND") out.cond = "AND";
  if (a.regexTarget === "match" || a.regexTarget === "line") out.target = a.regexTarget;
  else if (a.regexTarget !== undefined && a.regexTarget !== "secret") throw new Error(`regexTarget ${String(a.regexTarget)}`);
  if (a.paths) out.paths = strs(a.paths).map(rx);
  if (a.regexes) out.regexes = strs(a.regexes).map(rx);
  if (a.stopwords) out.stop = [...new Set(strs(a.stopwords).map((s) => s.toLowerCase()))];
  return out;
}

export function build(toml: Toml): { global: OutAllow; rules: OutRule[] } {
  const rules: OutRule[] = toml.rules.map((r) => {
    const id = String(r.id);
    const o: OutRule = { id, kind: kindOf(id), kw: [...new Set(strs(r.keywords).map((k) => k.toLowerCase()))] };
    if (r.regex !== undefined) {
      o.re = rx(r.regex);
      if (o.re[0].startsWith(LAZY_PREFIX) && o.re[0].length > LAZY_PREFIX.length) {
        o.re = [o.re[0].slice(LAZY_PREFIX.length), o.re[1]];
        o.pre = true;
        new RegExp(o.re[0], o.re[1]);
      }
    }
    if (r.path !== undefined) o.path = rx(r.path);
    if (r.entropy !== undefined) o.entropy = Number(r.entropy);
    if (r.secretGroup !== undefined) o.group = Number(r.secretGroup);
    if (r.allowlists?.length) o.allow = r.allowlists.map(allowOf);
    if (WINDOWED[id]) o.win = WINDOWED[id];
    // Gitleaks: a rule whose id starts with "generic" and has an entropy floor also wants a digit in the secret.
    if (id.startsWith("generic") && o.entropy !== undefined) o.generic = true;
    if (!o.re && !o.path) throw new Error(`rule ${id} has neither a regex nor a path`);
    return o;
  });
  return { global: allowOf(toml.allowlist), rules };
}

/**
 * JSON for the module, with every run of eight or more letters, digits, underscores and hyphens broken up by a \uXXXX escape in each sixth place. The rules
 * list example tokens (Google's own documentation keys, the literal prefix of a Bedrock key) as allowlist entries, and a module that holds them in the
 * clear is a file the secret scan flags, so the scan could not be run over the repo. "AIza..." written "AIzaSy\u0061..." is the same string to the
 * program and not a token to a scanner; tests/code-secrets-gitleaks.test.ts keeps it so.
 */
export function defang(json: string): string {
  return json.replace(/[A-Za-z0-9_-]{8,}/g, (run) => {
    let out = "";
    for (let k = 0; k < run.length; k++) out += (k + 1) % 6 === 0 ? `\\u${run.charCodeAt(k).toString(16).padStart(4, "0")}` : run[k];
    return out;
  });
}

export function render(toml: Toml): string {
  const { global, rules } = build(toml);
  const stamp = String(toml.top.minVersion ?? "");
  const lines = rules.map((r) => `  ${defang(JSON.stringify(r))},`);
  return `// GENERATED by scripts/gen-gitleaks.ts from third_party/gitleaks/gitleaks.toml. Do not edit by hand: run \`npm run gen:gitleaks\`.
// The rules are Gitleaks' (MIT, Copyright (c) 2019 Zachary Rice); see THIRD_PARTY_NOTICES.md. Config format ${stamp}.
/** A regular expression as [source, flags]. */
export type Rx = readonly [source: string, flags: string];
export interface GlAllow {
  /** "AND": every list that is present must allow; otherwise any one allows. */
  cond?: "AND";
  /** What the regexes are tested against: the secret (default), the whole match, or the line the match is on. */
  target?: "match" | "line";
  paths?: readonly Rx[];
  regexes?: readonly Rx[];
  /** Lowercase; the secret is allowed when it contains one. */
  stop?: readonly string[];
}
export interface GlRule {
  id: string;
  /** What the person reads on the approval card. */
  kind: string;
  re?: Rx;
  /** The regex was written with a lazy run of up to 50 name characters in front, which is not in re: the whole match is that run plus the matched text. */
  pre?: true;
  /** [anchor, span]: the regex is run only on the span characters that follow each occurrence of the anchor (one before it, for the word boundary), not on the whole text. */
  win?: readonly [anchor: string, span: number];
  /** Only files whose path matches are scanned by this rule (a rule with a path and no regex flags the file by its name). */
  path?: Rx;
  /** The secret's Shannon entropy must be above this. */
  entropy?: number;
  /** Which capture group is the secret (default: the first that took part). */
  group?: number;
  /** Lowercase; the rule runs only on text that holds one of them. */
  kw: readonly string[];
  allow?: readonly GlAllow[];
  /** The secret must also hold a digit. */
  generic?: true;
}
export const GITLEAKS_RULE_COUNT = ${rules.length};
export const GL_GLOBAL: GlAllow = ${defang(JSON.stringify(global))};
export const GL_RULES: readonly GlRule[] = [
${lines.join("\n")}
];
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const toml = parseToml(readFileSync(TOML_PATH, "utf8"));
  const text = render(toml);
  writeFileSync(OUT_PATH, text);
  console.log(`wrote ${relative(process.cwd(), OUT_PATH)}: ${toml.rules.length} rules, ${(text.length / 1024).toFixed(0)} KB`);
}
