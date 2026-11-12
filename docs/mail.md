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
* [9. The bot in X0 Bot](#9-the-bot-in-x0-bot)
* [10. Still to come](#10-still-to-come)

## 1. How it fits

```
X0 Bot (the app) ──> the backend ──signed──> mail-worker ──JMAP──> the mail server (Stalwart, /opt/postal, Xooteq Mail's)
       ^                 ^   │                 │    ^                       │
       └── push ─────────┘   └──── signed ─────┘    └──── signed webhook ───┘  new mail, as it arrives
         (mail needs you)       notice: mail needs a person
```

* **The mail server** is the one Xooteq Mail runs on this VPS: Stalwart holds the mailboxes (it owns port 25, and only one program can) and
  sends through Postal. The worker makes each business's domain and mailbox there with Stalwart's admin login, and reads a mailbox by
  impersonation, so no mailbox password is ever kept. Each domain belongs to one side: a domain the mail server already has is refused.
* **The worker** (`mail-worker/`, Node, TypeScript run by Node itself) keeps what the mail server has no place for: the businesses and whose
  X0 account each is, each address's folder, auto-reply and AI mode, the rules, each business's brief, and the AI log with what each reply
  cost (SQLite, in the `mail_worker_data` volume).
* **The backend** calls it with signed requests, inside one X0 account each (the account is a hash in the signed path), and hears back once,
  signed the same way, when mail needs a person: it pushes to that person's phone (section 9).

## 2. A business

One per domain (`acme.in`), and as many domains as a person likes, each with its own mailbox, addresses, rules and company personality. Each
is made with its main address (`hello@`) and takes any number of aliases (`support@`, `billing@`). Mail to any of them arrives in one
mailbox, in the Inbox (All mail) and in that address's folder, as in Xooteq Mail. Each address has an AI mode:

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
change, write again as asked, send now, stop, throw away), the brief drafted from the website, a mail-app password, the mailbox
(`server/inbox.ts`: its folders, a folder's conversations a page at a time, one conversation, archive, delete, spam, read, star, mail sent
from any address, new or as a reply or a forward, and mail written by the AI), the rules (read as sentences, added, turned on or off,
removed), the overview (the
businesses, what waits for a person by priority, the last 24 hours in numbers), the spend per day, and every business of an account at once
(the account was deleted). Errors are `{ code, message }`, the message in words for a person.

The mail server's webhook is `POST /hooks/stalwart`, signed with `MAIL_WEBHOOK_SECRET` (`node server/cli.ts webhook` registers it, beside
Xooteq Mail's own, which is not touched). Mail for a domain that is not one of the worker's businesses is left alone.

**The worker's one call out** (`mail-worker/server/notice.ts`): when a message needs a person (the AI escalated it), when a draft is urgent,
or when a business's AI paused because its allowance is spent (at most once in twelve hours), it posts `{ owner, business, name, status,
run?, kind?, priority? }` to `MAIL_NOTIFY_URL` (docker-compose: the backend's `POST /v1/mail/notice`), signed with `MAIL_WORKER_SECRET`. It
carries no words of the mail, waits at most five seconds and never stops the mail: a missed notice is a message that waits on the page.

## 6. Privacy

* The worker is told whose business it is only as a hash of the X0 account. The backend keeps which person a hash is (`mail_owners`,
  migration 0080, the server's alone) only to find their phone for a push.
* The mail stays on our mail server, in the business's own mailbox. What the AI reads of a message goes to the model provider to write the
  reply, like any bot's message. Nothing a person wrote is logged by the worker (no request log; errors by their kind only).
* A push says the business and what kind of message it is ("Leaf & Co: A complaint needs your answer."), never a word of the mail.
* The chat reads the mail as the worker sorted it (who, the subject, the kind and its one line), never the mail's own text, fenced as a
  stranger's words.
* A business deleted, or the account deleted, removes its mailbox, its mail and its records. "Delete my data" does not: a business's mail
  is the business's, removed from its settings.

## 7. Configuration and deploy

| Where | Key | |
| --- | --- | --- |
| `tulmi/.env` | `MAIL_WORKER_URL`, `MAIL_WORKER_SECRET` | the worker's address and the secret every call is signed with, both ways (`deploy/mail-up.sh` sets and makes them). Both set: the mail bot is among the bots |
| `tulmi/.env` | `MAIL_WEBHOOK_SECRET` | **secret**: the mail server signs its webhook with it (made by the script) |
| `tulmi/.env` | `STALWART_ADMIN_USER`, `STALWART_ADMIN_SECRET`, `MAIL_DOMAIN`, `VPS_IP` | the mail server's, taken from `/opt/postal/.env` by the script |
| `tulmi/.env` | `OPENROUTER_API_KEY` | **secret** the server already has: the AI |
| `tulmi/.env` | `MAIL_MODELS`, `MAIL_DAILY_USD` | optional: the models, best first; one business's daily AI allowance in US dollars |
| the `.env` beside `docker-compose.yml` | `MAIL_STALWART_NETWORK` | optional: the mail server's Docker network, `postal_default` by default |
| `docker-compose.yml` | `MAIL_NOTIFY_URL` | where the worker says mail needs a person: `http://backend:8080/v1/mail/notice`, set there |

