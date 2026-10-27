/**
 * READING A TEST RUN'S MACHINE-READABLE REPORT: JUnit XML (node:test, pytest, vitest) AND MOCHA'S JSON.
 *
 * Every repo's test command writes its report to $E2E_REPORT (repos.json). The scorer never parses human output: "did the hidden test pass" and "which
 * tests were already failing" are questions about test identities, and an identity is a suite path plus a name.
 */

export type TestStatus = "pass" | "fail" | "skip";
export interface TestCase { id: string; status: TestStatus }
export interface ParsedReport { tests: TestCase[]; total: number; passed: number; failed: number; skipped: number }

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, d, h) => (d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ENT[m] ?? m));

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}

function tally(tests: TestCase[]): ParsedReport {
  const passed = tests.filter((t) => t.status === "pass").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  return { tests, total: tests.length, passed, failed, skipped: tests.length - passed - failed };
}

/** JUnit XML: testsuite elements nest (node:test), testcase elements carry a failure, an error or a skipped child. */
export function parseJunit(xml: string): ParsedReport {
  const tests: TestCase[] = [];
  const stack: string[] = [];
  const seen = new Map<string, number>();
  const re = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [, closing, tag, rest, selfClose] = m;
    if (tag === "testsuite") {
      if (closing) stack.pop();
      else if (!selfClose) stack.push(attrs(rest!).name ?? "");
      continue;
    }
    if (closing) continue;
    const a = attrs(rest!);
    let status: TestStatus = "pass";
    if (!selfClose) {
      const end = xml.indexOf("</testcase>", re.lastIndex);
      const body = xml.slice(re.lastIndex, end < 0 ? undefined : end);
      if (/<(failure|error)\b/.test(body)) status = "fail";
      else if (/<skipped\b/.test(body)) status = "skip";
    }
    const base = [a.classname ?? "", ...stack.filter(Boolean), a.name ?? ""].filter(Boolean).join(" > ");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    tests.push({ id: n > 1 ? `${base} #${n}` : base, status });
  }
  // A suite that failed to load has no testcase at all, only an error on the suite: count it as one failure so "nothing ran" is never a pass.
  if (!tests.length && /<(testsuite|testsuites)\b[^>]*\b(errors|failures)="[1-9]/.test(xml)) tests.push({ id: "(the suite did not load)", status: "fail" });
  return tally(tests);
}

/** Mocha's JSON reporter. */
export function parseMochaJson(text: string): ParsedReport {
  let j: { passes?: Array<{ fullTitle?: string; file?: string }>; failures?: Array<{ fullTitle?: string; file?: string }>; pending?: Array<{ fullTitle?: string; file?: string }> };
  try { j = JSON.parse(text); } catch { return tally([{ id: "(the report is not JSON)", status: "fail" }]); }
  const rel = (f?: string) => (f ? f.replace(/^.*?\/(test|tests)\//, "$1/") : "");
  const name = (t: { fullTitle?: string; file?: string }) => `${rel(t.file)} > ${t.fullTitle ?? ""}`;
  const seen = new Map<string, number>();
  const uniq = (id: string) => { const n = (seen.get(id) ?? 0) + 1; seen.set(id, n); return n > 1 ? `${id} #${n}` : id; };
  const tests: TestCase[] = [
    ...(j.passes ?? []).map((t) => ({ id: uniq(name(t)), status: "pass" as const })),
    ...(j.failures ?? []).map((t) => ({ id: uniq(name(t)), status: "fail" as const })),
    ...(j.pending ?? []).map((t) => ({ id: uniq(name(t)), status: "skip" as const })),
  ];
  return tally(tests);
}

export function parseReport(format: "mocha-json" | "junit", text: string): ParsedReport {
  return format === "mocha-json" ? parseMochaJson(text) : parseJunit(text);
}

/** The ids that fail in `after` and did not fail in `before` (a regression), and those that failed before and pass now (a repair). */
export function diffFailures(before: ParsedReport, after: ParsedReport): { regressions: string[]; repaired: string[]; stillFailing: string[] } {
  const bad = (r: ParsedReport) => new Set(r.tests.filter((t) => t.status === "fail").map((t) => t.id));
  const good = (r: ParsedReport) => new Set(r.tests.filter((t) => t.status === "pass").map((t) => t.id));
  const b = bad(before);
  const a = bad(after);
  const aGood = good(after);
  return {
    regressions: [...a].filter((id) => !b.has(id)),
    repaired: [...b].filter((id) => aGood.has(id)),
    stillFailing: [...a].filter((id) => b.has(id)),
  };
}
