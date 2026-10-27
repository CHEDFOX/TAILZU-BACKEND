/**
 * `GET /__host`: a tiny stand-in for the app, for tests and for trying the viewer by hand. It loads the viewer into an iframe with
 * `sandbox="allow-scripts"` (and nothing else, exactly as the app must), speaks the protocol, logs every message, and answers
 * storage / ask requests from memory. Not served when ENV is production.
 *
 * From the console or a Playwright script:
 *
 *   host.load({ type: "markdown", content: "# hi" }, { theme: "dark", kit })   host.stream(text, done)   host.selectMode(true)
 *   host.reset(type)         a fresh viewer iframe; with a type it is opened as /?type=… (the preload hint)
 *   host.log                 every message, both ways: { dir: "in" | "out", at, msg }
 *   host.waitFor(pred, { from, timeout })   resolves with the first inbound message after log index `from` that satisfies pred
 *   host.store               the in-memory storage: { private: Map, shared: Map }      host.downloads   what download() sent
 *   host.autoReply / host.autoResize / host.reset()
 *
 * `?artifact={"type":"svg","content":"<svg>…"}` loads that artifact as soon as the viewer says ready.
 */

export const HOST_CSP = ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", "frame-src 'self'", "img-src data:"].join("; ");

const SCRIPT = String.raw`
(function () {
  var frame, log = [], seq = 0;
  var store = { private: new Map(), shared: new Map() };
  var h = window.host = {
    log: log, store: store, downloads: [], asks: [],
    autoReply: true, autoResize: true, replyDelayMs: 0, parentOrigin: location.origin,
    send: function (msg) { out(msg); frame.contentWindow.postMessage(msg, '*'); },
    load: function (artifact, opts) {
      opts = opts || {};
      h.send({ t: 'load', artifact: { id: opts.id || 'a1', version: opts.version || 1, type: artifact.type, title: artifact.title || 'Test', content: artifact.content }, theme: opts.theme, kit: opts.kit });
    },
    stream: function (content, done) { h.send({ t: 'stream', content: content, done: !!done }); },
    selectMode: function (on) { h.send({ t: 'select-mode', on: !!on }); },
    waitFor: function (pred, o) {
      o = o || {};
      var from = o.from || 0, timeout = o.timeout || 15000;
      return new Promise(function (resolve, reject) {
        var started = Date.now();
        (function poll() {
          for (var i = from; i < log.length; i++) if (log[i].dir === 'in' && pred(log[i].msg, log[i])) return resolve(log[i].msg);
          if (Date.now() - started > timeout) return reject(new Error('timed out waiting for a message; saw: ' + JSON.stringify(log.slice(from).map(function (e) { return e.dir + ':' + e.msg.t; }))));
          setTimeout(poll, 10);
        })();
      });
    },
    messages: function (t, from) { return log.slice(from || 0).filter(function (e) { return e.dir === 'in' && (!t || e.msg.t === t); }).map(function (e) { return e.msg; }); },
    reset: function (type) { mount(type); }
  };

  function out(msg) { log.push({ dir: 'out', at: performance.now(), msg: msg }); show(); }
  function show() {
    var el = document.getElementById('log');
    el.textContent = log.slice(-40).map(function (e) { return (e.dir === 'in' ? '<- ' : '-> ') + JSON.stringify(e.msg).slice(0, 160); }).join('\n');
  }

  function reply(msg) {
    var scope = msg.shared ? store.shared : store.private;
    if (msg.t === 'storage') {
      var res = { t: 'storage-result', reqId: msg.reqId, ok: true };
      if (msg.op === 'get') res.value = scope.has(msg.key) ? scope.get(msg.key) : undefined;
      else if (msg.op === 'set') scope.set(msg.key, msg.value);
      else if (msg.op === 'delete') scope.delete(msg.key);
      else if (msg.op === 'list') res.keys = Array.from(scope.keys()).filter(function (k) { return !msg.key || k.indexOf(msg.key) === 0; });
      return res;
    }
    if (msg.t === 'ask') {
      h.asks.push(msg.prompt);
      if (msg.prompt === 'FAIL') return { t: 'ask-result', reqId: msg.reqId, ok: false, error: 'the bot refused' };
      return { t: 'ask-result', reqId: msg.reqId, ok: true, text: 'echo: ' + msg.prompt };
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow) return;
    var msg = e.data;
    log.push({ dir: 'in', at: performance.now(), msg: msg, origin: e.origin });
    show();
    if (msg.t === 'ready') {
      var q = new URLSearchParams(location.search).get('artifact');
      if (q) { try { h.load(JSON.parse(q)); } catch (err) { console.error(err); } }
    }
    if (msg.t === 'resize' && h.autoResize) frame.style.height = Math.max(40, msg.height) + 'px';
    if (msg.t === 'download') h.downloads.push(msg);
    if (h.autoReply && (msg.t === 'storage' || msg.t === 'ask')) {
      var r = reply(msg);
      if (r) setTimeout(function () { h.send(r); }, h.replyDelayMs);
    }
  });

  function mount(type) {
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = type ? '/?type=' + encodeURIComponent(type) : '/';
    document.getElementById('stage').appendChild(frame);
  }
  mount();
})();
`;

export function hostPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tailzu viewer: test host</title>
<style>
  body{margin:0;font:13px/1.4 ui-monospace,Menlo,monospace;background:#f4f4f6;color:#111}
  #stage{margin:12px}
  #frame{display:block;width:100%;height:240px;border:1px solid #bbb;background:#fff}
  #log{margin:0 12px 12px;padding:8px;white-space:pre-wrap;max-height:30vh;overflow:auto;background:#fff;border:1px solid #ddd}
  h1{font:600 13px system-ui;margin:12px}
</style></head>
<body><h1>Tailzu viewer: test host (not served in production)</h1>
<div id="stage"></div><pre id="log"></pre>
<script>${SCRIPT}</script></body></html>`;
}
