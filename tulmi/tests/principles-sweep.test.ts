/**
 * THE SWEEP, HELD DOWN: no model prompt under src/code, src/artifacts or src/web is written out in the code any more.
 *
 * It reads the source (comments taken out) and checks what the sweep did, so that it stays done:
 *   - no prompt builder has an example in it: no "Example:", "For example", "e.g.", "Examples" or Input/Output pairs;
 *   - no system prompt is a string in these directories: the only `role: "system"` literals left are the gateway's own
 *     JSON note, the type of a message, and the baseline the artifact docs measure savings against (never sent);
 *   - every site that asks a model for something says who the model is with a role (principles/roles.ts), and every
 *     file that builds messages for callModel builds them with compose();
 *   - every role is used by at least one site, and a site names a role that exists (tsc checks that one too).
 *
 * A new prompt that breaks one of these is a prompt that should have been a principle and a role.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");
const DIRS = ["code", "artifacts", "web"];

const { ROLE_IDS } = await import("../src/principles/roles.js");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

/** The source with its comments blanked (lines kept), strings and templates left as they are. */
function withoutComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      out += " ".repeat(end - i);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j += 1; j += 1; }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== "`") { if (src[j] === "\\") j += 1; j += 1; }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

interface Source { file: string; rel: string; code: string }
const sources: Source[] = DIRS.flatMap((d) => walk(path.join(SRC, d))).map((file) => ({
  file, rel: path.relative(SRC, file).replace(/\\/g, "/"), code: withoutComments(fs.readFileSync(file, "utf8")),
}));

const lineOf = (code: string, at: number): number => code.slice(0, at).split("\n").length;

