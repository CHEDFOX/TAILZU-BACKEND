#!/usr/bin/env bash
# Hands certbot's certificate for smtp.<MAIL_DOMAIN> to Postal's SMTP server,
# which reads it from /opt/postal/config/tls. Certbot calls this after every
# renewal (--deploy-hook); run it once by hand after the first issue.
set -euo pipefail
P=/opt/postal
set -a; . "$P/.env"; set +a
LIVE=/etc/letsencrypt/live/postal.$MAIL_DOMAIN
[ -d "$LIVE" ] || LIVE=/etc/letsencrypt/live/smtp.$MAIL_DOMAIN
[ -f "$LIVE/fullchain.pem" ] || { echo "no certificate at $LIVE yet"; exit 1; }
install -m 644 "$LIVE/fullchain.pem" "$P/config/tls/fullchain.pem"
install -m 644 "$LIVE/privkey.pem" "$P/config/tls/privkey.pem"
cd "$P" && docker compose restart smtp >/dev/null
echo "smtp server now uses the certificate from $LIVE"