The backend's `mail_owners` table is migration 0080, which the deploy runs by itself.

Deploy steps are in DEPLOY.md ("Mail"): `./deploy/mail-up.sh && ./deploy/ship.sh`. After that `ship.sh` rebuilds and restarts the worker with
the backend and checks that it answers set up.

## 8. Tests

* `mail-worker/test/unit.test.ts`: Xooteq Mail's own: filing and auto-replies, rules, DKIM and SPF, what is never answered, message text, the
  JSON answers, the webhook signature, the prompt's fence.
* `mail-worker/test/api.test.ts`: against a stand-in mail server: the signature (the shared vector), no replay, one account each, a business
  made with its domain and mailbox and every address in Draft, a domain already on the mail server refused, a mode and the allowance, the brief,
  the webhook kept to the worker's own domains, a business and an account deleted with their mailboxes.
* `mail-worker/test/inbox.test.ts`: the mailbox against the stand-in mail server: its folders (All mail, the main address's own and each
  alias's once there are aliases, the system folders), a folder's conversations newest first with the AI's tag, an alias's own mail and the
  main address's without it, one conversation read (and marked read), archive, delete, spam and back, mail sent from an address (a reply
  with Re: and its references, a forward with the original), the AI writing a new email, and the rules as sentences, turned off and removed.
* `mail-worker/test/engine.test.ts`: the engine end to end against a stand-in mail server (`test/fakeStalwart.ts`) and a stand-in model: a
  message sorted, drafted and waiting in the overview with its cost; the urgent one and the escalation told to X0 Bot (signed, without the
  mail's words), the newsletter not; the activity without the mail server's ids, the model or the cost; the facts narrowed; the honesty
  rule; a person's change kept and shown to the next reply; a draft written again as asked, then sent once; a newsletter filed without a
  model call; the brief drafted from a site's own pages, and the addresses never read.
* `tulmi/tests/mail-routes.test.ts`: the bot listed only where it is set up, its slug reserved; every page's call passed inside the person's
  account with only the fields it takes (never the allowance), the mailbox's folder and page only when they are its own, an address's
  auto-reply put together from the form's flat fields, a bad id, conversation, action or rule refused before the worker hears of it, the
  worker's refusals in its words; the client's signature and its errors; the notice pushed to the right person once (a replay, an old or
  unsigned one refused).
* `tulmi/tests/mail-page.test.ts`: the set-up cards (the business, then the records with Copy, then the company personality read from the
  website as the records are kept and shown as read, Keep or Change it, its own page going on to the last step, then how it answers; not
  read again when set up again unless asked), the plain card
  for an older build, the page (the mailbox's rows with what is unread, needs you, answered, filed, the day's numbers, a chip per domain and
  Add a domain), a reply (Send with the changes first, Keep, Throw away, written again, Stop), the settings' rows, the records and the
  company personality; every tree through the app's linter.
* `tulmi/tests/mail-inbox.test.ts`: the mailbox (a chip per folder and per domain, its conversations, a page at a time, an unknown folder
  read as All mail), one conversation (oldest first, attachments, Archive, Delete, Spam or Back to inbox, the AI's draft), writing (from any
  address, a reply from the address it came to, a forward, the AI writing it), a domain's addresses (an alias added with its folder; one
  address's folder, name, AI mode and auto-reply; removed on a second yes, never the main one) and its rules.
* `tulmi/tests/mail-chat.test.ts`: the chat's digest (the day, what needs a person, the latest, a stranger's subject fenced), the mail bot's
  turn with it as knowledge in one call; found by its own phrases, never by "write an email"; its pushes and the person's switches.

