# Follow-through's real phone call (Plivo)

Follow-through (`docs/plan-ease.md` section 9) can end its climb for a must-not-miss item with a **real phone call**: X0 calls the
person's own phone, says the reminder, and they press **1 done, 2 later, 3 can't, 9 stop these calls**. This page is for the owner:
what it does, who it can reach, what to set up at Plivo, every setting, and what it costs at most.

It is **off** (`CHANNEL_PHONE_CALLS=false`) and stays off until every key below is set. Nothing in the code turns it on.

Code: `tulmi/src/botsBots/followPhone.ts` (the channel), `tulmi/src/botsBots/followPhoneWords.ts` (every word it says, the keypad, the
XML, Plivo's signature), `tulmi/src/routes/bots/followChannels.ts` (routes), `tulmi/src/experience/bots/screens/bots/followPhone.ts`
(the setup screen), `tulmi/tests/follow-phone.test.ts`. The ladder that decides when to call is Backend A's (`planFollow.ts`, the
`phone` rung) through the seam in `planFollowChannels.ts`.

## Who it can call

- **Only X0 users, only their own number, only after they said yes twice.** WhatsApp, people without the app and reply pages were
  dropped by the owner; there is no way to call anyone else.
  1. They turn on **"X0 may call my phone if I miss something important"** in What pings you (off by default; the switch only shows
     once this channel is ready).
  2. They type their own mobile number on the **Calls to your phone** screen (`bots.plan.phone`). The screen shows a **4-digit code**.
     They **call X0's number once from that phone** and type the code. Only then is the number theirs (`plan_phones.verified_ms`). X0
     never calls a number to prove it: that would be calling someone who never said yes.
- **One call proves one account.** The waiting accounts are found by the number's keyed hash, then only the one whose code was typed is
  proved; any other account waiting on the same number stays unproved (codes are never the same for two accounts waiting on one number).
  Pressing 1, or a wrong code, proves nothing.
- **One account per number.** A proved number is on one account only. A fresh proof on another account moves it there: the first
  account loses the number and its switch goes off (its consent list says `proved_on_another_account`). Database: a unique index on
  `plan_phones.hash`.
- **Only for a must-not-miss item**, at the ladder's `phone` step (15 minutes after the item's time, after the push, the louder push and
  "X0 is calling"; the next person is told at +20). For someone else's item they also need their own Allow for that asker
  (`notify.followFrom`), and they must still be in the asker's X0 people (the same rules as messaging), checked again just before the call.
- **Never in quiet hours.** Theirs when set; with none set, never between 10 pm and 7 am.
- **Never twice for one step**, **at most 3 real calls a day per person** (`push.follow.phoneDayMax`) and **at most 3 a day to one
  number** (its keyed hash, `n:<hash>`, however many accounts it has been on that day), counted inside their own daily limit for louder
  pings (3, 6 or 10). Then the cost ceilings below.
- **Never to a number outside `PLIVO_ALLOWED_PREFIXES`** (default `+91`): a number added from abroad is refused, and one already proved
  is skipped if the prefixes change.
