/**
 * THE FLOOR: WHAT A PAGE MUST BE WHATEVER ITS DESIGN SAYS, CHECKED ON THE PAGE AS A BROWSER RENDERED IT.
 *
 * The design round asks "does this match the design they approved" (design.ts), and the screens round shows the person what
 * was built (screens.ts). Both are about the LOOK. Neither asks whether the thing is usable at all, and a request almost never
 * says: nobody writes "and put a viewport tag in, and give the inputs labels". Those are the things everyone wants and nobody
 * specifies, so they are the floor, and the floor is CHECKED rather than hoped for.
 *
 * ON THE RENDERED PAGE, NOT ON THE CODE. A project may be React, Next, Vue, Svelte or a template language, and each writes an
 * image a different way; the browser has already turned all of them into one HTML, which is what the person's phone will get.
 * So this reads the page the screens round already opened for its pictures and costs nothing more: no model, no second run, and
 * no dependency (regexes over the rendered HTML, as `web/extract.ts` reads a page).
 *
 * WHAT IT CHECKS, and why each is the floor and not a taste:
 *
 *   no viewport meta       the single biggest cause of a page that is unusable on a phone: it is drawn at desktop width and
 *                          scaled down, so every word is too small to read. Nobody asks for it; everybody wants it
 *   an image with no alt   a person using a screen reader is told "image" and nothing else. `alt=""` is NOT a fault: that is
 *                          how a decorative image is marked, and saying so is the author having decided
 *   a field with no label  a form nobody can fill in without seeing it. Any of a label, aria-label, aria-labelledby or title
 *                          counts: this asks for one, not for a particular one
 *   a control with no name an icon-only button with no text and no aria-label is a button a screen reader cannot announce
 *   no lang on <html>      what voice reads the page, and how quotes and hyphenation are drawn
 *   a heading level skipped  h1 then h3 is a document whose outline is wrong, which is what navigation by heading uses
 *
 * WHAT IT IS NOT. Not a verdict on the design, not a style opinion, and NEVER A BLOCK: it is reported with the screens, and
 * the person decides. The deeper half of a floor — the contrast of rendered text, a visible focus ring, overflow at phone
 * width, reduced motion honoured — needs the page's computed styles, which means evaluating script in the page; the CDP client
 * can do it where a real Chrome is running but not on every path, so it is not here yet and is named in the docs instead.
 */

/** A file people see: a component, a page, a template or a stylesheet. */
const UI_FILE = /\.(?:tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|mdx)$/i;
/** Tests, stories and type files are not what people see. */
const NOT_UI = /(?:^|\/)(?:__tests__|tests?|e2e|cypress|\.storybook)\/|\.(?:test|spec|stories|d)\.[a-z]+$/i;

/** Whether a path is a file people look at. The one definition: the screens round filters by it, and the brief below fires on it. */
export const seenByPeople = (path: string): boolean => UI_FILE.test(path) && !NOT_UI.test(path);

/**
 * THE FLOOR, SAID BEFORE THE WORK RATHER THAN AFTER IT.
 *
 * `checkFloor` reads the built page, which is the honest way round but also the late way: what it finds costs a person a line in the report, or the
 * job a round. Telling the model the same floor while it is still writing costs nothing — the block is stable, so a cache keeps it free after the
 * first turn — and the floor is then usually simply there.
 *
 * It says two things, and only for work on files people see:
 *
 *   the floor itself      the six things nobody asks for, so they are built in rather than found missing
 *   the gaps a request leaves  what a screen does while it loads, when it is empty, when it fails, and from a keyboard. A request almost never says,
 *                         and the answer is never "ask": it is the project's own pattern, found and followed
 *
 * NOT A LOOK AND NOT A TASTE. It names no colour, no spacing and no component: the project's own kit is the look, and a model that invents one is
 * the thing to avoid. Empty for work nobody sees, so an ordinary job carries not a word of it.
 */
