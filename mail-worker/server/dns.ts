// The DNS records a company domain needs for its mail to live here, and a live
// check of each against public resolvers, so the dashboard can say exactly what
// to add, what to change, and what is already right.
//
//   MX     where mail for the domain is delivered: this server.
//   SPF    which servers may send as the domain: this one (via spf.<platform>,
//          which also covers Postal, same IP) plus whatever the domain had.
//   DKIM   the public halves of Stalwart's signing keys for the domain.
//   DMARC  what receivers do with mail that fails both.
// Optional: SRV records that let mail apps find the server by themselves.
import { Resolver } from "node:dns/promises";
import { config, hosts } from "./config.ts";

export type RecordStatus = "ok" | "missing" | "differs" | "unknown";
export type DnsRecord = {
  kind: "MX" | "SPF" | "DKIM" | "DMARC" | "SRV";
  type: "MX" | "TXT" | "SRV";
  /** Fully qualified name. */
  name: string;
  /** The name as most DNS panels want it (relative to the domain, "@" for the apex). */
  host: string;
  value: string;
  priority?: number;
  required: boolean;
  why: string;
  status?: RecordStatus;
  current?: string[];
  note?: string;
};

const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

const rel = (name: string, domain: string) => (name === domain ? "@" : name.endsWith("." + domain) ? name.slice(0, -domain.length - 1) : name);
const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");

/** DKIM TXT records from Stalwart's zone file (the multi-line parenthesised form included). */
export function dkimFromZone(zone: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const re = /^(\S+\._domainkey\.\S+?)\.?\s+IN\s+TXT\s+(\([\s\S]*?\)|"[^\n]*")/gm;
  for (const m of zone.matchAll(re)) {
    const value = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
    out.push({ name: norm(m[1]), value });
  }
  return out;
}

export function expected(domain: string, zone: string): DnsRecord[] {
  const d = norm(domain);
  const recs: DnsRecord[] = [
    { kind: "MX", type: "MX", name: d, host: "@", value: hosts.mx, priority: 10, required: true,
      why: "Delivers the domain's mail to this server. Replace any other MX records (Google, Zoho) when you move." },
    { kind: "SPF", type: "TXT", name: d, host: "@", value: `v=spf1 mx include:${hosts.spfInclude} ~all`, required: true,
      why: "Lets this server send as the domain. One SPF record per domain: merge into an existing one." },
  ];
  for (const k of dkimFromZone(zone)) {
    recs.push({ kind: "DKIM", type: "TXT", name: k.name, host: rel(k.name, d), value: k.value, required: true,
      why: "Signs every message sent from the domain, so receivers can tell it is genuine." });
  }
  recs.push(
    { kind: "DMARC", type: "TXT", name: `_dmarc.${d}`, host: "_dmarc", value: `v=DMARC1; p=quarantine; adkim=r; aspf=r`, required: true,
      why: "Tells receivers to quarantine mail that claims the domain but fails SPF and DKIM." },
    { kind: "SRV", type: "SRV", name: `_imaps._tcp.${d}`, host: "_imaps._tcp", value: `0 1 993 ${hosts.imap}`, required: false,
      why: "Optional: mail apps find the incoming server by themselves." },
    { kind: "SRV", type: "SRV", name: `_submissions._tcp.${d}`, host: "_submissions._tcp", value: `0 1 465 ${hosts.smtp}`, required: false,
      why: "Optional: mail apps find the outgoing server by themselves." },
  );
  return recs;
}

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw e;
  }
}

/** SPF with our include merged into what the domain already has. */
export function mergeSpf(current: string | undefined): string {
  if (!current) return `v=spf1 mx include:${hosts.spfInclude} ~all`;
  let s = current.trim();
  if (!/\binclude:/.test(s) || !s.includes(`include:${hosts.spfInclude}`)) {
    s = s.replace(/\s+([~?+-]all)\s*$/i, ` include:${hosts.spfInclude} $1`);
    if (!s.includes(`include:${hosts.spfInclude}`)) s += ` include:${hosts.spfInclude}`;
  }
  if (!/(^|\s)\+?mx(\s|$)/.test(s)) s = s.replace(/^v=spf1/i, "v=spf1 mx");
  return s;
}

export async function check(records: DnsRecord[]): Promise<DnsRecord[]> {
  return Promise.all(records.map(async (r) => {
    try {
      if (r.kind === "MX") {
        let mx: { exchange: string; priority: number }[] = [];
        try { mx = await resolver.resolveMx(r.name); } catch (e) { if (!["ENODATA", "ENOTFOUND"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; }
        const current = mx.sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${norm(m.exchange)}`);
        const ours = mx.some((m) => norm(m.exchange) === norm(r.value));
        const others = mx.filter((m) => norm(m.exchange) !== norm(r.value));
        return { ...r, current, status: !mx.length ? "missing" : ours && !others.length ? "ok" : "differs",
          note: ours && others.length ? "Remove the other MX records, or some mail keeps going to the old provider."
            : !ours && mx.length ? `Mail for this domain still goes to ${norm(mx[0].exchange)}.` : undefined } as DnsRecord;
      }
      if (r.kind === "SPF") {
        const all = (await txt(r.name)).filter((t) => /^v=spf1/i.test(t));
        const covers = (t: string) => t.includes(`include:${hosts.spfInclude}`) || (config.vpsIp && t.includes(`ip4:${config.vpsIp}`));
        if (!all.length) return { ...r, current: [], status: "missing" } as DnsRecord;
        if (all.length > 1) return { ...r, current: all, status: "differs", note: "There is more than one SPF record: keep one, merged." } as DnsRecord;
        return { ...r, current: all, status: covers(all[0]) ? "ok" : "differs", value: covers(all[0]) ? all[0] : mergeSpf(all[0]),
          note: covers(all[0]) ? undefined : "Replace the existing SPF record with this merged one." } as DnsRecord;
      }
      if (r.kind === "DKIM") {
        const all = await txt(r.name);
        const key = (s: string) => /p=([^;\s]+)/.exec(s.replace(/\s/g, ""))?.[1];
        const ok = all.some((t) => key(t) && key(t) === key(r.value));
        return { ...r, current: all, status: ok ? "ok" : all.length ? "differs" : "missing" } as DnsRecord;
      }
      if (r.kind === "DMARC") {
        const all = (await txt(r.name)).filter((t) => /^v=DMARC1/i.test(t));
        return { ...r, current: all, status: all.length ? "ok" : "missing",
          note: all.length && !/p=(quarantine|reject)/i.test(all[0]) ? "Present, with a relaxed policy (p=none): fine while you move, tighten later." : undefined } as DnsRecord;
      }
      // SRV
      let srv: { name: string; port: number; priority: number; weight: number }[] = [];
      try { srv = await resolver.resolveSrv(r.name); } catch (e) { if (!["ENODATA", "ENOTFOUND"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; }
      const target = r.value.split(" ").pop()!;
      return { ...r, current: srv.map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name}`),
        status: srv.some((s) => norm(s.name) === norm(target)) ? "ok" : srv.length ? "differs" : "missing" } as DnsRecord;
    } catch {
      return { ...r, status: "unknown", note: "Could not look this up just now." } as DnsRecord;
    }
  }));
}
