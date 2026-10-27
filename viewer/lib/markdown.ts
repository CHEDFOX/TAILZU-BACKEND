/**
 * A small Markdown renderer: markdown in, safe HTML out.
 *
 * Headings (ATX and setext), paragraphs, bold/italic/strike/inline code, fenced and indented code, block quotes, ordered,
 * unordered and task lists (nested), tables with alignment, rules, links, images and autolinks.
 *
 * There is NO raw HTML: every `<` and `&` the author wrote is text. Links may only be https:, http:, mailto: or `#anchor`
 * and carry `rel="noopener noreferrer nofollow"`; images may only be https: or a data: image. It never throws, and a
 * half-written document (a fence not closed yet, an unclosed `**`) renders as what it has so far.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Escape text, but keep character references the author wrote on purpose (&copy; &#169;). */
const escapeText = (s: string): string =>
  s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function safeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  const flat = url.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (flat.startsWith("#")) return url;
  if (/^https?:\/\/[^\s]/.test(flat) || /^mailto:[^\s]/.test(flat)) return url;
  return null;
}

export function safeImageUrl(raw: string): string | null {
  const url = raw.trim();
  const flat = url.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (/^https:\/\/[^\s]/.test(flat)) return url;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);/.test(flat)) return url;
  return null;
}

// ------------------------------------------------------------------------------------------------ inline

const PH = "\u0001";
const PH_END = "\u0002";

function inline(text: string): string {
  const store: string[] = [];
  const hold = (html: string): string => {
    store.push(html);
    return `${PH}${store.length - 1}${PH_END}`;
  };

  let s = text;
  // Code spans first: nothing inside them is markup.
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, code: string) => {
    let c = code.replace(/\n/g, " ");
    if (c.length > 2 && c.startsWith(" ") && c.endsWith(" ") && c.trim()) c = c.slice(1, -1);
    return hold(`<code>${escapeHtml(c)}</code>`);
  });
  // Backslash escapes.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>&"'])/g, (_m, ch: string) => hold(escapeHtml(ch)));
  // Images, then links (the text of a link is itself inline markup).
  s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (_m, alt: string, url: string, t1?: string, t2?: string) => {
    const safe = safeImageUrl(url);
    const title = t1 ?? t2;
    if (!safe) return hold(escapeHtml(alt));
    return hold(`<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" decoding="async" referrerpolicy="no-referrer">`);
  });
  s = s.replace(/\[([^\]\n]+)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (_m, label: string, url: string, t1?: string, t2?: string) => {
    const safe = safeLinkUrl(url);
    const inner = inline(label);
    if (!safe) return hold(inner);
    const title = t1 ?? t2;
    return hold(`<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""} rel="noopener noreferrer nofollow" target="_blank">${inner}</a>`);
  });
  // <https://autolinks> and bare https:// URLs.
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_m, url: string) => {
    const safe = safeLinkUrl(url);
    return safe ? hold(`<a href="${escapeHtml(safe)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(url)}</a>`) : hold(escapeHtml(`<${url}>`));
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (_m, pre: string, url: string) => {
    const safe = safeLinkUrl(url);
    return safe ? `${pre}${hold(`<a href="${escapeHtml(safe)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(url)}</a>`)}` : _m;
  });

  s = escapeText(s);

  // Emphasis. Unclosed markers stay as text, which is what a half-written document needs.
  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");

  // Hard line breaks.
  s = s.replace(/(?: {2,}|\\)\n/g, "<br>\n");

  // Put the held pieces back (a held piece may hold others: link text).
  for (let pass = 0; pass < 4 && s.includes(PH); pass++) {
    s = s.replace(/\u0001(\d+)\u0002/g, (_m, k: string) => store[Number(k)] ?? "");
  }
  return s.replace(/[\u0001\u0002]/g, "");
}