export function floorBrief(paths: readonly string[]): string {
  if (!paths.some(seenByPeople)) return "";
  return [
    "Some of this is a page people will look at. Whatever its design says, it has to clear the floor, and nobody will think to ask for any of it:",
    'a viewport meta tag that says width=device-width; an alt on every image (alt="" if it is decoration); a label on every field; a name on every',
    "button, the icon-only ones included; lang on <html>; heading levels that do not skip. The running page is read for exactly these after the checks",
    "pass, and whatever is missing goes in the report, so build them in now.",
    "",
    "A request also rarely says what a screen does while it is loading, when it has nothing to show, or when it fails, and it never says how it works",
    "from a keyboard. Those are yours to fill in, not to ask about: find how this project already does them and do it the same way, with its own",
    "components, tokens and styles. Invent no look of your own.",
  ].join("\n");
}

export interface FloorFinding {
  /** The rule, as a short id: "viewport", "img.alt". */
  rule: string;
  /** How many places on the page break it. */
  count: number;
  /** One line a person reads, naming an example. */
  text: string;
}

/** The most places named for one rule. */
export const FLOOR_SHOWN = 3;

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  if (m) return m[2] ?? m[3] ?? m[4] ?? "";
  // A bare attribute, as HTML allows: present with no value.
  return new RegExp(`\\s${name}(?=[\\s/>])`, "i").test(tag) ? "" : null;
};
const has = (tag: string, name: string): boolean => attr(tag, name) !== null;
const said = (v: string | null): boolean => typeof v === "string" && v.trim().length > 0;
const short = (s: string, n = 110): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Every tag of a kind, with its text up to its closing tag when it has one. */
function tags(html: string, name: string): Array<{ tag: string; inner: string }> {
  const out: Array<{ tag: string; inner: string }> = [];
  const open = new RegExp(`<${name}\\b[^>]*>`, "gi");
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tag = m[0];
    const rest = html.slice(m.index + tag.length);
    const close = new RegExp(`</${name}\\s*>`, "i").exec(rest);
    out.push({ tag, inner: close ? rest.slice(0, close.index) : "" });
    if (out.length >= 400) break;
  }
  return out;
}

const textOf = (inner: string): string => inner.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** The ids a `<label for="...">` points at. */
function labelled(html: string): Set<string> {
  const out = new Set<string>();
  for (const { tag } of tags(html, "label")) {
    const f = attr(tag, "for");
    if (said(f)) out.add(f!.trim());
  }
  return out;
}

/** A field inside a `<label>` needs no `for`: these are the stretches of HTML a label wraps. */
function insideLabel(html: string): string[] {
  return tags(html, "label").map((l) => l.inner);
}

/** Fields that do not take a label: a hidden input, and the buttons, which are named by their own text. */
const NO_LABEL_NEEDED = new Set(["hidden", "submit", "button", "reset", "image"]);

/**
 * The floor, over the page as the browser rendered it. Never throws: a page it cannot read is a page with no findings, because
 * this is a courtesy on top of the screens and must not be able to fail a job.
 */