**Needs a live check**: the worker on the VPS beside the real mail server; a business made, its records added, a message received and
answered.

## 9. The bot in X0 Bot

A built-in bot (`slug` "mail", the name "Mail" a placeholder until it is given one, colour sand, the envelope icon), listed only where
`MAIL_WORKER_URL` and `MAIL_WORKER_SECRET` are set (`bots/builtin.ts`). Its pages are the app's own, built on the server from the kit, so
they change with no release, and both apps draw them: the phone (TAILZU-FRONTEND) and the window (TAILZU-DESKTOP), each checked with its own
renderer (`tulmi/scripts/bots-render`). It is on Home's grid beside the first three, with the Oracle (`shell/home.ts homeShown`), on the phone
and in the window; in the window's sidebar ("Your bots"); in Ask's list of bots; and by @mail.

**Its look** (`shared/bots/looks.json`, played by the apps' own engine, so it needs no release): **the postie**, in a navy cap, a postal-red
satchel at his back with a letter peeking out of it (avatar `postie`; parts `mailbag`, `envelope`, `stamper`, `postmark`). On Home's tile he
catches the letters as they drop in and files each in his bag, on a loop (`m.sort`), as Xode juggles his bits; on the set-up card a letter flies
in and he catches it, reads who it is from and tucks it away (`m.catch`); in the page's head he stamps a letter twice and sends it off with a wave
(`m.stamp`). A build that cannot play looks gets the plain tile and Blip.

| What | Where |
| --- | --- |
| The routes its pages call, passed to the worker inside the person's account | `tulmi/src/routes/bots/mail.ts` (the list at its top) |
| The signed client, the account's hash, the notice's check | `tulmi/src/mail/worker.ts` |
| Which person a hash is, for the push | `tulmi/src/mail/owners.ts`, migration 0080 |
| What the chat knows | `tulmi/src/mail/digest.ts` |
| The page | `experience/bots/screens/bots/mailPage.ts` (bots.bot with slug "mail") |
| The set-up cards | `experience/bots/screens/bots/mailCards.ts` |
| A reply, the records, the company personality, a business's settings | `experience/bots/screens/bots/mailScreens.ts` (bots.mail.reply, .dns, .brief, .settings) |
| The mailbox: a folder, a conversation, writing | `experience/bots/screens/bots/mailInbox.ts` (bots.mail.inbox, .thread, .compose) |
| A domain's addresses (aliases) and its rules | `experience/bots/screens/bots/mailAliases.ts` (bots.mail.addresses, .address, .rules) |

**Set-up**, one card over the page with its stage on top (the Oracle's way), each step kept as it is answered:

1. **The business**: its name and its domain. Its mailbox (`hello@`) is made on our mail server. Nothing to bring.
2. **Point the domain here**: the four records it needs (MX, SPF, DKIM, DMARC), each with Copy and its live check; Check again. Mail
   arrives once the MX is in; Next never waits on it. Next also starts reading the domain's website ("Analysing leafandco.in…", one model
   call), for the next card.
3. **Company personality**: how the business sounds and what it knows (about, voice, facts, rules), read from its website and shown as
   read. The AI writes every email with it. **Keep** keeps it; **Change it** keeps it too (what was read is not lost), then opens its own
   page in the card's place, whose Keep (or Back) goes on to the last step (`params step=mode`). Kept, the business is set up (`ready`);
   later it is in the settings. Neither goes while the website is still being read. The card shows no fields: a card over the page does not
   scroll, and four long fields with a keyboard up would push Keep off a small phone. Set up again with a personality already kept, the
   website is not read again unless they tap "Read leafandco.in again".
4. **How it answers**: Drafts for you (every reply waits for a person; the start) or Sends by itself (after a short wait; money, legal
   matters, complaints and anything unsure still wait). Every address of the business, the same way.

**The page**: the domain's main address and how it answers, and its settings; a chip per domain, and **Add a domain** (any number). Before
anything arrives, one line says that mail comes once the domain points here, with the records a tap away. Then the last 24 hours in
numbers; **the mailbox**, as Xooteq Mail's side bar has it: All mail (every address), the main address's own and each alias's (once there
are aliases), Sent and the other folders, each with what is unread, and **Write**; and three lists: **Needs you** (a message a person should answer, then drafts, then replies about to go by themselves, urgent ones
first, each with the AI's one line, the sender, the kind and when), **Answered** and **Filed** (with why: a newsletter, automatic mail, the
AI paused). At its foot, the chat: "What needs me today?", "Summarize this week's mail".

