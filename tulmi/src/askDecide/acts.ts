/**
 * WORDS THAT ASK FOR SOMETHING TO BE DONE, WHATEVER THE MODEL CALLED THEM, IN THE LANGUAGES PEOPLE SAY THEM IN.
 *
 *   sendSaid(words)   a messaging app or mail, and a word that sends: "给王经理发微信…", "田中さんにLINEで…送って", "envoie un mail à…"
 *
 * The brain's model sometimes reads a request to act as small talk, most of all in Chinese and Japanese; then the answering model
 * says "sent" and nothing was. These rules hold it (askDecide/index.ts shape): a send said in so many words is a send, and money or a
 * delete (risk.ts) the model called chat is a task, which Ask asks about before it happens. A question is never one of these.
 */

/** A stem at the start of a word, in any script. */
const stems = (list: string[]): RegExp => new RegExp(`(?<!\\p{L})(?:${list.join("|")})`, "iu");

/** The ways a message goes: the apps, mail, a text. */
const CHANNEL = new RegExp([
  "whats ?app", "telegram", "signal(?!\\p{L})", "messenger", "imessage", "(?<!\\p{L})sms(?!\\p{L})", "(?<![a-z])line(?![a-z])", "wechat", "kakao", "slack", "teams(?!\\p{L})",
  "(?<!\\p{L})e-?mail", "(?<!\\p{L})mail(?!\\p{L})", "gmail", "correo", "courriel", "текст", "телеграм", "ватсап", "почт", "واتساب", "تيليجرام", "رسالة", "بريد",
  "微信", "短信", "邮件", "郵件", "メール", "ライン", "카톡", "카카오톡", "메시지", "문자", "वॉट्सऐप", "व्हाट्सएप", "মেসেজ", "হোয়াটসঅ্যাপ", "வாட்ஸ்அப்", "மெசேஜ்",
].join("|"), "iu");

/** Words that send. */
const SEND = new RegExp([
  stems(["send", "text(?!\\p{L})", "message(?!\\p{L})", "tell", "dm(?!\\p{L})", "mail(?!\\p{L})", "bhej", "bol do", "bata do",
    "envo?ie", "envía", "envia", "envíal", "manda", "mánda", "mande", "schick", "sende", "invia", "stuur", "gönder", "yaz(?!\\p{L})", "kirim", "tuma(?!\\p{L})",
    "отправ", "напиши", "пошли", "скажи", "أرسل", "ارسل", "ابعث", "قل ل", "পাঠা", "அனுப்ப", "보내", "전해"]).source,
  "发给", "发送", "发个", "发一", "发微信", "发短信", "发邮件", "告诉", "传给", "送って", "送る", "送信", "伝えて", "भेज",
].join("|"), "iu");

const QUESTION = /[?？؟]\s*$/u;

export const sendSaid = (words: string): boolean => !QUESTION.test(words.trim()) && CHANNEL.test(words) && SEND.test(words);
export const asked = (words: string): boolean => QUESTION.test(words.trim());
