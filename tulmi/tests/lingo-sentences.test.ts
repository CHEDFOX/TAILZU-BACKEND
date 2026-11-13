/**
 * THE SENTENCE BANK (src/lingo/sentences.ts) AND POURING ONE IN (scripts/lingo-seed.ts):
 *
 *   - THE LICENCE GATE. A corpus is thousands of people's writing under whatever each of them chose, and only some
 *     of it may be shown in something people pay for. A non-commercial clause, a share-alike clause or a blank
 *     licence is refused, and a refused row is never stored — not filtered later, never stored
 *   - who has to be credited, and who asks for nothing
 *   - a word is looked up through the same folding that marks an answer, so the bank and the marking never disagree,
 *     and it works in a script that puts no spaces between its words
 *   - the importer reads both shapes of the export, and pouring the same file in twice adds nothing
 */
import { describe, expect, it } from "vitest";
import { credits, MemorySentenceBank, needsCredit, readyToStore, usable, wordCount, type NewSentence } from "../src/lingo/sentences.js";
import { readLine } from "../scripts/lingo-seed.js";

const row = (over: Partial<NewSentence> = {}): NewSentence =>
  ({ text: "me gustaría un café", gloss: "I would like a coffee", words: 0, licence: "CC0-1.0", author: "", source: "tatoeba#1", ...over });

describe("which licences may be shown in something people pay for", () => {
  it("allows what asks nothing and what only asks to be credited", () => {
    for (const l of ["CC0-1.0", "PD", "CC-BY-2.0", "CC-BY-2.0-FR", "CC-BY-4.0", "cc-by-4.0"]) {
      expect(usable(l), l).toBe(true);
    }
  });

  it("refuses non-commercial, share-alike, no-derivatives and a blank licence", () => {
    for (const l of ["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-SA-4.0", "CC-BY-ND-4.0", "GFDL", "", "   ", "unknown"]) {
      expect(usable(l), l).toBe(false);
    }
  });

  it("never stores a row it may not show", () => {
    expect(readyToStore(row({ licence: "CC-BY-NC-4.0" }))).toBeNull();
    expect(readyToStore(row({ licence: "" }))).toBeNull();
    expect(readyToStore(row({ licence: "CC0-1.0" }))).not.toBeNull();
  });

  it("drops a refused row at the door, rather than keeping it and filtering later", async () => {
    const bank = new MemorySentenceBank();
    const added = await bank.put("es", "en", [
      row({ text: "uno", licence: "CC0-1.0" }),
      row({ text: "dos", licence: "CC-BY-NC-4.0" }),
      row({ text: "tres", licence: "CC-BY-SA-4.0" }),
      row({ text: "cuatro", licence: "" }),
    ], 1);
    expect(added).toBe(1);
    expect(await bank.count("es", "en")).toBe(1);
  });
});

describe("crediting", () => {
  it("knows who asks for nothing and who must be named", () => {
    expect(needsCredit("CC0-1.0")).toBe(false);
    expect(needsCredit("PD")).toBe(false);
    expect(needsCredit("CC-BY-2.0-FR")).toBe(true);
    expect(needsCredit("CC-BY-NC-4.0")).toBe(false); // never shown, so never credited
  });

  it("gathers the names to credit, by corpus, with no repeats", () => {
    const used = [
      { id: 1, text: "a", gloss: "a", words: 1, licence: "CC-BY-2.0-FR", author: "ana", source: "tatoeba#1" },
      { id: 2, text: "b", gloss: "b", words: 1, licence: "CC-BY-2.0-FR", author: "bob", source: "tatoeba#2" },
      { id: 3, text: "c", gloss: "c", words: 1, licence: "CC-BY-2.0-FR", author: "ana", source: "tatoeba#3" },
      { id: 4, text: "d", gloss: "d", words: 1, licence: "CC0-1.0", author: "zoe", source: "tatoeba#4" },
    ];
    expect(credits(used)).toEqual([{ source: "tatoeba", licence: "CC-BY-2.0-FR", authors: ["ana", "bob"] }]);
  });

  it("asks for nobody when nothing shown needed crediting", () => {
    expect(credits([{ id: 1, text: "a", gloss: "a", words: 1, licence: "CC0-1.0", author: "zoe", source: "tatoeba#1" }])).toEqual([]);
  });
});