**The mailbox** (`bots.mail.inbox`): a chip per domain (when there are several) and per folder: All mail, the main address's own, each
alias's, Drafts, Sent, Archive, Spam, Trash and any other folder, with what is unread. A folder's conversations, newest first, 30 a page
(Newer, Older): who, how many, the subject, the start of the last message, when, unread, starred, and what the AI did ("AI draft", "Needs
you", "AI answered"). **One conversation** (`bots.mail.thread`): oldest first, each message whole with its attachments' names; Archive,
Delete, Spam (Back to inbox from Trash or Spam), Mark unread, Star; the AI's draft a tap away ("See the draft"); Reply and Forward.

**Writing** (`bots.mail.compose`): new mail, a reply or a forward, from any of the domain's addresses (a reply from the address it was sent
to). To, Cc, Subject, the message. **Write with AI**: for a reply, "Answer it", "Say no, kindly" or their own words, in the business's voice;
for new mail, what it is about, and the AI writes the subject and the message. They read it and send it. The signature goes under it.

**A domain's addresses** (`bots.mail.addresses`, from its settings): the main address and each alias, with its folder, how it answers and
its auto-reply; another alias added with its folder's name (any number). **One address** (`bots.mail.address`): its folder's name (an
alias's), the name it sends as, how the AI answers it (Drafts, Sends, Off), and its auto-reply (on or off, subject, message, once per sender
every day, 3 days or a week). An alias is removed on a second yes; the main address never is.

**Rules** (`bots.mail.rules`): each a sentence ("When From contains "invoice": move to Billing"), turned on or off, removed; another added
from one condition (From, To, Subject or Message contains…) and one action (move to a folder, mark as read, star, forward, delete). They run
on each message as it arrives, in order, before the AI reads it.

**A reply** (from Needs you, or a push): the message, how it was sorted, and its draft to change. Shorter, Warmer, More formal, Offer a
call, or their own words write it again (still a draft). **Send** saves their words first when they changed them (the AI learns from what
they changed) and sends; Keep keeps it as a draft; Throw away. A reply about to go by itself says when, with Stop.

**A business's settings**: Addresses, Company personality, Rules and Domain records, each its own screen; the AI's last 24 hours (paused
when its allowance is spent); Set it up again; Add a domain; a mail app's password and servers; and removing the business (only on a second
yes).

**The chat** runs the bots' usual loop with no tools: its knowledge is the business's mail as the worker sorted it (`mail/digest.ts`): the
day in numbers, what waits for a person first, the latest 30 after, one line each. It cannot send or change a reply: it says where to.

**Found** by an @mail, by its own phrases ("my business email", "customer emails waiting", "mail bot"), or by the small model when unsure;
never by "write an email" or "reply to this mail", which are Keylessbord's (`bots/door.ts`, WORD_NAME: its placeholder name is an
everyday word; given a real name, it moves to NAME_ONLY).

**Pushes** (`push/defaults.ts`, the person's switches in `you/push.ts`): `mail_needs_you` ("A complaint needs your answer.") and
`mail_urgent` ("An order has a draft waiting for you.") open the reply; `mail_paused` ("Today's AI allowance is used up. New mail waits for
you.") opens the page. They come as a customer is waiting: quietly in quiet hours, never with the mail bot turned off. Every other draft
waits on the page.

## 10. Still to come

Its name (the owner's, later). A live check on the VPS: a business made from the app, its records added, a message received, its push, a
reply sent from the app. A message filed while the AI was paused has no draft yet: it is answered from a mail app for now.