- **Press 9** on any call (or on a call they make to X0's number) stops X0's calls to that number. The stop is kept by the number's keyed
  hash (`plan_phone_stops`), not by the account: removing and adding the number again, on this account or any other, never lifts it.
  Only a fresh proving call from that phone (Turn calls back on, then the call with the new code) lifts it. The account that had the
  number is stopped and its switch goes off. Turning the switch off, removing the number, or turning Plan Ease's pings off also stops
  every call.

## What a call says

Fixed words, never written by an AI. The item's title is said only as it may be shown on a lock screen to someone else: no amount, and
never a health or medicine title (then it is "your 9 pm reminder"). The asker's first name only.

- Their own item: "Hello, this is X0. It's time for Pay maid, 9 pm. If it's done, press 1. For later, press 2. If you can't, press 3.
  To stop these calls, press 9."
- Someone else's: "Hello, this is X0. Rahul asked me to remind you: Pay maid, 9 pm. ..." (same keys)
- After a key: "Thank you. I'll tell Rahul." / "Okay. I'll remind you at 9:30 pm." / "Okay. I'll ask Dad." / "Okay, not this time." /
  "Okay. X0 won't call this phone again. You can turn calls back on in X0."
- Another key: the prompt once more, then it hangs up. No key at all: it hangs up after one prompt and the step reads "no answer".
- If the reminder was answered in the app while the phone rang: "That reminder isn't open any more. Thank you."

Hindi words exist for all of these (voice `PLIVO_VOICE_HI`); X0 keeps no language per person yet, so calls are in English today.

Every answer goes through the same door as the app's buttons (`planFollows().reply`, via "call"), so Done on a call ticks the to-do,
marks a bill paid for everyone on it, and shows in the asker's Activity as "Phone call".

## Set it up at Plivo (the owner, once)

1. **Account and India KYC.** Create a Plivo account, complete business KYC for India.
2. **A number.** Buy an Indian voice number that can make outbound calls and receive inbound calls (Plivo will say which number types
   your use needs; an 080 or 022 landline style number is usual). Put it in `PLIVO_FROM_NUMBER`, in E.164 (`+9180XXXXXXXX`; the leading + may be left out).
3. **Regulatory steps before the first call.** Automated calls in India need the right registrations (the TRAI A2P declaration for the
   number, and whatever Plivo India asks for on DLT, the number series and CNAP caller name for service calls). **Do not turn
   `CHANNEL_PHONE_CALLS` on before they are filed.** Have a lawyer confirm the consent reading for household members.
4. **An application for the proving call.** In Plivo, create an XML application with
   - Answer URL: `<PUBLIC_ORIGIN>/v1/channels/plivo/inbound`, method **POST**
   - Hangup URL: none needed
   and attach it to the number. This is what answers when a person calls X0's number to prove theirs. Outbound calls carry their own
   answer and hangup URLs (`/v1/channels/plivo/answer`, `/hangup`), so nothing else is set in the console.
5. **Keys.** Auth ID and Auth Token from the Plivo console into the env file (below). The token is a secret: the env file only.
6. **Check `PUBLIC_ORIGIN`** is the server's public https address. Every callback is checked against Plivo's signature
   (`X-Plivo-Signature-V3`, or `X-Plivo-Signature-Ma-V3` for a main account) over `PUBLIC_ORIGIN` + the path, so a wrong origin means
   every callback is refused (403).
7. Set `CHANNEL_PHONE_CALLS=true` and restart. What pings you now shows the switch.

## Settings (`tulmi/.env.example`)

| Name | Default | What it does |
|---|---|---|
| `CHANNEL_PHONE_CALLS` | `false` | The switch. Off, or any key missing: no call, the switch is hidden, the routes answer 404. |
| `PLIVO_AUTH_ID` | empty | Plivo Auth ID. |
| `PLIVO_AUTH_TOKEN` | empty | Plivo Auth Token. **Secret**: the env file only, never logged. Also the key Plivo signs callbacks with. |
| `PLIVO_FROM_NUMBER` | empty | X0's number: the caller id, and the number people call once to prove theirs. |
| `PLIVO_VOICE_EN` | `Polly.Raveena` | The English voice (en-IN). |
| `PLIVO_VOICE_HI` | `Polly.Aditi` | The Hindi voice (hi-IN). |
| `PLIVO_ALLOWED_PREFIXES` | `+91` | Comma-separated; a number outside them is never called or accepted. |
| `FOLLOW_CALL_ASKER_DAY_MAX` | `6` | Real calls for one asker's items in a day. |
| `FOLLOW_CALL_DAY_MAX` | `100` | Real calls for the whole server in a UTC day. `0` stops calls without turning the switch off. |
| `CONNECTOR_TOKEN_KEY` | (shared) | Numbers are sealed with it and found by a keyed hash made from it; our call MACs too. Required. |
| `PLAN_V2_FOLLOW` | `true` | Follow-through itself; off means no calls either. |

Also on the push surface's flags: `push.follow.phoneDayMax` (3 a day per person) and `push.follow.callAfterMin` and friends (the
ladder's timings).

## Costs, at most

Each call rings for at most 30 seconds and lasts at most 2 minutes (`ring_timeout: 30`, `time_limit: 120`); answering machines are hung
up on (`machine_detection: hangup`). So the most a day can cost is:

- per asker: `FOLLOW_CALL_ASKER_DAY_MAX` x 2 minutes = 12 minutes (default);
- for the whole server: `FOLLOW_CALL_DAY_MAX` x 2 minutes = **200 minutes a day** (default),

times Plivo's per-minute rate for outbound calls in India from your number type (see Plivo's India voice pricing; billing is per
minute). A typical call (prompt plus one key) is under a minute. Proving calls are inbound to your number and cost the inbound rate.
Raise the ceilings in the env once real use is seen. Calls to one number count too: at most 3 a day (`n:<hash>`), so one number proved
on many accounts in turn cannot use up the server's allowance.

