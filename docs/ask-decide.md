# The one key's brain (`tulmi/src/askDecide`)

The person holds one key and talks. Whatever they said is an ask; `POST /v1/ask/decide` says which kind, so the computer does it without asking them which.

| `do` | What it is | What the computer does |
|---|---|---|
| `write` | words for the text box in front (dictation, or "reply saying I'm late") | types them; the pill can take them back |
| `send` | a message to someone through an app | Ask does it on the screen; they already said to send, so no "send?" card |
| `answer` | a question or advice; `screen` about what is in front, `web` needs fresh facts | Ask answers: looks at the screen, or searches and reads pages |
| `task` | something to do, one step or many | Ask's long job: plan, steps, "your turn" only for passwords, codes and payments |
| `routine` | something to do again on a schedule | saved as a routine (src/routines) |
| `notes` | start or stop meeting notes | notes |
| `bot` | clearly one of the person's bots | sent to that bot |

Two reads go beside `do`, for the voice chat (docs/talk.md) and anything else that answers: `chat` (casual talk, a joke, a small question about nothing on screen; `do` is `answer`, so this route still has its seven kinds) and `depth`, `quick` or `think` (`askDecide/depth.ts`: maths, a deep why or how, a comparison, a plan, code). The depth is read by rules for nothing; the model may raise it, never lower it.

## How it decides (Xode's way)
1. **Safety first, for nothing.** A password field or Tailzu's own window: typed, no model, the words never leave.
2. **One call** (role `ask_decide`, cheap tier, 30 paise cap) with the app, window title, the text box, the person's context (docs/context.md: who they are, who they message, their last asks; the computer's last 3 asks only while the server has kept none), a talk's last turns with what each answer found, and the person's bots. Any language. A short follow-up is made whole in `goal`.
3. **No second call.** Measured on the same words, the cheap tier decides as the tiny one did in 0.6 s against 1.5–2 s, for about half a paisa more a turn. An unsure decision is kept, and its `sure` says so. A call that stalls past 3 s moves on to the next model of the tier (the gateway's ladder) instead of waiting out the tier's 45 s.
4. **Never stuck.** Down (after the gateway's own ladder of models), or under 0.45 with a text box in front: typed. No box: Ask, which can ask one question itself.
5. **Rules only raise the risk** (`askDecide/risk.ts`). Money and deleting are read from the words (`risk`), whatever the model said, so they are always confirmed: in about twenty languages (English, Hinglish, Hindi, Spanish, Portuguese, Italian, French, German, Dutch, Turkish, Indonesian, Swahili, Russian, Arabic, Bengali, Tamil, Korean, Chinese, Japanese), each word a stem at the start of a word, word edges by letters (`\p{L}`), not `\b`, which ends a word at ö or é.
6. **Words that act are acts** (`askDecide/acts.ts`). A messaging app or mail with a word that sends ("给王经理发微信…", "田中さんにLINEで…送って") is a send even when the model called it talk, and money or a delete it called chat is a task, which Ask asks about first. A question (ending in ?, ？ or ؟) is neither, and dictation into a text box stays dictation.
7. **Cache.** The same words in the same place within 10 minutes: the answer from before. A decision for a private (incognito) window (`privateWindow`) is not cached, and not kept in the person's context (docs/context.md).

## Permissions
The setup card is answered once (read text, see the screen, send pictures). The computer sends its state as `grants`; the answer's `needs` is what this ask will use and `missing` what the card has not allowed. The computer asks for that one permission at the turn that needs it, and never for one already given.

Evals: `tulmi/evals/ask_decide.jsonl` (English, Hinglish, Hindi, Spanish, a follow-up, a bot, a planted instruction, chat, a think).
