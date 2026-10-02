#!/usr/bin/env bash
# Print the signed pay link for one account, to prove the live checkout.
#
# Run from ~/tulmi:   ./tulmi/scripts/paylink.sh <account id>
#
# The account id is the user's UID in Supabase (Authentication > Users).
# While Tailzu is free (FREE_FOR_ALL), the pay page opens only for accounts
# listed in PAY_TESTERS in tulmi/.env; anyone else is sent to /pricing.
# The link is good for about a week. It holds no secret: it names the
# account, and the server's signature on it says the server made it.
set -u
ID=${1:-}
[[ "$ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || { echo "usage: $0 <account id>   (the user's UID in Supabase > Authentication > Users)"; exit 1; }
[ -f tulmi/.env ] || { echo "run this from ~/tulmi"; exit 1; }
grep -q "^PAY_TESTERS=.*$ID" tulmi/.env \
  || echo "NOTE  $ID is not in PAY_TESTERS — while Tailzu is free, this link will send it to /pricing."
docker compose exec -T backend node -e '
import("file:///app/tulmi/dist/tulmi/src/billing/razorpay.js").then((m) => {
  const link = m.payLink("https://tailzu.space/pay", process.argv[1]);
  if (!link) { console.error("No link: RAZORPAY_KEY_SECRET is not set in the running container."); process.exit(1); }
  console.log(link);
});' "$ID"
