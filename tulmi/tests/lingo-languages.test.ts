/**
 * THE LANGUAGE PICKER (src/lingo/languages.ts):
 *
 *   - the list and the search live on the SERVER, so adding a language is a deploy and not an app release
 *   - every language is named in ITSELF as well as in English, and is findable by either, because somebody looks
 *     for the word they call their own language by
 *   - search folds both sides through the same folding that marks an answer, so "espanol" finds Español and
 *     "turkce" finds Türkçe — the marks over letters can never hide a match
 *   - a name covering more than one language is TWO ROWS (Mandarin and Cantonese, Brazil and Portugal, Bokmål and
 *     Nynorsk), so the choice is made where it is visible instead of asked afterwards
 *   - the language they already speak is never offered as one to learn
 *   - ranked, because a picker that puts the right answer third is a worse picker
 */
import { describe, expect, it } from "vitest";
import { all, LANGUAGES, languageOf, search, suggested } from "../src/lingo/languages.js";

describe("the list itself", () => {
  it("names every language in itself and in English, with a tag", () => {
    for (const l of LANGUAGES) {
      expect(l.tag, l.en).toMatch(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/);
      expect(l.name.trim(), l.tag).not.toBe("");
      expect(l.en.trim(), l.tag).not.toBe("");
    }
  });

  it("has no tag twice", () => {
    const tags = LANGUAGES.map((l) => l.tag.toLowerCase());
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("splits a name that covers more than one language into two rows", () => {
    expect(search("chinese").map((l) => l.tag)).toEqual(expect.arrayContaining(["zh", "yue"]));
    expect(search("portuguese").map((l) => l.tag)).toEqual(expect.arrayContaining(["pt-BR", "pt-PT"]));
    expect(search("norwegian").map((l) => l.tag)).toEqual(expect.arrayContaining(["nb", "nn"]));
  });

  it("looks one up by tag, and says no to one it does not have", () => {
    expect(languageOf("ta")?.en).toBe("Tamil");
    expect(languageOf("TA")?.en).toBe("Tamil");
    expect(languageOf("zz")).toBeNull();
  });
});

describe("finding one", () => {
  it("finds it by what English calls it", () => {
    expect(search("spanish")[0]!.tag).toBe("es");
    expect(search("japanese")[0]!.tag).toBe("ja");
  });

  it("finds it by what the language calls itself", () => {
    expect(search("deutsch")[0]!.tag).toBe("de");
    expect(search("español")[0]!.tag).toBe("es");
    expect(search("தமிழ்")[0]!.tag).toBe("ta");
    expect(search("日本語")[0]!.tag).toBe("ja");
    expect(search("العربية")[0]!.tag).toBe("ar");
  });

  it("does not let the marks over letters hide a match", () => {
    expect(search("espanol")[0]!.tag).toBe("es");
    expect(search("turkce")[0]!.tag).toBe("tr");
    expect(search("francais")[0]!.tag).toBe("fr");
    expect(search("cestina")[0]!.tag).toBe("cs");
    expect(search("romana")[0]!.tag).toBe("ro");
  });

  it("finds it by the other names people use", () => {
    expect(search("mandarin")[0]!.tag).toBe("zh");
    expect(search("farsi")[0]!.tag).toBe("fa");
    expect(search("castellano")[0]!.tag).toBe("es");
    expect(search("tagalog")[0]!.tag).toBe("fil");
    expect(search("bangla")[0]!.tag).toBe("bn");
  });

  it("puts the exact tag first", () => {
    expect(search("es")[0]!.tag).toBe("es");
    expect(search("ta")[0]!.tag).toBe("ta");
  });

  it("prefers a name that starts with what was typed over one that merely contains it", () => {
    // "Malay" starts with it; "Malayalam" also does; both beat anything that only contains "mala".
    const got = search("malay").map((l) => l.tag);
    expect(got.slice(0, 2).sort()).toEqual(["ml", "ms"]);
  });

  it("matches a word inside a longer name", () => {
    expect(search("brasil").map((l) => l.tag)).toContain("pt-BR");
    expect(search("indonesia").map((l) => l.tag)).toContain("id");
  });

  it("finds nothing for nonsense, rather than everything", () => {
    expect(search("qqqqzzz")).toEqual([]);
  });

  it("shows everything when nothing is typed", () => {
    expect(search("", { limit: 500 }).length).toBe(LANGUAGES.length);
  });

  it("is in the same order between keystrokes", () => {
    expect(search("por").map((l) => l.tag)).toEqual(search("por").map((l) => l.tag));
  });
});

describe("what it leaves out", () => {
  it("never offers the language they already speak", () => {
    expect(all("en").some((l) => l.tag === "en")).toBe(false);
    expect(search("english", { from: "en" })).toEqual([]);
    expect(suggested("es").some((l) => l.tag === "es")).toBe(false);
  });

  it("suggests a short list, not eighty", () => {
    expect(suggested("en").length).toBeLessThanOrEqual(8);
    expect(suggested("en").length).toBeGreaterThan(3);
  });
});
