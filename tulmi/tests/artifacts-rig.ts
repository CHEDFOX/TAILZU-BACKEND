/**
 * THE ARTIFACT TESTS' RIG: A SCRIPTED MODEL, A SAMPLE ARTIFACT, A SERVICE OVER THE MEMORY TWIN, AND A FAKE PROJECT.
 *
 * Nothing here reaches a network, a model or a database. `scripted()` is a stand-in for callModel that answers from a function of
 * the call and writes down what it was sent (the messages, the tier, the cap), charging a fixed number of paise a call and refusing
 * a call whose worst case would pass the cap, as the gateway does. Fake secrets are built at runtime so no literal in this file
 * is one (GitHub's push protection reads the source).
 *
 * Import it after the test file's environment is set (it loads src/).
 */
import { BudgetExceeded, type CallInput, type CallResult } from "../src/code/brain/gateway.js";
import { charsOf } from "../src/code/brain/money.js";
import type { CallFn } from "../src/code/work/model.js";
import { ArtifactService } from "../src/artifacts/service.js";
import { MemoryArtifactStore } from "../src/artifacts/store.js";

// ------------------------------------------------------------- fake secrets, made at runtime

export const FAKE_AWS = ["AKIA", "IOSFODNN7EXAMPLQ"].join("");
export const FAKE_STRIPE = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
export const FAKE_GH = ["ghp", "a".repeat(8) + "B1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s8"].join("_");

// ------------------------------------------------------------- the scripted model

export interface Sent {
  purpose: string;
  tier: string;
  system: string;
  user: string;
  chars: number;
  maxTokens: number;
  capPaise: number | null;
  userId: string;
  messages: CallInput["messages"];
}

export type Answer = string | { text: string; truncated?: boolean; json?: unknown } | { json: unknown } | Error;

export interface Scripted {
  call: CallFn;
  sent: Sent[];
  /** Paise a call costs. */
  paise: number;
  /** Fails the next calls on this tier as a model that is down. */
  down: Set<string>;
  of(purpose: string): Sent[];
}

/**
 * `answer(sent, n)` is what the model says to the nth call (counting from 0). A string is the text; an Error is thrown as the gateway would
 * (a model that cannot be reached).
 */
export function scripted(answer: (sent: Sent, n: number) => Answer, o: { paise?: number } = {}): Scripted {
  const s: Scripted = {
    sent: [], paise: o.paise ?? 4, down: new Set(), of(purpose) { return s.sent.filter((x) => x.purpose === purpose); },
    call: (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
      const tier = input.tier ?? "tiers";
      const cap = typeof input.budget === "object" ? input.budget.maxPaise : null;
      const msgs = input.messages;
      const text = (m: (typeof msgs)[number] | undefined) => (m ? (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => ("text" in p ? p.text : "[image]")).join("") : "") : "");
      const sent: Sent = {
        purpose: input.purpose, tier, system: text(msgs.find((m) => m.role === "system")), user: text(msgs.filter((m) => m.role === "user").at(-1)), chars: charsOf(msgs),
        maxTokens: input.maxTokens ?? 0, capPaise: cap, userId: input.userId ?? "", messages: msgs,
      };
      // Like the gateway: a call whose worst case would pass the cap is refused before it is made, and never counted.
      if (cap !== null && cap < s.paise) {
        throw new BudgetExceeded({ needPaise: s.paise, spentPaise: 0, budgetPaise: cap, scope: "call", purpose: input.purpose, tier: input.tier });
      }
      const n = s.sent.length;
      s.sent.push(sent);
      if (s.down.has(tier)) throw Object.assign(new Error("model down"), { name: "ModelUnavailable" });
      const a = answer(sent, n);
      if (a instanceof Error) throw a;
      const out = typeof a === "string" ? { text: a } : "text" in a ? a : { text: JSON.stringify(a.json), json: a.json };
      return {
        text: out.text, json: (out as { json?: unknown }).json as T, toolCalls: [], model: `fake/${tier}`, tier: input.tier, promptTokens: Math.ceil(sent.chars / 3.5),
        completionTokens: Math.ceil(out.text.length / 3.5), costUsd: s.paise / 8800, paise: s.paise, costSource: "reported", truncated: !!(out as { truncated?: boolean }).truncated, ms: 1, calls: 1, trail: [],
      };
    }) as CallFn,
  };
  return s;
}

// ------------------------------------------------------------- the service

export function rig(answer: (sent: Sent, n: number) => Answer = () => "", o: { paise?: number; dailyPaise?: number; askDailyPaise?: number; rates?: ConstructorParameters<typeof ArtifactService>[0]["rates"]; now?: () => number } = {}) {
  const model = scripted(answer, o.paise !== undefined ? { paise: o.paise } : {});
  const store = new MemoryArtifactStore(o.now);
  const service = new ArtifactService({
    store, call: model.call, ...(o.dailyPaise !== undefined ? { dailyPaise: o.dailyPaise } : {}), ...(o.askDailyPaise !== undefined ? { askDailyPaise: o.askDailyPaise } : {}),
    ...(o.rates ? { rates: o.rates } : {}), ...(o.now ? { now: o.now } : {}),
  });
  return { service, store, model };
}

