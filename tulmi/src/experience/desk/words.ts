/**
 * Words: the person's vocabulary and snippets.
 */

import type { Personality } from "../../../../shared/types/api.js";
import type { ScreenResponse, ActionRef, Node } from "../../../../shared/types/sdui.js";
import type { DeskContext } from "./context.js";
import { row, stack, text, link, screen, page } from "./kit.js";

// ---- WORDS -----------------------------------------------------------------------------
function vocabularyLines(p: Personality): string[] {
  return String(p.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
function snippetPairs(p: Personality): Array<{ say: string; get: string }> {
  return String(p.snippets ?? "").split(/\r?\n/).map((l) => {
    const i = l.indexOf("=");
    return i > 0 ? { say: l.slice(0, i).trim(), get: l.slice(i + 1).trim().replace(/\\n/g, "\n") } : null;
  }).filter((x): x is { say: string; get: string } => !!x && !!x.say && !!x.get);
}

export function deskWords(ctx: DeskContext): ScreenResponse {
  const p = ctx.personality;
  // The dictionary's pairs are proof marks — what it was heard as, struck,
  // above what it is written as. The vocabulary's lines are words it knows.
  const pairs = (p.dictionary ?? []).filter((d) => d && d.word && d.replacement)
    .map((d) => ({ word: d.replacement, was: d.word, kind: "pair" }));
  // A word already shown as a proof mark is not listed again under it.
  const marked = new Set(pairs.map((x) => x.word.toLowerCase()));
  const vocab = vocabularyLines(p).filter((w) => !marked.has(w.toLowerCase())).map((w) => ({ word: w, was: "", kind: "word" }));
  const words = [...pairs, ...vocab].slice(0, 200);
  const snips = snippetPairs(p);

  const addWord: ActionRef = {
    kind: "callEndpoint", method: "POST", path: "/v1/words", body: { add: "$state.form.word" },
    onError: { kind: "toast", message: "Couldn't add that word" },
  };
  const addSnip: ActionRef = {
    kind: "callEndpoint", method: "POST", path: "/v1/snippets", body: { say: "$state.form.say", get: "$state.form.get" },
    onError: { kind: "toast", message: "Say a name and what it writes, then add" },
  };

  // Rows written out, each with its own values in its action — the same
  // reason as the notes on Today (entryNode): a template's item is gone by
  // the time Remove is clicked, so it removed nothing.
  const wordRow = (w: { word: string; was: string; kind: string }): Node => row([
    stack([
      ...(w.was ? [text(w.was, "d-was")] : []),
      text(w.word, "d-inherit"),
    ], { alignSelf: "flex-start" }, "d-fix"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/words", body: { remove: w.word, kind: w.kind },
      onError: { kind: "toast", message: "Couldn't remove that word" },
    })], {}, "d-tools"),
  ], { justify: "between", align: "center", gap: 14, paddingTop: 14, paddingBottom: 14 }, "d-entry");

  const snipRow = (x: { say: string; get: string }): Node => stack([
    row([text("say", "d-margin", { marginRight: 6 }), text(x.say, "d-say")], { align: "baseline" }),
    text(x.get, "d-get"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/snippets", body: { remove: x.say },
      onError: { kind: "toast", message: "Couldn't remove that snippet" },
    })], { marginTop: 6 }, "d-tools"),
  ], { gap: 4, paddingTop: 14, paddingBottom: 14 }, "d-entry");

  return screen("desk_words", "Words", [page([
    text("Words", "d-eyebrow"),
    text("What X0 Bot knows about your words", "d-h1", { marginTop: 6 }),
    row([
      stack([
        text("Spelled your way", "d-h2"),
        text("Add a name once, or fix it once anywhere, and it is right from then on.", "d-lede", { marginTop: 6 }),
        row([
          { type: "TextField", props: { cls: "d-input", placeholder: "Add a name or a word" }, bind: { value: "form.word" }, on: { onSubmit: addWord } },
          link("Add", addWord, "d-btn"),
        ], { gap: 10, marginTop: 18, marginBottom: 10, align: "center" }),
        ...(words.length
          ? words.map(wordRow)
          : [text("No words yet. Names, places, the words only your team uses: add them here.", "d-lede", { marginTop: 8 })]),
      ], { flex: 1, minWidth: 0 }),
      stack([
        text("Said short, written long", "d-h2"),
        text("Say a snippet's name and the whole thing is written.", "d-lede", { marginTop: 6 }),
        stack([
          { type: "TextField", props: { cls: "d-input", placeholder: "Its name, like my upi" }, bind: { value: "form.say" } },
          { type: "TextField", props: { cls: "d-input", placeholder: "What it writes" }, bind: { value: "form.get" }, on: { onSubmit: addSnip } },
          row([link("Add snippet", addSnip, "d-btn")]),
        ], { gap: 12, marginTop: 18, marginBottom: 10 }),
        ...(snips.length
          ? snips.map(snipRow)
          : [text("No snippets yet. An address, a UPI id, a sign-off you type every day.", "d-lede", { marginTop: 8 })]),
      ], { flex: 1, minWidth: 0 }),
    ], { gap: 64, marginTop: 52, align: "start" }, "d-wrap-narrow"),
  ])], { form: { word: "", say: "", get: "" } });
}