describe("the sweep", () => {
  it("reads every file of the three directories", () => {
    expect(sources.length).toBeGreaterThan(150);
    expect(sources.some((s) => s.rel === "code/brain/classify.ts")).toBe(true);
    expect(sources.some((s) => s.rel === "artifacts/edit.ts")).toBe(true);
    expect(sources.some((s) => s.rel === "web/research.ts")).toBe(true);
  });

  it("leaves no prompt with an example in it", () => {
    // Text that is not a prompt, and says "for example" to a person or to a regex: named here, with why.
    const NOT_PROMPTS: Array<{ rel: string; text: string; why: string }> = [
      { rel: "code/newproject/intake.ts", text: "e\\.g\\.|for example", why: "a regex that spots a person naming an example in their own answer" },
      { rel: "code/resources/finder.ts", text: "for example \\\"a date picker for React\\\"", why: "the hint the person sees when they ask for nothing" },
    ];
    const MARKERS: Array<[string, RegExp]> = [
      ["Example:", /Example:/],
      ["For example", /for example/i],
      ["e.g.", /\be\.g\./],
      ["an Examples heading", /["'`\n]\s*Examples?\s*\d*\s*[:\n]/],
      ["an Input/Output pair", /["'`\n]\s*(?:Input|Q|User)\s*:[^\n]*\n[^\n]*(?:Output|A|Answer|Assistant)\s*:/],
      ["a numbered example", /Example \d/i],
    ];
    const found: string[] = [];
    for (const s of sources) {
      for (const [name, re] of MARKERS) {
        const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
        for (const m of s.code.matchAll(g)) {
          const near = s.code.slice(Math.max(0, m.index! - 60), m.index! + 80);
          if (NOT_PROMPTS.some((a) => a.rel === s.rel && near.includes(a.text))) continue;
          found.push(`${s.rel}:${lineOf(s.code, m.index!)} has ${name}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("writes no system prompt out: the only system messages in the code are the gateway's note, the message type and the measuring baseline", () => {
    const allowed = new Map<string, number>([
      ["code/brain/gateway.ts", 3],
      ["code/brain/types.ts", 1],
      // fullRewriteMessages: what a whole-artifact rewrite would send, the number the savings are measured against. It is never sent.
      ["artifacts/edit.ts", 2],
    ]);
    const found = new Map<string, number>();
    for (const s of sources) {
      const n = (s.code.match(/role:\s*"system"/g) ?? []).length;
      if (n) found.set(s.rel, n);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(allowed));
    for (const s of sources) {
      expect(s.code, s.rel).not.toMatch(/\bconst\s+[A-Z_]*SYSTEM\b/);
      expect(s.code, s.rel).not.toMatch(/\bconst\s+[A-Z_]*(?:INSTRUCTIONS|PREAMBLE)\b/);
    }
  });

  it("says who the model is at every site that asks one: the files with a model call build their messages with compose()", () => {
    // every place a model is asked: a call with a purpose, or one of the doors (askJson, the web layer's ask1, the index's ask), so a new one cannot slip in unseen
    const asks = (code: string) => /\bpurpose\s*:\s*["'`]/.test(code) || /\baskJson\b/.test(code) || /\bask1\(/.test(code) || /\bctx, cap, "brain\./.test(code);
    const sites = sources.filter((s) => asks(s.code) && s.rel !== "code/brain/gateway.ts");
    expect(sites.map((s) => s.rel).sort()).toEqual([
      "artifacts/compare.ts", "artifacts/edit.ts", "artifacts/kit.ts", "artifacts/service.ts",
      "code/agent/context.ts", "code/agent/phases.ts", "code/brain/classify.ts", "code/newproject/spec.ts", "code/project/summarize.ts",
      "code/resources/brief.ts", "code/webTools.ts", "code/work/locate.ts", "code/work/model.ts", "code/work/plan.ts", "web/research.ts", "web/search/plan.ts",
    ]);
    for (const s of sites) {
      const composes = /\bcompose\(/.test(s.code);
      // a site that hands a role to the door that composes (askJson, ArtifactModel.run, the web layer's ask) names it
      const names = /(?:\brole:\s*|\bask1\(\s*|"brain\.[a-z.]+",\s*)"[a-z_]+"/.test(s.code);
      // the agent's turn is built by buildContext, which composes
      const viaContext = /\bbuildContext\(/.test(s.code);
      expect(composes || names || viaContext, s.rel).toBe(true);
    }
  });

  it("builds every callModel input's messages with compose(), or hands the work to a file that does", () => {
    const callers = sources.filter((s) => /\bcallModel\b/.test(s.code) && s.rel !== "code/brain/gateway.ts");
    expect(callers.map((s) => s.rel).sort()).toEqual([
      "artifacts/compare.ts", "artifacts/model.ts", "artifacts/service.ts", "code/agent/phases.ts", "code/brain/classify.ts",
      "code/project/build.ts", "code/webTools.ts", "code/work/model.ts",
    ]);
    for (const s of callers) {
      // a hand-built [{ role: ..., content: ... }] is a prompt written out; the messages of a call come from compose()
      expect(s.code, `${s.rel} builds messages by hand`).not.toMatch(/\bmessages\s*[:=]\s*\[\s*\{/);
    }
    for (const s of sources) expect(s.code, `${s.rel} builds messages by hand`).not.toMatch(/\bmessages\s*[:=]\s*\[\s*\{\s*role/);
    // the doors, by name: each composes the role it is given
    const compose = (rel: string, arg: string) => expect(sources.find((s) => s.rel === rel)!.code, rel).toContain(`compose(${arg}`);
    compose("code/brain/classify.ts", '"classify"');
    compose("code/work/model.ts", "o.role");
    compose("code/project/summarize.ts", "role");
    compose("code/webTools.ts", "req.role");
    compose("code/agent/context.ts", '"agent_work"');
    compose("artifacts/model.ts", "r.role");
    compose("artifacts/compare.ts", '"artifact_compare"');
  });

  it("uses every role at some site", () => {
    const code = sources.map((s) => s.code).join("\n");
    for (const id of ROLE_IDS) {
      const used = new RegExp(`(?:compose\\(\\s*|\\brole:\\s*|\\bask1\\(\\s*|"brain\\.[a-z.]+",\\s*)"${id}"`).test(code);
      expect(used, `${id} is not used by any site`).toBe(true);
    }
    // a role that is not in the library does not compile (RoleId), and compose() throws for one at run time
  });
});
