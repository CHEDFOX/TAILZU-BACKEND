import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(root, rel)).isDirectory() ? files(rel, ext) : ext.test(n) ? [rel] : [];
  });
}

const withoutComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// The viewer holds no credential and no state of its own: no storage API, no cookie, no Authorization header, no token.
const FORBIDDEN = [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bdocument\s*\.\s*cookie\b/, /\bcaches\s*\.\s*(open|match)\b/, /\bAuthorization\b/i, /\bBearer\b/, /set-cookie/i, /\bsetCookie\b/, /\bcookies?\s*\.\s*(get|set)\b/i];

describe("the viewer holds no credential and uses no storage", () => {
  for (const dir of ["web", "lib", "src"]) {
    it(`${dir}/ (source)`, () => {
      for (const f of files(dir, /\.ts$/)) {
        const code = withoutComments(readFileSync(join(root, f), "utf8"));
        for (const re of FORBIDDEN) expect(code, `${f} matches ${re}`).not.toMatch(re);
      }
    });
  }

  it("the built runtime (public/assets)", () => {
    for (const f of files("public/assets", /\.js$/)) {
      const code = readFileSync(join(root, f), "utf8");
      for (const re of FORBIDDEN) expect(code, `${f} matches ${re}`).not.toMatch(re);
    }
  });
});