// ------------------------------------------------------------- a sample artifact

/** A real-sized React dashboard (about 7 KB): the artifact the efficiency numbers are measured on. */
export const SAMPLE_DASHBOARD = `import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ShoppingCart, TrendingUp, Users, Search } from "lucide-react";

const ORDERS = [
  { id: "#1042", customer: "Aarav Mehta", total: 2499, status: "paid", date: "2026-10-01" },
  { id: "#1043", customer: "Diya Rao", total: 899, status: "pending", date: "2026-10-02" },
  { id: "#1044", customer: "Kabir Shah", total: 15499, status: "paid", date: "2026-10-03" },
  { id: "#1045", customer: "Meera Iyer", total: 1299, status: "refunded", date: "2026-10-04" },
  { id: "#1046", customer: "Rohan Gupta", total: 3399, status: "paid", date: "2026-10-05" },
  { id: "#1047", customer: "Sana Khan", total: 749, status: "pending", date: "2026-10-06" },
  { id: "#1048", customer: "Vihaan Das", total: 5299, status: "paid", date: "2026-10-07" },
  { id: "#1049", customer: "Zoya Ali", total: 1999, status: "paid", date: "2026-10-08" },
];

const SERIES = [
  { day: "Mon", sales: 4200 }, { day: "Tue", sales: 5100 }, { day: "Wed", sales: 3900 }, { day: "Thu", sales: 6200 },
  { day: "Fri", sales: 7400 }, { day: "Sat", sales: 8800 }, { day: "Sun", sales: 6900 },
];

const STATUS_COLORS = { paid: "#16a34a", pending: "#d97706", refunded: "#dc2626" };

function Stat({ icon, label, value, hint }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", flex: 1, minWidth: 140 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 13 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function StatusPill({ status }) {
  return (
    <span style={{ background: STATUS_COLORS[status] + "22", color: STATUS_COLORS[status], padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const rows = useMemo(
    () => ORDERS.filter((o) => (status === "all" || o.status === status) && (o.customer + o.id).toLowerCase().includes(query.toLowerCase())),
    [query, status],
  );
  const revenue = rows.filter((o) => o.status === "paid").reduce((n, o) => n + o.total, 0);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: "#f1f5f9", minHeight: "100vh", padding: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Store overview</h1>
        <label style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 8, padding: "6px 10px" }}>
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search orders" style={{ border: 0, outline: 0 }} />
        </label>
      </header>

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat icon={<ShoppingCart size={16} />} label="Orders" value={rows.length} hint="matching the filter" />
        <Stat icon={<TrendingUp size={16} />} label="Revenue" value={"₹" + revenue.toLocaleString("en-IN")} hint="paid orders only" />
        <Stat icon={<Users size={16} />} label="Customers" value={new Set(rows.map((o) => o.customer)).size} hint="unique" />
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Sales this week</h2>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={SERIES}>
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {["all", "paid", "pending", "refunded"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{ border: 0, borderRadius: 999, padding: "4px 12px", cursor: "pointer", background: status === s ? "#6366f1" : "#e2e8f0", color: status === s ? "#fff" : "#334155" }}
            >
              {s}
            </button>
          ))}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b" }}>
              <th>Order</th>
              <th>Customer</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{o.id}</td>
                <td>{o.customer}</td>
                <td>{o.date}</td>
                <td style={{ textAlign: "right" }}>{"₹" + o.total.toLocaleString("en-IN")}</td>
                <td><StatusPill status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p style={{ color: "#94a3b8" }}>No orders match.</p>}
      </section>
    </div>
  );
}
`;

/** The dashboard and three more panels of the same kind (about 22 KB): the same edit costs the same on it, and a rewrite costs four times as much. */
export const BIG_DASHBOARD = (() => {
  const extra = (n: string) => SAMPLE_DASHBOARD.replace(/^import[^\n]*\n/gm, "").replace(/\bORDERS\b/g, `${n.toUpperCase()}_ROWS`).replace(/\bSERIES\b/g, `${n.toUpperCase()}_SERIES`)
    .replace(/\bSTATUS_COLORS\b/g, `${n.toUpperCase()}_COLORS`).replace(/\bStat\b/g, `${n}Stat`).replace(/\bStatusPill\b/g, `${n}Pill`).replace("export default function Dashboard", `function ${n}Panel`);
  return `${SAMPLE_DASHBOARD}\n${["Reports", "Customers", "Inventory"].map(extra).join("\n")}`;
})();

/** The line and column of the first `needle` in a source, as the viewer's data-tz-id: "<line>:<col>". */
export function idOf(source: string, needle: string, nth = 0): string {
  let at = -1;
  for (let k = 0; k <= nth; k += 1) at = source.indexOf(needle, at + 1);
  if (at < 0) throw new Error(`no ${needle} in the source`);
  const before = source.slice(0, at).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}