// ------------------------------------------------------------------------------------------------ blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BQ = /^ {0,3}>[ ]?(.*)$/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const isBlank = (l: string): boolean => l.trim() === "";

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i]!;
    if (c === "\\" && l[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || ATX.test(line) || HR.test(line) || BQ.test(line) || /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/.test(line);
}

function slugify(text: string, seen: Map<string, number>): string {
  const base = text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function blocks(lines: string[], seen: Map<string, number>, depth: number): string {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    // Fenced code. An unclosed fence runs to the end: the document is still being written.
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const lang = fence[2] ?? "";
      const indent = /^ */.exec(line)![0].length;
      const body: string[] = [];
      const closing = new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
      const dedent = new RegExp(`^ {0,${indent}}`);
      i++;
      while (i < n && !closing.test(lines[i]!)) {
        body.push(lines[i]!.replace(dedent, ""));
        i++;
      }
      i++; // the closing fence
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang.replace(/[^\w+#.-]/g, ""))}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      const level = atx[1]!.length;
      const text = (atx[2] ?? "").trim();
      out.push(`<h${level} id="${escapeHtml(slugify(text, seen))}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // Block quote.
    if (BQ.test(line)) {
      const inner: string[] = [];
      while (i < n) {
        const m = BQ.exec(lines[i]!);
        if (m) inner.push(m[1]!);
        else if (!isBlank(lines[i]!) && !startsBlock(lines[i]!) && inner.length && !isBlank(inner[inner.length - 1]!)) inner.push(lines[i]!); // lazy continuation
        else break;
        i++;
      }
      out.push(`<blockquote>${depth < 12 ? blocks(inner, seen, depth + 1) : escapeHtml(inner.join("\n"))}</blockquote>`);
      continue;
    }
    // Table: a header row, then a separator row.
    if (line.includes("|") && i + 1 < n && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      const head = splitRow(line);
      const sep = splitRow(lines[i + 1]!);
      if (head.length === sep.length) {
        const align = sep.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
        const cell = (tag: string, text: string, k: number): string => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(text)}</${tag}>`;
        const rows: string[] = [];
        i += 2;
        while (i < n && !isBlank(lines[i]!) && lines[i]!.includes("|") && !startsBlock(lines[i]!)) {
          const cells = splitRow(lines[i]!);
          rows.push(`<tr>${head.map((_, k) => cell("td", cells[k] ?? "", k)).join("")}</tr>`);
          i++;
        }
        out.push(`<div class="tz-table"><table><thead><tr>${head.map((h, k) => cell("th", h, k)).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`);
        continue;
      }
    }
    // List.
    const li = LIST.exec(line);
    if (li && !HR.test(line)) {
      const ordered = /\d/.test(li[2]!);
      const marker = ordered ? li[2]!.slice(-1) : li[2]!;
      const start = ordered ? parseInt(li[2]!, 10) : 1;
      const items: string[][] = [];
      let loose = false;
      while (i < n) {
        const m = LIST.exec(lines[i]!);
        if (!m || HR.test(lines[i]!) || (ordered ? !/\d/.test(m[2]!) || m[2]!.slice(-1) !== marker : m[2] !== marker) || m[1]!.length >= 4) break;
        const contentIndent = m[1]!.length + m[2]!.length + Math.min(Math.max(m[3]!.length, 1), 4);
        const item: string[] = [m[4]!];
        i++;
        while (i < n) {
          const l = lines[i]!;
          if (isBlank(l)) {
            // A blank line stays in the item only if an indented line follows.
            let k = i + 1;
            while (k < n && isBlank(lines[k]!)) k++;
            if (k < n && /^ +/.test(lines[k]!) && /^ */.exec(lines[k]!)![0].length >= contentIndent) {
              item.push("");
              i++;
              continue;
            }
            if (k < n && LIST.test(lines[k]!) && !HR.test(lines[k]!) && /^ */.exec(lines[k]!)![0].length < contentIndent) loose = true;
            break;
          }
          const lead = /^ */.exec(l)![0].length;
          if (lead >= contentIndent) {
            item.push(l.slice(contentIndent));
            i++;
          } else if (!startsBlock(l) && !LIST.test(l) && !isBlank(item[item.length - 1]!)) {
            item.push(l.trim()); // lazy continuation of the paragraph
            i++;
          } else break;
        }
        items.push(item);
        while (i < n && isBlank(lines[i]!)) {
          let k = i;
          while (k < n && isBlank(lines[k]!)) k++;
          if (k < n && LIST.test(lines[k]!) && !HR.test(lines[k]!)) {
            const m2 = LIST.exec(lines[k]!)!;
            if (m2[1]!.length < 4 && (ordered ? /\d/.test(m2[2]!) : m2[2] === marker)) loose = true;
          }
          break;
        }
        while (i < n && isBlank(lines[i]!)) i++;
      }
      const tag = ordered ? "ol" : "ul";
      const html = items
        .map((item) => {
          let first = item[0] ?? "";
          let task = "";
          const t = /^\[([ xX])\][ \t]+/.exec(first);
          if (t) {
            task = `<input type="checkbox" disabled${t[1] !== " " ? " checked" : ""}> `;
            first = first.slice(t[0].length);
          }
          const inner = depth < 12 ? blocks([first, ...item.slice(1)], seen, depth + 1) : escapeHtml(item.join("\n"));
          // A tight list's paragraphs are the item's text, with no <p>.
          const body = loose ? inner : inner.replace(/(^|\n)<p>([\s\S]*?)<\/p>/g, "$1$2");
          return `<li${task ? ' class="task"' : ""}>${task}${body}</li>`;
        })
        .join("");
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${html}</${tag}>`);
      continue;
    }
    // Indented code.
    if (/^( {4}|\t)/.test(line)) {
      const body: string[] = [];
      while (i < n && (/^( {4}|\t)/.test(lines[i]!) || (isBlank(lines[i]!) && i + 1 < n && /^( {4}|\t)/.test(lines[i + 1]!)))) {
        body.push(lines[i]!.replace(/^( {4}|\t)/, ""));
        i++;
      }
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Paragraph (or a setext heading).
    const para: string[] = [line];
    i++;
    let setext = 0;
    while (i < n && !isBlank(lines[i]!)) {
      const l = lines[i]!;
      if (/^ {0,3}=+[ \t]*$/.test(l)) {
        setext = 1;
        i++;
        break;
      }
      if (/^ {0,3}-+[ \t]*$/.test(l)) {
        setext = 2;
        i++;
        break;
      }
      // Only a list that starts at 1 can interrupt a paragraph; other numbers are text.
      const midNumber = /^ {0,3}(?!1[.)])\d{1,9}[.)][ \t]+\S/.test(l);
      if (!midNumber && startsBlock(l)) break;
      if (l.includes("|") && i + 1 < n && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-") && splitRow(l).length === splitRow(lines[i + 1]!).length) break;
      para.push(l);
      i++;
    }
    // Keep a line's trailing spaces (two make a hard break); only the last line is trimmed at the end.
    const text = para.map((l) => l.replace(/^\s+/, "")).join("\n").trimEnd();
    if (setext) out.push(`<h${setext} id="${escapeHtml(slugify(text, seen))}">${inline(text)}</h${setext}>`);
    else out.push(`<p>${inline(text)}</p>`);
  }
  return out.join("\n");
}

/** Markdown → HTML (a fragment, safe to set as innerHTML). */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return `<article class="tz-md">${blocks(lines, new Map(), 0)}</article>`;
}