## Privacy and safety

- **What is kept** (`plan_phones`, migration 0081): the number sealed (`seal`), a keyed hash to find it (`hash`, `pending_hash`), the
  setup code while it waits (`pending_code`, sealed, gone once proved), when it was proved and when they pressed 9, and what they agreed
  and when (`consent`: number added, proved by a call, moved to another account, stopped, removed, with the wording version
  `PHONE_CONSENT_V`, now 2 for "type the code"). Removing the number clears the number, both hashes and the code and keeps the consent
  list. Deleting the account deletes the row. **`plan_phone_stops`** keeps only the keyed hash of a number whose owner pressed 9 and when,
  so X0 never calls it again (a do-not-call list; no number, no account).
- **What Plivo gets**: the number and, when the call is answered, the spoken words above (no amount, no health title).
- **Nothing logged** has a number, a MAC or the words: the request log drops the callback's query (`observability.ts logUrl`), bodies are
  not logged, and the channel's own warnings carry only a status.
- **Every callback is checked twice**: Plivo's V3 signature (constant time), and for a call's own callbacks our MAC (`t`) binding it to
  one step of one follow for one person. Anything else is 403.
- **Proving by caller id and a code**: a number is proved by a call from it that types the code the account's own screen shows. Someone
  who types another person's number into their own account cannot prove it with that person's call (their code is not typed), and
  cannot block that person (each account waiting has its own code). Caller id can be spoofed on some networks: a spoofer who also has
  their own code could still prove someone else's number on their own account. Then X0 could call that number for the spoofer's
  reminders, at most 3 a day for that number (on any accounts), until its owner presses 9. Their 9 holds against re-adding the number,
  but a new spoofed proving call can lift it again. Calls only ever go to proved numbers.
- **Rotating `CONNECTOR_TOKEN_KEY`** makes every sealed number and every number hash unreadable: everyone's real calls stop until they
  add and prove their number again (the setup screen says "Add your number first"). Plan for it.

## The routes

| Route | Who | What |
|---|---|---|
| `GET /v1/botsapp/bots/plan/phone` | signed in | The setup screen's read: ready, their switch, state (`none`, `pending`, `verified`, `stopped`), masked number, X0's number to call, the code to type |
| `PUT /v1/botsapp/bots/plan/phone` | signed in | `{ phone }` their number (waits 30 minutes for its proving call, with a new code), or `{ again: true }` the same number proved again |
| `DELETE /v1/botsapp/bots/plan/phone` | signed in | Remove the number (switch off). Works even with calls off |
| `POST /v1/channels/plivo/answer` | Plivo, signed + MAC | Picked up: the prompt (`?try=2`: hang up, no answer) |
| `POST /v1/channels/plivo/input` | Plivo, signed + MAC | A key |
| `POST /v1/channels/plivo/hangup` | Plivo, signed + MAC | Ended: "no answer" unless a key was pressed |
| `POST /v1/channels/plivo/inbound` | Plivo, signed | X0's number called: prove (type the 4-digit code) or stop (press 9) |
| `POST /v1/channels/plivo/inbound/input` | Plivo, signed | The key on that call |

## Exotel (the fallback, not built)

If Plivo cannot serve the use in India, Exotel is the usual alternative: Indian numbers, DLT and caller-name support, outbound calls
through its Calls API with an ExoML or flow-builder applet for the keypad, and callbacks that would need their own signature check.
It would plug into the same seam (`PhoneChannel` in `planFollowChannels.ts`: `ready`, `canCall`, `call`, `numberOf`, `numberKey`) and reuse
`plan_phones`, the setup screen and the words; only the request, the XML and the signature check change. Not built.
