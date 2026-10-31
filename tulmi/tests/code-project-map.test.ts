/**
 * THE PROJECT MAP (src/code/project/map.ts): every component with its exact lines, its connections, whether anything leads to it, and where
 * new things go, made from the code with no model; a symbol's lines proven by a fingerprint, not trusted.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CODE_TREE_SITTER = "true";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { buildMap, checkSymbol, findInMap, mapMarkdown, spanHash } = await import("../src/code/project/map.js");
const { withHashes } = await import("../src/code/project/map.js");
const { gitBlobSha, mapAfterChanges } = await import("../src/code/project/mapupdate.js");
const { extractSymbols } = await import("../src/code/project/symbols.js");
const { projectRig, built } = await import("./project-rig.js");
const { ensureGrammars } = await import("../src/code/project/treesitter/index.js");
beforeAll(async () => { await ensureGrammars([{ path: "a.ts", lang: "TypeScript" }, { path: "a.js", lang: "JavaScript" }]); });
type StoredFile = import("../src/code/project/types.js").StoredFile;

const SESSION = 'import { sign } from "./token";\n\nexport function startSession(res, id) {\n  res.cookie("sid", sign({ sub: id }));\n}\n\nexport function endSession(res) {\n  res.clearCookie("sid");\n}\n';
const row = (path: string, text: string, o: Partial<StoredFile> = {}): StoredFile => ({
  path, blobSha: `sha-${path}`, lang: "TypeScript", bytes: text.length, symbols: withHashes(text, extractSymbols(path, "TypeScript", text)),
  imports: [], rank: 0, hot: 0, todo: 0, tests: [], summary: "", ...o,
});

function sample() {
  const files: StoredFile[] = [
    row("src/auth/session.ts", SESSION, { imports: ["src/auth/token.ts"], tests: ["tests/auth/session.test.ts"], summary: "Starts and ends a login session." }),
    row("src/auth/token.ts", "export function sign(claims) {\n  return JSON.stringify(claims);\n}\n", { summary: "Signs the session token." }),
    row("src/routes/login.ts", 'import { startSession } from "../auth/session";\nexport function login(req, res) {\n  startSession(res, req.body.id);\n}\n', {
      imports: ["src/auth/session.ts"], refs: [["startSession", 1]],
      symbols: [{ name: "login", kind: "function", line: 2, endLine: 4, exported: true }, { name: "login", kind: "route", line: 2, method: "POST", path: "/login" }],
    }),
    row("src/routes/logout.ts", 'import { endSession } from "../auth/session";\nexport function logout(req, res) {\n  endSession(res);\n}\n', {
      imports: ["src/auth/session.ts"], symbols: [{ name: "logout", kind: "route", line: 2, method: "POST", path: "/logout" }],
    }),
    row("src/routes/index.ts", 'import "./login";\nimport "./logout";\n', { imports: ["src/routes/login.ts", "src/routes/logout.ts"], symbols: [] }),
    row("src/auth/session-old.ts", "export function startSessionOld() {}\n"),
    row("tests/auth/session.test.ts", "import { startSession } from '../../src/auth/session';\n", { imports: ["src/auth/session.ts"] }),
  ];
  const features = [{ name: "Login", summary: "Signing in and out.", files: ["src/auth/session.ts", "src/auth/token.ts", "src/routes/login.ts"], fileCount: 3, routes: [], texts: [] }];
  return buildMap({ commit: "a6e8589cf506deadbeef", files, features, entries: ["src/routes/index.ts"] });
}

describe("the project map", () => {
  it("is one entry per component, with exact line ranges and a fingerprint of each one's lines; tests are not components", () => {
    const map = sample();
    expect(Object.keys(map.components)).not.toContain("tests/auth/session.test.ts");
    const session = map.components["src/auth/session.ts"]!;
    expect(session.area).toBe("Login");
    const start = session.symbols.find((s) => s.name === "startSession")!;
    expect(start).toMatchObject({ kind: "function", start: 3, end: 5, exported: true });
    expect(start.hash).toBe(spanHash(SESSION, 3, 5));
    // a fingerprint ignores line endings and nothing else
    expect(spanHash(SESSION.replace(/\n/g, "\r\n"), 3, 5)).toBe(start.hash);
    expect(spanHash(SESSION.replace("sid", "sid2"), 3, 5)).not.toBe(start.hash);
  });

  it("knows what uses what, what calls what, and which tests cover it", () => {
    const map = sample();
    const session = map.components["src/auth/session.ts"]!;
    expect(session.uses).toEqual(["src/auth/token.ts"]);
    expect(session.usedBy).toEqual(["src/routes/login.ts", "src/routes/logout.ts"]);
    expect(session.tests).toEqual(["tests/auth/session.test.ts"]);
    expect(map.components["src/routes/login.ts"]!.calls).toEqual([{ to: "src/auth/session.ts", names: ["startSession"] }]);
  });

  it("marks what nothing leads to as unused, and says nothing when the project names no entry point", () => {
    const map = sample();
    expect(map.components["src/auth/session.ts"]!.live).toBe(true);
    expect(map.components["src/auth/session-old.ts"]!.live).toBe(false);
    const none = buildMap({ commit: "c", files: [row("a.ts", "export function a() {}\n")], features: [], entries: [] });
    expect(none.components["a.ts"]!.live).toBeNull();
  });

  it("says where a new thing of a kind goes: its folder, the file that registers them, where its tests sit", () => {
    const routes = sample().placements.find((p) => p.folder === "src/routes")!;
    expect(routes).toMatchObject({ kind: "route", registeredIn: [] });
    expect(routes.examples).toContain("src/routes/login.ts");
    const auth = sample().placements.find((p) => p.folder === "src/auth")!;
    expect(auth.registeredIn).toEqual([]);
    expect(auth.testsIn).toBe("tests/auth");
  });

  it("finds the component a request names, by symbol and route first", () => {
    const map = sample();
    expect(findInMap(map, "where is startSession")[0]).toBe("src/auth/session.ts");
    expect(findInMap(map, "the /logout route")[0]).toBe("src/routes/logout.ts");
    expect(findInMap(map, "")).toEqual([]);
  });

  it("proves a symbol's lines against the file as it is now: same, moved, changed or gone", async () => {
    const s = sample().components["src/auth/session.ts"]!.symbols.find((x) => x.name === "startSession")!;
    expect(await checkSymbol("src/auth/session.ts", SESSION, s)).toEqual({ status: "same", start: 3, end: 5 });
    expect(await checkSymbol("src/auth/session.ts", `// a comment\n// another\n${SESSION}`, s)).toEqual({ status: "moved", start: 5, end: 7 });
    expect((await checkSymbol("src/auth/session.ts", SESSION.replace('"sid", sign', '"sid", sign2'), s)).status).toBe("changed");
    expect(await checkSymbol("src/auth/session.ts", "export const x = 1;\n", s)).toEqual({ status: "gone" });
  });

  it("reads as a page: contents by area, a card per component with its lines, what is unused, where new things go", () => {
    const md = mapMarkdown(sample());
    expect(md).toContain("Commit `a6e8589cf506`");
    expect(md).toContain("### Login");
    expect(md).toContain("| `startSession` | function | 3–5 |");
    expect(md).toContain("| `POST /login` | route | 2 |");
    expect(md).toContain("`src/auth/session-old.ts` · unused: nothing leads here");
    expect(md).toContain("- Used by: `src/routes/login.ts`, `src/routes/logout.ts`");
    expect(md).toMatch(/\*\*route\*\* in `src\/routes\/`/);
  });

  it("after a change, reads only the changed files again: new lines and fingerprints, new links, gone files gone, git's own hash", async () => {
    const before = sample();
    const files = Object.values(before.components).map((c) => row(c.path, "", { imports: c.uses, tests: c.tests, summary: c.summary }));
    const grown = SESSION.replace("export function endSession", "export function renewSession(res) {\n  return res;\n}\n\nexport function endSession");
    const after = await mapAfterChanges({
      commit: "base123", files, features: [], entries: ["src/routes/index.ts"], core: {},
      changes: [
        { path: "src/auth/session.ts", content: grown },
        { path: "src/auth/session-old.ts", delete: true },
        { path: "tests/auth/renew.test.ts", content: 'import { renewSession } from "../../src/auth/session";\n' },
        { path: ".xode/map.json", content: "{}" },
      ],
    });
    const session = after.components["src/auth/session.ts"]!;
    expect(session.symbols.map((s) => [s.name, s.start, s.end])).toEqual([["startSession", 3, 5], ["renewSession", 7, 9], ["endSession", 11, 13]]);
    expect(session.symbols.find((s) => s.name === "endSession")!.hash).toBe(spanHash(grown, 11, 13));
    expect(session.uses).toEqual(["src/auth/token.ts"]);
    expect(session.tests).toContain("tests/auth/renew.test.ts");
    expect(session.blob).toBe(gitBlobSha(grown));
    expect(after.components["src/auth/session-old.ts"]).toBeUndefined();
    expect(after.changed).toEqual(["src/auth/session-old.ts", "src/auth/session.ts", "tests/auth/renew.test.ts"]);
    // git hash-object of "hello\n"
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("is made from a real build, which keeps each parsed symbol's fingerprint; config files are not components", async () => {
    const { acmeFiles } = await import("./project-repo.js");
    const r = await projectRig({ files: { ...acmeFiles(), "web/src/auth/session.ts": SESSION } });
    await built(r);
    const map = await (await r.brain.open("alice", r.projectId)).projectMap();
    expect(map).not.toBeNull();
    expect(map!.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(map!.components["Dockerfile"]).toBeUndefined();
    const start = map!.components["web/src/auth/session.ts"]!.symbols.find((s) => s.name === "startSession")!;
    expect(start).toMatchObject({ start: 3, end: 5, hash: spanHash(SESSION, 3, 5) });
    // every symbol with an end has its fingerprint; one a regex read (no end) has none, rather than a wrong one
    for (const s of Object.values(map!.components).flatMap((c) => c.symbols)) expect(Boolean(s.hash)).toBe(Boolean(s.end));
  });
});
