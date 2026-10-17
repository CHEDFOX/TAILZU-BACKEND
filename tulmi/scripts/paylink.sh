#!/usr/bin/env bash
# Print a one-day TEST pay link for your own account, to prove the live
# checkout while Tailzu is free.
#
# Run from ~/tulmi:   ./tulmi/scripts/paylink.sh you@example.com
#
# Give the email you sign in to Tailzu with (an account id works too). No
# setting is needed: while FREE_FOR_ALL is on, the pay page opens only for a
# test link, and only this script, run on the server, can make one. It is a
# real checkout — real money — so cancel in the app and refund from the
# Razorpay dashboard afterwards. The link expires in a day.
set -u
WHO=${1:-}
[ -n "$WHO" ] || { echo "usage: $0 <your email>"; exit 1; }
[ -f tulmi/.env ] || { echo "run this from ~/tulmi"; exit 1; }
docker compose exec -T backend node -e '
import("file:///app/tulmi/dist/tulmi/src/billing/razorpay.js").then(async (m) => {
  const id = await m.accountIdFor(process.argv[1]);
  if (!id) { console.error("No Tailzu account with that email."); process.exit(1); }
  const link = m.payLink("https://tailzu.space/pay", id, Date.now(), true);
  if (!link) { console.error("No link: RAZORPAY_KEY_SECRET is not set in the running container."); process.exit(1); }
  console.log(link);
}).catch((e) => { console.error(e.message); process.exit(1); });' "$WHO"
