# The mail platform — Postal on the VPS

Every app sends through this: Tailzu's sign-in codes (Supabase → SMTP → here),
and anything else that needs an email out. It is [Postal](https://postalserver.io),
open source and self-hosted: each app is a *mail server* in Postal with its own
SMTP login and API key, each domain an app sends from gets its own DKIM key, every
email is logged with its delivery status, bounces and complaints come back here
and go onto a suppression list. No per-email cost and no monthly cap; the limits
are the receivers' (Gmail, Outlook), which is what the DNS and warm-up below are
about.

One domain hosts the platform (the **platform domain**, `MAIL_DOMAIN` in `.env`,
e.g. `mail.xooteqlab.com`). Apps keep sending from their own domains
(`hello@tailzu.space`); the platform domain only appears in the plumbing
(return-path, DKIM identifier, the dashboard's address).

Everything lives in `/opt/postal` on the server; this folder holds the config and
the scripts that put it there.

```
mail/
  docker-compose.yml     Postal (web, smtp, worker, cron) + MariaDB
  postal.yml.template    Postal's config; setup.sh fills it from .env
  mariadb-init.sql       the grant Postal needs for its per-server databases
  setup.sh               first run: keys, config, database, admin user, DKIM record
  check.sh               proves DNS, PTR, ports and TLS before and after
  nginx-postal.conf      the dashboard behind the VPS's existing nginx
  certbot-hook.sh        hands renewed certificates to the SMTP server
  .env.example           the few values to fill in
```

## 0. Before anything: Hostinger

Two things only Hostinger can do, and both take a day, so start them first.

1. **Outbound port 25.** Hostinger closes it on every VPS. Open a support chat
   from hPanel and ask: *"Please open outbound port 25 on VPS <IP>. It will send
   transactional email (sign-in codes) from our own mail server with SPF, DKIM,
   DMARC and a PTR record configured."* Until it is open the server can receive
   but not deliver. `check.sh` shows when it is.
2. **PTR (reverse DNS).** hPanel → VPS → Settings → *PTR record*: set it to
   `smtp.<MAIL_DOMAIN>`. Gmail refuses mail from an IP whose reverse name does
   not resolve back to it.

Also in hPanel → VPS → **Firewall**: allow inbound TCP **25** and **587**
(and 80/443 are already open for nginx).

## 1. DNS for the platform domain

With `MAIL_DOMAIN=mail.xooteqlab.com` and the VPS at `91.108.104.168`, add at the
DNS host of `xooteqlab.com`:

| Type | Name | Value |
|---|---|---|
| A | `postal.mail` | `91.108.104.168` — the dashboard |
| A | `smtp.mail` | `91.108.104.168` — what apps and Supabase connect to |
| A | `mx.mail` | `91.108.104.168` — receives bounces |
| MX | `rp.mail` | `10 mx.mail.xooteqlab.com` |
| TXT | `rp.mail` | `v=spf1 a mx include:spf.mail.xooteqlab.com ~all` |
| TXT | `spf.mail` | `v=spf1 ip4:91.108.104.168 ~all` |
| TXT | `postal._domainkey.mail` | *printed by setup.sh, step 3* |
| CNAME | `track.mail` | `postal.mail.xooteqlab.com` (optional, click tracking) |
| TXT | `_dmarc.mail` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@xooteqlab.com` |

(`mail` is the subdomain label; most panels want the name without the domain.
If the panel wants the full name, it is `postal.mail.xooteqlab.com` and so on.)

## 2. Install

On the VPS, in this repo's checkout (`~/tulmi`):

```bash
cd ~/tulmi/mail
cp .env.example .env && nano .env        # MAIL_DOMAIN, VPS_IP, passwords, admin email
./check.sh dns                            # the records above resolve
sudo ./setup.sh                           # keys, config, database, images, admin user
```

`setup.sh` is safe to run again; it only creates what is missing. At the end it
prints the DKIM TXT record for `postal._domainkey.<MAIL_DOMAIN>`: add it, then
`./check.sh dns` again until it shows.

## 3. The dashboard and TLS

The dashboard runs on `127.0.0.1:5000`; the VPS's nginx fronts it, with a
certificate from certbot that is also handed to the SMTP server (STARTTLS on
587 needs one).

```bash
sudo cp nginx-postal.conf /etc/nginx/sites-available/postal.conf
sudo sed -i "s/MAIL_DOMAIN/$(grep ^MAIL_DOMAIN .env | cut -d= -f2)/g" /etc/nginx/sites-available/postal.conf
sudo ln -sf /etc/nginx/sites-available/postal.conf /etc/nginx/sites-enabled/postal.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d postal.$MAIL_DOMAIN -d smtp.$MAIL_DOMAIN -d mx.$MAIL_DOMAIN \
  --deploy-hook /opt/postal/certbot-hook.sh
sudo /opt/postal/certbot-hook.sh          # first hand-over; renewals call it themselves
```

Open `https://postal.<MAIL_DOMAIN>` and sign in with the admin user from setup.

## 4. The first app: Tailzu

In the dashboard:

1. **Organization** → *Create*: `XOOTEQ LAB` (one for everything you own).
2. **Mail server** → *Create*: `Tailzu`, mode *Live*. One per app.
3. **Domains** → *Add*: `tailzu.space`. Postal shows four records to add at
   tailzu.space's DNS: a verification TXT, SPF (`v=spf1 include:spf.<MAIL_DOMAIN> ~all`),
   a DKIM TXT (`postal-xxxx._domainkey`) and the return path CNAME
   (`psrp.tailzu.space → rp.<MAIL_DOMAIN>`). Add them, click *Check*, all green.
   Add `_dmarc.tailzu.space` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@tailzu.space`.
4. **Credentials** → *Add*: type **SMTP**, name `supabase`. Postal shows the
   username and password once.

Then in Supabase → Project Settings → Auth → **SMTP**:

| Field | Value |
|---|---|
| Sender email | `hello@tailzu.space` |
| Sender name | `Tailzu` |
| Host | `smtp.<MAIL_DOMAIN>` |
| Port | `587` |
| Username | the SMTP credential's username |
| Password | its password |

Save, request a code from the app, and watch it appear under the Tailzu server's
**Messages** in the dashboard with its delivery status.

Another app is steps 2–4 again with its own name, domain and credentials. An
app that sends from code uses an **API** credential instead and
`POST https://postal.<MAIL_DOMAIN>/api/v1/send/message` with the
`X-Server-API-Key` header (JSON: `to`, `from`, `subject`, `html_body`).

## 5. Warm-up

A new IP has no history. For the first two weeks keep it to real sign-in codes
and a few test mails a day; do not send a campaign. Watch
`https://postal.<MAIL_DOMAIN>` → the server → **Messages** for *Bounced* and
*Held*, and Google Postmaster Tools (add tailzu.space there; it shows how Gmail
rates the domain and IP). Spam complaints above 0.3% or bounces above 5% get an
IP throttled, and the suppression list in Postal stops repeat sends to dead
addresses automatically.

## When a code does not arrive

1. Dashboard → Tailzu → Messages: is it there? **Not there**: Supabase could not
   connect. Check the credential and that `./check.sh` shows 587 open.
   **Held**: Postal found a problem with the message (spam score, a domain not
   verified). **Bounced**: the receiver refused; the bounce text says why.
   **Delivered**: the receiver accepted it; look in Spam.
2. `./check.sh` from the VPS: DNS, PTR, port 25 out, TLS.
3. `docker compose -f /opt/postal/docker-compose.yml logs --tail 100 smtp worker`.
