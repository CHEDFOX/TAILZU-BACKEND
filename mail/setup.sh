#!/usr/bin/env bash
# First run of the mail platform on the VPS. Safe to run again: makes what is
# missing, leaves what is there.
#
#   cd ~/tulmi/mail && cp .env.example .env && nano .env && sudo ./setup.sh
#
# What it does, in order: reads .env, makes /opt/postal, the signing key and the
# Rails secret, writes postal.yml from the template, copies the compose file,
# pulls the images, starts MariaDB, initializes Postal's database, starts
# everything, makes the first dashboard user, and prints the DKIM DNS record.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "mail/.env is missing: cp .env.example .env and fill it in"; exit 1; }
set -a; . ./.env; set +a
for v in MAIL_DOMAIN VPS_IP DB_ROOT_PASSWORD DB_PASSWORD ADMIN_EMAIL SYSTEM_FROM; do
  [ -n "${!v:-}" ] || { echo ".env: $v is empty"; exit 1; }
done
case "$DB_ROOT_PASSWORD$DB_PASSWORD" in *change-me*) echo ".env: replace the change-me passwords"; exit 1;; esac
command -v docker >/dev/null || { echo "docker is not installed (curl -fsSL https://get.docker.com | sh)"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is needed"; exit 1; }

P=/opt/postal
mkdir -p "$P/config/tls"
chmod 755 "$P" "$P/config"

# The signing key: DKIM for every message and the return-path signatures.
if [ ! -f "$P/config/signing.key" ]; then
  openssl genrsa -out "$P/config/signing.key" 2048 2>/dev/null
  chmod 644 "$P/config/signing.key"
  echo "made the signing key"
fi

# The Rails secret, kept beside the config so a re-setup keeps sessions valid.
if [ ! -f "$P/config/rails.secret" ]; then
  openssl rand -hex 64 > "$P/config/rails.secret"
  chmod 600 "$P/config/rails.secret"
fi
RAILS_SECRET=$(cat "$P/config/rails.secret")
export RAILS_SECRET

# postal.yml from the template: only the ${VARS} the template names, replaced
# with plain string substitution so a password with any character in it is fine.
t=$(cat postal.yml.template)
t=${t//\$\{MAIL_DOMAIN\}/$MAIL_DOMAIN}
t=${t//\$\{DB_PASSWORD\}/$DB_PASSWORD}
t=${t//\$\{SYSTEM_FROM\}/$SYSTEM_FROM}
t=${t//\$\{RAILS_SECRET\}/$RAILS_SECRET}
printf '%s\n' "$t" > "$P/config/postal.yml"
chmod 640 "$P/config/postal.yml"

# A placeholder certificate until certbot's arrives (certbot-hook.sh replaces
# it), so the SMTP server starts with STARTTLS from the first minute.
if [ ! -f "$P/config/tls/fullchain.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=smtp.$MAIL_DOMAIN" \
    -keyout "$P/config/tls/privkey.pem" -out "$P/config/tls/fullchain.pem" 2>/dev/null
  chmod 644 "$P/config/tls/fullchain.pem"; chmod 644 "$P/config/tls/privkey.pem"
  echo "made a placeholder TLS certificate (run certbot, then certbot-hook.sh)"
fi

cp docker-compose.yml mariadb-init.sql certbot-hook.sh "$P/"
cp .env "$P/.env"; chmod 600 "$P/.env"
chmod +x "$P/certbot-hook.sh"
cd "$P"

docker compose pull -q
docker compose up -d mariadb
echo "waiting for MariaDB"
for i in $(seq 1 30); do
  docker compose exec -T mariadb healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 && break
  sleep 2
done
# The per-server grant, for a data volume made before this script had it.
docker compose exec -T mariadb mariadb -uroot -p"$DB_ROOT_PASSWORD" -e \
  "GRANT ALL PRIVILEGES ON \`postal\`.* TO 'postal'@'%'; GRANT ALL PRIVILEGES ON \`postal-%\`.* TO 'postal'@'%'; FLUSH PRIVILEGES;"

# Postal's schema. "initialize" is idempotent: a second run migrates, not wipes.
docker compose --profile tools run --rm runner postal initialize

docker compose up -d
echo "started: web, smtp, worker, cron"

# The first login. Postal asks for the details itself.
echo
echo "== the first dashboard user (press Enter after each answer) =="
docker compose --profile tools run --rm runner postal make-user || echo "(make-user skipped or already done)"

echo
echo "== add this TXT record at your DNS, name: postal._domainkey.$MAIL_DOMAIN =="
docker compose --profile tools run --rm -T runner postal default-dkim-record || true
echo
echo "next: nginx + certbot (README step 3), then ./check.sh"
