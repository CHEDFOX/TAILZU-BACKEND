/**
 * What the open projects showed (e2e/xode-eval.ts on flask, umami): a follow-up cited the lines the turn before had read and lost them, an address
 * and its port was taken for a file and its line, and a catalog of 500 strings kept its one-word labels and dropped its messages.
 */
import { describe, expect, it } from "vitest";
import { Anchors, checkCitations, citationsIn } from "../src/code/chat/cite.js";
import { catalogsOf, extractTexts, keepTexts, messageCallTexts, settingTexts, translationsOf } from "../src/code/project/texts.js";
import { namedIn } from "../src/code/chat/converse.js";
import { TEXTS_PER_FILE } from "../src/code/project/types.js";

describe("citations in a conversation", () => {
  it("keeps what earlier turns read citable, so a follow-up does not lose its sentence", () => {
    const a = new Anchors();
    a.earlier(["src/flask/app.py:720-737", "src/flask/cli.py:883"]);
    const out = checkCitations("It splits SERVER_NAME on the colon (src/flask/app.py:720-724), then calls run_simple at src/flask/app.py:748.", a);
    expect(out.text).toBe("It splits SERVER_NAME on the colon (src/flask/app.py:720-724), then calls run_simple at src/flask/app.py.");
    expect(out.dropped).toEqual(["src/flask/app.py:748"]);
  });

  it("reads a file's bare name, after its first mention, as the one file read with that name", () => {
    const a = new Anchors();
    a.read("backend/app/api/deps.py", Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"));
    a.read("backend/app/api/routes/items.py", Array.from({ length: 120 }, () => "x").join("\n"));
    const out = checkCitations("The token is checked in backend/app/api/deps.py:30-49; the superuser check is the only role (`deps.py:52-58`). Owners gate it (`items.py:89-90`, `items.py:400`).", a);
    expect(out.text).toBe("The token is checked in backend/app/api/deps.py:30-49; the superuser check is the only role (`deps.py:52-58`). Owners gate it (`items.py:89-90`, `items.py`).");
    // Two read with the same name: neither is guessed.
    a.read("frontend/src/deps.py", "a\n");
    expect(checkCitations("See deps.py:52.", a).dropped).toEqual(["deps.py:52"]);
  });

  it("leaves an address and its port alone: it is not a file and its line", () => {
    const a = new Anchors();
    const text = 'Set app.config["SERVER_NAME"] = "example.com:8080", or api.myapp.dev:443 behind the proxy.';
    expect(checkCitations(text, a)).toEqual({ text, kept: [], dropped: [] });
    expect(citationsIn(text)).toEqual([]);
    // A file of the project named like one is still a file.
    a.read("notes.app", "a\nb\n");
    expect(checkCitations("See notes.app:2.", a).kept).toEqual(["notes.app:2"]);
  });
});

describe("a catalog with more strings than a file keeps", () => {
  it("keeps the sentences a person reads before the one-word labels", () => {
    const labels = Object.fromEntries(Array.from({ length: 434 }, (_, i) => [`label-${i}`, `Label ${i}`]));
    const catalog = { label: labels, message: { "delete-team-warning": "Deleting a team will also delete all team websites." } };
    const hits = extractTexts("public/intl/messages/en-US.json", "JSON", JSON.stringify(catalog, null, 2));
    expect(hits).toHaveLength(TEXTS_PER_FILE);
    expect(hits.some((h) => h.text === "message.delete-team-warning: Deleting a team will also delete all team websites.")).toBe(true);
    // Still in the file's order.
    expect(hits.map((h) => h.line)).toEqual([...hits.map((h) => h.line)].sort((x, y) => x - y));
  });
});

describe("what a person asks about that no screen shows", () => {
  it("finds the messages Go, Rust and Kotlin return or throw, with the line", () => {
    const go = ['\tif err != nil {', '\t\treturn e.BadRequestError("Failed to authenticate.", errors.New("invalid login credentials"))', "\t}", '\treturn fmt.Errorf("failed to upsert superuser account: %w", err)', '// errors.New("a comment, not a message")'].join("\n");
    expect(messageCallTexts(go).map((h) => [h.line, h.text])).toEqual([[2, "Failed to authenticate."], [2, "invalid login credentials"], [4, "failed to upsert superuser account: …"]]);
    expect(messageCallTexts('bail!("config file {path} is missing a name");\nthrow IllegalStateException("The session is already closed")').map((h) => h.text))
      .toEqual(["config file … is missing a name", "The session is already closed"]);
    expect(extractTexts("apis/auth.go", "Go", go).filter((h) => h.kind === "message")).toHaveLength(3);
  });

  it("finds every environment setting the code reads, where it reads it, in any language; the name, never a value", () => {
    const code = [
      "const saltRotation = process.env.SALT_ROTATION || 'month';",
      "if (!process.env['DISABLE_BOT_CHECK'] && isbot(ua)) {}",
      'db = os.environ.get("DATABASE_URL")', 'key := os.Getenv("APP_SECRET")', 'let port = std::env::var("PORT_NUMBER");', "// process.env.IN_A_COMMENT",
    ].join("\n");
    expect(settingTexts(code).map((h) => [h.line, h.text.split(":")[0]])).toEqual([[1, "SALT_ROTATION"], [2, "DISABLE_BOT_CHECK"], [3, "DATABASE_URL"], [4, "APP_SECRET"], [5, "PORT_NUMBER"]]);
    // pydantic: the upper-case fields of a settings class are read from the environment.
    const py = ["class Settings(BaseSettings):", "    SECRET_KEY: str", "    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8", "    def all_cors(self) -> list[str]:"].join("\n");
    expect(settingTexts(py).map((h) => h.text.split(":")[0])).toEqual(["SECRET_KEY", "ACCESS_TOKEN_EXPIRE_MINUTES"]);
    expect(settingTexts("class Item(BaseModel):\n    TITLE: str").length).toBe(0);
    expect(extractTexts("src/app/api/send/route.ts", "TypeScript", code).filter((h) => h.kind === "setting")).toHaveLength(5);
  });
});

describe("a catalog kept in many languages", () => {
  it("is indexed once, as its base language: English when there is one", () => {
    const paths = [
      "public/intl/messages/ar-SA.json", "public/intl/messages/en-US.json", "public/intl/messages/he-IL.json", "public/intl/messages/en-GB.json",
      "locales/fr/common.json", "locales/en/common.json", "locales/de/common.json",
      "app/src/main/res/values/strings.xml", "app/src/main/res/values-hi/strings.xml",
      "ios/fr.lproj/Localizable.strings", "ios/Base.lproj/Localizable.strings",
      "src/api.ts", "src/app.ts", "src/cli.ts", "src/i18n/index.ts",
    ];
    expect([...translationsOf(paths)].sort()).toEqual([
      "app/src/main/res/values-hi/strings.xml", "ios/fr.lproj/Localizable.strings", "locales/de/common.json", "locales/fr/common.json",
      "public/intl/messages/ar-SA.json", "public/intl/messages/en-GB.json", "public/intl/messages/he-IL.json",
    ]);
    expect(catalogsOf(paths)[0]).toEqual({ base: "public/intl/messages/en-US.json", copies: ["public/intl/messages/ar-SA.json", "public/intl/messages/en-US.json", "public/intl/messages/he-IL.json", "public/intl/messages/en-GB.json"] });
    // One language alone is the base itself.
    expect(translationsOf(["locales/en.json"]).size).toBe(0);
  });

  it("over the cap, keeps what the code says before catalog entries", () => {
    const t = [{ kind: "i18n" as const, n: 1 }, { kind: "i18n" as const, n: 2 }, { kind: "jsx" as const, n: 3 }, { kind: "setting" as const, n: 4 }];
    expect(keepTexts(t, 2).map((x) => x.n)).toEqual([4, 3]);
    expect(keepTexts(t, 9).map((x) => x.n)).toEqual([1, 2, 3, 4]);
  });
});

describe("what a message names exactly", () => {
  it("is found before the model looks: every place a quoted message or a named setting is written, and those lines may be cited", async () => {
    const texts = [
      { path: "apis/record_auth_with_password.go", line: 93, text: "Failed to authenticate.", kind: "message" },
      { path: "apis/record_auth_with_oauth2.go", line: 156, text: "Failed to authenticate.", kind: "message" },
      { path: "apis/other.go", line: 9, text: "Failed to load the settings.", kind: "message" },
      { path: "src/app/api/send/route.ts", line: 156, text: "SALT_ROTATION: an environment setting the code reads here", kind: "setting" },
    ];
    const brain = { findTexts: async (q: string) => texts.filter((t) => t.text.toLowerCase().includes(q.toLowerCase().split(" ")[0]!)) } as never;
    const a = new Anchors();
    const found = await namedIn(brain, "users get 'Failed to authenticate.' where does that come from? and what reads SALT_ROTATION?", a);
    expect(found.split("\n").slice(1)).toEqual([
      'apis/record_auth_with_password.go:93 "Failed to authenticate."', 'apis/record_auth_with_oauth2.go:156 "Failed to authenticate."',
      'src/app/api/send/route.ts:156 "SALT_ROTATION: an environment setting the code reads here"',
    ]);
    expect(checkCitations("It is at apis/record_auth_with_password.go:93.", a).kept).toEqual(["apis/record_auth_with_password.go:93"]);
    // An apostrophe inside words is no quote; nothing named, nothing looked up.
    expect(await namedIn(brain, "it's not working and I don't know why", new Anchors())).toBe("");
  });
});
