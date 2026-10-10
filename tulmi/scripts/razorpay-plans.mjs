/**
 * Create Tailzu's Razorpay plans, once, and print the RAZORPAY_PLANS line.
 *
 * Plans are made here and never by hand, so the names, periods, currencies
 * and the line the server reads cannot drift apart. Run inside the backend
 * container, which already holds the keys (nothing here prints them):
 *
 *   cd ~/tulmi
 *   docker compose exec -T backend node - --dry-run \
 *     --in-monthly RUPEES --in-annual RUPEES --world-monthly 9.99 --world-annual 59.99 \
 *     < tulmi/scripts/razorpay-plans.mjs
 *
 * Prices are in rupees for IN and US dollars for world, as you want them on
 * the pay page (9.99 and 59.99 are the app stores' prices today). Drop --dry-run to create them. Either market can be left out
 * (give neither of its prices). Then put the printed line in tulmi/.env and
 * restart the backend.
 *
 * Test keys (rzp_test_) make test plans; live keys make live ones. Plans are
 * separate in each mode, so run it again after switching to live keys.
 * Running it twice makes a second set: Razorpay plans cannot be edited or
 * deleted, only left unused.
 */
const MARKETS = [
  { market: "IN", currency: "INR" },
  { market: "world", currency: "USD" },
];
const PERIODS = [
  { period: "monthly", razorpay: "monthly", name: "Tailzu Lite", description: "Unlimited words, billed monthly" },
  { period: "annual", razorpay: "yearly", name: "Tailzu Elite", description: "Unlimited words, billed yearly" },
];

function args() {
  const out = { dryRun: false, prices: {} };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    const m = /^--(in|world)-(monthly|annual)$/.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    const v = Number(argv[++i]);
    if (!Number.isFinite(v) || v < 1) throw new Error(`${a} needs a price of at least 1, got ${argv[i]}`);
    out.prices[`${m[1] === "in" ? "IN" : "world"}:${m[2]}`] = v;
  }
  return out;
}

async function main() {
  const { dryRun, prices } = args();
  const keyId = String(process.env.RAZORPAY_KEY_ID ?? "");
  const secret = String(process.env.RAZORPAY_KEY_SECRET ?? "");
  if (!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(keyId) || !secret) {
    throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set in this container");
  }
  const plans = [];
  for (const { market, currency } of MARKETS) {
    const want = PERIODS.map((p) => prices[`${market}:${p.period}`]);
    if (want.every((v) => v === undefined)) continue;
    if (want.some((v) => v === undefined)) throw new Error(`${market} needs both --${market.toLowerCase()}-monthly and --${market.toLowerCase()}-annual`);
    PERIODS.forEach((p, i) => plans.push({ market, currency, ...p, amount: Math.round(want[i] * 100) }));
  }
  if (!plans.length) throw new Error("no prices given: see the usage at the top of this script");

  console.log(`${keyId.startsWith("rzp_test_") ? "TEST" : "LIVE"} mode, ${dryRun ? "dry run" : "creating"}:`);
  for (const p of plans) console.log(`  ${p.market.padEnd(5)} ${p.period.padEnd(7)} ${p.name}  ${p.currency} ${(p.amount / 100).toFixed(2)}`);
  if (dryRun) { console.log("\nNothing created. Run again without --dry-run."); return; }

  const auth = `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`;
  const made = [];
  for (const p of plans) {
    const res = await fetch("https://api.razorpay.com/v1/plans", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        period: p.razorpay,
        interval: 1,
        item: { name: p.name, amount: p.amount, currency: p.currency, description: p.description },
        notes: { app: "tailzu", market: p.market, period: p.period },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !/^plan_/.test(String(json.id ?? ""))) {
      const why = json?.error?.description ?? res.statusText;
      throw new Error(`Razorpay refused ${p.market} ${p.period}: ${why}` +
        (made.length ? `\nAlready created: ${made.join(",")}` : ""));
    }
    made.push(`${p.market}:${p.period}:${json.id}`);
    console.log(`  created ${json.id}`);
  }
  console.log(`\nPut this line in tulmi/.env, then restart the backend:\n\nRAZORPAY_PLANS=${made.join(",")}\n`);
}

main().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
