/**
 * POUR A SENTENCE BANK IN, from a public corpus, for one pair of languages.
 *
 *   npx tsx scripts/lingo-seed.ts --lang es --gloss en --file ~/tatoeba-es-en.tsv [--licence CC0-1.0] [--dry]
 *
 * WHERE THE FILE COMES FROM. Tatoeba's Downloads page has a "Custom exports > Sentence pairs" tool: pick the
 * sentence language and the translation language and it gives a TSV. Its columns are
 *
 *     <id>  <sentence>  <id>  <translation>            and with "include usernames" on, each id is followed by its author:
 *     <id>  <author>  <sentence>  <id>  <author>  <translation>
 *
 * Both shapes are read. Any TSV with a sentence and its translation on a line works, so this is not really about
 * one corpus; `--licence` says what the file you downloaded is under.
 *
 * WHAT IS REFUSED, and why it matters more than it looks. A corpus is thousands of people's writing, each under
 * whatever licence they chose, and only some of those may appear in something people pay for. The decision is
 * src/lingo/sentences.ts `usable()` and nothing here argues with it: a row whose licence is not on that list is
 * counted and dropped. Pass the licence that is actually on the file you downloaded — the default is the strictest
 * useful one, not the commonest.
 *
 * Nothing here is anybody's data: these rows have no owner and are shared by every learner (migration 0089).
 * Safe to run again: the same sentence twice is one row.
 */
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { sentenceBank, usable, type NewSentence } from "../src/lingo/sentences.js";

interface Args { lang: string; gloss: string; file: string; licence: string; source: string; limit: number; dry: boolean }

function args(argv: readonly string[]): Args | null {
  const get = (k: string): string => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : "";
  };
  const a: Args = {
    lang: get("lang").trim(),
    gloss: get("gloss").trim(),
    file: get("file").trim(),
    licence: get("licence").trim() || "CC0-1.0",
    source: get("source").trim() || "tatoeba",
    limit: Number(get("limit")) > 0 ? Number(get("limit")) : 200_000,
    dry: argv.includes("--dry"),
  };
  return a.lang && a.gloss && a.file && a.lang !== a.gloss ? a : null;
}

/** One line of the file as a pair, or null. Reads the export with usernames and the one without. */
export function readLine(line: string): { text: string; gloss: string; author: string; id: string } | null {
  const c = line.split("\t").map((x) => x.trim());
  if (c.length >= 6 && /^\d+$/.test(c[0] ?? "") && /^\d+$/.test(c[3] ?? "")) {
    return { id: c[0]!, text: c[2] ?? "", gloss: c[5] ?? "", author: c[1] ?? "" };
  }
  if (c.length >= 4 && /^\d+$/.test(c[0] ?? "") && /^\d+$/.test(c[2] ?? "")) {
    return { id: c[0]!, text: c[1] ?? "", gloss: c[3] ?? "", author: "" };
  }
  return null;
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  if (!a) {
    console.error("usage: npx tsx scripts/lingo-seed.ts --lang <tag> --gloss <tag> --file <tsv> [--licence CC0-1.0] [--source tatoeba] [--limit n] [--dry]");
    process.exit(2);
  }
  if (!usable(a.licence)) {
    console.error(`Refusing: "${a.licence}" is not a licence this may be shown under (src/lingo/sentences.ts usable()).`);
    console.error('Use the licence actually on the file you downloaded. Tatoeba\'s CC0 export is "CC0-1.0"; its main corpus is "CC-BY-2.0-FR" and needs the author column.');
    process.exit(2);
  }

  const bank = sentenceBank();
  const before = await bank.count(a.lang, a.gloss).catch(() => 0);
  const rl = createInterface({ input: createReadStream(a.file, { encoding: "utf8" }), crlfDelay: Infinity });

  let read = 0, skipped = 0, added = 0;
  let batch: NewSentence[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    added += a.dry ? batch.length : await bank.put(a.lang, a.gloss, batch, Date.now());
    batch = [];
  };

  for await (const line of rl) {
    if (read >= a.limit) break;
    const got = readLine(line);
    if (!got || !got.text || !got.gloss) { skipped++; continue; }
    read++;
    batch.push({ text: got.text, gloss: got.gloss, words: 0, licence: a.licence, author: got.author, source: `${a.source}#${got.id}` });
    if (batch.length >= 500) await flush();
  }
  await flush();

  const after = a.dry ? before : await bank.count(a.lang, a.gloss).catch(() => before);
  console.log(`${a.lang} from ${a.gloss}: read ${read}, unreadable ${skipped}, ${a.dry ? "would add" : "added"} ${added}. Bank ${before} -> ${after}.`);
  if (a.dry) console.log("Nothing was written (--dry).");
}

// Only when it is run, never when another file imports readLine (gen-gitleaks.ts does the same).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
