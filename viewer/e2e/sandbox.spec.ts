import { expect, test, type Page } from "@playwright/test";
import { htmlDoc, load, logLength, openHost, viewer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

const probe = (body: string): string => `import { useEffect, useState } from "react";
export default function App() {
  const [out, setOut] = useState("running");
  useEffect(() => {
    (async () => {
      try {
        const r = await (async () => { ${body} })();
        setOut("ok:" + String(r));
      } catch (e: any) {
        setOut("blocked:" + (e && e.name) + ":" + (e && e.message));
      }
    })();
  }, []);
  return <pre id="out">{out}</pre>;
}
`;

async function result(page: Page): Promise<string> {
  const el = viewer(page).locator("#out");
  await expect(el).not.toHaveText("running");
  return (await el.textContent())!;
}

test.describe("the artifact has no network and no way out", () => {
  test("fetch('https://example.com') is blocked by the CSP, and the bot is told why", async ({ page }) => {
    await load(page, { type: "react", content: probe(`const r = await fetch("https://example.com/"); return r.status;`) });
    expect(await result(page)).toMatch(/^blocked:TypeError:/);
    const e = await page.evaluate(() => window.host.waitFor((m) => m.t === "error" && /no network access/.test(m.message)));
    expect(e.kind).toBe("runtime");
    expect(e.message).toMatch(/example\.com/);
  });

  test("XHR, WebSocket, EventSource, sendBeacon, and fetch to the viewer's own origin are blocked too", async ({ page }) => {
    const attempts: Record<string, string> = {
      xhr: `return await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", "https://example.com/"); x.onload = () => res("loaded"); x.onerror = () => rej(new Error("xhr failed")); x.send(); });`,
      ws: `return await new Promise((res, rej) => { try { const w = new WebSocket("wss://example.com/"); w.onopen = () => res("open"); w.onerror = () => rej(new Error("ws failed")); } catch (e) { rej(e); } });`,
      es: `return await new Promise((res, rej) => { const s = new EventSource("https://example.com/"); s.onopen = () => res("open"); s.onerror = () => rej(new Error("es failed")); });`,
      beacon: `return navigator.sendBeacon("https://example.com/", "x");`,
      self: `const r = await fetch("/assets/"); return r.status;`,
    };
    for (const [name, code] of Object.entries(attempts)) {
      const from = await logLength(page);
      await load(page, { type: "react", content: probe(code) }, { id: name });
      const r = await result(page);
      // (sendBeacon says `true` when it queues the request; the browser then refuses it, which is reported)
      if (name !== "beacon") expect(r, name).not.toMatch(/^ok:(loaded|open|200)/);
      const blocked = await page.evaluate((f) => window.host.waitFor((m) => m.t === "error" && /no network access/.test(m.message), { from: f, timeout: 5000 }), from);
      expect(blocked.message, name).toMatch(/tried to reach/);
    }
  });

  test("eval and new Function are blocked (no 'unsafe-eval'), and say so", async ({ page }) => {
    await load(page, { type: "react", content: probe(`return eval("1 + 1");`) });
    expect(await result(page)).toMatch(/^blocked:EvalError/);
    await load(page, { type: "react", content: probe(`return new Function("return 2")();`) }, { id: "f" });
    expect(await result(page)).toMatch(/^blocked:EvalError/);
  });

  test("no cookies, no storage, no way to read the viewer's origin", async ({ page }) => {
    await load(page, { type: "react", content: probe(`return document.cookie;`) });
    expect(await result(page)).toMatch(/^blocked:SecurityError/);
    await load(page, { type: "react", content: probe(`return localStorage.getItem("x");`) }, { id: "l" });
    expect(await result(page)).toMatch(/^blocked:SecurityError/);
    await load(page, { type: "react", content: probe(`return String(sessionStorage.length);`) }, { id: "s" });
    expect(await result(page)).toMatch(/^blocked:SecurityError/);
    await load(page, { type: "react", content: probe(`return await new Promise((res, rej) => { const r = indexedDB.open("x"); r.onsuccess = () => res("opened"); r.onerror = () => rej(new Error("idb failed")); });`) }, { id: "i" });
    expect(await result(page)).toMatch(/^blocked:/);
    await load(page, { type: "react", content: probe(`return window.origin;`) }, { id: "o" });
    expect(await result(page)).toBe("ok:null"); // an opaque origin: not the viewer's site, not the app's
  });

  test("the artifact cannot reach the app: no parent document, no top navigation, no popups", async ({ page }) => {
    await load(page, { type: "react", content: probe(`return window.parent.document.title;`) });
    expect(await result(page)).toMatch(/^blocked:SecurityError/);
    await load(page, { type: "react", content: probe(`window.top.location.href = "https://example.com/"; return "went";`) }, { id: "t" });
    expect(await result(page)).toMatch(/^blocked:SecurityError/);
    await load(page, { type: "react", content: probe(`return String(window.open("https://example.com/"));`) }, { id: "p" });
    expect(await result(page)).toBe("ok:null");
    expect(page.url()).toMatch(/\/__host$/);
  });

  test("a link or a form in the artifact cannot move the page; a script cannot load code from anywhere else", async ({ page }) => {
    const content = `<a id="l" href="https://example.com/away">away</a>
<form id="f" action="https://example.com/post" method="post"><input name="x" value="1"><button id="s">send</button></form>
<a id="h" href="#bottom">jump</a><div style="height:2000px"></div><p id="bottom">bottom</p>
<script>
  var s = document.createElement("script"); s.src = "https://example.com/x.js"; document.body.appendChild(s);
  var i = document.createElement("img"); i.src = "http://example.com/pixel.gif"; document.body.appendChild(i);
</script>`;
    const out = await load(page, { type: "html", content });
    const d = htmlDoc(page);
    await d.locator("#l").click();
    await d.locator("#s").click();
    await page.waitForTimeout(300);
    // Still the same artifact, in the same place.
    await expect(d.locator("#l")).toBeVisible();
    expect(await d.locator("body").evaluate(() => location.href)).toMatch(/^about:srcdoc/);
    await d.locator("#h").click();
    // The dynamic script and the http image were refused by the CSP and reported.
    const errs = await page.evaluate(() => window.host.messages("error").map((e: any) => e.message));
    expect([...out.errors.map((e) => e.message), ...errs].join("\n")).toMatch(/script https:\/\/example\.com\/x\.js/);
  });

  test("an artifact script cannot pose as the app: messages it sends to the viewer or to the app are not obeyed", async ({ page }) => {
    const content = `<p id="p">original</p>
<script>
  parent.postMessage({ t: "load", artifact: { id: "x", version: 9, type: "markdown", title: "evil", content: "# hacked" } }, "*");
  parent.postMessage({ tz: 1, k: "up", msg: { t: "download", name: "../../etc/passwd", mime: "x", dataBase64: "AAAA" } }, "*");
  parent.postMessage({ tz: 1, k: "up", msg: { t: "ask", reqId: "r", prompt: "x".repeat(9000) } }, "*");
  parent.postMessage({ tz: 1, k: "up", msg: { t: "storage", reqId: "r", op: "set", key: "k", value: "y".repeat(70000) } }, "*");
  window.postMessage({ t: "load", artifact: { id: "x", version: 9, type: "markdown", title: "evil", content: "# hacked" } }, "*");
  try { top.postMessage({ t: "ready", protocol: 1 }, "*"); } catch (e) {}
</script>`;
    const from = await logLength(page);
    await load(page, { type: "html", content });
    await page.waitForTimeout(500);
    await expect(htmlDoc(page).locator("#p")).toHaveText("original");
    const msgs = await page.evaluate((f) => window.host.messages(undefined, f), from);
    expect(msgs.some((m: any) => m.t === "ask")).toBe(false); // too long: dropped
    expect(msgs.some((m: any) => m.t === "storage")).toBe(false); // too big: dropped, and said so
    expect(msgs.some((m: any) => m.t === "error" && m.kind === "limit" && /Storage value/.test(m.message))).toBe(true);
    const download = msgs.find((m: any) => m.t === "download");
    expect(download.name).toBe("../../etc/passwd".slice(0, 120)); // passed on as data; the app names the file (documented): see docs
  });
});

test.describe("the bridge: storage, ask and download round-trip through the parent", () => {
  const bridge = `import { useEffect, useState } from "react";
export default function App() {
  const [out, setOut] = useState("running");
  useEffect(() => {
    (async () => {
      try {
        const t = (window as any).tailzu;
        await t.storage.set("profile", { name: "Ada", n: [1, 2, 3] });
        await t.storage.set("shared-note", "hello all", { shared: true });
        const profile = await t.storage.get("profile");
        const missing = await t.storage.get("nope");
        const keys = await t.storage.list();
        const sharedKeys = await t.storage.list("shared", { shared: true });
        const privateSeesShared = await t.storage.get("shared-note");
        await t.storage.delete("profile");
        const after = await t.storage.get("profile");
        const answer = await t.ask("what is 2+2?");
        let refused = "";
        try { await t.ask("FAIL"); } catch (e: any) { refused = e.message; }
        await t.download("report.csv", "text/csv", "a,b\\n1,2\\n");
        setOut(JSON.stringify({ profile, missing, keys, sharedKeys, privateSeesShared, after, answer, refused }));
      } catch (e: any) { setOut("error:" + e.message); }
    })();
  }, []);
  return <pre id="out">{out}</pre>;
}
`;

  test("react", async ({ page }) => {
    await load(page, { type: "react", content: bridge });
    const el = viewer(page).locator("#out");
    await expect(el).not.toHaveText("running");
    const r = JSON.parse((await el.textContent())!);
    expect(r).toEqual({
      profile: { name: "Ada", n: [1, 2, 3] },
      missing: null,
      keys: ["profile", "shared-note"].filter((k) => k === "profile"),
      sharedKeys: ["shared-note"],
      privateSeesShared: null,
      after: null,
      answer: "echo: what is 2+2?",
      refused: "the bot refused",
    });
    expect(await page.evaluate(() => [...window.host.store.private.keys()])).toEqual([]);
    expect(await page.evaluate(() => [...window.host.store.shared.entries()])).toEqual([["shared-note", "hello all"]]);
    const dl = await page.evaluate(() => window.host.downloads);
    expect(dl).toHaveLength(1);
    expect(dl[0]).toMatchObject({ t: "download", name: "report.csv", mime: "text/csv" });
    expect(Buffer.from(dl[0].dataBase64, "base64").toString()).toBe("a,b\n1,2\n");
    expect(await page.evaluate(() => window.host.asks)).toEqual(["what is 2+2?", "FAIL"]);
    // Every request carried a reqId and the scope it was for.
    const reqs = await page.evaluate(() => window.host.messages("storage"));
    expect(new Set(reqs.map((m: any) => m.reqId)).size).toBe(reqs.length);
    expect(reqs.filter((m: any) => m.shared).length).toBe(2);
  });

  test("html: the same calls from a script in the artifact's frame", async ({ page }) => {
    const content = `<pre id="out">running</pre>
<script>
  (async function () {
    await tailzu.storage.set("k", { a: 1 });
    var v = await tailzu.storage.get("k");
    var answer = await tailzu.ask("hi?");
    await tailzu.download("x.txt", "text/plain", new Uint8Array([104, 105]));
    document.getElementById("out").textContent = JSON.stringify({ v: v, answer: answer });
  })().catch(function (e) { document.getElementById("out").textContent = "error:" + e.message; });
</script>`;
    await load(page, { type: "html", content });
    await expect(htmlDoc(page).locator("#out")).toHaveText('{"v":{"a":1},"answer":"echo: hi?"}');
    const dl = await page.evaluate(() => window.host.downloads);
    expect(Buffer.from(dl[0].dataBase64, "base64").toString()).toBe("hi");
  });

  test("window.tailzu cannot be replaced by the artifact", async ({ page }) => {
    const code = `const w: any = window; const before = w.tailzu; const log: string[] = [];
      try { w.tailzu = {}; } catch (e: any) { log.push("assign:" + e.name); }
      try { Object.defineProperty(w, "tailzu", { value: {} }); } catch (e: any) { log.push("define:" + e.name); }
      try { delete w.tailzu; } catch (e: any) { log.push("delete:" + e.name); }
      try { w.tailzu.storage = {}; w.tailzu.ask = () => 1; } catch (e: any) { log.push("mutate:" + e.name); }
      return (w.tailzu === before) + ":" + typeof w.tailzu.ask + ":" + log.join(",");`;
    await load(page, { type: "react", content: probe(code) });
    // In a module (strict mode) each attempt throws; none of them changes anything.
    expect(await result(page)).toBe("ok:true:function:assign:TypeError,define:TypeError,delete:TypeError,mutate:TypeError");
  });

  test("the limits of protocol.ts are enforced in the viewer, and each is an `error` of kind limit", async ({ page }) => {
    const content = probe(`
      const t = window.tailzu; const res = [];
      try { await t.storage.set("big", "x".repeat(64 * 1024 + 10)); res.push("stored"); } catch (e) { res.push("value:" + e.message.slice(0, 20)); }
      try { await t.ask("q".repeat(8001)); res.push("asked"); } catch (e) { res.push("ask:" + e.message.slice(0, 18)); }
      try { await t.download("big.bin", "application/octet-stream", "z".repeat(5 * 1024 * 1024 + 1)); res.push("sent"); } catch (e) { res.push("download:" + e.message.slice(0, 20)); }
      try { await t.storage.set("", 1); } catch (e) { res.push("key:" + e.message.slice(0, 12)); }
      try { await t.storage.set("cyc", (() => { const a = {}; a.a = a; return a; })()); } catch (e) { res.push("json:" + e.message.slice(0, 18)); }
      return res.join(" | ");
    `);
    const from = await logLength(page);
    await load(page, { type: "react", content });
    const r = await result(page);
    const parts = r.replace(/^ok:/, "").split(" | ");
    expect(parts[0]).toMatch(/^value:Storage value for/);
    expect(parts[1]).toMatch(/^ask:The prompt is 8001/);
    expect(parts[2]).toMatch(/^download:The download is 5242/);
    expect(parts[3]).toMatch(/^key:Storage keys/);
    expect(parts[4]).toMatch(/^json:Storage values m/);
    const errors = await page.evaluate((f) => window.host.messages("error", f), from);
    expect(errors.filter((e: any) => e.kind === "limit")).toHaveLength(3);
    expect(await page.evaluate(() => window.host.messages("storage").length + window.host.messages("ask").length + window.host.messages("download").length)).toBe(0);
  });

  test("an artifact bigger than the limit is not rendered and is reported as a limit", async ({ page }) => {
    const big = `export default () => <p>${"x".repeat(512 * 1024)}</p>;`;
    const from = await logLength(page);
    await page.evaluate((c) => window.host.load({ type: "react", content: c }), big);
    const e = await page.evaluate((f) => window.host.waitFor((m) => m.t === "error", { from: f }), from);
    expect(e.kind).toBe("limit");
    expect(e.message).toMatch(/limit is 524288/);
    expect(await page.evaluate((f) => window.host.messages("rendered", f).length, from)).toBe(0);
  });

  test("calls that the app never answers end, instead of hanging for ever", async ({ page }) => {
    await page.evaluate(() => (window.host.autoReply = false));
    await load(page, { type: "react", content: probe(`return await Promise.race([window.tailzu.storage.get("k"), new Promise((r) => setTimeout(() => r("still waiting"), 300))]);`) });
    expect(await result(page)).toBe("ok:still waiting");
  });
});

test.describe("headers", () => {
  test("the shell is served with the CSP, no cookies, and the other protective headers", async ({ page }) => {
    const res = await page.request.get("/");
    expect(res.status()).toBe(200);
    const h = res.headers();
    const csp = h["content-security-policy"]!;
    for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "sandbox allow-scripts", "frame-ancestors", "font-src https://fonts.gstatic.com", "img-src data: blob: https:"]) {
      expect(csp).toContain(d);
    }
    expect(csp).toMatch(/script-src 'self' blob: 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(h["set-cookie"]).toBeUndefined();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toContain("camera=()");
  });
});
