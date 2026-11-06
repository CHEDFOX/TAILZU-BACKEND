/**
 * LINK YOUR CALENDAR FROM A COMPUTER: the page the phone's link page sends Google and Outlook people to (GET /cal, x0bot.com/cal through
 * the site's proxy; docs/plan-ease.md "The work calendar"). Their calendar settings only open on a computer, so the secret address is
 * copied there: pasted here, it is kept sealed for 15 minutes under a 6-number code, which the person types into the same field in
 * X0 Bot on their phone. Nothing is read from the link until a signed-in phone claims it, and a code works once.
 *
 *   /cal          one field: "Paste the link here"
 *   POST /cal     the code, shown big, with how long it lasts; or the field again with what was wrong
 *
 * No sign-in, no script, nothing loaded from anyone but the fonts, and the address never in the page's own address (it is posted).
 */
import { siteShell } from "./policies/shell.js";

export const CAL_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://x0bot.com https://api.x0bot.com",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CSS = `
  .cal { max-width: 600px; }
  .cal h1 { margin-bottom: 14px; }
  .cal .lede { margin-bottom: 30px; }
  .box { background: var(--raise); border: 1px solid var(--rule); border-radius: 22px; padding: 24px; margin: 0 0 32px; display: grid; gap: 16px; }
  .box p { margin: 0; color: var(--grey); }
  .code { font: 600 clamp(36px, 9vw, 52px)/1.1 var(--mono); letter-spacing: .14em; color: var(--white); }
  .box label { display: grid; gap: 8px; font-size: 14px; color: var(--grey); }
  .box input { font: 400 16px/1.3 var(--mono); color: var(--white); background: var(--ink); border: 1px solid var(--outline); border-radius: 14px; min-height: 52px; padding: 0 16px; }
  .box input:focus { outline: 2px solid var(--white); outline-offset: 1px; }
  .err { color: var(--clay); }
  .steps { margin: 0; padding-left: 22px; color: var(--grey); display: grid; gap: 8px; }
  .meta { font-size: 14px; color: var(--dim); }
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The page: the field, or the code once a link was kept, or a word that linking isn't on here. */
export function calPageHtml(o: { on: boolean; code?: string; wrong?: string }): string {
  const box = !o.on
    ? `<div class="box"><p>Linking a calendar isn't switched on yet. Try again soon.</p></div>`
    : o.code
      ? `<div class="box">
<p>Type this code in X0 Bot on your phone, where you were asked for the link:</p>
<p class="code">${esc(o.code.slice(0, 3))} ${esc(o.code.slice(3))}</p>
<p>It works once, for the next 15 minutes.</p>
</div>`
      : `<form class="box" method="post" action="/cal">
<label for="link">Paste the link here</label>
<input id="link" name="link" type="url" inputmode="url" placeholder="https://calendar.google.com/calendar/ical/…" maxlength="2048" autocomplete="off" spellcheck="false" required>
${o.wrong ? `<p class="err">${esc(o.wrong)}</p>` : ""}<p><button class="btn" type="submit">Get a code</button></p>
<p>Keep this link private. X0 Bot keeps it locked and only reads from it.</p>
</form>`;
  const main = `<article class="prose cal">
<p class="eye">Plan Ease</p>
<h1>Link your calendar</h1>
<p class="lede">Your meetings show in Plan Ease on your phone. Copy your calendar's private link here, then type the code on your phone.</p>
${box}
<h2>Where the link is</h2>
<ol class="steps">
<li>Google Calendar: Settings › your calendar › Secret address in iCal format › Copy.</li>
<li>Outlook on the web: Settings › Calendar › Shared calendars › Publish a calendar › Can view all details › Publish, then copy the ICS link.</li>
</ol>
<p class="meta">Can't find it? Your work may have turned this off. No X0 Bot yet? <a href="/download">Get it here</a>.</p>
</article>`;
  return siteShell({ title: "Link your calendar", description: "Show your work calendar in Plan Ease.", main, css: CSS, noindex: true, pixel: false });
}
