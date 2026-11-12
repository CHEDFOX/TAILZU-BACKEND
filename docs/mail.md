# Mail: a bot that runs a business's email

A built-in bot (its name comes later) that keeps a business's mail: its mailboxes on our mail server, mail filed by address, and
replies the AI writes in the business's own voice, drafted for a person to send or sent after a short wait. The business brings nothing:
the mail server and the AI are ours. Its engine is the mail engine of the owner's **Xooteq Mail**, copied into this repository and tuned
for any business (`mail-worker/`, where it came from and what changed: `mail-worker/README.md`). Xooteq Mail itself is not changed.

* [1. How it fits](#1-how-it-fits)
* [2. A business](#2-a-business)
* [3. How a reply is written](#3-how-a-reply-is-written)
* [4. The AI and the money](#4-the-ai-and-the-money)
* [5. What the worker answers](#5-what-the-worker-answers)
* [6. Privacy](#6-privacy)
* [7. Configuration and deploy](#7-configuration-and-deploy)
* [8. Tests](#8-tests)
* [9. Still to come](#9-still-to-come)

## 1. How it fits

```
X0 Bot (the app) ──> the backend ──signed──> mail-worker ──JMAP──> the mail server (Stalwart, /opt/postal, Xooteq Mail's)
                                                  ^                       │
                                                  └──── signed webhook ───┘  new mail, as it arrives
```

* **The mail server** is the one Xooteq Mail runs on this VPS: Stalwart holds the mailboxes (it owns port 25, and only one program can) and
  sends through Postal. The worker makes each business's domain and mailbox there with Stalwart's admin login, and reads a mailbox by
  impersonation, so no mailbox password is ever kept. Each domain belongs to one side: a domain the mail server already has is refused.
* **The worker** (`mail-worker/`, Node, TypeScript run by Node itself) keeps what the mail server has no place for: the businesses and whose
  X0 account each is, each address's folder, auto-reply and AI mode, the rules, each business's brief, and the AI log with what each reply
  cost (SQLite, in the `mail_worker_data` volume).
* **The backend** calls it with signed requests, inside one X0 account each (the account is a hash in the signed path).

## 2. A business

One per domain (`acme.in`), made with its main address (`hello@`) and any others (`support@`, `billing@`). Mail to any of them arrives in one
mailbox, in the Inbox and in that address's folder. Each address has an AI mode:

| Mode | What happens |
| --- | --- |
| **Draft** (the start) | each new message gets a reply in Drafts, for a person to read, change and send |
| **Send** | the reply waits a few minutes (the brief's delay) and goes, unless stopped; anything about money, legal matters or a complaint, anything the AI is unsure of, and a sender's 4th message of the day become drafts instead |
| **Off** | nobody answers but a person |

The domain's DNS records (MX, SPF, DKIM, DMARC) are listed with a live check of each; mail arrives once the MX points here. A mail app on a
phone or a computer can be added with a password the business sets. A business deleted takes its mailbox and its mail with it.

## 3. How a reply is written

New mail -> the webhook -> the address's mode -> the message read from the mailbox -> skipped when it is a newsletter, a mailing list, bulk
mail, a robot or no-reply sender, from the business's own domain, or in Junk (filed as low priority, no model call) -> **one model call**
with the business's brief (what it does, how it sounds, its rules, the sign-off), the facts it may use, the team's last changes to drafts,
and the thread's last five messages, the email fenced off as data and never as instructions -> reply, escalate (a person should answer; a
kind holding reply is drafted) or ignore -> a draft, or a send after the wait. Every decision is logged with why.

The same call sorts the message, so the page can put what matters first:

| | |
| --- | --- |
| **kind** | question, support, sales, order, billing, complaint, partnership, job, personal, notification, spam, other |
| **priority** | urgent (an unhappy customer, money, something that stops their work, a deadline), normal, low |
| **summary** | one line: what the sender wants |

* **The brief, first from the website.** "Fill from my website" reads the business's home page and up to three of its own pages that say
  what it sells and how (about, pricing, services, FAQ, shipping, returns, contact) and drafts the brief in one model call; the person reads
  it and keeps it. Pages are read only from public addresses (every address a name resolves to is checked as the connection is made, on
  every redirect too), on ports 80 and 443, 8 seconds and a megabyte at most.
* **Long facts, narrowed.** Up to 6,000 characters of facts go in whole; beyond that, the first part (what the business is) and the parts
  that share the most words with the email.
* **Learning from the team.** When a person changes a draft before sending it, the AI's words and theirs are kept (the last 20 per
  business), and the last three are shown to the model as how the team writes: their way of writing, never their facts.
* **Written again as asked.** A person can ask for a draft to be changed ("shorter", "offer a call") and it is written again, still a draft.
* **Honest about what it is.** The AI never claims to be a person; a sender who sincerely asks gets a person.

## 4. The AI and the money

Ours, for every business: OpenRouter with the platform's key (`OPENROUTER_API_KEY`), best model first (`MAIL_MODELS`, by default Claude
Sonnet 5.5 at low thinking, then Gemini 3.8 Flash at low thinking); a model that fails hands the request to the next. Each reply's cost comes
back from OpenRouter and is logged. Each business has a **daily allowance** (`MAIL_DAILY_USD`, 1 US dollar by default, or its own, set by
the backend), measured over the last 24 hours: once spent, its AI pauses (the mail still arrives) and answers again as that spend ages. The backend reads what each business spent per day.

## 5. What the worker answers

All under `/v1/o/:owner/...`, signed with `MAIL_WORKER_SECRET` (the media and Oracle workers' scheme: `tulmi/src/media/worker.ts`
`workerSignature`). The list, with each body: `mail-worker/server/routes/x0.ts`. In short: the account's businesses (list, make, change,
delete), a business's DNS records, its addresses and their modes, its brief, its activity, a reply (read beside the message it answers,
change, write again as asked, send now, stop, throw away), the brief drafted from the website, a mail-app password, the overview (the
businesses, what waits for a person by priority, the last 24 hours in numbers), the spend per day, and every business of an account at once
(the account was deleted). Errors are `{ code, message }`, the message in words for a person.

The mail server's webhook is `POST /hooks/stalwart`, signed with `MAIL_WEBHOOK_SECRET` (`node server/cli.ts webhook` registers it, beside
Xooteq Mail's own, which is not touched). Mail for a domain that is not one of the worker's businesses is left alone.

## 6. Privacy

* The worker is told whose business it is only as a hash of the X0 account.
* The mail stays on our mail server, in the business's own mailbox. What the AI reads of a message goes to the model provider to write the
  reply, like any bot's message. Nothing a person wrote is logged by the worker (no request log; errors by their kind only).
* A business deleted, or the account deleted, removes its mailbox, its mail and its records.

## 7. Configuration and deploy

| Where | Key | |
| --- | --- | --- |
| `tulmi/.env` | `MAIL_WORKER_URL`, `MAIL_WORKER_SECRET` | the worker's address and the secret every call is signed with (`deploy/mail-up.sh` sets and makes them) |
| `tulmi/.env` | `MAIL_WEBHOOK_SECRET` | **secret**: the mail server signs its webhook with it (made by the script) |
| `tulmi/.env` | `STALWART_ADMIN_USER`, `STALWART_ADMIN_SECRET`, `MAIL_DOMAIN`, `VPS_IP` | the mail server's, taken from `/opt/postal/.env` by the script |
| `tulmi/.env` | `OPENROUTER_API_KEY` | **secret** the server already has: the AI |
| `tulmi/.env` | `MAIL_MODELS`, `MAIL_DAILY_USD` | optional: the models, best first; one business's daily AI allowance in US dollars |
| the `.env` beside `docker-compose.yml` | `MAIL_STALWART_NETWORK` | optional: the mail server's Docker network, `postal_default` by default |

Deploy steps are in DEPLOY.md ("Mail"): `./deploy/mail-up.sh && ./deploy/ship.sh`. After that `ship.sh` rebuilds and restarts the worker with
the backend and checks that it answers set up.

## 8. Tests

* `mail-worker/test/unit.test.ts`: Xooteq Mail's own: filing and auto-replies, rules, DKIM and SPF, what is never answered, message text, the
  JSON answers, the webhook signature, the prompt's fence.
* `mail-worker/test/api.test.ts`: against a stand-in mail server: the signature (the shared vector), no replay, one account each, a business
  made with its domain and mailbox and every address in Draft, a domain already on the mail server refused, a mode and the allowance, the brief,
  the webhook kept to the worker's own domains, a business and an account deleted with their mailboxes.
* `mail-worker/test/engine.test.ts`: the engine end to end against a stand-in mail server (`test/fakeStalwart.ts`) and a stand-in model: a
  message sorted, drafted and waiting in the overview with its cost; the facts narrowed; the honesty rule; a person's change kept and shown
  to the next reply; a draft written again as asked, then sent once; a newsletter filed without a model call; the brief drafted from a site's
  own pages, and the addresses never read.

**Needs a live check**: the worker on the VPS beside the real mail server; a business made, its records added, a message received and
answered.

## 9. Still to come

The bot in X0 Bot (its name comes later): set-up cards in the app's own look (the business, its domain with the records and their checks, its
addresses, the brief, Draft or Send), its page (what needs a person, what was answered, what was filed), chat, and a notice when mail needs a
person.
