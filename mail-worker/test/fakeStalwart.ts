// A stand-in mail server for the tests: Stalwart's JMAP as the worker uses it (admin objects, one mailbox by impersonation, uploads), with
// messages, threads, drafts and sending kept in memory. It records every method asked, to check what the worker did.
import http from "node:http";

type Obj = Record<string, unknown> & { id: string };
export type FakeEmail = Obj & { threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>; receivedAt: string };

export function fakeStalwart() {
  const store = { Domain: [{ id: "d0", name: "xooteq.online" }] as Obj[], Account: [] as Obj[], WebHook: [] as Obj[], Action: [] as Obj[] };
  const emails: FakeEmail[] = [];
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const submitted: string[] = [];
  let seq = 1;
  const MAILBOXES = [
    { id: "in", name: "Inbox", role: "inbox", parentId: null }, { id: "dr", name: "Drafts", role: "drafts", parentId: null },
    { id: "se", name: "Sent", role: "sent", parentId: null }, { id: "jk", name: "Junk", role: "junk", parentId: null },
  ];
  const pick = (e: FakeEmail, props?: string[]) => (props ? Object.fromEntries(Object.entries(e).filter(([k]) => k === "id" || props.includes(k))) : e);

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      const user = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":")[0] ?? "";
      if (req.method === "GET" && req.url === "/.well-known/jmap") {
        return send(200, { username: user, capabilities: {}, accounts: { a1: {} }, primaryAccounts: { "urn:stalwart:jmap": "admin1", "urn:ietf:params:jmap:mail": "mail1" } });
      }
      if (req.method === "POST" && req.url?.startsWith("/jmap/upload/")) return send(200, { blobId: `b${seq++}`, size: raw.length, type: "application/sieve" });
      if (req.method !== "POST" || req.url !== "/jmap/") return send(404, {});
      const { methodCalls } = JSON.parse(raw) as { methodCalls: [string, Record<string, unknown>, string][] };
      const done = new Map<string, Record<string, unknown>>();
      const out = methodCalls.map(([m, a, id]) => {
        calls.push({ method: m, args: a });
        // back-references: "#ids": { resultOf, path }
        const ref = a["#ids"] as { resultOf: string; path: string } | undefined;
        let ids = a.ids as string[] | undefined;
        if (ref) {
          const prev = done.get(ref.resultOf) ?? {};
          ids = ref.path === "/ids" ? (prev.ids as string[]) : ((prev.list as { emailIds: string[] }[]) ?? []).flatMap((t) => t.emailIds);
        }
        const answer = ((): [string, Record<string, unknown>] => {
          const x = /^x:(\w+)\/(get|set)$/.exec(m);
          if (x) {
            const list = store[x[1] as keyof typeof store];
            if (x[2] === "get") return [m, { list }];
            const created: Record<string, { id: string }> = {};
            for (const [k, v] of Object.entries((a.create ?? {}) as Record<string, Record<string, unknown>>)) { const o = { ...v, id: `${x[1]![0]}${seq++}` }; list.push(o); created[k] = { id: o.id }; }
            for (const d of (a.destroy ?? []) as string[]) { const i = list.findIndex((o) => o.id === d); if (i >= 0) list.splice(i, 1); }
            return [m, { created }];
          }
          switch (m) {
            case "Mailbox/get": return [m, { list: MAILBOXES }];
            case "Mailbox/set": return [m, { created: {} }];
            case "SieveScript/validate": return [m, { error: null }];
            case "SieveScript/get": return [m, { list: [] }];
            case "SieveScript/set": return [m, { created: { s: { id: "s1" } } }];
            case "Identity/get": return [m, { list: [{ id: "i1", email: "hello@shop.test" }, { id: "i2", email: "support@shop.test" }] }];
            case "Email/query": return [m, { ids: [...emails].sort((p, q) => (p.receivedAt < q.receivedAt ? 1 : -1)).slice(0, Number(a.limit ?? 100)).map((e) => e.id) }];
            case "Email/get": return [m, { list: (ids ?? []).map((i) => emails.find((e) => e.id === i)).filter(Boolean).map((e) => pick(e!, a.properties as string[] | undefined)) }];
            case "Thread/get": return [m, { list: ((a.ids ?? []) as string[]).map((t) => ({ id: t, emailIds: emails.filter((e) => e.threadId === t).map((e) => e.id) })) }];
            case "Email/set": {
              const created: Record<string, { id: string }> = {};
              for (const [k, v] of Object.entries((a.create ?? {}) as Record<string, Record<string, unknown>>)) {
                const e = { threadId: "t-draft", receivedAt: new Date().toISOString(), ...v, id: `e${seq++}` } as unknown as FakeEmail;
                // what a mail server would hand back: the body parts as values
                const values = (v.bodyValues ?? {}) as Record<string, { value: string }>;
                e.bodyValues = values;
                emails.push(e);
                created[k] = { id: e.id };
              }
              for (const [eid, patch] of Object.entries((a.update ?? {}) as Record<string, Record<string, unknown>>)) {
                const e = emails.find((x) => x.id === eid);
                if (!e) continue;
                for (const [k, v] of Object.entries(patch)) {
                  if (k.startsWith("keywords/")) { const kw = k.slice(9); if (v === null) delete e.keywords[kw]; else e.keywords[kw] = true; }
                }
              }
              for (const d of (a.destroy ?? []) as string[]) { const i = emails.findIndex((e) => e.id === d); if (i >= 0) emails.splice(i, 1); }
              return [m, { created }];
            }
            case "EmailSubmission/set": {
              const s = (a.create as Record<string, { emailId: string }>).s;
              submitted.push(s.emailId);
              const e = emails.find((x) => x.id === s.emailId);
              if (e) { delete e.keywords.$draft; e.mailboxIds = { se: true }; }
              return [m, { created: { s: { id: `sub${seq++}` } } }];
            }
            default: return ["error", { type: "unknownMethod" }];
          }
        })();
        done.set(id, answer[1]);
        return [answer[0], answer[1], id];
      });
      send(200, { methodResponses: out });
    });
  });

  /** A message arriving in the mailbox, as Stalwart would hold it. */
  function deliver(o: { id: string; messageId: string; from: string; name?: string; to: string; subject: string; text: string; headers?: Record<string, string> }): FakeEmail {
    const e = {
      id: o.id, threadId: `t-${o.id}`, mailboxIds: { in: true }, keywords: {}, receivedAt: new Date(Date.now() + seq++).toISOString(),
      from: [{ name: o.name ?? null, email: o.from }], to: [{ email: o.to }], subject: o.subject, messageId: [o.messageId.replace(/^<|>$/g, "")],
      textBody: [{ partId: "1", type: "text/plain" }], bodyValues: { "1": { value: o.text } }, ...(o.headers ?? {}),
    } as unknown as FakeEmail;
    emails.push(e);
    return e;
  }

  return {
    store, emails, calls, submitted, deliver,
    listen: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
