/**
 * The secret scan with Gitleaks' default rules (src/code/secrets, src/code/policy.ts scanForSecrets).
 *
 * What is held here:
 *   - the generated module is Gitleaks' TOML, translated (the script and the module agree; the translation of Go regexes is checked case by case);
 *   - about forty providers' tokens, BUILT AT RUN TIME (a short prefix and a body drawn from a seeded shuffle: no token is written in this file), are each
 *     caught with the right kind through the same scanForSecrets every commit goes through;
 *   - the things that look like secrets and are not (placeholders, template variables, the alphabet, plain code) are not flagged;
 *   - the repository's own tulmi/src and docs/ flag NO file;
 *   - the keyword prefilter finds exactly the rules a naive search would, a long line of "curl" cannot stall the scan, and the worklog redaction (the same
 *     scan) takes the new providers' tokens out of text.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUT_PATH, TOML_PATH, build, defang, goToJs, kindOf, parseToml, render } from "../scripts/gen-gitleaks.js";
import { scanForSecrets } from "../src/code/policy.js";
import { GITLEAKS_RULE_COUNT, GL_GLOBAL, GL_RULES } from "../src/code/secrets/gitleaksRules.js";
import { RULE_COUNT, WINDOW_BUDGET, candidateRules, gitleaksKinds, ruleIdsFor, skippedPath } from "../src/code/secrets/gitleaks.js";
import { redactText } from "../src/code/work/worklog.js";
import { validateArtifact } from "../src/artifacts/validate.js";
import { D, PROVIDERS, rnd } from "../evals/secrets/providers.js";

const flagged = (content: string, path = "src/app.ts"): string[] => scanForSecrets([{ path, content }]).flatMap((h) => h.kinds);

describe("the rules module is Gitleaks' TOML, translated", () => {
  const toml = parseToml(readFileSync(TOML_PATH, "utf8"));

  it("is exactly what `npm run gen:gitleaks` writes from third_party/gitleaks/gitleaks.toml", () => {
    expect(readFileSync(OUT_PATH, "utf8")).toBe(render(toml));
  });

  it("carries every rule of the TOML, and the same ones when read back as data", () => {
    expect(GL_RULES.length).toBe(toml.rules.length);
    expect(GL_RULES.length).toBe(GITLEAKS_RULE_COUNT);
    expect(RULE_COUNT).toBe(GL_RULES.length);
    expect(GL_RULES.length).toBeGreaterThanOrEqual(200);
    const built = build(toml);
    expect(JSON.parse(JSON.stringify(GL_RULES))).toEqual(JSON.parse(JSON.stringify(built.rules)));
    expect(JSON.parse(JSON.stringify(GL_GLOBAL))).toEqual(JSON.parse(JSON.stringify(built.global)));
    expect(new Set(GL_RULES.map((r) => r.id)).size).toBe(GL_RULES.length);
  });

  it("compiles every regular expression it holds (rules, paths, allowlists)", () => {
    let n = 0;
    const compile = (r: readonly [string, string]): void => { new RegExp(r[0], r[1]); n++; };
    for (const r of GL_RULES) {
      if (r.re) compile(r.re);
      if (r.path) compile(r.path);
      for (const a of r.allow ?? []) { a.paths?.forEach(compile); a.regexes?.forEach(compile); }
    }
    GL_GLOBAL.paths?.forEach(compile);
    GL_GLOBAL.regexes?.forEach(compile);
    expect(n).toBeGreaterThan(300);
  });

  it("keeps what a scanner would flag out of the module's own text (so the repository can be scanned)", () => {
    const source = readFileSync(OUT_PATH, "utf8");
    expect(scanForSecrets([{ path: "tulmi/src/code/secrets/gitleaksRules.ts", content: source }])).toEqual([]);
    // ... and the escapes decode to the very strings the TOML holds
    expect(GL_GLOBAL.paths?.length).toBeGreaterThan(20);
    const googleExamples = GL_RULES.find((r) => r.id === "gcp-api-key")!.allow!.flatMap((a) => a.regexes ?? []).map((r) => r[0]);
    expect(googleExamples.some((s) => s.startsWith("AI[z]aSyabcdefghijklmnopqrstuvwxyz1234567"))).toBe(true);
  });

  it("defang breaks long runs and nothing else", () => {
    const json = JSON.stringify({ a: "short", b: "abcdefghijklmnop-qrstuvwxyz_0123456789", c: "\\bpre\\d+", d: "xx yy zz" });
    const out = defang(json);
    expect(out).not.toContain("abcdefghijklmnop");
    // evaluate the escaped text the way the module does: as JavaScript
    expect(new Function(`return ${out}`)()).toEqual(JSON.parse(json));
  });

  it("names the providers the scan already knew by the words it already used", () => {
    expect(kindOf("aws-access-token")).toBe("an AWS access key");
    expect(kindOf("github-fine-grained-pat")).toBe("a GitHub token");
    expect(kindOf("slack-user-token")).toBe("a Slack token");
    expect(kindOf("slack-webhook-url")).toBe("a Slack webhook address");
    expect(kindOf("stripe-access-token")).toBe("a Stripe key");
    expect(kindOf("gcp-api-key")).toBe("a Google API key");
    expect(kindOf("private-key")).toBe("a private key");
    expect(kindOf("generic-api-key")).toBe("a secret value");
    expect(kindOf("sourcegraph-access-token")).toBe("a Sourcegraph access token");
    expect(kindOf("adafruit-api-key")).toBe("an Adafruit API key");
  });
});

describe("Go regular expressions, as JavaScript", () => {
  it("(?i) over the whole pattern becomes the i flag", () => {
    expect(goToJs("(?i)abc[d-f]")).toEqual({ source: "abc[d-f]", flags: "i" });
  });
  it("(?i) over a part is written out as classes, since the engines have no scoped flags", () => {
    expect(goToJs("a(?i:b)c")).toEqual({ source: "a(?:[bB])c", flags: "" });
    expect(goToJs("(?i)a(?-i:b)c")).toEqual({ source: "[aA](?:b)[cC]", flags: "" });
    expect(goToJs("x(?i)[a-c]+y")).toEqual({ source: "x[a-cA-C]+[yY]", flags: "" });
    const re = new RegExp(goToJs("(?i)key(?-i:[Aa]pi|API)").source);
    expect(re.test("KEYApi")).toBe(true);
    expect(re.test("keyAPI")).toBe(true);
    expect(re.test("keyaPI")).toBe(false);
  });
  it("rewrites \\z, named groups, (?s:), dot and POSIX classes", () => {
    expect(goToJs("a\\z").source).toBe("a$");
    expect(goToJs("(?P<name>a)(?<other>b)").source).toBe("(a)(b)");
    expect(goToJs("(?s:a.b)c.d").source).toBe("(?:a[\\s\\S]b)c[^\\n]d");
    expect(goToJs("pat[[:alnum:]]{3}").source).toBe("pat[a-zA-Z0-9]{3}");
    expect(new RegExp(goToJs("^(?i:a+|b+)$").source).test("AAa")).toBe(true);
  });
  it("keeps escapes, hex and ranges in a class as they are", () => {
    expect(goToJs("[\\w.-]{0,50}?x[\\x60'\"\\s=]").source).toBe("[\\w.-]{0,50}?x[\\x60'\"\\s=]");
    expect(goToJs("[^\\s'\"]+").source).toBe("[^\\s'\"]+");
  });
  it("refuses what it cannot translate instead of guessing", () => {
    expect(() => goToJs("\\p{L}+")).toThrow();
    expect(() => goToJs("\\Qa.b\\E")).toThrow();
    expect(() => goToJs("(?m)^a")).toThrow();
    expect(() => goToJs("(?U)a")).toThrow();
  });
  it("reads the TOML subset the file uses", () => {
    const t = parseToml("title = \"x\"\n# note\n[allowlist]\npaths = [\n  '''a\\.b''',\n  '''c''','''d''',\n]\n[[rules]]\nid = \"r\"\nentropy = 3.5\nkeywords = [\"k\"]\n[[rules.allowlists]]\ncondition = \"AND\"\nstopwords = [\"s\"]\n");
    expect(t.top.title).toBe("x");
    expect(t.allowlist.paths).toEqual(["a\\.b", "c", "d"]);
    expect(t.rules[0]!.entropy).toBe(3.5);
    expect(t.rules[0]!.allowlists![0]).toEqual({ condition: "AND", stopwords: ["s"] });
    expect(() => parseToml("[nope]\n")).toThrow();
  });
});

describe("each provider's token is caught, with the right kind", () => {
  for (const p of PROVIDERS) {
    it(`${p.name}: ${p.kind}`, () => {
      const token = p.make();
      const path = p.path ?? "src/app.ts";
      expect(ruleIdsFor(path, token)).toContain(p.rule);
      expect(scanForSecrets([{ path, content: token }]).flatMap((h) => h.kinds)).toContain(p.kind);
      // the same token inside ordinary surroundings
      if (!p.path) {
        const around = `// config\nconst settings = {\n  name: "service",\n  value: "${token.replace(/\n/g, "\\n")}",\n};\nexport default settings;\n`;
        const kinds = scanForSecrets([{ path, content: p.name.includes("private key") ? token : around }]).flatMap((h) => h.kinds);
        expect(kinds.length).toBeGreaterThan(0);
      }
    });
  }
  it("covers at least 25 providers (and the table above is not shorter than its promise)", () => {
    expect(new Set(PROVIDERS.map((p) => p.rule)).size).toBeGreaterThanOrEqual(25);
    expect(new Set(PROVIDERS.map((p) => p.kind)).size).toBeGreaterThanOrEqual(25);
  });
  it("reports the kind and never the token", () => {
    const token = PROVIDERS[1]!.make();
    const hits = scanForSecrets([{ path: "a.ts", content: `x = "${token}"` }]);
    expect(JSON.stringify(hits)).not.toContain(token);
    expect(hits[0]!.kinds).toEqual(["a GitHub token"]);
  });
  it("names the old and the new rule's finding once, not twice, when they agree", () => {
    const token = PROVIDERS[7]!.make(); // a Stripe key: both the old regex and the Gitleaks rule match it
    expect(flagged(token).filter((k) => k === "a Stripe key").length).toBe(1);
  });
});

describe("what looks like a secret and is not", () => {
  const CLEAN: Array<[string, string]> = [
    ["a type that mentions a key", "export interface Options { apiKey?: string; token: string; secret: string }"],
    ["the keyof operator and Object.keys", "const names = Object.keys(row) as Array<keyof Row>; for (const key of names) total += row[key];"],
    ["reading a token from the environment", "const token = process.env.GITHUB_TOKEN;\nconst apiKey = getApiKey();\nconst password = await ask('Password');"],
    ["a template variable", "api_key: ${{ secrets.STRIPE_API_KEY }}\ntoken: ${TOKEN}\nsecret_key_base: $SECRET_KEY_BASE"],
    ["a placeholder in angle brackets", "API_KEY=<your-api-key-here>\nclient_secret = '<client secret>'"],
    ["the alphabet as a value", `api_key = "abcdefghijklmnopqrstuvwxyz"`],
    ["a repeated character", `secret = "${"a".repeat(32)}"`],
    ["an import of something named key", `import { apiKey, secretToken } from "./config";`],
    ["prose about tokens and keys", "Each token has a key; the access policy says who may rotate the secret. See api docs for the auth flow."],
    ["a hash in a lockfile comment", "# integrity sha512 of the package, not a secret"],
    ["a UUID", `const id = "123e4567-e89b-12d3-a456-426614174000";`],
    ["a url without credentials", "fetch('https://api.example.test/v1/users?limit=10')"],
    ["short values after key names", "key: abc\ntoken = 12\npassword: yes"],
  ];
  for (const [name, content] of CLEAN) {
    it(`${name} is not flagged`, () => {
      expect(flagged(content)).toEqual([]);
    });
  }
  it("a file Gitleaks' global allowlist names by path is not read by its rules (lockfiles, images, vendored code)", () => {
    const token = PROVIDERS[1]!.make();
    expect(skippedPath("package-lock.json")).toBe(true);
    expect(skippedPath("web/node_modules/x/index.js")).toBe(true);
    expect(skippedPath("src/app.ts")).toBe(false);
    expect(gitleaksKinds("package-lock.json", `"x": "${token}"`)).toEqual([]);
    expect(gitleaksKinds("src/app.ts", `"x": "${token}"`)).toEqual(["a GitHub token"]);
  });
  it("the rules' stopwords and entropy floors keep stand-ins out, and the digit rule keeps words out of the generic one", () => {
    expect(gitleaksKinds("a.ts", `api_key = "abcdefghijklmnopqrstuvwxyz${D("digits", 4)}"`)).toEqual([]);
    expect(gitleaksKinds("a.ts", `api_key = "${"ab".repeat(12)}"`)).toEqual([]);
    expect(gitleaksKinds("a.ts", `password = "${D("alnum", 30)}"`)).toEqual(["a secret value"]);
    expect(gitleaksKinds("a.ts", `password = "correcthorsebatterystaple"`)).toEqual([]);
  });
  it("only the one finding is named when a specific rule has found something (the generic rule stays quiet)", () => {
    const text = `datadog_api_key: ${D("hex", 40)}`;
    expect(ruleIdsFor("a.yml", text)).toEqual(expect.arrayContaining(["datadog-access-token", "generic-api-key"]));
    expect(gitleaksKinds("a.yml", text)).toEqual(["a Datadog access token"]);
    expect(gitleaksKinds("a.yml", `x_secret = "${D("alnum", 30)}"`, false)).toEqual([]);
  });
  it("Gitleaks' own stopwords keep AWS's documented example key out (the older rule still flags the shape)", () => {
    expect(gitleaksKinds("a.ts", "aws_access_key_id = AKIAIOSFODNN7EXAMPLE")).toEqual([]);
  });
  it("a rule with a path and no regex flags the file by its name, and nothing else", () => {
    expect(gitleaksKinds("keys/server.pfx", "x")).toEqual(["a PKCS#12 key file"]);
    expect(gitleaksKinds("keys/server.pfx.txt", "x")).toEqual([]);
  });
  it("the old rules still say what they said", () => {
    expect(flagged("-----BEGIN " + "PRIVATE KEY-----\nabc\n")).toEqual(["a private key"]);
    expect(flagged("sk_live_abc and sk-short and AIzaShort")).toEqual([]);
    expect(scanForSecrets([{ path: ".env.production", content: "A=1\n" }])[0]!.kinds).toEqual(["an .env file"]);
    expect(flagged(`api_key = "${D("alnum", 32)}"`)).toEqual(["a secret value"]);
  });
});

describe("the keyword prefilter", () => {
  const words = [...new Set(GL_RULES.flatMap((r) => r.kw))];
  const naive = (text: string): number[] => {
    const low = text.toLowerCase();
    return GL_RULES.flatMap((r, i) => (!r.kw.length || r.kw.some((k) => low.includes(k)) ? [i] : []));
  };

  it("picks the same rules as looking for each keyword in the lower-cased text", () => {
    const filler = ["const", " ", "x", "=", "\n", "{", "}", "foo", "bar", "-", "_", ".", "é", "日本", "😀", "0"];
    for (let t = 0; t < 300; t++) {
      let text = "";
      for (let i = 0, n = 5 + Math.floor(rnd() * 40); i < n; i++) {
        text += rnd() < 0.25 ? (rnd() < 0.5 ? words[Math.floor(rnd() * words.length)]! : words[Math.floor(rnd() * words.length)]!.toUpperCase()) : filler[Math.floor(rnd() * filler.length)];
      }
      expect(candidateRules(text)).toEqual(naive(text));
    }
  });
  it("finds a keyword that ends the text and one that overlaps another", () => {
    expect(candidateRules("zzz ghp_")).toEqual(naive("zzz ghp_"));
    expect(candidateRules("xoxb-xoxb-")).toEqual(naive("xoxb-xoxb-"));
    expect(candidateRules("")).toEqual(naive(""));
    expect(candidateRules("no keyword here at all, only plain words about nothing")).toEqual(naive("no keyword here at all, only plain words about nothing"));
  });
  it("lets most rules sleep: ordinary code wakes only a few", () => {
    const code = "export function add(a: number, b: number) { return a + b; }\nconst list = [1, 2, 3].map((n) => n * 2);\n";
    expect(candidateRules(code).length).toBeLessThan(15);
  });
});

describe("the rules keep their meaning when the lazy name prefix is dropped", () => {
  const toml = parseToml(readFileSync(TOML_PATH, "utf8"));
  const withPrefix = new Map<string, RegExp>();
  for (const r of toml.rules) {
    if (typeof r.regex !== "string") continue;
    const js = goToJs(r.regex);
    withPrefix.set(String(r.id), new RegExp(js.source, js.flags + "g"));
  }
  const prefixed = GL_RULES.filter((r) => r.pre);

  it("is used by about half of the rules", () => {
    expect(prefixed.length).toBeGreaterThan(80);
  });
  it("finds the same secret as the whole regex, on the named providers' tokens", () => {
    let compared = 0;
    for (const p of PROVIDERS) {
      const token = p.make();
      const rule = GL_RULES.find((r) => r.id === p.rule)!;
      if (!rule.pre || !rule.re) continue;
      const stripped = new RegExp(rule.re[0], rule.re[1]).exec(token);
      const whole = withPrefix.get(rule.id)!.exec(token);
      expect(stripped).not.toBeNull();
      expect(whole).not.toBeNull();
      const pick = (m: RegExpExecArray): string => (rule.group ? m[rule.group] : m.slice(1).find((g) => g !== undefined)) ?? m[0];
      expect(pick(stripped!)).toBe(pick(whole!));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(5);
  });
  it("lets the whole match, name included, reach the allowlists that read it (the generic rule's 'match' list)", () => {
    // "monkey" and "keyboard" are words, not keys: that allowlist reads the match with its name in front, so the name must be put back.
    expect(gitleaksKinds("a.ts", `my_token = "${D("alnum", 30)}"`)).toEqual(["a secret value"]);
    expect(gitleaksKinds("a.ts", `monkey_token = "${D("alnum", 30)}"`)).toEqual([]);
    expect(gitleaksKinds("a.ts", `keyboard_layout = "${D("alnum", 30)}"`)).toEqual([]);
    expect(gitleaksKinds("a.ts", `access_id = "${D("alnum", 30)}"`)).toEqual([]);
  });
});

describe("time", () => {
  it("a line that says curl twenty thousand times is read in bounded time, and a real curl command is still found", () => {
    const noise = "curl -s https://x.test | jq . ; ".repeat(20_000);
    const t = Date.now();
    expect(ruleIdsFor("a.sh", noise)).not.toContain("curl-auth-header");
    expect(Date.now() - t).toBeLessThan(5000);
    expect(WINDOW_BUDGET).toBeLessThanOrEqual(2_000_000);
    const real = `${noise}\ncurl -H "Authorization: Bearer ${D("alnum", 30)}" https://api.test/x\n`;
    expect(ruleIdsFor("a.sh", real.slice(noise.length - 10))).toContain("curl-auth-header");
  });
  it("hostile text of a megabyte does not stall any rule", () => {
    const worst = (filler: string): string => GL_RULES.slice(0, 40).map((r) => (r.kw[0] ?? "") + filler.repeat(40)).join(" ").repeat(200);
    for (const filler of ["a", "-", "ab1", " ", "="]) {
      const text = worst(filler).slice(0, 400_000);
      const t = Date.now();
      scanForSecrets([{ path: "x.txt", content: text }]);
      expect(Date.now() - t).toBeLessThan(8000);
    }
  });
});

describe("the worklog redaction, which uses the same scan, takes the new providers' tokens out", () => {
  it("replaces a token on its own, and withholds a line that holds one in a named value", () => {
    const gitlab = PROVIDERS.find((p) => p.rule === "gitlab-pat")!.make();
    const sendgrid = PROVIDERS.find((p) => p.rule === "sendgrid-api-token")!.make();
    const out = redactText(`pushed with ${gitlab} and mailed with ${sendgrid} fine`);
    expect(out).not.toContain(gitlab);
    expect(out).not.toContain(sendgrid);
    expect(out).toContain("[redacted]");
    expect(out).toContain("pushed with");
    const named = PROVIDERS.find((p) => p.rule === "datadog-access-token")!.make();
    const value = named.split(": ")[1]!;
    expect(redactText(`ok\n${named}\nfine`)).not.toContain(value);
    expect(redactText("nothing to see here, just a plain note about the work")).toBe("nothing to see here, just a plain note about the work");
  });
});

describe("an artifact, which a share link lets anyone read, is refused when it holds one of the new providers' tokens", () => {
  it("names the kind and never the value", () => {
    const token = PROVIDERS.find((p) => p.rule === "gitlab-pat")!.make();
    const bad = validateArtifact({ type: "markdown", content: `# Notes\n\nDeploy with ${token} from CI.\n` });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toContain("a GitLab token");
    expect(bad.errors.join(" ")).not.toContain(token);
    expect(validateArtifact({ type: "markdown", content: "# Notes\n\nDeploy with the token from CI secrets.\n" }).ok).toBe(true);
  });
});

// ------------------------------------------------------------------ this repository

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
function filesUnder(dir: string, out: Array<{ path: string; content: string }> = []): Array<{ path: string; content: string }> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) filesUnder(full, out);
    else if (st.size <= 1024 * 1024) out.push({ path: relative(repoRoot, full), content: readFileSync(full, "utf8") });
  }
  return out;
}

describe("this repository", () => {
  it("tulmi/src and docs/ hold nothing the scan flags: not one file", () => {
    const files = [...filesUnder(join(repoRoot, "tulmi", "src")), ...filesUnder(join(repoRoot, "docs"))];
    expect(files.length).toBeGreaterThan(300);
    const t = Date.now();
    const hits = scanForSecrets(files);
    const ms = Date.now() - t;
    expect(hits.map((h) => `${h.path}: ${h.kinds.join(", ")}`)).toEqual([]);
    // generous: the benchmark (evals/secrets/run.ts) measures; this only catches a scan that has become slow by an order of magnitude
    expect(ms).toBeLessThan(5000);
  });
});
