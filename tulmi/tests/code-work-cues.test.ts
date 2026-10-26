/**
 * The cues in a request (src/code/work/cues.ts), read for nothing: quoted strings, what is the new wording and
 * what is the old, the UI words and the text next to them, identifiers, paths, routes, error lines and stack
 * frames, and the feature nouns. A request with none of these is vague.
 */
import { describe, expect, it } from "vitest";
import { errorMessage, extractCues, hardCues, isVague, looksLikeIdentifier, stem } from "../src/code/work/cues.js";

describe("quoted strings", () => {
  it("takes the strings in quotes as words on a screen, in any quote style, and not the apostrophe in a contraction", () => {
    const c = extractCues(`Change "Create account" and 'Log in' and “Pricing” but don't touch what isn't asked`);
    expect(c.quoted).toEqual(["Create account", "Log in", "Pricing"]);
    expect(c.ui).toBe(true);
  });

  it("keeps the new wording apart from the old: only the old is in the code to be found", () => {
    expect(extractCues(`change the 'Sign up' button to 'Join now'`)).toMatchObject({ quoted: ["Sign up"], replacements: ["Join now"] });
    expect(extractCues(`make the button say "Join now"`)).toMatchObject({ quoted: [], replacements: ["Join now"] });
    expect(extractCues(`the button that says 'Sign up' should say 'Join now'`)).toMatchObject({ quoted: ["Sign up"], replacements: ["Join now"] });
    expect(extractCues(`the placeholder should read 'Your email'`)).toMatchObject({ quoted: [], replacements: ["Your email"] });
  });

  it("a quoted name is an identifier, a quoted path a path and a quoted route a route, and none of them is a string on a screen", () => {
    const c = extractCues("rename 'fetchUsers' in `src/lib/api.ts` and look at '/api/users'");
    expect(c.quoted).toEqual([]);
    expect(c.identifiers).toContain("fetchUsers");
    expect(c.paths).toContain("src/lib/api.ts");
    expect(c.routes).toContain("/api/users");
  });
});

describe("UI words", () => {
  it("reads the words next to a UI word as the text on it, without the filler or the kind of control", () => {
    expect(extractCues("change the Sign up button colour").uiPhrases).toEqual(["Sign up"]);
    expect(extractCues("the email field placeholder is wrong").uiPhrases).toContain("email");
    expect(extractCues("fix the pricing link in the footer").uiPhrases).toContain("pricing");
  });

  it("reads the text a button or a link currently shows from 'that says' and 'called'", () => {
    expect(extractCues("the button that says Get started is cut off").uiPhrases).toContain("Get started");
    expect(extractCues("a link called Pricing goes nowhere").uiPhrases).toContain("Pricing");
  });

  it("marks a request about something a person sees, and one that is not", () => {
    expect(extractCues("make the modal wider").ui).toBe(true);
    expect(extractCues("refactor the retry logic").ui).toBe(false);
    expect(extractCues("make the modal wider").uiWords).toContain("modal");
  });
});

describe("names, paths and routes", () => {
  it("finds camelCase, PascalCase, snake_case and SCREAMING_SNAKE, and leaves product names alone", () => {
    const c = extractCues("handleLogin calls SignupForm and read_user uses API_KEY_NAME; JavaScript and GitHub are not ours");
    expect(c.identifiers).toEqual(expect.arrayContaining(["handleLogin", "SignupForm", "read_user", "API_KEY_NAME"]));
    expect(c.identifiers).not.toContain("JavaScript");
    expect(c.identifiers).not.toContain("GitHub");
  });

  it("takes a single word in backticks as a name, and a call written with its brackets", () => {
    expect(extractCues("`slug` is wrong, and `util.slugify()` too").identifiers).toEqual(expect.arrayContaining(["slug", "slugify"]));
  });

  it("finds paths with an extension, files by name, and folders with a trailing slash; a version or an address is not a path", () => {
    const c = extractCues("see src/lib/api.ts, SignupForm.tsx and package.json, all under src/components/; v1.2.3 and https://example.com/a.html are not");
    expect(c.paths).toEqual(expect.arrayContaining(["src/lib/api.ts", "SignupForm.tsx", "package.json"]));
    expect(c.dirs).toContain("src/components");
    expect(c.paths.join(" ")).not.toMatch(/1\.2\.3|example\.com/);
    expect(c.extensions).toEqual(expect.arrayContaining(["ts", "tsx", "json"]));
  });

  it("finds routes, with a verb in front or without, and does not take 'and/or' or a path with an extension for one", () => {
    const c = extractCues("POST /api/users should validate, and GET /orders/:id too; use this and/or that, not /etc/app.conf");
    expect(c.routes).toEqual(expect.arrayContaining(["/api/users", "/orders/:id"]));
    expect(c.routes.join(" ")).not.toMatch(/and\/or|app\.conf/);
  });
});

