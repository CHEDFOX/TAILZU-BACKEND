/**
 * MONEY: currency conversion at the day's central-bank rates (Frankfurter, which publishes the European Central Bank's and other central
 * banks' reference rates; free, no key, fine for an app). Rates are a working day's, not live market prices: the card says the day.
 */
import type { FetchFn } from "./mcpLite.js";
import type { MoneyCard } from "./types.js";

export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";

const CODE = /^[A-Z]{3}$/;

/** What people say → the code ("rupees" → INR). A code goes as it is. */
const NAMES: Record<string, string> = {
  rupee: "INR", rupees: "INR", rs: "INR", inr: "INR", "₹": "INR", dollar: "USD", dollars: "USD", usd: "USD", "$": "USD", euro: "EUR", euros: "EUR", "€": "EUR",
  pound: "GBP", pounds: "GBP", "£": "GBP", dirham: "AED", dirhams: "AED", yen: "JPY", yuan: "CNY", baht: "THB", ringgit: "MYR", rupiah: "IDR",
  "singapore dollar": "SGD", "australian dollar": "AUD", "canadian dollar": "CAD", franc: "CHF", "swiss franc": "CHF", riyal: "SAR", won: "KRW",
};

export function currencyOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (CODE.test(s.toUpperCase()) && s.length === 3) return s.toUpperCase();
  return NAMES[s.toLowerCase()] ?? null;
}

export async function convert(amount: number, fromRaw: string, toRaw: string, o: { url?: string; fetch?: FetchFn } = {}): Promise<MoneyCard> {
  const from = currencyOf(fromRaw), to = currencyOf(toRaw);
  if (!from || !to) throw new Error("from and to are currency codes, like USD and INR");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error("amount must be a positive number");
  if (from === to) return { kind: "money", amount, from, to, rate: 1, result: amount, day: new Date().toISOString().slice(0, 10), source: { name: "Frankfurter (central bank rates)", url: "https://frankfurter.dev" } };
  const f = o.fetch ?? fetch;
  const r = await f(`${o.url ?? FRANKFURTER_URL}/latest?base=${from}&symbols=${to}`, { headers: { accept: "application/json", "user-agent": "X0Bot/1.0 (+https://x0bot.com)" } });
  if (!r.ok) throw new Error(r.status === 404 ? `${from} or ${to} has no central-bank rate` : "the rates could not be read just now");
  const j = (await r.json()) as { date?: string; rates?: Record<string, number> };
  const rate = j.rates?.[to];
  if (typeof rate !== "number" || !(rate > 0)) throw new Error(`no rate from ${from} to ${to}`);
  return {
    kind: "money", amount, from, to, rate, result: Math.round(amount * rate * 100) / 100, day: j.date ?? "",
    source: { name: "Frankfurter (central bank rates)", url: "https://frankfurter.dev" },
  };
}
