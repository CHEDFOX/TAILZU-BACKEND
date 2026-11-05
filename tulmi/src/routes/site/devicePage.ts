/**
 * SIGN IN TO XODE IN THE TERMINAL: the page `xode login` points to (GET /device, x0bot.com/device through the site's proxy;
 * docs/xode-cli.md).
 *
 *   /device?c=ABCDEFGH   the terminal's code, shown big, with a button that opens the approval screen in the app (bots.link,
 *                        through the same link the QR uses, routes/account/deviceLink.ts), and where to type it instead
 *   /device              a field for the code; it comes back here with ?c=
 *
 * The code is only checked for its shape, never looked up: the page holds no secret and says nothing about whether a code is
 * waiting, so it cannot be used to guess one. Nothing can sign in from here; the person approves in the app. No script runs,
 * nothing is loaded from anyone but the fonts, and the address (with the code) is not passed on to other sites.
 */
import type { FastifyInstance } from "fastify";
import { CODE_RE, normalizeCode, showCode } from "../../auth/deviceLink.js";
import { linkCodeUrl } from "../account/deviceLink.js";
import { siteShell } from "./policies/shell.js";

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://x0bot.com https://api.x0bot.com",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CSS = `
  .dev { max-width: 600px; }
  .dev h1 { margin-bottom: 14px; }
  .dev .lede { margin-bottom: 30px; }
  .box { background: var(--raise); border: 1px solid var(--rule); border-radius: 22px; padding: 24px; margin: 0 0 32px; display: grid; gap: 16px; }
  .box p { margin: 0; color: var(--grey); }
  .code { font: 600 clamp(32px, 8vw, 44px)/1.1 var(--mono); letter-spacing: .08em; color: var(--white); }
  .box label { display: grid; gap: 8px; font-size: 14px; color: var(--grey); }
  .box input { font: 500 20px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--white); background: var(--ink); border: 1px solid var(--outline); border-radius: 14px; min-height: 52px; padding: 0 16px; }
  .box input:focus { outline: 2px solid var(--white); outline-offset: 1px; }
  .err { color: var(--clay); }
  .steps { margin: 0; padding-left: 22px; color: var(--grey); display: grid; gap: 8px; }
  .meta { font-size: 14px; color: var(--dim); }
  .meta a { color: var(--grey); }
`;

/** The page: with a code of the right shape, or with the field (and a word when what was typed is not a code). */
export function devicePageHtml(o: { code?: string; wrong?: boolean }): string {
  const code = o.code && CODE_RE.test(o.code) ? o.code : "";
  const box = code
    ? `<div class="box">
<p>The code in your terminal:</p>
<p class="code">${showCode(code)}</p>
<p><a class="btn" href="${linkCodeUrl(code)}">Open in X0 Bot</a></p>
<p>Check that it's the same code, then tap Approve.</p>
</div>`
    : `<form class="box" method="get" action="/device">
<label for="c">The code in your terminal</label>
<input id="c" name="c" placeholder="ABCD-EFGH" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
${o.wrong ? `<p class="err">That doesn't look like a code. It's 8 letters and numbers, like ABCD-EFGH.</p>` : ""}<p><button class="btn" type="submit">Open in X0 Bot</button></p>
</form>`;
  const main = `<article class="prose dev">
<p class="eye">Xode</p>
<h1>Sign in to Xode in the terminal</h1>
<p class="lede">Your terminal is waiting for you to say it's you. Open X0 Bot on your phone or computer to approve it.</p>
${box}
<h2>Another way</h2>
<ol class="steps">
<li>Open X0 Bot on your phone or computer.</li>
<li>Go to Settings, then Terminal sign-ins, and type the code.</li>
<li>Check it's the code your terminal shows, and tap Approve.</li>
</ol>
<p class="meta">Didn't run <code>xode login</code>? Close this page. Nothing signs in until you approve it. No X0 Bot yet? <a href="/download">Get it here</a>.</p>
</article>`;
  return siteShell({ title: "Sign in to Xode in the terminal", description: "Approve Xode in your terminal from X0 Bot.", main, css: CSS, noindex: true, pixel: false });
}

export function registerDevicePageRoutes(app: FastifyInstance): void {
  app.get("/device", async (req, reply) => {
    const raw = (req.query as { c?: unknown } | undefined)?.c;
    const code = normalizeCode(raw);
    reply.header("Content-Security-Policy", CSP);
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Robots-Tag", "noindex");
    reply.header("Cache-Control", "no-store");
    reply.type("text/html; charset=utf-8");
    return devicePageHtml({ code, wrong: raw !== undefined && !CODE_RE.test(code) });
  });
}