export function checkFloor(html: string): FloorFinding[] {
  const out: FloorFinding[] = [];
  if (typeof html !== "string" || html.length < 20) return out;
  const add = (rule: string, places: string[], line: (n: number, eg: string[]) => string) => {
    if (!places.length) return;
    out.push({ rule, count: places.length, text: line(places.length, places.slice(0, FLOOR_SHOWN)) });
  };

  try {
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html.slice(0, 4000);

    // The viewport: a page without it is drawn at desktop width on a phone and scaled down.
    const viewport = tags(head, "meta").find(({ tag }) => (attr(tag, "name") ?? "").toLowerCase() === "viewport");
    if (!viewport) {
      out.push({ rule: "viewport", count: 1, text: "The page has no viewport meta tag, so a phone draws it at desktop width and scales it down: every word comes out too small to read." });
    } else if (!/width\s*=\s*device-width/i.test(attr(viewport.tag, "content") ?? "")) {
      out.push({ rule: "viewport", count: 1, text: "The viewport meta tag does not say width=device-width, so a phone does not draw the page at its own width." });
    }

    // The language: what voice reads it, and how its quotes and hyphens are drawn.
    const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0];
    if (htmlTag && !said(attr(htmlTag, "lang"))) {
      out.push({ rule: "lang", count: 1, text: "The <html> tag has no lang, so a screen reader does not know what language to read it in." });
    }

    // Images with nothing to say for themselves. alt="" is a decision, not a fault: that is how a decorative image is marked.
    const hidden = (tag: string): boolean => {
      const role = (attr(tag, "role") ?? "").toLowerCase();
      // Marked as decoration or hidden from a screen reader: the author has decided, which is all this asks for.
      return role === "presentation" || role === "none" || (attr(tag, "aria-hidden") ?? "").toLowerCase() === "true";
    };
    const noAlt = tags(html, "img").filter(({ tag }) => !has(tag, "alt") && !said(attr(tag, "aria-label")) && !hidden(tag))
      .map(({ tag }) => short(attr(tag, "src") ?? tag, 70));
    add("img.alt", noAlt, (n, eg) => `${n} image${n === 1 ? "" : "s"} have no alt at all (${eg.join(", ")}), so a screen reader says only "image". Write what it shows, or alt="" if it is decoration.`);

    // Fields nobody can fill in without seeing them.
    const forIds = labelled(html);
    const wrapped = insideLabel(html).join("\n");
    const noLabel: string[] = [];
    for (const name of ["input", "select", "textarea"]) {
      for (const { tag } of tags(html, name)) {
        const type = (attr(tag, "type") ?? "").toLowerCase();
        if (name === "input" && NO_LABEL_NEEDED.has(type)) continue;
        if (said(attr(tag, "aria-label")) || said(attr(tag, "aria-labelledby")) || said(attr(tag, "title"))) continue;
        const id = attr(tag, "id");
        if (said(id) && forIds.has(id!.trim())) continue;
        // Inside a <label>, which needs no `for`. Two fields written identically, one wrapped and one not, excuse each other: this errs towards silence.
        if (wrapped.includes(tag)) continue;
        noLabel.push(short(said(id) ? `#${id}` : (attr(tag, "name") ?? tag), 50));
      }
    }
    add("field.label", noLabel, (n, eg) => `${n} field${n === 1 ? "" : "s"} have no label (${eg.join(", ")}): no <label>, aria-label, aria-labelledby or title. A form nobody can fill in without seeing it.`);

    // A control a screen reader cannot announce.
    const noName: string[] = [];
    for (const { tag, inner } of tags(html, "button")) {
      if (textOf(inner) || said(attr(tag, "aria-label")) || said(attr(tag, "aria-labelledby")) || said(attr(tag, "title"))) continue;
      // An icon with its own alt names the button.
      if (tags(inner, "img").some(({ tag: img }) => said(attr(img, "alt")))) continue;
      noName.push(short(inner || tag, 50));
    }
    add("control.name", noName, (n, eg) => `${n} button${n === 1 ? "" : "s"} have no name (${eg.join(", ")}): no text, no aria-label. A screen reader announces only "button".`);

    // The outline a reader navigates by.
    const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
    const skipped: string[] = [];
    for (let i = 1; i < levels.length; i += 1) {
      const from = levels[i - 1]!;
      const to = levels[i]!;
      if (to > from + 1) skipped.push(`h${from} then h${to}`);
    }
    add("heading.skip", skipped, (n, eg) => `The heading levels skip a step ${n === 1 ? "once" : `${n} times`} (${eg.join(", ")}), so the page's outline is wrong for anyone moving through it by heading.`);
  } catch {
    // A page this cannot read is a page with no findings: the screens are what the round is for.
    return out;
  }
  return out;
}

/** The floor in words, for the report and the pull request. Nothing at all when the page is sound. */
export function floorLines(findings: readonly FloorFinding[]): string[] {
  if (!findings.length) return [];
  return [
    "What the page needs whatever its design says (checked on the page as a browser drew it):",
    ...findings.map((f) => `- ${f.text}`),
  ];
}
