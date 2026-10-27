/**
 * PDFs WITH A TEXT LAYER, READ IN NODE: unpdf (MIT, pinned), which is pdf.js built to run without a browser.
 *
 * A PDF made by a word processor or a browser carries its text; unpdf reads it page by page for the price of the CPU time, no model and no
 * network. Two kinds of PDF it cannot do justice to are sent on to the worker (Docling, a layout and table reader with OCR):
 *
 *   scanned   pages that are pictures of text: almost no characters come out (under 40 a page on average)
 *   garbled   a text layer of broken glyphs: a fifth or more of what comes out is replacement and control characters
 *
 * `looksHard()` says which. A password-protected PDF is refused with a plain sentence, and a damaged one is told apart from it. Nothing in
 * a PDF is executed: pdf.js is only asked for text, with scripting and fonts' remote loading off.
 */
import { MediaError } from "./types.js";

export const PDF_PAGES_MAX = 1000;
const READ_MS = 60_000;

export interface PdfText {
  /** The text of each page, in order. */
  pages: string[];
  numPages: number;
}

/** Lets go of what pdf.js holds for a document. A failure to is not worth failing the read for. */
const free = async (doc: { loadingTask?: { destroy(): Promise<void> } }): Promise<void> => {
  try { await doc.loadingTask?.destroy(); } catch { /* nothing to do */ }
};

const tidy = (s: string): string => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export async function readPdf(data: Buffer): Promise<PdfText> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let timer: NodeJS.Timeout | undefined;
  try {
    const run = (async () => {
      const doc = await getDocumentProxy(new Uint8Array(data), { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 } as never);
      if (doc.numPages > PDF_PAGES_MAX) {
        await free(doc);
        throw new MediaError("too_long", `That PDF has ${doc.numPages} pages, and I read ${PDF_PAGES_MAX} at most. Send the part you want asked about.`);
      }
      const r = await extractText(doc, { mergePages: false });
      await free(doc);
      return { pages: r.text.map(tidy), numPages: r.totalPages };
    })();
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MediaError("failed", "That PDF took too long to read.", 504)), READ_MS); });
    return await Promise.race([run, limit]);
  } catch (err) {
    if (err instanceof MediaError) throw err;
    const name = (err as { name?: string } | null)?.name ?? "";
    if (name === "PasswordException") throw new MediaError("password", "That PDF is password-protected. I can't open it. Take the password off and send it again.");
    throw new MediaError("corrupt", "That PDF is damaged, so I could not read its text.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whether the text that came out of a PDF is too little or too broken to trust: the file belongs with the layout reader. */
export function looksHard(pages: readonly string[]): { hard: boolean; why: string } {
  const chars = pages.reduce((n, p) => n + p.length, 0);
  if (!pages.length || chars / pages.length < 40) return { hard: true, why: "scanned" };
  // eslint-disable-next-line no-control-regex
  const bad = pages.join("").match(/[�\u0000-\u0008\u000E-\u001F-]/g)?.length ?? 0;
  if (bad / chars >= 0.2) return { hard: true, why: "garbled" };
  return { hard: false, why: "" };
}