describe("how long a sentence is", () => {
  it("counts words where the script separates them, and characters where it does not", () => {
    expect(wordCount("me gustaría un café")).toBe(4);
    expect(wordCount("我喜欢咖啡")).toBe(5);
    expect(wordCount("コーヒーが好き")).toBe(7);
    expect(wordCount("   ")).toBe(1);
  });

  it("does not mistake a single word for a spaceless script", () => {
    // The script decides, not whether this particular string happens to hold a space.
    expect(wordCount("Hola")).toBe(1);
    expect(wordCount("gracias")).toBe(1);
  });
});

describe("finding a sentence that uses a word", () => {
  const seed = async () => {
    const bank = new MemorySentenceBank();
    await bank.put("es", "en", [
      row({ text: "Quiero un café", gloss: "I want a coffee" }),
      row({ text: "El café está frío", gloss: "The coffee is cold" }),
      row({ text: "Me gusta el té", gloss: "I like tea" }),
    ], 1);
    return bank;
  };

  it("finds them, shortest first", async () => {
    const got = await (await seed()).using("es", "en", "café", 10);
    expect(got.map((s) => s.text)).toEqual(["Quiero un café", "El café está frío"]);
  });

  it("looks a word up through the same folding that marks an answer", async () => {
    // "cafe" typed without its accent still finds "café": the bank and the marking agree.
    expect((await (await seed()).using("es", "en", "cafe", 10)).length).toBe(2);
  });

  it("works in a script that puts no spaces between its words", async () => {
    const bank = new MemorySentenceBank();
    await bank.put("zh", "en", [row({ text: "我喜欢咖啡", gloss: "I like coffee" }), row({ text: "我喜欢茶", gloss: "I like tea" })], 1);
    expect((await bank.using("zh", "en", "咖啡", 10)).map((s) => s.text)).toEqual(["我喜欢咖啡"]);
  });

  it("takes a word with a percent or an underscore in it literally", async () => {
    const bank = new MemorySentenceBank();
    await bank.put("es", "en", [row({ text: "cien por ciento", gloss: "a hundred per cent" })], 1);
    expect(await bank.using("es", "en", "%", 10)).toEqual([]);
  });

  it("keeps each pair of languages apart", async () => {
    const bank = new MemorySentenceBank();
    await bank.put("es", "en", [row({ text: "café", gloss: "coffee" })], 1);
    await bank.put("fr", "en", [row({ text: "café", gloss: "coffee" })], 1);
    expect(await bank.count("es", "en")).toBe(1);
    expect(await bank.count("fr", "en")).toBe(1);
    expect(await bank.count("de", "en")).toBe(0);
  });

  it("gives back something short enough for a beginner", async () => {
    const bank = new MemorySentenceBank();
    await bank.put("es", "en", [row({ text: "Hola", gloss: "Hi" }), row({ text: "uno dos tres cuatro cinco seis siete", gloss: "one two three four five six seven" })], 1);
    expect((await bank.around("es", "en", 3, 10)).map((s) => s.text)).toEqual(["Hola"]);
  });
});

describe("pouring a corpus in", () => {
  it("reads the export with usernames and the one without", () => {
    expect(readLine("1\tHola\t2\tHello")).toMatchObject({ id: "1", text: "Hola", gloss: "Hello", author: "" });
    expect(readLine("1\tana\tHola\t2\tbob\tHello")).toMatchObject({ id: "1", text: "Hola", gloss: "Hello", author: "ana" });
  });

  it("ignores a line that is not a pair", () => {
    expect(readLine("")).toBeNull();
    expect(readLine("just some words")).toBeNull();
    expect(readLine("# a comment")).toBeNull();
  });

  it("adds nothing the second time the same file is poured in", async () => {
    const bank = new MemorySentenceBank();
    const rows = [row({ text: "Hola", gloss: "Hi" }), row({ text: "Adiós", gloss: "Bye" })];
    expect(await bank.put("es", "en", rows, 1)).toBe(2);
    expect(await bank.put("es", "en", rows, 2)).toBe(0);
    expect(await bank.count("es", "en")).toBe(2);
  });
});