describe("errors and stack frames", () => {
  const trace = [
    "TypeError: Cannot read properties of undefined (reading 'email')",
    "    at validate (src/lib/validate.ts:12:9)",
    "    at SignupForm (webpack://app/./src/components/SignupForm.tsx:20:5)",
    "    at node_modules/react-dom/cjs/react-dom.development.js:100:1",
  ].join("\n");

  it("reads an error line and the frames out of a pasted trace, in order, without a frame inside node_modules", () => {
    const c = extractCues(`it crashes\n${trace}`);
    expect(c.errors[0]).toMatch(/^TypeError: Cannot read properties/);
    expect(c.frames).toEqual([{ path: "src/lib/validate.ts", line: 12 }, { path: "src/components/SignupForm.tsx", line: 20 }]);
  });

  it("only the function the error came from is a name to look for: the callers are found by their files", () => {
    expect(extractCues(trace).identifiers).toEqual(["validate"]);
  });

  it("reads a Python traceback and a TypeScript compiler error", () => {
    const py = extractCues('Traceback (most recent call last):\n  File "api/main.py", line 7, in read_item\nKeyError: "id"');
    expect(py.frames).toEqual([{ path: "api/main.py", line: 7 }]);
    expect(py.identifiers).toContain("read_item");
    expect(extractCues("src/a.ts(3,4): error TS2345: Argument of type 'x' is not assignable").errors[0]).toMatch(/TS2345/);
  });

  it("the words of an error without its type, to be looked for as text", () => {
    expect(errorMessage("TypeError: Invalid email address")).toBe("Invalid email address");
    expect(errorMessage("Uncaught Error: Payment failed")).toBe("Payment failed");
  });

  it("the nouns do not include the words of paths, frames or error lines", () => {
    const c = extractCues(`checkout is broken\n${trace}`);
    expect(c.nouns).toEqual(["checkout"]);
  });
});

describe("nouns, and vague requests", () => {
  it("keeps the feature words, singular, in the order said, and drops the filler and the UI words", () => {
    const c = extractCues("Please change the settings page so the users can update their notifications");
    expect(c.nouns).toEqual(["setting", "user", "update", "notification"].filter((w) => c.nouns.includes(w)));
    expect(c.nouns).toEqual(expect.arrayContaining(["setting", "notification"]));
    expect(c.nouns).not.toContain("please");
    expect(c.nouns).not.toContain("page");
    expect(c.phrase.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("stem makes a plural findable by a prefix search", () => {
    expect(stem("settings")).toBe("setting");
    expect(stem("categories")).toBe("category");
    expect(stem("status")).toBe("status");
    expect(stem("address")).toBe("address");
  });

  it("a request with nothing in it that points anywhere is vague", () => {
    expect(isVague(extractCues("make it better"))).toBe(true);
    expect(isVague(extractCues("fix it please"))).toBe(true);
    expect(isVague(extractCues("improve the settings"))).toBe(false);
    expect(hardCues(extractCues("rename fetchUsers"))).toBe(1);
  });

  it("looksLikeIdentifier tells a name from words", () => {
    for (const n of ["handleLogin", "SignupForm", "user_id", "API_KEY"]) expect(looksLikeIdentifier(n), n).toBe(true);
    for (const n of ["Sign up", "settings", "Hello", "two words"]) expect(looksLikeIdentifier(n), n).toBe(false);
  });

  it("is safe on anything it is given", () => {
    expect(() => extractCues("")).not.toThrow();
    expect(() => extractCues("x".repeat(20_000))).not.toThrow();
    expect(extractCues(undefined as unknown as string).nouns).toEqual([]);
  });
});
