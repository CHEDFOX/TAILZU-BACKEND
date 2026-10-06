#!/usr/bin/env bash
# Proves the mail platform's plumbing from the VPS: DNS, PTR, the ports, TLS,
# and whether Hostinger has opened outbound port 25 yet.
#
#   ./check.sh          everything
#   ./check.sh dns      the records only (safe before anything is installed)
set -uo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }
D=${MAIL_DOMAIN:?set MAIL_DOMAIN in .env}; IP=${VPS_IP:?set VPS_IP in .env}
ok=0; bad=0
pass() { echo "  ok   $1"; ok=$((ok+1)); }
fail() { echo "  FAIL $1"; bad=$((bad+1)); }
need() { command -v "$1" >/dev/null || { echo "install $1 first (apt install dnsutils netcat-openbsd openssl)"; exit 1; }; }
need dig; need nc; need openssl

echo "DNS for $D"
for h in postal smtp mx; do
  got=$(dig +short A "$h.$D" | head -1)
  [ "$got" = "$IP" ] && pass "$h.$D → $IP" || fail "$h.$D → '${got:-nothing}' (want $IP)"
done
mx=$(dig +short MX "rp.$D" | awk '{print $2}' | sed 's/\.$//' | head -1)
[ "$mx" = "mx.$D" ] && pass "MX rp.$D → mx.$D" || fail "MX rp.$D → '${mx:-nothing}' (want mx.$D)"
spf=$(dig +short TXT "spf.$D" | tr -d '"')
case "$spf" in *"ip4:$IP"*) pass "TXT spf.$D has ip4:$IP";; *) fail "TXT spf.$D is '${spf:-nothing}' (want v=spf1 ip4:$IP ~all)";; esac
rpspf=$(dig +short TXT "rp.$D" | tr -d '"')
case "$rpspf" in *"include:spf.$D"*) pass "TXT rp.$D includes spf.$D";; *) fail "TXT rp.$D is '${rpspf:-nothing}' (want v=spf1 a mx include:spf.$D ~all)";; esac
dkim=$(dig +short TXT "postal._domainkey.$D" | tr -d '"' | tr -d ' ')
case "$dkim" in *"v=DKIM1"*"p="*) pass "TXT postal._domainkey.$D is a DKIM key";; *) fail "TXT postal._domainkey.$D is missing (setup.sh prints it)";; esac
dmarc=$(dig +short TXT "_dmarc.$D" | tr -d '"')
case "$dmarc" in *"v=DMARC1"*) pass "TXT _dmarc.$D set";; *) fail "TXT _dmarc.$D missing (v=DMARC1; p=quarantine; rua=mailto:...)";; esac
ptr=$(dig +short -x "$IP" | sed 's/\.$//' | head -1)
case "$ptr" in *".$D") pass "PTR $IP → $ptr";; *) fail "PTR $IP → '${ptr:-nothing}' (set smtp.$D in hPanel → VPS → PTR record)";; esac

[ "${1:-}" = "dns" ] && { echo; echo "$ok ok, $bad to fix"; exit $((bad > 0)); }

echo "Ports"
for p in 25 587; do nc -z -w 3 127.0.0.1 $p 2>/dev/null && pass "smtp listening on $p" || fail "nothing on port $p (docker compose ps in /opt/postal)"; done
nc -z -w 3 127.0.0.1 5000 2>/dev/null && pass "dashboard on 127.0.0.1:5000" || fail "dashboard not on 5000"
if nc -z -w 5 gmail-smtp-in.l.google.com 25 2>/dev/null; then pass "outbound port 25 is open (can deliver to Gmail)"; else fail "outbound port 25 is BLOCKED: ask Hostinger support to open it"; fi

echo "TLS"
subj=$(echo | openssl s_client -starttls smtp -connect "127.0.0.1:587" -servername "smtp.$D" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null | tr '\n' ' ')
case "$subj" in *"Let's Encrypt"*|*"R1"*) pass "STARTTLS on 587 with a certbot certificate";; *"smtp.$D"*) fail "STARTTLS works but the certificate is the placeholder: run certbot and certbot-hook.sh";; *) fail "no STARTTLS on 587: ${subj:-no answer}";; esac
code=$(curl -s -o /dev/null -w '%{http_code}' "https://postal.$D/login" || true)
[ "$code" = "200" ] && pass "https://postal.$D answers" || fail "https://postal.$D gave ${code:-nothing} (nginx vhost + certbot)"

echo; echo "$ok ok, $bad to fix"
exit $((bad > 0))
